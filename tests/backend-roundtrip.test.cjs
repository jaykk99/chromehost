/**
 * Backend round-trip test — self-contained Monico Labs server (dist/server.cjs).
 * Zero keys, zero external services: boots with a stripped env, exercises the
 * REST project + local deploy + embedded-SQLite query paths, then verifies
 * persistence across a restart with the same VORTEX_DATA_DIR.
 * Run: node --test tests/backend-roundtrip.test.cjs
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
  child.stderr.on("data", () => {}); // stderr is diagnostics only
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
    redirect: "follow",
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML pages (e.g. /p/<slug>) are not JSON
  }
  return { status: res.status, text, json };
}

async function stopServer(child) {
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
}

test("REST round-trip: project, local deploy, SQLite queries, restart persistence", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-be-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child = spawnServer(dataDir, port);
  try {
    await waitForHttp(base);

    // 1) create project (repo "local" has no "/" — avoids the GitHub fetch path)
    const created = await api(base, "POST", "/api/projects", { name: "t1", repo: "local" });
    assert.equal(created.status, 201, created.text);
    const projectId = created.json.id;
    assert.ok(projectId);

    // 2) trigger a deployment (local-first; no VERCEL_API_TOKEN in env)
    const trig = await api(base, "POST", `/api/projects/${projectId}/deployments/trigger`, {});
    assert.equal(trig.status, 202, trig.text);
    const dep = trig.json;
    assert.ok(dep.previewUrl.includes("/p/"), dep.previewUrl);
    const slug = dep.previewUrl.split("/p/")[1];
    assert.ok(slug);

    // 3) /p/<slug> serves the deployment HTML (follows the redirect to /api/preview/<id>)
    const page = await api(base, "GET", `/p/${slug}`);
    assert.equal(page.status, 200, page.text.slice(0, 200));
    assert.ok(
      page.text.includes(dep.commitHash),
      "preview page should carry this deployment's commit hash"
    );

    // 4) embedded SQLite via the query endpoint: create + insert + select
    const q1 = await api(base, "POST", `/api/projects/${projectId}/database/query`, {
      sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
    });
    assert.equal(q1.json && q1.json.success, true, JSON.stringify(q1.json));
    const q2 = await api(base, "POST", `/api/projects/${projectId}/database/query`, {
      sql: "INSERT INTO notes (body) VALUES ('roundtrip-ok')",
    });
    assert.equal(q2.json && q2.json.success, true, JSON.stringify(q2.json));
    assert.equal(q2.json.rowCount, 1);
    const q3 = await api(base, "POST", `/api/projects/${projectId}/database/query`, {
      sql: "SELECT * FROM notes",
    });
    assert.equal(q3.json && q3.json.success, true, JSON.stringify(q3.json));
    assert.equal(q3.json.rowCount, 1);
    assert.equal(q3.json.rows[0].body, "roundtrip-ok");

    // 5) bad SQL is reported honestly, not faked
    const qbad = await api(base, "POST", `/api/projects/${projectId}/database/query`, {
      sql: "SELECT * FROM nope_missing",
    });
    assert.equal(qbad.json && qbad.json.success, false);
    assert.match(qbad.json.error, /no such table/i);
  } finally {
    await stopServer(child);
  }

  // 6) restart with the same DATA_DIR — the project must still be listed (SQLite persistence)
  const port2 = await freePort();
  const base2 = `http://127.0.0.1:${port2}`;
  child = spawnServer(dataDir, port2);
  try {
    await waitForHttp(base2);
    const list = await api(base2, "GET", "/api/projects");
    assert.equal(list.status, 200, list.text);
    const names = list.json.map((p) => p.name);
    assert.ok(names.includes("t1"), `expected persisted project "t1", got: ${names.join(",")}`);
  } finally {
    await stopServer(child);
  }
});
