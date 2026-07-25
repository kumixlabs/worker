/** Event listing, export, signed URL, and SSE routes. */

import type { Hono } from "hono";

import { clearEvents, listEvents, onEvent } from "../../db/events";
import { createSignedUrl } from "../../lib/signed-url";
import { safeFilenamePart } from "../../lib/utils";
import { onStreamEvent } from "../../services/stream-runner";
import { fail, ok } from "../middleware";
import { doc } from "./common";

function parseCursor(value: string | undefined): { createdAt: string; id: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: string;
      id?: string;
    };
    return parsed.createdAt && parsed.id
      ? { createdAt: parsed.createdAt, id: parsed.id }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Formats recent events as a plain-text export body.
 *
 * @param streamId - Optional stream ID to scope the export.
 * @returns Newline-separated event log text.
 */
function formatEventsText(streamId?: string) {
  const lines: string[] = [];
  let before: { createdAt: string; id: string } | undefined;
  for (;;) {
    const batch = listEvents(streamId, 500, before);
    if (batch.length === 0) break;
    for (const event of batch) {
      const stream = event.streamId ? ` stream=${event.streamId}` : "";
      lines.push(`[${event.createdAt}] ${event.kind}${stream} ${event.message}`);
    }
    if (batch.length < 500) break;
    const last = batch[batch.length - 1]!;
    before = { createdAt: last.createdAt, id: last.id };
  }
  return lines.join("\n");
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
  const cleanup = () => {
    off?.();
    off = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };
      for (const event of listEvents(streamId, 200).reverse()) send(event);
      send({ type: "hello", ...(streamId ? { streamId } : {}) });
      // Global fan-out uses EventRecord; per-stream live uses onStreamEvent status/metrics.
      // History is always EventRecord so clients can merge both shapes by presence of `id`.
      off = streamId
        ? onEvent((event) => {
            if (event.streamId === streamId) send(event);
          })
        : onEvent(send);
      if (streamId) {
        const offLive = onStreamEvent(streamId, send);
        const prev = off;
        off = () => {
          prev?.();
          offLive();
        };
      }
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
      heartbeat.unref?.();
    },
    cancel() {
      cleanup();
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
    (c) => {
      const rawLimit = Number(c.req.query("limit") ?? 200);
      const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
      const before = parseCursor(c.req.query("before"));
      return c.json(ok(listEvents(c.req.param("id"), limit, before)));
    },
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

  app.get("/api/events", doc("Events", "List events", "Lists recent worker events."), (c) => {
    const rawLimit = Number(c.req.query("limit") ?? 200);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
    const before = parseCursor(c.req.query("before"));
    return c.json(ok(listEvents(undefined, limit, before)));
  });

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
