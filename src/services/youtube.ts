/**
 * YouTube Data API v3 live stream operations and analytics fetcher.
 */

import { getStream, patchStream } from "../db/streams";
import type { YouTubeAnalytics } from "../types/youtube";
import { getValidAccessToken } from "./youtube-oauth";

export type { YouTubeAnalytics } from "../types/youtube";

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
 * Creates and binds a YouTube live broadcast before starting an RTMP transmission.
 * Returns the ephemeral RTMP ingestion address and stream name.
 */
export async function prepareYouTubeBroadcast(streamId: string): Promise<{
  ingestUrl: string;
  streamKey: string;
  videoId: string;
  broadcastId: string;
}> {
  const stream = getStream(streamId);
  if (!stream) throw new Error("Stream not found");
  if (!stream.youtubeConnectionId) throw new Error("Stream has no YouTube connection assigned");

  const accessToken = await getValidAccessToken(stream.youtubeConnectionId);

  // 1. Create liveBroadcast
  const broadcastRes = await fetch(
    "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          title: stream.ytTitle || stream.title,
          description: stream.ytDescription || "",
          scheduledStartTime: new Date().toISOString(),
        },
        status: {
          privacyStatus: stream.ytPrivacy || "public",
          selfDeclaredMadeForKids: Boolean(stream.ytMadeForKids),
        },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: true,
          enableDvr: Boolean(stream.ytDvr),
          recordFromStart: true,
          latencyPreference: "ultraLow",
          monitorStream: { enableMonitorStream: false },
        },
      }),
    },
  );

  if (!broadcastRes.ok) {
    const err = await broadcastRes.text();
    throw new Error(`Failed to create YouTube broadcast: ${err}`);
  }

  const broadcastData = (await broadcastRes.json()) as { id: string };
  const broadcastId = broadcastData.id;
  const videoId = broadcastId;

  // 2. Resolve or create liveStream (stream key)
  let liveStreamId = stream.ytStreamKeyId;
  let ingestionAddress = "";
  let streamName = "";

  if (!liveStreamId) {
    const streamRes = await fetch(
      "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            title: `Kumix Live: ${stream.title} (${new Date().toLocaleTimeString()})`,
          },
          cdn: {
            frameRate: "variable",
            ingestionType: "rtmp",
            resolution: "variable",
          },
        }),
      },
    );

    if (!streamRes.ok) {
      const err = await streamRes.text();
      throw new Error(`Failed to create YouTube live stream key: ${err}`);
    }

    const streamData = (await streamRes.json()) as {
      id: string;
      cdn?: {
        ingestionInfo?: {
          ingestionAddress?: string;
          streamName?: string;
        };
      };
    };
    liveStreamId = streamData.id;
    ingestionAddress = streamData.cdn?.ingestionInfo?.ingestionAddress ?? "";
    streamName = streamData.cdn?.ingestionInfo?.streamName ?? "";
  } else {
    const streamRes = await fetch(
      `https://www.googleapis.com/youtube/v3/liveStreams?part=cdn&id=${liveStreamId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!streamRes.ok) throw new Error("Failed to fetch existing YouTube stream key info");
    const data = (await streamRes.json()) as {
      items?: Array<{
        cdn?: {
          ingestionInfo?: {
            ingestionAddress?: string;
            streamName?: string;
          };
        };
      }>;
    };
    const item = data.items?.[0];
    if (!item?.cdn?.ingestionInfo) throw new Error("Invalid stream key information from YouTube");
    ingestionAddress = item.cdn.ingestionInfo.ingestionAddress ?? "";
    streamName = item.cdn.ingestionInfo.streamName ?? "";
  }

  // 3. Bind broadcast to stream key
  const bindRes = await fetch(
    `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&part=id,contentDetails&streamId=${liveStreamId}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!bindRes.ok) {
    const err = await bindRes.text();
    throw new Error(`Failed to bind YouTube broadcast to stream: ${err}`);
  }

  // 4. Update stream record with runtime broadcast metadata
  patchStream(streamId, {
    ytBroadcastId: broadcastId,
    ytVideoId: videoId,
    ytStreamKeyId: liveStreamId,
    youtubeLiveUrl: `https://youtu.be/${videoId}`,
  });

  return {
    ingestUrl: ingestionAddress,
    streamKey: streamName,
    videoId,
    broadcastId,
  };
}

/**
 * Transitions a broadcast to complete status upon graceful stream shutdown.
 */
export async function completeYouTubeBroadcast(
  connectionId: string,
  broadcastId: string,
): Promise<void> {
  try {
    const accessToken = await getValidAccessToken(connectionId);
    await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=complete&id=${broadcastId}&part=id,status`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
  } catch (error) {
    console.error("[youtube] Could not transition broadcast to complete:", error);
  }
}

/**
 * Fetches live stream analytics from YouTube.
 */
export async function fetchYouTubeAnalytics(
  videoId: string,
  accessToken: string,
): Promise<YouTubeAnalytics> {
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,statistics,liveStreamingDetails`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      snippet: {
        title: string;
        channelTitle: string;
        thumbnails?: Record<string, { url: string }>;
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
    }>;
  };

  const item = data.items?.[0];
  if (!item) throw new Error(`YouTube video "${videoId}" not found`);

  const { snippet, statistics, liveStreamingDetails } = item;
  let liveStatus: YouTubeAnalytics["liveStatus"] = "unknown";
  if (liveStreamingDetails?.actualStartTime && !liveStreamingDetails.actualEndTime) {
    liveStatus = "live";
  } else if (liveStreamingDetails?.actualEndTime) {
    liveStatus = "ended";
  } else if (liveStreamingDetails?.scheduledStartTime) {
    liveStatus = "upcoming";
  }

  const thumbnails = snippet.thumbnails ?? {};
  const bestThumbnail =
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null;

  return {
    title: snippet.title,
    channelTitle: snippet.channelTitle,
    concurrentViewers: liveStreamingDetails?.concurrentViewers
      ? Number(liveStreamingDetails.concurrentViewers)
      : null,
    viewCount: statistics?.viewCount ? Number(statistics.viewCount) : null,
    likeCount: statistics?.likeCount ? Number(statistics.likeCount) : null,
    commentCount: statistics?.commentCount ? Number(statistics.commentCount) : null,
    isLive: liveStatus === "live",
    isUpcoming: liveStatus === "upcoming",
    actualStartTime: liveStreamingDetails?.actualStartTime ?? null,
    scheduledStartTime: liveStreamingDetails?.scheduledStartTime ?? null,
    liveStatus,
    thumbnailUrl: bestThumbnail,
  };
}
