/**
 * Event persistence and in-process event fan-out helpers.
 */

import { nanoid } from "nanoid";

import { nowIso, parseJson } from "../lib/utils";
import type { EventRecord } from "../types/event";
import { getDb } from "./client";

const eventListeners = new Set<(event: EventRecord) => void>();
const maxStoredEvents = 5000;
const pruneInterval = 100;
let insertCount = 0;

/**
 * Subscribes a listener function to incoming event records globally.
 * Returns an unsubscribe callback.
 *
 * @param listener - The callback function to invoke on new events.
 * @returns A function to cancel the subscription.
 */
export function onEvent(listener: (event: EventRecord) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

/**
 * Creates an event entry in the log and emits it to all global subscribers.
 * Triggers a pruning sweep if the table row count exceeds the defined safety max (5000).
 *
 * @param streamId - Optional stream ID associated with the event.
 * @param kind - A short string denoting the event type, such as `info` or `running`.
 * @param message - A descriptive message to log.
 * @param payload - Optional JSON payload holding diagnostic details.
 */
export function addEvent(
  userId: string | null,
  kind: string,
  message: string,
  payload: unknown | null = null,
  streamId: string | null = null,
): void {
  const id = `evt_${nanoid(12)}`;
  const now = nowIso();
  const db = getDb();
  db.query(
    "INSERT INTO events (id, user_id, stream_id, kind, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    userId,
    streamId,
    kind,
    message,
    payload !== null ? JSON.stringify(payload) : null,
    now,
  );

  const event: EventRecord = { id, userId, streamId, kind, message, payload, createdAt: now };
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch {
      // Listener failed; ignore to prevent one broken subscriber from blocking others.
    }
  }

  if (kind !== "ffmpeg_stderr" && kind !== "ffmpeg_stdout" && kind !== "metrics") {
    console.log(`[worker] [${kind}]${streamId ? ` [${streamId}]` : ""} ${message}`);
  }

  // Prune old events beyond the hard cap (currently 5000 rows).
  insertCount += 1;
  if (insertCount >= pruneInterval) {
    insertCount = 0;
    const count = db.query("SELECT COUNT(*) as count FROM events").get() as { count: number };
    if (count.count > maxStoredEvents) {
      db.query(
        "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)",
      ).run(maxStoredEvents);
    }
  }
}

/**
 * Clears all rows inside the events table.
 *
 * @returns The count of deleted rows.
 */
export function clearEvents(): number {
  return getDb().query("DELETE FROM events").run().changes;
}

/**
 * Retrieves the most recent 200 events. If a streamId is provided, filters the result.
 *
 * @param streamId - Optional stream ID to filter logs.
 * @returns The most recent event slice ordered by creation date descending.
 */
export function listEvents(
  streamId?: string,
  limit = 200,
  before?: { createdAt: string; id: string },
  userId?: string,
): EventRecord[] {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (streamId) {
    conditions.push("stream_id = ?");
    params.push(streamId);
  }
  if (userId) {
    conditions.push("user_id = ?");
    params.push(userId);
  }
  if (before) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(before.createdAt, before.createdAt, before.id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(safeLimit);

  const rows = getDb()
    .query(sql)
    .all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    streamId: (row.stream_id as string | null) ?? null,
    kind: row.kind as string,
    message: row.message as string,
    payload: parseJson(row.payload as string | null),
    createdAt: row.created_at as string,
  }));
}
