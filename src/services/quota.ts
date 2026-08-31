/**
 * Per-user quota engine: storage bytes and stream concurrency.
 * Usage counters return zeros until media/stream features land on the new foundation.
 * ponytail: plug real SUM/COUNT queries back in when tables return.
 */

export interface UserUsage {
  storageBytes: number;
  streamCount: number;
}

/**
 * Computes current usage for a user.
 */
export function getUserUsage(_userId: string): UserUsage {
  return { storageBytes: 0, streamCount: 0 };
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
  if (incomingBytes > maxStorageBytes) {
    const error = new Error(
      `Storage quota exceeded: requires ${incomingBytes} bytes, limit is ${maxStorageBytes} bytes`,
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
  if (maxStreams <= 0) {
    const error = new Error("Stream quota reached: limit is 0 concurrent stream(s)");
    (error as { code?: string }).code = "QUOTA_STREAMS_EXCEEDED";
    throw error;
  }
}
