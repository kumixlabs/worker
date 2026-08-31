/**
 * Playlist domain types.
 * ponytail: no duration fields yet — add when ffprobe lands.
 */

import type { MediaRecord } from "./media";

export interface PlaylistRecord {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  shuffle: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemRecord {
  id: string;
  playlistId: string;
  mediaId: string;
  position: number;
  createdAt: string;
  media: MediaRecord;
}
