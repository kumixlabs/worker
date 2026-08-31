/**
 * Media library persistence: rows live in SQLite, binary payloads in
 * `<dataDir>/media/<id>.<ext>`.
 */

import { createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { nanoid } from "nanoid";

import { nowIso } from "../lib/utils";
import { getDataDir } from "../runtime/config";
import type { MediaFolderRecord, MediaRecord, MediaType } from "../types/media";
import { getDb } from "./client";

export function getMediaDir(): string {
  const dir = path.join(getDataDir(), "media");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function newMediaId(): string {
  return `med_${nanoid(12)}`;
}

export function newFolderId(): string {
  return `fld_${nanoid(12)}`;
}

export function mediaPath(fileName: string): string {
  // fileName is always server-generated (`<id>.<ext>`); basename guards joins.
  return path.join(getMediaDir(), path.basename(fileName));
}

function rowToRecord(row: Record<string, unknown>): MediaRecord {
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    folderId: (row.folder_id as string | null) ?? null,
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
      "INSERT INTO media (id, user_id, folder_id, name, media_type, mime_type, file_name, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      withDates.id,
      withDates.userId,
      withDates.folderId,
      withDates.name,
      withDates.mediaType,
      withDates.mimeType,
      withDates.fileName,
      withDates.sizeBytes,
      withDates.createdAt,
    );
  return withDates;
}

/**
 * Lists a user's media, newest first.
 * @param folderId - Folder to list; `"root"` lists only unfoldered media.
 */
export function listMedia(userId: string, folderId?: string | null, limit = 500): MediaRecord[] {
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (folderId === "root") {
    conditions.push("folder_id IS NULL");
  } else if (folderId) {
    conditions.push("folder_id = ?");
    params.push(folderId);
  }
  const rows = getDb()
    .query(
      `SELECT * FROM media WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params, Math.min(Math.max(limit, 1), 500)) as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function getMediaById(id: string, userId: string): MediaRecord | null {
  const row = getDb().query("SELECT * FROM media WHERE id = ? AND user_id = ?").get(id, userId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRecord(row) : null;
}

export function updateMedia(
  id: string,
  userId: string,
  patch: { name?: string; folderId?: string | null },
): MediaRecord | null {
  const existing = getMediaById(id, userId);
  if (!existing) return null;
  const name = patch.name?.trim().slice(0, 200) || existing.name;
  const folderId = patch.folderId === undefined ? existing.folderId : patch.folderId;
  getDb()
    .query("UPDATE media SET name = ?, folder_id = ? WHERE id = ? AND user_id = ?")
    .run(name, folderId, id, userId);
  return { ...existing, name, folderId };
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

export function listMediaFolders(userId: string): MediaFolderRecord[] {
  const rows = getDb()
    .query(
      `SELECT f.*, (SELECT COUNT(*) FROM media m WHERE m.folder_id = f.id) AS media_count
       FROM media_folders f WHERE f.user_id = ? ORDER BY f.name COLLATE NOCASE ASC`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    name: row.name as string,
    mediaCount: row.media_count as number,
    createdAt: row.created_at as string,
  }));
}

export function getMediaFolderById(id: string, userId: string): MediaFolderRecord | null {
  return listMediaFolders(userId).find((folder) => folder.id === id) ?? null;
}

export function insertMediaFolder(userId: string, name: string): MediaFolderRecord | null {
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return null;
  const id = newFolderId();
  getDb()
    .query("INSERT INTO media_folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, trimmed, nowIso());
  return { id, userId, name: trimmed, mediaCount: 0, createdAt: nowIso() };
}

export function renameMediaFolder(
  id: string,
  userId: string,
  name: string,
): MediaFolderRecord | null {
  const existing = getMediaFolderById(id, userId);
  if (!existing) return null;
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return null;
  getDb()
    .query("UPDATE media_folders SET name = ? WHERE id = ? AND user_id = ?")
    .run(trimmed, id, userId);
  return { ...existing, name: trimmed };
}

export function deleteMediaFolder(id: string, userId: string): boolean {
  if (!getMediaFolderById(id, userId)) return false;
  getDb().query("DELETE FROM media_folders WHERE id = ? AND user_id = ?").run(id, userId);
  // media.folder_id settles to NULL via ON DELETE SET NULL.
  getDb().query("UPDATE media SET folder_id = NULL WHERE folder_id = ?").run(id);
  return true;
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
