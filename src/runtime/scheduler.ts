/**
 * Scheduler loop for starting due streams and stopping elapsed streams.
 */

import { getAuthDb } from "../auth/server";
import {
  listAllStreams,
  patchStreamSchedule,
  type StreamRecord,
  type StreamRecurrenceRule,
} from "../db/streams";
import { fromZonedParts, zonedParts, zonedWeekday } from "../lib/timezone";
import { assertStreamQuota } from "../services/quota";
import { startStream, stopStream } from "../services/stream-runner";
import { readSettings } from "./config";

const TICK_MS = 30_000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

type RecurrenceRule = Required<Pick<StreamRecurrenceRule, "time">> &
  Partial<Pick<StreamRecurrenceRule, "weekdays" | "day" | "durationMinutes">>;

function recurrenceRule(stream: StreamRecord): RecurrenceRule {
  const rule = stream.recurrenceRule;
  if (!rule || typeof rule.time !== "string") return { time: "00:00" };
  return {
    time: rule.time,
    weekdays: Array.isArray(rule.weekdays) ? rule.weekdays.filter(Number.isInteger) : undefined,
    day: Number.isInteger(rule.day) ? rule.day : undefined,
    durationMinutes: rule.durationMinutes,
  };
}

function isDue(value: string | null, now: Date): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= now.getTime();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function computeNextSchedule(stream: StreamRecord, now = new Date()): string | null {
  if (stream.recurrence === "none") return null;
  const timezone = readSettings().timezone;
  const rule = recurrenceRule(stream);
  const [hour, minute] = rule.time.split(":").map(Number);
  const base = stream.scheduledFor ? new Date(stream.scheduledFor) : now;
  const parts = zonedParts(base, timezone);
  parts.hour = Number.isFinite(hour) ? hour : 0;
  parts.minute = Number.isFinite(minute) ? minute : 0;
  parts.second = 0;

  const candidates: Date[] = [];
  if (stream.recurrence === "daily") {
    for (let offset = 0; offset <= 2; offset += 1)
      candidates.push(fromZonedParts({ ...parts, day: parts.day + offset }, timezone));
  }
  if (stream.recurrence === "weekly") {
    const weekdays = rule.weekdays?.length ? rule.weekdays : [zonedWeekday(base, timezone)];
    for (let offset = 0; offset <= 14; offset += 1) {
      const candidate = fromZonedParts({ ...parts, day: parts.day + offset }, timezone);
      if (weekdays.includes(zonedWeekday(candidate, timezone))) candidates.push(candidate);
    }
  }
  if (stream.recurrence === "monthly") {
    const ruleDay = Number.isInteger(rule.day) ? (rule.day as number) : parts.day;
    for (let offset = 0; offset <= 1; offset += 1) {
      const year = parts.year + Math.floor((parts.month - 1 + offset) / 12);
      const month = ((parts.month - 1 + offset) % 12) + 1;
      const day = Math.min(ruleDay, daysInMonth(year, month));
      candidates.push(fromZonedParts({ ...parts, year, month, day }, timezone));
    }
  }
  return (
    candidates
      .filter((candidate) => candidate.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime())[0]
      ?.toISOString() ?? null
  );
}

function autoStopFrom(stream: StreamRecord, scheduledFor: string): string | null {
  const minutes = recurrenceRule(stream).durationMinutes;
  if (!minutes || minutes <= 0) return null;
  return new Date(new Date(scheduledFor).getTime() + minutes * 60_000).toISOString();
}

export type ScheduleInput = {
  recurrence: "none" | "daily" | "weekly" | "monthly";
  time: string;
  weekdays?: number[];
  day?: number;
  durationMinutes?: number;
};

export function scheduleFromInput(input: ScheduleInput): {
  recurrence: ScheduleInput["recurrence"];
  recurrenceRule: StreamRecurrenceRule | null;
  scheduledFor: string | null;
  autoStopAt: string | null;
} {
  if (input.recurrence === "none")
    return { recurrence: "none", recurrenceRule: null, scheduledFor: null, autoStopAt: null };
  const rule: StreamRecurrenceRule = {
    time: input.time,
    ...(input.weekdays ? { weekdays: input.weekdays } : {}),
    ...(input.day !== undefined ? { day: input.day } : {}),
    ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
  };
  const synthetic = {
    recurrence: input.recurrence,
    recurrenceRule: rule,
    scheduledFor: null,
  } as unknown as StreamRecord;
  const next = computeNextSchedule(synthetic);
  return {
    recurrence: input.recurrence,
    recurrenceRule: rule,
    scheduledFor: next,
    autoStopAt: next ? autoStopFrom(synthetic, next) : null,
  };
}

export function collectDueActions(
  streams: StreamRecord[],
  now = new Date(),
): { streamId: string; type: "start" | "stop" }[] {
  return streams.flatMap((stream) => {
    const actions: { streamId: string; type: "start" | "stop" }[] = [];
    const canStart =
      stream.status === "stopped" || (stream.status === "failed" && stream.recurrence !== "none");
    if (canStart && stream.recurrence !== "none" && isDue(stream.scheduledFor, now))
      actions.push({ streamId: stream.id, type: "start" });
    if (stream.status === "running" && isDue(stream.autoStopAt, now))
      actions.push({ streamId: stream.id, type: "stop" });
    return actions;
  });
}

export async function tickScheduler(
  now = new Date(),
): Promise<{ started: string[]; stopped: string[] }> {
  const result = { started: [], stopped: [] } as { started: string[]; stopped: string[] };
  const dueActions = collectDueActions(listAllStreams(), now);
  for (const action of dueActions) {
    try {
      if (action.type === "start") {
        const stream = listAllStreams().find((s) => s.id === action.streamId);
        if (!stream) continue;
        const owner = getAuthDb()
          .prepare("SELECT maxStreams FROM user WHERE id = ?")
          .get(stream.userId) as { maxStreams: number | null } | undefined;
        try {
          assertStreamQuota(stream.userId, owner?.maxStreams ?? null);
        } catch {
          continue;
        }
        await startStream(stream.userId, stream.id);
        result.started.push(stream.id);
        const next = computeNextSchedule(stream, now);
        if (next)
          patchStreamSchedule(stream.id, {
            scheduledFor: next,
            autoStopAt: autoStopFrom(stream, next),
          });
      } else {
        const stream = listAllStreams().find((s) => s.id === action.streamId);
        if (!stream) continue;
        await stopStream(stream.userId, stream.id);
        result.stopped.push(stream.id);
      }
    } catch {
      // individual failures must not block other streams
    }
  }
  return result;
}

export function startScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    if (tickInFlight) return;
    tickInFlight = true;
    void tickScheduler()
      .catch(() => {})
      .finally(() => {
        tickInFlight = false;
      });
  }, TICK_MS);
}

export function stopScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}
