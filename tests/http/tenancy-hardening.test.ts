import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAuth, resetAuthForTests } from "../../src/auth/server";
import { recordBandwidth } from "../../src/db/bandwidth";
import { getDb, resetDbForTests } from "../../src/db/client";
import { updateSourceProbe } from "../../src/db/sources";
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

async function seedReadySource(userId: string | null): Promise<string> {
  const db = getDb();
  const id = `src_${Math.random().toString(36).slice(2, 10)}`;
  db.query(
    "INSERT INTO sources (id, user_id, name, kind, url, status, created_at, updated_at) VALUES (?, ?, ?, 'url', 'https://example.com/v.mp4', 'pending', ?, ?)",
  ).run(id, userId, `src-${id}`, new Date().toISOString(), new Date().toISOString());
  updateSourceProbe(id, {
    status: "ready",
    filePath: `${dataDir}/cache/x.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 1000,
    format: { duration: 60, bit_rate: 2000 },
    video: { codec_name: "h264", width: 1280, height: 720, r_frame_rate: "30/1" },
    audio: { codec_name: "aac", sample_rate: 44100, channels: 2 },
  });
  return id;
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
    const uid = (
      getDb().query("SELECT id FROM user WHERE email = ?").get("stats-user@test.dev") as {
        id: string;
      }
    ).id;
    const now = new Date().toISOString();
    getDb()
      .query(
        "INSERT INTO sources (id, user_id, name, kind, url, status, size_bytes, created_at, updated_at) VALUES ('src_q1', ?, 'q', 'url', 'http://x', 'ready', 2048, ?, ?)",
      )
      .run(uid, now, now);

    const res = await app.request("/api/stats", { headers: { Cookie: userCookie } });
    expect(res.ok).toBe(true);
    const stats = (await res.json()) as {
      data: {
        storage: { cacheBytes: number; disk?: unknown };
        quota?: { storageBytes: number; maxStorageBytes: number | null };
      };
    };
    expect(stats.data.storage.disk).toBeUndefined();
    expect(stats.data.storage.cacheBytes).toBe(2048);
    expect(stats.data.quota?.storageBytes).toBe(2048);
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

  it("banning a user stops their running streams", async () => {
    const admin = await createAdminSession(app);
    const userCookie = await createUserSession("ban-target@test.dev");
    const db = getDb();
    const uid = (
      db.query("SELECT id FROM user WHERE email = ?").get("ban-target@test.dev") as {
        id: string;
      }
    ).id;
    const sourceId = await seedReadySource(uid);
    const targetRes = await app.request("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({
        label: "YouTube",
        streamKey: "secret",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      }),
    });
    const targetId = ((await targetRes.json()) as { data: { id: string } }).data.id;
    const now = new Date().toISOString();
    db.query(
      "INSERT INTO streams (id, user_id, title, source_id, target_id, status, loop, recurrence, created_at, updated_at) VALUES (?, ?, 't', ?, ?, 'running', 1, 'none', ?, ?)",
    ).run("st_ban", uid, sourceId, targetId, now, now);

    const res = await app.request("/api/auth/admin/ban-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ userId: uid, banReason: "test" }),
    });
    expect(res.ok).toBe(true);

    const row = db.query("SELECT status FROM streams WHERE id = 'st_ban'").get() as {
      status: string;
    };
    expect(row.status).toBe("stopped");
  });

  it("stream lifecycle events carry owner user_id and are visible to non-admins", async () => {
    await createAdminSession(app);
    const userCookie = await createUserSession("events-owner@test.dev");
    const db = getDb();
    const uid = (
      db.query("SELECT id FROM user WHERE email = ?").get("events-owner@test.dev") as {
        id: string;
      }
    ).id;
    const sourceId = await seedReadySource(null);
    const targetRes = await app.request("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({
        label: "YouTube",
        streamKey: "secret",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      }),
    });
    const targetId = ((await targetRes.json()) as { data: { id: string } }).data.id;
    db.query(
      "INSERT INTO streams (id, user_id, title, source_id, target_id, status, loop, recurrence, created_at, updated_at) VALUES (?, ?, 't', ?, ?, 'failed', 1, 'none', ?, ?)",
    ).run("st_events", uid, sourceId, targetId, new Date().toISOString(), new Date().toISOString());

    const start = await app.request("/api/streams/st_events/start", {
      method: "POST",
      headers: { Cookie: userCookie },
    });
    expect(start.status).toBe(200);

    const events = await app.request("/api/events?limit=50", { headers: { Cookie: userCookie } });
    const list = ((await events.json()) as { data: { streamId: string | null }[] }).data;
    expect(list.some((e) => e.streamId === "st_events")).toBe(true);
  });

  it("non-admin bulk delete cannot remove another user's stream", async () => {
    const admin = await createAdminSession(app);
    const userCookie = await createUserSession("owner@test.dev");

    const sourceId = await seedReadySource(null);
    const db = getDb();
    db.query(
      "INSERT INTO streams (id, user_id, title, source_id, status, loop, recurrence, created_at, updated_at) VALUES (?, 'owner_user', 't', ?, 'stopped', 1, 'none', ?, ?)",
    ).run("st_other", sourceId, new Date().toISOString(), new Date().toISOString());

    const res = await app.request("/api/streams", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ ids: ["st_other"] }),
    });
    const body = (await res.json()) as { data: { deleted: string[]; failed: unknown[] } };
    expect(body.data.deleted).toEqual([]);
    expect(body.data.failed).toHaveLength(1);

    const adminRes = await app.request("/api/streams", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ ids: ["st_other"] }),
    });
    const adminBody = (await adminRes.json()) as { data: { deleted: string[] } };
    expect(adminBody.data.deleted).toEqual(["st_other"]);
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

  it("stream analytics requires ownership", async () => {
    const sourceId = await seedReadySource(null);
    const db = getDb();
    db.query(
      "INSERT INTO streams (id, user_id, title, source_id, status, loop, recurrence, created_at, updated_at) VALUES (?, 'owner_user', 't', ?, 'stopped', 1, 'none', ?, ?)",
    ).run("st_secret", sourceId, new Date().toISOString(), new Date().toISOString());

    const userCookie = await createUserSession("stranger@test.dev");
    const res = await app.request("/api/streams/st_secret/analytics", {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(404);
  });

  it("bandwidth summary is user-scoped, admin sees global totals", async () => {
    const sourceId = await seedReadySource(null);
    const db = getDb();
    const now = new Date().toISOString();
    db.query(
      "INSERT INTO streams (id, user_id, title, source_id, status, loop, recurrence, created_at, updated_at) VALUES (?, 'owner_user', 't', ?, 'stopped', 1, 'none', ?, ?)",
    ).run("st_bw", sourceId, now, now);
    recordBandwidth("st_bw", 4096);

    const admin = await createAdminSession(app);
    const owner = await createUserSession("bw-owner@test.dev");
    const stranger = await createUserSession("bw-stranger@test.dev");

    const ownerRes = await app.request("/api/bandwidth", { headers: { Cookie: owner } });
    const ownerBody = (await ownerRes.json()) as { data: { allTime: number } };
    expect(ownerBody.data.allTime).toBe(0);

    const strangerRes = await app.request("/api/bandwidth", {
      headers: { Cookie: stranger },
    });
    const strangerBody = (await strangerRes.json()) as { data: { allTime: number } };
    expect(strangerBody.data.allTime).toBe(0);

    const adminRes = await app.request("/api/admin/bandwidth", { headers: { Cookie: admin } });
    const adminBody = (await adminRes.json()) as { data: { allTime: number } };
    expect(adminBody.data.allTime).toBe(4096);
  });

  it("admin API rejects non-admin sessions", async () => {
    const user = await createUserSession("deny-admin@test.dev");
    for (const path of [
      "/api/admin/stats",
      "/api/admin/bandwidth",
      "/api/admin/metrics",
      "/api/admin/users",
    ]) {
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
