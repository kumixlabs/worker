import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureDataDir,
  getConfigPath,
  readSettings,
  resetWorkerData,
  writeSettings,
} from "../../src/runtime/config";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "forge-worker-"));
  process.env.FORGE_WORKER_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.FORGE_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

function writeRawConfig(value: Record<string, unknown>): void {
  ensureDataDir();
  writeFileSync(getConfigPath(), JSON.stringify(value));
}

describe("config validation", () => {
  it("rejects an invalid port", () => {
    writeRawConfig({ port: 70000, token: "test-token-123456" });
    expect(() => readSettings()).toThrow(/port/i);
  });

  it("rejects an invalid disk usage limit", () => {
    writeRawConfig({ diskUsageLimitPercent: 10, token: "test-token-123456" });
    expect(() => readSettings()).toThrow(/disk usage limit/i);
  });

  it("rejects an invalid timezone", () => {
    writeRawConfig({ timezone: "Not/AZone", token: "test-token-123456" });
    expect(() => readSettings()).toThrow(/timezone/i);
  });

  it("rejects an invalid token", () => {
    writeRawConfig({ token: "short" });
    expect(() => readSettings()).toThrow(/token/i);
  });

  it("throws a repair hint on corrupt config", () => {
    ensureDataDir();
    writeFileSync(getConfigPath(), "{ not valid json");
    expect(() => readSettings()).toThrow(/Failed to read Forge Worker config/);
  });

  it("backfills defaults for a fresh config", () => {
    const settings = readSettings();
    expect(settings.port).toBe(8080);
    expect(settings.diskUsageLimitPercent).toBe(90);
    expect(settings.timezone).toBe("Asia/Jakarta");
  });
});

describe("resetWorkerData guard", () => {
  it("refuses to reset an unmarked directory", () => {
    const bareDir = mkdtempSync(path.join(tmpdir(), "forge-bare-"));
    process.env.FORGE_WORKER_DATA_DIR = bareDir;
    // Create the directory contents without the marker file.
    mkdirSync(path.join(bareDir, "cache"), { recursive: true });

    try {
      expect(() => resetWorkerData(false)).toThrow(/unmarked data directory/);
    } finally {
      rmSync(bareDir, { force: true, recursive: true });
    }
  });

  it("resets a marked data directory", () => {
    writeSettings({
      dataDir,
      diskUsageLimitPercent: 90,
      port: 8080,
      timezone: "Asia/Jakarta",
      token: "test-token-123456",
    });

    expect(() => resetWorkerData(false)).not.toThrow();
  });
});
