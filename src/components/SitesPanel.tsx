import { useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  Plus,
  Trash2,
  Rocket,
  Eye,
  Globe,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Terminal,
  Monitor,
  Tablet,
  Smartphone,
  RotateCcw,
  HardDrive,
  Cpu,
  FileCode2,
  ExternalLink,
  AlertTriangle,
  Info,
  Sparkles,
  Layers,
  Send,
} from "lucide-react";
import { DEFAULT_SITE_TEMPLATE, emptyState, newDeployment, newProject } from "../lib/model";
import type { AppState, Deployment, Project } from "../lib/model";
import { createIndexedDBStore, createMemoryStore, isIndexedDBAvailable } from "../lib/store";
import type { StateStore } from "../lib/store";
import { desktopPlatform, featureList, isDesktopApp } from "../lib/env";
import { publishHtmlToIpfs } from "../lib/ipfs";

const IPFS_HONESTY_NOTE =
  "Public via IPFS gateways. This browser is the provider while the page is open; " +
  "gateways were asked to cache a copy so the link can survive this tab closing. " +
  "Permanent availability is not guaranteed without paid pinning (not used). " +
  "Static HTML only — anything needing a backend can't work this way.";

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatTime(iso);
}

/* ---------------------------------- bits ---------------------------------- */

function Badge({ tone, children, title }: { tone: "ok" | "info" | "warn"; children: React.ReactNode; title?: string }) {
  const tones = {
    ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>{icon}</div>
        <div>
          <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
          <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- log console ------------------------------ */

function logLineClass(line: string): string {
  const l = line.toLowerCase();
  if (line.includes("🎉") || l.includes("successful") || l.includes("✓")) return "text-emerald-300";
  if (l.includes("error") || l.includes("failed") || l.includes("✗")) return "text-rose-300 font-semibold";
  if (line.includes("[vortex]")) return "text-slate-500";
  if (line.includes("[compiler]") || line.includes("[vite]") || line.includes("[next]")) return "text-indigo-300";
  return "text-slate-300";
}

function LogConsole({ logs, status }: { logs: string[]; status: Deployment["status"] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () => logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase())),
    [logs, filter]
  );
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/5"
      >
        <Terminal className="h-4 w-4 text-indigo-300" />
        <span className="font-medium">Build logs</span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-400">
          {logs.length} lines
        </span>
        <span className="ml-auto text-slate-500">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
      </button>
      {open && (
        <div className="border-t border-white/10">
          <div className="border-b border-white/5 px-4 py-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter log lines…"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-400/60"
            />
          </div>
          <div className="max-h-64 space-y-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed">
            {filtered.length === 0 ? (
              <p className="text-slate-500">No log lines match.</p>
            ) : (
              filtered.map((line, i) => (
                <div key={i} className={`whitespace-pre-wrap break-words ${logLineClass(line)}`}>
                  <span className="mr-2 select-none text-slate-600">{String(i + 1).padStart(2, "0")}</span>
                  {line}
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t border-white/5 px-4 py-1.5 font-mono text-[10px] text-slate-500">
            <span>
              {filtered.length} / {logs.length} lines
            </span>
            <span className={status === "ready" ? "text-emerald-400" : status === "error" ? "text-rose-400" : "text-amber-400"}>
              {status.toUpperCase()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- device preview ---------------------------- */

function DevicePreview({ dep }: { dep: Deployment }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [key, setKey] = useState(0);
  if (!dep.deployedHtml) return null;
  const widths = { desktop: "w-full", tablet: "w-[680px] max-w-full", mobile: "w-[375px] max-w-full" } as const;
  const modes = [
    { id: "desktop" as const, icon: <Monitor className="h-4 w-4" />, label: "Desktop" },
    { id: "tablet" as const, icon: <Tablet className="h-4 w-4" />, label: "Tablet" },
    { id: "mobile" as const, icon: <Smartphone className="h-4 w-4" />, label: "Mobile" },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white"
        >
          <Eye className="h-4 w-4 text-sky-300" />
          Live preview
          <span className="text-slate-500">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        </button>
        {open && (
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
              {modes.map((m) => (
                <button
                  key={m.id}
                  title={m.label}
                  onClick={() => setMode(m.id)}
                  className={`rounded-md p-1.5 transition ${mode === m.id ? "bg-indigo-500/30 text-indigo-200" : "text-slate-500 hover:text-slate-200"}`}
                >
                  {m.icon}
                </button>
              ))}
            </div>
            <button
              title="Reload preview"
              onClick={() => setKey((k) => k + 1)}
              className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            {dep.previewUrl && (
              <a
                title="Open full page"
                href={dep.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="flex justify-center border-t border-white/10 bg-black/60 p-4">
          <div className={`h-[420px] overflow-hidden rounded-lg border border-white/10 bg-white shadow-inner transition-all duration-300 ${widths[mode]}`}>
            <iframe
              key={key}
              title={`Preview of ${dep.id}`}
              srcDoc={dep.deployedHtml}
              sandbox="allow-scripts"
              className="h-full w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ deployment card ---------------------------- */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — nothing to do */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

const statusStyles = {
  ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  building: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  error: "border-rose-500/40 bg-rose-500/10 text-rose-300",
} as const;

function DeploymentCard({
  dep,
  isActive,
  publishing,
  onPublish,
  onDelete,
}: {
  dep: Deployment;
  isActive: boolean;
  publishing: boolean;
  onPublish: (dep: Deployment) => void;
  onDelete: (dep: Deployment) => void;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${statusStyles[dep.status]}`}>
          {dep.status}
        </span>
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300">
            <Sparkles className="h-3 w-3" /> live
          </span>
        )}
        <span className="font-mono text-xs text-slate-500" title={dep.id}>
          {shortId(dep.id)}
        </span>
        <span className="ml-auto text-xs text-slate-500" title={formatTime(dep.createdAt)}>
          {timeAgo(dep.createdAt)}
        </span>
      </div>

      {dep.commitMessage && <p className="mb-4 text-sm text-slate-300">{dep.commitMessage}</p>}

      <div className="mb-4 space-y-3">
        <LogConsole logs={dep.buildLogs ?? []} status={dep.status} />
        <DevicePreview dep={dep} />
      </div>

      {dep.ipfsCid ? (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Globe className="h-4 w-4 text-sky-300" />
            <span className="font-medium text-sky-200">Published to IPFS</span>
            <span className="ml-auto">
              <CopyButton text={dep.ipfsCid} label="Copy CID" />
            </span>
          </div>
          <code className="block break-all font-mono text-xs text-sky-300/90">{dep.ipfsCid}</code>
          <div className="mt-2 flex flex-col gap-1">
            {(dep.ipfsUrls ?? []).slice(0, 2).map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="truncate text-xs text-sky-400/80 underline decoration-sky-400/30 hover:text-sky-300">
                {u}
              </a>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{IPFS_HONESTY_NOTE}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {dep.previewUrl && (
          <a
            href={dep.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <Eye className="h-4 w-4" /> Open preview
          </a>
        )}
        {dep.deployedHtml && !dep.ipfsCid && (
          <button
            onClick={() => onPublish(dep)}
            disabled={publishing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> {publishing ? "Publishing…" : "Publish public (IPFS)"}
          </button>
        )}
        <button
          onClick={() => onDelete(dep)}
          title="Delete deployment"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-rose-500/40 hover:text-rose-300"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </article>
  );
}

/* --------------------------------- main ----------------------------------- */

export default function SitesPanel() {
  const [store] = useState<StateStore>(() =>
    isIndexedDBAvailable() ? createIndexedDBStore() : createMemoryStore()
  );
  const [state, setState] = useState<AppState>(emptyState());
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .load()
      .then((loaded) => {
        if (cancelled) return;
        const s = loaded ?? emptyState();
        setState(s);
        if (!selectedProjectId && s.projects.length > 0) {
          setSelectedProjectId(s.projects[0].id);
        }
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setBootError(err instanceof Error ? err.message : String(err));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const persist = (next: AppState): void => {
    setState(next);
    store.save(next).catch((err) => {
      setBootError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const selectedProject: Project | null = useMemo(
    () => state.projects.find((p) => p.id === selectedProjectId) ?? null,
    [state.projects, selectedProjectId]
  );

  const projectDeployments = useMemo(
    () =>
      state.deployments
        .filter((d) => d.projectId === selectedProjectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [state.deployments, selectedProjectId]
  );

  const publishedCount = useMemo(() => state.deployments.filter((d) => d.ipfsCid).length, [state.deployments]);
  const features = useMemo(() => featureList(), []);

  const createProject = (): void => {
    const name = newName.trim();
    if (!name) return;
    const project = newProject(name);
    persist({ projects: [project, ...state.projects], deployments: state.deployments });
    setSelectedProjectId(project.id);
    setNewName("");
  };

  const deleteProject = (project: Project): void => {
    if (!window.confirm(`Delete project "${project.name}" and all its deployments? This can't be undone.`)) return;
    const projects = state.projects.filter((p) => p.id !== project.id);
    const deployments = state.deployments.filter((d) => d.projectId !== project.id);
    persist({ projects, deployments });
    if (selectedProjectId === project.id) {
      setSelectedProjectId(projects[0]?.id ?? null);
    }
  };

  const deleteDeployment = (dep: Deployment): void => {
    if (!window.confirm(`Delete deployment ${shortId(dep.id)}? This can't be undone.`)) return;
    const deployments = state.deployments.filter((d) => d.id !== dep.id);
    const projects = state.projects.map((p) =>
      p.id === dep.projectId && p.activeDeploymentId === dep.id ? { ...p, activeDeploymentId: undefined } : p
    );
    persist({ projects, deployments });
  };

  const deploy = (): void => {
    if (!selectedProject) return;
    const html = drafts[selectedProject.id] ?? DEFAULT_SITE_TEMPLATE;
    if (!html.trim()) return;
    const dep = newDeployment(selectedProject.id, html);
    persist({
      projects: state.projects.map((p) =>
        p.id === selectedProject.id ? { ...p, activeDeploymentId: dep.id } : p
      ),
      deployments: [dep, ...state.deployments],
    });
    setDrafts((d) => {
      const copy = { ...d };
      delete copy[selectedProject.id];
      return copy;
    });
  };

  const resetDraft = (): void => {
    if (!selectedProject) return;
    setDrafts((d) => {
      const copy = { ...d };
      delete copy[selectedProject.id];
      return copy;
    });
  };

  const publish = async (dep: Deployment): Promise<void> => {
    if (!dep.deployedHtml) {
      setPublishError("This deployment has no HTML payload — only static HTML deployments can be published.");
      return;
    }
    setPublishingId(dep.id);
    setPublishError(null);
    try {
      const result = await publishHtmlToIpfs(dep.deployedHtml);
      persist({
        ...state,
        deployments: state.deployments.map((d) =>
          d.id === dep.id
            ? { ...d, ipfsCid: result.cid, ipfsUrls: result.urls, ipfsPublishedAt: new Date().toISOString() }
            : d
        ),
      });
    } catch (err) {
      setPublishError(
        `IPFS publish failed: ${err instanceof Error ? err.message : String(err)}. ` +
          "The in-browser node needs network access to IPFS transports — try again, or publish from the desktop app."
      );
    } finally {
      setPublishingId(null);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d16]">
        <div className="flex items-center gap-3 text-slate-400">
          <FlaskConical className="h-6 w-6 animate-pulse text-indigo-300" />
          <p>Loading Monico Labs…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d16] text-slate-200 antialiased">
      {/* ambient background */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-96 rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        {/* header */}
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
              <FlaskConical className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Monico Labs</h1>
              <p className="text-sm text-slate-400">Static lab — sites live in this browser, no backend, no keys.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="ok" title="All project data stays in this browser">
              <HardDrive className="h-3.5 w-3.5" />
              {isIndexedDBAvailable() ? "IndexedDB · this browser" : "Memory · not durable"}
            </Badge>
            {isDesktopApp ? (
              <Badge tone="info" title={`Running inside the desktop app on ${desktopPlatform ?? "unknown platform"}`}>
                <Cpu className="h-3.5 w-3.5" /> Desktop app
              </Badge>
            ) : (
              <Badge tone="warn" title="Plain web build — desktop-only features are labelled, never faked">
                <Info className="h-3.5 w-3.5" /> Web build
              </Badge>
            )}
          </div>
        </header>

        {bootError && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{bootError}</span>
          </div>
        )}
        {!isIndexedDBAvailable() && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              This browser has no IndexedDB — projects will live in memory only and vanish on reload. Use a real
              browser (or the desktop app) for durable storage.
            </span>
          </div>
        )}

        {/* stats */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={<Layers className="h-5 w-5 text-indigo-200" />} label="Projects" value={state.projects.length} accent="bg-indigo-500/20" />
          <StatCard icon={<Rocket className="h-5 w-5 text-sky-200" />} label="Deployments" value={state.deployments.length} accent="bg-sky-500/20" />
          <StatCard icon={<Globe className="h-5 w-5 text-emerald-200" />} label="On IPFS" value={publishedCount} accent="bg-emerald-500/20" />
        </div>

        {/* features */}
        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">What works here</h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <li
                key={f.id}
                className={`flex gap-3 rounded-xl border p-3.5 ${
                  f.availableInBrowser ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-amber-500/20 bg-amber-500/[0.04]"
                }`}
              >
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${f.availableInBrowser ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-slate-100">{f.name}</strong>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${f.availableInBrowser ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                      {f.availableInBrowser ? "works here" : "desktop app only"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* main columns */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          {/* projects */}
          <section className="h-fit rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur lg:sticky lg:top-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">Projects</h2>
            <div className="mb-4 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New site name…"
                maxLength={80}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createProject();
                }}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-400/60"
              />
              <button
                onClick={createProject}
                disabled={!newName.trim()}
                title="Create project"
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {state.projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
                <FileCode2 className="mx-auto mb-2 h-8 w-8 text-slate-600" />
                <p className="text-sm text-slate-400">No projects yet — create one to get started.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {state.projects.map((p) => {
                  const count = state.deployments.filter((d) => d.projectId === p.id).length;
                  const active = p.id === selectedProjectId;
                  return (
                    <li key={p.id} className="group relative">
                      <button
                        onClick={() => setSelectedProjectId(p.id)}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          active
                            ? "border-indigo-400/60 bg-indigo-500/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-100">{p.name}</span>
                          <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                            {count}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px] text-slate-500" title={p.id}>
                          {shortId(p.id)}
                        </div>
                      </button>
                      <button
                        onClick={() => deleteProject(p)}
                        title={`Delete ${p.name}`}
                        className="absolute right-2 top-2 rounded-md p-1 text-slate-600 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* deployments */}
          <section className="min-w-0">
            {!selectedProject ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center">
                <Rocket className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                <p className="text-slate-400">Select a project to manage its deployments.</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-bold text-white">{selectedProject.name}</h2>
                  <span className="font-mono text-xs text-slate-500" title={selectedProject.id}>
                    {shortId(selectedProject.id)}
                  </span>
                  <span className="text-xs text-slate-500">created {timeAgo(selectedProject.createdAt)}</span>
                </div>

                {/* deploy editor */}
                <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
                  <label htmlFor="deploy-html" className="mb-2 block text-sm font-medium text-slate-300">
                    Site HTML <span className="font-normal text-slate-500">— static, this is the whole deployment</span>
                  </label>
                  <textarea
                    id="deploy-html"
                    rows={10}
                    spellCheck={false}
                    value={drafts[selectedProject.id] ?? DEFAULT_SITE_TEMPLATE}
                    onChange={(e) => setDrafts((d) => ({ ...d, [selectedProject.id]: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-indigo-400/60"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={deploy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                    >
                      <Rocket className="h-4 w-4" /> Deploy
                    </button>
                    <button
                      onClick={resetDraft}
                      title="Reset editor to the default template"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
                    >
                      <RotateCcw className="h-4 w-4" /> Reset template
                    </button>
                  </div>
                </div>

                {publishError && (
                  <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <span>{publishError}</span>
                  </div>
                )}

                {projectDeployments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center">
                    <Rocket className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                    <p className="text-slate-400">No deployments yet — write some HTML above and hit Deploy.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {projectDeployments.map((dep) => (
                      <DeploymentCard
                        key={dep.id}
                        dep={dep}
                        isActive={selectedProject.activeDeploymentId === dep.id}
                        publishing={publishingId === dep.id}
                        onPublish={publish}
                        onDelete={deleteDeployment}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* self-hosting loop */}
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">The self-hosting loop</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            This page <em className="text-slate-200">is</em> the app. Build once (
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-sky-300">npm run build</code> →{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-sky-300">dist/</code>), publish{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-sky-300">dist/</code> to IPFS from
            the desktop app — or drop it in a public Supabase Storage bucket (free tier) — and from then on the app
            deploys itself. Once online, it hosts itself: new sites you publish from it are just more static files.
          </p>
        </section>
      </div>
    </div>
  );
}
