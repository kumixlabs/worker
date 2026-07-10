import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { serveStatic } from "../../src/http/static";

describe("static UI serving", () => {
  it("serves index.html for SPA fallback", async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "forge-worker-public-"));
    try {
      writeFileSync(path.join(publicDir, "index.html"), "<html>Forge Worker UI</html>");
      const app = new Hono();
      app.get("/*", (c) => serveStatic(c, publicDir));

      const response = await app.request("/dashboard");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toBe("<html>Forge Worker UI</html>");
    } finally {
      rmSync(publicDir, { force: true, recursive: true });
    }
  });

  it("rejects path traversal", async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "forge-public-"));
    try {
      writeFileSync(path.join(publicDir, "index.html"), "<html></html>");
      writeFileSync(path.join(path.dirname(publicDir), "secret.txt"), "outside-secret");
      const app = new Hono();
      app.get("/*", (c) => serveStatic(c, publicDir));

      for (const requestPath of ["/..%2Fsecret.txt", "/safe/..%2Fsecret.txt", "/..%5Csecret.txt"]) {
        const response = await app.request(requestPath);
        expect(response.status, requestPath).toBe(404);
        expect(await response.text()).not.toContain("outside-secret");
      }
    } finally {
      rmSync(publicDir, { force: true, recursive: true });
    }
  });

  it("serves immutable asset cache headers", async () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "forge-worker-public-"));
    try {
      writeFileSync(path.join(publicDir, "index.html"), "<html></html>");
      writeFileSync(path.join(publicDir, "app-A1b2C3d4.js"), "console.log('ok')");
      writeFileSync(path.join(publicDir, "app.js"), "console.log('ok')");
      const app = new Hono();
      app.get("/*", (c) => serveStatic(c, publicDir));

      const hashedResponse = await app.request("/app-A1b2C3d4.js");

      expect(hashedResponse.status).toBe(200);
      expect(hashedResponse.headers.get("cache-control")).toContain("immutable");
      expect(hashedResponse.headers.get("content-type")).toContain("application/javascript");

      const fallbackResponse = await app.request("/app.js");

      expect(fallbackResponse.status).toBe(200);
      expect(fallbackResponse.headers.get("cache-control")).toBe("no-cache");
    } finally {
      rmSync(publicDir, { force: true, recursive: true });
    }
  });
});
