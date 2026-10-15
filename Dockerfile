# Monico Labs — server image (SECONDARY artifact).
#
# The primary targets are the static web build (dist/, needs no server) and
# the Electron desktop app. This image is for anyone who wants the full
# backend (embedded SQLite, MCP server, Puppeteer automation, local preview
# serving) on a machine or host of their own.
#
# Build:  docker build -t monico-labs .
# Run:    docker run -d -p 3000:3000 -v monico-data:/data --name monico monico-labs
#
# The SQLite database lives at /data/vortex.db — the named volume is what
# makes it survive container restarts. Without the volume, data is ephemeral.
#
# Optional env (all genuinely optional — zero-key boot is the default):
#   -e VRX_MCP_AUTH_TOKEN=<stable token>  # default: generated per boot, printed in logs
#   -e VORTEX_DATABASE_URL=<postgres>     # default: embedded SQLite at /data/vortex.db
#   -e ENABLE_TUNNEL=true                 # default: off; exposes localhost via localtunnel
#   -e GEMINI_API_KEY=...                 # default: unset; AI features degrade honestly

# node:22+ is REQUIRED: server/vortex-sqlite.ts imports the built-in
# `node:sqlite` module, which does not exist on node:20 (boot crashes with
# ERR_MODULE_NOT_FOUND). On node 22 it is behind --experimental-sqlite;
# node:22-slim (bookworm) is used instead of node:24-slim so the Chromium
# apt package names below stay valid.
FROM node:22-slim

# Install Chromium and all deps needed for headless Chrome (no download at runtime).
# Build tools for native modules (better-sqlite3 falls back to source build
# when no prebuilt binary matches the platform)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    chromium \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    fonts-liberation \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_OPTIONS=--experimental-sqlite

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Cloud hosts inject PORT automatically; default to 3000.
ENV NODE_ENV=production \
    PORT=3000 \
    VORTEX_HOST=0.0.0.0 \
    VORTEX_DATA_DIR=/data

# Persistent volume for the embedded SQLite database.
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
