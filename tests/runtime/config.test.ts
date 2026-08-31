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

    const settings = readSettings();

    expect(settings.dataDir).toBe(dataDir);
    expect(settings.port).toBe(8080);
    expect(settings.diskUsageLimitPercent).toBe(90);
    expect(settings.timezone).toBe("Asia/Jakarta");
    expect(settings.signingSecret.length).toBeGreaterThanOrEqual(32);
    expect(settings.encryptionKey.length).toBeGreaterThanOrEqual(32);
  });

  it("persists settings", async () => {
    const { readSettings, writeSettings } = await import("../../src/runtime/config");

    writeSettings({
      dataDir,
      diskUsageLimitPercent: 80,
      port: 9090,
      timezone: "UTC",
      signingSecret: "custom-signing-secret-01234567890123456789",
      encryptionKey: "custom-encryption-key-01234567890123456789",
    });

    const settings = readSettings();
    expect(settings).toMatchObject({
      dataDir,
      diskUsageLimitPercent: 80,
      port: 9090,
      timezone: "UTC",
      signingSecret: "custom-signing-secret-01234567890123456789",
      encryptionKey: "custom-encryption-key-01234567890123456789",
    });
  });
});
