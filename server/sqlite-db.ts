/**
 * Embedded SQLite engine — the default database backend for Monico Labs.
 *
 * Priority order for all database MCP tools:
 *   1. VORTEX_DATABASE_URL (real Postgres)
 *   2. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Supabase execute_sql RPC)
 *   3. THIS MODULE — embedded SQLite at ./data/vortex.db (zero keys, zero config)
 *   4. The legacy hand-rolled JSON-table engine (only if better-sqlite3 can't load)
 *
 * Tables are namespaced per project as t_<project>_<table>, mirroring the
 * Postgres layout, so agents can move between backends without rewriting SQL.
 *
 * Safety: query_database runs a single statement only (better-sqlite3
 * prepare() rejects multi-statement strings). ATTACH/DETACH and writes to
 * sqlite_% internal tables are refused outright.
 */

import path from "path";
import fs from "fs";

const SQLITE_PATH =
  process.env.VORTEX_SQLITE_PATH ||
  path.join(process.cwd(), "data", "vortex.db");

let DatabaseCtor: any = null;
let loadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DatabaseCtor = require("better-sqlite3");
} catch (err: any) {
  loadError = err?.message || String(err);
}

let db: any = null;

export function sqliteAvailable(): boolean {
  return DatabaseCtor !== null;
}

export function sqliteLoadError(): string | null {
  return loadError;
}

function getDb(): any {
  if (!DatabaseCtor) {
    throw new Error(
      `Embedded SQLite unavailable (${loadError || "better-sqlite3 not installed"}). ` +
        `Falling back to the legacy JSON engine.`
    );
  }
  if (!db) {
    fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
    db = new DatabaseCtor(SQLITE_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS _tables_registry (
        project_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        physical_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (project_id, table_name)
      );
      CREATE TABLE IF NOT EXISTS _app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    console.log(`[vortex-db] Embedded SQLite ready at ${SQLITE_PATH}`);
  }
  return db;
}

export function sqliteDbPath(): string {
  return SQLITE_PATH;
}

/** Same physical-name scheme as the Postgres backend. */
export function sqlitePhysicalTable(projectId: string, tableName: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^([0-9])/, "_$1")
      .slice(0, 60);
  return `t_${clean(projectId)}_${clean(tableName)}`;
}

const FORBIDDEN = [/^\s*attach\b/i, /^\s*detach\b/i, /sqlite_/i];

function guardSql(sql: string): void {
  const t = sql.trim();
  if (!t) throw new Error("Missing SQL string parameter value.");
  for (const re of FORBIDDEN) {
    if (re.test(t)) {
      throw new Error(
        "Refused: ATTACH/DETACH and sqlite_ internal tables are not allowed via query_database."
      );
    }
  }
}

/** Resolve bare logical table names ("SELECT * FROM users") to physical names. */
function resolveLogicalNames(projectId: string, sql: string): string {
  const d = getDb();
  const rows: Array<{ table_name: string; physical_name: string }> = d
    .prepare("SELECT table_name, physical_name FROM _tables_registry WHERE project_id = ?")
    .all(projectId);
  let out = sql;
  for (const r of rows) {
    out = out.replace(new RegExp(`\\b${r.table_name}\\b`, "gi"), `"${r.physical_name}"`);
  }
  return out;
}

export function sqliteCreateTable(
  projectId: string,
  name: string
): { physical: string; created: boolean } {
  const d = getDb();
  const physical = sqlitePhysicalTable(projectId, name);
  const existing = d
    .prepare("SELECT 1 FROM _tables_registry WHERE project_id = ? AND table_name = ?")
    .get(projectId, name);
  if (existing) return { physical, created: false };
  d.exec(
    `CREATE TABLE IF NOT EXISTS "${physical}" (\n` +
      `  id INTEGER PRIMARY KEY AUTOINCREMENT,\n` +
      `  data TEXT NOT NULL DEFAULT '{}',\n` +
      `  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n` +
      `);`
  );
  d.prepare(
    "INSERT INTO _tables_registry (project_id, table_name, physical_name) VALUES (?, ?, ?)"
  ).run(projectId, name, physical);
  return { physical, created: true };
}

export function sqliteListTables(projectId: string): Array<{
  table_name: string;
  physical_name: string;
  created_at: string;
  rowCount: number;
}> {
  const d = getDb();
  const rows: Array<{ table_name: string; physical_name: string; created_at: string }> = d
    .prepare(
      "SELECT table_name, physical_name, created_at FROM _tables_registry WHERE project_id = ? ORDER BY created_at ASC"
    )
    .all(projectId);
  return rows.map((r) => ({
    ...r,
    rowCount: (d.prepare(`SELECT COUNT(*) AS n FROM "${r.physical_name}"`).get() as any).n as number,
  }));
}

export function sqliteDropTable(projectId: string, name: string): boolean {
  const d = getDb();
  const row: any = d
    .prepare("SELECT physical_name FROM _tables_registry WHERE project_id = ? AND table_name = ?")
    .get(projectId, name);
  if (!row) return false;
  d.exec(`DROP TABLE IF EXISTS "${row.physical_name}"`);
  d.prepare("DELETE FROM _tables_registry WHERE project_id = ? AND table_name = ?").run(
    projectId,
    name
  );
  return true;
}

export function sqliteInsert(
  projectId: string,
  tableName: string,
  data: Record<string, any>
): any {
  const d = getDb();
  const { physical } = sqliteCreateTable(projectId, tableName);
  const withDefaults = {
    id: `rec-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
    created_at: new Date().toISOString(),
    ...data,
  };
  const info = d
    .prepare(`INSERT INTO "${physical}" (data) VALUES (?)`)
    .run(JSON.stringify(withDefaults));
  return { rowid: info.lastInsertRowid, ...withDefaults };
}

/**
 * Run one SQL statement against the embedded DB. SELECT returns rows;
 * anything else returns { changes, lastInsertRowid }.
 */
export function sqliteQuery(
  projectId: string,
  sql: string
): { ok: true; rows?: any[]; result?: any; source: "sqlite" } {
  guardSql(sql);
  const resolved = resolveLogicalNames(projectId, sql);
  const d = getDb();
  const stmt = d.prepare(resolved);
  if (stmt.reader) {
    const rows = stmt.all();
    return { ok: true, rows, source: "sqlite" };
  }
  const info = stmt.run();
  return {
    ok: true,
    result: { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) },
    source: "sqlite",
  };
}

/** Crash-safe mirror of the whole app-state blob (replaces the fragile JSON file). */
export function sqliteSaveAppState(payload: unknown): void {
  const d = getDb();
  d.prepare(
    "INSERT INTO _app_state (id, payload, updated_at) VALUES (1, ?, datetime('now')) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at"
  ).run(JSON.stringify(payload));
}

export function sqliteLoadAppState(): any | null {
  const d = getDb();
  const row: any = d.prepare("SELECT payload FROM _app_state WHERE id = 1").get();
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}
