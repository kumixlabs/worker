/**
 * FFmpeg process lifecycle and stream event broadcasting helpers.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";

import { getDb } from "../db/client";
import { addEvent } from "../db/events";
import { getSource } from "../db/sources";
import { getStream, listStreams, setStreamStatus } from "../db/streams";
import { getTarget } from "../db/targets";
import { decryptSecret } from "../lib/crypto";
import { nowIso } from "../lib/utils";
import { getFfmpegPath } from "../runtime/ffmpeg";
import { isPidAlive, removeTombstone, writeTombstone } from "../runtime/recovery";
import type { StreamMetrics, StreamRecord } from "../types/stream";

const processes = new Map<string, ChildProcess>();
const startingStreams = new Set<string>();
const stopRequested = new Set<string>();
const restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
const restartAttempts = new Map<string, number>();
/** Successful streaming this long resets the restart budget (ms). */
const restartBudgetResetMs = 10 * 60 * 1000;
const maxRestartAttempts = 12;
const listeners = new Map<string, Set<(event: unknown) => void>>();
const processStartedAt = new Map<string, number>();

function forceSetStreamStatus(
  id: string,
  status: StreamRecord["status"],
  data: Partial<
    Pick<StreamRecord, "pid" | "startedAt" | "stoppedAt" | "lastError" | "lastMetrics">
  > = {},
): boolean {
  const existing = getStream(id);
  if (!existing) return false;
  try {
    setStreamStatus(id, status, data);
    return true;
  } catch {
    const db = getDb();
    try {
      db.query(
        "UPDATE streams SET status = ?, started_at = ?, stopped_at = ?, pid = ?, last_error = ?, last_metrics = ?, updated_at = ? WHERE id = ?",
      ).run(
        status,
        data.startedAt !== undefined ? data.startedAt : existing.startedAt,
        data.stoppedAt !== undefined ? data.stoppedAt : existing.stoppedAt,
        data.pid !== undefined ? data.pid : existing.pid,
        data.lastError !== undefined ? data.lastError : existing.lastError,
        data.lastMetrics !== undefined
          ? data.lastMetrics
            ? JSON.stringify(data.lastMetrics)
            : null
          : existing.lastMetrics
            ? JSON.stringify(existing.lastMetrics)
            : null,
        nowIso(),
        id,
      );
      return true;
    } catch (error) {
      console.error(
        `[worker] forceSetStreamStatus failed for ${id}:`,
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }
}

/**
 * Summary of a best-effort stop request for all tracked stream processes.
 */
export type StopAllStreamsResult = {
  requested: string[];
  remaining: string[];
};

/**
 * Emits an event to all listeners registered for a given stream.
 *
 * @param streamId - The stream the event belongs to.
 * @param event - The event payload to broadcast.
 */
function emit(streamId: string, event: unknown): void {
  for (const listener of listeners.get(streamId) ?? []) {
    try {
      listener(event);
    } catch {
      listeners.get(streamId)?.delete(listener);
    }
  }
}

/**
 * Requests a graceful stop for every currently running stream process.
 *
 * @param timeoutMs - Maximum time to wait for tracked processes to exit.
 * @returns Stop request summary with remaining tracked streams.
 */
export async function stopAllStreams(timeoutMs = 12_000): Promise<StopAllStreamsResult> {
  const streamIds = Array.from(processes.keys());
  for (const streamId of streamIds) stopStream(streamId);
  if (streamIds.length === 0) return { requested: [], remaining: [] };

  await new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (
        streamIds.every((streamId) => !processes.has(streamId)) ||
        Date.now() - startedAt >= timeoutMs
      ) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
    timer.unref?.();
  });

  return {
    requested: streamIds,
    remaining: streamIds.filter((streamId) => processes.has(streamId)),
  };
}

/**
 * Subscribes a listener to events for a specific stream.
 *
 * @param streamId - The stream to listen to.
 * @param listener - The callback invoked for each emitted event.
 * @returns An unsubscribe function.
 */
export function onStreamEvent(streamId: string, listener: (event: unknown) => void): () => void {
  const set = listeners.get(streamId) ?? new Set();
  set.add(listener);
  listeners.set(streamId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(streamId);
  };
}

/**
 * Parses fps, bitrate, and dropped frames from a single FFmpeg stderr line.
 * Returns the previous metrics unchanged when the line carries no progress data.
 *
 * @param line - A line of FFmpeg stderr output.
 * @param previous - The last known metrics.
 * @returns The updated metrics, or the previous value when nothing changed.
 */
export function parseMetrics(line: string, previous: StreamMetrics | null): StreamMetrics | null {
  const fps = line.match(/fps=\s*([\d.]+)/)?.[1];
  const bitrate = line.match(/bitrate=\s*([\d.]+)kbits\/s/)?.[1];
  const dropped = line.match(/drop=\s*(\d+)/)?.[1];
  if (!fps && !bitrate && !dropped) return previous;
  return {
    fps: fps ? Number(fps) : (previous?.fps ?? null),
    bitrateKbps: bitrate ? Number(bitrate) : (previous?.bitrateKbps ?? null),
    droppedFrames: dropped ? Number(dropped) : (previous?.droppedFrames ?? null),
  };
}

/** FFmpeg progress stats use CR updates; treat as noise for logs/diagnostics. */
export function isFfmpegProgressLine(line: string): boolean {
  return /(?:^|\s)frame=\s*\d+/.test(line) || /(?:^|\s)fps=\s*[\d.]+/.test(line);
}

function splitFfmpegOutput(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r|\n/);
  return { lines: parts.slice(0, -1), rest: parts.at(-1) ?? "" };
}

/**
 * Redacts the stream key segment from an RTMP URL in a log line.
 *
 * @param line - The raw log line.
 * @returns The line with any stream key replaced by "[redacted]".
 */
export function redactFfmpegLog(line: string): string {
  return line.replace(/(rtmps?:\/\/[^\s]+\/)[^\s]+/gi, "$1[redacted]");
}

/**
 * Builds the FFmpeg argument list to remux a local file to an RTMP destination.
 * Always loops the source; schedule/auto-stop owns when the broadcast ends.
 * Copies video while re-encoding audio for reliable AAC/FLV output.
 *
 * @param input - The source path, ingest URL, and stream key.
 * @returns The ordered FFmpeg CLI arguments.
 */
export function buildFfmpegArgs(input: {
  filePath: string;
  ingestUrl: string;
  streamKey: string;
}): string[] {
  const output = `${input.ingestUrl.replace(/\/$/, "")}/${input.streamKey}`;
  return [
    "-hide_banner",
    "-loglevel",
    "info",
    "-stream_loop",
    "-1",
    "-fflags",
    "+genpts",
    "-probesize",
    "32",
    "-analyzeduration",
    "0",
    "-re",
    "-i",
    input.filePath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-af",
    "aresample=async=1:first_pts=0",
    "-flvflags",
    "no_duration_filesize",
    "-f",
    "flv",
    output,
  ];
}

/**
 * Terminates an FFmpeg child process with platform-specific process-tree handling.
 *
 * @param child - The child process to terminate.
 * @param signal - The requested POSIX signal.
 */
function killChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === "win32" && child.pid) {
    execFile(
      "taskkill",
      ["/pid", String(child.pid), "/t", signal === "SIGKILL" ? "/f" : ""].filter(Boolean),
      () => undefined,
    );
    return;
  }
  child.kill(signal);
}

/**
 * Starts a stream by validating its source/target, spawning FFmpeg, and tracking tombstones.
 *
 * @param streamId - The stream to start.
 * @returns The updated stream record, or null when the stream no longer exists.
 */
export async function startStream(streamId: string): Promise<StreamRecord | null> {
  if (processes.has(streamId)) return getStream(streamId);
  if (startingStreams.has(streamId)) throw new Error("Stream start is already in progress");
  startingStreams.add(streamId);
  try {
    const stream = getStream(streamId);
    if (!stream) throw new Error("Stream not found");
    // Allow reconnect while status is still "running" (process map empty).
    if (stream.status === "stopping") {
      throw new Error("Stream is already running or stopping");
    }
    if (stream.status === "running" && processes.has(streamId)) {
      throw new Error("Stream is already running or stopping");
    }
    const source = getSource(stream.sourceId);
    const target = getTarget(stream.targetId);
    if (source?.status !== "ready" || !source.filePath) throw new Error("Source is not ready");
    if (!target?.active) throw new Error("Target is disabled");
    const streamKey = decryptSecret(target.streamKey);
    if (!streamKey) throw new Error("Stream key unavailable");

    const child = spawn(
      getFfmpegPath(),
      buildFfmpegArgs({
        filePath: source.filePath,
        ingestUrl: target.ingestUrl,
        streamKey,
      }),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    if (!child.pid) {
      const message = "Failed to spawn ffmpeg";
      setStreamStatus(streamId, "failed", {
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastError: message,
      });
      addEvent(streamId, "failed", `FFmpeg failed: ${message}`, null);
      emit(streamId, { type: "status", status: "failed" });
      throw new Error(message);
    }
    processes.set(streamId, child);
    processStartedAt.set(streamId, Date.now());
    try {
      writeTombstone({
        pid: child.pid,
        status: "running",
        streamId,
        writtenAt: new Date().toISOString(),
      });
    } catch (error) {
      processes.delete(streamId);
      processStartedAt.delete(streamId);
      killChildProcess(child, "SIGKILL");
      const message =
        error instanceof Error ? error.message : "Failed to initialize stream recovery";
      forceSetStreamStatus(streamId, "failed", {
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastError: message,
      });
      addEvent(streamId, "failed", `FFmpeg failed: ${message}`, null);
      throw error;
    }
    try {
      // Allow restart while still marked running (reconnect path) via force write.
      const existing = getStream(streamId);
      if (existing?.status === "running" || existing?.status === "stopping") {
        forceSetStreamStatus(streamId, "running", {
          startedAt: existing.startedAt ?? new Date().toISOString(),
          pid: child.pid,
          lastError: null,
        });
      } else {
        setStreamStatus(streamId, "running", {
          startedAt: new Date().toISOString(),
          pid: child.pid,
          lastError: null,
        });
      }
    } catch (error) {
      processes.delete(streamId);
      processStartedAt.delete(streamId);
      killChildProcess(child, "SIGKILL");
      try {
        removeTombstone(streamId);
      } catch {
        // ignore
      }
      const message = error instanceof Error ? error.message : "Failed to mark stream running";
      forceSetStreamStatus(streamId, "failed", {
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastError: message,
      });
      addEvent(streamId, "failed", `FFmpeg failed: ${message}`, null);
      emit(streamId, { type: "status", status: "failed" });
      throw error;
    }
    if (stopRequested.has(streamId)) {
      const childToStop = processes.get(streamId);
      if (childToStop) {
        setStreamStatus(streamId, "stopping");
        addEvent(streamId, "stopping", "Stop requested during start", null);
        killChildProcess(childToStop, "SIGTERM");
      }
    } else {
      addEvent(streamId, "running", `FFmpeg started with pid ${child.pid}`, { pid: child.pid });
      emit(streamId, { type: "status", status: "running" });
    }

    let lastMetrics: StreamMetrics | null = null;
    let lastMetricsPersistAt = 0;
    const diagnosticLines: string[] = [];
    let stderrBuffer = "";
    const rememberDiagnostic = (line: string) => {
      const safeLine = redactFfmpegLog(line).trim();
      if (!safeLine || isFfmpegProgressLine(safeLine)) return;
      diagnosticLines.push(safeLine.slice(0, 500));
      if (diagnosticLines.length > 10) diagnosticLines.shift();
    };
    child.stdout?.on("data", () => undefined);
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const { lines, rest } = splitFfmpegOutput(stderrBuffer);
      stderrBuffer = rest;
      for (const line of lines) {
        if (!line.trim()) continue;
        const metrics = parseMetrics(line, lastMetrics);
        if (metrics && metrics !== lastMetrics) {
          lastMetrics = metrics;
          emit(streamId, { type: "metrics", metrics });
          if (Date.now() - lastMetricsPersistAt >= 5_000) {
            lastMetricsPersistAt = Date.now();
            if (getStream(streamId)?.status === "running")
              try {
                setStreamStatus(streamId, "running", { lastMetrics: metrics });
              } catch {
                // ignore concurrent status mutation
              }
          }
        }
        rememberDiagnostic(line);
      }
    });

    let settled = false;
    const settle = (status: "stopped" | "failed", message: string, payload: unknown) => {
      if (settled) return;
      settled = true;
      processes.delete(streamId);
      processStartedAt.delete(streamId);
      stopRequested.delete(streamId);
      if (status === "stopped") restartAttempts.delete(streamId);
      const current = getStream(streamId);
      if (!current) {
        try {
          removeTombstone(streamId);
        } catch {
          // ignore
        }
        return emit(streamId, { type: "status", status: "deleted" });
      }
      const diagnostic = diagnosticLines.slice(-5).join(" | ").slice(0, 1_000);
      const failureMessage =
        status === "failed" && diagnostic ? `${message}: ${diagnostic}` : message;
      const written = forceSetStreamStatus(streamId, status, {
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastError: status === "stopped" ? null : failureMessage,
      });
      if (written) {
        try {
          removeTombstone(streamId);
        } catch {
          // ignore
        }
      } else {
        console.error(
          `[worker] settle kept tombstone for ${streamId}; status write failed (${status})`,
        );
      }
      addEvent(streamId, status, failureMessage, payload);
      emit(streamId, { type: "status", status });
    };

    const scheduleRestart = (code: number | null, signal: NodeJS.Signals | null) => {
      const startedAt = processStartedAt.get(streamId) ?? 0;
      if (startedAt && Date.now() - startedAt >= restartBudgetResetMs) {
        restartAttempts.delete(streamId);
      }
      const attempt = (restartAttempts.get(streamId) ?? 0) + 1;
      if (attempt > maxRestartAttempts) return false;
      restartAttempts.set(streamId, attempt);
      const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempt - 1, 5));
      const diagnostic = diagnosticLines.slice(-3).join(" | ").slice(0, 500);
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      settled = true;
      processes.delete(streamId);
      processStartedAt.delete(streamId);
      // Stay "running" while reconnecting so operators do not see a false failure.
      forceSetStreamStatus(streamId, "running", {
        pid: null,
        lastError: `Reconnecting after FFmpeg exit (${reason})${
          diagnostic ? `: ${diagnostic}` : ""
        }`,
      });
      try {
        removeTombstone(streamId);
      } catch {
        // ignore
      }
      addEvent(streamId, "restart_scheduled", `FFmpeg restart scheduled in ${delay}ms`, {
        attempt,
        delay,
        code,
        signal,
      });
      emit(streamId, { type: "status", status: "restarting" });
      restartTimers.set(
        streamId,
        setTimeout(() => {
          restartTimers.delete(streamId);
          if (stopRequested.has(streamId)) {
            stopRequested.delete(streamId);
            forceSetStreamStatus(streamId, "stopped", {
              stoppedAt: new Date().toISOString(),
              pid: null,
              lastError: null,
            });
            addEvent(streamId, "stopped", "Stop requested during reconnect", null);
            emit(streamId, { type: "status", status: "stopped" });
            return;
          }
          void startStream(streamId).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            addEvent(streamId, "restart_failed", message);
            if (stopRequested.has(streamId)) {
              stopRequested.delete(streamId);
              forceSetStreamStatus(streamId, "stopped", {
                stoppedAt: new Date().toISOString(),
                pid: null,
                lastError: null,
              });
              addEvent(streamId, "stopped", "Stop requested during reconnect", null);
              emit(streamId, { type: "status", status: "stopped" });
              return;
            }
            // Hard failures already marked failed/stopped inside startStream — do not revive.
            const current = getStream(streamId);
            if (current?.status === "failed" || current?.status === "stopped") return;
            if (!scheduleRestart(null, null)) {
              forceSetStreamStatus(streamId, "failed", {
                stoppedAt: new Date().toISOString(),
                pid: null,
                lastError: `Reconnect exhausted after ${maxRestartAttempts} attempts: ${message}`,
              });
              emit(streamId, { type: "status", status: "failed" });
            }
          });
        }, delay),
      );
      return true;
    };

    child.on("error", (error) => {
      if (!stopRequested.has(streamId) && scheduleRestart(null, null)) return;
      settle("failed", `FFmpeg failed: ${error.message}`, null);
    });
    const onFinished = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      if (stderrBuffer.trim()) rememberDiagnostic(stderrBuffer);
      const current = getStream(streamId);
      if (!current) return settle("failed", "FFmpeg stream deleted", { code, signal });
      const intentional = stopRequested.has(streamId);
      // Exit 0 = clean end. Intentional stop always "stopped".
      if (intentional || code === 0) {
        restartAttempts.delete(streamId);
        const timer = restartTimers.get(streamId);
        if (timer) {
          clearTimeout(timer);
          restartTimers.delete(streamId);
        }
        settle("stopped", "FFmpeg stopped", { code, signal });
        return;
      }
      if (scheduleRestart(code, signal)) return;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      settle("failed", `FFmpeg failed with ${reason}`, { code, signal });
    };
    child.on("close", onFinished);
    child.on("exit", (code, signal) => {
      if (!settled) onFinished(code, signal);
    });
    return getStream(streamId);
  } finally {
    startingStreams.delete(streamId);
  }
}

/**
 * Requests a graceful stop for a stream. Sends SIGTERM, then SIGKILL after 10s
 * if the process has not exited. Marks the stream stopped immediately when no
 * process is tracked.
 *
 * @param streamId - The stream to stop.
 * @returns The updated stream record.
 */
export function stopStream(streamId: string) {
  const stream = getStream(streamId);
  if (!stream) return stream;
  const child = processes.get(streamId);
  const starting = startingStreams.has(streamId);
  if (stream.status !== "running" && stream.status !== "stopping" && !child && !starting) {
    return stream;
  }
  stopRequested.add(streamId);
  const restartTimer = restartTimers.get(streamId);
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimers.delete(streamId);
  }
  restartAttempts.delete(streamId);
  if (starting && !child) {
    addEvent(streamId, "stopping", "Stop requested during start", null);
    return getStream(streamId);
  }
  try {
    setStreamStatus(streamId, "stopping");
  } catch {
    forceSetStreamStatus(streamId, "stopping");
  }
  addEvent(streamId, "stopping", "Stop requested", null);
  if (!child) {
    forceSetStreamStatus(streamId, "stopped", {
      stoppedAt: new Date().toISOString(),
      pid: null,
    });
    stopRequested.delete(streamId);
    addEvent(streamId, "stopped", "FFmpeg stopped", null);
    emit(streamId, { type: "status", status: "stopped" });
    return getStream(streamId);
  }
  killChildProcess(child, "SIGTERM");
  setTimeout(
    () => {
      if (processes.get(streamId) === child) killChildProcess(child, "SIGKILL");
    },
    process.platform === "win32" ? 2_000 : 10_000,
  ).unref?.();
  return getStream(streamId);
}

/**
 * Lists the IDs of all streams with an active FFmpeg process.
 *
 * @returns The currently running stream IDs.
 */
export function runningStreamIds(): string[] {
  return Array.from(processes.keys());
}

export function reconcileOrphanedDbStreams(): number {
  let healed = 0;
  const tracked = new Set(runningStreamIds());
  for (const stream of listStreams()) {
    if ((stream.status === "running" || stream.status === "stopping") && !tracked.has(stream.id)) {
      // Reconnect window: restart timer owns this stream; do not mark failed.
      if (restartTimers.has(stream.id) || startingStreams.has(stream.id)) continue;
      if (stream.pid && isPidAlive(stream.pid)) continue;
      // Stale tombstone + dead/missing PID: force-fail so mid-run orphans still heal.
      const written = forceSetStreamStatus(stream.id, "failed", {
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastError: "Kumix Worker detected FFmpeg process no longer tracked; marked as failed",
      });
      if (!written) continue;
      addEvent(stream.id, "failed", "FFmpeg process no longer tracked; marked as failed", null);
      try {
        removeTombstone(stream.id);
      } catch {
        // ignore
      }
      healed += 1;
    }
  }
  return healed;
}
