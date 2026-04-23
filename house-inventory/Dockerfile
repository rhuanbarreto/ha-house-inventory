ARG BUILD_FROM
# hadolint ignore=DL3006
FROM ${BUILD_FROM}

# Bun needs bash + unzip for the installer, and ca-certificates for outbound HTTPS.
# hadolint ignore=DL3018
RUN apk add --no-cache bash curl unzip ca-certificates libstdc++

# Install Bun to a fixed prefix so PATH is stable across arches.
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=/usr/local/bun/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash -s -- --no-modify-path \
    && bun --version

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

# Copy source and pre-bundle.
COPY tsconfig.json ./
COPY src ./src
RUN bun build ./src/index.ts --target=bun --outdir=./dist --minify

# Copy s6-overlay service + entrypoint shim.
COPY rootfs /
RUN chmod a+x /etc/services.d/house-inventory/run 2>/dev/null || true

# /data is HA's persistent, backup-included volume.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8099/healthz || exit 1
