import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSettings } from "../../src/runtime/config";
import { runtimeMetrics } from "../../src/runtime/metrics";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
});

afterEach(() => {
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("runtime metrics", () => {
  it("returns process, memory, and cpu details", () => {
    const metrics = runtimeMetrics();

    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(metrics.memory.totalBytes).toBeGreaterThan(0);
    expect(metrics.process.pid).toBe(process.pid);
  });
});
