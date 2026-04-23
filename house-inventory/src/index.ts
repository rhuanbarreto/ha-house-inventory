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
    <p><a href="./assets">Browse assets (JSON)</a> · <a href="./assets?hidden=1">Hidden assets</a> · <a href="./sync" data-method="post">POST /sync</a></p>
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
