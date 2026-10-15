// Backend launcher logic for the Monico Labs Electron shell.
//
// This module is PURE logic: it MUST NOT import "electron" at the top level,
// so tests can require it without Electron installed or running.
//
// It knows how to spawn the compiled backend (dist/server.cjs) in two modes:
//   - HTTP mode: Express on 127.0.0.1:<free port>, serving the UI + REST + MCP SSE.
//   - stdio mode: MCP over stdio (for Claude Desktop-style clients), no HTTP.
//
// Env contract honored:
//   VORTEX_DATA_DIR     SQLite lives at <dir>/vortex.db
//   VORTEX_HOST         "127.0.0.1" (desktop binds loopback only)
//   PORT                the free port we picked
//   VRX_MCP_AUTH_TOKEN  stable token persisted in <userDataDir>/mcp-token
// Deliberately drops every other env var so host secrets never leak into the backend.

import { spawn, type ChildProcess } from "node:child_process";
import * as http from "node:http";
import * as https from "node:https";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import * as path from "node:path";

export const MCP_TOKEN_FILENAME = "mcp-token";
export const MCP_TOKEN_BYTES = 24; // 24 bytes -> 48 hex chars

/** Bind port 0, report the assigned port, then release it. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("findFreePort: no address assigned"));
        }
      });
    });
  });
}

/**
 * Read <userDataDir>/mcp-token; if missing, generate 48 hex chars, write the
 * file with mode 0o600, and return it. Stable across restarts.
 */
export function ensureMcpToken(userDataDir: string): string {
  mkdirSync(userDataDir, { recursive: true });
  const tokenPath = path.join(userDataDir, MCP_TOKEN_FILENAME);
  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing.length > 0) return existing;
  }
  const token = randomBytes(MCP_TOKEN_BYTES).toString("hex");
  writeFileSync(tokenPath, token + "\n", { mode: 0o600 });
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    // best effort (e.g. filesystems that don't support chmod)
  }
  return token;
}

/**
 * Env for the spawned backend. Deliberately keeps ONLY what the backend needs:
 * zero keys, zero secrets, zero parent-environment leakage.
 */
export function buildBackendEnv(
  userDataDir: string,
  port: number,
  token: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    PORT: String(port),
    VORTEX_HOST: "127.0.0.1",
    VORTEX_DATA_DIR: userDataDir,
    VRX_MCP_AUTH_TOKEN: token,
  };
  const chromePath = resolveChromePath();
  if (chromePath) {
    env.PUPPETEER_EXECUTABLE_PATH = chromePath;
  }
  return env;
}

/** Best-effort path to a system Chrome/Chromium for Puppeteer inside the backend. */
export function resolveChromePath(electronExePath?: string): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates: string[] = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Electron-bundled chromium next to the electron executable.
  if (electronExePath) {
    const exeDir = path.dirname(electronExePath);
    const bundled: string[] =
      process.platform === "darwin"
        ? [path.join(exeDir, "..", "Frameworks", "Chromium Embedded Framework.framework")]
        : process.platform === "win32"
          ? [path.join(exeDir, "chrome.exe")]
          : [path.join(exeDir, "chrome")];
    for (const b of bundled) {
      if (existsSync(b)) return b;
    }
  }

  return undefined;
}

/** CLI args: `--mcp-stdio` switches the shell into MCP-over-stdio mode. */
export function parseArgs(argv: string[]): { mcpStdio: boolean } {
  return { mcpStdio: argv.includes("--mcp-stdio") };
}

/**
 * Absolute path to the compiled backend entry.
 * The launcher compiles to dist-electron/, so __dirname/../dist is the repo dist/.
 */
export function backendEntry(): string {
  return path.join(__dirname, "..", "dist", "server.cjs");
}

/** Poll GET <url> until a 2xx response or timeoutMs elapses. */
export function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const mod = url.startsWith("https:") ? https : http;
      const req = mod.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error(`waitForHttp: timed out waiting for 2xx from ${url}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(`waitForHttp: timed out waiting for ${url}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
      req.setTimeout(5000, () => req.destroy());
    };
    attempt();
  });
}

/** Spawn the backend in HTTP mode (Express UI + REST + MCP SSE). */
export function launchBackendHttp(
  userDataDir: string,
  port: number,
  token: string
): ChildProcess {
  return spawn(process.execPath, [backendEntry()], {
    env: buildBackendEnv(userDataDir, port, token),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Spawn the backend in MCP-over-stdio mode (no HTTP, logs to stderr). */
export function launchBackendStdio(userDataDir: string, token: string): ChildProcess {
  return spawn(process.execPath, [backendEntry(), "--stdio"], {
    env: buildBackendEnv(userDataDir, 0, token),
    stdio: "inherit",
  });
}
