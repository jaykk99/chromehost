# Monico Labs — Electron desktop companion

The desktop app is the **companion** to the static web build: same UI, full
power. It runs the Monico backend (Express + MCP) on loopback and loads the
static UI from it, so Node-only features work: Puppeteer automation, the MCP
server (stdio for Claude Desktop-style clients, SSE over HTTP), and the
embedded SQLite database.

## How it works

- `electron/main.ts` — app entry. `--mcp-stdio` runs the backend in stdio
  passthrough mode (no window) for external MCP clients; otherwise it picks a
  free loopback port, spawns the backend, waits for it, and opens the window.
- `electron/backend-launcher.ts` — pure logic (no `electron` import, fully
  unit-tested): free-port picking, stable MCP token (`mcp-token` in userData),
  a scrubbed backend env (**no keys leak in** — only `PATH`, `PORT`,
  `VORTEX_HOST=127.0.0.1`, `VORTEX_DATA_DIR=<userData>`, `VRX_MCP_AUTH_TOKEN`),
  Chrome/Chromium resolution, stdio + HTTP launchers.
- `electron/preload.ts` — exposes `window.vortex = { isDesktop: true,
  platform }` so the static UI lights up the desktop-only features instead of
  showing "desktop app only".
- The backend serves the **same `dist/`** the static build produces — one UI
  codebase, two targets.

## Build & run

```bash
npm run build            # UI + server -> dist/
npm run build:electron   # electron/ -> dist-electron/ (CJS)
npm run desktop          # launch the app (dev)
npm run package:desktop  # electron-builder -> AppImage (best-effort)
```

Backend entry is `dist/server.cjs`; the launcher resolves it relative to
`dist-electron/`, so the packaged app just needs `dist/`,
`dist-electron/`, and `package.json` (see `electron/builder.json`).

## MCP stdio

```bash
electron dist-electron/main.cjs --mcp-stdio
```

Speaks JSON-RPC MCP on stdio — point any MCP client at it. The same binary
also answers over SSE at `http://127.0.0.1:<port>/api/mcp/sse` when the window
is open (token from the `mcp-token` file in the app's userData dir).

## Chromebook

Crostini Linux can't easily run Electron GUI apps — on a Chromebook prefer
the **static web build** (just open the published URL) or the Docker image.
The desktop app is for Mac/Windows/Linux machines.

## Verified

- `npx tsc -p tsconfig.electron.json` clean.
- `node --test tests/electron-launcher.test.cjs` — 7/7 (port binding, token
  stability + file perms, env scrubbing, arg parsing, Chrome resolution,
  backend entry path, HTTP wait).
- `npx electron --version` runs.
