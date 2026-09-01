/**
 * Per-user quota engine: storage bytes and stream concurrency.
 */

import { getMediaStorageBytes } from "../db/media";
import { countRunningStreams } from "../db/streams";

export interface UserUsage {
  storageBytes: number;
  streamCount: number;
}

/**
 * Computes current usage for a user.
 * ponytail: streamCount stays 0 until streams land again.
 */
export function getUserUsage(userId: string): UserUsage {
  return { storageBytes: getMediaStorageBytes(userId), streamCount: countRunningStreams(userId) };
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
  const used = getMediaStorageBytes(userId);
  if (used + incomingBytes > maxStorageBytes) {
    const error = new Error(
      `Storage quota exceeded: requires ${used + incomingBytes} bytes total, limit is ${maxStorageBytes} bytes`,
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
  const running = countRunningStreams(userId);
  if (running >= maxStreams) {
    const error = new Error(`Stream quota reached: ${running}/${maxStreams} concurrent stream(s)`);
    (error as { code?: string }).code = "QUOTA_STREAMS_EXCEEDED";
    throw error;
  }
}
