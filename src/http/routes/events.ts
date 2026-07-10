/** Event listing, export, signed URL, and SSE routes. */

import type { Hono } from "hono";

import { clearEvents, listEvents, onEvent } from "../../db/events";
import { createSignedUrl } from "../../lib/signed-url";
import { safeFilenamePart } from "../../lib/utils";
import { onStreamEvent } from "../../services/stream-runner";
import { fail, ok } from "../middleware";
import { doc } from "./common";

/**
 * Formats recent events as a plain-text export body.
 *
 * @param streamId - Optional stream ID to scope the export.
 * @returns Newline-separated event log text.
 */
function formatEventsText(streamId?: string) {
  return listEvents(streamId)
    .map((event) => {
      const stream = event.streamId ? ` stream=${event.streamId}` : "";
      return `[${event.createdAt}] ${event.kind}${stream} ${event.message}`;
    })
    .join("\n");
}

/**
 * Checks whether an event export/SSE path may receive a signed browser URL.
 *
 * @param path - Requested path to sign.
 * @returns True when the path is an allowed event endpoint.
 */
function allowedSignedPath(path: string): boolean {
  try {
    const url = new URL(path, "http://worker.local");
    if (url.origin !== "http://worker.local") return false;
    if (url.pathname === "/api/events/export" || url.pathname === "/api/events/stream") {
      return true;
    }
    return /^\/api\/streams\/[A-Za-z0-9_-]+\/events\/(export|stream)$/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Creates a server-sent events stream for global or stream-specific events.
 *
 * @param streamId - Optional stream ID to scope events.
 * @returns Readable stream that emits SSE frames.
 */
function sseResponse(streamId?: string) {
  let off: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          off?.();
          off = null;
        }
      };
      send({ type: "hello", ...(streamId ? { streamId } : {}) });
      off = streamId ? onStreamEvent(streamId, send) : onEvent(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          off?.();
          off = null;
        }
      }, 15_000);
      heartbeat.unref?.();
    },
    cancel() {
      off?.();
      off = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  });
}

/**
 * Registers event listing, export, clear, and SSE routes.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerEventRoutes(app: Hono) {
  app.post(
    "/api/events/signed-url",
    doc(
      "Events",
      "Create signed event URL",
      "Creates a short-lived signed URL for event export or SSE.",
    ),
    async (c) => {
      const body = (await c.req.json().catch(() => null)) as { path?: string } | null;
      const path = body?.path;
      if (!path || !allowedSignedPath(path)) return fail("BAD_REQUEST", "Invalid signed URL path");
      return c.json(ok({ url: createSignedUrl(path, "GET") }));
    },
  );

  app.get(
    "/api/streams/:id/events",
    doc("Events", "List stream events", "Lists events for one stream."),
    (c) => c.json(ok(listEvents(c.req.param("id")))),
  );

  app.get(
    "/api/streams/:id/events/export",
    doc("Events", "Export stream events", "Exports stream events as a text attachment."),
    (c) =>
      new Response(formatEventsText(c.req.param("id")), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="kumix-worker-stream-${safeFilenamePart(c.req.param("id"))}-events-${Date.now()}.txt"`,
        },
      }),
  );

  app.get(
    "/api/streams/:id/events/stream",
    doc(
      "Events",
      "Stream stream events",
      "Streams live FFmpeg and status events for one stream over SSE.",
    ),
    (c) =>
      new Response(sseResponse(c.req.param("id")), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      }),
  );

  app.get("/api/events", doc("Events", "List events", "Lists recent worker events."), (c) =>
    c.json(ok(listEvents())),
  );

  app.delete(
    "/api/events",
    doc("Events", "Clear events", "Deletes all stored worker events."),
    (c) => c.json(ok({ deleted: clearEvents() })),
  );

  app.get(
    "/api/events/export",
    doc("Events", "Export events", "Exports recent events as a text attachment."),
    () =>
      new Response(formatEventsText(), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="kumix-worker-events-${Date.now()}.txt"`,
        },
      }),
  );

  app.get(
    "/api/events/stream",
    doc("Events", "Stream global events", "Streams global worker events over SSE."),
    () =>
      new Response(sseResponse(), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      }),
  );
}
