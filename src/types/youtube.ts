export type YoutubeConnectionStatus = "pending" | "connected" | "expired";

export interface YoutubeConnectionRecord {
  id: string;
  userId: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  channelId?: string;
  channelTitle?: string;
  channelThumbnail?: string;
  status: YoutubeConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface YoutubeClientRecord {
  userId: string;
  clientId: string;
  clientSecret: string;
  createdAt: string;
  updatedAt: string;
}

export interface SafeYoutubeClient {
  configured: boolean;
  clientIdMasked: string | null;
  updatedAt: string | null;
}

export interface SafeYoutubeConnection {
  id: string;
  userId: string;
  hasClientSecret: boolean;
  hasRefreshToken: boolean;
  clientIdMasked: string;
  channelId: string | null;
  channelTitle: string | null;
  channelThumbnail: string | null;
  status: YoutubeConnectionStatus;
  createdAt: string;
  updatedAt: string;
}
