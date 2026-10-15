// Post-build helper: tsc emits dist-electron/*.js (CommonJS); rename them to
// *.cjs so they load as CommonJS even though package.json is "type": "module".
// Mirrors scripts/rename-server.cjs.
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "dist-electron");

if (!fs.existsSync(outDir)) {
  console.error("[build] expected dist-electron/ to exist; electron emit may have failed");
  process.exit(1);
}

let renamed = 0;
for (const entry of fs.readdirSync(outDir)) {
  if (!entry.endsWith(".js")) continue;
  const from = path.join(outDir, entry);
  const to = path.join(outDir, entry.slice(0, -3) + ".cjs");
  if (fs.existsSync(to)) fs.unlinkSync(to);
  fs.renameSync(from, to);
  renamed++;
}

console.log(`[build] renamed ${renamed} file(s) in dist-electron/ to .cjs`);
