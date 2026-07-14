/** YouTube Data API v3 live stream analytics fetcher. */

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

export interface YouTubeVideoItem {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: Record<string, { url: string }>;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  liveStreamingDetails?: {
    concurrentViewers?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    scheduledStartTime?: string;
  };
}

interface YouTubeApiError {
  error?: {
    code?: number;
    message?: string;
    errors?: { message: string }[];
  };
}

/**
 * Extracts an 11-character YouTube video ID from a URL or raw ID string.
 *
 * @param input - YouTube watch URL, youtu.be short link, /live/ URL, or raw ID.
 * @returns The video ID, or null if no valid ID found.
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetches live stream analytics from the YouTube Data API v3.
 *
 * @param videoId - The 11-character YouTube video ID.
 * @param apiKey - A valid YouTube Data API v3 key.
 * @returns Parsed analytics, or throws on API error.
 */
export async function fetchYouTubeAnalytics(
  videoId: string,
  apiKey: string,
): Promise<YouTubeAnalytics> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const body = (await response.json()) as YouTubeApiError & { items?: YouTubeVideoItem[] };

  if (!response.ok) {
    const message = body.error?.message ?? `YouTube API returned ${response.status}`;
    throw new Error(message);
  }

  const item = body.items?.[0];
  if (!item) {
    throw new Error(
      "YouTube video not found. The video may be private, deleted, or the ID is wrong.",
    );
  }

  const lsd = item.liveStreamingDetails;
  const isLive = Boolean(lsd?.actualStartTime && !lsd?.actualEndTime);
  const isUpcoming = Boolean(lsd?.scheduledStartTime && !lsd?.actualStartTime);

  return {
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl:
      item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
    concurrentViewers: lsd?.concurrentViewers ? Number(lsd.concurrentViewers) : null,
    actualStartTime: lsd?.actualStartTime ?? null,
    scheduledStartTime: lsd?.scheduledStartTime ?? null,
    viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
    likeCount: item.statistics?.likeCount ? Number(item.statistics.likeCount) : null,
    commentCount: item.statistics?.commentCount ? Number(item.statistics.commentCount) : null,
    isLive,
    isUpcoming,
  };
}
