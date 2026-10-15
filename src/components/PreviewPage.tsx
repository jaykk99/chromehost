import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, FlaskConical } from "lucide-react";
import { emptyState } from "../lib/model";
import type { Deployment } from "../lib/model";
import { createIndexedDBStore, createMemoryStore, isIndexedDBAvailable } from "../lib/store";

/**
 * Local preview route (#/preview/<deploymentId>).
 *
 * No server involved: the deployment's HTML is read from the browser's own
 * IndexedDB and rendered in a sandboxed iframe. The hash-based route works
 * on any static host — local file server, Supabase Storage bucket, or an
 * IPFS gateway path like /ipfs/<cid>/index.html.
 */
export default function PreviewPage({ deploymentId }: { deploymentId: string }) {
  const [dep, setDep] = useState<Deployment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const store = isIndexedDBAvailable() ? createIndexedDBStore() : createMemoryStore();
    store
      .load()
      .then((loaded) => {
        if (cancelled) return;
        const found = (loaded ?? emptyState()).deployments.find((d) => d.id === deploymentId);
        if (found) setDep(found);
        else setError(`No deployment found with id "${deploymentId}" in this browser.`);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [deploymentId]);

  if (error || (dep && !dep.deployedHtml)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d16] p-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-300" />
          <h1 className="mb-2 text-xl font-bold text-white">Preview unavailable</h1>
          <p className="mb-6 text-sm text-slate-400">{error ?? "This deployment has no stored HTML."}</p>
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Monico Labs
          </a>
        </div>
      </div>
    );
  }

  if (!dep) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d16]">
        <div className="flex items-center gap-3 text-slate-400">
          <FlaskConical className="h-6 w-6 animate-pulse text-indigo-300" />
          <p>Loading preview…</p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      title={`Preview of deployment ${dep.id}`}
      srcDoc={dep.deployedHtml}
      sandbox="allow-scripts"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: "none", background: "#fff" }}
    />
  );
}
