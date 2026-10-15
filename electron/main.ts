import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { ChildProcess } from "node:child_process";

// NOTE: the launcher compiles to backend-launcher.cjs (see scripts/rename-electron.cjs).
// Node's CJS resolver does not probe .cjs for extensionless requires, so load it
// explicitly; `typeof import` keeps full type safety from the .ts source.
const cjsRequire = createRequire(__filename);
const {
  parseArgs,
  ensureMcpToken,
  findFreePort,
  launchBackendHttp,
  launchBackendStdio,
  waitForHttp,
} = cjsRequire("./backend-launcher.cjs") as typeof import("./backend-launcher");

let backend: ChildProcess | undefined;

function shutdownBackend() {
  if (backend && !backend.killed) {
    try {
      backend.kill();
    } catch {
      /* already gone */
    }
    backend = undefined;
  }
}

function createWindow(port: number): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

async function bootHttp(): Promise<void> {
  const userDataDir = app.getPath("userData");
  const token = ensureMcpToken(userDataDir);
  const port = await findFreePort();
  backend = launchBackendHttp(userDataDir, port, token);
  backend.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[backend] ${chunk}`);
  });
  backend.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[backend] ${chunk}`);
  });
  backend.on("exit", (code, signal) => {
    console.error(`[electron] backend exited (code=${code}, signal=${signal}); quitting`);
    app.quit();
  });
  backend.on("error", (err) => {
    console.error(`[electron] backend spawn error: ${err.message}; quitting`);
    app.quit();
  });

  await waitForHttp(`http://127.0.0.1:${port}/`, 30000);
  createWindow(port);
}

// MCP-over-stdio mode: no window. The child inherits our stdio and MCP clients
// talk to it directly; we exit with the child's code when it exits.
const { mcpStdio } = parseArgs(process.argv);

if (mcpStdio) {
  const userDataDir = app.getPath("userData");
  const token = ensureMcpToken(userDataDir);
  backend = launchBackendStdio(userDataDir, token);
  backend.on("exit", (code) => {
    app.exit(typeof code === "number" ? code : 1);
  });
  backend.on("error", (err) => {
    console.error(`[electron] backend stdio spawn error: ${err.message}`);
    app.exit(1);
  });
} else {
  app.whenReady().then(() => {
    bootHttp().catch((err) => {
      console.error(`[electron] failed to boot backend: ${err?.message ?? err}`);
      app.quit();
    });
  });

  app.on("window-all-closed", () => {
    shutdownBackend();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    shutdownBackend();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootHttp().catch((err) => {
        console.error(`[electron] failed to re-boot backend: ${err?.message ?? err}`);
        app.quit();
      });
    }
  });
}
