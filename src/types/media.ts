/**
 * Media library domain types.
 */

export type MediaType = "video" | "audio" | "image";

export interface MediaRecord {
  id: string;
  userId: string | null;
  folderId: string | null;
  name: string;
  mediaType: MediaType;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
  hasAudio: boolean;
  hasThumb: boolean;
  contentHash: string | null;
}

export interface MediaFolderRecord {
  id: string;
  userId: string | null;
  name: string;
  mediaCount: number;
  createdAt: string;
}
