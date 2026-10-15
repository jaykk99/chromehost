/**
 * Static web build tests — in-browser IPFS module (src/lib/ipfs.ts).
 *
 * The module is bundled to ESM with esbuild (helia left external) and loaded
 * via dynamic import, mirroring how the browser lazy-loads it on publish.
 * Run: node --test tests/static-ipfs.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const repo = path.join(__dirname, "..");
// Bundle must live under the repo so node resolves 'helia' from node_modules.
const outDir = fs.mkdtempSync(path.join(repo, "tests", ".tmp-static-ipfs-"));
const bundlePath = path.join(outDir, "ipfs.mjs");

let ipfs;
test.before(async () => {
  execSync(
    `node_modules/.bin/esbuild src/lib/ipfs.ts --bundle --platform=node --format=esm` +
      ` --external:helia --external:@helia/unixfs --outfile=${bundlePath}`,
    { cwd: repo, stdio: "pipe" }
  );
  ipfs = await import(pathToFileURL(bundlePath).href);
});

test.after(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

test("gateway URLs are well-formed for a CID", () => {
  const urls = ipfs.ipfsGatewayUrls("bafytest123");
  assert.equal(urls.length, 4);
  for (const u of urls) {
    assert.ok(u.startsWith("https://"), u);
    assert.ok(u.endsWith("/bafytest123"), u);
    assert.ok(!u.includes("<cid>"), u);
  }
  assert.ok(urls[0].startsWith("https://ipfs.io/ipfs/"));
  assert.ok(urls[1].startsWith("https://cloudflare-ipfs.com/ipfs/"));
  assert.ok(urls[2].startsWith("https://dweb.link/ipfs/"));
  assert.ok(urls[3].startsWith("https://gateway.pinata.cloud/ipfs/"));
});

test("warmGatewayCache uses injectable fetch and never throws", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push([url, opts]);
    if (url.includes("ipfs.io") || url.includes("dweb.link")) return { ok: true, status: 200 };
    throw new Error("gateway down");
  };
  const result = await ipfs.warmGatewayCache("bafytest", fakeFetch, 1000);
  assert.equal(result.attempted.length, 4);
  assert.equal(result.warmed.length, 2);
  assert.equal(calls.length, 4);
  for (const [, opts] of calls) {
    assert.equal(opts.headers.Range, "bytes=0-0");
  }
});

test(
  "in-process Helia publish produces a valid CID with local round-trip",
  async () => {
    const html = "<!DOCTYPE html><html><body><h1>static test</h1></body></html>";
    const { cid, urls } = await ipfs.publishHtmlToIpfs(html);
    // Valid CID: v0 base58 (Qm…) or v1 base32 (baf… covers dag-pb/raw/etc codecs).
    assert.match(cid, /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[0-9a-z]{50,})$/);
    assert.equal(urls.length, 4);
    assert.ok(urls.every((u) => u.endsWith(`/${cid}`)));
    // Content round-trips through the local node.
    const back = await ipfs.catHtmlFromIpfs(cid);
    assert.equal(back, html);
    await ipfs.stopBrowserIpfsNode();
  },
  { timeout: 180000 }
);
