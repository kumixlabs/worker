import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createApiApp } from "../../src/http/app";
import { resetRateLimitsForTests } from "../../src/http/middleware";
import { writeSettings } from "../../src/runtime/config";

let dataDir: string;
let app: ReturnType<typeof createApiApp>;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "forge-worker-"));
  process.env.FORGE_WORKER_DATA_DIR = dataDir;
  resetDbForTests();
  resetRateLimitsForTests();
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
  app = createApiApp();
});

afterEach(() => {
  resetDbForTests();
  delete process.env.FORGE_WORKER_CORS_ORIGINS;
  delete process.env.FORGE_WORKER_DATA_DIR;
  delete process.env.NODE_ENV;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("Forge Worker HTTP app", () => {
  it("returns health without authentication", async () => {
    const response = await app.request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("ok");
  });

  it("serves OpenAPI and bootstrap without authentication", async () => {
    const openapi = await app.request("/openapi");
    const bootstrap = await app.request("/api/bootstrap");
    const schema = await openapi.json();
    const bootstrapBody = await bootstrap.json();

    expect(openapi.status).toBe(200);
    expect(schema.info.title).toBe("Forge Worker API");
    expect(bootstrap.status).toBe(200);
    expect(bootstrapBody.data.hasToken).toBe(true);
  });

  it("protects API routes", async () => {
    const response = await app.request("/api/stats");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid Forge Worker token",
      },
      ok: false,
    });
  });

  it("rate limits repeated invalid token attempts", async () => {
    let response = await app.request("/api/stats", { headers: { "x-forwarded-for": "10.0.0.1" } });
    for (let index = 0; index < 30; index += 1) {
      response = await app.request("/api/stats", { headers: { "x-forwarded-for": "10.0.0.1" } });
    }

    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("accepts bearer token authentication", async () => {
    const response = await app.request("/api/settings", {
      headers: {
        Authorization: "Bearer test-token-123456",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.token).toBeUndefined();
    expect(body.data.hasToken).toBe(true);
    expect(body.data.tokenLength).toBe("test-token-123456".length);
    expect(JSON.stringify(body)).not.toContain("test-token-123456");
  });

  it("honors configured CORS origins for web API", async () => {
    process.env.FORGE_WORKER_CORS_ORIGINS = "https://app.example.test";
    app = createApiApp();

    const allowed = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://app.example.test",
      },
    });
    const blocked = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://blocked.example.test",
      },
    });

    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows TubeForge local and production domains as default CORS origins", async () => {
    process.env.NODE_ENV = "production";
    app = createApiApp();

    const appOrigin = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://app.tubeforge.space",
      },
    });
    const apiOrigin = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://api.tubeforge.space",
      },
    });
    const rootOrigin = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://tubeforge.space",
      },
    });
    const localOrigin = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://tubeforge.local",
      },
    });
    const localApiOrigin = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://api.tubeforge.local",
      },
    });
    const blocked = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        Origin: "https://blocked.example.test",
      },
    });

    expect(appOrigin.headers.get("access-control-allow-origin")).toBe(
      "https://app.tubeforge.space",
    );
    expect(apiOrigin.headers.get("access-control-allow-origin")).toBe(
      "https://api.tubeforge.space",
    );
    expect(rootOrigin.headers.get("access-control-allow-origin")).toBe("https://tubeforge.space");
    expect(localOrigin.headers.get("access-control-allow-origin")).toBe("https://tubeforge.local");
    expect(localApiOrigin.headers.get("access-control-allow-origin")).toBe(
      "https://api.tubeforge.local",
    );
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits authenticated web API requests", async () => {
    let response = await app.request("/api/v1/stats", {
      headers: {
        Authorization: "Bearer test-token-123456",
        "x-forwarded-for": "203.0.113.10",
      },
    });
    for (let index = 0; index < 120; index += 1) {
      response = await app.request("/api/v1/stats", {
        headers: {
          Authorization: "Bearer test-token-123456",
          "x-forwarded-for": "203.0.113.10",
        },
      });
    }
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
