import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createSource, getSource } from "../../src/db/sources";
import { writeSettings } from "../../src/runtime/config";
import {
  extractGDriveFileId,
  isPrivateIp,
  safeFetch,
  setFetchImplForTests,
  validateUrl,
} from "../../src/services/source-downloader";

let dataDir: string | null = null;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-downloader-"));
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
  if (dataDir) rmSync(dataDir, { force: true, recursive: true });
  dataDir = null;
});

describe("isPrivateIp", () => {
  it("flags private, loopback, and metadata ranges", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.5.4")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("validateUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    expect(await validateUrl("ftp://example.com/file")).toBe(false);
    expect(await validateUrl("file:///etc/passwd")).toBe(false);
    expect(await validateUrl("not a url")).toBe(false);
  });

  it("rejects loopback and metadata hostnames", async () => {
    expect(await validateUrl("http://localhost/video.mp4")).toBe(false);
    expect(await validateUrl("http://app.localhost/video.mp4")).toBe(false);
    expect(await validateUrl("http://metadata.google.internal/")).toBe(false);
  });

  it("rejects private IP literals", async () => {
    expect(await validateUrl("http://127.0.0.1/video.mp4")).toBe(false);
    expect(await validateUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(await validateUrl("http://[::1]/video.mp4")).toBe(false);
  });

  it("allows public IP literals", async () => {
    expect(await validateUrl("https://8.8.8.8/video.mp4")).toBe(true);
  });
});

describe("extractGDriveFileId", () => {
  it("extracts from the /file/d/ path format", () => {
    expect(
      extractGDriveFileId("https://drive.google.com/file/d/ABC123_def-456/view?usp=sharing"),
    ).toBe("ABC123_def-456");
  });

  it("extracts from the id query parameter", () => {
    expect(
      extractGDriveFileId(
        "https://drive.usercontent.google.com/download?id=XYZ789_ab12&export=download",
      ),
    ).toBe("XYZ789_ab12");
  });

  it("rejects file IDs that are too short, too long, or malformed", () => {
    expect(extractGDriveFileId("https://drive.google.com/file/d/short/view")).toBeNull();
    expect(
      extractGDriveFileId("https://drive.usercontent.google.com/download?id=XYZ789"),
    ).toBeNull();
    expect(
      extractGDriveFileId(`https://drive.google.com/file/d/${"a".repeat(129)}/view`),
    ).toBeNull();
    expect(extractGDriveFileId("https://drive.google.com/file/d/ABC123_def!456/view")).toBeNull();
  });

  it("returns null for non-Drive or unparseable URLs", () => {
    expect(extractGDriveFileId("https://example.com/file/d/ABC123_def-456")).toBeNull();
    expect(extractGDriveFileId("not a url")).toBeNull();
  });
});

describe("safeFetch", () => {
  afterEach(() => {
    setFetchImplForTests(null);
    vi.unstubAllGlobals();
  });

  it("blocks redirects that target private addresses", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
    );
    setFetchImplForTests(fetchMock);

    await expect(safeFetch("https://8.8.8.8/video.mp4")).rejects.toThrow(/SSRF/);
  });

  it("follows safe redirects and returns the final response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://1.1.1.1/final.mp4" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    setFetchImplForTests(fetchMock);

    const response = await safeFetch("https://8.8.8.8/video.mp4");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when redirects exceed the limit", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://1.1.1.1/loop" } }),
    );
    setFetchImplForTests(fetchMock);

    await expect(safeFetch("https://8.8.8.8/video.mp4", undefined, 2)).rejects.toThrow(
      /Too many redirects/,
    );
  });
});

describe("downloadAndProbeSource", () => {
  afterEach(() => {
    setFetchImplForTests(null);
  });

  it("uses the Google Drive confirmation flow for Drive URLs registered as url sources", async () => {
    const source = createSource({
      kind: "url",
      name: "Drive URL",
      url: "https://drive.google.com/file/d/ABC123_def-456/view",
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 403 }));
    setFetchImplForTests(fetchMock);

    const { downloadAndProbeSource } = await import("../../src/services/source-downloader");
    await downloadAndProbeSource(source.id);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://drive.usercontent.google.com/download?id=ABC123_def-456&export=download",
      expect.any(Object),
    );
    expect(getSource(source.id)?.invalidReason).toBe("Download failed with status 403");
  });
});
