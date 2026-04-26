# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.3] — 2026-04-26

### Added

- Test suite with 48 tests across 5 files covering filters, brand-seeds,
  enrichment URL validation, DB migrations, and exponential backoff logic (#24).
- MdiIcon component mapping common `mdi:*` icon names to inline SVGs and
  AreaCard component for area tiles (#25).
- oxlint with `react-perf` plugin and oxfmt for consistent code formatting;
  CI verify job running format check, lint, typecheck, and build (#25).
- Favicon support — `icon.png` copied into static build output with
  `<link rel="icon">` and `<link rel="apple-touch-icon">` (#26).
- Automated release workflow with simple-release-action for Conventional
  Commits-based version bumping (#26).
- PR title linting with commitlint to validate Conventional Commits
  format before merge (#32).
- CSS type declaration (`css.d.ts`) for TypeScript 6 compatibility (#37).

### Changed

- Areas page is now the default route (`/`) instead of Dashboard;
  Dashboard moved to `/dashboard` (#26).
- Redesigned areas page from table layout to responsive HA-style card
  grid matching Home Assistant's areas view (#25).
- Replaced all 48 inline `style={{}}` violations with CSS classes in
  `app.css` (#25).
- Replaced flat 6 h enrichment backoff with exponential backoff based on
  per-asset `enrichment_attempts` (6 h → 12 h → 24 h → … capped at
  8 d) (#24).
- Updated TypeScript to v6 (#37).
- Updated `ghcr.io/home-assistant/amd64-base` Docker tag to v3.23 (#38).
- Updated github-actions to latest major versions (#39).
- Pinned dependencies (#33, #34, #35, #36).

### Fixed

- Release workflow HTTP 403 by adding `actions: write` permission (#27).
- CI dispatch step crash (HTTP 422) when simple-release didn't create a
  release branch — now guards against both empty and `"null"` ref
  values (#31).

### Removed

- Dead lazy-import declarations and abandoned `rootRoute` from
  `router.tsx` (#24).

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
