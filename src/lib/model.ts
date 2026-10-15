/**
 * Monico Labs — shared data model (static web build + desktop build).
 *
 * The browser build stores this shape in IndexedDB; the desktop backend
 * stores the same shape in embedded SQLite. Same model, different storage
 * adapter behind it. Keep this file in sync with the server-side
 * Project / Deployment interfaces in server.ts.
 */

export interface Project {
  id: string;
  name: string;
  framework: string;
  repo?: string;
  branch?: string;
  createdAt: string;
  activeDeploymentId?: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  status: "ready" | "building" | "error";
  previewUrl?: string;
  createdAt: string;
  commitMessage?: string;
  commitHash?: string;
  deployedHtml?: string;
  buildLogs?: string[];
  /** Set when published to IPFS. */
  ipfsCid?: string;
  ipfsUrls?: string[];
  ipfsPublishedAt?: string;
}

export interface AppState {
  projects: Project[];
  deployments: Deployment[];
}

export function emptyState(): AppState {
  return { projects: [], deployments: [] };
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newProject(name: string): Project {
  return {
    id: uid("proj"),
    name: name.trim() || "Untitled site",
    framework: "static",
    createdAt: new Date().toISOString(),
  };
}

/**
 * A deployment in the static build is just the site's HTML, stored locally.
 * previewUrl is hash-based (#/preview/<id>) so it works on ANY static host —
 * a local file server, a Supabase Storage bucket, or an IPFS gateway path.
 */
export function newDeployment(projectId: string, html: string, commitMessage?: string): Deployment {
  const id = uid("dep");
  return {
    id,
    projectId,
    status: "ready",
    previewUrl: `#/preview/${id}`,
    createdAt: new Date().toISOString(),
    commitMessage: commitMessage || "Static deployment",
    deployedHtml: html,
    buildLogs: [
      "[vortex] Static build — no bundler needed, the HTML is the deployment.",
      "[vortex] Stored locally in this browser (IndexedDB). No server touched.",
    ],
  };
}

export const DEFAULT_SITE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>My Monico site</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 48px 24px; background: #0b0e14; color: #e8ecf4; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 2rem; margin: 16px 0; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #1d2536; border: 1px solid #33405c; font-size: 0.8rem; }
  a { color: #7db4ff; }
</style>
</head>
<body>
<main>
  <span class="badge">Deployed with Monico Labs — static build</span>
  <h1>Hello from your site</h1>
  <p>Edit this HTML in the Sites panel, hit <strong>Deploy</strong>, then <strong>Preview</strong> or <strong>Publish public (IPFS)</strong>.</p>
</main>
</body>
</html>
`;
