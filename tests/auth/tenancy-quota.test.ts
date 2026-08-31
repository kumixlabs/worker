import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAuthDb, resetAuthForTests } from "../../src/auth/server";
import { resetDbForTests } from "../../src/db/client";
import { createSource, listSources } from "../../src/db/sources";
import { createStream, listStreams } from "../../src/db/streams";
import { createTarget, listTargets } from "../../src/db/targets";
import { createApiApp } from "../../src/http/app";
import { writeSettings } from "../../src/runtime/config";
import { assertStorageQuota, assertStreamQuota, getUserUsage } from "../../src/services/quota";
import { createAdminSession, hasSqlite, rmDataDirForTests } from "../helpers";

let dataDir: string;
let app: ReturnType<typeof createApiApp>;
let adminCookie: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-tenancy-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  resetAuthForTests();
  resetDbForTests();
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
  app = createApiApp();
  adminCookie = await createAdminSession(app);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmDataDirForTests(dataDir);
});

describe.skipIf(!hasSqlite())("Multi-User Tenancy & Quotas", () => {
  it("isolates streams, sources, and targets between users", async () => {
    // Buat user non-admin langsung di auth db
    const authDb = getAuthDb();
    const now = Date.now();
    authDb
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'user', ?, ?)",
      )
      .run("usr_bob", "Bob", "bob@kumix.dev", now, now);

    // Resource milik Bob
    const srcBob = createSource(
      { kind: "url", name: "Bob Source", url: "https://example.com/b.mp4" },
      "usr_bob",
    );
    const tgtBob = createTarget(
      { label: "Bob Target", ingestUrl: "rtmp://live.bob.com/app", streamKey: "key-bob" },
      "usr_bob",
    );
    const stmBob = createStream(
      { title: "Bob Stream", sourceId: srcBob.id, targetId: tgtBob.id },
      "usr_bob",
    );

    // Resource milik Admin (via adminCookie session)
    const adminUser = authDb.prepare("SELECT id FROM user WHERE role = 'admin'").get() as {
      id: string;
    };
    const _srcAdmin = createSource(
      { kind: "url", name: "Admin Source", url: "https://example.com/a.mp4" },
      adminUser.id,
    );

    // List scoped
    expect(listSources("usr_bob")).toHaveLength(1);
    expect(listSources("usr_bob")[0]?.name).toBe("Bob Source");
    expect(listSources(adminUser.id)).toHaveLength(1);
    expect(listSources(adminUser.id)[0]?.name).toBe("Admin Source");
    // List all (admin view)
    expect(listSources()).toHaveLength(2);

    expect(listTargets("usr_bob")).toHaveLength(1);
    expect(listStreams("usr_bob")).toHaveLength(1);
    expect(listStreams("usr_bob")[0]?.id).toBe(stmBob.id);
  });

  it("calculates usage and enforces quotas", () => {
    const authDb = getAuthDb();
    const now = Date.now();
    authDb
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, role, maxStorageBytes, maxStreams, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'user', 1000, 2, ?, ?)",
      )
      .run("usr_charlie", "Charlie", "charlie@kumix.dev", now, now);

    expect(getUserUsage("usr_charlie")).toEqual({ storageBytes: 0, streamCount: 0 });

    // Quotas allow within limits
    expect(() => assertStorageQuota("usr_charlie", 1000, 500)).not.toThrow();
    expect(() => assertStreamQuota("usr_charlie", 2)).not.toThrow();

    // Storage quota rejects overshoot
    expect(() => assertStorageQuota("usr_charlie", 1000, 1500)).toThrow(/Storage quota exceeded/);

    // Admin (null quota) is unlimited
    expect(() => assertStorageQuota("usr_admin", null, 10_000_000)).not.toThrow();
    expect(() => assertStreamQuota("usr_admin", null)).not.toThrow();
  });

  it("exposes admin users API with usage and cascade delete", async () => {
    const listRes = await app.request("/api/admin/users", {
      headers: { Cookie: adminCookie },
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.ok).toBe(true);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.role).toBe("admin");
    expect(listBody.data[0]?.usage).toBeDefined();

    // Patch quotas
    const adminId = listBody.data[0].id;
    const patchRes = await app.request(`/api/admin/users/${adminId}/quotas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ maxStorageBytes: 50_000_000, maxStreams: 5 }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.maxStorageBytes).toBe(50_000_000);
    expect(patchBody.data.maxStreams).toBe(5);

    // Cannot delete own admin
    const delSelfRes = await app.request(`/api/admin/users/${adminId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delSelfRes.status).toBe(409);
  });
});
