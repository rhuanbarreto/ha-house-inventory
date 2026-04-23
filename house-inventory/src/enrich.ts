/**
 * Enrichment orchestrator.
 *
 * For a single asset:
 *   1. Skip if no manufacturer + model (nothing to search for).
 *   2. Check `enrichment_cache` by normalized (manufacturer|model) key. The
 *      same key is shared across every asset of the same model, so one hit
 *      enriches every duplicate for free.
 *   3. On cache miss:
 *       a. Search DDG for `${manufacturer} ${model} manual support` and for
 *          `${manufacturer} ${model} manual filetype:pdf`.
 *       b. Feed the top results into the configured AI Task. Ask for a
 *          structured set of URLs (product, support, manual, firmware, parts).
 *       c. Store in `enrichment_cache`.
 *   4. Insert each non-null URL into `asset_links`.
 *   5. If a manual URL was found, download the PDF into
 *      `/data/manuals/<asset_id>/` and record it in `asset_files`.
 */

import type { Database } from "bun:sqlite";
import type { HaClient } from "./ha-client.ts";
import { generateStructured } from "./ai-task.ts";
import { searchDuckDuckGo } from "./search.ts";
import { downloadPdf, NotAPdfError } from "./download.ts";
import { getSetting } from "./settings.ts";

export interface EnrichedLinks extends Record<string, unknown> {
  product_url: string | null;
  support_url: string | null;
  manual_url: string | null;
  firmware_url: string | null;
  parts_url: string | null;
  model_marketing_name: string | null;
  notes: string | null;
}

export interface EnrichmentResult {
  asset_id: string;
  cache: "hit" | "miss";
  links: EnrichedLinks;
  manual_downloaded: boolean;
  manual_error: string | null;
}

const ENRICHMENT_TTL_DAYS = 30;

export async function enrichAsset(
  db: Database,
  ha: HaClient,
  dataDir: string,
  assetId: string,
): Promise<EnrichmentResult> {
  const asset = db
    .query<AssetRow, [string]>(
      "SELECT id, name, manufacturer, model FROM assets WHERE id = ?",
    )
    .get(assetId);
  if (!asset) throw new Error(`asset not found: ${assetId}`);
  if (!asset.manufacturer || !asset.model) {
    throw new Error(
      `asset ${assetId} has no manufacturer/model — cannot enrich automatically`,
    );
  }

  const entityId = getSetting(db, "llm_entity_id");
  if (!entityId) {
    throw new Error(
      "No LLM selected. POST /settings/llm with an entity_id first, or use /llm/create.",
    );
  }

  const cacheKey = cacheKeyFor(asset.manufacturer, asset.model);
  const cached = getCached(db, cacheKey);
  let links: EnrichedLinks;
  let cache: "hit" | "miss";

  if (cached) {
    links = cached;
    cache = "hit";
  } else {
    links = await researchAndAsk(ha, entityId, asset.manufacturer, asset.model);
    putCache(db, cacheKey, asset.manufacturer, asset.model, links);
    cache = "miss";
  }

  upsertLinks(db, assetId, links);

  let manualDownloaded = false;
  let manualError: string | null = null;
  if (links.manual_url) {
    try {
      const file = await downloadPdf(links.manual_url, assetId, dataDir);
      recordFile(db, assetId, "manual", file);
      manualDownloaded = true;
    } catch (err) {
      manualError =
        err instanceof NotAPdfError
          ? `not a pdf (${err.contentType})`
          : (err as Error).message;
    }
  }

  return {
    asset_id: assetId,
    cache,
    links,
    manual_downloaded: manualDownloaded,
    manual_error: manualError,
  };
}

// ---- research ------------------------------------------------------------

async function researchAndAsk(
  ha: HaClient,
  entityId: string,
  manufacturer: string,
  model: string,
): Promise<EnrichedLinks> {
  const queries = [
    `${manufacturer} ${model} manual support`,
    `${manufacturer} ${model} manual filetype:pdf`,
  ];
  const results = await Promise.all(queries.map((q) => searchDuckDuckGo(q, 8)));
  const merged = dedupeByUrl(results.flat()).slice(0, 16);

  const searchBlob = merged
    .map(
      (r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`,
    )
    .join("\n\n");

  const instructions = `You are helping build a house asset inventory.
Pick the best URLs for this product from the web search results below. Only
return URLs that actually appear in the results — never invent one. If a
field isn't clearly findable, return null.

Product:
  Manufacturer: ${manufacturer}
  Model: ${model}

Web search results:
${searchBlob}`;

  return await generateStructured<EnrichedLinks>(ha, {
    entityId,
    taskName: `enrich_${manufacturer}_${model}`.replace(/[^a-z0-9_]/gi, "_"),
    instructions,
    structure: {
      product_url: {
        description: "Official product page from the manufacturer.",
      },
      support_url: {
        description: "Official support / downloads / help page for the product.",
      },
      manual_url: {
        description:
          "Direct URL to a downloadable user manual PDF. Must end in .pdf OR be a page whose sole purpose is to open a manual PDF.",
      },
      firmware_url: {
        description: "Firmware / software download page for this product.",
      },
      parts_url: {
        description: "Spare parts or replacement accessories page for this product.",
      },
      model_marketing_name: {
        description:
          "The marketing / consumer name of this model if the raw model string looks technical (e.g. 'roborock.vacuum.a70' → 'Roborock S8 Pro Ultra'). Otherwise null.",
      },
      notes: {
        description: "One short sentence of context about what this product is, if useful.",
      },
    },
  });
}

function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of items) {
    if (seen.has(i.url)) continue;
    seen.add(i.url);
    out.push(i);
  }
  return out;
}

// ---- cache ---------------------------------------------------------------

function cacheKeyFor(manufacturer: string, model: string): string {
  return `${manufacturer.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
}

function getCached(db: Database, key: string): EnrichedLinks | null {
  const row = db
    .query<
      { data_json: string; expires_at: string | null },
      [string]
    >("SELECT data_json, expires_at FROM enrichment_cache WHERE key = ?")
    .get(key);
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null;
  try {
    return JSON.parse(row.data_json) as EnrichedLinks;
  } catch {
    return null;
  }
}

function putCache(
  db: Database,
  key: string,
  manufacturer: string,
  model: string,
  data: EnrichedLinks,
): void {
  const now = new Date();
  const expires = new Date(now.getTime() + ENRICHMENT_TTL_DAYS * 86_400_000);
  db.run(
    `INSERT INTO enrichment_cache (key, manufacturer, model, data_json, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       manufacturer=excluded.manufacturer,
       model=excluded.model,
       data_json=excluded.data_json,
       fetched_at=excluded.fetched_at,
       expires_at=excluded.expires_at`,
    [key, manufacturer, model, JSON.stringify(data), now.toISOString(), expires.toISOString()],
  );
}

// ---- persistence into asset_links / asset_files --------------------------

function upsertLinks(
  db: Database,
  assetId: string,
  links: EnrichedLinks,
): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO asset_links (asset_id, kind, url, title, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(asset_id, kind, url) DO UPDATE SET fetched_at=excluded.fetched_at`,
  );
  const pairs: Array<[string, string | null]> = [
    ["product", links.product_url],
    ["support", links.support_url],
    ["manual", links.manual_url],
    ["firmware", links.firmware_url],
    ["parts", links.parts_url],
  ];
  db.transaction(() => {
    for (const [kind, url] of pairs) {
      if (url) insert.run(assetId, kind, url, null, now);
    }
  })();
}

function recordFile(
  db: Database,
  assetId: string,
  kind: string,
  file: { localPath: string; sha256: string; bytes: number },
): void {
  // Dedup: if this sha256 is already recorded for this asset + kind, do nothing.
  const existing = db
    .query<{ id: number }, [string, string]>(
      "SELECT id FROM asset_files WHERE asset_id = ? AND sha256 = ?",
    )
    .get(assetId, file.sha256);
  if (existing) return;
  db.run(
    `INSERT INTO asset_files (asset_id, kind, local_path, sha256, bytes, downloaded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [assetId, kind, file.localPath, file.sha256, file.bytes, new Date().toISOString()],
  );
}

interface AssetRow {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
}
