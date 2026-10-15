// puppeteer is an OPTIONAL dependency (used only by the AI browser-automation
// MCP tool, loaded via dynamic import inside try/catch). This shim keeps the
// typechecker happy without forcing a heavy Chromium download on install.
declare module "puppeteer";
