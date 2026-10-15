/**
 * Static web build tests — storage adapters, data model, feature detection.
 *
 * The browser lib (src/lib/*.ts) is bundled to CJS with esbuild and tested in
 * node. IndexedDB is provided by fake-indexeddb (pure JS, no browser needed).
 * Run: node --test tests/static-store.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

require("fake-indexeddb/auto");

const repo = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-static-lib-"));

test.before(() => {
  execSync(
    `node_modules/.bin/esbuild src/lib/store.ts --bundle --platform=node --format=cjs --outfile=${outDir}/store.cjs` +
      ` && node_modules/.bin/esbuild src/lib/model.ts --bundle --platform=node --format=cjs --outfile=${outDir}/model.cjs` +
      ` && node_modules/.bin/esbuild src/lib/env.ts --bundle --platform=node --format=cjs --outfile=${outDir}/env.cjs`,
    { cwd: repo, stdio: "pipe" }
  );
});

test("memory store round-trips app state", async () => {
  const { createMemoryStore } = require(`${outDir}/store.cjs`);
  const { newProject, newDeployment, emptyState } = require(`${outDir}/model.cjs`);
  const store = createMemoryStore();
  assert.equal(await store.load(), null);
  const state = emptyState();
  const p = newProject("Test site");
  state.projects.push(p);
  state.deployments.push(newDeployment(p.id, "<h1>hi</h1>"));
  await store.save(state);
  const loaded = await store.load();
  assert.deepEqual(loaded, state);
  // Stored state must be isolated from caller mutation.
  loaded.projects[0].name = "mutated";
  assert.equal((await store.load()).projects[0].name, "Test site");
});

test("IndexedDB store round-trips app state (fake-indexeddb)", async () => {
  const { createIndexedDBStore, isIndexedDBAvailable } = require(`${outDir}/store.cjs`);
  const { newProject, emptyState } = require(`${outDir}/model.cjs`);
  assert.equal(isIndexedDBAvailable(), true);
  const dbName = `test-monico-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const store = createIndexedDBStore(dbName);
  assert.equal(await store.load(), null);
  const state = emptyState();
  state.projects.push(newProject("IDB site"));
  await store.save(state);
  // A fresh instance over the same DB name must see the saved state.
  const again = createIndexedDBStore(dbName);
  const loaded = await again.load();
  assert.equal(loaded.projects.length, 1);
  assert.equal(loaded.projects[0].name, "IDB site");
  assert.deepEqual(loaded.deployments, []);
});

test("IndexedDB store returns null for corrupt state", async () => {
  const { createIndexedDBStore } = require(`${outDir}/store.cjs`);
  const dbName = `test-monico-corrupt-${Date.now()}`;
  const store = createIndexedDBStore(dbName);
  await store.save({ projects: "not-an-array", deployments: [] });
  assert.equal(await store.load(), null);
});

test("model helpers build hash-routed static deployments", () => {
  const { newProject, newDeployment, DEFAULT_SITE_TEMPLATE } = require(`${outDir}/model.cjs`);
  const p = newProject("  ");
  assert.equal(p.name, "Untitled site");
  assert.equal(p.framework, "static");
  assert.ok(p.id.length > 8);
  const d = newDeployment(p.id, "<p>x</p>", "msg");
  assert.equal(d.projectId, p.id);
  assert.equal(d.status, "ready");
  assert.equal(d.deployedHtml, "<p>x</p>");
  assert.equal(d.commitMessage, "msg");
  // Hash-based preview URL: works on any static host, incl. IPFS gateways.
  assert.ok(d.previewUrl.startsWith("#/preview/"));
  assert.ok(d.previewUrl.endsWith(d.id));
  assert.ok(DEFAULT_SITE_TEMPLATE.includes("<!DOCTYPE html>"));
});

test("env reports browser (non-desktop) honestly under node", () => {
  const { isDesktopApp, featureList } = require(`${outDir}/env.cjs`);
  assert.equal(isDesktopApp, false);
  const feats = featureList();
  const byId = Object.fromEntries(feats.map((f) => [f.id, f]));
  assert.equal(byId.sites.availableInBrowser, true);
  assert.equal(byId.ipfs.availableInBrowser, true);
  assert.equal(byId.puppeteer.availableInBrowser, false);
  assert.equal(byId.mcp.availableInBrowser, false);
  assert.equal(byId.sqlite.availableInBrowser, false);
  // Every feature must carry an honest explanatory note — never a bare flag.
  for (const f of feats) {
    assert.ok(f.note.length > 20, `feature ${f.id} needs an honest note`);
  }
});
