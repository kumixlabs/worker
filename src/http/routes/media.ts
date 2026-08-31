/**
 * Media library endpoints: list, detail, content stream, upload, delete.
 */

import { renameSync, rmSync, statSync } from "node:fs";

import type { Hono } from "hono";

import { addEvent } from "../../db/events";
import {
  deleteMediaById,
  getMediaById,
  insertMedia,
  listMedia,
  mediaPath,
  mediaReadStream,
  newMediaId,
  openTempMediaFile,
} from "../../db/media";
import { sniffMedia } from "../../lib/sniff";
import { toWebStream } from "../../lib/utils";
import { assertStorageQuota } from "../../services/quota";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const headBytes = 64;
const maxUploadBytesDefault = 2 * 1024 * 1024 * 1024;

type SessionUser = {
  id: string;
  role?: string;
  maxStorageBytes?: number | null;
};

function sessionUser(c: { get: (key: string) => unknown }): SessionUser {
  return c.get("user") as SessionUser;
}

export function registerMediaRoutes(app: Hono) {
  app.get(
    "/api/media",
    doc("Media", "List media", "Returns the current user's uploaded media, newest first."),
    (c) => c.json(ok(listMedia(sessionUser(c).id))),
  );

  app.get("/api/media/:id", doc("Media", "Read media", "Returns a single media record."), (c) => {
    const media = getMediaById(c.req.param("id"), sessionUser(c).id);
    return media ? c.json(ok(media)) : fail("NOT_FOUND", "Media not found", 404);
  });

  app.get(
    "/api/media/:id/content",
    doc("Media", "Stream content", "Streams the media binary payload."),
    (c) => {
      const media = getMediaById(c.req.param("id"), sessionUser(c).id);
      if (!media) return fail("NOT_FOUND", "Media not found", 404);
      // ponytail: no Range support yet — <video> seeking breaks; add when the
      // gallery player needs it.
      return c.body(toWebStream(mediaReadStream(media.fileName)), 200, {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.sizeBytes),
        "Cache-Control": "private, max-age=3600",
      });
    },
  );

  app.post(
    "/api/media",
    doc(
      "Media",
      "Upload media",
      "Uploads a raw binary body. Type is detected from content (magic bytes), not from the file name. Query: ?name=<display name>.",
    ),
    async (c) => {
      const user = sessionUser(c);
      const name = (c.req.query("name") ?? "").trim().slice(0, 200) || "Untitled media";
      const maxUpload = Number(process.env.KUMIX_WORKER_MAX_UPLOAD_BYTES) || maxUploadBytesDefault;

      const declaredLength = Number(c.req.header("content-length") ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > maxUpload)
        return fail("payload_too_large", `Upload exceeds ${maxUpload} bytes`, 413);
      if (declaredLength === 0) return fail("BAD_REQUEST", "Empty upload body", 400);
      if (Number.isFinite(declaredLength) && declaredLength > 0) {
        try {
          assertStorageQuota(user.id, user.maxStorageBytes, declaredLength);
        } catch {
          return fail("QUOTA_STORAGE_EXCEEDED", "Upload exceeds storage quota", 413);
        }
      }

      const id = newMediaId();
      const { tempPath, writeStream } = openTempMediaFile(id);
      let total = 0;
      let head = new Uint8Array(0);
      try {
        const body = c.req.raw.body;
        if (!body) return fail("BAD_REQUEST", "Empty upload body", 400);
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          total += chunk.byteLength;
          if (total > maxUpload) throw new Error("payload_too_large");
          if (user.maxStorageBytes != null) {
            assertStorageQuota(user.id, user.maxStorageBytes, total);
          }
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

        const sniff = sniffMedia(head);
        if (!sniff) throw new Error("unsupported_media_type");
        if (total === 0) throw new Error("payload_too_large");

        const fileName = `${id}.${sniff.ext}`;
        renameSync(tempPath, mediaPath(fileName));
        const record = insertMedia({
          id,
          userId: user.id,
          name,
          mediaType: sniff.mediaType,
          mimeType: sniff.mimeType,
          fileName,
          sizeBytes: statSync(mediaPath(fileName)).size,
        });
        addEvent(
          user.id,
          "media",
          `Uploaded media "${name}" (${sniff.mediaType}, ${record.sizeBytes} bytes)`,
        );
        return c.json(ok(record), 201);
      } catch (error) {
        writeStream.destroy();
        try {
          rmSync(tempPath, { force: true });
        } catch {
          // best effort cleanup
        }
        const code = (error as Error).message;
        if (code === "payload_too_large")
          return fail("payload_too_large", "Upload exceeds size limit", 413);
        if (code === "unsupported_media_type")
          return fail("unsupported_media_type", "Unsupported or unrecognized media type", 415);
        if ((error as { code?: string }).code === "QUOTA_STORAGE_EXCEEDED")
          return fail("QUOTA_STORAGE_EXCEEDED", "Upload exceeds storage quota", 413);
        throw error;
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
}
