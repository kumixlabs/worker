import { rmSync } from "node:fs";
import { createRequire } from "node:module";

export function hasSqlite(): boolean {
  try {
    createRequire(import.meta.url)("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}

export function rmDataDirForTests(dir: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(dir, { force: true, recursive: true });
      return;
    } catch (error) {
      if (attempt >= 4 || !(error instanceof Error) || error.message.includes("EPERM") === false) {
        throw error;
      }
      const until = Date.now() + 200;
      while (Date.now() < until) {
        // busy-wait a short retry window for transient FS locks
      }
    }
  }
}

type TestApp = { request: (path: string, init?: RequestInit) => Promise<Response> };

export async function createAdminSession(app: TestApp): Promise<string> {
  const response = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" },
    body: JSON.stringify({
      email: "admin@test.dev",
      password: "password1234",
      name: "Admin",
    }),
  });
  if (!response.ok) {
    throw new Error(`setup failed: ${response.status} ${await response.text()}`);
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}

export function jsonHeaders(cookie: string): Record<string, string> {
  return { "Content-Type": "application/json", Cookie: cookie };
}
