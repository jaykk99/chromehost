import { useEffect, useState } from "react";

interface Health {
  ok: boolean;
  selfContained: boolean;
  storage: string;
  deployMode: string;
  degraded: string[];
  notes: Record<string, string>;
}

/** Honest self-containment banner: green when fully local, amber listing
 *  exactly which integrations are degraded (and why) otherwise. */
export default function SelfContainedBanner() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!health) return null;
  const fullyLocal = health.degraded.length === 0;

  return (
    <div
      style={{
        padding: "8px 16px",
        fontSize: 13,
        background: fullyLocal ? "#0e3b1e" : "#3b2f0e",
        color: "#fff",
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <strong>{fullyLocal ? "● Self-contained" : "● Running local, degraded:"}</strong>
      <span>
        storage: {health.storage} · deploys: {health.deployMode}
      </span>
      {!fullyLocal &&
        health.degraded.map((d) => (
          <span key={d} title={health.notes[d] || d}>
            ⚠ {d}
          </span>
        ))}
    </div>
  );
}
