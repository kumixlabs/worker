/**
 * FFmpeg process lifecycle and stream event broadcasting helpers.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";

import { addEvent } from "../db/events";
import { getSource } from "../db/sources";
import { getStream, setStreamStatus } from "../db/streams";
import { getTarget } from "../db/targets";
import { decryptSecret } from "../lib/crypto";
import { getFfmpegPath } from "../runtime/ffmpeg";
import { removeTombstone, writeTombstone } from "../runtime/recovery";
import type { StreamMetrics, StreamRecord } from "../types/stream";

const processes = new Map<string, ChildProcess>();
const startingStreams = new Set<string>();
const listeners = new Map<string, Set<(event: unknown) => void>>();

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
 * Uses stream copy (no transcode) and optional infinite looping.
 *
 * @param input - The source path, ingest URL, loop flag, and stream key.
 * @returns The ordered FFmpeg CLI arguments.
 */
export function buildFfmpegArgs(input: {
  filePath: string;
  ingestUrl: string;
  loop: boolean;
  streamKey: string;
}): string[] {
  const output = `${input.ingestUrl.replace(/\/$/, "")}/${input.streamKey}`;
  const args = ["-hide_banner", "-loglevel", "info"];
  if (input.loop) args.push("-stream_loop", "-1");
  args.push(
    "-re",
    "-i",
    input.filePath,
    "-c",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    "-f",
    "flv",
    output,
  );
  return args;
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
    if (stream.status === "running" || stream.status === "stopping") {
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
        loop: stream.loop,
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
    writeTombstone({
      pid: child.pid,
      status: "running",
      streamId,
      writtenAt: new Date().toISOString(),
    });
    setStreamStatus(streamId, "running", {
      startedAt: new Date().toISOString(),
      pid: child.pid,
      lastError: null,
    });
    addEvent(streamId, "running", `FFmpeg started with pid ${child.pid}`, { pid: child.pid });
    emit(streamId, { type: "status", status: "running" });

    let lastMetrics: StreamMetrics | null = null;
    let lastMetricsPersistAt = 0;
    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        emit(streamId, { type: "log", line: redactFfmpegLog(line) });
        const metrics = parseMetrics(line, lastMetrics);
        if (metrics && metrics !== lastMetrics) {
          lastMetrics = metrics;
          emit(streamId, { type: "metrics", metrics });
          if (Date.now() - lastMetricsPersistAt >= 5_000) {
            lastMetricsPersistAt = Date.now();
            if (getStream(streamId)?.status === "running")
              setStreamStatus(streamId, "running", { lastMetrics: metrics });
          }
        }
      }
    });

    let settled = false;
    const settle = (status: "stopped" | "failed", message: string, payload: unknown) => {
      if (settled) return;
      settled = true;
      processes.delete(streamId);
      removeTombstone(streamId);
      const current = getStream(streamId);
      if (!current) return emit(streamId, { type: "status", status: "deleted" });
      setStreamStatus(streamId, status, {
        stoppedAt: new Date().toISOString(),
        pid: null,
        lastError: status === "stopped" ? null : message,
      });
      addEvent(streamId, status, message, payload);
      emit(streamId, { type: "status", status });
    };
    child.on("error", (error) => {
      settle("failed", `FFmpeg failed: ${error.message}`, null);
    });
    child.on("close", (code, signal) => {
      const current = getStream(streamId);
      if (!current) return settle("failed", "FFmpeg stream deleted", { code, signal });
      const intentional =
        current.status === "stopping" || signal === "SIGTERM" || signal === "SIGKILL";
      const status = code === 0 || intentional ? "stopped" : "failed";
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      settle(status, status === "stopped" ? "FFmpeg stopped" : `FFmpeg failed with ${reason}`, {
        code,
        signal,
      });
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
  if (stream.status !== "running" && stream.status !== "stopping") return stream;
  const child = processes.get(streamId);
  setStreamStatus(streamId, "stopping");
  addEvent(streamId, "stopping", "Stop requested", null);
  if (!child) {
    return setStreamStatus(streamId, "stopped", { stoppedAt: new Date().toISOString(), pid: null });
  }
  killChildProcess(child, "SIGTERM");
  setTimeout(() => {
    if (processes.has(streamId)) killChildProcess(child, "SIGKILL");
  }, 10_000).unref?.();
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
