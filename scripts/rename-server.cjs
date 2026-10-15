// Post-build helper: tsc emits CommonJS .js files under dist/ (server.js,
// server/*.js, vortex-sqlite.js, vortex-ipfs.js, src/**/*.js). Rename EVERY
// emitted .js file to .cjs so they load as CommonJS even though
// package.json is "type": "module".
// EXCLUDED: dist/assets/** — the Vite client bundle must stay .js.
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
const excludeDir = path.join(distDir, "assets");

let renamed = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === excludeDir || full.startsWith(excludeDir + path.sep)) continue;
      walk(full);
    } else if (entry.isFile() && full.endsWith(".js")) {
      const to = full.slice(0, -3) + ".cjs";
      if (fs.existsSync(to)) fs.unlinkSync(to);
      fs.renameSync(full, to);
      renamed++;
    }
  }
}

if (!fs.existsSync(distDir)) {
  console.error("[build] expected dist/ to exist; server emit may have failed");
  process.exit(1);
}
walk(distDir);
if (!fs.existsSync(path.join(distDir, "server.cjs"))) {
  console.error("[build] expected dist/server.cjs to exist; server emit may have failed");
  process.exit(1);
}
console.log(`[build] renamed ${renamed} emitted .js file(s) to .cjs (dist/assets/** excluded)`);

// Node's CJS resolver does not probe ".cjs", so a plain require("./vortex-sqlite")
// would no longer resolve ./vortex-sqlite.cjs. Rewrite relative require()/import()
// targets that point at a renamed file to include the .cjs extension.
const renamedSet = new Set(); // dist-relative, extensionless: "vortex-sqlite", "src/types"
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === excludeDir || full.startsWith(excludeDir + path.sep)) continue;
      collect(full);
    } else if (entry.isFile() && full.endsWith(".cjs")) {
      renamedSet.add(path.relative(distDir, full).slice(0, -4));
    }
  }
}
function fixRequires(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === excludeDir || full.startsWith(excludeDir + path.sep)) continue;
      fixRequires(full);
    } else if (entry.isFile() && full.endsWith(".cjs")) {
      const src = fs.readFileSync(full, "utf8");
      const fixed = src.replace(
        /(?:require|import)\(\s*["'](\.[^"']+)["']\s*\)/g,
        (m, spec) => {
          const rel = path.relative(distDir, path.normalize(path.join(path.dirname(full), spec)));
          return renamedSet.has(rel) ? m.replace(spec, spec + ".cjs") : m;
        }
      );
      if (fixed !== src) fs.writeFileSync(full, fixed);
    }
  }
}
collect(distDir);
fixRequires(distDir);
console.log("[build] require() targets rewritten for renamed modules");
