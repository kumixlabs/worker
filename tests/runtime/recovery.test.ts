import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { listEvents } from "../../src/db/events";
import { createSource } from "../../src/db/sources";
import { createStream, getStream, setStreamStatus } from "../../src/db/streams";
import { createTarget } from "../../src/db/targets";
import { writeSettings } from "../../src/runtime/config";
import {
  listTombstones,
  recoverInterruptedStreams,
  removeTombstone,
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

function createRecoverableStream() {
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
  return setStreamStatus(stream.id, "running", { pid: 999_999 })!;
}

describe("recovery tombstones", () => {
  it("writes, lists, and removes tombstones", () => {
    writeTombstone({
      pid: 123,
      status: "running",
      streamId: "str_123",
      writtenAt: "2026-01-01T00:00:00.000Z",
    });

    expect(listTombstones()).toEqual([
      {
        pid: 123,
        status: "running",
        streamId: "str_123",
        writtenAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    removeTombstone("str_123");
    expect(listTombstones()).toEqual([]);
  });
});

describe.skipIf(!hasSqlite())("recovery reconciliation", () => {
  it("marks tombstoned streams as failed and records an event", () => {
    const stream = createRecoverableStream();
    writeTombstone({
      pid: 999_999,
      status: "running",
      streamId: stream.id,
      writtenAt: "2026-01-01T00:00:00.000Z",
    });

    const recovered = recoverInterruptedStreams();
    const updated = getStream(stream.id);

    expect(recovered).toHaveLength(1);
    expect(updated?.status).toBe("failed");
    expect(updated?.lastError).toBe("Forge Worker restarted before stream stopped cleanly");
    expect(listTombstones()).toEqual([]);
    expect(listEvents(stream.id)[0]?.kind).toBe("failed");
  });

  it("resets skipped streams to pending for auto-start", () => {
    const stream = createRecoverableStream();
    writeTombstone({
      pid: 999_999,
      status: "running",
      streamId: stream.id,
      writtenAt: "2026-01-01T00:00:00.000Z",
    });

    const recovered = recoverInterruptedStreams([stream.id]);
    const updated = getStream(stream.id);

    expect(recovered).toHaveLength(0);
    expect(updated?.status).toBe("pending");
    expect(updated?.lastError).toBeNull();
    expect(listTombstones()).toEqual([]);
  });
});
