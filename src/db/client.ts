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
    tryColumnMigration(wrapper, "events", "user_id", "TEXT");
    tryColumnMigration(
      wrapper,
      "media",
      "folder_id",
      "TEXT REFERENCES media_folders(id) ON DELETE SET NULL",
    );
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
 * Ensures the required tables (auth, events) and indexes exist.
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

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      stream_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      folder_id TEXT REFERENCES media_folders(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_media_folders_user ON media_folders(user_id);
    CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder_id);
  `);
}
