/**
 * SQLite connection wrapper and schema bootstrap for Kumix Worker.
 */

import type { Database as SqliteDatabaseInstance } from "better-sqlite3";
import Database from "better-sqlite3";

import { getDbPath } from "../runtime/config";

type SqliteStatement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => { changes: number };
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  query: (sql: string) => SqliteStatement;
};

let dbWrapper: SqliteDatabase | null = null;
let dbInstance: SqliteDatabaseInstance | null = null;

/**
 * Clears the database instance, forcing a re-initialization on the next getDb() call.
 * Primarily used for resetting state between tests.
 */
export function closeDb(): void {
  dbWrapper = null;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDbForTests(): void {
  closeDb();
}

/**
 * Retrieves the singleton SQLite database wrapper instance.
 * Initializes the connection, sets up WAL mode, enables foreign keys,
 * and ensures the schema exists.
 *
 * @returns The active SQLite database connection wrapper.
 */
export function getDb(): SqliteDatabase {
  if (dbWrapper) return dbWrapper;

  let instance: SqliteDatabaseInstance | null = null;
  try {
    instance = new Database(getDbPath());
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
    instance.pragma("wal_autocheckpoint = 1000");

    const wrapper: SqliteDatabase = {
      exec: (sql: string) => instance!.exec(sql),
      query: (sql: string) => {
        const stmt = instance!.prepare(sql);
        return {
          all: (...params: unknown[]) => stmt.all(...params),
          get: (...params: unknown[]) => stmt.get(...params),
          run: (...params: unknown[]) => stmt.run(...params),
        };
      },
    };
    ensureSchema(wrapper);
    dbInstance = instance;
    dbWrapper = wrapper;
    return wrapper;
  } catch (error) {
    try {
      instance?.close();
    } catch {
      throw getDbFailure(error);
    }
    throw getDbFailure(error);
  }
}

/**
 * Ensures the required tables (sources, targets, streams, events) and indexes exist.
 *
 * @param database - The SQLite database instance.
 */
function getDbFailure(error: unknown): Error {
  return new Error("Kumix Worker database initialization failed", { cause: error });
}

function ensureSchema(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      file_path TEXT,
      url TEXT,
      size_bytes INTEGER,
      duration_sec INTEGER,
      video_codec TEXT,
      audio_codec TEXT,
      video_bitrate INTEGER,
      width INTEGER,
      height INTEGER,
      fps REAL,
      sha256 TEXT,
      invalid_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      ingest_url TEXT NOT NULL,
      stream_key_cipher TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'pending',
      loop INTEGER NOT NULL DEFAULT 1,
      scheduled_for TEXT,
      auto_stop_at TEXT,
      recurrence TEXT NOT NULL DEFAULT 'none',
      recurrence_rule TEXT,
      started_at TEXT,
      stopped_at TEXT,
      pid INTEGER,
      last_error TEXT,
      last_metrics TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);
    CREATE INDEX IF NOT EXISTS idx_targets_active ON targets(active);
    CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
    CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream_id, created_at);
  `);
}
