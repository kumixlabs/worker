/**
 * Worker statistics aggregation across persisted data and runtime metrics.
 */

import { runtimeMetrics } from "../runtime/metrics";
import type { WorkerStats } from "../types/worker";
import { getDb } from "./client";

/**
 * Counts rows grouped by a status/active column without loading full tables.
 *
 * @param table - Table name (allowlisted).
 * @param column - Column to group by.
 * @returns Map of column value → count.
 */
function countBy(table: "sources" | "targets" | "streams", column: string): Map<string, number> {
  const rows = getDb()
    .query(`SELECT ${column} AS key, COUNT(*) AS count FROM ${table} GROUP BY ${column}`)
    .all() as Array<{ key: string | number; count: number }>;
  const map = new Map<string, number>();
  for (const row of rows) map.set(String(row.key), row.count);
  return map;
}

/**
 * Aggregates high-level statistical summaries across all database entities.
 * Gathers counts of streams, sources, targets, plus cache size and disk usage
 * from runtimeMetrics.
 *
 * @returns The summary counts and current system state details.
 */
export function stats(): WorkerStats {
  const sourceCounts = countBy("sources", "status");
  const streamCounts = countBy("streams", "status");
  const targetCounts = countBy("targets", "active");
  const metrics = runtimeMetrics();
  const sourceTotal = [...sourceCounts.values()].reduce((sum, n) => sum + n, 0);
  const streamTotal = [...streamCounts.values()].reduce((sum, n) => sum + n, 0);
  const targetTotal = [...targetCounts.values()].reduce((sum, n) => sum + n, 0);
  return {
    sources: {
      total: sourceTotal,
      ready: sourceCounts.get("ready") ?? 0,
      invalid: sourceCounts.get("invalid") ?? 0,
    },
    targets: {
      total: targetTotal,
      active: targetCounts.get("1") ?? 0,
    },
    streams: {
      total: streamTotal,
      running: streamCounts.get("running") ?? 0,
      pending: streamCounts.get("pending") ?? 0,
      stopping: streamCounts.get("stopping") ?? 0,
      stopped: streamCounts.get("stopped") ?? 0,
      failed: streamCounts.get("failed") ?? 0,
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
