/**
 * Tombstone persistence and crash recovery helpers for interrupted streams.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { uptime } from "node:os";
import path from "node:path";

import { addEvent } from "../db/events";
import { getStream, listStreams, setStreamStatus } from "../db/streams";
import type { StreamRecord } from "../types/stream";
import { ensureDataDir } from "./config";

/**
 * Crash-recovery marker for one active stream process.
 */
export type TombstoneRecord = {
  streamId: string;
  pid: number | null;
  status: StreamRecord["status"];
  writtenAt: string;
};

/**
 * Marker telling next worker boot which streams should be started again.
 */
export type AutoStartRecord = {
  streamIds: string[];
  writtenAt: string;
};

const autoStartFile = "auto-start.json";

/**
 * Returns true when a process with the given PID is alive and signal-reachable.
 *
 * @param pid - The process identifier to probe.
 * @returns True if the process exists, false otherwise.
 */
export function isPidAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when a tombstone timestamp predates the last system boot.
 * After a reboot, a stored PID may belong to an unrelated process, so it must
 * not be terminated.
 *
 * @param writtenAt - The tombstone's ISO write timestamp.
 * @returns True when the timestamp is older than the current boot time.
 */
export function isBeforeLastBoot(writtenAt: string | null | undefined): boolean {
  if (!writtenAt) return false;
  const written = new Date(writtenAt).getTime();
  if (!Number.isFinite(written)) return false;
  const bootTime = Date.now() - uptime() * 1000;
  return written < bootTime;
}

/**
 * Attempts to gracefully terminate an orphaned FFmpeg process.
 * On POSIX sends SIGTERM first and SIGKILL after 5 seconds if still alive.
 * On Windows uses taskkill /t /f.
 *
 * @param pid - The orphaned process identifier to terminate.
 */
export function terminateOrphanPid(pid: number | null): void {
  if (!isPidAlive(pid)) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    process.kill(pid!, "SIGTERM");
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try {
          process.kill(pid!, "SIGKILL");
        } catch {}
      }
    }, 5_000).unref?.();
  } catch {}
}

/**
 * Validates stream IDs before using them in tombstone file names.
 *
 * @param streamId - The stream ID to validate.
 * @returns The validated stream ID.
 */
function safeStreamId(streamId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(streamId)) {
    throw new Error(`Invalid stream ID for tombstone path: ${streamId}`);
  }
  return streamId;
}

/**
 * Resolves the directory where stream crash-recovery tombstones are stored.
 *
 * @returns The absolute path to the tombstones directory.
 */
export function getTombstoneDir(): string {
  return path.join(ensureDataDir(), "tombstones");
}

/**
 * Resolves the tombstone file path for a given stream.
 *
 * @param streamId - The stream identifier.
 * @returns The absolute path to the stream's tombstone JSON file.
 */
export function getTombstonePath(streamId: string): string {
  return path.join(getTombstoneDir(), `${safeStreamId(streamId)}.json`);
}

/**
 * Resolves the auto-start marker path.
 *
 * @returns The absolute path to the marker file.
 */
function getAutoStartPath(): string {
  return path.join(getTombstoneDir(), autoStartFile);
}

/**
 * Writes the set of streams that should be started after a forced update restart.
 *
 * @param streamIds - Stream IDs to restart on next worker boot.
 */
export function writeAutoStartMarker(streamIds: string[]): void {
  mkdirSync(getTombstoneDir(), { recursive: true });
  const record: AutoStartRecord = {
    streamIds: streamIds.map(safeStreamId),
    writtenAt: new Date().toISOString(),
  };
  const file = getAutoStartPath();
  const tempFile = `${file}.${process.pid}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempFile, file);
}

/**
 * Reads and removes the auto-start marker from disk.
 *
 * @returns Stream IDs requested for auto-start.
 */
export function consumeAutoStartMarker(): string[] {
  const file = getAutoStartPath();
  if (!existsSync(file)) return [];
  try {
    const record = JSON.parse(readFileSync(file, "utf8")) as AutoStartRecord;
    return record.streamIds.map(safeStreamId).filter((streamId) => !!getStream(streamId));
  } catch {
    return [];
  } finally {
    if (existsSync(file)) unlinkSync(file);
  }
}

/**
 * Writes a crash-recovery tombstone for a running stream.
 *
 * @param record - The tombstone payload to persist.
 */
export function writeTombstone(record: TombstoneRecord): void {
  mkdirSync(getTombstoneDir(), { recursive: true });
  const file = getTombstonePath(record.streamId);
  const tempFile = `${file}.${process.pid}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempFile, file);
}

/**
 * Removes a stream's tombstone file if it exists.
 *
 * @param streamId - The stream identifier.
 */
export function removeTombstone(streamId: string): void {
  const file = getTombstonePath(streamId);
  if (existsSync(file)) unlinkSync(file);
}

/**
 * Reads all tombstone records from disk, skipping any that fail to parse.
 *
 * @returns The recovered tombstone records.
 */
export function listTombstones(): TombstoneRecord[] {
  const dir = getTombstoneDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== autoStartFile)
    .flatMap((file) => {
      try {
        const record = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as TombstoneRecord;
        safeStreamId(record.streamId);
        return record;
      } catch {
        console.warn(`[worker] Deleting corrupt tombstone: ${file}`);
        unlinkSync(path.join(dir, file));
        return [];
      }
    });
}

/**
 * Recovers streams interrupted by a worker crash or restart.
 * Marks tombstoned and lingering running/stopping streams as failed, then clears
 * their tombstones. Streams in skipStreamIds are reset to pending for auto-start
 * instead of being marked failed.
 *
 * @param skipStreamIds - Stream IDs scheduled for auto-start after a planned restart.
 * @returns {StreamRecord[]} The streams that were transitioned to failed.
 */
export function recoverInterruptedStreams(skipStreamIds: string[] = []): StreamRecord[] {
  const skip = new Set(skipStreamIds);
  const recovered: StreamRecord[] = [];

  const reconcile = (streamId: string, pid: number | null = null, writtenAt?: string) => {
    removeTombstone(streamId);
    if (skip.has(streamId)) {
      setStreamStatus(streamId, "pending", { pid: null, lastError: null });
      return;
    }
    const pidReusable = isBeforeLastBoot(writtenAt);
    const orphanAlive = !pidReusable && isPidAlive(pid);
    if (orphanAlive) terminateOrphanPid(pid);
    const message = orphanAlive
      ? "Forge Worker recovered and terminated an orphaned FFmpeg process"
      : "Forge Worker restarted before stream stopped cleanly";
    const stream = setStreamStatus(streamId, "failed", {
      lastError: message,
      pid: null,
      stoppedAt: new Date().toISOString(),
    });
    if (!stream) return;
    addEvent(streamId, "failed", message, { orphanPid: pid, orphanAlive });
    recovered.push(stream);
  };

  for (const tombstone of listTombstones())
    reconcile(tombstone.streamId, tombstone.pid, tombstone.writtenAt);

  for (const stream of listStreams().filter(
    (item) => item.status === "running" || item.status === "stopping",
  )) {
    reconcile(stream.id);
  }

  return recovered;
}
