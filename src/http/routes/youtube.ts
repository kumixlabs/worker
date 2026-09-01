/**
 * YouTube Live BYO OAuth connections: list, register client, delete,
 * and the public OAuth callback that stores the refresh token.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Context, Hono } from "hono";
import { z } from "zod";

import {
  createYoutubeConnection,
  deleteYoutubeConnection,
  getYoutubeClient,
  getYoutubeConnection,
  listYoutubeConnections,
  safeYoutubeClient,
  safeYoutubeConnection,
  updateYoutubeConnectionAuth,
  upsertYoutubeClient,
} from "../../db/youtube";
import { currentEncryptionKey } from "../../runtime/config";
import { fail, ok } from "../middleware";

function sessionUserId(c: { get: (key: string) => unknown }): string {
  const user = c.get("user") as { id: string } | undefined;
  if (!user?.id) throw new Error("unauthenticated");
  return user.id;
}

function redirectUriFor(c: Context): string {
  const forwarded =
    process.env.KUMIX_WORKER_TRUST_PROXY === "1" && c.req.header("x-forwarded-host");
  if (forwarded) {
    const proto = c.req.header("x-forwarded-proto") ?? "https";
    return `${proto}://${forwarded}/api/youtube/callback`;
  }
  return `${new URL(c.req.url).origin}/api/youtube/callback`;
}

function signState(payload: { connectionId: string; userId: string }): string {
  const data = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 }),
  ).toString("base64url");
  const sig = createHmac("sha256", currentEncryptionKey()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyState(state: string): { connectionId: string; userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts as [string, string];
  const expectedSig = createHmac("sha256", currentEncryptionKey()).update(data).digest("base64url");
  if (
    sig.length !== expectedSig.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as {
      connectionId: string;
      userId: string;
      exp: number;
    };
    if (payload.exp < Date.now()) return null;
    return { connectionId: payload.connectionId, userId: payload.userId };
  } catch {
    return null;
  }
}

const clientSchema = z.object({
  clientId: z.string().min(10),
  clientSecret: z.string().min(10),
});

export function registerYoutubeRoutes(app: Hono): void {
  app.get("/api/youtube/client", (c) =>
    c.json(ok(safeYoutubeClient(getYoutubeClient(sessionUserId(c))))),
  );

  app.put("/api/youtube/client", async (c) => {
    const parsed = clientSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "clientId and clientSecret are required", 400);
    }
    upsertYoutubeClient(sessionUserId(c), parsed.data);
    return c.json(ok({ saved: true }));
  });

  app.get("/api/youtube/connections", (c) =>
    c.json(ok(listYoutubeConnections(sessionUserId(c)).map(safeYoutubeConnection))),
  );

  app.post("/api/youtube/connections", (c) => {
    const userId = sessionUserId(c);
    const client = getYoutubeClient(userId);
    if (!client) {
      return fail("VALIDATION_ERROR", "Configure the YouTube OAuth client in Settings first", 400);
    }
    const record = createYoutubeConnection(
      { clientId: client.clientId, clientSecret: client.clientSecret },
      userId,
    );
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", client.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUriFor(c));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set(
      "scope",
      "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly",
    );
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", signState({ connectionId: record.id, userId }));
    return c.json(
      ok({ connection: safeYoutubeConnection(record), authUrl: authUrl.toString() }),
      201,
    );
  });

  app.delete("/api/youtube/connections/:id", (c) => {
    const deleted = deleteYoutubeConnection(c.req.param("id"), sessionUserId(c));
    if (!deleted) return fail("NOT_FOUND", "YouTube connection not found", 404);
    return c.json(ok({ deleted: true }));
  });

  // Public: Google redirects here after consent. Authenticated intent is
  // proven by the HMAC-signed state (created at connection registration).
  app.get("/api/youtube/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");
    if (error) return c.redirect(`/channels?youtube_error=${encodeURIComponent(error)}`);
    if (!code || !state) return c.redirect("/channels?youtube_error=missing_params");

    const verified = verifyState(state);
    if (!verified) return c.redirect("/channels?youtube_error=invalid_state");

    const conn = getYoutubeConnection(verified.connectionId);
    if (!conn || conn.userId !== verified.userId) {
      return c.redirect("/channels?youtube_error=connection_not_found");
    }

    const origin = new URL(c.req.url).origin;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: conn.clientId,
        client_secret: conn.clientSecret,
        redirect_uri: `${origin}/api/youtube/callback`,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!tokenRes.ok) return c.redirect("/channels?youtube_error=token_exchange_failed");

    const tokenData = (await tokenRes.json()) as { access_token: string; refresh_token?: string };
    if (!tokenData.refresh_token) return c.redirect("/channels?youtube_error=no_refresh_token");

    let channelId = "unknown";
    let channelTitle = "YouTube Channel";
    let channelThumbnail: string | undefined;
    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );
    if (channelRes.ok) {
      const channelData = (await channelRes.json()) as {
        items?: Array<{
          id: string;
          snippet?: { title?: string; thumbnails?: { default?: { url?: string } } };
        }>;
      };
      const item = channelData.items?.[0];
      if (item) {
        channelId = item.id;
        channelTitle = item.snippet?.title ?? channelTitle;
        channelThumbnail = item.snippet?.thumbnails?.default?.url;
      }
    }

    updateYoutubeConnectionAuth(conn.id, {
      refreshToken: tokenData.refresh_token,
      channelId,
      channelTitle,
      channelThumbnail,
    });
    return c.redirect("/channels?youtube_connected=true");
  });
}
