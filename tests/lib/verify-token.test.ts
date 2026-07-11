import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyToken } from "../../src/http/middleware";
import { writeSettings } from "../../src/runtime/config";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-token-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "super-secret-token-value",
  });
});

afterEach(() => {
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("verifyToken", () => {
  it("returns true for an exact match", () => {
    expect(verifyToken("super-secret-token-value")).toBe(true);
  });

  it("returns false for a wrong token", () => {
    expect(verifyToken("completely-different-value")).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(verifyToken("super-secret-token-value-extra")).toBe(false);
    expect(verifyToken("short")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(verifyToken("")).toBe(false);
  });

  it("returns false when expected token is empty", () => {
    expect(verifyToken("super-secret-token-value", "")).toBe(false);
  });

  it("accepts an explicit expected token", () => {
    expect(verifyToken("custom-expected-token-123", "custom-expected-token-123")).toBe(true);
  });
});
