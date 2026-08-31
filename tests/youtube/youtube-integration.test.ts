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
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-yt-"));
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

describe("YouTube OAuth & Live Automation Integration", () => {
  it("creates a connection, returns OAuth URL, and masks secrets", async () => {
    const cookie = await createAdminSession(app);

    const res = await app.request("/api/youtube/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        clientId: "my-gcp-client-id-123456789.apps.googleusercontent.com",
        clientSecret: "GOCSPX-my-super-secret-key-123456",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.authUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(body.data.authUrl).toContain("my-gcp-client-id");
    expect(body.data.connection.status).toBe("pending");
    expect(body.data.connection.clientIdMasked).toContain("*.com");
    expect(body.data.connection.clientSecret).toBeUndefined();

    const listRes = await app.request("/api/youtube/connections", {
      headers: { Cookie: cookie },
    });
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].id).toBe(body.data.connection.id);

    const delRes = await app.request(`/api/youtube/connections/${body.data.connection.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(delRes.status).toBe(200);
  });
});
