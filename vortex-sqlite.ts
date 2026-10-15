/**
 * vortex-sqlite.ts — embedded SQLite backend for Monico Labs (Monico Labs).
 *
 * This is the DEFAULT database. It needs zero environment variables, zero
 * accounts, zero external services: a single file at
 *   <VORTEX_DATA_DIR or ./data>/vortex.db
 * created with Node's built-in node:sqlite (no native addons, no npm deps).
 *
 * It stores two things:
 *  1. The whole app-state blob (projects, deployments, domains, ...) in the
 *     `_vortex_state` table — this replaces the old vortex_local_db.json file.
 *  2. The MCP "database tools" tables (one real SQLite table per project
 *     table, tracked in `_vortex_tables`) — this replaces the old in-memory
 *     local-JSON engine + hand-rolled SQL parser.
 *
 * OPTIONAL overrides (never required):
 *  - VORTEX_DATABASE_URL: use a real Postgres for the MCP database tools
 *    (handled in server.ts; this module is then only used for app state).
 *  - Firestore credentials / Supabase keys: optional mirrors, handled in
 *    server.ts. Nothing here needs them.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

/** Directory holding vortex.db. Override with VORTEX_DATA_DIR (Docker: /data). */
export function vortexDataDir(): string {
  return process.env.VORTEX_DATA_DIR || path.join(process.cwd(), "data");
}

/** Full path of the SQLite file, creating the directory if needed. */
export function vortexDbPath(): string {
  const dir = vortexDataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // If we can't create the dir, DatabaseSync will throw a clear error below.
  }
  return path.join(dir, "vortex.db");
}

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS _vortex_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS _vortex_tables (
  project_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  physical_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, table_name)
);
`;

/** Open (or reuse) the embedded database and ensure the schema exists. */
export function getVortexDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(vortexDbPath());
    db.exec(SCHEMA);
  }
  return db;
}

/** Close the database (mainly useful for tests). */
export function closeVortexDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
  }
}

// ---------------------------------------------------------------------------
// App-state blob (replaces vortex_local_db.json)
// ---------------------------------------------------------------------------

const STATE_ID = "singleton";

/** Persist the whole app-state object. Never throws — logs and continues. */
export function saveAppStateBlob(data: unknown): void {
  try {
    const d = getVortexDb();
    d.prepare(
      `INSERT INTO _vortex_state (id, data, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
    ).run(STATE_ID, JSON.stringify(data));
  } catch (err) {
    console.error("[vortex-db] SQLite app-state write error:", (err as Error)?.message || err);
  }
}

/** Load the app-state object, or null when nothing was stored yet. */
export function loadAppStateBlob(): any | null {
  try {
    const d = getVortexDb();
    const row = d.prepare(`SELECT data FROM _vortex_state WHERE id = ?`).get(STATE_ID) as
      | { data: string }
      | undefined;
    if (!row || !row.data) return null;
    return JSON.parse(row.data);
  } catch (err) {
    console.error("[vortex-db] SQLite app-state read error:", (err as Error)?.message || err);
    return null;
  }
}

/**
 * One-time migration from the legacy vortex_local_db.json file.
 * Copies the app-state blob AND the old per-project JSON tables into SQLite,
 * then renames the JSON file to *.migrated.json so it never runs twice.
 * Returns true when a migration was performed.
 */
export function importLegacyJsonDb(jsonPath: string): boolean {
  try {
    if (!fs.existsSync(jsonPath)) return false;
    if (loadAppStateBlob() !== null) return false; // SQLite already has state
    const raw = fs.readFileSync(jsonPath, "utf-8");
    if (!raw.trim()) return false;
    const data = JSON.parse(raw);

    // 1) Migrate old per-project JSON tables into real SQLite tables.
    const legacyTables = (data && data.databaseTables) as
      | Record<string, Array<{ name: string; rows: Array<Record<string, unknown>> }>>
      | undefined;
    if (legacyTables && typeof legacyTables === "object") {
      for (const [projectId, tables] of Object.entries(legacyTables)) {
        if (!Array.isArray(tables)) continue;
        for (const t of tables) {
          if (!t || typeof t.name !== "string") continue;
          try {
            sqliteCreateTable(projectId, t.name);
            if (Array.isArray(t.rows)) {
              for (const row of t.rows) {
                try {
                  sqliteInsertRecord(projectId, t.name, row ?? {});
                } catch {
                  // skip bad rows, keep migrating the rest
                }
              }
            }
          } catch {
            // skip bad tables, keep migrating the rest
          }
        }
      }
      if (data) data.databaseTables = {}; // rows now live in SQLite
    }

    // 2) Store the blob itself.
    saveAppStateBlob(data);
    try {
      fs.renameSync(jsonPath, jsonPath + ".migrated.json");
    } catch {
      // non-fatal
    }
    console.log("[vortex-db] Migrated legacy vortex_local_db.json into SQLite.");
    return true;
  } catch (err) {
    console.error("[vortex-db] Legacy JSON import failed:", (err as Error)?.message || err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// MCP database-tools tables (real SQLite tables, namespaced per project)
// ---------------------------------------------------------------------------

export function vortexSanitizeIdent(raw: string): string {
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^([0-9])/, "_$1")
    .slice(0, 60);
}

export function vortexPhysicalTableName(projectId: string, tableName: string): string {
  return `t_${vortexSanitizeIdent(projectId)}_${vortexSanitizeIdent(tableName)}`;
}

export interface VortexTableInfo {
  table_name: string;
  physical_name: string;
  created_at: string;
  row_count: number;
}

export function sqliteListTables(projectId: string): VortexTableInfo[] {
  const d = getVortexDb();
  const rows = d
    .prepare(
      `SELECT table_name, physical_name, created_at FROM _vortex_tables WHERE project_id = ? ORDER BY created_at ASC`
    )
    .all(projectId) as Array<{ table_name: string; physical_name: string; created_at: string }>;
  return rows.map((r) => {
    let rowCount = 0;
    try {
      const c = d.prepare(`SELECT COUNT(*) AS n FROM "${r.physical_name}"`).get() as { n: number };
      rowCount = c.n;
    } catch {
      rowCount = 0;
    }
    return { ...r, row_count: rowCount };
  });
}

export function sqliteCreateTable(
  projectId: string,
  tableName: string
): { created: boolean; physical_name: string } {
  const d = getVortexDb();
  const physical = vortexPhysicalTableName(projectId, tableName);
  d.prepare(
    `CREATE TABLE IF NOT EXISTS "${physical}" (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       data TEXT NOT NULL DEFAULT '{}',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ).run();
  const res = d
    .prepare(
      `INSERT INTO _vortex_tables (project_id, table_name, physical_name) VALUES (?, ?, ?)
       ON CONFLICT (project_id, table_name) DO NOTHING`
    )
    .run(projectId, tableName, physical);
  return { created: res.changes > 0, physical_name: physical };
}

export function sqliteDropTable(projectId: string, tableName: string): boolean {
  const d = getVortexDb();
  const reg = d
    .prepare(`SELECT physical_name FROM _vortex_tables WHERE project_id = ? AND table_name = ?`)
    .get(projectId, tableName) as { physical_name: string } | undefined;
  if (!reg) return false;
  d.prepare(`DROP TABLE IF EXISTS "${reg.physical_name}"`).run();
  d.prepare(`DELETE FROM _vortex_tables WHERE project_id = ? AND table_name = ?`).run(
    projectId,
    tableName
  );
  return true;
}

/** Resolve a logical table name used in SQL to its physical SQLite table. */
export function sqlitePhysicalName(projectId: string, tableName: string): string | null {
  const d = getVortexDb();
  const reg = d
    .prepare(`SELECT physical_name FROM _vortex_tables WHERE project_id = ? AND table_name = ?`)
    .get(projectId, tableName) as { physical_name: string } | undefined;
  return reg ? reg.physical_name : null;
}

/**
 * Rewrite bare logical table names in a SQL string to their physical names,
 * so agents can keep writing `SELECT * FROM users`.
 */
export function sqliteResolveSql(projectId: string, sql: string): string {
  const d = getVortexDb();
  const regs = d
    .prepare(`SELECT table_name, physical_name FROM _vortex_tables WHERE project_id = ?`)
    .all(projectId) as Array<{ table_name: string; physical_name: string }>;
  let out = sql;
  for (const r of regs) {
    const pattern = new RegExp(`\\b${r.table_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(pattern, `"${r.physical_name}"`);
  }
  return out;
}

export interface SqliteQueryResult {
  rows: any[];
  rowCount: number;
  command: string;
}

/**
 * Run real SQL against the project's tables. SELECT returns rows; anything
 * else runs and reports affected rows. Throws a plain Error on bad SQL.
 */
export function sqliteQuery(projectId: string, sql: unknown): SqliteQueryResult {
  if (!sql || typeof sql !== "string" || !sql.trim()) {
    throw new Error("Missing SQL string parameter value.");
  }
  const d = getVortexDb();
  const resolved = sqliteResolveSql(projectId, sql.trim());
  const command = resolved.trim().split(/\s+/, 1)[0].toUpperCase();
  try {
    if (command === "SELECT" || command === "WITH" || command === "EXPLAIN") {
      const rows = d.prepare(resolved).all() as any[];
      return { rows, rowCount: rows.length, command: "SELECT" };
    }
    const info = d.prepare(resolved).run();
    return { rows: [], rowCount: Number(info.changes), command };
  } catch (err) {
    throw new Error(`SQL error: ${(err as Error)?.message || err}`);
  }
}

/** Insert a JSON record into a project table. Returns the new row id. */
export function sqliteInsertRecord(
  projectId: string,
  tableName: string,
  data: unknown
): { id: number; created_at: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("'data' must be a JSON object.");
  }
  const physical = sqlitePhysicalName(projectId, tableName);
  if (!physical) {
    throw new Error(`Table '${tableName}' not found for project ${projectId}. Call create_database_table first.`);
  }
  const d = getVortexDb();
  const info = d.prepare(`INSERT INTO "${physical}" (data) VALUES (?)`).run(JSON.stringify(data));
  const row = d
    .prepare(`SELECT created_at FROM "${physical}" WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as { created_at: string };
  return { id: Number(info.lastInsertRowid), created_at: row.created_at };
}

/** Fetch all rows of a table as flat objects ({id, created_at, ...json}). */
export function sqliteTableRows(projectId: string, tableName: string): Array<Record<string, any>> {
  const physical = sqlitePhysicalName(projectId, tableName);
  if (!physical) {
    throw new Error(`Table '${tableName}' not found for project ${projectId}.`);
  }
  const d = getVortexDb();
  const rows = d.prepare(`SELECT id, data, created_at FROM "${physical}" ORDER BY id ASC`).all() as Array<{
    id: number;
    data: string;
    created_at: string;
  }>;
  return rows.map((r) => {
    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(r.data);
    } catch {
      // keep raw
    }
    return { id: r.id, created_at: r.created_at, ...parsed };
  });
}

/** Delete one row by id. Returns true when a row was removed. */
export function sqliteDeleteRecord(projectId: string, tableName: string, rowId: string | number): boolean {
  const physical = sqlitePhysicalName(projectId, tableName);
  if (!physical) {
    throw new Error(`Table '${tableName}' not found for project ${projectId}.`);
  }
  const d = getVortexDb();
  const info = d.prepare(`DELETE FROM "${physical}" WHERE id = ?`).run(Number(rowId));
  return info.changes > 0;
}
