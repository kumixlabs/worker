/**
 * Source domain types.
 * A source is a worker-owned video asset downloaded and probed before streaming.
 */

/** Valid source types: direct URL or Google Drive shared link. */
export type SourceKind = "url" | "gdrive";

/** Lifecycle states of a source as it is downloaded and validated. */
export type SourceStatus = "pending" | "downloading" | "probing" | "ready" | "invalid";

/** Live download progress for a source that is currently downloading. */
export interface SourceDownloadProgress {
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total expected bytes, or null when the server did not report a size. */
  total: number | null;
}

/**
 * Represents a video source file downloaded and probed by the worker.
 */
export interface SourceRecord {
  id: string;
  name: string;
  kind: SourceKind;
  status: SourceStatus;
  filePath: string | null;
  url: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  videoBitrate: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  sha256: string | null;
  invalidReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Live download progress while status is "downloading", otherwise null. */
  progress?: SourceDownloadProgress | null;
}
