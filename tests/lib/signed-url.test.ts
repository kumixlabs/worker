import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createSignedUrl, verifySignedUrl } from "../../src/lib/signed-url";
import { writeSettings } from "../../src/runtime/config";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-signed-url-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  resetDbForTests();
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
});

afterEach(() => {
  resetDbForTests();
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("signed URLs", () => {
  it("verifies encoded, duplicate, and reordered query parameters", () => {
    const signed = createSignedUrl("/api/events/export?z=%2F&tag=a%20b&tag=ümlaut");
    const url = new URL(`http://localhost${signed}`);
    const reordered = `/api/events/export?tag=ümlaut&expires=${url.searchParams.get("expires")}&z=%2F&tag=a%20b&sig=${url.searchParams.get("sig")}`;
    const request = new URL(`http://localhost${reordered}`);

    expect(
      verifySignedUrl(
        "GET",
        request.pathname + request.search,
        request.searchParams.get("expires"),
        request.searchParams.get("sig"),
      ),
    ).toBe(true);
  });

  it("rejects changed protected parameters and methods", () => {
    const signed = createSignedUrl("/api/events/export?format=json");
    const url = new URL(`http://localhost${signed}`);
    expect(
      verifySignedUrl(
        "GET",
        "/api/events/export?format=csv",
        url.searchParams.get("expires"),
        url.searchParams.get("sig"),
      ),
    ).toBe(false);
    expect(
      verifySignedUrl(
        "POST",
        "/api/events/export?format=json",
        url.searchParams.get("expires"),
        url.searchParams.get("sig"),
      ),
    ).toBe(false);
  });
});
