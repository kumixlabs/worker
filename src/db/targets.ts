/**
 * Target persistence helpers for RTMP destinations and encrypted stream keys.
 */

import { nanoid } from "nanoid";

import {
  decryptSecret,
  decryptSecretWithToken,
  encryptSecret,
  encryptSecretWithToken,
  maskSecret,
} from "../lib/crypto";
import { nowIso } from "../lib/utils";
import type { TargetCreateInput, TargetPatchInput } from "../schemas/target";
import type { TargetRecord } from "../types/target";
import { getDb } from "./client";

/**
 * Maps a SQLite database row to a TargetRecord object.
 *
 * @param {Record<string, unknown>} row - The raw database row.
 * @returns {TargetRecord} The strongly-typed TargetRecord.
 */
function mapTargetRow(row: Record<string, unknown>): TargetRecord {
  return {
    id: row.id as string,
    label: row.label as string,
    ingestUrl: row.ingest_url as string,
    active: Boolean(row.active),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Retrieves all stored stream targets, ordered by creation date descending.
 * Does not expose the encrypted stream key payload.
 *
 * @returns {TargetRecord[]} An array of target records.
 */
export function listTargets(): TargetRecord[] {
  const rows = getDb().query("SELECT * FROM targets ORDER BY created_at DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapTargetRow);
}

/**
 * Retrieves a single stream target by its unique identifier, including its ciphered stream key.
 *
 * @param {string} id - The ID of the target.
 * @returns {(TargetRecord & { streamKey: string }) | null} The matching target, or null if not found.
 */
export function getTarget(id: string): (TargetRecord & { streamKey: string }) | null {
  const row = getDb().query("SELECT * FROM targets WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return { ...mapTargetRow(row), streamKey: row.stream_key_cipher as string };
}

/**
 * Creates a new stream target in the database.
 * The stream key is encrypted at rest before insertion.
 *
 * @param {TargetCreateInput} input - The creation payload including the plaintext stream key.
 * @returns {TargetRecord} The newly created target record without the raw stream key.
 */
export function createTarget(input: TargetCreateInput): TargetRecord {
  const id = `tgt_${nanoid(12)}`;
  const now = nowIso();
  getDb()
    .query(
      "INSERT INTO targets (id, label, ingest_url, stream_key_cipher, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.label,
      input.ingestUrl,
      encryptSecret(input.streamKey),
      input.active ? 1 : 0,
      now,
      now,
    );
  const { streamKey, ...rest } = getTarget(id)!;
  return rest;
}

/**
 * Updates an existing stream target.
 * Modifying the stream key triggers a new encryption process.
 *
 * @param {string} id - The target ID to update.
 * @param {TargetPatchInput} input - The modified properties to save.
 * @returns {TargetRecord | null} The updated target, or null if not found.
 */
export function patchTarget(id: string, input: TargetPatchInput): TargetRecord | null {
  const existing = getTarget(id);
  if (!existing) return null;
  getDb()
    .query(
      "UPDATE targets SET label = ?, ingest_url = ?, stream_key_cipher = ?, active = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      input.label ?? existing.label,
      input.ingestUrl ?? existing.ingestUrl,
      input.streamKey ? encryptSecret(input.streamKey) : existing.streamKey,
      input.active !== undefined ? (input.active ? 1 : 0) : existing.active ? 1 : 0,
      nowIso(),
      id,
    );
  const { streamKey, ...rest } = getTarget(id)!;
  return rest;
}

/**
 * Deletes a target from the database.
 * Throws when any stream still references this target.
 *
 * @param {string} id - The ID of the target to delete.
 * @returns {boolean} True if a row was successfully deleted, otherwise false.
 */
export function deleteTarget(id: string): boolean {
  const row = getDb().query("SELECT COUNT(*) AS count FROM streams WHERE target_id = ?").get(id) as
    | { count: number }
    | undefined;
  const referenceCount = row?.count ?? 0;
  if (referenceCount > 0) {
    throw new Error(`Target is used by ${referenceCount} stream(s)`);
  }
  return getDb().query("DELETE FROM targets WHERE id = ?").run(id).changes > 0;
}

/**
 * Re-encrypts every stored target stream key from the old token-derived key to a new one.
 * Throws when any existing ciphertext fails to decrypt with the old token.
 *
 * @param oldToken - The previous worker token used for current ciphertexts.
 * @param newToken - The new worker token to derive the next encryption key.
 */
export function reencryptTargetSecrets(oldToken: string, newToken: string): void {
  const db = getDb();
  const rows = db.query("SELECT id, stream_key_cipher FROM targets").all() as Array<{
    id: string;
    stream_key_cipher: string;
  }>;
  const update = db.query("UPDATE targets SET stream_key_cipher = ?, updated_at = ? WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const plaintext = decryptSecretWithToken(row.stream_key_cipher, oldToken);
      if (!plaintext) throw new Error(`Unable to decrypt stream key for target ${row.id}`);
      update.run(encryptSecretWithToken(plaintext, newToken), nowIso(), row.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Strips the ciphered stream key payload from a target response and adds a masked preview.
 *
 * @param {TargetRecord & { streamKey?: string }} targetRecord - The target object.
 * @returns {TargetRecord & { streamKeyMasked?: string }} The safe target representation for clients.
 */
export function safeTarget(
  targetRecord: TargetRecord & { streamKey?: string },
): TargetRecord & { streamKeyMasked?: string } {
  const { streamKey, ...rest } = targetRecord;
  const plaintext = streamKey ? decryptSecret(streamKey) : "";
  return {
    ...rest,
    streamKeyMasked: plaintext ? maskSecret(plaintext) : undefined,
  };
}
