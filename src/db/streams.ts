/**
 * Stream persistence helpers for scheduled and running live stream jobs.
 */

import { nanoid } from "nanoid";

import { nowIso, parseJson } from "../lib/utils";
import type { StreamCreateInput, StreamPatchInput } from "../schemas/stream";
import type { SourceRecord } from "../types/source";
import type { StreamMetrics, StreamRecord } from "../types/stream";
import { getDb } from "./client";

/**
 * Maps a SQLite database row to a StreamRecord object.
 *
 * @param row - The raw database row.
 * @returns The strongly typed stream record.
 */
function mapStreamRow(row: Record<string, unknown>): StreamRecord {
  return {
    id: row.id as string,
    title: row.title as string,
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    status: row.status as StreamRecord["status"],
    loop: Boolean(row.loop),
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    autoStopAt: (row.auto_stop_at as string | null) ?? null,
    recurrence: row.recurrence as StreamRecord["recurrence"],
    recurrenceRule: parseJson(row.recurrence_rule as string | null),
    startedAt: (row.started_at as string | null) ?? null,
    stoppedAt: (row.stopped_at as string | null) ?? null,
    pid: (row.pid as number | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    lastMetrics: parseJson<StreamMetrics>(row.last_metrics as string | null),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Retrieves all stored live streams, joining their respective source and target metadata,
 * ordered by creation date descending.
 *
 * @returns An array of stream records with source and target objects included.
 */
export function listStreams(): StreamRecord[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT s.*,
              src.name AS source_name, src.kind AS source_kind, src.status AS source_status,
              tgt.label AS target_label, tgt.ingest_url AS target_ingest_url, tgt.active AS target_active
       FROM streams s
       LEFT JOIN sources src ON s.source_id = src.id
       LEFT JOIN targets tgt ON s.target_id = tgt.id
       ORDER BY s.created_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => {
    const s = mapStreamRow(row);
    const sourceName = row.source_name as string | undefined;
    return {
      ...s,
      source: sourceName
        ? {
            id: s.sourceId,
            name: sourceName,
            kind: row.source_kind as "url" | "gdrive",
            status: row.source_status as SourceRecord["status"],
          }
        : undefined,
      target: (row.target_label as string | undefined)
        ? {
            id: s.targetId,
            label: row.target_label as string,
            ingestUrl: row.target_ingest_url as string,
            active: Boolean(row.target_active),
          }
        : undefined,
    };
  });
}

/**
 * Retrieves a single live stream by its unique identifier.
 * Does not automatically join source or target objects to keep operations lightweight.
 *
 * @param id - The ID of the stream.
 * @returns The matching stream, or null if not found.
 */
export function getStream(id: string): StreamRecord | null {
  const row = getDb().query("SELECT * FROM streams WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapStreamRow(row) : null;
}

/**
 * Creates a new live stream task in the database.
 * The job initializes in a 'pending' state and awaits scheduler pick up or manual start.
 *
 * @param input - The creation payload including source and target mappings.
 * @returns The newly created stream record.
 */
export function createStream(input: StreamCreateInput): StreamRecord {
  const id = `stm_${nanoid(12)}`;
  const now = nowIso();
  getDb()
    .query(
      "INSERT INTO streams (id, title, source_id, target_id, loop, scheduled_for, auto_stop_at, recurrence, recurrence_rule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.title,
      input.sourceId,
      input.targetId,
      input.loop ? 1 : 0,
      input.scheduledFor ?? null,
      input.autoStopAt ?? null,
      input.recurrence ?? "none",
      input.recurrenceRule ? JSON.stringify(input.recurrenceRule) : null,
      now,
      now,
    );
  return getStream(id)!;
}

/**
 * Updates an existing live stream configuration.
 *
 * @param id - The stream ID to update.
 * @param input - The modified properties to save.
 * @returns The updated stream, or null if not found.
 */
export function patchStream(id: string, input: StreamPatchInput): StreamRecord | null {
  const existing = getStream(id);
  if (!existing) return null;
  if (existing.status === "running" || existing.status === "stopping") {
    throw new Error("Cannot update a running or stopping stream");
  }
  getDb()
    .query(
      "UPDATE streams SET title = ?, source_id = ?, target_id = ?, loop = ?, scheduled_for = ?, auto_stop_at = ?, recurrence = ?, recurrence_rule = ?, stopped_at = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      input.title ?? existing.title,
      input.sourceId ?? existing.sourceId,
      input.targetId ?? existing.targetId,
      input.loop !== undefined ? (input.loop ? 1 : 0) : existing.loop ? 1 : 0,
      input.scheduledFor !== undefined ? input.scheduledFor : existing.scheduledFor,
      input.autoStopAt !== undefined ? input.autoStopAt : existing.autoStopAt,
      input.recurrence ?? existing.recurrence,
      input.recurrenceRule !== undefined
        ? input.recurrenceRule
          ? JSON.stringify(input.recurrenceRule)
          : null
        : existing.recurrenceRule
          ? JSON.stringify(existing.recurrenceRule)
          : null,
      input.stoppedAt !== undefined ? input.stoppedAt : existing.stoppedAt,
      nowIso(),
      id,
    );
  return getStream(id);
}

/**
 * Updates the runtime status and process metadata of a live stream.
 * Automatically manages timestamps when transitioning states.
 *
 * @param id - The stream ID to update.
 * @param status - The target state.
 * @param data - Optional runtime details to update.
 * @returns The updated stream, or null if not found.
 */
export function setStreamStatus(
  id: string,
  status: StreamRecord["status"],
  data: Partial<
    Pick<StreamRecord, "pid" | "startedAt" | "stoppedAt" | "lastError" | "lastMetrics">
  > = {},
): StreamRecord | null {
  const existing = getStream(id);
  if (!existing) return null;
  const allowed: Record<StreamRecord["status"], StreamRecord["status"][]> = {
    pending: ["running", "failed", "stopped"],
    running: ["pending", "stopping", "stopped", "failed"],
    stopping: ["stopped", "failed"],
    stopped: ["pending", "running", "failed"],
    failed: ["pending", "running", "stopped"],
  };
  if (existing.status !== status && !allowed[existing.status].includes(status)) {
    throw new Error(`Invalid stream status transition: ${existing.status} -> ${status}`);
  }
  getDb()
    .query(
      "UPDATE streams SET status = ?, started_at = ?, stopped_at = ?, pid = ?, last_error = ?, last_metrics = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      status,
      data.startedAt !== undefined ? data.startedAt : existing.startedAt,
      data.stoppedAt !== undefined ? data.stoppedAt : existing.stoppedAt,
      data.pid !== undefined ? data.pid : existing.pid,
      data.lastError !== undefined ? data.lastError : existing.lastError,
      data.lastMetrics !== undefined
        ? data.lastMetrics
          ? JSON.stringify(data.lastMetrics)
          : null
        : existing.lastMetrics
          ? JSON.stringify(existing.lastMetrics)
          : null,
      nowIso(),
      id,
    );
  return getStream(id);
}

/**
 * Deletes a live stream from the database.
 * Refuses to delete a stream that is still running or stopping.
 *
 * @param id - The ID of the stream to delete.
 * @returns True if a row was successfully deleted, otherwise false.
 */
export function deleteStream(id: string): boolean {
  const existing = getStream(id);
  if (!existing) return false;
  if (existing.status === "running" || existing.status === "stopping") {
    throw new Error("Stop the stream before deleting it");
  }
  return getDb().query("DELETE FROM streams WHERE id = ?").run(id).changes > 0;
}
