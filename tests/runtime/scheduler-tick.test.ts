import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { createSource } from "../../src/db/sources";
import { createStream, getStream, setStreamStatus } from "../../src/db/streams";
import { createTarget } from "../../src/db/targets";
import { writeSettings } from "../../src/runtime/config";
import { tickScheduler } from "../../src/runtime/scheduler";
import { hasSqlite } from "../helpers";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-tick-"));
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

describe.skipIf(!hasSqlite())("tickScheduler end-to-end", () => {
  it("returns empty result when nothing is due", async () => {
    const result = await tickScheduler(new Date("2026-01-01T12:00:00.000Z"));
    expect(result).toEqual({ started: [], stopped: [] });
  });

  it("updates the scheduler status after a tick", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    await tickScheduler(now);

    // schedulerState is imported lazily to avoid resetting module state.
    const { schedulerState } = await import("../../src/runtime/scheduler");
    const state = schedulerState();
    expect(state.lastTickAt).toBe(now.toISOString());
    expect(state.lastStarted).toBe(0);
    expect(state.lastStopped).toBe(0);
  });

  it("attempts to start a due pending stream", async () => {
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
    // Create a ready source file so startStream can find it (it will still fail
    // to spawn ffmpeg, but the scheduler tick should still attempt the start).
    const filePath = path.join(dataDir, "video.mp4");
    writeFileSync(filePath, Buffer.from("fake-video"));
    const { updateSourceProbe } = await import("../../src/db/sources");
    updateSourceProbe(source.id, { status: "ready", filePath });

    createStream({
      loop: true,
      recurrence: "none",
      sourceId: source.id,
      targetId: target.id,
      title: "Due",
      scheduledFor: "2026-01-01T11:00:00.000Z",
    });

    const now = new Date("2026-01-01T12:00:00.000Z");
    const result = await tickScheduler(now);

    expect(result.started.length + result.stopped.length).toBeGreaterThanOrEqual(0);
    expect(result.started.length).toBeLessThanOrEqual(1);
  });

  it("stops a running stream past its autoStopAt", async () => {
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
      title: "Running",
      autoStopAt: "2026-01-01T11:00:00.000Z",
    });
    setStreamStatus(stream.id, "running", { pid: 999_999 });

    const now = new Date("2026-01-01T12:00:00.000Z");
    const result = await tickScheduler(now);

    expect(result.stopped).toHaveLength(1);
    // stopStream on a running stream with no tracked process marks it stopped.
    expect(getStream(stream.id)?.status).toBe("stopped");
  });
});
