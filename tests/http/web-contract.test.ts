import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createApiApp } from "../../src/http/app";
import { writeSettings } from "../../src/runtime/config";
import { hasSqlite } from "../helpers";

let dataDir: string;
let app: ReturnType<typeof createApiApp>;
const headers = { Authorization: "Bearer core-token-123456" };

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "forge-worker-core-"));
  process.env.FORGE_WORKER_DATA_DIR = dataDir;
  resetDbForTests();
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 88,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "core-token-123456",
  });
  app = createApiApp();
});

afterEach(() => {
  resetDbForTests();
  delete process.env.FORGE_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe.skipIf(!hasSqlite())("Core-facing Worker API contract", () => {
  it("exposes bootstrap data without leaking the token", async () => {
    const response = await app.request("/api/bootstrap");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      apiVersion: "v1",
      hasToken: true,
      tokenLength: "core-token-123456".length,
      dashboardPath: "/auth?token={token}",
    });
    expect(JSON.stringify(body)).not.toContain("core-token-123456");
  });

  it("exposes capabilities for TubeForge Web", async () => {
    const response = await app.request("/api/v1/capabilities", { headers });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.apiVersion).toBe("v1");
    expect(body.data.agentVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.data.features).toMatchObject({
      monitoring: true,
      tokenRotation: true,
      signedEventUrls: true,
      bulkDelete: true,
      scheduler: true,
      recurrence: true,
      sourceDownload: true,
      googleDriveSources: true,
    });
    expect(body.data.limits).toMatchObject({
      signedUrlTtlMs: 60_000,
      bulkDeleteMaxIds: 100,
      webStatsCacheTtlMs: 2_000,
    });
    expect(body.data.settings).toEqual({ timezone: "Asia/Jakarta", diskUsageLimitPercent: 88 });
    expect(JSON.stringify(body)).not.toContain("core-token-123456");
  });

  it("exposes link metadata for install flows", async () => {
    const response = await app.request("/api/v1/link", { headers });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      apiVersion: "v1",
      dashboardPath: "/auth?token={token}",
      tokenLength: "core-token-123456".length,
    });
    expect(body.data.capabilities.features.monitoring).toBe(true);
    expect(JSON.stringify(body)).not.toContain("core-token-123456");
  });

  it("rejects core-facing endpoints without bearer token", async () => {
    const response = await app.request("/api/v1/capabilities");
    expect(response.status).toBe(401);
  });
});
