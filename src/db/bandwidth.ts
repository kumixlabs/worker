/**
 * Bandwidth usage logging and aggregation helpers.
 */

import { nanoid } from "nanoid";

import { fromZonedParts, zonedParts } from "../lib/timezone";
import { nowIso } from "../lib/utils";
import { readSettings } from "../runtime/config";
import type { BandwidthSummary } from "../types/bandwidth";
import { getDb } from "./client";

const pruneMaxDays = 90;
const pruneInterval = 100;
let insertCount = 0;

/**
 * Returns the start of the current day in the worker timezone as an ISO timestamp.
 *
 * @param timezone - IANA timezone string.
 * @returns ISO timestamp for midnight of the current day.
 */
function startOfDayIso(timezone: string): string {
  const parts = zonedParts(new Date(), timezone);
  return fromZonedParts({ ...parts, hour: 0, minute: 0, second: 0 }, timezone).toISOString();
}

/**
 * Returns a SQLite datetime modifier that shifts UTC stored timestamps into
 * the worker timezone so DATE() buckets match the wall-clock day boundaries.
 * ponytail: offset sampled at query time; a DST shift inside the 30-day window
 * can mis-bucket edge rows by one hour. Re-bucket in JS if that ever matters.
 */
function timezoneOffsetModifier(timezone: string): string {
  const now = new Date();
  const parts = zonedParts(now, timezone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const minutes = Math.round((wall - now.getTime()) / 60000);
  return `${minutes >= 0 ? "+" : "-"}${Math.abs(minutes)} minutes`;
}

/**
 * Returns the start of the current month in the worker timezone as an ISO timestamp.
 *
 * @param timezone - IANA timezone string.
 * @returns ISO timestamp for the first day of the current month.
 */
function startOfMonthIso(timezone: string): string {
  const parts = zonedParts(new Date(), timezone);
  return fromZonedParts(
    { ...parts, day: 1, hour: 0, minute: 0, second: 0 },
    timezone,
  ).toISOString();
}

/**
 * Records a bandwidth delta for a stream and auto-prunes old entries.
 * ponytail: bandwidth_log has ON DELETE CASCADE on stream_id, so deleting a
 * stream also deletes its bandwidth history and all-time totals shrink.
 * Acceptable while bandwidth is an attribute of the stream, not the worker;
 * drop the FK and NULL the column if permanent history is ever needed.
 *
 * @param streamId - The stream that consumed the bandwidth.
 * @param bytes - Bytes sent since the last recording.
 */
export function recordBandwidth(streamId: string, bytes: number): void {
  if (bytes <= 0) return;
  const db = getDb();
  db.query("INSERT INTO bandwidth_log (id, stream_id, bytes, recorded_at) VALUES (?, ?, ?, ?)").run(
    `bw_${nanoid(12)}`,
    streamId,
    bytes,
    nowIso(),
  );

  insertCount += 1;
  if (insertCount >= pruneInterval) {
    insertCount = 0;
    const cutoff = new Date(Date.now() - pruneMaxDays * 86_400_000).toISOString();
    db.query("DELETE FROM bandwidth_log WHERE recorded_at < ?").run(cutoff);
  }
}

/**
 * Computes a bandwidth summary: today, this month, all-time totals,
 * per-stream breakdown, and a 30-day daily series.
 * When userId is set only rows from that user's streams are counted.
 *
 * @returns Aggregated bandwidth metrics.
 */
export function getBandwidthSummary(userId?: string): BandwidthSummary {
  const db = getDb();
  const timezone = readSettings().timezone;
  const todayStart = startOfDayIso(timezone);
  const monthStart = startOfMonthIso(timezone);
  const dailyStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const scopeSql = userId ? " WHERE stream_id IN (SELECT id FROM streams WHERE user_id = ?)" : "";
  const andSql = scopeSql ? " AND" : " WHERE";

  const today =
    (
      db
        .query(
          `SELECT COALESCE(SUM(bytes), 0) AS total FROM bandwidth_log${scopeSql}${andSql} recorded_at >= ?`,
        )
        .get(...(userId ? [userId] : []), todayStart) as { total: number }
    ).total ?? 0;
  const thisMonth =
    (
      db
        .query(
          `SELECT COALESCE(SUM(bytes), 0) AS total FROM bandwidth_log${scopeSql}${andSql} recorded_at >= ?`,
        )
        .get(...(userId ? [userId] : []), monthStart) as { total: number }
    ).total ?? 0;
  const allTime =
    (
      db
        .query(`SELECT COALESCE(SUM(bytes), 0) AS total FROM bandwidth_log${scopeSql}`)
        .get(...(userId ? [userId] : [])) as { total: number }
    ).total ?? 0;

  const byStreamRows = db
    .query(
      `SELECT stream_id AS streamId, SUM(bytes) AS bytes FROM bandwidth_log${scopeSql} GROUP BY stream_id ORDER BY bytes DESC LIMIT 20`,
    )
    .all(...(userId ? [userId] : [])) as { streamId: string; bytes: number }[];

  const dailyModifier = timezoneOffsetModifier(timezone);
  const dailyRows = db
    .query(
      `SELECT DATE(recorded_at, ?) AS date, SUM(bytes) AS bytes FROM bandwidth_log${scopeSql}${andSql} recorded_at >= ? GROUP BY DATE(recorded_at, ?) ORDER BY date`,
    )
    .all(dailyModifier, ...(userId ? [userId] : []), dailyStart, dailyModifier) as {
    date: string;
    bytes: number;
  }[];

  return { today, thisMonth, allTime, byStream: byStreamRows, daily: dailyRows };
}

/**
 * Returns total bytes sent for a specific stream.
 *
 * @param streamId - The stream ID to query.
 * @returns Total bytes recorded for the stream.
 */
export function getStreamBytes(streamId: string): number {
  const row = getDb()
    .query("SELECT COALESCE(SUM(bytes), 0) AS total FROM bandwidth_log WHERE stream_id = ?")
    .get(streamId) as { total: number };
  return row.total ?? 0;
}

/**
 * Returns a map of streamId → total bytes for all streams.
 * Batch alternative to {@link getStreamBytes} for list views.
 *
 * @returns Map of stream IDs to their total recorded bandwidth.
 */
export function getAllStreamBytes(): Map<string, number> {
  const rows = getDb()
    .query(
      "SELECT stream_id AS streamId, SUM(bytes) AS bytes FROM bandwidth_log GROUP BY stream_id",
    )
    .all() as { streamId: string; bytes: number }[];
  return new Map(rows.map((r) => [r.streamId, r.bytes]));
}
