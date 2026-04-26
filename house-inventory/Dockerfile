# Declare all build args up front so they're visible to both stages and
# BuildKit doesn't complain about "undeclared" ARGs in later FROM lines.
# renovate: datasource=docker depName=oven/bun
ARG BUN_VERSION=1.3-alpine@sha256:4de475389889577f346c636f956b42a5c31501b654664e9ae5726f94d7bb5349
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.23@sha256:93d485d81c81fcc69ee13e981d11e97b0191e5d2f9f5d5e4c5e60a6a81300bd0

############################################################################
# Stage 1 — build the React SPA frontend + compile the backend binary.
#
# 1. `bun run scripts/build.ts` bundles the React SPA into dist/static/.
# 2. `bun build --compile` embeds the Bun runtime + backend into one binary.
#
# The SPA is served as static files from a known path; the backend binary
# does not embed them.
############################################################################
FROM oven/bun:${BUN_VERSION} AS builder

ARG TARGETARCH

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY tsconfig.json tsconfig.frontend.json ./
COPY icon.png ./
COPY scripts ./scripts
COPY src ./src

# 1. Build the React SPA frontend
RUN bun run scripts/build.ts

# 2. Compile the backend binary
RUN set -e; \
    case "${TARGETARCH:-amd64}" in \
      amd64) BUN_TARGET=bun-linux-x64-musl ;; \
      arm64) BUN_TARGET=bun-linux-arm64-musl ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2 && exit 1 ;; \
    esac; \
    bun build ./src/index.ts \
      --compile \
      --minify \
      --target="${BUN_TARGET}" \
      --outfile=house-inventory

############################################################################
# Stage 2 — run inside the Home Assistant base image.
############################################################################
# hadolint ignore=DL3006
FROM ${BUILD_FROM}

# hadolint ignore=DL3018
RUN apk add --no-cache \
    ca-certificates \
    libstdc++ \
    libgcc \
    wget

# Drop the compiled binary in a stable path.
COPY --from=builder /app/house-inventory /usr/local/bin/house-inventory

# Copy the built SPA static files.
COPY --from=builder /app/dist/static /usr/local/share/house-inventory/static

# Copy s6-overlay service + entrypoint shim.
COPY rootfs /
RUN chmod a+x /etc/services.d/house-inventory/run 2>/dev/null || true

# /data is HA's persistent, backup-included volume.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099 \
    STATIC_DIR=/usr/local/share/house-inventory/static

LABEL \
  io.hass.name="House Inventory" \
  io.hass.description="Track house assets with auto-enriched manuals." \
  io.hass.type="addon" \
  io.hass.arch="aarch64|amd64" \
  org.opencontainers.image.title="House Inventory" \
  org.opencontainers.image.description="Track house assets with auto-enriched manuals." \
  org.opencontainers.image.source="https://github.com/rhuanbarreto/ha-house-inventory" \
  org.opencontainers.image.licenses="MIT"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8099/healthz || exit 1
