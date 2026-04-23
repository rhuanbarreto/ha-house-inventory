# House Inventory

Track every physical asset in your house — the smart devices Home Assistant
already knows about, plus non-smart things (furniture, tools, a dumb fridge)
you add by hand. Each asset is auto-enriched with links to its product page,
support site, firmware page, and a downloaded copy of the manual PDF.

Everything lives on `/data`, so every Home Assistant backup contains your
entire inventory — database and manuals.

## Configuration

| Option                  | Description                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `log_level`             | `trace` · `debug` · `info` · `warning` · `error` · `fatal`                                                  |
| `ai_task_entity_id`     | Entity id of the AI Task backed by your OpenRouter (or any) conversation agent, e.g. `ai_task.openrouter`.  |
| `web_search_provider`   | `duckduckgo` (no key, default) or `brave` (needs API key below).                                            |
| `brave_search_api_key`  | Only used when `web_search_provider=brave`.                                                                 |

## How it works

1. On startup the add-on authenticates to the Home Assistant Core API using
   the `SUPERVISOR_TOKEN` injected by Home Assistant.
2. It pulls the device, entity, and area registries over the WebSocket API and
   upserts them into `inventory.db`.
3. For each `(manufacturer, model)` pair seen for the first time, the
   enrichment worker searches the web (DuckDuckGo or Brave), then asks the
   configured AI Task to pick the best product page, support page, and manual
   URL. The PDF is downloaded into `/data/manuals/<asset_id>/`.
4. The UI — served via Home Assistant Ingress — lets you browse, edit, and
   add manual assets (anything not on HA).

## Development

```sh
cd house-inventory
cp .env.example .env   # fill in HA_BASE_URL + HA_TOKEN
bun install
bun run dev
```

Then open `http://localhost:8099/devices` to confirm the HA client pulls your
device registry.

## Data location

| Path                        | Contents                                      |
| --------------------------- | --------------------------------------------- |
| `/data/inventory.db`        | SQLite — assets, links, files, sync log       |
| `/data/manuals/<id>/*.pdf`  | Downloaded manual PDFs                         |

Both are captured by Home Assistant's built-in backup mechanism.
