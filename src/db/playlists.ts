/**
 * Playlist persistence: ordered media sequences per user.
 */

import { nanoid } from "nanoid";

import { nowIso } from "../lib/utils";
import type { MediaType } from "../types/media";
import type { PlaylistItemRecord, PlaylistRecord } from "../types/playlist";
import { getDb } from "./client";

export function newPlaylistId(): string {
  return `pl_${nanoid(12)}`;
}

function rowToPlaylist(row: Record<string, unknown>): PlaylistRecord {
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    shuffle: Boolean(row.shuffle),
    itemCount: row.item_count as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToItem(row: Record<string, unknown>): PlaylistItemRecord {
  return {
    id: row.id as string,
    playlistId: row.playlist_id as string,
    mediaId: row.media_id as string,
    position: row.position as number,
    createdAt: row.created_at as string,
    media: {
      id: row.media_id as string,
      userId: (row.media_user_id as string | null) ?? null,
      folderId: (row.media_folder_id as string | null) ?? null,
      name: row.media_name as string,
      mediaType: row.media_type as MediaType,
      mimeType: row.media_mime_type as string,
      fileName: row.media_file_name as string,
      sizeBytes: row.media_size_bytes as number,
      createdAt: row.media_created_at as string,
    },
  };
}

export function insertPlaylist(
  userId: string,
  input: { name: string; description?: string | null; shuffle?: boolean },
): PlaylistRecord {
  const id = newPlaylistId();
  const now = nowIso();
  getDb()
    .query(
      "INSERT INTO playlists (id, user_id, name, description, shuffle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, userId, input.name, input.description ?? null, input.shuffle ? 1 : 0, now, now);
  return {
    id,
    userId,
    name: input.name,
    description: input.description ?? null,
    shuffle: input.shuffle ?? false,
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function listPlaylists(userId: string): PlaylistRecord[] {
  const rows = getDb()
    .query(
      `SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count
       FROM playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.id DESC`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToPlaylist);
}

export function getPlaylistById(id: string, userId: string): PlaylistRecord | null {
  const row = getDb()
    .query(
      `SELECT p.*, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count
       FROM playlists p WHERE p.id = ? AND p.user_id = ?`,
    )
    .get(id, userId) as Record<string, unknown> | undefined;
  return row ? rowToPlaylist(row) : null;
}

export function updatePlaylist(
  id: string,
  userId: string,
  patch: { name?: string; description?: string | null; shuffle?: boolean },
): PlaylistRecord | null {
  const existing = getPlaylistById(id, userId);
  if (!existing) return null;
  const name = patch.name?.trim().slice(0, 200) || existing.name;
  const description = patch.description === undefined ? existing.description : patch.description;
  const shuffle = patch.shuffle ?? existing.shuffle;
  getDb()
    .query(
      "UPDATE playlists SET name = ?, description = ?, shuffle = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .run(name, description, shuffle ? 1 : 0, nowIso(), id, userId);
  return { ...existing, name, description, shuffle };
}

export function deletePlaylist(id: string, userId: string): boolean {
  if (!getPlaylistById(id, userId)) return false;
  getDb().query("DELETE FROM playlist_items WHERE playlist_id = ?").run(id);
  getDb().query("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(id, userId);
  return true;
}

export function getPlaylistItems(playlistId: string): PlaylistItemRecord[] {
  const rows = getDb()
    .query(
      `SELECT i.id, i.playlist_id, i.media_id, i.position, i.created_at,
              m.user_id AS media_user_id, m.folder_id AS media_folder_id, m.name AS media_name,
              m.media_type, m.mime_type AS media_mime_type, m.file_name AS media_file_name,
              m.size_bytes AS media_size_bytes, m.created_at AS media_created_at
       FROM playlist_items i JOIN media m ON m.id = i.media_id
       WHERE i.playlist_id = ? ORDER BY i.position ASC`,
    )
    .all(playlistId) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

/**
 * Replaces the full ordered item list of a playlist.
 * All media IDs must exist and belong to the user; duplicates are rejected.
 */
export function replacePlaylistItems(
  playlistId: string,
  userId: string,
  mediaIds: string[],
): PlaylistItemRecord[] | "MEDIA_NOT_FOUND" | "DUPLICATE_MEDIA" {
  const playlist = getPlaylistById(playlistId, userId);
  if (!playlist) return "MEDIA_NOT_FOUND";
  if (new Set(mediaIds).size !== mediaIds.length) return "DUPLICATE_MEDIA";

  const db = getDb();
  const placeholders = mediaIds.map(() => "?").join(",");
  const owned = mediaIds.length
    ? (db
        .query(`SELECT id FROM media WHERE user_id = ? AND id IN (${placeholders})`)
        .all(userId, ...mediaIds) as { id: string }[])
    : [];
  if (owned.length !== mediaIds.length) return "MEDIA_NOT_FOUND";

  const now = nowIso();
  const insert = db.query(
    "INSERT INTO playlist_items (id, playlist_id, media_id, position, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  db.exec("BEGIN");
  try {
    db.query("DELETE FROM playlist_items WHERE playlist_id = ?").run(playlistId);
    mediaIds.forEach((mediaId, index) => {
      insert.run(`pli_${nanoid(12)}`, playlistId, mediaId, index + 1, now);
    });
    db.query("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, playlistId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getPlaylistItems(playlistId);
}
