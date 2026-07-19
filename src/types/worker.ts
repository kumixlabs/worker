/**
 * Worker configuration and aggregated statistics types.
 */

/**
 * Represents the daemon's local runtime configuration.
 */
export interface WorkerSettings {
  token: string;
  port: number;
  /** Disk usage threshold reported by runtime metrics and used by operators for cache safety. */
  diskUsageLimitPercent: number;
  /** IANA timezone used to resolve recurring stream schedules (default "Asia/Jakarta"). */
  timezone: string;
  /** YouTube Data API v3 key for live stream analytics (empty string when unset). */
  youtubeApiKey?: string;
  dataDir: string;
}

/**
 * Aggregated statistics and system metrics.
 */
export interface WorkerStats {
  sources: { total: number; ready: number; invalid: number };
  targets: { total: number; active: number };
  streams: { total: number; running: number; pending: number; stopped: number; failed: number };
  storage: {
    cacheBytes: number;
    disk?: { totalBytes: number; freeBytes: number; usedBytes: number; usedPercent: number };
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
 * Stable capability document returned by `/api/v1/capabilities` for core integrations.
 */
export type PublicWorkerCapabilities = {
  apiVersion: "v1";
  agentVersion: string;
  features: {
    monitoring: true;
    tokenRotation: true;
    signedEventUrls: true;
    bulkDelete: true;
    scheduler: true;
    recurrence: true;
    sourceDownload: true;
    googleDriveSources: true;
  };
  limits: {
    signedUrlTtlMs: number;
    bulkDeleteMaxIds: number;
    publicStatsCacheTtlMs: number;
  };
  settings: {
    timezone: string;
    diskUsageLimitPercent: number;
  };
};

/**
 * Link metadata returned by `/api/v1/link` for onboarding and external integrations.
 */
export type PublicWorkerLinkInfo = {
  apiVersion: "v1";
  agentVersion: string;
  dashboardPath: string;
  tokenLength: number;
  capabilities: PublicWorkerCapabilities;
};

/**
 * Read-only monitoring payload returned by `/api/v1/stats`.
 */
export type PublicWorkerStats = {
  system: {
    agentVersion: string;
    cpu: WorkerMetrics["cpu"];
    memory: WorkerMetrics["memory"];
    disk?: WorkerMetrics["storage"]["disk"];
    cacheBytes: number;
    network: WorkerMetrics["network"];
    process: WorkerMetrics["process"];
    health: { status: string; ffmpeg: boolean; ffprobe: boolean };
  };
  streams: {
    running: number;
    pending: number;
    stopping: number;
    stopped: number;
    failed: number;
    total: number;
    recent: Array<{
      id: string;
      title: string;
      status: string;
      source: string | null;
      target: string | null;
      startedAt: string | null;
      stoppedAt: string | null;
      scheduledFor: string | null;
      lastError: string | null;
      lastMetrics: unknown;
    }>;
  };
  sources: {
    ready: number;
    pending: number;
    downloading: number;
    probing: number;
    invalid: number;
    total: number;
  };
  targets: { active: number; total: number };
  scheduler: WorkerMetrics["scheduler"];
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
  network: { outboundMbps: number };
  scheduler: {
    running: boolean;
    intervalMs: number;
    lastTickAt: string | null;
    lastStarted: number;
    lastStopped: number;
  };
  process: { pid: number; startedAt: string; uptimeSec: number; platform: string };
};
