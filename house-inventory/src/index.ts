/**
 * House Inventory — entrypoint.
 *
 * Responsibilities:
 *   - Open the SQLite DB (and run migrations) at DATA_DIR/inventory.db
 *   - Expose an HTTP API for the UI / HA Ingress
 *   - Run an initial HA sync on boot, then every SYNC_INTERVAL_MS
 */

import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { HaClient } from "./ha-client.ts";
import { openDatabase } from "./db.ts";
import { syncFromHomeAssistant } from "./sync.ts";
import { clearSetting, getSetting, setSetting } from "./settings.ts";
import { enrichAsset } from "./enrich.ts";

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const config = loadConfig();
const ha = new HaClient(config);
const db = openDatabase(config.dataDir);

const app = new Hono();

app.get("/healthz", (c) => c.text("ok"));

app.get("/", (c) => {
  const totals = db
    .query<
      { total: number; visible: number; hidden: number; areas: number },
      []
    >(
      `SELECT
         (SELECT COUNT(*) FROM assets)             AS total,
         (SELECT COUNT(*) FROM assets WHERE hidden=0) AS visible,
         (SELECT COUNT(*) FROM assets WHERE hidden=1) AS hidden,
         (SELECT COUNT(*) FROM areas)              AS areas`,
    )
    .get();
  const lastSync = db
    .query<
      { started_at: string; finished_at: string | null; error: string | null },
      []
    >(
      "SELECT started_at, finished_at, error FROM ha_sync_log ORDER BY id DESC LIMIT 1",
    )
    .get();
  const llm = getSetting(db, "llm_entity_id");
  return c.html(
    `<!doctype html>
<html>
  <head><title>House Inventory</title></head>
  <body>
    <h1>House Inventory</h1>
    <p>Mode: <strong>${config.mode}</strong></p>
    <h2>Totals</h2>
    <ul>
      <li>Assets: ${totals?.total ?? 0} (visible: ${totals?.visible ?? 0}, hidden: ${totals?.hidden ?? 0})</li>
      <li>Areas: ${totals?.areas ?? 0}</li>
    </ul>
    <h2>Last sync</h2>
    <p>${lastSync ? `${lastSync.started_at} → ${lastSync.finished_at ?? "in progress"} ${lastSync.error ? `(error: ${lastSync.error})` : "(ok)"}` : "never"}</p>
    <h2>LLM for enrichment</h2>
    <p>${llm ? `Selected: <code>${llm}</code>` : `Not configured — <a href="./llm">pick one</a>`}</p>
    <p><a href="./assets">Browse assets (JSON)</a> · <a href="./assets?hidden=1">Hidden assets</a> · <a href="./llm">Discover LLM entities</a> · <a href="./sync" data-method="post">POST /sync</a></p>
  </body>
</html>`,
  );
});

app.get("/assets", (c) => {
  const showHidden = c.req.query("hidden") === "1";
  const areaFilter = c.req.query("area");
  const whereParts: string[] = [];
  const params: (string | number)[] = [];
  whereParts.push(`hidden = ${showHidden ? 1 : 0}`);
  if (areaFilter) {
    whereParts.push("area_id = ?");
    params.push(areaFilter);
  }
  const rows = db
    .query<
      {
        id: string;
        name: string;
        manufacturer: string | null;
        model: string | null;
        area_id: string | null;
        source: string;
        hidden: number;
        hidden_reason: string | null;
      },
      (string | number)[]
    >(
      `SELECT id, name, manufacturer, model, area_id, source, hidden, hidden_reason
       FROM assets
       WHERE ${whereParts.join(" AND ")}
       ORDER BY COALESCE(manufacturer, ''), COALESCE(model, ''), name`,
    )
    .all(...params);
  return c.json({ count: rows.length, assets: rows });
});

app.post("/sync", async (c) => {
  const result = await syncFromHomeAssistant(db, ha);
  return c.json(result, result.error ? 500 : 200);
});

app.get("/sync/history", (c) => {
  const rows = db
    .query(
      "SELECT * FROM ha_sync_log ORDER BY id DESC LIMIT 20",
    )
    .all();
  return c.json(rows);
});

// ---- LLM discovery + selection ---------------------------------------------

app.get("/llm", async (c) => {
  try {
    const discovered = await ha.discoverLlmEntities();
    const current = getSetting(db, "llm_entity_id");
    const aiTasks = discovered.filter((e) => e.kind === "ai_task");
    const conversationAgents = discovered.filter(
      (e) => e.kind === "conversation",
    );
    return c.json({
      current,
      discovered,
      counts: {
        ai_tasks: aiTasks.length,
        conversation_agents: conversationAgents.length,
      },
      // Prefer an AI Task if exactly one exists and nothing is selected yet.
      autoSelectable:
        current === null && aiTasks.length === 1
          ? (aiTasks[0]?.entity_id ?? null)
          : null,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.put("/settings/llm", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    entity_id?: string;
  } | null;
  const id = body?.entity_id;
  if (!id) {
    return c.json({ error: "entity_id is required" }, 400);
  }

  // Validate against what HA currently reports — stops stale/typo-ed IDs.
  const discovered = await ha.discoverLlmEntities();
  const match = discovered.find((e) => e.entity_id === id);
  if (!match) {
    return c.json(
      {
        error: `entity_id not found in HA: ${id}`,
        available: discovered.map((e) => e.entity_id),
      },
      404,
    );
  }
  setSetting(db, "llm_entity_id", id);
  return c.json({ ok: true, entity_id: id, kind: match.kind });
});

app.delete("/settings/llm", (c) => {
  clearSetting(db, "llm_entity_id");
  return c.json({ ok: true });
});

// ---- AI Task creation ------------------------------------------------------

/**
 * List HA integrations that can have an AI Task created on them.
 * A GET form so the UI can populate a dropdown before POSTing /llm/create.
 */
app.get("/llm/creatable", async (c) => {
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

/**
 * Inspect the first step of the create flow for a given integration.
 * Returns the form schema so the UI knows which options to collect.
 */
app.get("/llm/create/schema", async (c) => {
  const entryId = c.req.query("entry_id");
  if (!entryId) return c.json({ error: "entry_id is required" }, 400);
  try {
    const step = await ha.startSubentryFlow(entryId, "ai_task_data");
    if (step.type !== "form") {
      // Non-form response on step 1 is unusual — surface as-is so callers
      // can decide. Flow is left dangling; HA will time it out.
      return c.json(step);
    }
    return c.json({
      flow_id: step.flow_id,
      step_id: step.step_id,
      data_schema: step.data_schema,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

/**
 * Create an AI Task subentry on the given integration.
 *
 * Body: { entry_id: string, options: Record<string, unknown> }
 *
 * We drive the subentry flow forward step-by-step, feeding the same `options`
 * object to every form step. Each integration's AI Task flow is typically
 * one form, but we loop to be safe.
 */
app.post("/llm/create", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    entry_id?: string;
    options?: Record<string, unknown>;
  } | null;
  if (!body?.entry_id) {
    return c.json({ error: "entry_id is required" }, 400);
  }
  const options = body.options ?? {};

  const entitiesBefore = new Set(
    (await ha.discoverLlmEntities())
      .filter((e) => e.kind === "ai_task")
      .map((e) => e.entity_id),
  );

  let step = await ha.startSubentryFlow(body.entry_id, "ai_task_data");
  const maxSteps = 5;
  let count = 0;

  while (step.type === "form" && count < maxSteps) {
    count++;
    step = await ha.submitSubentryFlow(step.flow_id, options);
  }

  if (step.type === "form") {
    await ha.cancelSubentryFlow(step.flow_id);
    return c.json(
      { error: "AI Task creation needed too many steps — aborted" },
      500,
    );
  }

  if (step.type === "abort") {
    return c.json(
      { error: `AI Task creation aborted: ${step.reason}` },
      400,
    );
  }

  // Entities are registered asynchronously after the subentry is created —
  // poll briefly for the new ai_task.* entity to appear.
  let newEntityId: string | null = null;
  for (let i = 0; i < 10; i++) {
    const after = await ha.discoverLlmEntities();
    const newAiTask = after.find(
      (e) => e.kind === "ai_task" && !entitiesBefore.has(e.entity_id),
    );
    if (newAiTask) {
      newEntityId = newAiTask.entity_id;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (newEntityId) {
    setSetting(db, "llm_entity_id", newEntityId);
    return c.json({
      ok: true,
      entity_id: newEntityId,
      auto_selected: true,
    });
  }

  return c.json({
    ok: true,
    entity_id: null,
    note: "Subentry created but new entity didn't surface in time — re-discover via /llm.",
  });
});

// ---- enrichment ------------------------------------------------------------

app.post("/enrich/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  try {
    const result = await enrichAsset(db, ha, config.dataDir, assetId);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get("/assets/:assetId", (c) => {
  const assetId = c.req.param("assetId");
  const asset = db
    .query(
      "SELECT * FROM assets WHERE id = ?",
    )
    .get(assetId);
  if (!asset) return c.json({ error: "not found" }, 404);
  const links = db
    .query(
      "SELECT kind, url, title, fetched_at FROM asset_links WHERE asset_id = ? ORDER BY kind",
    )
    .all(assetId);
  const files = db
    .query(
      "SELECT kind, local_path, sha256, bytes, downloaded_at FROM asset_files WHERE asset_id = ?",
    )
    .all(assetId);
  return c.json({ asset, links, files });
});

// ---- background sync -------------------------------------------------------
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

// Run once on boot (don't block startup), then on an interval.
queueMicrotask(() => void runSync("startup"));
setInterval(() => void runSync("interval"), SYNC_INTERVAL_MS);

// eslint-disable-next-line no-console
console.log(
  `[house-inventory] starting — mode=${config.mode} port=${config.port} data=${config.dataDir}`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
