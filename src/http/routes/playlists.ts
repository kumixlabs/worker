/**
 * Playlist endpoints: CRUD plus full-order item replacement.
 */

import type { Hono } from "hono";
import { z } from "zod";

import { addEvent } from "../../db/events";
import {
  deletePlaylist,
  getPlaylistById,
  getPlaylistItems,
  insertPlaylist,
  listPlaylists,
  replacePlaylistItems,
  updatePlaylist,
} from "../../db/playlists";
import { fail, ok } from "../middleware";
import { doc } from "./common";

function sessionUserId(c: { get: (key: string) => unknown }): string {
  return (c.get("user") as { id: string }).id;
}

const playlistCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  shuffle: z.boolean().optional(),
});

const playlistPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  shuffle: z.boolean().optional(),
});

const playlistItemsSchema = z.object({
  mediaIds: z.array(z.string().min(1)).max(500),
});

export function registerPlaylistRoutes(app: Hono) {
  app.get(
    "/api/playlists",
    doc("Playlists", "List playlists", "Returns the current user's playlists with item counts."),
    (c) => c.json(ok(listPlaylists(sessionUserId(c)))),
  );

  app.post(
    "/api/playlists",
    doc("Playlists", "Create playlist", "Creates an empty playlist."),
    async (c) => {
      const parsed = playlistCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid request body", 400);
      const record = insertPlaylist(sessionUserId(c), parsed.data);
      addEvent(sessionUserId(c), "playlist", `Created playlist "${record.name}"`);
      return c.json(ok(record), 201);
    },
  );

  app.get(
    "/api/playlists/:id",
    doc("Playlists", "Read playlist", "Returns a playlist with its ordered items."),
    (c) => {
      const playlist = getPlaylistById(c.req.param("id"), sessionUserId(c));
      if (!playlist) return fail("NOT_FOUND", "Playlist not found", 404);
      return c.json(ok({ ...playlist, items: getPlaylistItems(playlist.id) }));
    },
  );

  app.patch(
    "/api/playlists/:id",
    doc("Playlists", "Update playlist", "Updates name, description, or shuffle."),
    async (c) => {
      const parsed = playlistPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid request body", 400);
      const updated = updatePlaylist(c.req.param("id"), sessionUserId(c), parsed.data);
      return updated ? c.json(ok(updated)) : fail("NOT_FOUND", "Playlist not found", 404);
    },
  );

  app.put(
    "/api/playlists/:id/items",
    doc(
      "Playlists",
      "Replace items",
      "Replaces the full ordered item list. Body: { mediaIds: [...] } — every ID must belong to the user and appear at most once.",
    ),
    async (c) => {
      const parsed = playlistItemsSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid request body", 400);
      const result = replacePlaylistItems(
        c.req.param("id"),
        sessionUserId(c),
        parsed.data.mediaIds,
      );
      if (result === "MEDIA_NOT_FOUND")
        return fail("NOT_FOUND", "Playlist or media not found", 404);
      if (result === "DUPLICATE_MEDIA")
        return fail("DUPLICATE_MEDIA", "Duplicate media in playlist order", 409);
      return c.json(ok(result));
    },
  );

  app.delete(
    "/api/playlists/:id",
    doc("Playlists", "Delete playlist", "Deletes the playlist and its items."),
    (c) => {
      const userId = sessionUserId(c);
      const playlist = getPlaylistById(c.req.param("id"), userId);
      if (!playlist) return fail("NOT_FOUND", "Playlist not found", 404);
      deletePlaylist(playlist.id, userId);
      addEvent(userId, "playlist", `Deleted playlist "${playlist.name}"`);
      return c.json(ok({ deleted: true }));
    },
  );
}
