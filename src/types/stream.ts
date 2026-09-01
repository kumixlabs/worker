export type StreamStatus = "stopped" | "running" | "failed";

export type StreamRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface StreamRecurrenceRule {
  time: string;
  weekdays?: number[];
  day?: number;
  durationMinutes?: number;
}

export interface StreamRecord {
  id: string;
  playlistId: string;
  name: string;
  shuffle: boolean;
  loop: boolean;
  status: StreamStatus;
  logPath: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  error: string | null;
  scheduledFor: string | null;
  autoStopAt: string | null;
  recurrence: StreamRecurrence;
  recurrenceRule: StreamRecurrenceRule | null;
  createdAt: string;
  updatedAt: string;
  playlistName: string | null;
}

export interface StreamScheduleInput {
  recurrence: StreamRecurrence;
  time: string;
  weekdays?: number[];
  day?: number;
  durationMinutes?: number;
}
