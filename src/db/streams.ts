/**
 * Stream CRUD. target_url stays AES-GCM encrypted at rest; decrypt only
 * inside the runner when spawning FFmpeg.
 */

import { randomBytes } from "node:crypto";

import type { StreamStatus } from "../types/stream";
import { getDb } from "./client";

export type { StreamStatus };

export type StreamRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface StreamRecurrenceRule {
  time: string;
  weekdays?: number[];
  day?: number;
  durationMinutes?: number;
}

export interface StreamRecord {
  id: string;
  userId: string;
  playlistId: string;
  name: string;
  targetUrl: string;
  shuffle: boolean;
  loop: boolean;
  status: StreamStatus;
  logPath: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  error: string | null;
  scheduledFor: string | null;
  autoStopAt: string | null;
  recurrence: StreamRecurrence;
  recurrenceRule: StreamRecurrenceRule | null;
  createdAt: string;
  updatedAt: string;
}

export interface StreamListRecord extends Omit<StreamRecord, "targetUrl"> {
  playlistName: string | null;
}

export interface InsertStream {
  userId: string;
  playlistId: string;
  name: string;
  targetUrl: string;
  shuffle: boolean;
  loop: boolean;
  scheduledFor?: string | null;
  autoStopAt?: string | null;
  recurrence?: StreamRecurrence;
  recurrenceRule?: StreamRecurrenceRule | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newStreamId(): string {
  return `str_${randomBytes(8).toString("base64url")}`;
}

interface StreamRow {
  id: string;
  user_id: string;
  playlist_id: string;
  name: string;
  target_url: string;
  shuffle: number;
  loop: number;
  status: string;
  log_path: string | null;
  started_at: string | null;
  stopped_at: string | null;
  error: string | null;
  scheduled_for: string | null;
  auto_stop_at: string | null;
  recurrence: string;
  recurrence_rule: string | null;
  created_at: string;
  updated_at: string;
}

function parseRule(raw: string | null): StreamRecurrenceRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StreamRecurrenceRule;
    return typeof parsed.time === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function toRecord(row: StreamRow): StreamRecord {
  return {
    id: row.id,
    userId: row.user_id,
    playlistId: row.playlist_id,
    name: row.name,
    targetUrl: row.target_url,
    shuffle: row.shuffle === 1,
    loop: row.loop === 1,
    status: row.status as StreamStatus,
    logPath: row.log_path,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    error: row.error,
    scheduledFor: row.scheduled_for,
    autoStopAt: row.auto_stop_at,
    recurrence: (row.recurrence as StreamRecurrence) ?? "none",
    recurrenceRule: parseRule(row.recurrence_rule),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const listColumns = `
  s.id, s.user_id, s.playlist_id, s.name, s.shuffle, s.loop, s.status,
  s.log_path, s.started_at, s.stopped_at, s.error,
  s.scheduled_for, s.auto_stop_at, s.recurrence, s.recurrence_rule,
  s.created_at, s.updated_at, p.name AS playlist_name
`;

interface StreamListRow extends Omit<StreamRow, "target_url"> {
  playlist_name: string | null;
}

function toListRecord(row: StreamListRow): StreamListRecord {
  const {
    id,
    user_id,
    playlist_id,
    name,
    shuffle,
    loop,
    status,
    log_path,
    started_at,
    stopped_at,
    error,
    scheduled_for,
    auto_stop_at,
    recurrence,
    recurrence_rule,
    created_at,
    updated_at,
    playlist_name,
  } = row;
  return {
    id,
    userId: user_id,
    playlistId: playlist_id,
    name,
    shuffle: shuffle === 1,
    loop: loop === 1,
    status: status as StreamStatus,
    logPath: log_path,
    startedAt: started_at,
    stoppedAt: stopped_at,
    error,
    scheduledFor: scheduled_for,
    autoStopAt: auto_stop_at,
    recurrence: (recurrence as StreamRecurrence) ?? "none",
    recurrenceRule: parseRule(recurrence_rule),
    createdAt: created_at,
    updatedAt: updated_at,
    playlistName: playlist_name,
  };
}

export function insertStream(data: InsertStream): StreamRecord {
  const id = newStreamId();
  const now = nowIso();
  getDb()
    .query(
      `INSERT INTO streams (id, user_id, playlist_id, name, target_url, shuffle, loop, status, scheduled_for, auto_stop_at, recurrence, recurrence_rule, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.userId,
      data.playlistId,
      data.name,
      data.targetUrl,
      data.shuffle ? 1 : 0,
      data.loop ? 1 : 0,
      data.scheduledFor ?? null,
      data.autoStopAt ?? null,
      data.recurrence ?? "none",
      data.recurrenceRule ? JSON.stringify(data.recurrenceRule) : null,
      now,
      now,
    );
  return getStreamById(id, data.userId) as StreamRecord;
}

export function getStreamById(id: string, userId: string): StreamRecord | null {
  const row = getDb().query("SELECT * FROM streams WHERE id = ? AND user_id = ?").get(id, userId) as
    | StreamRow
    | undefined;
  return row ? toRecord(row) : null;
}

export function listStreams(userId: string): StreamListRecord[] {
  const rows = getDb()
    .query(
      `SELECT ${listColumns} FROM streams s
       LEFT JOIN playlists p ON p.id = s.playlist_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC`,
    )
    .all(userId) as unknown as StreamListRow[];
  return rows.map(toListRecord);
}

export function listAllStreams(): StreamRecord[] {
  return (getDb().query("SELECT * FROM streams").all() as StreamRow[]).map(toRecord);
}

export function patchStreamSchedule(
  id: string,
  patch: { scheduledFor?: string | null; autoStopAt?: string | null },
): void {
  getDb()
    .query("UPDATE streams SET scheduled_for = ?, auto_stop_at = ?, updated_at = ? WHERE id = ?")
    .run(patch.scheduledFor ?? null, patch.autoStopAt ?? null, nowIso(), id);
}

export function countRunningStreams(userId: string): number {
  const row = getDb()
    .query("SELECT COUNT(*) AS total FROM streams WHERE user_id = ? AND status = 'running'")
    .get(userId) as { total: number };
  return row.total;
}

export function updateStream(
  id: string,
  userId: string,
  patch: Partial<
    Pick<
      InsertStream,
      | "name"
      | "targetUrl"
      | "shuffle"
      | "loop"
      | "playlistId"
      | "scheduledFor"
      | "autoStopAt"
      | "recurrence"
      | "recurrenceRule"
    >
  >,
): StreamRecord | null {
  const current = getStreamById(id, userId);
  if (!current) return null;
  getDb()
    .query(
      `UPDATE streams SET name = ?, target_url = ?, shuffle = ?, loop = ?, playlist_id = ?,
        scheduled_for = ?, auto_stop_at = ?, recurrence = ?, recurrence_rule = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(
      patch.name ?? current.name,
      patch.targetUrl ?? current.targetUrl,
      (patch.shuffle ?? current.shuffle) ? 1 : 0,
      (patch.loop ?? current.loop) ? 1 : 0,
      patch.playlistId ?? current.playlistId,
      patch.scheduledFor !== undefined ? patch.scheduledFor : current.scheduledFor,
      patch.autoStopAt !== undefined ? patch.autoStopAt : current.autoStopAt,
      patch.recurrence ?? current.recurrence,
      patch.recurrenceRule !== undefined
        ? patch.recurrenceRule
          ? JSON.stringify(patch.recurrenceRule)
          : null
        : current.recurrenceRule
          ? JSON.stringify(current.recurrenceRule)
          : null,
      nowIso(),
      id,
    );
  return getStreamById(id, userId);
}

export function setStreamStatus(
  id: string,
  status: StreamStatus,
  extra: {
    error?: string | null;
    logPath?: string | null;
    startedAt?: string | null;
    stoppedAt?: string | null;
  } = {},
): void {
  getDb()
    .query(
      `UPDATE streams SET status = ?, error = ?, log_path = COALESCE(?, log_path),
       started_at = COALESCE(?, started_at), stopped_at = COALESCE(?, stopped_at), updated_at = ? WHERE id = ?`,
    )
    .run(
      status,
      extra.error ?? null,
      extra.logPath ?? null,
      extra.startedAt ?? null,
      extra.stoppedAt ?? null,
      nowIso(),
      id,
    );
}

export function deleteStream(id: string, userId: string): boolean {
  const row = getStreamById(id, userId);
  if (!row) return false;
  getDb().query("DELETE FROM streams WHERE id = ?").run(id);
  return true;
}
