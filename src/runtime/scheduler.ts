/**
 * Scheduler loop for starting due streams and stopping elapsed streams.
 */

import { addEvent } from "../db/events";
import { listStreams, patchStream } from "../db/streams";
import { fromZonedParts, zonedParts, zonedWeekday } from "../lib/timezone";
import { startStream, stopStream } from "../services/stream-runner";
import type { StreamRecord } from "../types/stream";
import { readSettings } from "./config";

type SchedulerAction = {
  streamId: string;
  type: "start" | "stop";
};

type SchedulerStatus = {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastStarted: number;
  lastStopped: number;
};

let schedulerTickInFlight = false;

const schedulerStatus: SchedulerStatus = {
  running: false,
  intervalMs: 0,
  lastTickAt: null,
  lastStarted: 0,
  lastStopped: 0,
};

type SchedulerTickResult = {
  started: string[];
  stopped: string[];
};

type RecurrenceRule = {
  time?: string;
  weekdays?: number[];
};

/**
 * Parses a stream recurrence rule object.
 *
 * @param value - The raw recurrence rule value.
 * @returns The parsed recurrence rule.
 */
function recurrenceRule(value: unknown): RecurrenceRule {
  if (!value || typeof value !== "object") return {};
  const rule = value as RecurrenceRule;
  return {
    time: typeof rule.time === "string" ? rule.time : undefined,
    weekdays: Array.isArray(rule.weekdays) ? rule.weekdays.filter(Number.isInteger) : undefined,
  };
}

/**
 * Returns the number of days in a given 1-based month.
 *
 * @param year - The full year.
 * @param month - The 1-based month (1-12).
 * @returns The number of days in the month.
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Determines whether a scheduled timestamp is due relative to the given time.
 *
 * @param value - The ISO timestamp to check.
 * @param now - The reference time.
 * @returns True when the value exists and is at or before now.
 */
function isDue(value: string | null, now: Date): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= now.getTime();
}

/**
 * Computes the next scheduled start time for a recurring stream.
 * Returns null for non-recurring streams.
 *
 * @param stream - The stream whose recurrence is evaluated.
 * @param now - The reference time.
 * @returns The next ISO start time, or null if not recurring.
 */
export function computeNextSchedule(stream: StreamRecord, now = new Date()): string | null {
  if (stream.recurrence === "none") return null;

  const timezone = readSettings().timezone;
  const rule = recurrenceRule(stream.recurrenceRule);
  const scheduledTime = stream.scheduledFor ? new Date(stream.scheduledFor).getTime() : NaN;
  const base = Number.isFinite(scheduledTime) ? new Date(scheduledTime) : now;
  const parts = zonedParts(new Date(Math.max(base.getTime(), now.getTime())), timezone);
  const [parsedHour, parsedMinute] = rule.time?.split(":").map(Number) ?? [];
  const ruleHour = Number.isFinite(parsedHour) ? (parsedHour as number) : parts.hour;
  const ruleMinute = Number.isFinite(parsedMinute) ? (parsedMinute as number) : parts.minute;
  parts.hour = ruleHour;
  parts.minute = ruleMinute;
  parts.second = 0;

  const candidates: Date[] = [];
  if (stream.recurrence === "daily") {
    for (let offset = 0; offset <= 2; offset += 1) {
      candidates.push(fromZonedParts({ ...parts, day: parts.day + offset }, timezone));
    }
  }

  if (stream.recurrence === "weekly") {
    const weekdays = rule.weekdays?.length ? rule.weekdays : [zonedWeekday(base, timezone)];
    for (let offset = 0; offset <= 14; offset += 1) {
      const candidate = fromZonedParts({ ...parts, day: parts.day + offset }, timezone);
      if (weekdays.includes(zonedWeekday(candidate, timezone))) candidates.push(candidate);
    }
  }

  if (stream.recurrence === "monthly") {
    for (let offset = 0; offset <= 1; offset += 1) {
      const year = parts.year + Math.floor((parts.month - 1 + offset) / 12);
      const month = ((parts.month - 1 + offset) % 12) + 1;
      const day = Math.min(parts.day, daysInMonth(year, month));
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

/**
 * Scans streams and produces the start/stop actions that are currently due.
 * Pending streams past their scheduledFor are started; running/stopping streams
 * past their autoStopAt are stopped.
 *
 * @param streams - The streams to evaluate.
 * @param now - The reference time.
 * @returns The list of due actions.
 */
export function collectDueActions(streams: StreamRecord[], now = new Date()): SchedulerAction[] {
  return streams.flatMap((stream) => {
    const actions: SchedulerAction[] = [];
    const canStart =
      stream.status === "pending" || (stream.status === "stopped" && stream.recurrence !== "none");
    if (canStart && isDue(stream.scheduledFor, now)) {
      actions.push({ streamId: stream.id, type: "start" });
    }
    if (
      (stream.status === "running" || stream.status === "stopping") &&
      isDue(stream.autoStopAt, now)
    ) {
      actions.push({ streamId: stream.id, type: "stop" });
    }
    return actions;
  });
}

/**
 * Runs a single scheduler tick: starts due pending streams, stops elapsed streams,
 * advances recurring schedules, and records the tick state.
 *
 * @param now - The reference time for evaluating due actions.
 * @returns The list of started and stopped stream IDs.
 */
export async function tickScheduler(now = new Date()): Promise<SchedulerTickResult> {
  const result: SchedulerTickResult = { started: [], stopped: [] };

  for (const action of collectDueActions(listStreams(), now)) {
    try {
      if (action.type === "start") {
        const started = await startStream(action.streamId);
        if (started) {
          result.started.push(action.streamId);
          if (started.recurrence !== "none" && !started.autoStopAt) {
            const nextSchedule = computeNextSchedule(started, now);
            if (nextSchedule) patchStream(action.streamId, { scheduledFor: nextSchedule });
          }
        }
      } else {
        const stopped = stopStream(action.streamId);
        if (stopped) {
          result.stopped.push(action.streamId);
          if (stopped.recurrence !== "none") {
            const nextSchedule = computeNextSchedule(stopped, now);
            if (nextSchedule) {
              const windowMs =
                stopped.autoStopAt && stopped.scheduledFor
                  ? new Date(stopped.autoStopAt).getTime() -
                    new Date(stopped.scheduledFor).getTime()
                  : 0;
              const autoStopAt =
                windowMs > 0
                  ? new Date(new Date(nextSchedule).getTime() + windowMs).toISOString()
                  : null;
              patchStream(action.streamId, { scheduledFor: nextSchedule, autoStopAt });
            }
          }
        }
      }
    } catch (error) {
      addEvent(
        action.streamId,
        "error",
        `Scheduler ${action.type} failed: ${error instanceof Error ? error.message : String(error)}`,
        { action: action.type },
      );
    }
  }

  schedulerStatus.lastTickAt = now.toISOString();
  schedulerStatus.lastStarted = result.started.length;
  schedulerStatus.lastStopped = result.stopped.length;
  return result;
}

/**
 * Returns a snapshot of the current scheduler runtime state.
 *
 * @returns A copy of the scheduler status.
 */
export function schedulerState() {
  return { ...schedulerStatus };
}

/**
 * Starts the scheduler loop that periodically evaluates due stream actions.
 *
 * @param intervalMs - The tick interval in milliseconds (default 30000).
 * @returns A stop function that clears the interval and marks the scheduler idle.
 */
export function startScheduler(intervalMs = 30_000): () => void {
  schedulerStatus.running = true;
  schedulerStatus.intervalMs = intervalMs;
  const timer = setInterval(() => {
    if (schedulerTickInFlight) return;
    schedulerTickInFlight = true;
    void tickScheduler().finally(() => {
      schedulerTickInFlight = false;
    });
  }, intervalMs);
  timer.unref?.();
  return () => {
    schedulerStatus.running = false;
    clearInterval(timer);
  };
}
