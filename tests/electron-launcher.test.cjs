// Tests for the Electron backend launcher (pure logic, no Electron required).
// Run: node --test tests/electron-launcher.test.cjs   (after building dist-electron)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer: createNetServer } = require("node:net");
const { createServer: createHttpServer } = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const launcher = require("../dist-electron/backend-launcher.cjs");

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vortex-electron-test-"));
}

test("findFreePort: returned port accepts a connection then closes", async () => {
  const port = await launcher.findFreePort();
  assert.equal(typeof port, "number");
  assert.ok(port > 0 && port < 65536);
  await new Promise((resolve, reject) => {
    const server = createNetServer((socket) => socket.end());
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve());
    });
  });
});

test("ensureMcpToken: stable across calls, 0o600, 48 hex chars", () => {
  const dir = tmpUserData();
  const first = launcher.ensureMcpToken(dir);
  const second = launcher.ensureMcpToken(dir);
  assert.equal(first, second, "token must be stable across restarts");
  assert.match(first, /^[0-9a-f]{48}$/, "token must be 48 hex chars");
  const stat = fs.statSync(path.join(dir, "mcp-token"));
  assert.equal(stat.mode & 0o777, 0o600, "token file must be owner-read/write only");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildBackendEnv: sets contract vars, leaks no keys", () => {
  // Plant hostile keys in the parent env; none may leak through.
  process.env.GEMINI_API_KEY = "sk-test-gemini";
  process.env.COMPOSIO_API_KEY = "key-test-composio";
  process.env.VERCEL_TOKEN = "token-test-vercel";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "key-test-supabase";
  process.env.AWS_SECRET_ACCESS_KEY = "secret-test-aws";

  const env = launcher.buildBackendEnv("/tmp/userdata", 48210, "tok-abc");
  try {
    assert.equal(env.PORT, "48210");
    assert.equal(env.VORTEX_HOST, "127.0.0.1");
    assert.equal(env.VORTEX_DATA_DIR, "/tmp/userdata");
    assert.equal(env.VRX_MCP_AUTH_TOKEN, "tok-abc");
    assert.equal(env.PATH, process.env.PATH);

    const allowed = new Set([
      "PATH",
      "PORT",
      "VORTEX_HOST",
      "VORTEX_DATA_DIR",
      "VRX_MCP_AUTH_TOKEN",
      "PUPPETEER_EXECUTABLE_PATH",
    ]);
    for (const key of Object.keys(env)) {
      assert.ok(allowed.has(key), `unexpected env key leaked into backend env: ${key}`);
    }
    assert.ok(!("GEMINI_API_KEY" in env));
    assert.ok(!("COMPOSIO_API_KEY" in env));
    assert.ok(!("VERCEL_TOKEN" in env));
    assert.ok(!("SUPABASE_SERVICE_ROLE_KEY" in env));
    assert.ok(!("AWS_SECRET_ACCESS_KEY" in env));
  } finally {
    delete process.env.GEMINI_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.VERCEL_TOKEN;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  }
});

test("parseArgs: --mcp-stdio flag", () => {
  assert.equal(launcher.parseArgs(["electron", "app"]).mcpStdio, false);
  assert.equal(launcher.parseArgs(["electron", "app", "--mcp-stdio"]).mcpStdio, true);
  assert.equal(launcher.parseArgs([]).mcpStdio, false);
});

test("resolveChromePath: returns string|undefined, never throws", () => {
  const result = launcher.resolveChromePath("/nonexistent/electron");
  assert.ok(result === undefined || typeof result === "string");

  // Env override wins when the file exists.
  const fake = path.join(os.tmpdir(), `fake-chrome-${process.pid}`);
  fs.writeFileSync(fake, "fake");
  const prev = process.env.PUPPETEER_EXECUTABLE_PATH;
  process.env.PUPPETEER_EXECUTABLE_PATH = fake;
  try {
    assert.equal(launcher.resolveChromePath(), fake);
  } finally {
    if (prev === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
    else process.env.PUPPETEER_EXECUTABLE_PATH = prev;
    fs.unlinkSync(fake);
  }

  // Nonexistent env override falls through without throwing.
  process.env.PUPPETEER_EXECUTABLE_PATH = "/nonexistent/chrome-binary";
  try {
    const r2 = launcher.resolveChromePath();
    assert.ok(r2 === undefined || typeof r2 === "string");
  } finally {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
  }
});

test("backendEntry: ends with dist/server.cjs", () => {
  const entry = launcher.backendEntry();
  assert.ok(entry.endsWith(path.join("dist", "server.cjs")), `unexpected entry: ${entry}`);
  assert.ok(path.isAbsolute(entry));
});

test("waitForHttp: resolves on 2xx, rejects on timeout", async () => {
  const server = createHttpServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await launcher.waitForHttp(`http://127.0.0.1:${port}/`, 5000);
  } finally {
    server.close();
  }

  await assert.rejects(
    launcher.waitForHttp("http://127.0.0.1:1/nope", 600),
    /timed out/,
    "should reject after timeout"
  );
});
