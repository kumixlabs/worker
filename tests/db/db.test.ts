import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../../src/db/client";
import { addEvent, clearEvents, listEvents, onEvent } from "../../src/db/events";
import { createSource, deleteSource } from "../../src/db/sources";
import { stats } from "../../src/db/stats";
import { createStream } from "../../src/db/streams";
import { createTarget, deleteTarget } from "../../src/db/targets";
import { writeSettings } from "../../src/runtime/config";
import { hasSqlite } from "../helpers";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  resetDbForTests();
  writeSettings({
    diskUsageLimitPercent: 90,
    timezone: "Asia/Jakarta",
    dataDir,
    port: 8080,
    token: "test-token-123456",
  });
});

afterEach(() => {
  resetDbForTests();
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

describe.skipIf(!hasSqlite())("DB integration", () => {
  it("creates sources, targets, streams, events, and stats", () => {
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
    addEvent(stream.id, "test", "Test event", { ok: true });
    const [event] = listEvents(stream.id);

    expect(source.id).toMatch(/^src_/);
    expect(target.id).toMatch(/^tgt_/);
    expect(stream.id).toMatch(/^stm_/);
    expect(event?.id).toMatch(/^evt_/);
    expect(event?.payload).toEqual({ ok: true });
    expect(stats().streams.total).toBe(1);
  });

  it("notifies listeners and clears events", () => {
    const received: string[] = [];
    const off = onEvent((event) => received.push(event.message));

    addEvent(null, "system", "First", null);
    off();
    addEvent(null, "system", "Second", null);

    expect(received).toEqual(["First"]);
    expect(listEvents()).toHaveLength(2);
    expect(clearEvents()).toBe(2);
    expect(listEvents()).toHaveLength(0);
  });

  it("blocks deleting sources and targets used by streams", () => {
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
    createStream({
      loop: true,
      recurrence: "none",
      sourceId: source.id,
      targetId: target.id,
      title: "Live",
    });

    expect(() => deleteSource(source.id)).toThrow("Source is used by 1 stream(s)");
    expect(() => deleteTarget(target.id)).toThrow("Target is used by 1 stream(s)");
  });
});
