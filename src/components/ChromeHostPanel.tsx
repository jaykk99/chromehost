import { useEffect, useState } from "react";

interface ApiKeyMeta {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked: number;
}

interface DeployedApp {
  name: string;
  repo: string;
  runtime: string;
  status: string;
  port: number | null;
  updated_at: string;
}

interface RegistryEntry {
  name: string;
  repo: string;
  runtime: string;
  note?: string;
  env?: string[];
}

const panel: React.CSSProperties = {
  maxWidth: 960,
  margin: "0 auto",
  padding: 20,
  color: "#e8e8e8",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const card: React.CSSProperties = {
  background: "#16181d",
  border: "1px solid #2a2d35",
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = { ...btn, background: "#b91c1c", padding: "6px 12px", fontSize: 13 };
const btnSmall: React.CSSProperties = { ...btn, padding: "6px 12px", fontSize: 13, background: "#374151" };
const btnGreen: React.CSSProperties = { ...btn, padding: "6px 12px", fontSize: 13, background: "#15803d" };

const input: React.CSSProperties = {
  background: "#0d0f13",
  border: "1px solid #2a2d35",
  borderRadius: 8,
  color: "#e8e8e8",
  padding: "10px 12px",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

function useStoredKey(): [string, (k: string) => void] {
  const [key, setKey] = useState(() => localStorage.getItem("chromehost_key") || "");
  const save = (k: string) => {
    setKey(k);
    if (k) localStorage.setItem("chromehost_key", k);
    else localStorage.removeItem("chromehost_key");
  };
  return [key, save];
}

async function api(key: string, path: string, opts: RequestInit = {}) {
  const res = await fetch(`/api/chromehost${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-API-Key": key, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

export default function ChromeHostPanel() {
  const [key, setKey] = useStoredKey();
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [apps, setApps] = useState<DeployedApp[]>([]);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("");
  const [composio, setComposio] = useState<{ configured: boolean; source: string; masked: string | null } | null>(null);
  const [composioKey, setComposioKey] = useState("");
  const [deployTarget, setDeployTarget] = useState<RegistryEntry | null>(null);
  const [envVars, setEnvVars] = useState<Array<{ key: string; defaultValue: string; comment: string }>>([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envSource, setEnvSource] = useState<string | null>(null);

  const authed = key.length > 0;

  const refresh = async () => {
    if (!authed) return;
    setError("");
    try {
      const k = await api(key, "/keys");
      setKeys(k.keys);
      const a = await api(key, "/apps");
      setApps(a.apps);
      setRegistry(a.registry);
      const s = await api(key, "/settings");
      setComposio(s.composio);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const generateKey = async () => {
    setError("");
    setNewKey(null);
    try {
      // Bootstrap: first key needs no auth header value, but fetch still sends one.
      const data = await api(key, "/keys", { method: "POST", body: JSON.stringify({ name: keyName }) });
      setNewKey(data.key);
      setKeyName("");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const useThisKey = () => {
    if (newKey) {
      setKey(newKey);
      setNewKey(null);
    }
  };

  const revokeKey = async (id: number) => {
    if (!confirm("Revoke this API key?")) return;
    try {
      await api(key, `/keys/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const saveComposioKey = async () => {
    setError("");
    try {
      await api(key, "/settings/composio-key", {
        method: "POST",
        body: JSON.stringify({ key: composioKey }),
      });
      setComposioKey("");
      const s = await api(key, "/settings");
      setComposio(s.composio);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeComposioKey = async () => {
    if (!confirm("Remove the stored Composio key?")) return;
    try {
      await api(key, "/settings/composio-key", { method: "DELETE" });
      const s = await api(key, "/settings");
      setComposio(s.composio);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deploy = async (entry: RegistryEntry) => {
    // Step 1: read the repo's .env.example so the user fills real values.
    setBusy(entry.name);
    setError("");
    try {
      const t = await api(key, `/apps/env-template?name=${encodeURIComponent(entry.name)}`);
      setEnvVars(t.vars || []);
      setEnvSource(t.source);
      const initial: Record<string, string> = {};
      for (const v of t.vars || []) initial[v.key] = v.defaultValue;
      setEnvValues(initial);
      setDeployTarget(entry);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const confirmDeploy = async () => {
    if (!deployTarget) return;
    setBusy(deployTarget.name);
    setError("");
    try {
      // Only send non-empty values.
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(envValues)) {
        if (v.trim()) env[k] = v.trim();
      }
      await api(key, "/apps/deploy", {
        method: "POST",
        body: JSON.stringify({ name: deployTarget.name, env }),
      });
      setDeployTarget(null);
      setEnvVars([]);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const toggleApp = async (app: DeployedApp) => {
    setBusy(app.name);
    try {
      await api(key, `/apps/${app.name}/${app.status === "running" ? "stop" : "start"}`, { method: "POST" });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const showLogs = async (app: DeployedApp) => {
    try {
      const data = await api(key, `/apps/${app.name}/logs?tail=120`);
      setLogs((l) => ({ ...l, [app.name]: data.logs || "(no logs)" }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div style={panel}>
      <h1 style={{ fontSize: 26, margin: "8px 0 4px" }}>ChromeHost</h1>
      <p style={{ color: "#9ca3af", marginTop: 0 }}>
        Self-hosted app platform. Deploy Jay&apos;s apps on this machine, manage them remotely with an API key.
      </p>

      {error && (
        <div style={{ ...card, borderColor: "#b91c1c", color: "#fca5a5" }}>{error}</div>
      )}

      <div style={card}>
        <h2 style={{ marginTop: 0 }}>API key</h2>
        {!authed ? (
          <>
            <p style={{ color: "#9ca3af" }}>
              No API key saved in this browser. Generate your first key below (no auth needed while zero
              keys exist), then save it to unlock this panel.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={input}
                placeholder="Key name (optional, e.g. jay-phone)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
              <button style={btn} onClick={generateKey}>
                Generate API Key
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#9ca3af" }}>Saved key: {key.slice(0, 10)}…</span>
            <button style={btnSmall} onClick={() => setKey("")}>
              Forget key
            </button>
            <input
              style={{ ...input, maxWidth: 220 }}
              placeholder="New key name"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
            <button style={btn} onClick={generateKey}>
              Generate API Key
            </button>
          </div>
        )}
        {newKey && (
          <div
            style={{
              ...card,
              marginTop: 12,
              marginBottom: 0,
              borderColor: "#15803d",
              background: "#0e2a17",
            }}
          >
            <strong>Copy this key now — it will never be shown again.</strong>
            <div
              style={{
                ...input,
                marginTop: 8,
                fontFamily: "monospace",
                wordBreak: "break-all",
                userSelect: "all",
              }}
            >
              {newKey}
            </div>
            <div style={{ marginTop: 8 }}>
              <button style={btnGreen} onClick={useThisKey}>
                Save &amp; use this key
              </button>
            </div>
          </div>
        )}
      </div>

      {authed && (
        <>
          <div style={card}>
            <h2 style={{ marginTop: 0 }}>Keys ({keys.filter((k) => !k.revoked).length} active)</h2>
            {keys.length === 0 && <p style={{ color: "#9ca3af" }}>No keys yet.</p>}
            {keys.map((k) => (
              <div
                key={k.id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "8px 0",
                  borderTop: "1px solid #23262d",
                  opacity: k.revoked ? 0.5 : 1,
                }}
              >
                <span style={{ fontFamily: "monospace" }}>{k.key_prefix}</span>
                <span style={{ color: "#9ca3af" }}>{k.name || "(unnamed)"}</span>
                <span style={{ color: "#6b7280", fontSize: 12 }}>
                  {k.last_used_at ? `last used ${k.last_used_at}` : "never used"}
                </span>
                {!k.revoked ? (
                  <button style={btnDanger} onClick={() => revokeKey(k.id)}>
                    Revoke
                  </button>
                ) : (
                  <span style={{ color: "#b91c1c" }}>revoked</span>
                )}
              </div>
            ))}
          </div>

          <div style={card}>
            <h2 style={{ marginTop: 0 }}>Composio</h2>
            <p style={{ color: "#9ca3af", marginTop: 0 }}>
              Powers Gmail, social posting, and other agent tools. The key is stored
              server-side only — the browser only ever sees a masked preview.
            </p>
            {composio ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: composio.configured ? "#4ade80" : "#9ca3af" }}>
                  {composio.configured
                    ? `● Configured (${composio.source}${composio.masked ? `, ${composio.masked}` : ""})`
                    : "○ Not configured"}
                </span>
              </div>
            ) : (
              <p style={{ color: "#6b7280" }}>Loading…</p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                style={input}
                type="password"
                placeholder="Paste COMPOSIO_API_KEY"
                value={composioKey}
                onChange={(e) => setComposioKey(e.target.value)}
              />
              <button style={btn} onClick={saveComposioKey} disabled={!composioKey.trim()}>
                Save key
              </button>
              {composio?.configured && composio.source === "settings" && (
                <button style={btnDanger} onClick={removeComposioKey}>
                  Remove
                </button>
              )}
            </div>
          </div>

          <div style={card}>
            <h2 style={{ marginTop: 0 }}>Deployed apps</h2>
            {apps.length === 0 && (
              <p style={{ color: "#9ca3af" }}>Nothing deployed yet. Use the registry below for one-click deploys.</p>
            )}
            {apps.map((a) => (
              <div key={a.name} style={{ borderTop: "1px solid #23262d", padding: "10px 0" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{a.name}</strong>
                  <span
                    style={{
                      color: a.status === "running" ? "#4ade80" : "#9ca3af",
                      fontSize: 13,
                    }}
                  >
                    ● {a.status}
                  </span>
                  {a.port && (
                    <a
                      href={`http://localhost:${a.port}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#60a5fa", fontSize: 13 }}
                    >
                      localhost:{a.port}
                    </a>
                  )}
                  <button style={btnSmall} disabled={busy === a.name} onClick={() => toggleApp(a)}>
                    {busy === a.name ? "…" : a.status === "running" ? "Stop" : "Start"}
                  </button>
                  <button style={btnSmall} onClick={() => showLogs(a)}>
                    Logs
                  </button>
                </div>
                {logs[a.name] && (
                  <pre
                    style={{
                      background: "#0d0f13",
                      padding: 10,
                      borderRadius: 8,
                      fontSize: 12,
                      maxHeight: 220,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {logs[a.name]}
                  </pre>
                )}
              </div>
            ))}
          </div>

          <div style={card}>
            <h2 style={{ marginTop: 0 }}>One-click deploy</h2>
            <p style={{ color: "#9ca3af", marginTop: 0 }}>
              Jay&apos;s repos. Deploys clone the repo, build a Docker image, and start a container.
            </p>
            {registry.map((entry) => {
              const deployed = apps.some((a) => a.name === entry.name);
              return (
                <div
                  key={entry.name}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 0",
                    borderTop: "1px solid #23262d",
                    flexWrap: "wrap",
                  }}
                >
                  <strong>{entry.name}</strong>
                  <span style={{ color: "#6b7280", fontSize: 12 }}>{entry.runtime}</span>
                  {entry.note && <span style={{ color: "#9ca3af", fontSize: 13 }}>{entry.note}</span>}
                  {deployed ? (
                    <span style={{ color: "#4ade80", fontSize: 13 }}>deployed</span>
                  ) : (
                    <button style={btnGreen} disabled={busy === entry.name} onClick={() => deploy(entry)}>
                      {busy === entry.name ? "Deploying…" : "Deploy"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {deployTarget && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 50,
                padding: 16,
              }}
              onClick={() => setDeployTarget(null)}
            >
              <div
                style={{ ...card, maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "auto", marginBottom: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <h2 style={{ marginTop: 0 }}>Deploy {deployTarget.name}</h2>
                {envSource ? (
                  <>
                    <p style={{ color: "#9ca3af" }}>
                      This repo has a <code>.env.example</code> — fill in the values you want the
                      container to get. Leave blank to skip.
                    </p>
                    {envVars.map((v) => (
                      <div key={v.key} style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>
                          {v.key}
                        </label>
                        {v.comment && (
                          <div style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 4px" }}>{v.comment}</div>
                        )}
                        <input
                          style={input}
                          type="password"
                          placeholder={v.defaultValue ? `default: ${v.defaultValue}` : "leave blank to skip"}
                          value={envValues[v.key] ?? ""}
                          onChange={(e) => setEnvValues((s) => ({ ...s, [v.key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <p style={{ color: "#9ca3af" }}>
                    No <code>.env.example</code> found in this repo — deploying without extra env vars.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button style={btnGreen} disabled={busy === deployTarget.name} onClick={confirmDeploy}>
                    {busy === deployTarget.name ? "Deploying…" : "Deploy now"}
                  </button>
                  <button style={btnSmall} onClick={() => setDeployTarget(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={card}>
            <h2 style={{ marginTop: 0 }}>Remote API</h2>
            <p style={{ color: "#9ca3af" }}>
              Manage this machine from anywhere. Send your API key as the <code>X-API-Key</code> header.
            </p>
            <pre
              style={{
                background: "#0d0f13",
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                overflowX: "auto",
              }}
            >
{`curl -H "X-API-Key: YOUR_KEY" http://HOST:3000/api/chromehost/health
curl -H "X-API-Key: YOUR_KEY" http://HOST:3000/api/chromehost/apps
curl -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"ops-board"}' http://HOST:3000/api/chromehost/apps/deploy`}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
