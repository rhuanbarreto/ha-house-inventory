/**
 * Batch + scheduled enrichment.
 *
 * The scheduler picks one asset at a time that needs enrichment, runs the
 * single-asset pipeline, and writes a per-asset state update. This keeps
 * rate limiting trivial (serial) and failures isolated.
 *
 * Selection:
 *   - source=home_assistant OR source=manual
 *   - hidden = 0
 *   - manufacturer AND model non-empty
 *   - no asset_links yet (first-time enrichment) OR last success > 30d ago
 *   - skip if last attempt < BACKOFF_MS ago AND attempt resulted in error
 *     (prevents hot-looping on broken URLs)
 *   - among eligible, oldest last_enrichment_attempt_at first (null = first)
 */

import type { Database } from "bun:sqlite";
import type { HaClient } from "./ha-client.ts";
import { enrichAsset } from "./enrich.ts";
import { getSetting } from "./settings.ts";
import type { SearchConfig } from "./search.ts";

const STALE_MS = 30 * 86_400_000; // 30 days
const BASE_BACKOFF_MS = 6 * 3_600_000; // 6h base after a failed attempt
/** Max backoff: ~8 days (6h × 2^5). Prevents permanent exclusion. */
const MAX_BACKOFF_MS = 8 * 86_400_000;

/**
 * Exponential backoff: 6h, 12h, 24h, 48h, 96h, 192h (capped at ~8d).
 * Uses the asset's `enrichment_attempts` count so repeat failures
 * get progressively longer delays instead of retrying every 6h forever.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 1) return BASE_BACKOFF_MS;
  // 2^(attempts-1) × base, capped at MAX_BACKOFF_MS
  const multiplier = Math.pow(2, Math.min(attempts - 1, 10));
  return Math.min(BASE_BACKOFF_MS * multiplier, MAX_BACKOFF_MS);
}

export interface BatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  cacheHits: number;
  skippedNoLlm: boolean;
  results: Array<{
    asset_id: string;
    name: string;
    ok: boolean;
    cache?: "hit" | "miss";
    manual_downloaded?: boolean;
    error?: string;
  }>;
}

export interface QueueStatus {
  total_eligible: number;
  never_attempted: number;
  stale: number;
  failed_in_backoff: number;
  last_success_at: string | null;
  last_attempt_at: string | null;
}

export function queueStatus(db: Database): QueueStatus {
  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  const now = Date.now();

  // First pass: get all eligible assets with their attempt counts so we
  // can compute per-asset exponential backoff on the application side.
  const candidates = db
    .query<
      {
        last_enrichment_attempt_at: string | null;
        last_enrichment_success_at: string | null;
        last_enrichment_error: string | null;
        enrichment_attempts: number;
      },
      [string]
    >(
      `SELECT
         a.last_enrichment_attempt_at,
         a.last_enrichment_success_at,
         a.last_enrichment_error,
         a.enrichment_attempts
       FROM assets a
       WHERE a.hidden = 0
         AND a.manufacturer IS NOT NULL AND a.manufacturer != ''
         AND a.model IS NOT NULL AND a.model != ''`,
    )
    .all(staleCutoff);

  let neverAttempted = 0;
  let stale = 0;
  let failedInBackoff = 0;

  for (const c of candidates) {
    if (c.last_enrichment_attempt_at === null) {
      neverAttempted++;
    } else if (
      c.last_enrichment_success_at !== null &&
      c.last_enrichment_success_at < staleCutoff
    ) {
      stale++;
    }
    if (
      c.last_enrichment_error !== null &&
      c.last_enrichment_attempt_at !== null
    ) {
      const assetBackoff = backoffMs(c.enrichment_attempts);
      const cutoff = new Date(now - assetBackoff).toISOString();
      if (c.last_enrichment_attempt_at >= cutoff) {
        failedInBackoff++;
      }
    }
  }

  const row = {
    total_eligible: candidates.length,
    never_attempted: neverAttempted,
    stale,
    failed_in_backoff: failedInBackoff,
  };

  const last = db
    .query<{ last_success_at: string | null; last_attempt_at: string | null }, []>(
      `SELECT
         MAX(last_enrichment_success_at) AS last_success_at,
         MAX(last_enrichment_attempt_at) AS last_attempt_at
       FROM assets`,
    )
    .get();

  return {
    total_eligible: row.total_eligible ?? 0,
    never_attempted: row.never_attempted ?? 0,
    stale: row.stale ?? 0,
    failed_in_backoff: row.failed_in_backoff ?? 0,
    last_success_at: last?.last_success_at ?? null,
    last_attempt_at: last?.last_attempt_at ?? null,
  };
}

/**
 * Pick the next N asset ids that need enrichment, in priority order.
 *
 * Uses progressive backoff: the SQL fetches a wider candidate pool
 * (assets with errors are included), then the application filters out
 * assets still inside their per-attempt exponential backoff window.
 */
export function pickNext(db: Database, limit: number): Array<{ id: string; name: string }> {
  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  const now = Date.now();

  // Fetch more candidates than needed so we can filter by per-asset
  // backoff and still fill the requested `limit`.
  const oversample = limit * 4;
  const rows = db
    .query<
      {
        id: string;
        name: string;
        last_enrichment_attempt_at: string | null;
        last_enrichment_error: string | null;
        enrichment_attempts: number;
      },
      [string, string, number]
    >(
      `SELECT id, name, last_enrichment_attempt_at, last_enrichment_error,
              enrichment_attempts
       FROM assets
       WHERE hidden = 0
         AND manufacturer IS NOT NULL AND manufacturer != ''
         AND model IS NOT NULL AND model != ''
         -- either never enriched, or success is stale
         AND (
           last_enrichment_success_at IS NULL
           OR last_enrichment_success_at < ?
         )
         -- skip assets that already have fresh links (success path may not
         -- have updated the state column for pre-migration rows)
         AND NOT EXISTS (
           SELECT 1 FROM asset_links l
           WHERE l.asset_id = assets.id AND l.fetched_at >= ?
         )
       ORDER BY
         CASE WHEN last_enrichment_attempt_at IS NULL THEN 0 ELSE 1 END,
         COALESCE(last_enrichment_attempt_at, '') ASC,
         created_at ASC
       LIMIT ?`,
    )
    .all(staleCutoff, staleCutoff, oversample);

  // Apply per-asset exponential backoff on the application side.
  const result: Array<{ id: string; name: string }> = [];
  for (const row of rows) {
    if (result.length >= limit) break;
    // If the last attempt was an error, check per-asset backoff.
    if (
      row.last_enrichment_error !== null &&
      row.last_enrichment_attempt_at !== null
    ) {
      const assetBackoff = backoffMs(row.enrichment_attempts);
      const cutoff = now - assetBackoff;
      if (Date.parse(row.last_enrichment_attempt_at) > cutoff) {
        continue; // still in backoff window — skip
      }
    }
    result.push({ id: row.id, name: row.name });
  }
  return result;
}

/**
 * Record the outcome of an enrichment attempt on the asset itself so the
 * queue selector can de-prioritize and back off accordingly.
 */
export function recordAttempt(
  db: Database,
  assetId: string,
  outcome: { ok: boolean; error?: string },
): void {
  const now = new Date().toISOString();
  if (outcome.ok) {
    db.run(
      `UPDATE assets SET
         last_enrichment_attempt_at = ?,
         last_enrichment_success_at = ?,
         last_enrichment_error = NULL,
         enrichment_attempts = enrichment_attempts + 1,
         updated_at = ?
       WHERE id = ?`,
      [now, now, now, assetId],
    );
  } else {
    db.run(
      `UPDATE assets SET
         last_enrichment_attempt_at = ?,
         last_enrichment_error = ?,
         enrichment_attempts = enrichment_attempts + 1,
         updated_at = ?
       WHERE id = ?`,
      [now, outcome.error ?? "unknown error", now, assetId],
    );
  }
}

export interface BatchOptions {
  max: number;
  /** Delay between assets, ms. Default 2000 — polite to DDG + LLM quotas. */
  interAssetDelayMs?: number;
  /** Web search provider config. Falls back to DuckDuckGo when omitted. */
  searchConfig?: SearchConfig;
}

export async function runBatch(
  db: Database,
  ha: HaClient,
  dataDir: string,
  opts: BatchOptions,
): Promise<BatchResult> {
  // Early exit: no LLM configured → nothing to do. Surface it clearly.
  if (!getSetting(db, "llm_entity_id")) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      cacheHits: 0,
      skippedNoLlm: true,
      results: [],
    };
  }

  const candidates = pickNext(db, opts.max);
  const result: BatchResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    cacheHits: 0,
    skippedNoLlm: false,
    results: [],
  };

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c) continue;
    result.processed++;
    try {
      const r = await enrichAsset(db, ha, dataDir, c.id, opts.searchConfig);
      // enrichAsset writes its own success state — no recordAttempt needed.
      result.succeeded++;
      if (r.cache === "hit") result.cacheHits++;
      result.results.push({
        asset_id: c.id,
        name: c.name,
        ok: true,
        cache: r.cache,
        manual_downloaded: r.manual_downloaded,
      });
    } catch (err) {
      const msg = (err as Error).message;
      recordAttempt(db, c.id, { ok: false, error: msg });
      result.failed++;
      result.results.push({
        asset_id: c.id,
        name: c.name,
        ok: false,
        error: msg,
      });
    }

    // Throttle between assets — skip after the last one.
    if (i < candidates.length - 1) {
      await new Promise((r) => setTimeout(r, opts.interAssetDelayMs ?? 2000));
    }
  }

  return result;
}
