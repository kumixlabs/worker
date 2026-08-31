import { nanoid } from "nanoid";

import { decryptSecret, encryptSecret, maskSecret } from "../lib/crypto";
import { nowIso } from "../lib/utils";
import type {
  SafeYoutubeConnection,
  YoutubeConnectionCreateInput,
  YoutubeConnectionRecord,
} from "../types/youtube";
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
  subscriber_count: number | null;
  status: "pending" | "connected" | "expired";
  created_at: string;
  updated_at: string;
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
    subscriberCount: row.subscriber_count ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listYoutubeConnections(userId?: string): YoutubeConnectionRecord[] {
  const sql = userId
    ? "SELECT * FROM youtube_connections WHERE user_id = ? ORDER BY created_at DESC"
    : "SELECT * FROM youtube_connections ORDER BY created_at DESC";
  const rows = (
    userId ? getDb().query(sql).all(userId) : getDb().query(sql).all()
  ) as YoutubeConnectionRow[];
  return rows.map(mapRow);
}

export function getYoutubeConnection(id: string): YoutubeConnectionRecord | null {
  const row = getDb().query("SELECT * FROM youtube_connections WHERE id = ?").get(id) as
    | YoutubeConnectionRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function createYoutubeConnection(
  input: YoutubeConnectionCreateInput,
  userId: string,
): YoutubeConnectionRecord {
  const id = `ytc_${nanoid(12)}`;
  const now = nowIso();
  getDb()
    .query(
      `INSERT INTO youtube_connections (
        id, user_id, client_id_cipher, client_secret_cipher, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      id,
      userId,
      encryptSecret(input.clientId.trim()),
      encryptSecret(input.clientSecret.trim()),
      now,
      now,
    );
  return getYoutubeConnection(id)!;
}

export function updateYoutubeConnectionAuth(
  id: string,
  data: {
    refreshToken: string;
    channelId: string;
    channelTitle: string;
    channelThumbnail?: string;
    subscriberCount?: number;
  },
): YoutubeConnectionRecord | null {
  const now = nowIso();
  getDb()
    .query(
      `UPDATE youtube_connections SET
        refresh_token_cipher = ?,
        channel_id = ?,
        channel_title = ?,
        channel_thumbnail = ?,
        subscriber_count = ?,
        status = 'connected',
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      encryptSecret(data.refreshToken),
      data.channelId,
      data.channelTitle,
      data.channelThumbnail ?? null,
      data.subscriberCount ?? null,
      now,
      id,
    );
  return getYoutubeConnection(id);
}

export function markYoutubeConnectionExpired(id: string): void {
  getDb()
    .query("UPDATE youtube_connections SET status = 'expired', updated_at = ? WHERE id = ?")
    .run(nowIso(), id);
}

export function deleteYoutubeConnection(id: string, userId?: string): boolean {
  const conn = getYoutubeConnection(id);
  if (!conn) return false;
  if (userId && conn.userId !== userId) return false;
  return getDb().query("DELETE FROM youtube_connections WHERE id = ?").run(id).changes > 0;
}

export function safeYoutubeConnection(record: YoutubeConnectionRecord): SafeYoutubeConnection {
  return {
    id: record.id,
    userId: record.userId,
    clientIdMasked: maskSecret(record.clientId),
    hasClientSecret: Boolean(record.clientSecret),
    channelId: record.channelId,
    channelTitle: record.channelTitle,
    channelThumbnail: record.channelThumbnail,
    subscriberCount: record.subscriberCount,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
