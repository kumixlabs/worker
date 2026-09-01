/**
 * Stream endpoints: CRUD plus start/stop and log tail.
 * target_url is write-only; responses never include it.
 */

import { open as openFile, stat } from "node:fs/promises";

import type { Hono } from "hono";
import { z } from "zod";

import { addEvent } from "../../db/events";
import { getPlaylistById } from "../../db/playlists";
import {
  deleteStream,
  getStreamById,
  insertStream,
  listStreams,
  updateStream,
} from "../../db/streams";
import { encryptSecret } from "../../lib/crypto";
import { scheduleFromInput } from "../../runtime/scheduler";
import { assertStreamQuota } from "../../services/quota";
import { StreamStartError, startStream, stopStream } from "../../services/stream-runner";
import { fail, ok } from "../middleware";
import { doc } from "./common";

function sessionUserId(c: { get: (key: string) => unknown }): string {
  return (c.get("user") as { id: string }).id;
}

function sessionQuota(c: { get: (key: string) => unknown }): number | null {
  return (c.get("user") as { maxStreams?: number | null }).maxStreams ?? null;
}

const scheduleSchema = z.object({
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM"),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  day: z.number().int().min(1).max(31).optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
});

const streamCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  playlistId: z.string().min(1),
  targetUrl: z
    .string()
    .trim()
    .url()
    .regex(/^rtmps?:\/\//i, "Must be an rtmp:// or rtmps:// URL"),
  shuffle: z.boolean().optional(),
  loop: z.boolean().optional(),
  schedule: scheduleSchema.optional(),
});

const streamPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  playlistId: z.string().min(1).optional(),
  targetUrl: z
    .string()
    .trim()
    .url()
    .regex(/^rtmps?:\/\//i, "Must be an rtmp:// or rtmps:// URL")
    .optional(),
  shuffle: z.boolean().optional(),
  loop: z.boolean().optional(),
  schedule: scheduleSchema.nullable().optional(),
});

function startErrorResponse(error: unknown) {
  if (error instanceof StreamStartError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "ALREADY_RUNNING" ? 409 : 400;
    return fail("STREAM_START_FAILED", error.message, status);
  }
  if ((error as { code?: string }).code === "QUOTA_STREAMS_EXCEEDED")
    return fail("QUOTA_STREAMS_EXCEEDED", (error as Error).message, 403);
  throw error;
}

export function registerStreamRoutes(app: Hono): void {
  app.get(
    "/api/streams",
    doc(
      "Streams",
      "List streams",
      "Returns current user's streams. Target URLs are never returned.",
    ),
    (c) => c.json(ok(listStreams(sessionUserId(c)))),
  );

  app.post(
    "/api/streams",
    doc("Streams", "Create stream", "Creates a stopped stream from a playlist to an RTMP target."),
    async (c) => {
      const userId = sessionUserId(c);
      const parsed = streamCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid request body", 400);
      const playlist = getPlaylistById(parsed.data.playlistId, userId);
      if (!playlist) return fail("NOT_FOUND", "Playlist not found", 404);
      const record = insertStream({
        userId,
        playlistId: parsed.data.playlistId,
        name: parsed.data.name,
        targetUrl: encryptSecret(parsed.data.targetUrl),
        shuffle: parsed.data.shuffle ?? false,
        loop: parsed.data.loop ?? true,
        ...(parsed.data.schedule ? scheduleFromInput(parsed.data.schedule) : {}),
      });
      addEvent(userId, "stream", `Created stream "${record.name}"`);
      return c.json(ok({ ...record, targetUrl: "" }), 201);
    },
  );

  app.patch(
    "/api/streams/:id",
    doc("Streams", "Update stream", "Updates a stream while it is not running."),
    async (c) => {
      const userId = sessionUserId(c);
      const current = getStreamById(c.req.param("id"), userId);
      if (!current) return fail("NOT_FOUND", "Stream not found", 404);
      if (current.status === "running")
        return fail("CONFLICT", "Stop the stream before editing", 409);
      const parsed = streamPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid request body", 400);
      if (parsed.data.playlistId && !getPlaylistById(parsed.data.playlistId, userId))
        return fail("NOT_FOUND", "Playlist not found", 404);
      const record = updateStream(current.id, userId, {
        name: parsed.data.name,
        targetUrl: parsed.data.targetUrl ? encryptSecret(parsed.data.targetUrl) : undefined,
        shuffle: parsed.data.shuffle,
        loop: parsed.data.loop,
        playlistId: parsed.data.playlistId,
        ...(parsed.data.schedule !== undefined
          ? parsed.data.schedule
            ? scheduleFromInput(parsed.data.schedule)
            : {
                recurrence: "none" as const,
                recurrenceRule: null,
                scheduledFor: null,
                autoStopAt: null,
              }
          : {}),
      });
      addEvent(userId, "stream", `Updated stream "${record?.name ?? current.name}"`);
      return c.json(ok({ ...(record ?? current), targetUrl: "" }));
    },
  );

  app.delete(
    "/api/streams/:id",
    doc("Streams", "Delete stream", "Deletes a stopped stream."),
    (c) => {
      const userId = sessionUserId(c);
      const stream = getStreamById(c.req.param("id"), userId);
      if (!stream) return fail("NOT_FOUND", "Stream not found", 404);
      if (stream.status === "running") return fail("CONFLICT", "Stop the stream first", 409);
      deleteStream(stream.id, userId);
      addEvent(userId, "stream", `Deleted stream "${stream.name}"`);
      return c.json(ok({ deleted: true }));
    },
  );

  app.post(
    "/api/streams/:id/start",
    doc("Streams", "Start stream", "Spawns FFmpeg to push the playlist to the RTMP target."),
    async (c) => {
      const userId = sessionUserId(c);
      try {
        assertStreamQuota(userId, sessionQuota(c));
        const record = await startStream(userId, c.req.param("id"));
        addEvent(userId, "stream", `Started stream "${record.name}"`);
        return c.json(ok({ ...record, targetUrl: "" }));
      } catch (error) {
        return startErrorResponse(error);
      }
    },
  );

  app.post(
    "/api/streams/:id/stop",
    doc("Streams", "Stop stream", "Signals FFmpeg to stop and marks the stream stopped."),
    async (c) => {
      const userId = sessionUserId(c);
      try {
        const record = await stopStream(userId, c.req.param("id"));
        addEvent(userId, "stream", `Stopped stream "${record.name}"`);
        return c.json(ok({ ...record, targetUrl: "" }));
      } catch (error) {
        return startErrorResponse(error);
      }
    },
  );

  app.get(
    "/api/streams/:id/log",
    doc("Streams", "Stream log tail", "Returns the last bytes of the FFmpeg log."),
    async (c) => {
      const userId = sessionUserId(c);
      const stream = getStreamById(c.req.param("id"), userId);
      if (!stream) return fail("NOT_FOUND", "Stream not found", 404);
      if (!stream.logPath) return c.json(ok({ log: "" }));
      try {
        const info = await stat(stream.logPath);
        const handle = await openFile(stream.logPath, "r");
        const length = Math.min(64 * 1024, info.size);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, Math.max(0, info.size - length));
        await handle.close();
        return c.json(ok({ log: buffer.toString("utf8") }));
      } catch {
        return c.json(ok({ log: "" }));
      }
    },
  );
}
