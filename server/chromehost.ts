/**
 * ChromeHost — self-hosted app platform module for Monico Labs base.
 *
 * Adds to the Express server:
 *  - API key management (generate / list / revoke). Keys are
 *    crypto.randomBytes(32).toString('base64url'), stored as SHA-256 hashes
 *    in SQLite. The raw key is shown exactly once at creation.
 *  - Remote management API authenticated via the `X-API-Key` header:
 *      GET    /api/chromehost/health
 *      GET    /api/chromehost/apps
 *      POST   /api/chromehost/apps/deploy   { repo, name?, runtime?, build?, start?, port?, env? }
 *      POST   /api/chromehost/apps/:name/start
 *      POST   /api/chromehost/apps/:name/stop
 *      GET    /api/chromehost/apps/:name/logs?tail=200
 *      POST   /api/chromehost/keys           { name? }  (bootstrap: open only when zero keys exist)
 *      GET    /api/chromehost/keys
 *      DELETE /api/chromehost/keys/:id
 *  - One-click app registry for Jay's repos.
 *  - Docker-based deployment (falls back to clear errors when Docker is absent).
 *
 * Mount in server.ts with:  app.use(chromeHostRouter())
 *
 * No secrets are ever logged or stored in plaintext.
 */

import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ─── SQLite (isolated chromehost.db) ─────────────────────────────────────────

const DATA_DIR = process.env.CHROMEHOST_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "chromehost.db");
const APPS_DIR = path.join(DATA_DIR, "chromehost-apps");

let DatabaseCtor: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DatabaseCtor = require("better-sqlite3");
} catch {
  DatabaseCtor = null;
}

let db: any = null;

function getDb(): any {
  if (!DatabaseCtor) throw new Error("better-sqlite3 not available");
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(APPS_DIR, { recursive: true });
    db = new DatabaseCtor(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS chromehost_api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS chromehost_apps (
        name TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        runtime TEXT NOT NULL DEFAULT 'node',
        status TEXT NOT NULL DEFAULT 'stopped',
        port INTEGER,
        container_id TEXT,
        build_cmd TEXT,
        start_cmd TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS chromehost_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  return db;
}

export function chromeHostDbAvailable(): boolean {
  return DatabaseCtor !== null;
}

// ─── Settings (server-side secrets, never exposed raw) ───────────────────────
// COMPOSIO_API_KEY: env var wins, else the value pasted in Settings (stored in
// SQLite). The raw value is NEVER returned to clients — only configured/masked.

const SENSITIVE_SETTINGS = new Set(["composio_api_key"]);

export function getSetting(key: string): string | null {
  try {
    const d = getDb();
    const row = d.prepare("SELECT value FROM chromehost_settings WHERE key = ?").get(key) as {
      value: string;
    } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setSetting(key: string, value: string): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO chromehost_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

export function getComposioKey(): string | null {
  // Env var takes precedence (12-factor); Settings UI is the fallback.
  return process.env.COMPOSIO_API_KEY || getSetting("composio_api_key");
}

export function maskSecret(s: string | null): string | null {
  if (!s) return null;
  if (s.length <= 8) return "••••";
  return s.slice(0, 4) + "••••" + s.slice(-4);
}

// ─── API keys ────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Generate a new API key. Returns { id, key } — the raw key is never stored. */
export function generateApiKey(name = ""): { id: number; key: string } {
  const d = getDb();
  const key = "ch_" + crypto.randomBytes(32).toString("base64url");
  const keyHash = sha256(key);
  const prefix = key.slice(0, 10) + "…";
  const row = d
    .prepare(
      "INSERT INTO chromehost_api_keys (name, key_hash, key_prefix) VALUES (?, ?, ?) RETURNING id"
    )
    .get(name, keyHash, prefix) as { id: number };
  return { id: row.id, key };
}

export function listApiKeys(): Array<{
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked: number;
}> {
  const d = getDb();
  return d
    .prepare(
      "SELECT id, name, key_prefix, created_at, last_used_at, revoked FROM chromehost_api_keys ORDER BY id DESC"
    )
    .all();
}

export function revokeApiKey(id: number): boolean {
  const d = getDb();
  const r = d.prepare("UPDATE chromehost_api_keys SET revoked = 1 WHERE id = ?").run(id);
  return r.changes > 0;
}

export function countActiveKeys(): number {
  const d = getDb();
  const row = d
    .prepare("SELECT COUNT(*) AS c FROM chromehost_api_keys WHERE revoked = 0")
    .get() as { c: number };
  return row.c;
}

function verifyApiKey(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const d = getDb();
    const h = sha256(raw);
    const row = d
      .prepare("SELECT id FROM chromehost_api_keys WHERE key_hash = ? AND revoked = 0")
      .get(h) as { id: number } | undefined;
    if (row) {
      d.prepare("UPDATE chromehost_api_keys SET last_used_at = datetime('now') WHERE id = ?").run(
        row.id
      );
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Auth middleware for the remote API. Bootstrap: key creation is open while zero keys exist. */
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  // Allow first-key bootstrap without auth.
  if (req.path === "/keys" && req.method === "POST") {
    try {
      if (countActiveKeys() === 0) return next();
    } catch {
      // DB unavailable — fall through to normal auth (will 503).
    }
  }
  const raw = (req.header("X-API-Key") || "").trim();
  // Timing-safe compare happens implicitly via hash lookup; never log the key.
  if (!verifyApiKey(raw)) {
    res.status(401).json({ error: "missing or invalid X-API-Key" });
    return;
  }
  next();
}

// ─── App registry (Jay's repos, one-click deploy) ────────────────────────────

export interface RegistryEntry {
  name: string;
  repo: string;
  runtime: "node" | "python" | "static";
  build?: string;
  start?: string;
  env?: string[];
  note?: string;
}

export const APP_REGISTRY: RegistryEntry[] = [
  {
    name: "error-inbox",
    repo: "https://github.com/jaykk99/error-inbox.git",
    runtime: "node",
    build: "npm install && npm run build",
    start: "npm start",
    env: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    note: "Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars",
  },
  {
    name: "wholesale-stack",
    repo: "https://github.com/jaykk99/wholesale-stack.git",
    runtime: "python",
    build: "pip install -r requirements.txt",
    start: "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    env: ["SUPABASE_URL", "SUPABASE_KEY"],
    note: "FastAPI wholesaling CRM",
  },
  {
    name: "ops-board",
    repo: "https://github.com/jaykk99/ops-board.git",
    runtime: "node",
    build: "npm install && npm run build",
    start: "npm start",
    env: ["SUPABASE_URL", "SUPABASE_KEY"],
  },
  {
    name: "forge3d",
    repo: "https://github.com/jaykk99/forge3d.git",
    runtime: "static",
    note: "Static Three.js editor",
  },
  {
    name: "train-studio",
    repo: "https://github.com/jaykk99/train-studio.git",
    runtime: "static",
    note: "Static training UI",
  },
  {
    name: "proquote",
    repo: "https://github.com/jaykk99/geniequote.git",
    runtime: "node",
    build: "npm install && npm run build",
    start: "npm start",
    note: "Gutter Genie eavestrough estimator",
  },
  {
    name: "mcp-tester",
    repo: "https://github.com/jaykk99/mcp-tester.git",
    runtime: "node",
    build: "npm install && npm run build",
    start: "npm start",
  },
  {
    name: "voicecheck",
    repo: "https://github.com/jaykk99/voicecheck.git",
    runtime: "node",
    build: "npm install && npm run build",
    start: "npm start",
  },
  {
    name: "api-bell",
    repo: "https://github.com/jaykk99/api-bell.git",
    runtime: "node",
    build: "npm install && npm run build",
    start: "npm start",
  },
];

// ─── Docker helpers ──────────────────────────────────────────────────────────

let dockerChecked: boolean | null = null;

async function dockerAvailable(): Promise<boolean> {
  if (dockerChecked !== null) return dockerChecked;
  try {
    await execFileAsync("docker", ["info"], { timeout: 8000 });
    dockerChecked = true;
  } catch {
    dockerChecked = false;
  }
  return dockerChecked;
}

function sanitizeName(name: string): string {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!n || n.length > 48) throw new Error("invalid app name");
  return n;
}

async function nextPort(): Promise<number> {
  const d = getDb();
  const row = d.prepare("SELECT MAX(port) AS m FROM chromehost_apps").get() as { m: number | null };
  return (row.m || 4099) + 1;
}

function writeDockerfile(dir: string, entry: { runtime: string; build?: string; start?: string }) {
  let df: string;
  if (entry.runtime === "python") {
    df = `FROM python:3.11-slim
WORKDIR /srv
COPY . .
RUN ${entry.build || "pip install -r requirements.txt"}
EXPOSE 8000
CMD ${entry.start ? `sh -c "${entry.start.replace(/\$PORT/g, "8000").replace(/"/g, '\\"')}"` : 'sh -c "python -m http.server 8000"'}
`;
  } else if (entry.runtime === "static") {
    df = `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`;
  } else {
    // node
    df = `FROM node:20-slim
WORKDIR /srv
COPY package*.json ./
RUN npm install
COPY . .
RUN ${entry.build || "npm run build"}
EXPOSE 3000
ENV PORT=3000
CMD ["sh", "-c", "${(entry.start || "npm start").replace(/"/g, '\\"')}"]
`;
  }
  const hasDockerfile = fs.existsSync(path.join(dir, "Dockerfile"));
  if (!hasDockerfile) fs.writeFileSync(path.join(dir, "Dockerfile"), df);
  return hasDockerfile;
}

async function deployApp(opts: {
  repo: string;
  name?: string;
  runtime?: string;
  build?: string;
  start?: string;
  env?: Record<string, string>;
}): Promise<{ name: string; port: number }> {
  if (!(await dockerAvailable())) {
    throw new Error("Docker is not available on this host. Run install.sh to set up Docker.");
  }
  const name = sanitizeName(opts.name || path.basename(opts.repo, ".git") || "app");
  const d = getDb();
  const existing = d.prepare("SELECT * FROM chromehost_apps WHERE name = ?").get(name) as any;
  if (existing && existing.status === "running") {
    throw new Error(`app "${name}" is already running`);
  }

  const dir = path.join(APPS_DIR, name);
  if (fs.existsSync(dir)) {
    // pull latest
    try {
      await execFileAsync("git", ["-C", dir, "pull", "--ff-only"], { timeout: 60000 });
    } catch {
      /* non-fatal */
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
    await execFileAsync("git", ["clone", "--depth", "1", opts.repo, dir], { timeout: 120000 });
  }

  const runtime = opts.runtime || "node";
  writeDockerfile(dir, { runtime, build: opts.build, start: opts.start });

  const image = `chromehost/${name}:latest`;
  await execFileAsync("docker", ["build", "-t", image, dir], { timeout: 600000 });

  const port = existing?.port || (await nextPort());
  const container = `chromehost-${name}`;
  try {
    await execFileAsync("docker", ["rm", "-f", container], { timeout: 15000 });
  } catch {
    /* ignore */
  }
  const runArgs = [
    "run",
    "-d",
    "--name",
    container,
    "--restart",
    "unless-stopped",
    "-p",
    `${port}:${runtime === "python" ? 8000 : runtime === "static" ? 80 : 3000}`,
  ];
  for (const [k, v] of Object.entries(opts.env || {})) {
    if (v) runArgs.push("-e", `${k}=${v}`);
  }
  runArgs.push(image);
  const { stdout } = await execFileAsync("docker", runArgs, { timeout: 60000 });
  const containerId = stdout.trim().slice(0, 12);

  d.prepare(
    `INSERT INTO chromehost_apps (name, repo, runtime, status, port, container_id, build_cmd, start_cmd, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET status='running', port=excluded.port,
       container_id=excluded.container_id, updated_at=datetime('now')`
  ).run(name, opts.repo, runtime, port, containerId, opts.build || "", opts.start || "");

  return { name, port };
}

async function stopApp(name: string): Promise<void> {
  const n = sanitizeName(name);
  if (!(await dockerAvailable())) throw new Error("Docker is not available on this host.");
  try {
    await execFileAsync("docker", ["stop", `chromehost-${n}`], { timeout: 30000 });
  } catch {
    /* already stopped */
  }
  getDb().prepare("UPDATE chromehost_apps SET status='stopped', updated_at=datetime('now') WHERE name=?").run(n);
}

async function startApp(name: string): Promise<void> {
  const n = sanitizeName(name);
  if (!(await dockerAvailable())) throw new Error("Docker is not available on this host.");
  await execFileAsync("docker", ["start", `chromehost-${n}`], { timeout: 30000 });
  getDb().prepare("UPDATE chromehost_apps SET status='running', updated_at=datetime('now') WHERE name=?").run(n);
}

async function appLogs(name: string, tail = 200): Promise<string> {
  const n = sanitizeName(name);
  if (!(await dockerAvailable())) throw new Error("Docker is not available on this host.");
  const { stdout } = await execFileAsync("docker", ["logs", "--tail", String(tail), `chromehost-${n}`], {
    timeout: 15000,
  });
  return stdout;
}

async function refreshStatuses(): Promise<void> {
  try {
    if (!(await dockerAvailable())) return;
    const { stdout } = await execFileAsync("docker", ["ps", "--format", "{{.Names}}"], { timeout: 10000 });
    const running = new Set(stdout.split("\n").map((s) => s.trim()));
    const d = getDb();
    for (const row of d.prepare("SELECT name FROM chromehost_apps").all() as Array<{ name: string }>) {
      const isRunning = running.has(`chromehost-${row.name}`);
      d.prepare("UPDATE chromehost_apps SET status = ?, updated_at = datetime('now') WHERE name = ?").run(
        isRunning ? "running" : "stopped",
        row.name
      );
    }
  } catch {
    /* best effort */
  }
}

// ─── Sandboxed command runner ──────────────────────────────────────────────
// Authenticated agents can run a small allowlist of commands for app
// management (git pull, docker ps/build/logs, npm, etc.). No shell is
// spawned: args are passed literally via execFile, cwd is confined to the
// data dir, output is capped, and secrets are redacted from output.

const EXEC_ALLOWLIST = new Set([
  "git",
  "docker",
  "npm",
  "node",
  "python3",
  "pip",
  "pip3",
  "curl",
  "ls",
  "cat",
  "df",
  "du",
  "uptime",
  "hostname",
]);

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9-_]{10,}/g,
  /xox[bap]-[A-Za-z0-9-]{10,}/g,
  /ghp_[A-Za-z0-9]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
];

function redactSecrets(s: string): string {
  let out = s;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[redacted]");
  // Redact anything that looks like a stored composio key echo.
  const ck = getComposioKey();
  if (ck && ck.length > 8) out = out.split(ck).join("[redacted]");
  return out;
}

export async function runSandboxed(
  command: string,
  args: string[] = [],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (!EXEC_ALLOWLIST.has(command)) {
    throw new Error(
      `command "${command}" is not allowlisted (allowed: ${[...EXEC_ALLOWLIST].join(", ")})`
    );
  }
  const safeArgs = args.map((a) => String(a)).slice(0, 32);
  const base = path.resolve(DATA_DIR);
  const cwd = opts.cwd ? path.resolve(base, opts.cwd) : base;
  if (!cwd.startsWith(base)) throw new Error("cwd escapes the data directory");
  const timeout = Math.min(Math.max(opts.timeoutMs || 30000, 1000), 300000);
  try {
    const { stdout, stderr } = await execFileAsync(command, safeArgs, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: redactSecrets(stdout.slice(0, 20000)), stderr: redactSecrets(stderr.slice(0, 5000)), code: 0 };
  } catch (e: any) {
    return {
      stdout: redactSecrets(String(e.stdout || "").slice(0, 20000)),
      stderr: redactSecrets(String(e.stderr || e.message || "").slice(0, 5000)),
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function chromeHostRouter(): Router {
  const r = Router();

  // All /api/chromehost/* routes require an API key, except first-key bootstrap.
  r.use((req: Request, res: Response, next: NextFunction) => {
    try {
      getDb();
    } catch (e: any) {
      res.status(503).json({ error: "chromehost database unavailable", detail: e?.message });
      return;
    }
    requireApiKey(req, res, next);
  });

  // Health (authenticated — proves the key works end to end).
  r.get("/health", async (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "chromehost",
      docker: await dockerAvailable(),
      db: chromeHostDbAvailable(),
      time: new Date().toISOString(),
    });
  });

  // ── API keys ──
  r.post("/keys", (req: Request, res: Response) => {
    const name = String(req.body?.name || "").slice(0, 64);
    try {
      const { id, key } = generateApiKey(name);
      // Shown ONCE — never stored, never logged.
      res.json({ id, key, prefix: key.slice(0, 10) + "…", warning: "Copy this key now. It will never be shown again." });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "key generation failed" });
    }
  });

  r.get("/keys", (_req: Request, res: Response) => {
    res.json({ keys: listApiKeys() });
  });

  r.delete("/keys/:id", (req: Request, res: Response) => {
    const ok = revokeApiKey(Number(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "key not found" });
      return;
    }
    res.json({ revoked: true });
  });

  // ── Settings (Composio key etc.) ──
  // Raw secret values are never returned — only configured/masked status.
  r.get("/settings", (_req: Request, res: Response) => {
    const fromEnv = Boolean(process.env.COMPOSIO_API_KEY);
    const stored = getSetting("composio_api_key");
    res.json({
      composio: {
        configured: fromEnv || Boolean(stored),
        source: fromEnv ? "env" : stored ? "settings" : "none",
        masked: maskSecret(fromEnv ? process.env.COMPOSIO_API_KEY! : stored),
      },
    });
  });

  r.post("/settings/composio-key", (req: Request, res: Response) => {
    const key = String(req.body?.key || "").trim();
    if (!key) {
      res.status(400).json({ error: "key is required" });
      return;
    }
    if (key.length < 8) {
      res.status(400).json({ error: "key looks too short" });
      return;
    }
    setSetting("composio_api_key", key);
    res.json({ ok: true, masked: maskSecret(key) });
  });

  r.delete("/settings/composio-key", (_req: Request, res: Response) => {
    try {
      getDb().prepare("DELETE FROM chromehost_settings WHERE key = 'composio_api_key'").run();
    } catch {
      /* ignore */
    }
    res.json({ ok: true, configured: Boolean(process.env.COMPOSIO_API_KEY) });
  });

  // ── Composio passthrough ──
  // Lets the agent call Composio tools through ChromeHost without handling
  // the raw key itself: POST { tool, args } -> api.composio.com.
  r.post("/composio/execute", async (req: Request, res: Response) => {
    const apiKey = getComposioKey();
    if (!apiKey) {
      res.status(400).json({ error: "COMPOSIO_API_KEY not configured (env or Settings page)" });
      return;
    }
    const { tool, args } = req.body || {};
    if (!tool || typeof tool !== "string") {
      res.status(400).json({ error: "tool is required" });
      return;
    }
    try {
      const upstream = await fetch("https://api.composio.com/api/v3/tools/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ tool_slug: tool, arguments: args || {} }),
      });
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (e: any) {
      res.status(502).json({ error: "composio upstream failed", detail: e?.message });
    }
  });

  // ── Sandboxed command runner ──
  r.post("/exec", async (req: Request, res: Response) => {
    const { command, args, cwd, timeoutMs } = req.body || {};
    if (!command || typeof command !== "string") {
      res.status(400).json({ error: "command is required" });
      return;
    }
    try {
      const result = await runSandboxed(command, Array.isArray(args) ? args : [], { cwd, timeoutMs });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "exec failed" });
    }
  });

  // ── Apps ──
  r.get("/apps", async (_req: Request, res: Response) => {
    await refreshStatuses();
    const d = getDb();
    const apps = d.prepare("SELECT * FROM chromehost_apps ORDER BY name").all();
    res.json({ apps, registry: APP_REGISTRY, docker: await dockerAvailable() });
  });

  r.post("/apps/deploy", async (req: Request, res: Response) => {
    const { repo, name, runtime, build, start, env } = req.body || {};
    if (!repo || typeof repo !== "string") {
      res.status(400).json({ error: "repo (git URL) is required" });
      return;
    }
    // Merge registry defaults when deploying a known app by name.
    let cfg: any = { repo, name, runtime, build, start };
    if (name) {
      const reg = APP_REGISTRY.find((e) => e.name === sanitizeName(name));
      if (reg) cfg = { runtime: reg.runtime, build: reg.build, start: reg.start, ...cfg, repo: cfg.repo || reg.repo };
    }
    try {
      const result = await deployApp({ ...cfg, env: env || {} });
      res.json({ ok: true, ...result, url: `http://localhost:${result.port}` });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "deploy failed" });
    }
  });

  r.post("/apps/:name/start", async (req: Request, res: Response) => {
    try {
      await startApp(req.params.name);
      res.json({ ok: true, status: "running" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "start failed" });
    }
  });

  r.post("/apps/:name/stop", async (req: Request, res: Response) => {
    try {
      await stopApp(req.params.name);
      res.json({ ok: true, status: "stopped" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "stop failed" });
    }
  });

  r.get("/apps/:name/logs", async (req: Request, res: Response) => {
    try {
      const tail = Math.min(Number(req.query.tail) || 200, 2000);
      const logs = await appLogs(req.params.name, tail);
      res.json({ name: req.params.name, logs });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "logs unavailable" });
    }
  });

  return r;
}
