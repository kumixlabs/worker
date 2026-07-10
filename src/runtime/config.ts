/**
 * Filesystem-backed runtime configuration and data directory helpers.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { WorkerSettings } from "../types/worker";

const DEFAULT_DIR = path.join(homedir(), ".forge-worker");
const CONFIG_FILE = "config.json";
const markerFile = ".forge-worker-data";

/**
 * Validates a port number from config or environment.
 *
 * @param value - The raw value to validate.
 * @returns The validated port number.
 */
function validPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Forge Worker port: ${String(value)}. Expected integer 1-65535.`);
  }
  return port;
}

/**
 * Validates the disk usage limit from config or environment.
 *
 * @param value - The raw value to validate.
 * @returns The validated percentage.
 */
function validDiskLimit(value: unknown): number {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < 50 || percent > 99) {
    throw new Error(`Invalid disk usage limit: ${String(value)}. Expected integer 50-99.`);
  }
  return percent;
}

/**
 * Validates an IANA timezone from config or environment.
 *
 * @param value - The raw value to validate.
 * @returns The validated timezone.
 */
function validTimezone(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) {
    throw new Error("Invalid Forge Worker timezone. Expected 1-64 character IANA timezone.");
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new Error(`Invalid Forge Worker timezone: ${value}. Expected valid IANA timezone.`);
  }
  return value;
}

export function validToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 256) {
    throw new Error("Invalid Forge Worker token. Expected 16-256 characters.");
  }
  return value;
}

/**
 * Builds validated settings from partial config values and environment defaults.
 *
 * @param parsed - Partial values read from config.json.
 * @param allowTokenGeneration - When true (first run), a missing token is
 *   generated. When false (existing config), a missing token throws instead of
 *   silently rotating it, which would orphan every encrypted target stream key.
 * @returns Validated worker settings.
 */
function normalizeSettings(
  parsed: Partial<WorkerSettings>,
  allowTokenGeneration: boolean,
): WorkerSettings {
  if (!parsed.token && !allowTokenGeneration) {
    throw new Error(
      "Forge Worker config is missing its token. Refusing to generate a new one because " +
        "it would make existing encrypted stream keys undecryptable. Restore the token or run " +
        "'forge-worker reset --all --yes' to recreate the worker from scratch.",
    );
  }
  return {
    token: validToken(parsed.token || randomBytes(32).toString("base64url")),
    port: validPort(parsed.port ?? process.env.FORGE_WORKER_PORT ?? 8080),
    diskUsageLimitPercent: validDiskLimit(
      parsed.diskUsageLimitPercent ?? process.env.FORGE_DISK_LIMIT_PERCENT ?? 90,
    ),
    timezone: validTimezone(parsed.timezone ?? process.env.FORGE_WORKER_TIMEZONE ?? "Asia/Jakarta"),
    dataDir: ensureDataDir(),
  };
}

/**
 * Ensures the worker data directory is safe for destructive reset operations.
 *
 * @param dir - The candidate data directory.
 */
function assertSafeDataDir(dir: string): void {
  const resolved = path.resolve(dir);
  const unsafe = new Set([path.parse(resolved).root, homedir(), process.cwd()]);
  if (unsafe.has(resolved)) {
    throw new Error(`Refusing to reset unsafe data directory: ${resolved}`);
  }
  if (!existsSync(path.join(resolved, markerFile))) {
    throw new Error(`Refusing to reset unmarked data directory: ${resolved}`);
  }
}

/**
 * Resets the worker by deleting its database, cache, tombstones, and optionally config.
 * Stream shutdown must be handled by the caller before invoking this function.
 * Optionally deletes the config file to force a full factory reset.
 *
 * @param includeConfig - Whether to also delete config.json (factory reset).
 */
export function resetWorkerData(includeConfig: boolean): void {
  const dir = getDataDir();
  if (!existsSync(dir)) return;
  assertSafeDataDir(dir);

  const dbFile = getDbPath();
  const cacheDir = getCacheDir();
  const tombstonesDir = path.join(dir, "tombstones");
  const configFile = getConfigPath();

  if (existsSync(dbFile)) rmSync(dbFile, { force: true });
  if (existsSync(`${dbFile}-wal`)) rmSync(`${dbFile}-wal`, { force: true });
  if (existsSync(`${dbFile}-shm`)) rmSync(`${dbFile}-shm`, { force: true });
  if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
  if (existsSync(tombstonesDir)) rmSync(tombstonesDir, { recursive: true, force: true });

  if (includeConfig && existsSync(configFile)) {
    rmSync(configFile, { force: true });
  }

  // Re-create the empty directories
  ensureDataDir();
}

/**
 * Resolves the root data directory for the worker.
 * Honors the FORGE_WORKER_DATA_DIR env override, otherwise defaults to ~/.forge-worker.
 *
 * @returns The absolute path to the data directory.
 */
export function getDataDir(): string {
  return process.env.FORGE_WORKER_DATA_DIR || DEFAULT_DIR;
}

/**
 * Ensures the data directory and all required subdirectories exist.
 * Creates the cache and tombstones folders if missing.
 *
 * @returns The absolute path to the data directory.
 */
export function ensureDataDir(): string {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "cache"), { recursive: true });
  mkdirSync(path.join(dir, "tombstones"), { recursive: true });
  if (!existsSync(path.join(dir, markerFile))) {
    writeFileSync(path.join(dir, markerFile), "Forge Worker data directory\n", { mode: 0o600 });
  }
  return dir;
}

/**
 * Resolves the absolute path to the worker's config.json file.
 *
 * @returns The absolute path to the config file.
 */
export function getConfigPath(): string {
  return path.join(ensureDataDir(), CONFIG_FILE);
}

/**
 * Resolves the absolute path to the worker's SQLite database file.
 *
 * @returns The absolute path to db.sqlite.
 */
export function getDbPath(): string {
  return path.join(ensureDataDir(), "db.sqlite");
}

/**
 * Resolves the absolute path to the local source cache directory.
 *
 * @returns The absolute path to the cache folder.
 */
export function getCacheDir(): string {
  return path.join(ensureDataDir(), "cache");
}

/**
 * Reads the worker settings from config.json.
 * Generates a fresh config (with a random token and defaults) on first run,
 * and backfills any missing fields from env vars or defaults on subsequent reads.
 *
 * @returns The resolved worker settings.
 */
export function readSettings(): WorkerSettings {
  const file = getConfigPath();
  if (!existsSync(file)) {
    const settings = normalizeSettings({}, true);
    writeSettings(settings);
    return settings;
  }

  try {
    return normalizeSettings(
      JSON.parse(readFileSync(file, "utf8")) as Partial<WorkerSettings>,
      false,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown config error";
    throw new Error(
      `Failed to read Forge Worker config at ${file}: ${message}. Run 'forge-worker init' to repair or 'forge-worker reset --all --yes' to recreate.`,
    );
  }
}

/**
 * Persists the worker settings to config.json.
 * Writes with 0600 permissions to protect the auth token.
 *
 * @param {WorkerSettings} settings - The settings object to save.
 */
export function writeSettings(settings: WorkerSettings): void {
  ensureDataDir();
  const configPath = getConfigPath();
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, configPath);
}

export function allowedCorsOrigins(): string[] {
  return (process.env.FORGE_WORKER_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
