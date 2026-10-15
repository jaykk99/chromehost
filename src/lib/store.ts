/**
 * Monico Labs — storage adapters for the static web build.
 *
 * StateStore is the interface the UI programs against. The browser build
 * ships the IndexedDB adapter (local, durable, per-browser). The desktop
 * backend implements the same interface on top of embedded SQLite.
 * A memory adapter exists for tests and as a last-resort fallback.
 */
import type { AppState } from "./model";

export interface StateStore {
  /** Returns null when nothing has been stored yet. */
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createMemoryStore(initial: AppState | null = null): StateStore {
  let current: AppState | null = initial ? clone(initial) : null;
  return {
    async load(): Promise<AppState | null> {
      return current ? clone(current) : null;
    },
    async save(state: AppState): Promise<void> {
      current = clone(state);
    },
  };
}

export function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

const STORE_NAME = "kv";
const STATE_KEY = "app-state";

function openDb(dbName: string): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(
      new Error(
        "IndexedDB is not available in this environment — the static Monico Labs build " +
          "needs a real browser to persist projects. (Desktop app only: no, this storage " +
          "is browser-only by design.)"
      )
    );
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked by another tab"));
  });
}

function runRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let req: IDBRequest<T>;
    try {
      const tx = db.transaction(STORE_NAME, mode);
      req = fn(tx.objectStore(STORE_NAME));
    } catch (err) {
      reject(err);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function isValidState(value: unknown): value is AppState {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as AppState).projects) &&
    Array.isArray((value as AppState).deployments)
  );
}

/**
 * Durable per-browser storage. The whole app state (projects + deployments)
 * lives under a single key; it is small (static HTML sites) and this keeps
 * the adapter trivially correct. Opens and closes the DB per call so no
 * connection is held across tabs longer than needed.
 */
export function createIndexedDBStore(dbName = "monico-labs"): StateStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDb = (): Promise<IDBDatabase> => {
    if (!dbPromise) dbPromise = openDb(dbName);
    return dbPromise;
  };
  const release = (db: IDBDatabase): void => {
    db.close();
    dbPromise = null;
  };
  return {
    async load(): Promise<AppState | null> {
      const db = await getDb();
      try {
        const raw = await runRequest(db, "readonly", (store) => store.get(STATE_KEY));
        if (raw == null) return null;
        const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
        return isValidState(parsed) ? parsed : null;
      } finally {
        release(db);
      }
    },
    async save(state: AppState): Promise<void> {
      const db = await getDb();
      try {
        await runRequest(db, "readwrite", (store) => store.put(clone(state), STATE_KEY));
      } finally {
        release(db);
      }
    },
  };
}
