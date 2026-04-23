/**
 * House Inventory — entrypoint.
 *
 * Starts the HTTP server (served via HA Ingress in add-on mode) and schedules
 * periodic HA registry syncs. All persistent state lives under DATA_DIR.
 */

import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { HaClient } from "./ha-client.ts";

const config = loadConfig();
const ha = new HaClient(config);

const app = new Hono();

app.get("/healthz", (c) => c.text("ok"));

app.get("/", (c) =>
  c.html(
    `<!doctype html>
<html>
  <head><title>House Inventory</title></head>
  <body>
    <h1>House Inventory</h1>
    <p>Running in <strong>${config.mode}</strong> mode.</p>
    <p><a href="./devices">List HA devices (smoke test)</a></p>
  </body>
</html>`,
  ),
);

app.get("/devices", async (c) => {
  try {
    const snap = await ha.fetchRegistry();
    return c.json({
      fetchedAt: snap.fetchedAt,
      counts: {
        devices: snap.devices.length,
        areas: snap.areas.length,
        entities: snap.entities.length,
      },
      devices: snap.devices.map((d) => ({
        id: d.id,
        name: d.name_by_user ?? d.name,
        manufacturer: d.manufacturer,
        model: d.model,
        area_id: d.area_id,
      })),
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// eslint-disable-next-line no-console
console.log(
  `[house-inventory] starting — mode=${config.mode} port=${config.port} data=${config.dataDir}`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
