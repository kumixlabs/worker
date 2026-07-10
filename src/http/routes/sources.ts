import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

import type { Hono } from "hono";
import { z } from "zod";

import { addEvent } from "../../db/events";
import {
  createSource,
  deleteSource,
  getSource,
  listSources,
  updateSourceProbe,
} from "../../db/sources";
import { createSignedUrl } from "../../lib/signed-url";
import { sourceCreateSchema } from "../../schemas/source";
import { probeAndUpdateSource } from "../../services/probe";
import { downloadAndProbeSource } from "../../services/source-downloader";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const bulkDeleteSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });

const previewContentTypes: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".ogg": "video/ogg",
  ".ogv": "video/ogg",
};

function previewContentType(filePath: string): string {
  return previewContentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Registers source CRUD, download, and probe routes.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerSourceRoutes(app: Hono) {
  app.get(
    "/api/sources",
    doc("Sources", "List sources", "Lists direct URL and Google Drive source records."),
    (c) => c.json(ok(listSources())),
  );

  app.post(
    "/api/sources",
    doc(
      "Sources",
      "Create source",
      "Registers a direct URL or Google Drive source, then downloads and probes it.",
      201,
    ),
    async (c) => {
      const parsed = sourceCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid source");
      }
      const created = createSource(parsed.data);
      console.log(`[worker] Start processing source: ${created.name} (${created.id})`);
      void downloadAndProbeSource(created.id)
        .then((result) => {
          if (result?.status === "invalid") {
            console.error(`[worker] Source ${created.id} invalid: ${result.invalidReason}`);
          } else if (result?.status === "ready") {
            console.log(`[worker] Source ${created.id} is ready for streaming`);
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Download failed";
          console.error(`[worker] Source ${created.id} failed: ${message}`);
          updateSourceProbe(created.id, { status: "invalid", invalidReason: message });
          addEvent(null, "source_download_failed", `Source download failed: ${created.name}`, {
            sourceId: created.id,
            message,
          });
        });
      return c.json(ok(created), 201);
    },
  );

  app.delete(
    "/api/sources",
    doc("Sources", "Delete sources", "Deletes multiple source records."),
    async (c) => {
      const parsed = bulkDeleteSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid source ids");
      const deleted: string[] = [];
      const failed: { id: string; message: string }[] = [];
      for (const id of parsed.data.ids) {
        try {
          deleteSource(id);
          deleted.push(id);
        } catch (error) {
          failed.push({ id, message: error instanceof Error ? error.message : "Source is in use" });
        }
      }
      return c.json(ok({ deleted, failed }));
    },
  );

  app.post(
    "/api/sources/:id/probe",
    doc(
      "Sources",
      "Probe source",
      "Runs FFprobe against a local source and updates media metadata.",
    ),
    async (c) => {
      const source = getSource(c.req.param("id"));
      if (!source?.filePath) return fail("NOT_FOUND", "Source file not found", 404);
      return c.json(ok(await probeAndUpdateSource(source.id, source.filePath)));
    },
  );

  app.post(
    "/api/sources/:id/preview-url",
    doc(
      "Sources",
      "Create signed preview URL",
      "Creates a short-lived signed URL the browser can use to stream the cached source video.",
    ),
    (c) => {
      const source = getSource(c.req.param("id"));
      if (source?.status !== "ready" || !source.filePath) {
        return fail("NOT_FOUND", "Source is not ready for preview", 404);
      }
      return c.json(ok({ url: createSignedUrl(`/api/sources/${source.id}/preview`, "GET") }));
    },
  );

  app.get(
    "/api/sources/:id/preview",
    doc(
      "Sources",
      "Preview source",
      "Streams the cached source video with HTTP range support for in-dashboard playback.",
    ),
    async (c) => {
      const source = getSource(c.req.param("id"));
      if (source?.status !== "ready" || !source.filePath) {
        return fail("NOT_FOUND", "Source is not ready for preview", 404);
      }
      const stats = await stat(source.filePath).catch(() => null);
      if (!stats?.isFile()) return fail("NOT_FOUND", "Source file not found", 404);

      const total = stats.size;
      const contentType = previewContentType(source.filePath);
      const range = c.req.header("range");
      const match = range?.match(/^bytes=(\d*)-(\d*)$/);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${total}`, "accept-ranges": "bytes" },
          });
        }
        const stream = Readable.toWeb(
          createReadStream(source.filePath, { start, end }),
        ) as unknown as ReadableStream;
        return new Response(stream, {
          status: 206,
          headers: {
            "content-type": contentType,
            "content-length": String(end - start + 1),
            "content-range": `bytes ${start}-${end}/${total}`,
            "accept-ranges": "bytes",
            "cache-control": "private, no-store",
          },
        });
      }

      const stream = Readable.toWeb(createReadStream(source.filePath)) as unknown as ReadableStream;
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": contentType,
          "content-length": String(total),
          "accept-ranges": "bytes",
          "cache-control": "private, no-store",
        },
      });
    },
  );

  app.delete(
    "/api/sources/:id",
    doc("Sources", "Delete source", "Deletes a source record."),
    (c) => {
      try {
        return c.json(ok(deleteSource(c.req.param("id"))));
      } catch (error) {
        return fail("CONFLICT", error instanceof Error ? error.message : "Source is in use", 409);
      }
    },
  );
}
