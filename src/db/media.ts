/**
 * Media library persistence: rows live in SQLite, binary payloads in
 * `<dataDir>/media/<id>.<ext>`.
 */

import { createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { nanoid } from "nanoid";

import { nowIso } from "../lib/utils";
import { getDataDir } from "../runtime/config";
import type { MediaRecord, MediaType } from "../types/media";
import { getDb } from "./client";

export function getMediaDir(): string {
  const dir = path.join(getDataDir(), "media");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function newMediaId(): string {
  return `med_${nanoid(12)}`;
}

export function mediaPath(fileName: string): string {
  // fileName is always server-generated (`<id>.<ext>`); basename guards joins.
  return path.join(getMediaDir(), path.basename(fileName));
}

function rowToRecord(row: Record<string, unknown>): MediaRecord {
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    name: row.name as string,
    mediaType: row.media_type as MediaType,
    mimeType: row.mime_type as string,
    fileName: row.file_name as string,
    sizeBytes: row.size_bytes as number,
    createdAt: row.created_at as string,
  };
}

export function insertMedia(record: Omit<MediaRecord, "createdAt">): MediaRecord {
  const withDates = { ...record, createdAt: nowIso() };
  getDb()
    .query(
      "INSERT INTO media (id, user_id, name, media_type, mime_type, file_name, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      withDates.id,
      withDates.userId,
      withDates.name,
      withDates.mediaType,
      withDates.mimeType,
      withDates.fileName,
      withDates.sizeBytes,
      withDates.createdAt,
    );
  return withDates;
}

export function listMedia(userId: string, limit = 500): MediaRecord[] {
  const rows = getDb()
    .query("SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(userId, Math.min(Math.max(limit, 1), 500)) as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function getMediaById(id: string, userId: string): MediaRecord | null {
  const row = getDb().query("SELECT * FROM media WHERE id = ? AND user_id = ?").get(id, userId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRecord(row) : null;
}

export function deleteMediaById(id: string, userId: string): MediaRecord | null {
  const existing = getMediaById(id, userId);
  if (!existing) return null;
  getDb().query("DELETE FROM media WHERE id = ? AND user_id = ?").run(id, userId);
  try {
    rmSync(mediaPath(existing.fileName), { force: true });
  } catch {
    // Row removal already succeeded; orphaned file is cleaned by future sweeps.
  }
  return existing;
}

export function getMediaStorageBytes(userId: string): number {
  const row = getDb()
    .query("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM media WHERE user_id = ?")
    .get(userId) as { total: number };
  return row.total;
}

/**
 * Allocates a unique temp file for an in-flight upload and returns its write
 * stream. Caller must unlink on failure.
 */
export function openTempMediaFile(id: string) {
  const dir = path.join(getMediaDir(), ".tmp");
  mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `${id}.part`);
  return { tempPath, writeStream: createWriteStream(tempPath) };
}

export function mediaReadStream(fileName: string) {
  return createReadStream(mediaPath(fileName));
}
