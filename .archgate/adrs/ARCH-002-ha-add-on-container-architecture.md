---
id: ARCH-002
title: HA Add-on Container Architecture
domain: architecture
rules: true
files:
  - "house-inventory/Dockerfile"
  - "house-inventory/config.yaml"
  - "house-inventory/rootfs/**"
  - ".github/workflows/release.yml"
  - ".github/workflows/build.yml"
---

# HA Add-on Container Architecture

## Context

House Inventory is distributed as a Home Assistant add-on — a Docker container managed by the HA Supervisor. Users install it on diverse hardware: Raspberry Pi 4/5 (aarch64), Home Assistant Green (aarch64), Intel NUCs (amd64), and generic x86 servers. The container architecture must satisfy the HA add-on contract (base images, init system, volume layout, ingress) while keeping the image small and the build reproducible across architectures.

Without a standardized container architecture, the project risks:

1. **Architecture mismatch at runtime** — if the runtime stage uses a base image compiled for the wrong CPU architecture, the s6-overlay `/init` binary cannot execute, producing `exec /init: exec format error`. This bug occurred in production when the release workflow failed to pass `BUILD_FROM` for the aarch64 build, silently defaulting to the amd64 base image.
2. **Data loss on updates** — storing state outside the `/data` volume means it is wiped on every container rebuild. SQLite databases, downloaded PDFs, and user settings would vanish.
3. **Backup exclusion** — HA snapshots automatically include `/data` but nothing else. Persistent state stored elsewhere is not backed up.
4. **Ingress breakage** — exposing ports directly instead of using HA's Ingress proxy breaks the sidebar integration and bypasses HA's authentication layer.
5. **Init system conflicts** — using `init: true` in `config.yaml` when the HA base image already provides s6-overlay can cause duplicate init processes or service management failures.

### Alternatives Considered

- **Single-stage Dockerfile**: Simpler but ships `node_modules`, build tools, and source files in the final image. Unacceptable for image size on ARM devices with slow SD-card storage.
- **Distroless / scratch base image**: Would produce the smallest possible image, but HA's Supervisor requires the HA base image (`ghcr.io/home-assistant/{arch}-base`) for s6-overlay, `bashio`, and the service discovery contract. Using a non-HA base breaks the add-on lifecycle.
- **Multi-arch manifest (single image tag)**: Docker supports multi-arch manifests that select the correct image per platform automatically. HA's Supervisor does not use this — it explicitly pulls `{arch}-{slug}:{version}` images, so separate per-architecture tags are mandatory.
- **Custom init system (e.g., tini)**: The HA base image bundles s6-overlay as the init system. Adding another init creates conflicts. Setting `init: false` in `config.yaml` delegates to s6-overlay's own service management, which is the HA-documented approach.

For House Inventory, the multi-stage Docker build with architecture-specific HA base images is the only pattern that satisfies all constraints: small final image (~55 MB), correct init system, HA backup integration, and multi-arch support.

This decision builds on [ARCH-001 — Tech Stack and Runtime](./ARCH-001-tech-stack-and-runtime.md), which mandates Bun as the runtime and defines the `bun build --compile` step that produces the static binary copied into the runtime stage.

## Decision

The add-on container MUST use a **multi-stage Dockerfile** with an architecture-specific **Home Assistant base image** as the runtime stage. All persistent state MUST reside on the **`/data` volume**. The add-on MUST serve its UI via **HA Ingress** and MUST NOT expose ports directly. The `config.yaml` MUST set `init: false` to delegate to the HA base image's s6-overlay.

### Scope

This ADR covers:
- The Dockerfile structure (stages, base images, build arguments)
- The `config.yaml` fields that define the add-on contract with HA Supervisor
- The s6-overlay service definition in `rootfs/`
- The data persistence model (`/data` volume)
- The health check and watchdog configuration
- CI workflow requirements for multi-arch builds

This ADR does NOT cover:
- The Bun runtime or TypeScript compilation (see [ARCH-001](./ARCH-001-tech-stack-and-runtime.md))
- The CI/CD pipeline structure beyond build-arg requirements (see ARCH-003)
- The backend API routes or framework (see BE-001)

### Dockerfile: Multi-Stage Build

The Dockerfile MUST have exactly two stages:

1. **Builder stage** (`FROM oven/bun:${BUN_VERSION} AS builder`): Installs dependencies, builds the React SPA, and compiles the backend into a single static binary via `bun build --compile`. This stage is architecture-aware via Docker's `TARGETARCH` build argument.

2. **Runtime stage** (`FROM ${BUILD_FROM}`): Uses the HA base image passed via the `BUILD_FROM` build argument. Copies only the compiled binary and built static files from the builder stage. Installs minimal runtime dependencies (`ca-certificates`, `libstdc++`, `libgcc`, `wget`). Copies the s6-overlay service definition from `rootfs/`.

The `BUILD_FROM` argument MUST default to an amd64 base image for local development convenience, but CI workflows MUST always override it with the architecture-specific image:
- amd64: `ghcr.io/home-assistant/amd64-base:3.19`
- aarch64: `ghcr.io/home-assistant/aarch64-base:3.19`

### config.yaml: Add-on Contract

The `config.yaml` file defines the contract with HA Supervisor. Key mandatory fields:

- `arch: [amd64, aarch64]` — supported architectures
- `init: false` — delegates to s6-overlay from the HA base image
- `ingress: true` with `ingress_port: 8099` — UI served via HA sidebar
- `hassio_api: true` — enables `SUPERVISOR_TOKEN` injection for Supervisor API access
- `homeassistant_api: true` — enables Core API access (WebSocket registry, service calls)
- `watchdog: http://[HOST]:[PORT:8099]/healthz` — Supervisor auto-restarts on health failure
- `image: ghcr.io/{owner}/ha-house-inventory/{arch}-house-inventory` — GHCR image template
- `backup_exclude: ["*.db-shm", "*.db-wal"]` — excludes transient SQLite WAL files from snapshots

### Data Persistence: /data Volume

All runtime state MUST live on the `/data` volume:
- `DATA_DIR=/data` environment variable
- SQLite database: `/data/inventory.db`
- Downloaded manual PDFs: `/data/manuals/<asset_id>/<sha-prefix>.pdf`

The `/data` volume is implicit in HA add-ons (no `map` entry needed), isolated per add-on, and automatically included in HA snapshots/backups.

### s6-overlay Service

The service script at `rootfs/etc/services.d/house-inventory/run` MUST:
- Use `#!/usr/bin/with-contenv bashio` shebang for HA environment injection
- Export add-on options as environment variables via `bashio::config`
- Set `HA_BASE_URL`, `HA_TOKEN`, and `HA_MODE` for the backend
- Execute the compiled binary via `exec /usr/local/bin/house-inventory`

### Health Check

The Dockerfile MUST include a `HEALTHCHECK` instruction targeting the `/healthz` endpoint. The `config.yaml` `watchdog` field provides a second layer of health monitoring at the Supervisor level.

## Do's and Don'ts

### Do

- **DO** use the `BUILD_FROM` ARG for the runtime stage's `FROM` instruction. The runtime stage MUST be `FROM ${BUILD_FROM}`, never a hardcoded image reference.
- **DO** pass `BUILD_FROM` as a `build-args` entry in every CI workflow job that builds Docker images. Each architecture matrix entry MUST include a `base` field mapping to the correct HA base image.
- **DO** store all persistent runtime state (database, downloaded files, settings) under `/data`. This is the only volume that survives container updates and is included in HA backups.
- **DO** set `init: false` in `config.yaml`. The HA base image provides s6-overlay; setting `init: true` would conflict with it.
- **DO** include a `HEALTHCHECK` instruction in the Dockerfile and a matching `watchdog` URL in `config.yaml` pointing to the `/healthz` endpoint.
- **DO** use `bashio::config` in the s6-overlay run script to read add-on options and export them as environment variables.
- **DO** exclude transient SQLite files (`*.db-shm`, `*.db-wal`) from backups via `backup_exclude` in `config.yaml`.
- **DO** include HA-required labels (`io.hass.name`, `io.hass.type`, `io.hass.arch`) in the Dockerfile.
- **DO** use `ingress: true` in `config.yaml` to serve the UI inside HA's sidebar with built-in authentication.

### Don't

- **DON'T** hardcode an HA base image in the runtime stage's `FROM` line (e.g., `FROM ghcr.io/home-assistant/amd64-base:3.19`). Always use `FROM ${BUILD_FROM}`. Hardcoding causes `exec /init: exec format error` on non-matching architectures.
- **DON'T** store persistent data outside `/data`. Files written to `/tmp`, `/var`, or any other path are ephemeral and lost on container restart or update.
- **DON'T** expose ports via `ports` in `config.yaml`. The add-on UI MUST be served through HA Ingress, which handles authentication and path prefixing automatically.
- **DON'T** set `init: true` in `config.yaml`. The HA base image already provides s6-overlay as the init system; enabling HA's init on top of it creates conflicts.
- **DON'T** omit `BUILD_FROM` from CI workflow `build-args`. The Dockerfile default (`amd64-base`) exists only for local `docker build` convenience — CI MUST always be explicit.
- **DON'T** ship `node_modules`, source files, or build tools in the runtime stage. The multi-stage build MUST copy only the compiled binary and built static assets.
- **DON'T** use a non-HA base image (e.g., `alpine:3.19`, `debian:bookworm`) for the runtime stage. The HA Supervisor expects its own base images for s6-overlay, `bashio`, and service lifecycle management.

## Consequences

### Positive

- **Multi-arch correctness:** Parameterizing the base image via `BUILD_FROM` ensures each architecture gets the correct s6-overlay binaries, eliminating the `exec format error` class of bugs.
- **Small image size:** The multi-stage build produces a ~55 MB final image containing only the compiled binary, static assets, and Alpine system packages — no `node_modules` or build tools.
- **Automatic backups:** All persistent state on `/data` is included in HA snapshots automatically. Users get database and manual PDF backups without any configuration.
- **Sidebar integration:** HA Ingress serves the UI inside the HA sidebar with built-in authentication. No separate port, no manual auth configuration.
- **Auto-recovery:** The `HEALTHCHECK` + `watchdog` combination provides two layers of automatic restart: Docker-level health checks and Supervisor-level watchdog monitoring.
- **Reproducible builds:** Pinning the Bun version (`ARG BUN_VERSION`) and HA base image version (`3.19`) in the Dockerfile ensures consistent builds across CI runs.
- **Backup hygiene:** Excluding `*.db-shm` and `*.db-wal` from backups prevents corrupt SQLite restore scenarios where WAL files are from a different point in time than the database.

### Negative

- **Build complexity:** Multi-stage Dockerfiles with build arguments and architecture matrices are harder to understand and debug than a simple single-stage build.
- **CI matrix duplication:** The architecture-to-base-image mapping must be maintained in both `build.yml` and `release.yml`. Forgetting one (as happened with the `BUILD_FROM` bug) breaks a specific architecture silently.
- **HA base image coupling:** The project is tightly coupled to HA's base image versioning. A breaking change in the HA base image (e.g., s6-overlay upgrade) requires a coordinated update.
- **No direct access for debugging:** Ingress-only access means there is no direct port to connect to for debugging in production. Developers must use `docker exec` or the HA SSH add-on.

### Risks

- **HA base image deprecation:** Home Assistant may change their base image structure, naming convention, or init system. **Mitigation:** Pin the base image version (`:3.19`) and update deliberately. Monitor the [HA developer blog](https://developers.home-assistant.io/blog) for deprecation notices. The `BUILD_FROM` pattern makes swapping base images a one-line change per architecture.
- **Silent architecture mismatch in CI:** If a new CI workflow or matrix entry omits `BUILD_FROM`, the default (`amd64-base`) is used, producing a broken image for aarch64 that only fails at runtime. **Mitigation:** The companion Archgate rule (`dockerfile-build-from`) checks that the Dockerfile runtime stage uses `${BUILD_FROM}`. The CI/CD ADR (ARCH-003) will enforce that workflow matrices include a `base` field.
- **SQLite corruption on unclean shutdown:** If s6-overlay kills the process without a graceful shutdown, SQLite WAL mode may leave the database in a state that requires recovery. **Mitigation:** WAL mode with `synchronous=NORMAL` provides crash safety for committed transactions. The `backup_exclude` for WAL/SHM files ensures backups contain only the main database file, which is always consistent.

## Implementation Pattern

### Dockerfile Structure

```dockerfile
# Build args declared at the top for both stages
ARG BUN_VERSION=1.3-alpine
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19

# Stage 1: Build
FROM oven/bun:${BUN_VERSION} AS builder
ARG TARGETARCH
# ... build steps ...

# Stage 2: Runtime — MUST use BUILD_FROM, never a hardcoded image
FROM ${BUILD_FROM}
# ... copy artifacts only, install minimal runtime deps ...
```

### CI Workflow Matrix (Required Pattern)

```yaml
matrix:
  include:
    - arch: amd64
      platform: linux/amd64
      base: ghcr.io/home-assistant/amd64-base:3.19
    - arch: aarch64
      platform: linux/arm64
      base: ghcr.io/home-assistant/aarch64-base:3.19
# ...
build-args: |
  BUILD_FROM=${{ matrix.base }}
```

### s6-overlay Service Script

```bash
#!/usr/bin/with-contenv bashio
set -e
bashio::log.info "Starting House Inventory..."
export LOG_LEVEL="$(bashio::config 'log_level')"
export HA_BASE_URL="http://supervisor/core"
export HA_TOKEN="${SUPERVISOR_TOKEN}"
export HA_MODE="addon"
exec /usr/local/bin/house-inventory
```

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule `dockerfile-build-from`:** Verifies the Dockerfile runtime stage uses `FROM ${BUILD_FROM}` (not a hardcoded HA base image). Runs on every `archgate check`.
- **Archgate rule `config-init-false`:** Verifies `config.yaml` contains `init: false`. Runs on every `archgate check`.
- **Docker build in CI:** Both `build.yml` and `release.yml` build images for amd64 and aarch64. A missing `BUILD_FROM` defaults to amd64, which fails on aarch64 hardware — CI catches this if the aarch64 build is tested (QEMU cross-build).

### Manual Enforcement

- **Code review for workflow changes:** Any PR modifying `.github/workflows/*.yml` MUST be checked for correct `BUILD_FROM` / `build-args` in every matrix entry.
- **Code review for Dockerfile changes:** Reviewers MUST verify that the runtime stage `FROM` uses `${BUILD_FROM}` and that no persistent data paths point outside `/data`.
- **Code review for config.yaml changes:** Reviewers MUST verify that `init: false`, `ingress: true`, and `hassio_api: true` are preserved.

### Exceptions

Any deviation from the HA add-on container contract (e.g., adding a `ports` mapping for a secondary service) MUST be approved by the project maintainer, documented as a separate ADR, and tested on both amd64 and aarch64 hardware.

## References

- [ARCH-001 — Tech Stack and Runtime](./ARCH-001-tech-stack-and-runtime.md)
- [Home Assistant Add-on Configuration](https://developers.home-assistant.io/docs/add-ons/configuration)
- [Home Assistant Add-on Presentation](https://developers.home-assistant.io/docs/add-ons/presentation)
- [Home Assistant Base Images (GitHub)](https://github.com/home-assistant/docker-base)
- [s6-overlay documentation](https://github.com/just-containers/s6-overlay)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
