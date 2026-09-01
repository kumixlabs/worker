/**
 * Playlist persistence: ordered media sequences per user. Items carry a
 * `kind` ("video" | "audio") so a playlist can hold the concat order plus a
 * separate background-audio order (StreamFlow parity).
 */

import { nanoid } from "nanoid";

import { nowIso } from "../lib/utils";
import type { MediaRecord, MediaType } from "../types/media";
import type { PlaylistItemKind, PlaylistItemRecord, PlaylistRecord } from "../types/playlist";
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
    itemCount: (row.item_count as number) ?? 0,
    videoCount: (row.video_count as number) ?? 0,
    audioCount: (row.audio_count as number) ?? 0,
    totalDuration: (row.total_duration as number | null) ?? null,
    thumbnails: row.thumbnails ? String(row.thumbnails).split(",") : [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToMedia(row: Record<string, unknown>): MediaRecord {
  return {
    id: row.media_id as string,
    userId: (row.media_user_id as string | null) ?? null,
    folderId: (row.media_folder_id as string | null) ?? null,
    name: row.media_name as string,
    mediaType: row.media_type as MediaType,
    mimeType: row.media_mime_type as string,
    fileName: row.media_file_name as string,
    sizeBytes: row.media_size_bytes as number,
    createdAt: row.media_created_at as string,
    duration: (row.media_duration as number | null) ?? null,
    width: (row.media_width as number | null) ?? null,
    height: (row.media_height as number | null) ?? null,
    fps: (row.media_fps as number | null) ?? null,
    bitrate: (row.media_bitrate as number | null) ?? null,
    hasAudio: Boolean(row.media_has_audio),
    hasThumb: Boolean(row.media_has_thumb),
    contentHash: (row.media_content_hash as string | null) ?? null,
  };
}

function rowToItem(row: Record<string, unknown>): PlaylistItemRecord {
  return {
    id: row.id as string,
    playlistId: row.playlist_id as string,
    mediaId: row.media_id as string,
    position: row.position as number,
    kind: (row.kind as PlaylistItemKind) ?? "video",
    createdAt: row.created_at as string,
    media: rowToMedia(row),
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
    videoCount: 0,
    audioCount: 0,
    totalDuration: null,
    thumbnails: [],
    createdAt: now,
    updatedAt: now,
  };
}

const PLAYLIST_AGGREGATES = `
  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count,
  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id AND i.kind = 'video') AS video_count,
  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id AND i.kind = 'audio') AS audio_count,
  (SELECT COALESCE(SUM(m.duration), 0) FROM playlist_items i
     JOIN media m ON m.id = i.media_id
     WHERE i.playlist_id = p.id AND i.kind = 'video') AS total_duration,
  (SELECT GROUP_CONCAT(t.media_id) FROM (
     SELECT i.media_id FROM playlist_items i
     JOIN media m ON m.id = i.media_id
     WHERE i.playlist_id = p.id AND i.kind = 'video' AND m.has_thumb = 1
     ORDER BY i.position ASC LIMIT 3
   ) t) AS thumbnails`;

export function listPlaylists(userId: string): PlaylistRecord[] {
  const rows = getDb()
    .query(
      `SELECT p.*, ${PLAYLIST_AGGREGATES}
       FROM playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.id DESC`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToPlaylist);
}

export function getPlaylistById(id: string, userId: string): PlaylistRecord | null {
  const row = getDb()
    .query(
      `SELECT p.*, ${PLAYLIST_AGGREGATES}
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

export function getPlaylistItems(
  playlistId: string,
  kind?: PlaylistItemKind,
): PlaylistItemRecord[] {
  const filter = kind ? "AND i.kind = ?" : "";
  const params: unknown[] = kind ? [playlistId, kind] : [playlistId];
  const rows = getDb()
    .query(
      `SELECT i.id, i.playlist_id, i.media_id, i.position, i.kind, i.created_at,
              m.user_id AS media_user_id, m.folder_id AS media_folder_id, m.name AS media_name,
              m.media_type, m.mime_type AS media_mime_type, m.file_name AS media_file_name,
              m.size_bytes AS media_size_bytes, m.created_at AS media_created_at,
              m.duration AS media_duration, m.width AS media_width, m.height AS media_height,
              m.fps AS media_fps, m.bitrate AS media_bitrate,
              m.has_audio AS media_has_audio, m.has_thumb AS media_has_thumb
       FROM playlist_items i JOIN media m ON m.id = i.media_id
       WHERE i.playlist_id = ? ${filter} ORDER BY i.position ASC`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

/**
 * Replaces the full ordered item list of a playlist, split by kind. Position
 * numbering is independent per kind. All media IDs must exist and belong to
 * the user; duplicates across the merged list are rejected.
 */
export function replacePlaylistItems(
  playlistId: string,
  userId: string,
  input: { videos?: string[]; audios?: string[] },
): PlaylistItemRecord[] | "MEDIA_NOT_FOUND" | "DUPLICATE_MEDIA" | "MISPLACED_KIND" {
  const playlist = getPlaylistById(playlistId, userId);
  if (!playlist) return "MEDIA_NOT_FOUND";
  const videos = input.videos ?? [];
  const audios = input.audios ?? [];
  const mediaIds = [...videos, ...audios];
  if (new Set(mediaIds).size !== mediaIds.length) return "DUPLICATE_MEDIA";

  const db = getDb();
  const placeholders = mediaIds.map(() => "?").join(",");
  const rows = mediaIds.length
    ? (db
        .query(`SELECT id, media_type FROM media WHERE user_id = ? AND id IN (${placeholders})`)
        .all(userId, ...mediaIds) as { id: string; media_type: string }[])
    : [];
  if (rows.length !== mediaIds.length) return "MEDIA_NOT_FOUND";
  const typeById = new Map(rows.map((r) => [r.id, r.media_type]));
  const misplaced =
    videos.some((id) => typeById.get(id) !== "video") ||
    audios.some((id) => typeById.get(id) !== "audio");
  if (misplaced) return "MISPLACED_KIND";

  const now = nowIso();
  const insert = db.query(
    "INSERT INTO playlist_items (id, playlist_id, media_id, position, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  db.exec("BEGIN");
  try {
    db.query("DELETE FROM playlist_items WHERE playlist_id = ?").run(playlistId);
    videos.forEach((mediaId, index) => {
      insert.run(`pli_${nanoid(12)}`, playlistId, mediaId, index + 1, "video", now);
    });
    audios.forEach((mediaId, index) => {
      insert.run(`pli_${nanoid(12)}`, playlistId, mediaId, index + 1, "audio", now);
    });
    db.query("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, playlistId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getPlaylistItems(playlistId);
}
