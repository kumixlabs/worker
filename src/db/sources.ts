/**
 * Source persistence helpers for worker-owned media assets.
 */

import { unlinkSync } from "node:fs";

import { nanoid } from "nanoid";

import { nowIso } from "../lib/utils";
import type { SourceCreateInput } from "../schemas/source";
import type { SourceRecord } from "../types/source";
import { getDb } from "./client";
import { addEvent } from "./events";

/**
 * Maps a SQLite database row to a SourceRecord object.
 *
 * @param {Record<string, unknown>} row - The raw database row.
 * @returns {SourceRecord} The strongly-typed SourceRecord.
 */
function mapSourceRow(row: Record<string, unknown>): SourceRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as SourceRecord["kind"],
    status: row.status as SourceRecord["status"],
    filePath: (row.file_path as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    durationSec: (row.duration_sec as number | null) ?? null,
    videoCodec: (row.video_codec as string | null) ?? null,
    audioCodec: (row.audio_codec as string | null) ?? null,
    videoBitrate: (row.video_bitrate as number | null) ?? null,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    fps: (row.fps as number | null) ?? null,
    sha256: (row.sha256 as string | null) ?? null,
    invalidReason: (row.invalid_reason as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Retrieves all stored stream sources, ordered by creation date descending.
 *
 * @returns {SourceRecord[]} An array of source records.
 */
export function listSources(): SourceRecord[] {
  const rows = getDb().query("SELECT * FROM sources ORDER BY created_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapSourceRow);
}

/**
 * Retrieves a single stream source by its unique identifier.
 *
 * @param {string} id - The ID of the source.
 * @returns {SourceRecord | null} The matching source, or null if not found.
 */
export function getSource(id: string): SourceRecord | null {
  const row = getDb().query("SELECT * FROM sources WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSourceRow(row) : null;
}

/**
 * Creates a new stream source record in the database.
 * Supports direct URLs or Google Drive shared links.
 *
 * @param {SourceCreateInput & { filePath?: string | null }} input - The creation payload including the resolved file path if any.
 * @returns {SourceRecord} The newly created source record.
 */
export function createSource(
  input: SourceCreateInput & { filePath?: string | null },
): SourceRecord {
  const id = `src_${nanoid(12)}`;
  const now = nowIso();
  getDb()
    .query(
      "INSERT INTO sources (id, name, kind, status, file_path, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.name,
      input.kind,
      input.filePath ? "ready" : "pending",
      input.filePath ?? null,
      input.url ?? null,
      now,
      now,
    );
  return getSource(id)!;
}

/**
 * Updates the ffprobe metadata and status of an existing source.
 *
 * @param {string} id - The source ID to update.
 * @param {Partial<Pick<SourceRecord, "status" | "invalidReason" | "durationSec" | "videoCodec" | "audioCodec" | "videoBitrate" | "width" | "height" | "fps" | "sha256" | "sizeBytes" | "filePath">>} data - The extracted probe metrics and resolution status.
 * @returns {SourceRecord | null} The updated source, or null if the original source was not found.
 */
export function updateSourceProbe(
  id: string,
  data: Partial<
    Pick<
      SourceRecord,
      | "status"
      | "invalidReason"
      | "durationSec"
      | "videoCodec"
      | "audioCodec"
      | "videoBitrate"
      | "width"
      | "height"
      | "fps"
      | "sha256"
      | "sizeBytes"
      | "filePath"
    >
  >,
): SourceRecord | null {
  const existing = getSource(id);
  if (!existing) return null;
  getDb()
    .query(
      "UPDATE sources SET status = ?, invalid_reason = ?, duration_sec = ?, video_codec = ?, audio_codec = ?, video_bitrate = ?, width = ?, height = ?, fps = ?, sha256 = ?, size_bytes = ?, file_path = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      data.status ?? existing.status,
      data.invalidReason !== undefined ? data.invalidReason : existing.invalidReason,
      data.durationSec !== undefined ? data.durationSec : existing.durationSec,
      data.videoCodec !== undefined ? data.videoCodec : existing.videoCodec,
      data.audioCodec !== undefined ? data.audioCodec : existing.audioCodec,
      data.videoBitrate !== undefined ? data.videoBitrate : existing.videoBitrate,
      data.width !== undefined ? data.width : existing.width,
      data.height !== undefined ? data.height : existing.height,
      data.fps !== undefined ? data.fps : existing.fps,
      data.sha256 !== undefined ? data.sha256 : existing.sha256,
      data.sizeBytes !== undefined ? data.sizeBytes : existing.sizeBytes,
      data.filePath !== undefined ? data.filePath : existing.filePath,
      nowIso(),
      id,
    );
  return getSource(id);
}

/**
 * Deletes a source from the database.
 * Does not remove the underlying file from the filesystem.
 *
 * @param {string} id - The ID of the source to delete.
 * @returns {boolean} True if a row was successfully deleted, otherwise false.
 */
export function deleteSource(id: string): boolean {
  const existing = getSource(id);
  if (!existing) return false;
  if (existing.status === "downloading" || existing.status === "probing") {
    throw new Error("Cannot delete a source while it is being processed");
  }
  const row = getDb().query("SELECT COUNT(*) AS count FROM streams WHERE source_id = ?").get(id) as
    | { count: number }
    | undefined;
  const referenceCount = row?.count ?? 0;
  if (referenceCount > 0) {
    throw new Error(`Source is used by ${referenceCount} stream(s)`);
  }
  const deleted = getDb().query("DELETE FROM sources WHERE id = ?").run(id).changes > 0;
  if (deleted && existing?.filePath) {
    try {
      unlinkSync(existing.filePath);
    } catch {
      addEvent(
        null,
        "source_warning",
        `Orphaned cache file could not be deleted: ${existing.filePath}`,
        {
          sourceId: id,
        },
      );
    }
  }
  return deleted;
}
