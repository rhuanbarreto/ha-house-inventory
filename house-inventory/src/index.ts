/**
 * House Inventory — entrypoint.
 *
 * Pure JSON API server + static file host for the React SPA.
 *   - `/api/*`    JSON endpoints (SPA, scripting, HA automations)
 *   - `/static/*` Bundled frontend assets (JS, CSS)
 *   - `GET *`     SPA catch-all — serves index.html with ingress path injected
 *   - `/healthz`  Container health check
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { loadConfig } from "./config.ts";
import { HaClient } from "./ha-client.ts";
import { openDatabase } from "./db.ts";
import { syncFromHomeAssistant } from "./sync.ts";
import { clearSetting, getSetting, setSetting } from "./settings.ts";
import { enrichAsset } from "./enrich.ts";
import { queueStatus, runBatch } from "./enrich-batch.ts";
import { getInFlightBatch, setInFlightBatch } from "./batch-state.ts";
import type { SearchConfig } from "./search.ts";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** How often the background enrichment tick fires. */
const ENRICH_INTERVAL_MS = 10 * 60 * 1000; // 10 min
/** Assets processed per scheduled tick. Kept small to avoid bursting the LLM. */
const ENRICH_BATCH_PER_TICK = 3;

const config = loadConfig();
const ha = new HaClient(config);
const db = openDatabase(config.dataDir);

/** Build the search config from add-on options, used by all enrich calls. */
function searchConfig(): SearchConfig {
  return {
    provider: config.webSearchProvider,
    braveApiKey: config.braveApiKey,
  };
}

/** Directory containing the built SPA (index.html, JS, CSS). */
const STATIC_DIR = process.env.STATIC_DIR ?? join(import.meta.dir, "..", "dist", "static");

const app = new Hono();

// ---- Health (kept at root for container health checks) --------------------
app.get("/healthz", (c) => c.text("ok"));

// ===========================================================================
//   /api — JSON endpoints
// ===========================================================================

const api = new Hono();

// ---- Config (SPA bootstrap) ------------------------------------------------

api.get("/config", (c) => {
  return c.json({
    ingressPath: c.req.header("x-ingress-path") ?? "",
    mode: config.mode,
    user: {
      id: c.req.header("x-remote-user-id") ?? null,
      name: c.req.header("x-remote-user-name") ?? null,
      displayName: c.req.header("x-remote-user-display-name") ?? null,
    },
  });
});

// ---- Dashboard (aggregated stats for SPA) -----------------------------------

api.get("/dashboard", (c) => {
  const totals = db
    .query<
      {
        total: number;
        visible: number;
        hidden: number;
        manual: number;
        with_links: number;
        with_pdf: number;
        areas: number;
      },
      []
    >(
      `SELECT
         (SELECT COUNT(*) FROM assets)                              AS total,
         (SELECT COUNT(*) FROM assets WHERE hidden=0)               AS visible,
         (SELECT COUNT(*) FROM assets WHERE hidden=1)               AS hidden,
         (SELECT COUNT(*) FROM assets WHERE source='manual')        AS manual,
         (SELECT COUNT(DISTINCT asset_id) FROM asset_links)         AS with_links,
         (SELECT COUNT(DISTINCT asset_id) FROM asset_files)         AS with_pdf,
         (SELECT COUNT(*) FROM areas)                               AS areas`,
    )
    .get();

  const lastSync = db
    .query<
      {
        started_at: string;
        finished_at: string | null;
        error: string | null;
        devices_added: number;
        devices_updated: number;
      },
      []
    >(
      `SELECT started_at, finished_at, error, devices_added, devices_updated
       FROM ha_sync_log ORDER BY id DESC LIMIT 1`,
    )
    .get();

  const llmEntityId = getSetting(db, "llm_entity_id");
  const enrichStatus = queueStatus(db);
  const enriched = db
    .query<{ c: number }, []>(
      `SELECT COUNT(DISTINCT asset_id) AS c FROM asset_links`,
    )
    .get()?.c ?? 0;
  const inFlight = getInFlightBatch();

  return c.json({
    totals: totals ?? {
      total: 0, visible: 0, hidden: 0, manual: 0, with_links: 0, with_pdf: 0, areas: 0,
    },
    lastSync: lastSync ?? null,
    llmEntityId,
    enrichStatus,
    enriched,
    inFlight,
    mode: config.mode,
    dataDir: config.dataDir,
  });
});

// ---- Areas with floor groupings ---------------------------------------------

api.get("/areas", (c) => {
  const floors = db
    .query<
      { id: string; name: string; icon: string | null; level: number | null },
      []
    >(
      `SELECT id, name, icon, level FROM floors
       ORDER BY COALESCE(level, 0), name`,
    )
    .all();

  const areas = db
    .query<
      {
        id: string;
        name: string;
        icon: string | null;
        floor_id: string | null;
        visible_count: number;
        hidden_count: number;
        enriched_count: number;
      },
      []
    >(
      `SELECT
         ar.id,
         ar.name,
         ar.icon,
         ar.floor_id,
         (SELECT COUNT(*) FROM assets a
            WHERE a.area_id = ar.id AND a.hidden = 0) AS visible_count,
         (SELECT COUNT(*) FROM assets a
            WHERE a.area_id = ar.id AND a.hidden = 1) AS hidden_count,
         (SELECT COUNT(DISTINCT l.asset_id) FROM asset_links l
            INNER JOIN assets a ON a.id = l.asset_id
            WHERE a.area_id = ar.id AND a.hidden = 0) AS enriched_count
       FROM areas ar
       ORDER BY ar.name`,
    )
    .all();

  const unassignedAssets = db
    .query<{ c: number }, []>(
      "SELECT COUNT(*) AS c FROM assets WHERE area_id IS NULL AND hidden = 0",
    )
    .get()?.c ?? 0;

  return c.json({ floors, areas, unassignedAssets });
});

// ---- Assets list + detail ---------------------------------------------------

api.get("/assets", (c) => {
  const showHidden = c.req.query("hidden") === "1";
  const where: string[] = [`a.hidden = ${showHidden ? 1 : 0}`];
  const params: (string | number)[] = [];
  const area = c.req.query("area");
  if (area) {
    where.push("a.area_id = ?");
    params.push(area);
  }
  const q = c.req.query("q");
  if (q && q.trim().length > 0) {
    const term = `%${q.trim()}%`;
    where.push(
      "(a.name LIKE ? OR COALESCE(a.manufacturer,'') LIKE ? OR COALESCE(a.model,'') LIKE ?)",
    );
    params.push(term, term, term);
  }
  const rows = db
    .query(
      `SELECT a.id, a.name, a.manufacturer, a.model, a.area_id,
              ar.name AS area_name, a.source, a.hidden, a.hidden_reason
       FROM assets a
       LEFT JOIN areas ar ON ar.id = a.area_id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(a.manufacturer,''), COALESCE(a.model,''), a.name`,
    )
    .all(...params);
  return c.json({ count: rows.length, assets: rows });
});

api.get("/assets/:id", (c) => {
  const assetId = c.req.param("id");
  const asset = db
    .query("SELECT * FROM assets WHERE id = ?")
    .get(assetId);
  if (!asset) return c.json({ error: "not found" }, 404);
  const links = db
    .query(
      "SELECT id, kind, url, title, fetched_at FROM asset_links WHERE asset_id = ? ORDER BY kind",
    )
    .all(assetId);
  const files = db
    .query(
      "SELECT id, kind, local_path, sha256, bytes, downloaded_at FROM asset_files WHERE asset_id = ?",
    )
    .all(assetId);
  return c.json({ asset, links, files });
});

// ---- Create manual asset (JSON body) ----------------------------------------

api.post("/assets", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    name?: string;
    manufacturer?: string | null;
    model?: string | null;
    category?: string | null;
    area_id?: string | null;
    purchase_date?: string | null;
    purchase_price?: string | null;
    warranty_until?: string | null;
    notes?: string | null;
  } | null;

  const name = (body?.name ?? "").trim();
  if (name.length === 0) {
    return c.json({ error: "Name is required" }, 400);
  }

  const manufacturer = body?.manufacturer?.trim() || null;
  const model = body?.model?.trim() || null;
  const category = body?.category?.trim() || null;
  const areaId = body?.area_id || null;
  const purchaseDate = body?.purchase_date || null;
  const warrantyUntil = body?.warranty_until || null;
  const notes = body?.notes?.trim() || null;
  const priceCents = parsePriceCents(body?.purchase_price ?? null);

  const id = `manual_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO assets (
       id, source, ha_device_id, name, manufacturer, model, area_id,
       category, purchase_date, purchase_price_cents, warranty_until, notes,
       hidden, hidden_reason, created_at, updated_at, last_seen_at
     ) VALUES (?, 'manual', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    [
      id, name, manufacturer, model, areaId, category,
      purchaseDate, priceCents, warrantyUntil, notes, now, now, now,
    ],
  );

  return c.json({ id, name });
});

api.post("/assets/:id/edit", async (c) => {
  const assetId = c.req.param("id");
  const exists = db
    .query<{ id: string }, [string]>("SELECT id FROM assets WHERE id = ?")
    .get(assetId);
  if (!exists) return c.json({ error: "not found" }, 404);

  const body = (await c.req.json().catch(() => null)) as {
    category?: string | null;
    area_id?: string | null;
    purchase_date?: string | null;
    purchase_price?: string | null;
    warranty_until?: string | null;
    notes?: string | null;
  } | null;

  const category = body?.category?.trim() || null;
  const areaId = body?.area_id || null;
  const purchaseDate = body?.purchase_date || null;
  const warrantyUntil = body?.warranty_until || null;
  const notes = body?.notes?.trim() || null;
  const priceCents = parsePriceCents(body?.purchase_price ?? null);

  db.run(
    `UPDATE assets SET
       category=?, area_id=?, purchase_date=?, purchase_price_cents=?,
       warranty_until=?, notes=?, updated_at=?
     WHERE id=?`,
    [category, areaId, purchaseDate, priceCents, warrantyUntil, notes,
      new Date().toISOString(), assetId],
  );
  return c.json({ ok: true });
});

api.post("/assets/:id/toggle-hidden", (c) => {
  const assetId = c.req.param("id");
  const row = db
    .query<{ hidden: number }, [string]>(
      "SELECT hidden FROM assets WHERE id = ?",
    )
    .get(assetId);
  if (!row) return c.json({ error: "not found" }, 404);
  const next = row.hidden ? 0 : 1;
  db.run(
    `UPDATE assets SET hidden=?, hidden_reason=?, updated_at=? WHERE id=?`,
    [next, next === 1 ? "manual_hide" : null, new Date().toISOString(), assetId],
  );
  return c.json({ hidden: next === 1 });
});

api.post("/assets/:id/delete", (c) => {
  const assetId = c.req.param("id");
  const row = db
    .query<{ source: string; name: string }, [string]>(
      "SELECT source, name FROM assets WHERE id = ?",
    )
    .get(assetId);
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.source !== "manual") {
    return c.json({ error: "Only manual assets can be deleted" }, 400);
  }
  db.run("DELETE FROM assets WHERE id = ?", [assetId]);
  return c.json({ ok: true });
});

// ---- Sync -------------------------------------------------------------------

api.post("/sync", async (c) => {
  const result = await syncFromHomeAssistant(db, ha);
  return c.json(result, result.error ? 500 : 200);
});

api.get("/sync/history", (c) => {
  const rows = db
    .query("SELECT * FROM ha_sync_log ORDER BY id DESC LIMIT 20")
    .all();
  return c.json(rows);
});

// ---- LLM --------------------------------------------------------------------

api.get("/llm", async (c) => {
  try {
    const discovered = await ha.discoverLlmEntities();
    const current = getSetting(db, "llm_entity_id");
    const aiTasks = discovered.filter((e) => e.kind === "ai_task");
    return c.json({
      current,
      discovered,
      counts: {
        ai_tasks: aiTasks.length,
        conversation_agents: discovered.length - aiTasks.length,
      },
      autoSelectable:
        current === null && aiTasks.length === 1
          ? (aiTasks[0]?.entity_id ?? null)
          : null,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST kept for backwards compat but now JSON-only
api.post("/settings/llm", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    entity_id?: string;
  } | null;
  const id = body?.entity_id?.trim();
  if (!id) return c.json({ error: "entity_id is required" }, 400);
  const discovered = await ha.discoverLlmEntities();
  const match = discovered.find((e) => e.entity_id === id);
  if (!match) {
    return c.json(
      { error: `entity_id not found: ${id}`, available: discovered.map((e) => e.entity_id) },
      404,
    );
  }
  setSetting(db, "llm_entity_id", id);
  return c.json({ ok: true, entity_id: id, kind: match.kind });
});

api.put("/settings/llm", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    entity_id?: string;
  } | null;
  const id = body?.entity_id;
  if (!id) return c.json({ error: "entity_id is required" }, 400);
  const discovered = await ha.discoverLlmEntities();
  const match = discovered.find((e) => e.entity_id === id);
  if (!match) {
    return c.json(
      { error: `entity_id not found: ${id}`, available: discovered.map((e) => e.entity_id) },
      404,
    );
  }
  setSetting(db, "llm_entity_id", id);
  return c.json({ ok: true, entity_id: id, kind: match.kind });
});

api.post("/settings/llm/clear", (c) => {
  clearSetting(db, "llm_entity_id");
  return c.json({ ok: true });
});

api.delete("/settings/llm", (c) => {
  clearSetting(db, "llm_entity_id");
  return c.json({ ok: true });
});

api.get("/llm/creatable", async (c) => {
  try {
    const entries = await ha.listAiTaskCreatableEntries();
    return c.json({
      count: entries.length,
      entries: entries.map((e) => ({
        entry_id: e.entry_id,
        domain: e.domain,
        title: e.title,
        existing_subentries: e.num_subentries,
      })),
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

api.post("/llm/create", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    entry_id?: string;
    options?: Record<string, unknown>;
  } | null;
  const entryId = body?.entry_id;
  const options = body?.options ?? {};

  if (!entryId) {
    return c.json({ error: "entry_id is required" }, 400);
  }

  const entitiesBefore = new Set(
    (await ha.discoverLlmEntities())
      .filter((e) => e.kind === "ai_task")
      .map((e) => e.entity_id),
  );

  let step = await ha.startSubentryFlow(entryId, "ai_task_data");
  for (let i = 0; step.type === "form" && i < 5; i++) {
    step = await ha.submitSubentryFlow(step.flow_id, options);
  }
  if (step.type === "form") {
    await ha.cancelSubentryFlow(step.flow_id);
    return c.json({ error: "Creation needed too many steps — aborted" }, 500);
  }
  if (step.type === "abort") {
    return c.json({ error: `Aborted: ${step.reason}` }, 400);
  }

  let newEntityId: string | null = null;
  for (let i = 0; i < 10; i++) {
    const after = await ha.discoverLlmEntities();
    const nw = after.find(
      (e) => e.kind === "ai_task" && !entitiesBefore.has(e.entity_id),
    );
    if (nw) {
      newEntityId = nw.entity_id;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (newEntityId) {
    setSetting(db, "llm_entity_id", newEntityId);
    return c.json({ ok: true, entity_id: newEntityId, auto_selected: true });
  }

  return c.json({ ok: true, entity_id: null, note: "Subentry created but entity didn't surface — refresh in a moment." });
});

api.get("/llm/create/schema", async (c) => {
  const entryId = c.req.query("entry_id");
  if (!entryId) return c.json({ error: "entry_id is required" }, 400);
  try {
    const step = await ha.startSubentryFlow(entryId, "ai_task_data");
    if (step.type !== "form") return c.json(step);
    return c.json({
      flow_id: step.flow_id,
      step_id: step.step_id,
      data_schema: step.data_schema,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ---- Enrich -----------------------------------------------------------------

api.get("/enrich/status", (c) => {
  return c.json(queueStatus(db));
});

api.post("/enrich/batch", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { n?: number } | null;
  let max = Number(body?.n ?? c.req.query("n") ?? 0);
  if (!Number.isFinite(max) || max <= 0) max = 5;
  max = Math.min(max, 50);

  const existing = getInFlightBatch();
  if (existing) {
    return c.json({
      error: `A batch of ${existing.max} is already running (started ${existing.startedAt}).`,
      inFlight: existing,
    }, 409);
  }

  if (!getSetting(db, "llm_entity_id")) {
    return c.json({ error: "No LLM selected — pick one on the LLM page first" }, 400);
  }

  setInFlightBatch({ startedAt: new Date().toISOString(), max });
  // eslint-disable-next-line no-console
  console.log(`[batch] kicked off n=${max}`);

  // Fire-and-forget — the HTTP handler returns immediately.
  void runBatch(db, ha, config.dataDir, { max, searchConfig: searchConfig() })
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(
        `[batch] done — ${r.succeeded}/${r.processed} ok, ${r.failed} failed, ${r.cacheHits} cache hit${r.cacheHits === 1 ? "" : "s"}`,
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[batch] error: ${(err as Error).message}`);
    })
    .finally(() => {
      setInFlightBatch(null);
    });

  return c.json({ ok: true, started: true, max });
});

api.get("/enrich/inflight", (c) => {
  return c.json({ inFlight: getInFlightBatch() });
});

// Single-asset enrich — AFTER /enrich/status and /enrich/batch
api.post("/enrich/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  try {
    const result = await enrichAsset(db, ha, config.dataDir, assetId, searchConfig());
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ---- Files (serve downloaded PDFs) ------------------------------------------

api.get("/files/:fileId", (c) => {
  const fileId = Number(c.req.param("fileId"));
  if (!Number.isFinite(fileId)) return c.notFound();
  const row = db
    .query<{ local_path: string; kind: string }, [number]>(
      "SELECT local_path, kind FROM asset_files WHERE id = ?",
    )
    .get(fileId);
  if (!row) return c.notFound();
  if (!existsSync(row.local_path)) {
    return c.text(`File missing on disk: ${row.local_path}`, 410);
  }
  const file = Bun.file(row.local_path);
  const bytes = statSync(row.local_path).size;
  return new Response(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes),
      "Content-Disposition": `inline; filename="${row.kind}.pdf"`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

app.route("/api", api);

// ===========================================================================
//   Static file serving + SPA catch-all
// ===========================================================================

// Serve built frontend assets (JS, CSS) with long-lived cache (hashed names).
app.use(
  "/static/*",
  serveStatic({
    root: STATIC_DIR,
    rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
  }),
);

// SPA catch-all: any route not handled above gets index.html with the
// HA Ingress path injected into a meta tag so the SPA can read it
// synchronously on boot.
let indexHtmlTemplate: string | null = null;

app.get("*", async (c) => {
  if (indexHtmlTemplate === null) {
    const indexPath = join(STATIC_DIR, "index.html");
    try {
      indexHtmlTemplate = await Bun.file(indexPath).text();
    } catch {
      return c.text("Frontend not built — run `bun run build` first.", 500);
    }
  }

  const ingress = c.req.header("x-ingress-path") ?? "";
  const html = indexHtmlTemplate.replace(
    '<meta name="ingress-path" content="" />',
    `<meta name="ingress-path" content="${ingress}" />`,
  );
  return c.html(html);
});

// ===========================================================================
//   Helpers
// ===========================================================================

function parsePriceCents(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.length === 0) return null;
  const n = Number.parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// ===========================================================================
//   Background sync
// ===========================================================================

async function runSync(reason: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[sync] triggered (${reason})`);
  const r = await syncFromHomeAssistant(db, ha);
  if (r.error) {
    // eslint-disable-next-line no-console
    console.error(`[sync] failed: ${r.error}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `[sync] ok: +${r.devicesAdded} added, ${r.devicesUpdated} updated, ${r.devicesHidden} hidden, ${r.areasUpserted} areas`,
    );
  }
}
queueMicrotask(() => void runSync("startup"));
setInterval(() => void runSync("interval"), SYNC_INTERVAL_MS);

async function runEnrichmentTick(): Promise<void> {
  const status = queueStatus(db);
  if (status.total_eligible === 0) return;
  try {
    const r = await runBatch(db, ha, config.dataDir, {
      max: ENRICH_BATCH_PER_TICK,
      searchConfig: searchConfig(),
    });
    if (r.skippedNoLlm) {
      // eslint-disable-next-line no-console
      console.log("[enrich] skipped tick — no LLM configured");
      return;
    }
    if (r.processed === 0) return;
    // eslint-disable-next-line no-console
    console.log(
      `[enrich] tick — ${r.succeeded}/${r.processed} ok, ${r.failed} failed, ${r.cacheHits} cache hit`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[enrich] tick error: ${(err as Error).message}`);
  }
}
// Give startup sync a head start, then start enriching.
setTimeout(() => void runEnrichmentTick(), 10_000);
setInterval(() => void runEnrichmentTick(), ENRICH_INTERVAL_MS);

// eslint-disable-next-line no-console
console.log(
  `[house-inventory] starting — mode=${config.mode} port=${config.port} data=${config.dataDir}`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
