import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createSource } from "../../src/db/sources";
import { createStream, setStreamStatus } from "../../src/db/streams";
import { createTarget } from "../../src/db/targets";
import { writeSettings } from "../../src/runtime/config";
import { writeTombstone } from "../../src/runtime/recovery";
import { activeStreamIds, compareVersions, parseVersion } from "../../src/runtime/update";
import { hasSqlite } from "../helpers";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-update-"));
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

describe("parseVersion", () => {
  it("parses a simple semver string", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });

  it("strips pre-release and build suffixes", () => {
    expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersion("0.1.0+build.42")).toEqual([0, 1, 0]);
  });

  it("returns null for non-semver strings", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("returns zero for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("compares major version differences", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("compares minor version differences", () => {
    expect(compareVersions("1.3.0", "1.2.0")).toBeGreaterThan(0);
  });

  it("compares patch version differences", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
  });

  it("ignores pre-release suffixes in comparison", () => {
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
  });

  it("falls back to lexical comparison for non-semver strings", () => {
    expect(compareVersions("latest", "1.2.3")).not.toBe(0);
  });
});

describe.skipIf(!hasSqlite())("activeStreamIds", () => {
  it("returns the union of running DB streams and tombstoned streams", () => {
    const source = createSource({
      kind: "url",
      name: "Source",
      url: "https://example.com/video.mp4",
    });
    const target = createTarget({
      active: true,
      ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      label: "YouTube",
      streamKey: "secret",
    });
    const streamA = createStream({
      loop: true,
      recurrence: "none",
      sourceId: source.id,
      targetId: target.id,
      title: "A",
    });
    const streamB = createStream({
      loop: true,
      recurrence: "none",
      sourceId: source.id,
      targetId: target.id,
      title: "B",
    });
    setStreamStatus(streamA.id, "running", { pid: 111 });
    setStreamStatus(streamB.id, "stopped");
    writeTombstone({
      pid: 222,
      status: "running",
      streamId: streamB.id,
      writtenAt: new Date().toISOString(),
    });

    const active = activeStreamIds();

    expect(active).toContain(streamA.id);
    expect(active).toContain(streamB.id);
    expect(active).toHaveLength(2);
  });

  it("returns an empty array when nothing is active", () => {
    expect(activeStreamIds()).toEqual([]);
  });
});
