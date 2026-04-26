# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] — 2026-04-26

### Added

- Test suite: unit tests for database layer, enrichment backoff, enrichment
  validation, brand seeds, and filter logic.
- Progressive enrichment backoff — assets that repeatedly fail enrichment are
  retried with increasing delays instead of blocking the queue.

### Changed

- Redesigned areas page as an HA-style card grid grouped by floor, with
  per-area asset and enrichment counts.
- Areas is now the default landing page.
- Added favicon for browser tabs and bookmarks.
- Simplified release workflow: replaced simple-release/conventional-commits
  with a version-driven pipeline that reads from `config.yaml`.

### Fixed

- Dead code cleanup across enrichment and sync modules.

## [0.2.2] — 2025-04-25

### Fixed

- Addon restart loop: replaced `export default { fetch, port }` with
  explicit `Bun.serve()` bound to `0.0.0.0`. The auto-serve pattern could
  bind to localhost in compiled binaries, making the Supervisor watchdog
  unable to reach `/healthz`, which triggered a restart every ~30 seconds.
- Removed overly restrictive custom AppArmor profile that was blocking
  s6-overlay shutdown (`exec /init: exec format error`, `/bin/sh: Permission
  denied`). The addon now uses Docker's default AppArmor profile until a
  properly tested custom profile is authored.

## [0.2.1] — 2025-04-25

### Fixed

- Release workflow was missing `BUILD_FROM` build-arg, causing aarch64
  Docker images to use the amd64 base image. This produced
  `exec /init: exec format error` on ARM devices (Raspberry Pi, HA Green).

### Added

- Archgate governance with 6 ADRs covering architecture, backend, and
  frontend conventions, plus 4 automated compliance rules.
- `archgate check` CI job using `archgate/check-action@v1` — runs ADR
  compliance checks on every PR with inline annotations.
- Branch ruleset on `main` requiring all CI checks to pass before merge.

## [0.2.0] — unreleased

### Added

- React 19 SPA frontend with TanStack Router + TanStack Query, replacing
  the original server-rendered HTML + HTMX proof of concept.
- Dashboard page with sync stats, LLM status, and enrichment progress bar.
- Asset list with search, area filter, and hidden toggle.
- Asset detail page with facts, enrichment links, downloaded files, and
  inline edit form.
- Manual asset creation form (for non-HA items like furniture, tools).
- Areas page grouped by floor with per-area asset and enrichment counts.
- LLM picker page: select existing AI Tasks / conversation agents, or
  create a new AI Task from an existing LLM integration.
- Batch enrichment: enrich 3 or 10 assets at once, with background
  auto-enrichment every 10 minutes.
- Per-brand URL seeds for 13 brands (Apple, Roborock, Netatmo, Bosch,
  IKEA, Whisker, Google, Samsung, Xiaomi, Philips, Dyson, Miele).
- Anti-hallucination URL validation — LLM-returned URLs are rejected
  unless they appear in the search candidate set or on a trusted domain.
- Enrichment cache keyed by (manufacturer, model) with 30-day TTL.
- PDF manual download with magic-byte verification and SHA-256 dedup.
- Floor registry sync from HA (floor groupings for areas).
- Brave Search support as an alternative to DuckDuckGo.
- HA Supervisor watchdog integration for auto-restart on crash.
- AppArmor security profile.
- Translation files for add-on configuration UI.
- VS Code devcontainer support for local HA development.
- `my.home-assistant.io` one-click install badge in README.
- Ingress auth header forwarding (user ID, name, display name).

### Changed

- Bumped version to 0.2.0.
- Removed deprecated `build.yaml`; OCI labels now live in the Dockerfile.
- Set minimum Home Assistant version to 2025.7.0 (required for AI Tasks).
- Added `backup_exclude` for transient SQLite WAL/SHM files.
- Docker timeout increased to 30s for slower devices.

### Fixed

- `log_level` schema had `info` listed twice and inconsistent `notice`/`fatal`
  values.
- Area column in asset list now shows human-readable area names instead
  of raw area IDs.
- WebSocket URL construction now uses the documented HA path in add-on mode.

## [0.1.0] — 2025-04-23

### Added

- Initial scaffold.
- Home Assistant add-on manifest (amd64 + aarch64).
- Bun + TypeScript app skeleton with Hono HTTP server.
- Dual-mode HA client (Supervisor token in-add-on, long-lived token in dev).
- Device registry sync endpoint.
