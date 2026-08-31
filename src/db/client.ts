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
    instance.pragma("busy_timeout = 5000");
    instance.pragma("wal_autocheckpoint = 1000");

    const stmtCache = new Map<string, SqliteStatement>();
    const wrapper: SqliteDatabase = {
      exec: (sql: string) => instance!.exec(sql),
      query: (sql: string) => {
        let stmt = stmtCache.get(sql);
        if (!stmt) {
          const prepared = instance!.prepare(sql);
          stmt = {
            all: (...params: unknown[]) => prepared.all(...params),
            get: (...params: unknown[]) => prepared.get(...params),
            run: (...params: unknown[]) => prepared.run(...params),
          };
          stmtCache.set(sql, stmt);
        }
        return stmt;
      },
    };
    ensureSchema(wrapper);
    tryColumnMigration(wrapper, "streams", "youtube_live_url", "TEXT");
    tryColumnMigration(wrapper, "streams", "user_id", "TEXT");
    tryColumnMigration(wrapper, "streams", "mode", "TEXT DEFAULT 'rtmp'");
    tryColumnMigration(wrapper, "streams", "youtube_connection_id", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_title", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_description", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_tags", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_privacy", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_made_for_kids", "INTEGER DEFAULT 0");
    tryColumnMigration(wrapper, "streams", "yt_dvr", "INTEGER DEFAULT 1");
    tryColumnMigration(wrapper, "streams", "yt_stream_key_id", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_broadcast_id", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_video_id", "TEXT");
    tryColumnMigration(wrapper, "streams", "yt_stream_key_ref", "TEXT");
    tryColumnMigration(wrapper, "sources", "keyframe_interval", "REAL");
    tryColumnMigration(wrapper, "sources", "user_id", "TEXT");
    tryColumnMigration(wrapper, "targets", "user_id", "TEXT");
    tryColumnMigration(wrapper, "events", "user_id", "TEXT");
    tryColumnMigration(wrapper, "youtube_connections", "subscriber_count", "INTEGER");
    dbInstance = instance;
    dbWrapper = wrapper;
    return wrapper;
  } catch (error) {
    try {
      instance?.close();
    } catch {
      // close failure is irrelevant; the init error is the real cause
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

function tryColumnMigration(db: SqliteDatabase, table: string, column: string, type: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export const AUTH_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      role TEXT,
      banned INTEGER,
      banReason TEXT,
      banExpires INTEGER,
      maxStorageBytes INTEGER,
      maxStreams INTEGER
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      expiresAt INTEGER NOT NULL,
      ipAddress TEXT,
      userAgent TEXT,
      impersonatedBy TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt INTEGER,
      refreshTokenExpiresAt INTEGER,
      scope TEXT,
      password TEXT,
      issuer TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt INTEGER NOT NULL,
      createdAt INTEGER,
      updatedAt INTEGER
    );
`;

function ensureSchema(database: SqliteDatabase): void {
  database.exec(`
    ${AUTH_SCHEMA_SQL}
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      user_id TEXT,
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
      user_id TEXT,
      label TEXT NOT NULL,
      ingest_url TEXT NOT NULL,
      stream_key_cipher TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS youtube_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id_cipher TEXT NOT NULL,
      client_secret_cipher TEXT NOT NULL,
      refresh_token_cipher TEXT,
      channel_id TEXT,
      channel_title TEXT,
      channel_thumbnail TEXT,
      subscriber_count INTEGER,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
      target_id TEXT REFERENCES targets(id) ON DELETE RESTRICT,
      mode TEXT NOT NULL DEFAULT 'rtmp',
      youtube_connection_id TEXT REFERENCES youtube_connections(id) ON DELETE RESTRICT,
      yt_title TEXT,
      yt_description TEXT,
      yt_tags TEXT,
      yt_privacy TEXT,
      yt_made_for_kids INTEGER NOT NULL DEFAULT 0,
      yt_dvr INTEGER NOT NULL DEFAULT 1,
      yt_stream_key_id TEXT,
      yt_broadcast_id TEXT,
      yt_video_id TEXT,
      yt_stream_key_ref TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      loop INTEGER NOT NULL DEFAULT 1,
      youtube_live_url TEXT,
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
      user_id TEXT,
      stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);
    CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id);
    CREATE INDEX IF NOT EXISTS idx_targets_active ON targets(active);
    CREATE INDEX IF NOT EXISTS idx_targets_user ON targets(user_id);
    CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
    CREATE INDEX IF NOT EXISTS idx_streams_user ON streams(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);

    CREATE TABLE IF NOT EXISTS bandwidth_log (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      bytes INTEGER NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bandwidth_stream ON bandwidth_log(stream_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_bandwidth_recorded ON bandwidth_log(recorded_at);
  `);
}
