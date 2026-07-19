import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createSource } from "../../src/db/sources";
import { createStream, getStream, setStreamStatus } from "../../src/db/streams";
import { createTarget } from "../../src/db/targets";
import { writeSettings } from "../../src/runtime/config";
import {
  onStreamEvent,
  reconcileOrphanedDbStreams,
  runningStreamIds,
  stopAllStreams,
  stopStream,
} from "../../src/services/stream-runner";
import { hasSqlite } from "../helpers";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-runner-"));
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

function createReadyStream() {
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
  return createStream({
    loop: true,
    recurrence: "none",
    sourceId: source.id,
    targetId: target.id,
    title: "Test",
  });
}

describe.skipIf(!hasSqlite())("stream-runner lifecycle", () => {
  it("registers and emits stream events to listeners", () => {
    const stream = createReadyStream();
    const received: unknown[] = [];
    const off = onStreamEvent(stream.id, (event) => received.push(event));

    // onStreamEvent returns an unsubscribe function
    expect(typeof off).toBe("function");
    off();
    expect(received).toEqual([]);
  });

  it("unsubscribes listeners cleanly", () => {
    const stream = createReadyStream();
    const received: unknown[] = [];
    const off = onStreamEvent(stream.id, (event) => received.push(event));
    off();
    off(); // double unsubscribe should not throw
    expect(received).toEqual([]);
  });

  it("returns null when stopping a non-existent stream", () => {
    const result = stopStream("stm_nonexistent");
    expect(result).toBeNull();
  });

  it("does nothing when stopping a stream that is already stopped", () => {
    const stream = createReadyStream();
    const result = stopStream(stream.id);
    expect(result?.status).toBe("pending");
  });

  it("marks a running stream as stopped when no process is tracked", () => {
    // Simulate a running stream whose process was already lost (e.g. after a
    // crash recovery where the DB still says running but processes map is empty).
    const stream = createReadyStream();
    setStreamStatus(stream.id, "running", { pid: 999_999 });

    const result = stopStream(stream.id);

    expect(result?.status).toBe("stopped");
    expect(result?.stoppedAt).toBeTruthy();
    expect(result?.pid).toBeNull();
    // The DB should reflect the stopped state.
    expect(getStream(stream.id)?.status).toBe("stopped");
  });

  it("reports no running stream IDs when nothing is tracked", () => {
    createReadyStream();
    expect(runningStreamIds()).toEqual([]);
  });

  it("stopAllStreams completes immediately when no processes are tracked", async () => {
    const result = await stopAllStreams();
    expect(result.requested).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("reconciles orphaned running streams with dead PIDs and no process map entry", () => {
    const stream = createReadyStream();
    setStreamStatus(stream.id, "running", { pid: 999_999 });

    const healed = reconcileOrphanedDbStreams();

    expect(healed).toBe(1);
    expect(getStream(stream.id)?.status).toBe("failed");
    expect(getStream(stream.id)?.pid).toBeNull();
    expect(getStream(stream.id)?.lastError).toContain("no longer tracked");
  });
});
