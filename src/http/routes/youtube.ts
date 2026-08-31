import { createHmac, timingSafeEqual } from "node:crypto";

import type { Context, Hono } from "hono";

import {
  createYoutubeConnection,
  deleteYoutubeConnection,
  getYoutubeConnection,
  listYoutubeConnections,
  safeYoutubeConnection,
  updateYoutubeConnectionAuth,
} from "../../db/youtube";
import { currentSigningSecret } from "../../runtime/config";
import { youtubeConnectionCreateSchema } from "../../schemas/youtube";
import { fail, ok } from "../middleware";
import { doc } from "./common";

/**
 * OAuth redirect URI. Behind a TLS proxy the request URL carries the internal
 * http host, so Google rejects the mismatched redirect_uri. When
 * KUMIX_WORKER_TRUST_PROXY=1 (proxy strips client-supplied forwarded headers)
 * prefer X-Forwarded-Proto/Host, mirroring StreamFlow's behavior.
 */
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
  const sig = createHmac("sha256", currentSigningSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyState(state: string): { connectionId: string; userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = createHmac("sha256", currentSigningSecret())
    .update(data!)
    .digest("base64url");
  if (
    sig!.length !== expectedSig.length ||
    !timingSafeEqual(Buffer.from(sig!), Buffer.from(expectedSig))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data!, "base64url").toString("utf8")) as {
      connectionId: string;
      userId: string;
      exp: number;
    };
    if (Date.now() > parsed.exp) return null;
    return { connectionId: parsed.connectionId, userId: parsed.userId };
  } catch {
    return null;
  }
}

export function registerYoutubeRoutes(app: Hono) {
  app.get(
    "/api/youtube/connections",
    doc("YouTube", "List connections", "Lists connected YouTube channels for the current user."),
    (c) => {
      const user = c.get("user") as { id: string; role?: string };
      const userId = user.role === "admin" ? undefined : user.id;
      return c.json(ok(listYoutubeConnections(userId).map(safeYoutubeConnection)));
    },
  );

  app.post(
    "/api/youtube/connections",
    doc(
      "YouTube",
      "Create connection",
      "Registers BYO OAuth client credentials and returns the Google authorization URL.",
    ),
    async (c) => {
      const user = c.get("user") as { id: string };
      const raw = await c.req.json().catch(() => null);
      const parsed = youtubeConnectionCreateSchema.safeParse(raw);
      if (!parsed.success) {
        return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input");
      }
      const record = createYoutubeConnection(parsed.data, user.id);
      const state = signState({ connectionId: record.id, userId: user.id });

      const redirectUri = redirectUriFor(c);
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", parsed.data.clientId.trim());
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set(
        "scope",
        "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly",
      );
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);

      return c.json(
        ok({
          connection: safeYoutubeConnection(record),
          authUrl: authUrl.toString(),
        }),
      );
    },
  );

  app.get(
    "/api/youtube/callback",
    doc("YouTube", "OAuth Callback", "Handles Google OAuth redirect code exchange."),
    async (c) => {
      const code = c.req.query("code");
      const state = c.req.query("state");
      const error = c.req.query("error");

      if (error) {
        return c.redirect(`/settings?youtube_error=${encodeURIComponent(error)}`);
      }
      if (!code || !state) {
        return c.redirect("/settings?youtube_error=missing_params");
      }

      const verified = verifyState(state);
      if (!verified) {
        return c.redirect("/settings?youtube_error=invalid_state");
      }

      const conn = getYoutubeConnection(verified.connectionId);
      if (!conn || conn.userId !== verified.userId) {
        return c.redirect("/settings?youtube_error=connection_not_found");
      }
      const sessionUser = c.get("user");
      if (!sessionUser || (sessionUser.role !== "admin" && sessionUser.id !== verified.userId)) {
        return c.redirect("/settings?youtube_error=session_mismatch");
      }

      const origin = new URL(c.req.url).origin;
      const redirectUri = `${origin}/api/youtube/callback`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: conn.clientId,
          client_secret: conn.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      if (!tokenRes.ok) {
        return c.redirect("/settings?youtube_error=token_exchange_failed");
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
      };

      if (!tokenData.refresh_token) {
        return c.redirect("/settings?youtube_error=no_refresh_token");
      }

      const channelRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        },
      );

      let channelId = "unknown";
      let channelTitle = "YouTube Channel";
      let channelThumbnail: string | undefined;
      let subscriberCount: number | undefined;

      if (channelRes.ok) {
        const channelData = (await channelRes.json()) as {
          items?: Array<{
            id: string;
            snippet?: {
              title?: string;
              thumbnails?: { default?: { url?: string } };
            };
            statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
          }>;
        };
        const item = channelData.items?.[0];
        if (item) {
          channelId = item.id;
          channelTitle = item.snippet?.title ?? "YouTube Channel";
          channelThumbnail = item.snippet?.thumbnails?.default?.url;
          const subs = Number(item.statistics?.subscriberCount);
          if (!item.statistics?.hiddenSubscriberCount && Number.isFinite(subs)) {
            subscriberCount = subs;
          }
        }
      }

      updateYoutubeConnectionAuth(conn.id, {
        refreshToken: tokenData.refresh_token,
        channelId,
        channelTitle,
        channelThumbnail,
        subscriberCount,
      });

      return c.redirect("/settings?youtube_connected=true");
    },
  );

  app.delete(
    "/api/youtube/connections/:id",
    doc("YouTube", "Delete connection", "Disconnects and removes a YouTube channel connection."),
    (c) => {
      const user = c.get("user") as { id: string; role?: string };
      const id = c.req.param("id");
      const userId = user.role === "admin" ? undefined : user.id;
      try {
        const deleted = deleteYoutubeConnection(id, userId);
        if (!deleted) return fail("NOT_FOUND", "YouTube connection not found", 404);
        return c.json(ok({ deleted: true }));
      } catch (err) {
        if (err instanceof Error && err.message.includes("FOREIGN KEY")) {
          return fail(
            "CONFLICT",
            "Connection is still referenced by streams; delete or detach those streams first",
            409,
          );
        }
        throw err;
      }
    },
  );
}
