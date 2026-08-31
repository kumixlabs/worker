/**
 * Worker configuration and aggregated statistics types.
 */

/**
 * Represents the daemon's local runtime configuration.
 */
export interface WorkerSettings {
  signingSecret: string;
  encryptionKey: string;
  port: number;
  /** Disk usage threshold reported by runtime metrics and used by operators for cache safety. */
  diskUsageLimitPercent: number;
  /** IANA timezone used to resolve recurring stream schedules (default "Asia/Jakarta"). */
  timezone: string;
  dataDir: string;
}

export interface PublicSettings {
  diskUsageLimitPercent: number;
  timezone: string;
}

/**
 * Aggregated statistics and system metrics.
 */
export interface WorkerStats {
  sources: { total: number; ready: number; invalid: number };
  targets: { total: number; active: number };
  streams: {
    total: number;
    running: number;
    pending: number;
    stopping: number;
    stopped: number;
    failed: number;
  };
  storage: {
    cacheBytes: number;
    disk?: { totalBytes: number; freeBytes: number; usedBytes: number; usedPercent: number };
  };
  quota?: {
    storageBytes: number;
    streamCount: number;
    maxStorageBytes: number | null;
    maxStreams: number | null;
  };
  system: { uptimeSec: number; pid: number; platform: string };
}

/**
 * Detailed local health status used by dashboard and CLI diagnostics.
 */
export type WorkerHealthDetails = {
  status: string;
  uptimeSec: number;
  ffmpeg: { available: boolean; path: string; version: string };
  ffprobe: { available: boolean; path: string; version: string };
};

/**
 * Runtime host, storage, network, scheduler, and process metrics.
 */
export type WorkerMetrics = {
  cpu: {
    cores: number;
    usagePercent: number;
    loadAverage: number[];
    userMicros: number;
    systemMicros: number;
  };
  memory: { totalBytes: number; freeBytes: number; usedBytes: number };
  storage: {
    cacheBytes: number;
    disk?: { totalBytes: number; freeBytes: number; usedBytes: number; usedPercent: number };
  };
  network: { outboundMbps: number; sessionBytes: number };
  scheduler: {
    running: boolean;
    intervalMs: number;
    lastTickAt: string | null;
    lastStarted: number;
    lastStopped: number;
  };
  process: { pid: number; startedAt: string; uptimeSec: number; platform: string };
};
