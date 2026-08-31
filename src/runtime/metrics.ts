/**
 * Runtime host, cache, and disk metrics collection helpers.
 */

import { statfsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { cpus, freemem, loadavg, platform, totalmem } from "node:os";
import path from "node:path";

import { getMediaDir } from "../db/media";

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

const storageCacheTtlMs = 30_000;
let cachedStorage: {
  expiresAt: number;
  value: { cacheBytes: number; disk: ReturnType<typeof diskUsage> };
} | null = null;
let storageRefreshInFlight = false;
let lastCpuSample: { sampledAt: number; userMicros: number; systemMicros: number } | null = null;
let smoothedCpuUsagePercent = 0;

/**
 * Refreshes the cached storage metrics in the background.
 *
 * @param cacheDir - The cache directory to measure.
 */
function refreshStorageAsync(cacheDir: string): void {
  storageRefreshInFlight = true;
  void directorySizeAsync(cacheDir)
    .then((cacheBytes) => {
      cachedStorage = {
        expiresAt: Date.now() + storageCacheTtlMs,
        value: { cacheBytes, disk: diskUsage(cacheDir) },
      };
    })
    .catch(() => undefined)
    .finally(() => {
      storageRefreshInFlight = false;
    });
}

function storageMetrics(cacheDir: string) {
  const now = Date.now();
  if (!cachedStorage) {
    const value = { cacheBytes: 0, disk: diskUsage(cacheDir) };
    cachedStorage = { expiresAt: now + storageCacheTtlMs, value };
    // Immediately kick off an async scan so the cache is populated without
    // blocking the event loop on a potentially large directory.
    refreshStorageAsync(cacheDir);
    return value;
  }
  if (cachedStorage.expiresAt <= now && !storageRefreshInFlight) {
    refreshStorageAsync(cacheDir);
  }
  return cachedStorage.value;
}

/**
 * Estimates process CPU usage as a smoothed percentage across available cores.
 *
 * @param usage - Current process resource usage snapshot.
 * @param coreCount - Number of CPU cores available to the process.
 * @returns Smoothed CPU usage percentage from 0 to 100.
 */
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
 * Collects a snapshot of runtime system metrics including CPU, memory, cache
 * size, disk usage, and process info.
 *
 * @returns The aggregated runtime metrics object.
 */
export function runtimeMetrics() {
  const totalMemoryBytes = totalmem();
  const freeMemoryBytes = freemem();
  const storage = storageMetrics(getMediaDir());
  const usage = process.resourceUsage();
  const coreCount = cpus().length;
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
      outboundMbps: 0,
      sessionBytes: 0,
    },
    process: {
      pid: process.pid,
      startedAt: processStartedAt,
      uptimeSec: Math.round(process.uptime()),
      platform: platform(),
    },
  };
}
