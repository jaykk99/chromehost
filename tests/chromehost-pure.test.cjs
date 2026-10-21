/**
 * Pure unit tests for ChromeHost helpers — no server boot, no Docker, no DB.
 * These run in milliseconds, unlike the e2e suites that spawn dist/server.cjs
 * (which needs ~100s to come up on slow hardware).
 * Run: node --test tests/chromehost-pure.test.cjs   (after npm run build:server)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { sanitizeName, parseEnvExample, maskSecret } = require(path.join(
  __dirname,
  "..",
  "dist",
  "server",
  "chromehost.cjs"
));

test("sanitizeName: normalizes and rejects bad names", () => {
  assert.equal(sanitizeName("My App_2"), "my-app-2");
  assert.equal(sanitizeName("  --Hello--  "), "hello");
  assert.equal(sanitizeName("a"), "a");
  assert.throws(() => sanitizeName(""), /invalid app name/);
  assert.throws(() => sanitizeName("!!!"), /invalid app name/);
  assert.throws(() => sanitizeName("x".repeat(49)), /invalid app name/);
  assert.equal(sanitizeName("x".repeat(48)).length, 48);
  assert.throws(() => sanitizeName(null), /invalid app name/);
});

test("parseEnvExample: comments, quoting, placeholder defaults", () => {
  const vars = parseEnvExample(
    `# Section header
# The API key for things
API_KEY=your_key_here

# Quoted value with a # inside
GREETING="hello # world" # trailing comment
EMPTY=
NUMBER=42
URL="https://example.com/x?a=b#c"
`
  );
  const byKey = Object.fromEntries(vars.map((v) => [v.key, v]));
  assert.equal(byKey.API_KEY.defaultValue, "", "placeholder defaults are blanked");
  assert.match(byKey.API_KEY.comment, /API key for things/);
  assert.equal(byKey.GREETING.defaultValue, "hello # world", "# inside quotes is kept");
  assert.equal(byKey.GREETING.comment, "Quoted value with a # inside", "pending comment wins over inline");
  assert.equal(byKey.EMPTY.defaultValue, "");
  assert.equal(byKey.NUMBER.defaultValue, "42");
  assert.equal(byKey.URL.defaultValue, "https://example.com/x?a=b#c");
});

test("parseEnvExample: skips garbage lines, resets comments on blanks", () => {
  const vars = parseEnvExample("not a var line\n# orphan comment\n\nREAL=1\n");
  assert.equal(vars.length, 1);
  assert.equal(vars[0].key, "REAL");
  assert.equal(vars[0].comment, "", "blank line resets pending comment");
});

test("maskSecret: never leaks the raw value", () => {
  assert.equal(maskSecret(null), null);
  assert.equal(maskSecret(""), null);
  assert.equal(maskSecret("short"), "••••");
  const masked = maskSecret("abcdefghij1234567890");
  assert.ok(!masked.includes("abcdefghij1234567890"));
  assert.ok(masked.startsWith("abcd") && masked.endsWith("7890"));
});
