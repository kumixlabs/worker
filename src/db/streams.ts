/**
 * Stream CRUD. target_url stays AES-GCM encrypted at rest; decrypt only
 * inside the runner when spawning FFmpeg.
 */

import { randomBytes } from "node:crypto";

import { getDb } from "./client";

export type StreamStatus = "stopped" | "running" | "failed";

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
  created_at: string;
  updated_at: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const listColumns = `
  s.id, s.user_id, s.playlist_id, s.name, s.shuffle, s.loop, s.status,
  s.log_path, s.started_at, s.stopped_at, s.error, s.created_at, s.updated_at,
  p.name AS playlist_name
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
      `INSERT INTO streams (id, user_id, playlist_id, name, target_url, shuffle, loop, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?)`,
    )
    .run(
      id,
      data.userId,
      data.playlistId,
      data.name,
      data.targetUrl,
      data.shuffle ? 1 : 0,
      data.loop ? 1 : 0,
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

export function countRunningStreams(userId: string): number {
  const row = getDb()
    .query("SELECT COUNT(*) AS total FROM streams WHERE user_id = ? AND status = 'running'")
    .get(userId) as { total: number };
  return row.total;
}

export function updateStream(
  id: string,
  userId: string,
  patch: Partial<Pick<InsertStream, "name" | "targetUrl" | "shuffle" | "loop" | "playlistId">>,
): StreamRecord | null {
  const current = getStreamById(id, userId);
  if (!current) return null;
  getDb()
    .query(
      "UPDATE streams SET name = ?, target_url = ?, shuffle = ?, loop = ?, playlist_id = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      patch.name ?? current.name,
      patch.targetUrl ?? current.targetUrl,
      (patch.shuffle ?? current.shuffle) ? 1 : 0,
      (patch.loop ?? current.loop) ? 1 : 0,
      patch.playlistId ?? current.playlistId,
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
