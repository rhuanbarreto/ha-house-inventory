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
const BACKOFF_MS = 6 * 3_600_000; // 6h after a failed attempt

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
  const backoffCutoff = new Date(Date.now() - BACKOFF_MS).toISOString();

  const row = db
    .query<
      {
        total_eligible: number;
        never_attempted: number;
        stale: number;
        failed_in_backoff: number;
      },
      [string, string]
    >(
      `SELECT
         COUNT(*) AS total_eligible,
         SUM(CASE WHEN a.last_enrichment_attempt_at IS NULL THEN 1 ELSE 0 END) AS never_attempted,
         SUM(CASE WHEN a.last_enrichment_success_at IS NOT NULL AND a.last_enrichment_success_at < ? THEN 1 ELSE 0 END) AS stale,
         SUM(CASE WHEN a.last_enrichment_error IS NOT NULL AND a.last_enrichment_attempt_at >= ? THEN 1 ELSE 0 END) AS failed_in_backoff
       FROM assets a
       WHERE a.hidden = 0
         AND a.manufacturer IS NOT NULL AND a.manufacturer != ''
         AND a.model IS NOT NULL AND a.model != ''`,
    )
    .get(staleCutoff, backoffCutoff) ?? {
    total_eligible: 0,
    never_attempted: 0,
    stale: 0,
    failed_in_backoff: 0,
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

/** Pick the next N asset ids that need enrichment, in priority order. */
export function pickNext(db: Database, limit: number): Array<{ id: string; name: string }> {
  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  const backoffCutoff = new Date(Date.now() - BACKOFF_MS).toISOString();
  return db
    .query<
      { id: string; name: string },
      [string, string, string, number]
    >(
      `SELECT id, name FROM assets
       WHERE hidden = 0
         AND manufacturer IS NOT NULL AND manufacturer != ''
         AND model IS NOT NULL AND model != ''
         -- either never enriched, or success is stale
         AND (
           last_enrichment_success_at IS NULL
           OR last_enrichment_success_at < ?
         )
         -- and not inside the failure backoff window
         AND NOT (
           last_enrichment_error IS NOT NULL
           AND last_enrichment_attempt_at IS NOT NULL
           AND last_enrichment_attempt_at >= ?
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
    .all(staleCutoff, backoffCutoff, staleCutoff, limit);
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
