/**
 * Backend auth + API-key test — covers the hardened endpoints:
 *  - POST /api/projects rejects non-string / overlong names (no more .toLowerCase crash)
 *  - GET /api/projects/:id/api-keys masks secrets (full secret only at creation)
 *  - POST /api/projects/:id/auth/users validates email + status + role (no fabricated fallback email)
 *  - create/delete of keys and users persist across a restart (saveToCloudDB)
 * Run: node --test tests/backend-auth-keys.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..");
const serverEntry = path.join(repo, "dist", "server.cjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function spawnServer(dataDir, port) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      VORTEX_HOST: "127.0.0.1",
      VORTEX_DATA_DIR: dataDir,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForHttp(base, timeoutMs = 90000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`server at ${base} did not come up in time`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function api(base, method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, text, json };
}

async function stopServer(child) {
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
}

test("auth users + api keys: validation, secret masking, restart persistence", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-auth-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child = spawnServer(dataDir, port);
  let projectId;
  try {
    await waitForHttp(base);

    // 1) project validation: non-string name must 400, not crash
    const badName = await api(base, "POST", "/api/projects", { name: 123, repo: "x" });
    assert.equal(badName.status, 400, badName.text);
    const longName = await api(base, "POST", "/api/projects", { name: "a".repeat(101), repo: "x" });
    assert.equal(longName.status, 400, longName.text);

    const created = await api(base, "POST", "/api/projects", { name: "auth-test", repo: "local" });
    assert.equal(created.status, 201, created.text);
    projectId = created.json.id;

    // 2) api key: creation returns the full secret once…
    const k1 = await api(base, "POST", `/api/projects/${projectId}/api-keys`, { name: "k1" });
    assert.equal(k1.status, 200, k1.text);
    const fullSecret = k1.json.secret;
    assert.ok(fullSecret && fullSecret.startsWith("vtx_live_"), "expected a real secret at creation");
    const keyId = k1.json.id;

    // 3) …but the list endpoint masks it
    const list = await api(base, "GET", `/api/projects/${projectId}/api-keys`);
    assert.equal(list.status, 200, list.text);
    assert.equal(list.json.length, 1);
    assert.ok(!list.json[0].secret.includes(fullSecret), "list must not expose the raw secret");
    assert.match(list.json[0].secret, /redacted/);

    // 4) auth users: fabricated fallback email is gone — invalid/missing email 400s
    const badEmail = await api(base, "POST", `/api/projects/${projectId}/auth/users`, { email: "nope" });
    assert.equal(badEmail.status, 400, badEmail.text);
    const noEmail = await api(base, "POST", `/api/projects/${projectId}/auth/users`, {});
    assert.equal(noEmail.status, 400, noEmail.text);
    const badStatus = await api(base, "POST", `/api/projects/${projectId}/auth/users`, {
      email: "a@b.co",
      status: "banned",
    });
    assert.equal(badStatus.status, 400, badStatus.text);
    const badRole = await api(base, "POST", `/api/projects/${projectId}/auth/users`, {
      email: "a@b.co",
      role: "superadmin",
    });
    assert.equal(badRole.status, 400, badRole.text);

    const user = await api(base, "POST", `/api/projects/${projectId}/auth/users`, {
      email: "keeper@example.com",
      role: "viewer",
    });
    assert.equal(user.status, 200, user.text);
    assert.equal(user.json.email, "keeper@example.com");
    assert.equal(user.json.role, "viewer");
    const userId = user.json.id;

    // 5) delete the OTHER key now; the user stays so we can check persistence after restart
    const del = await api(base, "DELETE", `/api/projects/${projectId}/api-keys/${keyId}`);
    assert.equal(del.status, 200, del.text);
    const listAfter = await api(base, "GET", `/api/projects/${projectId}/api-keys`);
    assert.equal(listAfter.json.length, 0);
    void userId;
  } finally {
    await stopServer(child);
  }

  // 6) restart: created user + deleted key must be reflected (persisted, not lost)
  const port2 = await freePort();
  const base2 = `http://127.0.0.1:${port2}`;
  child = spawnServer(dataDir, port2);
  try {
    await waitForHttp(base2);
    const users = await api(base2, "GET", `/api/projects/${projectId}/auth/users`);
    assert.equal(users.status, 200, users.text);
    const emails = users.json.map((u) => u.email);
    assert.ok(emails.includes("keeper@example.com"), `expected persisted user, got: ${emails.join(",")}`);
    const keys = await api(base2, "GET", `/api/projects/${projectId}/api-keys`);
    assert.equal(keys.json.length, 0, "deleted key must stay deleted after restart");
  } finally {
    await stopServer(child);
  }
});
