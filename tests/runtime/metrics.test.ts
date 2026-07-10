import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSettings } from "../../src/runtime/config";
import { runtimeHealthDetails, runtimeMetrics } from "../../src/runtime/metrics";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "forge-worker-"));
  process.env.FORGE_WORKER_DATA_DIR = dataDir;
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
});

afterEach(() => {
  delete process.env.FORGE_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("runtime metrics", () => {
  it("returns process, memory, cpu, and binary health details", () => {
    const metrics = runtimeMetrics();
    const health = runtimeHealthDetails();

    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(metrics.memory.totalBytes).toBeGreaterThan(0);
    expect(metrics.process.pid).toBe(process.pid);
    expect(typeof health.ffmpeg.available).toBe("boolean");
    expect(typeof health.ffprobe.available).toBe("boolean");
    if (health.ffmpeg.available) expect(health.ffmpeg.version).toContain("ffmpeg");
    if (health.ffprobe.available) expect(health.ffprobe.version).toContain("ffprobe");
  });
});
