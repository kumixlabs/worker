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
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-impersonate-"));
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

/** Minimal cookie jar: tracks every set/cleared cookie by name. */
function jar() {
  const store = new Map<string, string>();
  return {
    header: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res: Response) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const expires = /expires=([^;]+)/i.exec(raw)?.[1];
        const maxAge = /max-age=(-?\d+)/i.exec(raw)?.[1];
        if (value === "" || maxAge === "0" || (expires && new Date(expires) < new Date(0))) {
          store.delete(name);
        } else {
          store.set(name, value);
        }
      }
    },
  };
}

async function createUser(email: string): Promise<string> {
  const res = await getAuth().api.signUpEmail({
    body: { email, password: "password1234", name: email.split("@")[0] },
    asResponse: true,
  });
  expect(res.ok).toBe(true);
  return ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").split("=").slice(1).join("=");
}

describe("impersonation lifecycle", () => {
  it("stop impersonating after browsing API routes restores the admin session", async () => {
    const adminCookie = await createAdminSession(app);
    await createUser("victim@test.dev");
    const userId = (
      getDb().query("SELECT id FROM user WHERE email = ?").get("victim@test.dev") as {
        id: string;
      }
    ).id;

    const cookies = jar();
    const impersonateRes = await app.request("/api/auth/admin/impersonate-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ userId }),
    });
    expect(impersonateRes.ok).toBe(true);
    cookies.absorb(impersonateRes);

    // "browse other pages": hit session-scoped API routes like the SPA does
    for (const path of [
      "/api/streams",
      "/api/sources",
      "/api/targets",
      "/api/events",
      "/api/settings",
    ]) {
      const res = await app.request(path, { headers: { Cookie: cookies.header() } });
      expect([200, 403]).toContain(res.status);
      cookies.absorb(res);
    }

    const stopRes = await app.request("/api/auth/admin/stop-impersonating", {
      method: "POST",
      headers: { Cookie: cookies.header() },
    });
    expect(stopRes.ok).toBe(true);
    cookies.absorb(stopRes);
    const body = (await stopRes.json()) as { user: { role: string } };
    expect(body.user.role).toBe("admin");
  });

  it("session reads are not rate limited; sign-in brute force still is", async () => {
    const adminCookie = await createAdminSession(app);

    for (let i = 0; i < 15; i += 1) {
      const res = await app.request("/api/auth/get-session", {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
    }

    let limited = false;
    for (let i = 0; i < 5; i += 1) {
      const res = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@test.dev", password: "wrong-password" }),
      });
      if (res.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
