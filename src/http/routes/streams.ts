/** Stream CRUD, start/stop, and bulk delete routes. */

import type { Hono } from "hono";
import { z } from "zod";

import { getAuthDb } from "../../auth/server";
import { getStreamBytes } from "../../db/bandwidth";
import { getSource } from "../../db/sources";
import { createStream, deleteStream, getStream, listStreams, patchStream } from "../../db/streams";
import { getTarget } from "../../db/targets";
import { getYoutubeConnection } from "../../db/youtube";
import { parseUserDateTime } from "../../lib/timezone";
import { readSettings } from "../../runtime/config";
import { streamCreateSchema, streamPatchSchema } from "../../schemas/stream";
import { assertStreamQuota } from "../../services/quota";
import { startStream, stopStream } from "../../services/stream-runner";
import { extractVideoId, fetchYouTubeAnalytics } from "../../services/youtube";
import { getValidAccessToken } from "../../services/youtube-oauth";
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
    (c) => {
      const user = c.get("user");
      const list = user?.role === "admin" ? listStreams() : listStreams(user?.id);
      return c.json(ok(list));
    },
  );

  app.post(
    "/api/streams",
    doc("Streams", "Create stream", "Creates a scheduled or manual stream job.", 201),
    async (c) => {
      const user = c.get("user");
      const parsed = streamCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid stream");
      }
      try {
        assertStreamQuota(user?.id, user?.maxStreams);
      } catch (error) {
        return fail("QUOTA_STREAMS_EXCEEDED", (error as Error).message, 422);
      }
      const source = getSource(parsed.data.sourceId);
      if (!source) return fail("BAD_REQUEST", "Source not found");
      if (source.status !== "ready") return fail("BAD_REQUEST", "Source is not ready");

      if (parsed.data.mode === "youtube") {
        const connection = parsed.data.youtubeConnectionId
          ? getYoutubeConnection(parsed.data.youtubeConnectionId)
          : null;
        if (!connection) {
          return fail("BAD_REQUEST", "YouTube connection is required for YouTube mode");
        }
        if (user?.role !== "admin" && connection.userId !== user?.id) {
          return fail("BAD_REQUEST", "YouTube connection not found");
        }
      } else {
        if (!parsed.data.targetId || !getTarget(parsed.data.targetId)) {
          return fail("BAD_REQUEST", "Target not found");
        }
      }
      if (parsed.data.sourceId && user?.role !== "admin" && source.userId) {
        if (source.userId !== user?.id) return fail("BAD_REQUEST", "Source not found");
      }
      if (parsed.data.targetId && user?.role !== "admin") {
        const target = getTarget(parsed.data.targetId);
        if (!target || (target.userId && target.userId !== user?.id)) {
          return fail("BAD_REQUEST", "Target not found");
        }
      }

      try {
        return c.json(ok(createStream(normalizeStreamSchedule(parsed.data), user?.id)), 201);
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
      const user = c.get("user");
      const deleted: string[] = [];
      const failed: { id: string; message: string }[] = [];
      for (const id of parsed.data.ids) {
        if (user?.role !== "admin") {
          const target = getStream(id);
          if (!target || (target.userId && target.userId !== user?.id)) {
            failed.push({ id, message: "Stream not found" });
            continue;
          }
        }
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
    const user = c.get("user");
    const stream = getStream(c.req.param("id"));
    if (!stream) return fail("NOT_FOUND", "Stream not found", 404);
    if (user?.role !== "admin" && stream.userId && stream.userId !== user?.id) {
      return fail("NOT_FOUND", "Stream not found", 404);
    }
    stream.bytesSent = getStreamBytes(stream.id);
    return c.json(ok(stream));
  });

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
      const user = c.get("user");
      const current = getStream(c.req.param("id"));
      if (!current) return fail("NOT_FOUND", "Stream not found", 404);
      if (user?.role !== "admin" && current.userId && current.userId !== user?.id) {
        return fail("NOT_FOUND", "Stream not found", 404);
      }
      const isRunning = current.status === "running" || current.status === "stopping";
      const sentKeys = new Set(Object.keys(raw ?? {}));
      const onlyYoutubeUrl =
        sentKeys.size > 0 && [...sentKeys].every((k) => k === "youtubeLiveUrl");
      if (isRunning && !onlyYoutubeUrl) {
        return fail("CONFLICT", "Cannot update a running or stopping stream", 409);
      }
      if (parsed.data.sourceId !== undefined) {
        const source = getSource(parsed.data.sourceId);
        if (!source) return fail("BAD_REQUEST", "Source not found");
        if (source.status !== "ready") return fail("BAD_REQUEST", "Source is not ready");
      }
      if (parsed.data.targetId !== undefined && !getTarget(parsed.data.targetId)) {
        return fail("BAD_REQUEST", "Target not found");
      }
      if (parsed.data.youtubeConnectionId !== undefined) {
        const connection = getYoutubeConnection(parsed.data.youtubeConnectionId);
        if (!connection) return fail("BAD_REQUEST", "YouTube connection not found");
        if (user?.role !== "admin" && connection.userId !== user?.id) {
          return fail("BAD_REQUEST", "YouTube connection not found");
        }
      }
      const merged = { ...current, ...parsed.data };
      if (merged.mode === "rtmp" && !merged.targetId) {
        return fail("BAD_REQUEST", "Target is required for RTMP mode");
      }
      if (merged.mode === "youtube" && !merged.youtubeConnectionId) {
        return fail("BAD_REQUEST", "YouTube channel connection is required for YouTube mode");
      }
      let updated;
      try {
        updated = patchStream(c.req.param("id"), normalizeStreamSchedule(parsed.data));
      } catch (error) {
        return fail("BAD_REQUEST", error instanceof Error ? error.message : "Invalid schedule");
      }
      if (!updated) return fail("NOT_FOUND", "Stream not found", 404);
      return c.json(ok(updated));
    },
  );

  app.post(
    "/api/streams/:id/start",
    doc("Streams", "Start stream", "Starts FFmpeg for a stream job."),
    async (c) => {
      const user = c.get("user");
      const current = getStream(c.req.param("id"));
      if (!current) return fail("NOT_FOUND", "Stream not found", 404);
      if (user?.role !== "admin" && current.userId && current.userId !== user?.id) {
        return fail("NOT_FOUND", "Stream not found", 404);
      }
      try {
        // Admin starting someone else's stream must respect the owner's quota, not the admin's.
        const quotaUserId = current.userId ?? user?.id;
        let quotaMax = user?.maxStreams;
        if (current.userId && current.userId !== user?.id) {
          const owner = getAuthDb()
            .prepare("SELECT maxStreams FROM user WHERE id = ?")
            .get(current.userId) as { maxStreams: number | null } | undefined;
          quotaMax = owner?.maxStreams ?? null;
        }
        assertStreamQuota(quotaUserId, quotaMax);
        const started = await startStream(c.req.param("id"));
        if (!started) return fail("NOT_FOUND", "Stream not found", 404);
        return c.json(ok(started));
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
    (c) => {
      const user = c.get("user");
      const current = getStream(c.req.param("id"));
      if (!current) return fail("NOT_FOUND", "Stream not found", 404);
      if (user?.role !== "admin" && current.userId && current.userId !== user?.id) {
        return fail("NOT_FOUND", "Stream not found", 404);
      }
      const stopped = stopStream(c.req.param("id"));
      if (!stopped) return fail("NOT_FOUND", "Stream not found", 404);
      return c.json(ok(stopped));
    },
  );

  app.delete(
    "/api/streams/:id",
    doc("Streams", "Delete stream", "Deletes a stopped stream job."),
    (c) => {
      const user = c.get("user");
      const current = getStream(c.req.param("id"));
      if (!current) return fail("NOT_FOUND", "Stream not found", 404);
      if (user?.role !== "admin" && current.userId && current.userId !== user?.id) {
        return fail("NOT_FOUND", "Stream not found", 404);
      }
      try {
        return c.json(ok(deleteStream(c.req.param("id"))));
      } catch (error) {
        return fail("CONFLICT", error instanceof Error ? error.message : "Stream is running", 409);
      }
    },
  );

  app.get(
    "/api/streams/:id/analytics",
    doc("Streams", "Get stream analytics", "Fetches live streaming metrics from YouTube."),
    async (c) => {
      const user = c.get("user");
      const current = getStream(c.req.param("id"));
      if (!current) return fail("NOT_FOUND", "Stream not found", 404);
      if (user?.role !== "admin" && current.userId && current.userId !== user?.id) {
        return fail("NOT_FOUND", "Stream not found", 404);
      }
      if (!current.youtubeLiveUrl && !current.ytVideoId) {
        return fail("BAD_REQUEST", "No YouTube live URL or video ID attached to this stream");
      }
      const videoId = current.ytVideoId || extractVideoId(current.youtubeLiveUrl ?? "");
      if (!videoId) return fail("BAD_REQUEST", "Invalid YouTube video ID");

      try {
        if (!current.youtubeConnectionId) {
          return fail("BAD_REQUEST", "No YouTube connection attached for authentication");
        }
        const accessToken = await getValidAccessToken(current.youtubeConnectionId);
        const analytics = await fetchYouTubeAnalytics(videoId, accessToken);
        return c.json(ok(analytics));
      } catch (error) {
        return fail(
          "SERVICE_UNAVAILABLE",
          error instanceof Error ? error.message : "YouTube API unavailable",
          503,
        );
      }
    },
  );
}
