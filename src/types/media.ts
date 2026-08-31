/**
 * Media library domain types.
 */

export type MediaType = "video" | "audio" | "image";

export interface MediaRecord {
  id: string;
  userId: string | null;
  name: string;
  mediaType: MediaType;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}
