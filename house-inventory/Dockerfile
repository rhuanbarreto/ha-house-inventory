# Declare all build args up front so they're visible to both stages and
# BuildKit doesn't complain about "undeclared" ARGs in later FROM lines.
# renovate: datasource=docker depName=oven/bun
ARG BUN_VERSION=1.3-alpine
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19

############################################################################
# Stage 1 — build a single-file native binary with Bun.
#
# `bun build --compile` embeds the Bun runtime + our bundled code into one
# executable. Build from Bun's official image so we don't spend build time
# installing Bun inside the HA base image. `--target=bun-linux-<arch>-musl`
# tells Bun to produce a binary for Alpine (musl), matching the HA runtime.
#
# TARGETARCH is auto-set by BuildKit (and by HA's supervisor builder) to
# "amd64" or "arm64". We translate it to Bun's target string so HA's own
# build just works without requiring per-arch build args.
############################################################################
FROM oven/bun:${BUN_VERSION} AS builder

ARG TARGETARCH

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY tsconfig.json ./
COPY src ./src

# Translate docker's TARGETARCH to Bun's --target argument, then compile.
# --minify trims bundle size; sourcemap kept outside the binary so stack
# traces in logs stay readable.
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
#
# HA's base gives us s6-overlay (process supervisor), bashio (option
# reading), proper signal handling, and the ingress plumbing. We only add
# ca-certificates (outbound HTTPS), libstdc++/libgcc (Bun's dependencies),
# and wget (powers HEALTHCHECK). Bun itself is baked into our binary, so
# no runtime installation is needed.
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

# Copy s6-overlay service + entrypoint shim.
COPY rootfs /
RUN chmod a+x /etc/services.d/house-inventory/run 2>/dev/null || true

# /data is HA's persistent, backup-included volume.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8099/healthz || exit 1
