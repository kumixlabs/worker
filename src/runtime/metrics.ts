/**
 * Runtime host, cache, disk, and stream metrics collection helpers.
 */

import { readdirSync, statfsSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { cpus, freemem, loadavg, platform, totalmem } from "node:os";
import path from "node:path";

import type { StreamRecord } from "../types/stream";
import { getCacheDir } from "./config";
import { resolveFfmpegBinaryDetails } from "./ffmpeg";

const processStartedAt = new Date().toISOString();

/**
 * Computes total, free, used bytes and used percentage for the filesystem
 * that hosts the given directory.
 *
 * @param dir - A path on the target filesystem.
 * @returns The disk usage snapshot.
 */
function diskUsage(dir: string) {
  try {
    const stats = statfsSync(dir);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    return { totalBytes, freeBytes, usedBytes, usedPercent };
  } catch {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0, usedPercent: 0 };
  }
}

/**
 * Recursively sums the byte size of all files within a directory.
 * Returns 0 when the directory does not exist or cannot be read.
 *
 * @param dir - The directory to measure.
 * @returns The total size in bytes.
 */
function directorySize(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) return total + directorySize(filePath);
      if (entry.isFile()) return total + statSync(filePath).size;
      return total;
    }, 0);
  } catch {
    return 0;
  }
}

/**
 * Asynchronously computes the total size of a directory tree without blocking
 * the event loop. Used to refresh the storage cache in the background.
 *
 * @param dir - The directory to measure.
 * @returns A promise resolving to the total size in bytes.
 */
async function directorySizeAsync(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await directorySizeAsync(filePath);
      } else if (entry.isFile()) {
        total += (await stat(filePath)).size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

type SchedulerMetrics = {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastStarted: number;
  lastStopped: number;
};

const defaultSchedulerMetrics: SchedulerMetrics = {
  running: false,
  intervalMs: 0,
  lastTickAt: null,
  lastStarted: 0,
  lastStopped: 0,
};

const storageCacheTtlMs = 5_000;
let cachedStorage: {
  expiresAt: number;
  value: { cacheBytes: number; disk: ReturnType<typeof diskUsage> };
} | null = null;
let storageRefreshInFlight = false;
let lastCpuSample: { sampledAt: number; userMicros: number; systemMicros: number } | null = null;
let smoothedCpuUsagePercent = 0;

/**
 * Returns cached storage metrics, refreshing the cache in the background to
 * avoid blocking the event loop on large cache directories. The first call
 * scans synchronously so an initial value is always available.
 *
 * @param cacheDir - The cache directory to measure.
 * @returns Cache and disk usage metrics.
 */
function storageMetrics(cacheDir: string) {
  const now = Date.now();
  if (!cachedStorage) {
    const value = { cacheBytes: directorySize(cacheDir), disk: diskUsage(cacheDir) };
    cachedStorage = { expiresAt: now + storageCacheTtlMs, value };
    return value;
  }
  if (cachedStorage.expiresAt <= now && !storageRefreshInFlight) {
    storageRefreshInFlight = true;
    void directorySizeAsync(cacheDir)
      .then((cacheBytes) => {
        cachedStorage = {
          expiresAt: Date.now() + storageCacheTtlMs,
          value: { cacheBytes, disk: diskUsage(cacheDir) },
        };
      })
      .finally(() => {
        storageRefreshInFlight = false;
      });
  }
  return cachedStorage.value;
}

function cpuUsagePercent(usage: NodeJS.ResourceUsage, coreCount: number): number {
  const now = Date.now();
  const currentMicros = usage.userCPUTime + usage.systemCPUTime;
  if (!lastCpuSample) {
    lastCpuSample = {
      sampledAt: now,
      userMicros: usage.userCPUTime,
      systemMicros: usage.systemCPUTime,
    };
    return 0;
  }
  const previousMicros = lastCpuSample.userMicros + lastCpuSample.systemMicros;
  const elapsedMicros = (now - lastCpuSample.sampledAt) * 1000;
  lastCpuSample = {
    sampledAt: now,
    userMicros: usage.userCPUTime,
    systemMicros: usage.systemCPUTime,
  };
  if (elapsedMicros <= 0 || coreCount <= 0) return smoothedCpuUsagePercent;
  const next = Math.min(
    100,
    Math.max(0, Math.round(((currentMicros - previousMicros) / elapsedMicros / coreCount) * 100)),
  );
  smoothedCpuUsagePercent = Math.round(smoothedCpuUsagePercent * 0.6 + next * 0.4);
  return smoothedCpuUsagePercent;
}

/**
 * Collects a snapshot of runtime system metrics including CPU, memory, cache size,
 * disk usage, aggregated outbound bandwidth, scheduler state, and process info.
 *
 * @param streams - Active streams used to compute total outbound bitrate.
 * @param scheduler - Current scheduler state to include in the report.
 * @returns The aggregated runtime metrics object.
 */
export function runtimeMetrics(streams: StreamRecord[] = [], scheduler = defaultSchedulerMetrics) {
  const totalMemoryBytes = totalmem();
  const freeMemoryBytes = freemem();
  const cacheDir = getCacheDir();
  const storage = storageMetrics(cacheDir);
  const usage = process.resourceUsage();
  const coreCount = cpus().length;
  const outboundMbps =
    streams
      .filter((stream) => stream.status === "running")
      .reduce((total, stream) => total + (stream.lastMetrics?.bitrateKbps ?? 0), 0) / 1000;
  return {
    cpu: {
      cores: coreCount,
      usagePercent: cpuUsagePercent(usage, coreCount),
      loadAverage: loadavg(),
      userMicros: usage.userCPUTime,
      systemMicros: usage.systemCPUTime,
    },
    memory: {
      totalBytes: totalMemoryBytes,
      freeBytes: freeMemoryBytes,
      usedBytes: totalMemoryBytes - freeMemoryBytes,
    },
    storage,
    network: {
      outboundMbps,
    },
    scheduler,
    process: {
      pid: process.pid,
      startedAt: processStartedAt,
      uptimeSec: Math.round(process.uptime()),
      platform: platform(),
    },
  };
}

/**
 * Reports FFmpeg/FFprobe availability and process uptime for health checks.
 *
 * @returns The runtime health details including binary paths and versions.
 */
export function runtimeHealthDetails() {
  try {
    const binaries = resolveFfmpegBinaryDetails();
    const ffmpegAvailable = Boolean(binaries.ffmpeg.version);
    const ffprobeAvailable = Boolean(binaries.ffprobe.version);
    return {
      status: ffmpegAvailable && ffprobeAvailable ? "ok" : "degraded",
      uptimeSec: Math.round(process.uptime()),
      ffmpeg: {
        ...binaries.ffmpeg,
        available: ffmpegAvailable,
        version: binaries.ffmpeg.version ?? "FFmpeg version unavailable",
      },
      ffprobe: {
        ...binaries.ffprobe,
        available: ffprobeAvailable,
        version: binaries.ffprobe.version ?? "FFprobe version unavailable",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FFmpeg binaries unavailable";
    return {
      status: "degraded",
      uptimeSec: Math.round(process.uptime()),
      ffmpeg: { available: false, path: "", version: message },
      ffprobe: { available: false, path: "", version: message },
    };
  }
}
