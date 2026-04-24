# House Inventory · Home Assistant add-on

[![Add repository to HA](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Frhuanbarreto%2Fha-house-inventory)

Track every physical asset in your house — smart devices imported from
Home Assistant, plus the not-so-smart stuff (furniture, tools, the dumb
fridge) you add by hand. Each asset is auto-enriched with links to its
product page, support site, and a downloaded copy of the manual PDF.

Everything lives on the add-on's `/data` volume, so every Home Assistant
backup contains your whole inventory — database and manual PDFs included.

> **Status:** early / v0.2. Works end-to-end on a Home Assistant Green
> against a 149-device registry. Expect rough edges; issues + PRs welcome.

---

## Features

- **Imports devices from Home Assistant** — devices, areas, floors via HA's
  WebSocket registry. Runs on startup and every 15 minutes. Survives HA
  devices being removed (soft-hidden with a reason, inventory data preserved).
- **Tracks non-HA assets** — a manual-entry form for sofas, drills, the
  ten-year-old fridge. Same detail view as HA devices.
- **LLM-driven enrichment** — searches DuckDuckGo (or Brave Search) for
  product pages and manuals, asks your configured Home Assistant AI Task (or
  any conversation agent) to pick the right URLs, downloads the manual PDF
  locally. Caches per model so 10 identical Netatmo modules cost one LLM call.
- **Per-brand URL seeds** — known brands (Apple, Roborock, Netatmo,
  Bosch, IKEA, Whisker, Google, Samsung, Xiaomi, Philips, Dyson, Miele)
  get authoritative portal URLs seeded into the candidate set to reduce
  blog-post / Amazon-listing noise.
- **Anti-hallucination validation** — URLs the LLM returns are rejected
  unless they appear in the candidate set OR on a trusted domain for that
  brand.
- **Bring your own LLM** — the add-on discovers your AI Tasks and
  conversation agents from HA. If no AI Task exists, it can create one
  on your existing LLM integration (e.g. OpenRouter) via the HA
  config-flow API. Which model runs the prompts is always your choice.
- **HA Ingress UI** — a sidebar page inside HA; no separate port to expose.

## Install

### One-click

[![Add repository to HA](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Frhuanbarreto%2Fha-house-inventory)

### Manual

1. In Home Assistant, open **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (top right) → **Repositories**.
3. Paste this URL: `https://github.com/rhuanbarreto/ha-house-inventory`
4. Close the dialog and refresh the store. A new section **HA House
   Inventory** appears with one card: **House Inventory**.
5. Click the card → **Install**. The Supervisor clones the repo and
   builds the Docker image on your HA host. This takes 5–10 minutes on
   a Home Assistant Green (aarch64 Bun binary compilation).
6. Turn on **Watchdog** and **Start on boot** if you want those.
   **Start**. Open the web UI from the sidebar.

### Local add-on (for development)

Copy `house-inventory/` into `/addons/` on your HA host (via the SSH or
Samba add-on). HA auto-discovers local add-ons under "Local add-ons" in
the store. Same Install → Start flow.

### First-run setup inside the UI

1. Open the web UI → Dashboard. Your devices sync automatically on
   startup.
2. Nav to **LLM**. Pick an existing AI Task, or use the "Create a new AI
   Task" form to create one on your existing LLM integration (OpenRouter,
   OpenAI, Anthropic, Google Generative AI — anything HA recognizes as
   `ai_task_data`-capable).
3. Back to the Dashboard → **Enrich 10** to burst-process. Background
   enrichment then ticks every 10 min in the background.

## Architecture

- **Runtime:** Bun compiled to a single static binary, copied into HA's
  Alpine base image. ~55 MB final image. No `node_modules` at runtime.
- **Frontend:** React 19 SPA with TanStack Router + TanStack Query,
  bundled by Bun and served as static files. Dark/light mode via
  `prefers-color-scheme`.
- **Backend:** Hono HTTP framework. JSON API at `/api/*`, SPA catch-all
  with HA Ingress path injection.
- **Storage:** SQLite at `/data/inventory.db`, manuals at
  `/data/manuals/<asset_id>/<sha-prefix>.pdf`. Both included in HA
  backups automatically.
- **Sync:** WebSocket to HA Core for `device_registry`, `area_registry`,
  `floor_registry`, `entity_registry`. Serial upserts in one transaction.
- **Auth:** `SUPERVISOR_TOKEN` injected by HA in add-on mode; bring your
  own long-lived token for local dev.

## Configuration

Add-on options (set from HA's UI):

| Option | Default | Description |
|---|---|---|
| `log_level` | `info` | `trace`, `debug`, `info`, `warning`, `error`, `fatal` |
| `web_search_provider` | `duckduckgo` | `duckduckgo` (no key) or `brave` (requires API key) |
| `brave_search_api_key` | `""` | Only used when `web_search_provider=brave` |

The AI Task used for enrichment is picked in the UI, not via options —
entity IDs in HA are user-renameable, so we discover them at runtime.

## Data

All runtime state lives on the add-on's private `/data` volume:

| Path | Contents |
|---|---|
| `/data/inventory.db` | SQLite — assets, links, files, sync log, enrichment cache |
| `/data/manuals/<asset_id>/*.pdf` | Downloaded manual PDFs |

HA's `/data` volume is **isolated per add-on** — our data doesn't mix
with HA Core's config, entity registry, or any other add-on. It is
however **included in HA snapshots** so our data rides along with HA's
own backups automatically.

## Development

```sh
cd house-inventory
cp .env.example .env   # set HA_BASE_URL + HA_TOKEN
bun install
bun run dev            # watcher
# or bun src/index.ts  # one-shot
```

Then open `http://localhost:8099`.

### Docker-based testing

```sh
cd house-inventory
docker build -t local/house-inventory .
docker run --rm -v /tmp/house-inv-data:/data -p 8099:8099 \
  -e HA_BASE_URL=http://homeassistant.local:8123 \
  -e HA_TOKEN=your-long-lived-token \
  local/house-inventory
```

### VS Code devcontainer

A `.devcontainer.json` is included at the repo root for the recommended
HA devcontainer workflow. Open the repo in VS Code, choose "Reopen in
Container", then run the "Start Home Assistant" task. The add-on appears
automatically in the Local Add-ons store at `http://localhost:7123`.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

Built on top of the work of many people, especially:

- [Home Assistant](https://home-assistant.io) and the add-on contributor
  community.
- [Bun](https://bun.sh) for making "ship a single static binary" a real thing.
- [Hono](https://hono.dev) for the HTTP layer.
- [TanStack](https://tanstack.com) for Router and Query.
- DuckDuckGo's HTML endpoint for being scraper-friendly.
