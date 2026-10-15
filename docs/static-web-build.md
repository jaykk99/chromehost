# Monico Labs — static web build

The **primary web target**: a pure static build of Monico Labs. `vite build`
emits plain HTML/CSS/JS into `dist/` with **zero backend dependency** — no
server, no API calls, no keys. The built bundle was verified to contain no
`/api/` references at all.

## What runs where

| Feature | Static web build | Electron desktop companion |
|---|---|---|
| Sites — create, deploy, preview | ✅ in-page | ✅ (same UI, served locally) |
| Database | IndexedDB (this browser) | Embedded SQLite (`VORTEX_DATA_DIR/vortex.db`) |
| Publish public (IPFS) | ✅ in-browser Helia node | ✅ |
| Browser automation (Puppeteer) | ❌ desktop-only | ✅ |
| MCP server (stdio / SSE) | ❌ desktop-only | ✅ |
| Local preview server | n/a (iframe previews) | ✅ Express on loopback |

Node-only features **degrade honestly**: `src/lib/env.ts` detects the desktop
preload bridge (`window.vortex.isDesktop`) and the UI labels those features
"desktop app only" — they never crash and never fake availability.

## Storage model

Both builds share the **same data model** (`src/lib/model.ts`: Project /
Deployment / AppState) behind a storage interface (`StateStore`):

- **Browser** → `createIndexedDBStore()` — local, durable, per-browser.
- **Desktop backend** → embedded SQLite, same shape.
- **Tests** → `createMemoryStore()`.

## IPFS in the browser

"Publish public (IPFS)" runs entirely in the page: `src/lib/ipfs.ts`
lazy-loads Helia (code-split out of the initial bundle — it only downloads
when you publish), adds the site's HTML, returns the CID plus four public
gateway URLs, and warms gateway caches with best-effort range GETs in the
background without blocking publish.

Honest limits, shown in the UI:

- **Static HTML/CSS/JS only.** Anything needing a backend can't work this way.
- While the page is open, your browser is the provider. Gateways are asked to
  cache a copy so the link can survive the tab closing, but **permanent
  availability is not guaranteed without paid pinning** (not used here).
- First load of a fresh CID from a gateway can be slow.

## The self-hosting loop ("once online it hosts itself")

This page *is* the app, so the app can publish itself:

1. **Build once** on any machine: `npm run build` → `dist/`.
2. **Publish `dist/`** from the desktop app (directory publish via the
   desktop's IPFS tooling), or drag `dist/` into any static host.
3. From then on the app is online **and hosts itself**: every site you
   publish from it is just more static files.

No server or hoster is required at any step — that's the whole point.

## Supabase: the honest role

Cfd asked about Supabase explicitly. Supabase **cannot run Monico's backend**:
it offers Postgres + Deno Edge Functions + Storage — no Node.js, no Docker,
no persistent processes. Don't try to deploy the server there.

Its honest, optional roles:

- **(a) Free static file hosting** — drop `dist/` in a Supabase Storage
  *public* bucket and you have the app online on the free tier. This is the
  simplest "make it public" path after IPFS.
- **(b) Postgres for cloud sync** — set `VORTEX_DATABASE_URL` on the desktop
  backend and its database tools use your Supabase Postgres instead of the
  embedded SQLite.

Neither is required. The app is fully usable with neither.

## Chromebook

The static build needs nothing installed to *use* — open the published URL in
Chrome. To *build and publish* from a Chromebook: enable Linux (Crostini),
install Node 20, `npm ci && npm run build`, then publish `dist/` to IPFS from
the desktop app or upload it to a Supabase Storage public bucket.

## What's inherently impossible here

- Server-side logic (auth sessions, secrets, cron) — no server exists.
- Puppeteer automation from the page — browsers can't drive it.
- Inbound MCP connections in the browser — use the desktop app's stdio/SSE.
- Guaranteed-permanent public hosting without pinning — IPFS gateway caching
  is best-effort; paid pinning is the only guarantee and is not authorized.

## Verification

- `node --test tests/static-store.test.cjs` — IndexedDB adapter (via
  fake-indexeddb), memory adapter, model, feature flags.
- `node --test tests/static-ipfs.test.cjs` — gateway URL formatting, mocked
  cache warming, real in-process Helia publish → valid CID → local round-trip.
- `npx vite build` + static grep: bundle contains no `/api/` references.
- Real-browser boot test (headless Electron + Xvfb, no backend): page renders,
  IndexedDB badge shows, zero failed requests; full loop (create project →
  deploy → publish → reload-persist) verified end to end.
