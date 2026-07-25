import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("Kumix Worker config", () => {
  it("creates default settings in the configured data directory", async () => {
    const { readSettings } = await import("../../src/runtime/config");
    const { isPasswordHash, verifyPassword, DEFAULT_DASHBOARD_PASSWORD } = await import(
      "../../src/lib/password"
    );

    const settings = readSettings();

    expect(settings.dataDir).toBe(dataDir);
    expect(settings.port).toBe(8080);
    expect(settings.diskUsageLimitPercent).toBe(90);
    expect(settings.timezone).toBe("Asia/Jakarta");
    expect(settings.token.length).toBeGreaterThanOrEqual(32);
    expect(isPasswordHash(settings.passwordHash)).toBe(true);
    expect(await verifyPassword(DEFAULT_DASHBOARD_PASSWORD, settings.passwordHash)).toBe(true);
  });

  it("persists settings", async () => {
    const { readSettings, writeSettings } = await import("../../src/runtime/config");
    const { isPasswordHash } = await import("../../src/lib/password");

    writeSettings({
      dataDir,
      diskUsageLimitPercent: 80,
      port: 9090,
      timezone: "UTC",
      token: "test-token-123456",
      youtubeApiKey: "",
    });

    const settings = readSettings();
    expect(settings).toMatchObject({
      dataDir,
      diskUsageLimitPercent: 80,
      port: 9090,
      timezone: "UTC",
      token: "test-token-123456",
      youtubeApiKey: "",
    });
    expect(isPasswordHash(settings.passwordHash)).toBe(true);
  });
});
