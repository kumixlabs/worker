/** Stream CRUD, start/stop, and bulk delete routes. */

import type { Hono } from "hono";
import { z } from "zod";

import { getSource } from "../../db/sources";
import { createStream, deleteStream, getStream, listStreams, patchStream } from "../../db/streams";
import { getTarget } from "../../db/targets";
import { parseUserDateTime } from "../../lib/timezone";
import { readSettings } from "../../runtime/config";
import { streamCreateSchema, streamPatchSchema } from "../../schemas/stream";
import { startStream, stopStream } from "../../services/stream-runner";
import { extractVideoId, fetchYouTubeAnalytics } from "../../services/youtube";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const bulkDeleteSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });

function requireParsedDateTime(
  value: string | null | undefined,
  field: string,
  timezone: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = parseUserDateTime(value, timezone);
  if (!parsed) throw new Error(`Invalid ${field}`);
  return parsed;
}

/**
 * Converts user-entered local datetimes into UTC ISO timestamps for persistence.
 *
 * @param input - Stream create or patch payload containing schedule fields.
 * @returns Payload with normalized schedule fields.
 */
function normalizeStreamSchedule<
  T extends { scheduledFor?: string | null; autoStopAt?: string | null; stoppedAt?: string | null },
>(input: T): T {
  const timezone = readSettings().timezone;
  return {
    ...input,
    autoStopAt: requireParsedDateTime(input.autoStopAt, "autoStopAt", timezone) as T["autoStopAt"],
    scheduledFor: requireParsedDateTime(
      input.scheduledFor,
      "scheduledFor",
      timezone,
    ) as T["scheduledFor"],
    stoppedAt: requireParsedDateTime(input.stoppedAt, "stoppedAt", timezone) as T["stoppedAt"],
  };
}

/**
 * Registers stream CRUD, start, and stop routes.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerStreamRoutes(app: Hono) {
  app.get(
    "/api/streams",
    doc("Streams", "List streams", "Lists stream jobs with source and target summaries."),
    (c) => c.json(ok(listStreams())),
  );

  app.post(
    "/api/streams",
    doc("Streams", "Create stream", "Creates a scheduled or manual stream job.", 201),
    async (c) => {
      const parsed = streamCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid stream");
      }
      if (!getSource(parsed.data.sourceId)) return fail("BAD_REQUEST", "Source not found");
      if (!getTarget(parsed.data.targetId)) return fail("BAD_REQUEST", "Target not found");
      try {
        return c.json(ok(createStream(normalizeStreamSchedule(parsed.data))), 201);
      } catch (error) {
        return fail("BAD_REQUEST", error instanceof Error ? error.message : "Invalid schedule");
      }
    },
  );

  app.delete(
    "/api/streams",
    doc("Streams", "Delete streams", "Deletes multiple stream jobs."),
    async (c) => {
      const parsed = bulkDeleteSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid stream ids");
      const deleted: string[] = [];
      const failed: { id: string; message: string }[] = [];
      for (const id of parsed.data.ids) {
        try {
          if (deleteStream(id)) deleted.push(id);
          else failed.push({ id, message: "Stream not found" });
        } catch (error) {
          failed.push({
            id,
            message: error instanceof Error ? error.message : "Stream is running",
          });
        }
      }
      return c.json(ok({ deleted, failed }));
    },
  );

  app.get("/api/streams/:id", doc("Streams", "Read stream", "Returns one stream job."), (c) => {
    const stream = getStream(c.req.param("id"));
    if (!stream) return fail("NOT_FOUND", "Stream not found", 404);
    return c.json(ok(stream));
  });

  app.get(
    "/api/streams/:id/analytics",
    doc(
      "Streams",
      "Stream analytics",
      "Returns YouTube live stream analytics (concurrent viewers, views, likes).",
    ),
    async (c) => {
      const stream = getStream(c.req.param("id"));
      if (!stream) return fail("NOT_FOUND", "Stream not found", 404);
      if (!stream.youtubeLiveUrl) {
        return fail("BAD_REQUEST", "This stream has no YouTube live URL configured");
      }
      const videoId = extractVideoId(stream.youtubeLiveUrl);
      if (!videoId) {
        return fail("BAD_REQUEST", "Could not extract a valid YouTube video ID from the URL");
      }
      const apiKey = readSettings().youtubeApiKey;
      if (!apiKey) {
        return fail("BAD_REQUEST", "YouTube Data API key is not configured. Add it in Settings.");
      }
      try {
        const analytics = await fetchYouTubeAnalytics(videoId, apiKey);
        return c.json(ok(analytics));
      } catch (error) {
        return fail(
          "BAD_REQUEST",
          error instanceof Error ? error.message : "Failed to fetch YouTube analytics",
        );
      }
    },
  );

  app.patch(
    "/api/streams/:id",
    doc(
      "Streams",
      "Update stream",
      "Updates stream title, source, target, recurrence, or schedule.",
    ),
    async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = streamPatchSchema.safeParse(raw);
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid stream");
      }
      const current = getStream(c.req.param("id"));
      if (!current) return fail("NOT_FOUND", "Stream not found", 404);
      const isRunning = current.status === "running" || current.status === "stopping";
      const sentKeys = new Set(Object.keys(raw ?? {}));
      const onlyYoutubeUrl =
        sentKeys.size > 0 && [...sentKeys].every((k) => k === "youtubeLiveUrl");
      if (isRunning && !onlyYoutubeUrl) {
        return fail("CONFLICT", "Cannot update a running or stopping stream", 409);
      }
      let updated;
      try {
        updated = patchStream(c.req.param("id"), normalizeStreamSchedule(parsed.data));
      } catch (error) {
        return fail("BAD_REQUEST", error instanceof Error ? error.message : "Invalid schedule");
      }
      return c.json(ok(updated));
    },
  );

  app.post(
    "/api/streams/:id/start",
    doc("Streams", "Start stream", "Starts FFmpeg for a stream job."),
    async (c) => {
      try {
        return c.json(ok(await startStream(c.req.param("id"))));
      } catch (error) {
        return fail(
          "BAD_REQUEST",
          error instanceof Error ? error.message : "Unable to start stream",
        );
      }
    },
  );

  app.post(
    "/api/streams/:id/stop",
    doc("Streams", "Stop stream", "Stops a running stream job."),
    (c) => c.json(ok(stopStream(c.req.param("id")))),
  );

  app.delete(
    "/api/streams/:id",
    doc("Streams", "Delete stream", "Deletes a stopped stream job."),
    (c) => {
      try {
        return c.json(ok(deleteStream(c.req.param("id"))));
      } catch (error) {
        return fail("CONFLICT", error instanceof Error ? error.message : "Stream is running", 409);
      }
    },
  );
}
