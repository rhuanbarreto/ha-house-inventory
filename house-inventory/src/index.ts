/**
 * House Inventory — entrypoint.
 *
 * Two surfaces on one Hono app:
 *   - `/api/*`  JSON endpoints (scripting / HA automations / internal UI)
 *   - top-level HTML pages for humans (dashboard, assets, LLM picker).
 *
 * All mutating actions go through `/api/*` and either respond with JSON
 * (Accept: application/json) or redirect back to an HTML page with a
 * `?flash=<kind>:<text>` query param so the user sees the result.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { loadConfig } from "./config.ts";
import { HaClient } from "./ha-client.ts";
import { openDatabase } from "./db.ts";
import { syncFromHomeAssistant } from "./sync.ts";
import { clearSetting, getSetting, setSetting } from "./settings.ts";
import { enrichAsset } from "./enrich.ts";
import { queueStatus, runBatch } from "./enrich-batch.ts";
import { renderDashboard } from "./ui/dashboard.ts";
import {
  renderAssetDetail,
  renderAssetList,
  renderNewAssetForm,
} from "./ui/assets.ts";
import { renderLlmPage } from "./ui/llm.ts";
import { renderAreasPage } from "./ui/areas.ts";
import { escapeHtml } from "./ui/layout.ts";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** How often the background enrichment tick fires. */
const ENRICH_INTERVAL_MS = 10 * 60 * 1000; // 10 min
/** Assets processed per scheduled tick. Kept small to avoid bursting the LLM. */
const ENRICH_BATCH_PER_TICK = 3;

const config = loadConfig();
const ha = new HaClient(config);
const db = openDatabase(config.dataDir);

const app = new Hono();

// ===========================================================================
//   HTML pages
// ===========================================================================

/**
 * Compute the base URL for relative links on a page.
 * Dev: "/". Behind HA Ingress: `${X-Ingress-Path}/` so the browser resolves
 * relative URLs to the ingress-prefixed path (ingress strips the prefix
 * again on the way in, so our routes stay at /, /assets, /api/*, etc.).
 */
function baseHrefFor(c: Context): string {
  const ingress = c.req.header("x-ingress-path");
  if (ingress && ingress.length > 0) {
    return ingress.endsWith("/") ? ingress : `${ingress}/`;
  }
  return "/";
}

app.get("/", (c) =>
  c.html(renderDashboard(db, config, c.req.query("flash"), baseHrefFor(c))),
);

app.get("/assets", (c) =>
  c.html(
    renderAssetList(
      db,
      {
        q: c.req.query("q"),
        area: c.req.query("area"),
        hidden: c.req.query("hidden") as "0" | "1" | undefined,
      },
      c.req.query("flash"),
      baseHrefFor(c),
    ),
  ),
);

app.get("/assets/new", (c) =>
  c.html(renderNewAssetForm(db, c.req.query("flash"), baseHrefFor(c))),
);

app.get("/assets/:id", (c) => {
  const html = renderAssetDetail(
    db,
    c.req.param("id"),
    c.req.query("flash"),
    baseHrefFor(c),
  );
  if (!html) return c.notFound();
  return c.html(html);
});

app.get("/areas", (c) =>
  c.html(renderAreasPage(db, c.req.query("flash"), baseHrefFor(c))),
);

app.get("/llm", async (c) => {
  const html = await renderLlmPage(db, ha, c.req.query("flash"), baseHrefFor(c));
  return c.html(html);
});

// ---- Health (kept at root for container health checks) --------------------
app.get("/healthz", (c) => c.text("ok"));

// ===========================================================================
//   /api — JSON + form handlers
// ===========================================================================

const api = new Hono();

// ---- Assets list + detail (JSON) ------------------------------------------

api.get("/assets", (c) => {
  const showHidden = c.req.query("hidden") === "1";
  const where: string[] = [`hidden = ${showHidden ? 1 : 0}`];
  const params: (string | number)[] = [];
  const area = c.req.query("area");
  if (area) {
    where.push("area_id = ?");
    params.push(area);
  }
  const rows = db
    .query(
      `SELECT id, name, manufacturer, model, area_id, source, hidden, hidden_reason
       FROM assets
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(manufacturer,''), COALESCE(model,''), name`,
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

// ---- Create manual asset --------------------------------------------------

api.post("/assets", async (c) => {
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  if (name.length === 0) {
    return redirectWithFlash(c, "/assets/new", "err:Name is required");
  }

  const manufacturer = strOrNull(form.get("manufacturer"));
  const model = strOrNull(form.get("model"));
  const category = strOrNull(form.get("category"));
  const areaId = strOrNull(form.get("area_id"));
  const purchaseDate = strOrNull(form.get("purchase_date"));
  const warrantyUntil = strOrNull(form.get("warranty_until"));
  const notes = strOrNull(form.get("notes"));
  const priceCents = parsePriceCents(form.get("purchase_price"));

  const id = `manual_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO assets (
       id, source, ha_device_id, name, manufacturer, model, area_id,
       category, purchase_date, purchase_price_cents, warranty_until, notes,
       hidden, hidden_reason, created_at, updated_at, last_seen_at
     ) VALUES (?, 'manual', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    [
      id,
      name,
      manufacturer,
      model,
      areaId,
      category,
      purchaseDate,
      priceCents,
      warrantyUntil,
      notes,
      now,
      now,
      now,
    ],
  );

  return redirectWithFlash(c, `/assets/${id}`, `ok:Created ${name}`);
});

api.post("/assets/:id/edit", async (c) => {
  const assetId = c.req.param("id");
  const form = await c.req.formData();
  const exists = db
    .query<{ id: string }, [string]>("SELECT id FROM assets WHERE id = ?")
    .get(assetId);
  if (!exists) return c.json({ error: "not found" }, 404);

  const category = strOrNull(form.get("category"));
  const areaId = strOrNull(form.get("area_id"));
  const purchaseDate = strOrNull(form.get("purchase_date"));
  const warrantyUntil = strOrNull(form.get("warranty_until"));
  const notes = strOrNull(form.get("notes"));
  const priceCents = parsePriceCents(form.get("purchase_price"));

  db.run(
    `UPDATE assets SET
       category=?, area_id=?, purchase_date=?, purchase_price_cents=?,
       warranty_until=?, notes=?, updated_at=?
     WHERE id=?`,
    [
      category,
      areaId,
      purchaseDate,
      priceCents,
      warrantyUntil,
      notes,
      new Date().toISOString(),
      assetId,
    ],
  );
  return redirectWithFlash(c, `/assets/${assetId}`, "ok:Saved");
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
    [
      next,
      next === 1 ? "manual_hide" : null,
      new Date().toISOString(),
      assetId,
    ],
  );
  return redirectWithFlash(
    c,
    `/assets/${assetId}`,
    next === 1 ? "ok:Hidden" : "ok:Unhidden",
  );
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
    return redirectWithFlash(
      c,
      `/assets/${assetId}`,
      "err:Only manual assets can be deleted",
    );
  }
  db.run("DELETE FROM assets WHERE id = ?", [assetId]);
  return redirectWithFlash(c, "/assets", `ok:Deleted ${row.name}`);
});

// ---- Sync ------------------------------------------------------------------

api.post("/sync", async (c) => {
  const result = await syncFromHomeAssistant(db, ha);
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("application/json")) {
    return c.json(result, result.error ? 500 : 200);
  }
  return redirectWithFlash(
    c,
    "/",
    result.error
      ? `err:Sync failed — ${result.error}`
      : `ok:Synced — +${result.devicesAdded} added, ${result.devicesUpdated} updated`,
  );
});

api.get("/sync/history", (c) => {
  const rows = db
    .query("SELECT * FROM ha_sync_log ORDER BY id DESC LIMIT 20")
    .all();
  return c.json(rows);
});

// ---- LLM -------------------------------------------------------------------

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

api.post("/settings/llm", async (c) => {
  const form = await c.req.formData();
  const id = String(form.get("entity_id") ?? "").trim();
  if (!id) {
    return redirectWithFlash(c, "/llm", "err:entity_id is required");
  }
  const discovered = await ha.discoverLlmEntities();
  const match = discovered.find((e) => e.entity_id === id);
  if (!match) {
    return redirectWithFlash(c, "/llm", `err:Not found in HA: ${id}`);
  }
  setSetting(db, "llm_entity_id", id);
  return redirectWithFlash(c, "/llm", `ok:Selected ${id}`);
});

api.post("/settings/llm/clear", (c) => {
  clearSetting(db, "llm_entity_id");
  return redirectWithFlash(c, "/llm", "ok:Cleared");
});

// Legacy JSON handlers kept for scripting.
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
  const isForm =
    (c.req.header("content-type") ?? "").startsWith(
      "application/x-www-form-urlencoded",
    ) ||
    (c.req.header("content-type") ?? "").startsWith("multipart/form-data");

  let entryId: string | undefined;
  let options: Record<string, unknown> = {};
  if (isForm) {
    const form = await c.req.formData();
    entryId = String(form.get("entry_id") ?? "").trim();
    const model = String(form.get("model") ?? "").trim();
    if (model) options["model"] = model;
  } else {
    const body = (await c.req.json().catch(() => null)) as {
      entry_id?: string;
      options?: Record<string, unknown>;
    } | null;
    entryId = body?.entry_id;
    options = body?.options ?? {};
  }

  if (!entryId) {
    if (isForm) return redirectWithFlash(c, "/llm", "err:entry_id required");
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
    const msg = "Creation needed too many steps — aborted";
    if (isForm) return redirectWithFlash(c, "/llm", `err:${msg}`);
    return c.json({ error: msg }, 500);
  }
  if (step.type === "abort") {
    const msg = `Aborted: ${step.reason}`;
    if (isForm) return redirectWithFlash(c, "/llm", `err:${msg}`);
    return c.json({ error: msg }, 400);
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
    if (isForm) {
      return redirectWithFlash(c, "/llm", `ok:Created ${newEntityId}`);
    }
    return c.json({ ok: true, entity_id: newEntityId, auto_selected: true });
  }

  const msg =
    "Subentry created but entity didn't surface — refresh /llm in a moment.";
  if (isForm) return redirectWithFlash(c, "/llm", `info:${msg}`);
  return c.json({ ok: true, entity_id: null, note: msg });
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

// ---- Enrich ---------------------------------------------------------------
//
// Route order matters: the specific paths (/enrich/status, /enrich/batch)
// MUST come before /enrich/:assetId, otherwise Hono matches the wildcard
// first and treats "batch" / "status" as asset ids.

api.get("/enrich/status", (c) => {
  return c.json(queueStatus(db));
});

api.post("/enrich/batch", async (c) => {
  const accept = c.req.header("accept") ?? "";

  // Accept `n` from query (GET-ish POST) or form body.
  let max = Number(c.req.query("n") ?? "0");
  if (!Number.isFinite(max) || max <= 0) {
    const ct = c.req.header("content-type") ?? "";
    if (ct.startsWith("application/x-www-form-urlencoded") || ct.startsWith("multipart/form-data")) {
      const form = await c.req.formData().catch(() => null);
      const fromForm = Number(form?.get("n") ?? "0");
      if (Number.isFinite(fromForm) && fromForm > 0) max = fromForm;
    }
  }
  if (!Number.isFinite(max) || max <= 0) max = 5;
  max = Math.min(max, 50);

  const result = await runBatch(db, ha, config.dataDir, { max });
  if (accept.includes("application/json")) return c.json(result);

  if (result.skippedNoLlm) {
    return redirectWithFlash(c, "/", "err:No LLM selected — pick one on the LLM page first");
  }
  return redirectWithFlash(
    c,
    "/",
    `ok:Batch — ${result.succeeded} ok, ${result.failed} failed, ${result.cacheHits} cache hit${result.cacheHits === 1 ? "" : "s"}`,
  );
});

// Single-asset enrich — defined AFTER the specific /enrich/status and
// /enrich/batch routes so the wildcard doesn't eat them.
api.post("/enrich/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const accept = c.req.header("accept") ?? "";
  try {
    const result = await enrichAsset(db, ha, config.dataDir, assetId);
    if (accept.includes("application/json")) return c.json(result);
    const linkCount = Object.values(result.links).filter(
      (v) => typeof v === "string",
    ).length;
    return redirectWithFlash(
      c,
      `/assets/${assetId}`,
      `ok:Enriched (${result.cache}) — ${linkCount} links${result.manual_downloaded ? ", manual PDF saved" : ""}`,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (accept.includes("application/json"))
      return c.json({ error: msg }, 500);
    return redirectWithFlash(c, `/assets/${assetId}`, `err:${msg}`);
  }
});

// ---- Files (serve downloaded PDFs) -----------------------------------------

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
//   Helpers
// ===========================================================================

// FormData values can be strings or File. For our inputs they're all strings,
// but TypeScript wants us to narrow rather than assume.
type FormValue = string | File | null;

function strOrNull(v: FormValue): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function parsePriceCents(v: FormValue): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s.length === 0) return null;
  const n = Number.parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function redirectWithFlash(c: Context, path: string, flash: string): Response {
  // Under HA Ingress, the browser's URL includes a prefix like
  // /api/hassio_ingress/<token>/ that we need to preserve in the Location
  // header — otherwise a Location of "/llm" escapes the ingress scope and
  // 404s. X-Ingress-Path is the prefix HA injects; empty in dev.
  const prefix = (c.req.header("x-ingress-path") ?? "").replace(/\/$/, "");
  const url = `${prefix}${path}?flash=${encodeURIComponent(flash)}`;
  return c.redirect(url, 303);
}

// `escapeHtml` is imported only so tooling picks up the intent — UI modules
// use it directly. Suppress "unused import" warnings.
void escapeHtml;

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
