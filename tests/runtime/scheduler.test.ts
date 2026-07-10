import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSettings } from "../../src/runtime/config";
import { collectDueActions, computeNextSchedule } from "../../src/runtime/scheduler";
import type { StreamRecord } from "../../src/types/stream";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "kumix-worker-"));
  process.env.KUMIX_WORKER_DATA_DIR = dataDir;
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
});

afterEach(() => {
  delete process.env.KUMIX_WORKER_DATA_DIR;
  rmSync(dataDir, { force: true, recursive: true });
});

function stream(overrides: Partial<StreamRecord>): StreamRecord {
  return {
    autoStopAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "str_1",
    lastError: null,
    lastMetrics: null,
    loop: true,
    pid: null,
    recurrence: "none",
    recurrenceRule: null,
    scheduledFor: null,
    sourceId: "src_1",
    startedAt: null,
    status: "pending",
    stoppedAt: null,
    targetId: "tgt_1",
    title: "Stream",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("scheduler", () => {
  it("collects due start and stop actions", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    expect(
      collectDueActions(
        [
          stream({ id: "str_start", scheduledFor: "2026-01-01T11:59:00.000Z", status: "pending" }),
          stream({ autoStopAt: "2026-01-01T11:59:00.000Z", id: "str_stop", status: "running" }),
          stream({ id: "str_future", scheduledFor: "2026-01-01T12:01:00.000Z", status: "pending" }),
          stream({ id: "str_invalid", scheduledFor: "not-a-date", status: "pending" }),
          stream({
            id: "str_recur",
            recurrence: "daily",
            scheduledFor: "2026-01-01T11:59:00.000Z",
            status: "stopped",
          }),
        ],
        now,
      ),
    ).toEqual([
      { streamId: "str_start", type: "start" },
      { streamId: "str_stop", type: "stop" },
      { streamId: "str_recur", type: "start" },
    ]);
  });

  it("computes next daily and weekly schedules in the configured timezone", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    expect(
      computeNextSchedule(
        stream({ recurrence: "daily", scheduledFor: "2026-01-01T11:00:00.000Z" }),
        now,
      ),
    ).toBe("2026-01-02T12:00:00.000Z");
    expect(
      computeNextSchedule(
        stream({ recurrence: "weekly", scheduledFor: "2026-01-01T11:00:00.000Z" }),
        now,
      ),
    ).toBe("2026-01-08T12:00:00.000Z");
    expect(computeNextSchedule(stream({ recurrence: "none" }), now)).toBeNull();
  });

  it("falls back to now when a recurring stream has an invalid scheduledFor", () => {
    const now = new Date("2026-01-01T00:30:00.000Z");

    expect(
      computeNextSchedule(
        stream({ recurrence: "daily", recurrenceRule: { time: "08:00" }, scheduledFor: "bad" }),
        now,
      ),
    ).toBe("2026-01-01T01:00:00.000Z");
  });
});
