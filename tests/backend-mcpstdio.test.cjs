/**
 * MCP stdio test — self-contained server over JSON-RPC stdio (dist/server.cjs --stdio).
 * Zero keys: stripped env + temp VORTEX_DATA_DIR. Exercises initialize,
 * tools/list, create_project, deploy_project (local-first), and the
 * create_database_table / insert_database_record / query_database round-trip
 * against the embedded SQLite database.
 * Run: node --test tests/backend-mcpstdio.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..");
const serverEntry = path.join(repo, "dist", "server.cjs");

class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = "";
    child.stdout.on("data", (d) => this.onData(d));
  }
  onData(d) {
    this.buf += d.toString("utf8");
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // skip non-JSON boot logs on stdout
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    }
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 45000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  toolsCall(name, args) {
    return this.request("tools/call", { name, arguments: args });
  }
}

function toolText(result) {
  assert.ok(Array.isArray(result.content), JSON.stringify(result).slice(0, 300));
  return result.content.map((c) => c.text || "").join("\n");
}

test("MCP stdio: init, list, create/deploy project, SQLite db round-trip", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-mcp-"));
  const child = spawn(process.execPath, [serverEntry, "--stdio"], {
    cwd: repo,
    env: { PATH: process.env.PATH, VORTEX_DATA_DIR: dataDir, NODE_ENV: "production" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {}); // stderr is diagnostics only
  const client = new McpClient(child);
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "backend-test", version: "1.0.0" },
    });
    assert.ok(init.serverInfo || init.capabilities, JSON.stringify(init).slice(0, 200));
    client.notify("notifications/initialized", {});

    const listed = await client.request("tools/list", {});
    const names = listed.tools.map((t) => t.name);
    assert.ok(names.includes("create_database_table"), `missing create_database_table in ${names.length} tools`);
    assert.ok(names.includes("deploy_project"), "missing deploy_project");
    assert.ok(names.includes("publish_deployment_ipfs"), "missing publish_deployment_ipfs");

    // framework is optional (defaults to "static"); repo "local" avoids GitHub fetching
    const created = toolText(await client.toolsCall("create_project", { name: "mcp-proj" }));
    const m = created.match(/ID:\s*(\S+)/);
    assert.ok(m, `could not parse project id from: ${created}`);
    const projectId = m[1];

    // deploy_project is local-first with no VERCEL_API_TOKEN: previewUrl must be /p/<slug>
    const deployed = toolText(await client.toolsCall("deploy_project", { projectId }));
    assert.ok(deployed.includes("/p/"), deployed);

    const tbl = toolText(await client.toolsCall("create_database_table", { projectId, name: "widgets" }));
    assert.match(tbl, /Created table 'widgets'/);

    const ins = toolText(
      await client.toolsCall("insert_database_record", {
        projectId,
        tableName: "widgets",
        data: JSON.stringify({ color: "red" }),
      })
    );
    const insJson = JSON.parse(ins);
    assert.equal(insJson.source, "sqlite");
    assert.ok(insJson.inserted.id);

    const q = toolText(
      await client.toolsCall("query_database", { projectId, sql: "SELECT * FROM widgets" })
    );
    const qJson = JSON.parse(q);
    assert.equal(qJson.source, "sqlite");
    assert.equal(qJson.rowCount, 1);
    assert.equal(JSON.parse(qJson.result[0].data).color, "red");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
});
