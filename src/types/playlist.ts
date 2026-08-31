/**
 * Playlist domain types.
 */

import type { MediaRecord } from "./media";

export type PlaylistItemKind = "video" | "audio";

export interface PlaylistRecord {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  shuffle: boolean;
  itemCount: number;
  videoCount: number;
  audioCount: number;
  totalDuration: number | null;
  thumbnails: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemRecord {
  id: string;
  playlistId: string;
  mediaId: string;
  position: number;
  kind: PlaylistItemKind;
  createdAt: string;
  media: MediaRecord;
}
