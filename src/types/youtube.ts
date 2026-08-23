/** YouTube live analytics snapshot types shared by the API and dashboard. */

export interface YouTubeAnalytics {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  concurrentViewers: number | null;
  actualStartTime: string | null;
  scheduledStartTime: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  isLive: boolean;
  isUpcoming: boolean;
}
