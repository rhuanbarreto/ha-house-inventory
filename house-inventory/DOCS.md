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
| `web_search_provider`   | `duckduckgo` (no key, default) or `brave` (needs API key below).                                            |
| `brave_search_api_key`  | Only used when `web_search_provider=brave`. Get a key at https://brave.com/search/api/.                     |

The AI Task used for enrichment is picked inside the add-on's web UI, not
via add-on options — entity IDs in HA are user-renameable, so we discover
them at runtime from the LLM page.

## How it works

1. On startup the add-on authenticates to the Home Assistant Core API using
   the `SUPERVISOR_TOKEN` injected by Home Assistant.
2. It pulls the device, entity, area, and floor registries over the WebSocket
   API and upserts them into `inventory.db`.
3. For each `(manufacturer, model)` pair seen for the first time, the
   enrichment worker searches the web (DuckDuckGo or Brave), then asks the
   configured AI Task to pick the best product page, support page, and manual
   URL. The PDF is downloaded into `/data/manuals/<asset_id>/`.
4. The UI — served via Home Assistant Ingress — lets you browse, edit, and
   add manual assets (anything not on HA).

## Security

This add-on requires:

- **`hassio_api`**: Access to the Supervisor API for add-on self-management.
- **`homeassistant_api`**: Access to the HA Core REST + WebSocket API for
  pulling the device/area/floor registries and calling AI Task services.
- **`hassio_role: default`**: The lowest privilege level — read-only info
  calls on the Supervisor API.

The add-on does **not** request host network access, privileged mode, or
write access to any HA volume other than its own `/data`. An AppArmor profile
is included to further restrict filesystem and network capabilities.

All network traffic is outbound only: to DuckDuckGo/Brave for web search,
to PDF hosts for manual downloads, and to the HA Core API over the internal
Supervisor network.

## Development

```sh
cd house-inventory
cp .env.example .env   # fill in HA_BASE_URL + HA_TOKEN
bun install
bun run dev
```

Then open `http://localhost:8099` to confirm the HA client pulls your
device registry.

### Docker testing

```sh
docker build -t local/house-inventory .
docker run --rm -v /tmp/house-inv-data:/data -p 8099:8099 \
  -e HA_BASE_URL=http://homeassistant.local:8123 \
  -e HA_TOKEN=your-long-lived-token \
  local/house-inventory
```

## Data location

| Path                        | Contents                                      |
| --------------------------- | --------------------------------------------- |
| `/data/inventory.db`        | SQLite — assets, links, files, sync log       |
| `/data/manuals/<id>/*.pdf`  | Downloaded manual PDFs                         |

Both are captured by Home Assistant's built-in backup mechanism.

## License

This add-on is licensed under the [MIT License](https://github.com/rhuanbarreto/ha-house-inventory/blob/main/LICENSE).
