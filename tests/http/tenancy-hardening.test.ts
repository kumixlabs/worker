import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAuth, resetAuthForTests } from "../../src/auth/server";
import { getDb, resetDbForTests } from "../../src/db/client";
import { createApiApp } from "../../src/http/app";
import { writeSettings } from "../../src/runtime/config";
import { createAdminSession, rmDataDirForTests } from "../helpers";

let dataDir: string;
let app: ReturnType<typeof createApiApp>;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-tenancy-"));
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

async function createUserSession(email: string): Promise<string> {
  const auth = getAuth();
  const res = await auth.api.signUpEmail({
    body: { email, password: "password1234", name: email.split("@")[0]! },
    asResponse: true,
  });
  expect(res.ok).toBe(true);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0]!;
}

describe("tenancy hardening", () => {
  it("last admin cannot be demoted via admin update-user", async () => {
    const admin = await createAdminSession(app);
    const uid = (getDb().query("SELECT id FROM user WHERE role = 'admin'").get() as { id: string })
      .id;

    const res = await app.request("/api/auth/admin/update-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ userId: uid, data: { role: "user" } }),
    });
    expect(res.status).toBe(400);
  });

  it("stats for non-admin are scoped: own storage, quota, no host disk", async () => {
    const userCookie = await createUserSession("stats-user@test.dev");
    const res = await app.request("/api/stats", { headers: { Cookie: userCookie } });
    expect(res.ok).toBe(true);
    const stats = (await res.json()) as {
      data: {
        storage: { cacheBytes: number; disk?: unknown };
        quota?: { storageBytes: number; maxStorageBytes: number | null };
      };
    };
    expect(stats.data.storage.disk).toBeUndefined();
    expect(stats.data.storage.cacheBytes).toBe(0);
    expect(stats.data.quota?.storageBytes).toBe(0);
  });

  it("non-admin signed event URLs and SSE are scoped to their own events", async () => {
    const admin = await createAdminSession(app);
    const userCookie = await createUserSession("scoped-user@test.dev");
    const db = getDb();
    const uid = (
      db.query("SELECT id FROM user WHERE email = ?").get("scoped-user@test.dev") as { id: string }
    ).id;
    const now = new Date().toISOString();
    db.query(
      "INSERT INTO events (id, user_id, stream_id, kind, message, created_at) VALUES ('evt_own', ?, NULL, 'stream_started', 'own', ?)",
    ).run(uid, now);
    db.query(
      "INSERT INTO events (id, user_id, stream_id, kind, message, created_at) VALUES ('evt_other', ?, NULL, 'stream_started', 'other', ?)",
    ).run("user_other", now);
    db.query(
      "INSERT INTO events (id, user_id, stream_id, kind, message, created_at) VALUES ('evt_admin', NULL, NULL, 'admin_user_deleted', 'Admin deleted user x', ?)",
    ).run(now);

    const signRes = await app.request("/api/events/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ path: "/api/events/export" }),
    });
    expect(signRes.ok).toBe(true);
    const { url } = ((await signRes.json()) as { data: { url: string } }).data;
    expect(url).toContain(`u=${uid}`);

    const exportRes = await app.request(url);
    expect(exportRes.ok).toBe(true);
    const text = await exportRes.text();
    expect(text).toContain("own");
    expect(text).not.toContain("other");
    expect(text).not.toContain("Admin deleted user");

    const sseSignRes = await app.request("/api/events/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ path: "/api/events/stream" }),
    });
    const sseUrl = ((await sseSignRes.json()) as { data: { url: string } }).data.url;
    const sseRes = await app.request(sseUrl);
    expect(sseRes.ok).toBe(true);
    const reader = sseRes.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const firstBatch = new TextDecoder().decode(value);
    expect(firstBatch).not.toContain("evt_other");
    expect(firstBatch).not.toContain("evt_admin");

    // Admin keeps the global view.
    const adminList = await app.request("/api/events", { headers: { Cookie: admin } });
    const events = ((await adminList.json()) as { data: Array<{ id: string }> }).data;
    expect(events.map((e) => e.id)).toContain("evt_admin");
  });

  it("clearing events requires admin", async () => {
    const admin = await createAdminSession(app);
    const userCookie = await createUserSession("peon@test.dev");
    const res = await app.request("/api/events", {
      method: "DELETE",
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(403);

    const adminRes = await app.request("/api/events", {
      method: "DELETE",
      headers: { Cookie: admin },
    });
    expect(adminRes.status).toBe(200);
  });

  it("non-admin global event export is scoped to own user", async () => {
    const db = getDb();
    db.query(
      "INSERT INTO events (id, user_id, stream_id, kind, message, created_at) VALUES (?, 'someone_else', NULL, 'info', 'private event', ?)",
    ).run("ev_1", new Date().toISOString());

    const admin = await createAdminSession(app);
    const userCookie = await createUserSession("snoop@test.dev");
    const res = await app.request("/api/events/export", { headers: { Cookie: userCookie } });
    const text = await res.text();
    expect(text).not.toContain("private event");

    const adminRes = await app.request("/api/events/export", { headers: { Cookie: admin } });
    expect(await adminRes.text()).toContain("private event");
  });

  it("admin API rejects non-admin sessions", async () => {
    const user = await createUserSession("deny-admin@test.dev");
    for (const path of ["/api/admin/metrics", "/api/admin/users"]) {
      const res = await app.request(path, { headers: { Cookie: user } });
      expect(res.status).toBe(403);
    }
  });

  it("worker settings PATCH is admin-only and public settings hide server internals", async () => {
    const admin = await createAdminSession(app);
    const user = await createUserSession("deny-settings@test.dev");
    const body = JSON.stringify({ timezone: "Asia/Jakarta", diskUsageLimitPercent: 90 });

    const denied = await app.request("/api/settings", {
      method: "PATCH",
      headers: { Cookie: user, "Content-Type": "application/json" },
      body,
    });
    expect(denied.status).toBe(403);

    const allowed = await app.request("/api/settings", {
      method: "PATCH",
      headers: { Cookie: admin, "Content-Type": "application/json" },
      body,
    });
    expect(allowed.status).toBe(200);

    const read = await app.request("/api/settings", { headers: { Cookie: user } });
    const data = ((await read.json()) as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("port");
    expect(data).not.toHaveProperty("dataDir");
  });
});
