/**
 * Stream domain types.
 * A stream pipes a source to a target through an FFmpeg process.
 */

import type { SourceRecord } from "./source";
import type { TargetRecord } from "./target";

/** Lifecycle states of a running stream. */
export type StreamStatus = "pending" | "running" | "stopping" | "stopped" | "failed";

/** Coarse recurrence schedule for streams. */
export type StreamRecurrence = "none" | "daily" | "weekly" | "monthly";

/**
 * Metrics extracted from FFmpeg stderr output during a live stream.
 */
export interface StreamMetrics {
  fps: number | null;
  bitrateKbps: number | null;
  droppedFrames: number | null;
}

/**
 * Represents a streaming task tying a source and a target together.
 */
export interface StreamRecord {
  id: string;
  title: string;
  sourceId: string;
  targetId: string;
  status: StreamStatus;
  loop: boolean;
  scheduledFor: string | null;
  autoStopAt: string | null;
  recurrence: StreamRecurrence;
  recurrenceRule: unknown | null;
  startedAt: string | null;
  stoppedAt: string | null;
  pid: number | null;
  lastError: string | null;
  lastMetrics: StreamMetrics | null;
  createdAt: string;
  updatedAt: string;
  source?: Pick<SourceRecord, "id" | "name" | "status" | "kind">;
  target?: Pick<TargetRecord, "id" | "label" | "active" | "ingestUrl">;
}
