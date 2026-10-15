/**
 * Monico Labs — runtime environment detection for the static web build.
 *
 * The same static files run in two places:
 *  - a plain browser (file server, IPFS gateway, Supabase Storage bucket): browser-only
 *  - inside the Electron desktop app's renderer: the preload bridge sets window.vortex
 *
 * Node-only features (Puppeteer automation, MCP server, SQLite backend) are
 * desktop-only. This module is the single source of truth for that split so
 * the UI degrades with honest messaging instead of crashing or faking it.
 */

export interface DesktopBridge {
  isDesktop?: boolean;
  platform?: string;
}

declare global {
  interface Window {
    vortex?: DesktopBridge;
  }
}

/** True when this page runs inside the Electron desktop companion. */
export const isDesktopApp: boolean =
  typeof window !== "undefined" && window.vortex?.isDesktop === true;

export const desktopPlatform: string | undefined =
  typeof window !== "undefined" ? window.vortex?.platform : undefined;

export interface FeatureInfo {
  id: string;
  name: string;
  /** False = desktop-app-only; the UI must say so plainly, never fake it. */
  availableInBrowser: boolean;
  note: string;
}

export function featureList(): FeatureInfo[] {
  return [
    {
      id: "sites",
      name: "Sites — build, deploy, preview",
      availableInBrowser: true,
      note: "Fully local: projects live in this browser's IndexedDB and previews render on this page. Nothing leaves your device.",
    },
    {
      id: "ipfs",
      name: "Publish public (IPFS)",
      availableInBrowser: true,
      note: "Runs in this page through an in-browser Helia node. No server involved.",
    },
    {
      id: "puppeteer",
      name: "Browser automation (Puppeteer)",
      availableInBrowser: false,
      note: "Desktop app only — a web page cannot drive Puppeteer. Available in the Electron companion.",
    },
    {
      id: "mcp",
      name: "MCP server (stdio / SSE)",
      availableInBrowser: false,
      note: "Desktop app only — browsers can't accept inbound MCP connections. Available in the Electron companion.",
    },
    {
      id: "sqlite",
      name: "SQLite backend",
      availableInBrowser: false,
      note: "Desktop app only. The browser build uses IndexedDB instead — same data model, different storage adapter.",
    },
  ];
}
