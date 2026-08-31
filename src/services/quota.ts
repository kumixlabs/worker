/**
 * Per-user quota engine: storage bytes and stream concurrency.
 */

import { getDb } from "../db/client";

export interface UserUsage {
  storageBytes: number;
  streamCount: number;
}

/**
 * Computes current usage for a user.
 * storageBytes = SUM(sources.size_bytes) for sources owned by the user.
 * streamCount = count of non-terminal streams (pending | running | stopping).
 */
export function getUserUsage(userId: string): UserUsage {
  const db = getDb();
  const storageRow = db
    .query("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM sources WHERE user_id = ?")
    .get(userId) as { total: number } | undefined;
  const streamsRow = db
    .query(
      "SELECT COUNT(*) AS count FROM streams WHERE user_id = ? AND status IN ('pending', 'running', 'stopping')",
    )
    .get(userId) as { count: number } | undefined;

  return {
    storageBytes: storageRow?.total ?? 0,
    streamCount: streamsRow?.count ?? 0,
  };
}

/**
 * Checks whether user can allocate additional storage bytes.
 * Throws an Error with code QUOTA_STORAGE_EXCEEDED if quota would be exceeded.
 * Admin (maxStorageBytes === null/undefined) is unlimited.
 */
export function assertStorageQuota(
  userId: string | null | undefined,
  maxStorageBytes: number | null | undefined,
  incomingBytes: number,
): void {
  if (!userId || maxStorageBytes === null || maxStorageBytes === undefined) return;
  if (incomingBytes <= 0) return;
  const usage = getUserUsage(userId);
  if (usage.storageBytes + incomingBytes > maxStorageBytes) {
    const error = new Error(
      `Storage quota exceeded: requires ${usage.storageBytes + incomingBytes} bytes, limit is ${maxStorageBytes} bytes`,
    );
    (error as { code?: string }).code = "QUOTA_STORAGE_EXCEEDED";
    throw error;
  }
}

/**
 * Checks whether user can create/start another stream.
 * Throws an Error with code QUOTA_STREAMS_EXCEEDED if quota is reached.
 * Admin (maxStreams === null/undefined) is unlimited.
 */
export function assertStreamQuota(
  userId: string | null | undefined,
  maxStreams: number | null | undefined,
): void {
  if (!userId || maxStreams === null || maxStreams === undefined) return;
  const usage = getUserUsage(userId);
  if (usage.streamCount >= maxStreams) {
    const error = new Error(`Stream quota reached: limit is ${maxStreams} concurrent stream(s)`);
    (error as { code?: string }).code = "QUOTA_STREAMS_EXCEEDED";
    throw error;
  }
}
