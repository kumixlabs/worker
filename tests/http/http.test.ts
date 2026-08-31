import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAuthForTests } from "../../src/auth/server";
import { resetDbForTests } from "../../src/db/client";
import { createApiApp } from "../../src/http/app";
import { writeSettings } from "../../src/runtime/config";
import { createAdminSession, rmDataDirForTests } from "../helpers";

let dataDir: string;
let app: ReturnType<typeof createApiApp>;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  resetAuthForTests();
  resetDbForTests();
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    signingSecret: "test-signing-secret-01234567890123456789012345678901",
    encryptionKey: "test-encryption-key-01234567890123456789012345678901",
  });
  app = createApiApp();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmDataDirForTests(dataDir);
});

describe("Kumix Worker HTTP app", () => {
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
    expect(schema.openapi).toBe("3.1.0");
    expect(bootstrap.status).toBe(200);
    expect(bootstrapBody.data.hasAdmin).toBe(false);
  });

  it("allows setup only once (first run creates admin)", async () => {
    const res1 = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" },
      body: JSON.stringify({ email: "admin@kumix.dev", password: "admin-password-1234" }),
    });
    expect(res1.status).toBe(200);

    const bootstrap = await app.request("/api/bootstrap");
    const bootBody = await bootstrap.json();
    expect(bootBody.data.hasAdmin).toBe(true);

    const res2 = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" },
      body: JSON.stringify({ email: "other@kumix.dev", password: "other-password-1234" }),
    });
    expect(res2.status).toBe(403);
  });

  it("requires session for private settings", async () => {
    const anon = await app.request("/api/settings");
    expect(anon.status).toBe(401);

    const cookie = await createAdminSession(app);
    const authed = await app.request("/api/settings", {
      headers: { Cookie: cookie },
    });
    expect(authed.status).toBe(200);
    const body = await authed.json();
    expect(body.data.timezone).toBe("Asia/Jakarta");
  });

  it("requires admin session for /docs", async () => {
    const anon = await app.request("/docs");
    expect(anon.status).toBe(401);

    const cookie = await createAdminSession(app);
    const authed = await app.request("/docs", {
      headers: { Cookie: cookie },
    });
    expect(authed.status).toBe(200);
    const text = await authed.text();
    expect(text).toContain("Scalar");
  });

  it("guards against NaN limit on /api/events", async () => {
    const cookie = await createAdminSession(app);
    const response = await app.request("/api/events?limit=not-a-number", {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
  });
});
