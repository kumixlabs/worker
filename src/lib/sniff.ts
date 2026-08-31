/**
 * Magic-byte media sniffing. Extensions and MIME are derived from file
 * content, never from client-supplied names.
 */

import type { MediaType } from "../types/media";

export interface SniffResult {
  mediaType: MediaType;
  mimeType: string;
  ext: string;
}

function startsWith(bytes: Uint8Array, offset: number, sig: number[]): boolean {
  return sig.every((b, i) => bytes[offset + i] === b);
}

const ascii = (bytes: Uint8Array, offset: number, len: number) =>
  String.fromCharCode(...bytes.slice(offset, offset + len));

/**
 * Detects the media type of a payload from its leading bytes.
 * Returns null when no known signature matches.
 * ponytail: rejects exotic-but-legal files (e.g. raw H.264); extend the table
 * when the gallery needs them.
 */
export function sniffMedia(bytes: Uint8Array): SniffResult | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff]))
    return { mediaType: "image", mimeType: "image/jpeg", ext: "jpg" };
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47]))
    return { mediaType: "image", mimeType: "image/png", ext: "png" };
  if (ascii(bytes, 0, 3) === "GIF")
    return { mediaType: "image", mimeType: "image/gif", ext: "gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return { mediaType: "image", mimeType: "image/webp", ext: "webp" };

  if (ascii(bytes, 0, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand.startsWith("M4A")) return { mediaType: "audio", mimeType: "audio/mp4", ext: "m4a" };
    const videoBrands = ["isom", "iso2", "mp41", "mp42", "avc1", "dash", "MSNV", "F4V", "qt  "];
    if (videoBrands.includes(brand))
      return { mediaType: "video", mimeType: "video/mp4", ext: "mp4" };
  }
  if (startsWith(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]))
    return { mediaType: "video", mimeType: "video/webm", ext: "webm" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "AVI ")
    return { mediaType: "video", mimeType: "video/x-msvideo", ext: "avi" };

  if (ascii(bytes, 0, 3) === "ID3")
    return { mediaType: "audio", mimeType: "audio/mpeg", ext: "mp3" };
  if (startsWith(bytes, 0, [0xff]) && (bytes[1] & 0xe0) === 0xe0)
    return { mediaType: "audio", mimeType: "audio/mpeg", ext: "mp3" };
  if (ascii(bytes, 0, 4) === "OggS")
    return { mediaType: "audio", mimeType: "audio/ogg", ext: "ogg" };
  if (ascii(bytes, 0, 4) === "fLaC")
    return { mediaType: "audio", mimeType: "audio/flac", ext: "flac" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE")
    return { mediaType: "audio", mimeType: "audio/wav", ext: "wav" };

  return null;
}
