/**
 * Media library endpoints: list, detail, content stream, upload, GDrive
 * import, folders, rename/move, delete.
 */

import {
  appendFile,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";

import { addEvent } from "../../db/events";
import {
  countMedia,
  deleteMediaById,
  deleteMediaFolder,
  getMediaById,
  getMediaDir,
  getMediaFolderById,
  getMediaStorageBytes,
  insertMedia,
  insertMediaFolder,
  listMedia,
  listMediaFolders,
  mediaPath,
  mediaReadStream,
  mediaThumbPath,
  newMediaId,
  openTempMediaFile,
  renameMediaFolder,
  updateMedia,
  updateMediaMetadata,
} from "../../db/media";
import { sniffMedia } from "../../lib/sniff";
import { toWebStream } from "../../lib/utils";
import { generateThumbnail, probeMediaFile } from "../../runtime/ffmpeg";
import { extractGDriveFileId, resolveGDriveDownload } from "../../services/gdrive";
import { assertStorageQuota } from "../../services/quota";
import type { MediaRecord } from "../../types/media";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const headBytes = 64;
const maxUploadBytesDefault = 2 * 1024 * 1024 * 1024;
const gdriveTimeoutMs = Number(process.env.KUMIX_WORKER_IMPORT_TIMEOUT_MS) || 10 * 60 * 1000;

type SessionUser = {
  id: string;
  role?: string;
  maxStorageBytes?: number | null;
};

function sessionUser(c: { get: (key: string) => unknown }): SessionUser {
  return c.get("user") as SessionUser;
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 413 | 415,
  ) {
    super(message);
  }
}

function maxUploadBytes(): number {
  return Number(process.env.KUMIX_WORKER_MAX_UPLOAD_BYTES) || maxUploadBytesDefault;
}

/**
 * Streams a binary payload to the media store with quota enforcement and
 * magic-byte sniffing. Cleans up partial files on any failure.
 */
async function persistStream(
  body: AsyncIterable<Uint8Array>,
  declaredLength: number,
  user: SessionUser,
  name: string,
  folderId: string | null,
): Promise<ReturnType<typeof insertMedia>> {
  const limit = maxUploadBytes();
  if (declaredLength > limit)
    throw new UploadError(`Upload exceeds ${limit} bytes`, "payload_too_large", 413);
  if (declaredLength > 0) assertQuota(user, declaredLength);

  const id = newMediaId();
  const { tempPath, writeStream } = openTempMediaFile(id);
  let total = 0;
  let head = new Uint8Array(0);
  try {
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > limit)
        throw new UploadError("Upload exceeds size limit", "payload_too_large", 413);
      if (head.length < headBytes) {
        const merged = new Uint8Array(Math.min(headBytes, head.length + chunk.length));
        merged.set(head);
        merged.set(chunk.subarray(0, merged.length - head.length), head.length);
        head = merged;
      }
      if (!writeStream.write(chunk)) await new Promise((r) => writeStream.once("drain", r));
    }
    await new Promise<void>((resolve, reject) =>
      writeStream.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );

    if (total === 0) throw new UploadError("Empty upload body", "BAD_REQUEST", 400);
    assertQuota(user, total);
    const sniff = sniffMedia(head);
    if (!sniff)
      throw new UploadError(
        "Unsupported or unrecognized media type",
        "unsupported_media_type",
        415,
      );

    const fileName = `${id}.${sniff.ext}`;
    renameSync(tempPath, mediaPath(fileName));
    const record = insertMedia({
      id,
      userId: user.id,
      folderId,
      name,
      mediaType: sniff.mediaType,
      mimeType: sniff.mimeType,
      fileName,
      sizeBytes: statSync(mediaPath(fileName)).size,
    });
    return await enrichMedia(record);
  } catch (error) {
    writeStream.destroy();
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // best effort cleanup
    }
    throw error;
  }
}

const appendFileAsync = promisify(appendFile);

async function enrichMedia(record: MediaRecord): Promise<MediaRecord> {
  if (record.mediaType === "image") return record;
  const filePath = mediaPath(record.fileName);
  const probe = await probeMediaFile(filePath);
  const meta: Parameters<typeof updateMediaMetadata>[1] = probe
    ? {
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        bitrate: probe.bitrate,
        hasAudio: probe.hasAudio,
      }
    : {};
  if (record.mediaType === "video") {
    meta.hasThumb = await generateThumbnail(filePath, mediaThumbPath(record.id));
  }
  updateMediaMetadata(record.id, meta);
  return (
    getMediaById(record.id, record.userId ?? "") ?? {
      ...record,
      ...meta,
      hasAudio: Boolean(meta.hasAudio),
      hasThumb: Boolean(meta.hasThumb),
    }
  );
}

function assertQuota(user: SessionUser, incoming: number): void {
  try {
    assertStorageQuota(user.id, user.maxStorageBytes, incoming);
  } catch {
    throw new UploadError("Upload exceeds storage quota", "QUOTA_STORAGE_EXCEEDED", 413);
  }
}

function uploadErrorResponse(error: unknown) {
  if (error instanceof UploadError) return fail(error.code, error.message, error.status);
  if ((error as { code?: string }).code === "QUOTA_STORAGE_EXCEEDED")
    return fail("QUOTA_STORAGE_EXCEEDED", "Upload exceeds storage quota", 413);
  throw error;
}

function resolveFolderId(
  raw: string | undefined,
  userId: string,
): string | null | "root" | undefined {
  if (raw === undefined) return undefined;
  if (raw === "" || raw === "root") return "root";
  return getMediaFolderById(raw, userId) ? raw : "NOT_FOUND";
}

export function registerMediaRoutes(app: Hono) {
  app.get(
    "/api/media",
    doc(
      "Media",
      "List media",
      "Returns the current user's media, newest first. Query: ?folderId=<id|root>.",
    ),
    (c) => {
      const folder = resolveFolderId(c.req.query("folderId"), sessionUser(c).id);
      if (folder === "NOT_FOUND") return fail("NOT_FOUND", "Folder not found", 404);
      const limitParam = Number(c.req.query("limit"));
      const items = listMedia(
        sessionUser(c).id,
        folder === undefined ? undefined : folder === "root" ? "root" : folder,
        Number.isFinite(limitParam) ? limitParam : undefined,
      );
      return c.json(ok(items));
    },
  );

  app.get(
    "/api/media/folders",
    doc("Media", "List folders", "Returns the current user's media folders with item counts."),
    (c) => c.json(ok(listMediaFolders(sessionUser(c).id))),
  );

  app.post(
    "/api/media/folders",
    doc("Media", "Create folder", "Creates a media folder."),
    async (c) => {
      const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
      const folder = insertMediaFolder(sessionUser(c).id, body?.name ?? "");
      return folder ? c.json(ok(folder), 201) : fail("BAD_REQUEST", "Folder name is required", 400);
    },
  );

  app.patch(
    "/api/media/folders/:id",
    doc("Media", "Rename folder", "Renames a media folder."),
    async (c) => {
      const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
      const folder = renameMediaFolder(c.req.param("id"), sessionUser(c).id, body?.name ?? "");
      if (folder === null) return fail("BAD_REQUEST", "Folder name is required", 400);
      return c.json(ok(folder));
    },
  );

  app.delete(
    "/api/media/folders/:id",
    doc("Media", "Delete folder", "Deletes a folder; contained media moves to the root view."),
    (c) =>
      deleteMediaFolder(c.req.param("id"), sessionUser(c).id)
        ? c.json(ok({ deleted: true }))
        : fail("NOT_FOUND", "Folder not found", 404),
  );

  app.get(
    "/api/media/stats",
    doc("Media", "Media stats", "Storage usage and quota for the current user."),
    (c) => {
      const user = sessionUser(c);
      return c.json(
        ok({
          usedBytes: getMediaStorageBytes(user.id),
          quotaBytes: user.maxStorageBytes ?? null,
          mediaCount: countMedia(user.id),
        }),
      );
    },
  );

  app.get("/api/media/:id", doc("Media", "Read media", "Returns a single media record."), (c) => {
    const media = getMediaById(c.req.param("id"), sessionUser(c).id);
    return media ? c.json(ok(media)) : fail("NOT_FOUND", "Media not found", 404);
  });

  app.get(
    "/api/media/:id/thumbnail",
    doc(
      "Media",
      "Media thumbnail",
      "Serves the generated JPEG thumbnail; generates on first request for videos.",
    ),
    async (c) => {
      const media = getMediaById(c.req.param("id"), sessionUser(c).id);
      if (media?.mediaType !== "video") return fail("NOT_FOUND", "Thumbnail not available", 404);
      const thumbPath = mediaThumbPath(media.id);
      if (!existsSync(thumbPath)) {
        const generated = await generateThumbnail(mediaPath(media.fileName), thumbPath);
        if (generated) updateMediaMetadata(media.id, { hasThumb: true });
        if (!existsSync(thumbPath)) return fail("NOT_FOUND", "Thumbnail not available", 404);
      }
      const buffer = await import("node:fs/promises").then((fs) => fs.readFile(thumbPath));
      return c.body(buffer, 200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      });
    },
  );

  app.get(
    "/api/media/:id/content",
    doc("Media", "Stream content", "Streams the media binary payload (Range aware for seeking)."),
    (c) => {
      const media = getMediaById(c.req.param("id"), sessionUser(c).id);
      if (!media) return fail("NOT_FOUND", "Media not found", 404);
      const size = media.sizeBytes;
      const rangeHeader = c.req.header("range");
      const headers: Record<string, string> = {
        "Content-Type": media.mimeType,
        "Cache-Control": "private, max-age=3600",
        "Accept-Ranges": "bytes",
      };
      if (!rangeHeader) {
        headers["Content-Length"] = String(size);
        return c.body(toWebStream(mediaReadStream(media.fileName)), 200, headers);
      }
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (!match) return c.body(null, 416, { "Content-Range": `bytes */${size}`, ...headers });
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : size - 1;
      if (!match[1] && match[2]) {
        // suffix range "bytes=-N": last N bytes (sent by Safari on seek)
        start = Math.max(0, size - Number(match[2]));
        end = size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start >= size || start > end) {
        return c.body(null, 416, { "Content-Range": `bytes */${size}`, ...headers });
      }
      end = Math.min(end, size - 1);
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      headers["Content-Length"] = String(end - start + 1);
      return c.body(toWebStream(mediaReadStream(media.fileName, { start, end })), 206, headers);
    },
  );

  app.patch(
    "/api/media/:id",
    doc(
      "Media",
      "Update media",
      "Renames media or moves it to a folder (folderId: null for root).",
    ),
    async (c) => {
      const parsed = mediaPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid request body", 400);
      const userId = sessionUser(c).id;
      const folderId = parsed.data.folderId;
      if (folderId !== undefined && folderId !== null && !getMediaFolderById(folderId, userId))
        return fail("NOT_FOUND", "Folder not found", 404);
      const updated = updateMedia(c.req.param("id"), userId, { ...parsed.data, folderId });
      return updated ? c.json(ok(updated)) : fail("NOT_FOUND", "Media not found", 404);
    },
  );

  app.post(
    "/api/media",
    doc(
      "Media",
      "Upload media",
      "Uploads a raw binary body. Type is detected from content (magic bytes), not from the file name. Query: ?name=<display name>&folderId=<id|root>.",
    ),
    async (c) => {
      const user = sessionUser(c);
      const name = (c.req.query("name") ?? "").trim().slice(0, 200) || "Untitled media";
      const folder = resolveFolderId(c.req.query("folderId"), user.id);
      if (folder === "NOT_FOUND") return fail("NOT_FOUND", "Folder not found", 404);

      const declaredLength = Number(c.req.header("content-length") ?? "");
      const body = c.req.raw.body as AsyncIterable<Uint8Array> | null;
      if (!body) return fail("BAD_REQUEST", "Empty upload body", 400);
      try {
        const record = await persistStream(
          body,
          Number.isFinite(declaredLength) ? declaredLength : 0,
          user,
          name,
          folder === undefined || folder === "root" ? null : folder,
        );
        addEvent(
          user.id,
          "media",
          `Uploaded media "${name}" (${record.mediaType}, ${record.sizeBytes} bytes)`,
        );
        return c.json(ok(record), 201);
      } catch (error) {
        return uploadErrorResponse(error);
      }
    },
  );

  app.post(
    "/api/media/import-gdrive",
    doc(
      "Media",
      "Import from Google Drive",
      "Downloads a publicly shared Google Drive file into the library. Body: { url, name?, folderId? }.",
    ),
    async (c) => {
      const parsed = gdriveImportSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "A Google Drive share URL is required", 400);
      const user = sessionUser(c);
      const fileId = extractGDriveFileId(parsed.data.url);
      if (!fileId) return fail("BAD_REQUEST", "Not a valid Google Drive share URL", 400);

      const folderId = parsed.data.folderId ?? null;
      if (folderId && !getMediaFolderById(folderId, user.id))
        return fail("NOT_FOUND", "Folder not found", 404);

      try {
        const { response, fileName } = await resolveGDriveDownload(
          fileId,
          AbortSignal.timeout(gdriveTimeoutMs),
        );
        const body = response.body as AsyncIterable<Uint8Array> | null;
        if (!body) return fail("BAD_REQUEST", "Google Drive returned an empty file", 400);
        const name =
          parsed.data.name?.trim().slice(0, 200) ||
          fileName?.slice(0, 200) ||
          "Imported from Google Drive";
        const record = await persistStream(
          body,
          Number(response.headers.get("content-length") ?? "") || 0,
          user,
          name,
          folderId,
        );
        addEvent(
          user.id,
          "media",
          `Imported media "${name}" from Google Drive (${record.mediaType}, ${record.sizeBytes} bytes)`,
        );
        return c.json(ok(record), 201);
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError")
          return fail("import_timeout", "Google Drive import timed out", 504);
        if (error instanceof Error && error.message.startsWith("Google Drive"))
          return fail("import_failed", error.message, 502);
        return uploadErrorResponse(error);
      }
    },
  );

  app.delete(
    "/api/media/:id",
    doc("Media", "Delete media", "Deletes the record and its stored file."),
    (c) => {
      const deleted = deleteMediaById(c.req.param("id"), sessionUser(c).id);
      if (!deleted) return fail("NOT_FOUND", "Media not found", 404);
      addEvent(deleted.userId, "media", `Deleted media "${deleted.name}"`);
      return c.json(ok(deleted));
    },
  );

  registerChunkUploads(app);
}

interface ChunkUploadState {
  userId: string;
  name: string;
  folderId: string | null;
  size: number;
  bytesReceived: number;
  createdAt: number;
}

const chunkUploads = new Map<string, ChunkUploadState>();
const chunkUploadTtlMs = 24 * 60 * 60 * 1000;

function chunkUploadDir(): string {
  const dir = path.join(getMediaDir(), ".uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pruneStaleChunkUploads(): void {
  const now = Date.now();
  for (const [id, state] of chunkUploads) {
    if (now - state.createdAt > chunkUploadTtlMs) {
      chunkUploads.delete(id);
      try {
        rmSync(path.join(chunkUploadDir(), `${id}.part`), { force: true });
      } catch {
        // best effort
      }
    }
  }
  // sweep orphan .part files left behind by a restart (in-memory map was lost)
  try {
    for (const entry of readdirSync(chunkUploadDir())) {
      const full = path.join(chunkUploadDir(), entry);
      const stat = statSync(full);
      if (now - stat.mtimeMs > chunkUploadTtlMs) rmSync(full, { force: true });
    }
  } catch {
    // dir may not exist yet
  }
}

function registerChunkUploads(app: Hono): void {
  const initSchema = z.object({
    name: z.string().trim().min(1).max(200),
    size: z.number().int().positive(),
    folderId: z.string().nullable().optional(),
  });

  app.post(
    "/api/media/uploads/init",
    doc("Media", "Chunk init", "Starts a resumable chunked upload session."),
    async (c) => {
      const parsed = initSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid upload init body", 400);
      const user = sessionUser(c);
      const limit = maxUploadBytes();
      if (parsed.data.size > limit)
        return fail("payload_too_large", `Upload exceeds ${limit} bytes`, 413);
      const folderId = parsed.data.folderId ?? null;
      if (folderId && !getMediaFolderById(folderId, user.id))
        return fail("NOT_FOUND", "Folder not found", 404);
      try {
        assertStorageQuota(user.id, user.maxStorageBytes, parsed.data.size);
      } catch {
        return fail("QUOTA_STORAGE_EXCEEDED", "Upload exceeds storage quota", 413);
      }
      pruneStaleChunkUploads();
      const uploadId = `upl_${nanoid(12)}`;
      chunkUploads.set(uploadId, {
        userId: user.id,
        name: parsed.data.name,
        folderId,
        size: parsed.data.size,
        bytesReceived: 0,
        createdAt: Date.now(),
      });
      const partPath = path.join(chunkUploadDir(), `${uploadId}.part`);
      writeFileSync(partPath, "");
      return c.json(ok({ uploadId, chunkSize: 8 * 1024 * 1024 }));
    },
  );

  app.get(
    "/api/media/uploads/:id",
    doc("Media", "Chunk status", "Returns bytes received so far for a chunked upload."),
    (c) => {
      const state = chunkUploads.get(c.req.param("id"));
      if (!state || state.userId !== sessionUser(c).id)
        return fail("NOT_FOUND", "Upload session not found", 404);
      return c.json(ok({ bytesReceived: state.bytesReceived, size: state.size }));
    },
  );

  app.put(
    "/api/media/uploads/:id/chunk",
    doc("Media", "Chunk append", "Appends one raw octet-stream chunk at the given offset."),
    async (c) => {
      const uploadId = c.req.param("id");
      const state = chunkUploads.get(uploadId);
      if (!state || state.userId !== sessionUser(c).id)
        return fail("NOT_FOUND", "Upload session not found", 404);
      const offset = Number(c.req.query("offset") ?? "-1");
      if (offset !== state.bytesReceived) return fail("BAD_REQUEST", "Offset mismatch", 409);
      const body = c.req.raw.body;
      if (!body) return fail("BAD_REQUEST", "Empty chunk body", 400);
      let received = 0;
      const partPath = path.join(chunkUploadDir(), `${uploadId}.part`);
      try {
        for await (const chunk of body) {
          received += chunk.byteLength;
          if (state.bytesReceived + received > state.size)
            throw new UploadError("Chunk exceeds declared upload size", "BAD_REQUEST", 400);
          await appendFileAsync(partPath, chunk);
        }
      } catch (error) {
        chunkUploads.delete(uploadId);
        try {
          rmSync(partPath, { force: true });
        } catch {
          // best effort
        }
        return uploadErrorResponse(error);
      }
      state.bytesReceived += received;
      return c.json(ok({ bytesReceived: state.bytesReceived }));
    },
  );

  app.post(
    "/api/media/uploads/:id/complete",
    doc("Media", "Chunk complete", "Finalizes a chunked upload into a media record."),
    async (c) => {
      const uploadId = c.req.param("id");
      const state = chunkUploads.get(uploadId);
      if (!state || state.userId !== sessionUser(c).id)
        return fail("NOT_FOUND", "Upload session not found", 404);
      if (state.bytesReceived !== state.size) return fail("BAD_REQUEST", "Upload incomplete", 400);
      const partPath = path.join(chunkUploadDir(), `${uploadId}.part`);
      const discardSession = () => {
        chunkUploads.delete(uploadId);
        try {
          rmSync(partPath, { force: true });
        } catch {
          // best effort
        }
      };
      const fd = openSync(partPath, "r");
      const head = Buffer.alloc(headBytes);
      readSync(fd, head, 0, headBytes, 0);
      closeSync(fd);
      const sniff = sniffMedia(new Uint8Array(head));
      if (!sniff) {
        discardSession();
        return fail("unsupported_media_type", "Unsupported or unrecognized media type", 415);
      }
      const id = newMediaId();
      const fileName = `${id}.${sniff.ext}`;
      renameSync(partPath, mediaPath(fileName));
      chunkUploads.delete(uploadId);
      try {
        const record = insertMedia({
          id,
          userId: state.userId,
          folderId: state.folderId,
          name: state.name,
          mediaType: sniff.mediaType,
          mimeType: sniff.mimeType,
          fileName,
          sizeBytes: state.size,
        });
        addEvent(state.userId, "media", `Uploaded media "${state.name}" via chunked upload`);
        return c.json(ok(await enrichMedia(record)));
      } catch (error) {
        try {
          rmSync(mediaPath(fileName), { force: true });
        } catch {
          // best effort
        }
        throw error;
      }
    },
  );

  app.delete(
    "/api/media/uploads/:id",
    doc("Media", "Chunk abort", "Aborts a chunked upload session."),
    (c) => {
      const uploadId = c.req.param("id");
      const state = chunkUploads.get(uploadId);
      if (!state || state.userId !== sessionUser(c).id)
        return fail("NOT_FOUND", "Upload session not found", 404);
      chunkUploads.delete(uploadId);
      try {
        rmSync(path.join(chunkUploadDir(), `${uploadId}.part`), { force: true });
      } catch {
        // best effort
      }
      return c.json(ok({ aborted: true }));
    },
  );
}

const mediaPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().nullable().optional(),
});

const gdriveImportSchema = z.object({
  url: z.string().url(),
  name: z.string().trim().max(200).optional(),
  folderId: z.string().optional(),
});
