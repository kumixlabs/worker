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
  youtubeConnectionId: string | null;
  ytTitle: string | null;
  ytDescription: string | null;
  ytPrivacy: string | null;
  ytMadeForKids: boolean;
  ytDvr: boolean;
  ytBroadcastId: string | null;
  ytVideoId: string | null;
  youtubeLiveUrl: string | null;
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

export type YoutubeConnectionStatus = "pending" | "connected" | "expired";

export interface SafeYoutubeClient {
  configured: boolean;
  clientIdMasked: string | null;
  updatedAt: string | null;
}

export interface SafeYoutubeConnection {
  id: string;
  userId: string;
  hasClientSecret: boolean;
  hasRefreshToken: boolean;
  clientIdMasked: string;
  channelId: string | null;
  channelTitle: string | null;
  channelThumbnail: string | null;
  status: YoutubeConnectionStatus;
  createdAt: string;
  updatedAt: string;
}
