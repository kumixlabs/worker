export type StreamStatus = "stopped" | "running" | "failed";

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
  createdAt: string;
  updatedAt: string;
  playlistName: string | null;
}
