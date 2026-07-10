import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSettings } from "../../src/runtime/config";
import { computeNextSchedule } from "../../src/runtime/scheduler";
import type { StreamRecord } from "../../src/types/stream";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "forge-worker-"));
  process.env.FORGE_WORKER_DATA_DIR = dataDir;
  writeSettings({
    dataDir,
    diskUsageLimitPercent: 90,
    port: 8080,
    timezone: "Asia/Jakarta",
    token: "test-token-123456",
  });
});

afterEach(() => {
  delete process.env.FORGE_WORKER_DATA_DIR;
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

describe("computeNextSchedule recurrence rules", () => {
  it("applies recurrenceRule.time in the configured timezone for daily", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    // 08:00 Asia/Jakarta (UTC+7) == 01:00 UTC next day.
    expect(
      computeNextSchedule(
        stream({
          recurrence: "daily",
          recurrenceRule: { time: "08:00" },
          scheduledFor: "2026-01-01T11:00:00.000Z",
        }),
        now,
      ),
    ).toBe("2026-01-02T01:00:00.000Z");
  });

  it("picks the next allowed weekday from recurrenceRule.weekdays", () => {
    const now = new Date("2026-01-01T12:00:00.000Z"); // Thursday

    // weekdays: Monday(1). 09:00 Jakarta == 02:00 UTC. Next Monday is 2026-01-05.
    expect(
      computeNextSchedule(
        stream({
          recurrence: "weekly",
          recurrenceRule: { time: "09:00", weekdays: [1] },
          scheduledFor: "2026-01-01T02:00:00.000Z",
        }),
        now,
      ),
    ).toBe("2026-01-05T02:00:00.000Z");
  });

  it("advances by one month", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");

    expect(
      computeNextSchedule(
        stream({
          recurrence: "monthly",
          recurrenceRule: { time: "07:00" },
          scheduledFor: "2026-01-15T00:00:00.000Z",
        }),
        now,
      ),
    ).toBe("2026-02-15T00:00:00.000Z");
  });

  it("keeps same-day daily recurrence when rule time is still ahead", () => {
    const now = new Date("2026-01-01T00:30:00.000Z");

    expect(
      computeNextSchedule(
        stream({
          recurrence: "daily",
          recurrenceRule: { time: "08:00" },
          scheduledFor: "2026-01-01T00:00:00.000Z",
        }),
        now,
      ),
    ).toBe("2026-01-01T01:00:00.000Z");
  });

  it("keeps same-day weekly recurrence when weekday matches and time is still ahead", () => {
    const now = new Date("2026-01-01T00:30:00.000Z");

    expect(
      computeNextSchedule(
        stream({
          recurrence: "weekly",
          recurrenceRule: { time: "08:00", weekdays: [4] },
          scheduledFor: "2026-01-01T00:00:00.000Z",
        }),
        now,
      ),
    ).toBe("2026-01-01T01:00:00.000Z");
  });

  it("keeps same-day monthly recurrence when day matches and time is still ahead", () => {
    const now = new Date("2026-01-15T23:30:00.000Z");

    expect(
      computeNextSchedule(
        stream({
          recurrence: "monthly",
          recurrenceRule: { time: "07:00" },
          scheduledFor: "2026-01-15T00:00:00.000Z",
        }),
        now,
      ),
    ).toBe("2026-01-16T00:00:00.000Z");
  });

  it("returns null for non-recurring streams", () => {
    expect(computeNextSchedule(stream({ recurrence: "none" }))).toBeNull();
  });
});
