import { getYoutubeConnection, markYoutubeConnectionExpired } from "../db/youtube";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Retrieves a valid OAuth access token for a given YouTube connection.
 * Uses an in-memory cache and automatically refreshes via Google OAuth if expired.
 */
export async function getValidAccessToken(connectionId: string): Promise<string> {
  const cached = tokenCache.get(connectionId);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.accessToken;
  }

  const conn = getYoutubeConnection(connectionId);
  if (!conn) throw new Error("YouTube connection not found");
  if (!conn.refreshToken) throw new Error("YouTube connection has no refresh token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: conn.clientId,
      client_secret: conn.clientSecret,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
    if (errorBody.error === "invalid_grant") {
      markYoutubeConnectionExpired(connectionId);
    }
    throw new Error(`Failed to refresh Google OAuth token: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache.set(connectionId, {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  });

  return data.access_token;
}
