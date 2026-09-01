import { randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret, maskSecret } from "../lib/crypto";
import type { SafeYoutubeConnection, YoutubeConnectionRecord } from "../types/youtube";
import { getDb } from "./client";

interface YoutubeConnectionRow {
  id: string;
  user_id: string;
  client_id_cipher: string;
  client_secret_cipher: string;
  refresh_token_cipher: string | null;
  channel_id: string | null;
  channel_title: string | null;
  channel_thumbnail: string | null;
  status: "pending" | "connected" | "expired";
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: YoutubeConnectionRow): YoutubeConnectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: decryptSecret(row.client_id_cipher),
    clientSecret: decryptSecret(row.client_secret_cipher),
    refreshToken: row.refresh_token_cipher ? decryptSecret(row.refresh_token_cipher) : undefined,
    channelId: row.channel_id ?? undefined,
    channelTitle: row.channel_title ?? undefined,
    channelThumbnail: row.channel_thumbnail ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function safeYoutubeConnection(record: YoutubeConnectionRecord): SafeYoutubeConnection {
  return {
    id: record.id,
    userId: record.userId,
    hasClientSecret: Boolean(record.clientSecret),
    hasRefreshToken: Boolean(record.refreshToken),
    clientIdMasked: maskSecret(record.clientId),
    channelId: record.channelId ?? null,
    channelTitle: record.channelTitle ?? null,
    channelThumbnail: record.channelThumbnail ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function listYoutubeConnections(userId: string): YoutubeConnectionRecord[] {
  return (
    getDb()
      .query("SELECT * FROM youtube_connections WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as YoutubeConnectionRow[]
  ).map(mapRow);
}

export function getYoutubeConnection(id: string): YoutubeConnectionRecord | null {
  const row = getDb().query("SELECT * FROM youtube_connections WHERE id = ?").get(id) as
    | YoutubeConnectionRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function createYoutubeConnection(
  input: { clientId: string; clientSecret: string },
  userId: string,
): YoutubeConnectionRecord {
  const id = `ytc_${randomBytes(9).toString("base64url")}`;
  const now = nowIso();
  getDb()
    .query(
      `INSERT INTO youtube_connections (id, user_id, client_id_cipher, client_secret_cipher, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      id,
      userId,
      encryptSecret(input.clientId.trim()),
      encryptSecret(input.clientSecret.trim()),
      now,
      now,
    );
  return getYoutubeConnection(id) as YoutubeConnectionRecord;
}

export function updateYoutubeConnectionAuth(
  id: string,
  auth: {
    refreshToken: string;
    channelId: string;
    channelTitle: string;
    channelThumbnail?: string;
  },
): void {
  getDb()
    .query(
      `UPDATE youtube_connections SET refresh_token_cipher = ?, channel_id = ?, channel_title = ?,
       channel_thumbnail = ?, status = 'connected', updated_at = ? WHERE id = ?`,
    )
    .run(
      encryptSecret(auth.refreshToken),
      auth.channelId,
      auth.channelTitle,
      auth.channelThumbnail ?? null,
      nowIso(),
      id,
    );
}

export function markYoutubeConnectionExpired(id: string): void {
  getDb()
    .query("UPDATE youtube_connections SET status = 'expired', updated_at = ? WHERE id = ?")
    .run(nowIso(), id);
}

export function deleteYoutubeConnection(id: string, userId: string): boolean {
  const result = getDb()
    .query("DELETE FROM youtube_connections WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return result.changes > 0;
}
