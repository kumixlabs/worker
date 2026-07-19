/**
 * Worker statistics aggregation across persisted data and runtime metrics.
 */

import { runtimeMetrics } from "../runtime/metrics";
import type { WorkerStats } from "../types/worker";
import { listSources } from "./sources";
import { listStreams } from "./streams";
import { listTargets } from "./targets";

/**
 * Aggregates high-level statistical summaries across all database entities.
 * Gathers counts of streams, sources, targets, plus cache size and disk usage
 * from runtimeMetrics.
 *
 * @returns The summary counts and current system state details.
 */
export function stats(): WorkerStats {
  const sources = listSources();
  const targets = listTargets();
  const streams = listStreams();
  const metrics = runtimeMetrics();
  return {
    sources: {
      total: sources.length,
      ready: sources.filter((item) => item.status === "ready").length,
      invalid: sources.filter((item) => item.status === "invalid").length,
    },
    targets: { total: targets.length, active: targets.filter((item) => item.active).length },
    streams: {
      total: streams.length,
      running: streams.filter((item) => item.status === "running").length,
      pending: streams.filter((item) => item.status === "pending").length,
      stopping: streams.filter((item) => item.status === "stopping").length,
      stopped: streams.filter((item) => item.status === "stopped").length,
      failed: streams.filter((item) => item.status === "failed").length,
    },
    storage: {
      cacheBytes: metrics.storage.cacheBytes,
      disk: metrics.storage.disk,
    },
    system: {
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      platform: process.platform,
    },
  };
}
