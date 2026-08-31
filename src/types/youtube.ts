export interface YoutubeConnectionRecord {
  id: string;
  userId: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  channelId?: string;
  channelTitle?: string;
  channelThumbnail?: string;
  subscriberCount?: number;
  status: "pending" | "connected" | "expired";
  createdAt: string;
  updatedAt: string;
}

export type SafeYoutubeConnection = Omit<
  YoutubeConnectionRecord,
  "clientId" | "clientSecret" | "refreshToken"
> & {
  clientIdMasked: string;
  hasClientSecret: boolean;
};

export interface YoutubeConnectionCreateInput {
  clientId: string;
  clientSecret: string;
}

export interface YouTubeAnalytics {
  title: string;
  channelTitle: string;
  concurrentViewers: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  isLive: boolean;
  isUpcoming: boolean;
  actualStartTime?: string | null;
  scheduledStartTime?: string | null;
  liveStatus: "live" | "upcoming" | "ended" | "unknown";
  thumbnailUrl: string | null;
}
