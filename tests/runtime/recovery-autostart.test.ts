import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createSource } from "../../src/db/sources";
import { createStream } from "../../src/db/streams";
import { createTarget } from "../../src/db/targets";
import { writeSettings } from "../../src/runtime/config";
import {
  consumeAutoStartMarker,
  getTombstoneDir,
  listTombstones,
  removeTombstone,
  writeAutoStartMarker,
  writeTombstone,
} from "../../src/runtime/recovery";
import { hasSqlite } from "../helpers";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "forge-worker-"));
  process.env.FORGE_WORKER_DATA_DIR = dataDir;
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
  delete process.env.FORGE_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe("auto-start marker", () => {
  it("persists requested stream IDs to the marker file", () => {
    writeAutoStartMarker(["str_a", "str_b"]);

    const file = path.join(getTombstoneDir(), "auto-start.json");
    const record = JSON.parse(readFileSync(file, "utf8")) as { streamIds: string[] };

    expect(record.streamIds).toEqual(["str_a", "str_b"]);
  });

  it("rejects unsafe stream IDs", () => {
    expect(() => writeAutoStartMarker(["../evil"])).toThrow(/Invalid stream ID/);
  });
});

describe("tombstones", () => {
  it("rejects path traversal in tombstone stream IDs", () => {
    expect(() =>
      writeTombstone({
        pid: 1,
        status: "running",
        streamId: "../escape",
        writtenAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/Invalid stream ID/);
  });

  it("excludes the auto-start marker and drops corrupt tombstones", () => {
    writeAutoStartMarker(["str_x"]);
    writeTombstone({
      pid: 10,
      status: "running",
      streamId: "str_good",
      writtenAt: "2026-01-01T00:00:00.000Z",
    });
    const corruptFile = path.join(getTombstoneDir(), "broken.json");
    writeFileSync(corruptFile, "{ not json");

    const tombstones = listTombstones();

    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]?.streamId).toBe("str_good");
    expect(existsSync(corruptFile)).toBe(false);

    removeTombstone("str_good");
    expect(listTombstones()).toEqual([]);
  });
});

describe.skipIf(!hasSqlite())("consumeAutoStartMarker with DB", () => {
  it("returns only known streams and clears the marker", () => {
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
    const stream = createStream({
      loop: true,
      recurrence: "none",
      sourceId: source.id,
      targetId: target.id,
      title: "Live",
    });

    writeAutoStartMarker([stream.id, "str_missing"]);

    const consumed = consumeAutoStartMarker();

    expect(consumed).toEqual([stream.id]);
    expect(existsSync(path.join(getTombstoneDir(), "auto-start.json"))).toBe(false);
    expect(consumeAutoStartMarker()).toEqual([]);
  });
});
