/**
 * Filesystem-backed runtime configuration and data directory helpers.
 */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { WorkerSettings } from "../types/worker";

const DEFAULT_DIR = path.join(homedir(), ".kumix-worker");
const CONFIG_FILE = "config.json";
const markerFile = ".kumix-worker-data";

function validPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Kumix Worker port: ${String(value)}. Expected integer 1-65535.`);
  }
  return port;
}

function validDiskLimit(value: unknown): number {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < 50 || percent > 99) {
    throw new Error(
      `Invalid Kumix Worker disk usage limit: ${String(value)}. Expected integer 50-99.`,
    );
  }
  return percent;
}

function validTimezone(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) {
    throw new Error("Invalid Kumix Worker timezone. Expected 1-64 character IANA timezone.");
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new Error(`Invalid Kumix Worker timezone: ${value}. Expected valid IANA timezone.`);
  }
  return value;
}

function normalizeSettings(parsed: Partial<WorkerSettings>): WorkerSettings {
  return {
    signingSecret:
      parsed.signingSecret &&
      typeof parsed.signingSecret === "string" &&
      parsed.signingSecret.length >= 32
        ? parsed.signingSecret
        : randomBytes(32).toString("hex"),
    encryptionKey:
      parsed.encryptionKey &&
      typeof parsed.encryptionKey === "string" &&
      parsed.encryptionKey.length >= 32
        ? parsed.encryptionKey
        : randomBytes(32).toString("hex"),
    port: validPort(parsed.port ?? process.env.KUMIX_WORKER_PORT ?? 8080),
    diskUsageLimitPercent: validDiskLimit(
      parsed.diskUsageLimitPercent ?? process.env.KUMIX_WORKER_DISK_LIMIT_PERCENT ?? 90,
    ),
    timezone: validTimezone(parsed.timezone ?? process.env.KUMIX_WORKER_TIMEZONE ?? "Asia/Jakarta"),
    dataDir: ensureDataDir(),
  };
}

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

export function resetWorkerData(includeConfig: boolean): void {
  const dir = getDataDir();
  if (!existsSync(dir)) return;
  assertSafeDataDir(dir);

  const dbDir = path.join(dir, "db");
  const cacheDir = getCacheDir();
  const tombstonesDir = path.join(dir, "tombstones");
  const configFile = getConfigPath();

  if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true });
  if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
  if (existsSync(tombstonesDir)) rmSync(tombstonesDir, { recursive: true, force: true });

  if (includeConfig && existsSync(configFile)) {
    rmSync(configFile, { force: true });
    secretCache = null;
  }

  ensureDataDir();
}

function getDataDir(): string {
  return process.env.KUMIX_WORKER_DATA_DIR || DEFAULT_DIR;
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "db"), { recursive: true });
  mkdirSync(path.join(dir, "cache"), { recursive: true });
  mkdirSync(path.join(dir, "tombstones"), { recursive: true });
  if (!existsSync(path.join(dir, markerFile))) {
    writeFileSync(path.join(dir, markerFile), "Kumix Worker data directory\n", { mode: 0o600 });
  }
  return dir;
}

export function getConfigPath(): string {
  return path.join(ensureDataDir(), CONFIG_FILE);
}

export function getDbPath(): string {
  return path.join(ensureDataDir(), "db", "db.sqlite");
}

export function getCacheDir(): string {
  return path.join(ensureDataDir(), "cache");
}

let secretCache: {
  mtimeMs: number;
  signingSecret: string;
  encryptionKey: string;
} | null = null;

export function currentSigningSecret(): string {
  const file = getConfigPath();
  try {
    const stats = statSync(file);
    if (secretCache && secretCache.mtimeMs === stats.mtimeMs) {
      return secretCache.signingSecret;
    }
    const settings = readSettings();
    secretCache = {
      mtimeMs: stats.mtimeMs,
      signingSecret: settings.signingSecret,
      encryptionKey: settings.encryptionKey,
    };
    return settings.signingSecret;
  } catch {
    return readSettings().signingSecret;
  }
}

export function currentEncryptionKey(): string {
  const file = getConfigPath();
  try {
    const stats = statSync(file);
    if (secretCache && secretCache.mtimeMs === stats.mtimeMs) {
      return secretCache.encryptionKey;
    }
    const settings = readSettings();
    secretCache = {
      mtimeMs: stats.mtimeMs,
      signingSecret: settings.signingSecret,
      encryptionKey: settings.encryptionKey,
    };
    return settings.encryptionKey;
  } catch {
    return readSettings().encryptionKey;
  }
}

export function readSettings(): WorkerSettings {
  const file = getConfigPath();
  if (!existsSync(file)) {
    const settings = normalizeSettings({});
    writeSettings(settings);
    return settings;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<WorkerSettings>;
    const settings = normalizeSettings(parsed);
    if (!parsed.signingSecret || !parsed.encryptionKey) {
      writeSettings(settings);
    }
    return settings;
  } catch (error) {
    throw new Error(
      `Failed to read Kumix Worker config at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeSettings(settings: WorkerSettings): void {
  const file = getConfigPath();
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  secretCache = null;
}
