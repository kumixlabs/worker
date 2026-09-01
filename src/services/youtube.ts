import { getStreamById, updateStreamYoutubeRuntime } from "../db/streams";
import { getValidAccessToken } from "./youtube-oauth";

interface PrepareResult {
  ingestUrl: string;
  streamKey: string;
  videoId: string;
  broadcastId: string;
}

export async function prepareYouTubeBroadcast(
  userId: string,
  streamId: string,
): Promise<PrepareResult> {
  const stream = getStreamById(streamId, userId);
  if (!stream) throw new Error("Stream not found");
  if (!stream.youtubeConnectionId) throw new Error("Stream has no YouTube connection assigned");

  const accessToken = await getValidAccessToken(stream.youtubeConnectionId);

  const broadcastRes = await fetch(
    "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        snippet: {
          title: stream.ytTitle || stream.name,
          description: stream.ytDescription || "",
          scheduledStartTime: new Date().toISOString(),
        },
        status: {
          privacyStatus: stream.ytPrivacy || "public",
          selfDeclaredMadeForKids: stream.ytMadeForKids,
        },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: true,
          enableDvr: stream.ytDvr,
          recordFromStart: true,
          latencyPreference: "ultraLow",
          monitorStream: { enableMonitorStream: false },
        },
      }),
    },
  );
  if (!broadcastRes.ok) {
    throw new Error(`Failed to create YouTube broadcast: ${await broadcastRes.text()}`);
  }
  const broadcastData = (await broadcastRes.json()) as { id: string };
  const broadcastId = broadcastData.id;

  let liveStreamId = stream.ytStreamKeyId;
  let ingestionAddress = "";
  let streamName = "";

  if (!liveStreamId) {
    const streamRes = await fetch(
      "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          snippet: { title: `Kumix: ${stream.name}` },
          cdn: { frameRate: "variable", ingestionType: "rtmp", resolution: "variable" },
        }),
      },
    );
    if (!streamRes.ok) {
      throw new Error(`Failed to create YouTube stream key: ${await streamRes.text()}`);
    }
    const streamData = (await streamRes.json()) as {
      id: string;
      cdn?: { ingestionInfo?: { ingestionAddress?: string; streamName?: string } };
    };
    liveStreamId = streamData.id;
    ingestionAddress = streamData.cdn?.ingestionInfo?.ingestionAddress ?? "";
    streamName = streamData.cdn?.ingestionInfo?.streamName ?? "";
  } else {
    const streamRes = await fetch(
      `https://www.googleapis.com/youtube/v3/liveStreams?part=cdn&id=${liveStreamId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!streamRes.ok) throw new Error("Failed to fetch existing YouTube stream key info");
    const data = (await streamRes.json()) as {
      items?: Array<{
        cdn?: { ingestionInfo?: { ingestionAddress?: string; streamName?: string } };
      }>;
    };
    const item = data.items?.[0];
    if (!item?.cdn?.ingestionInfo) throw new Error("Invalid stream key information from YouTube");
    ingestionAddress = item.cdn.ingestionInfo.ingestionAddress ?? "";
    streamName = item.cdn.ingestionInfo.streamName ?? "";
  }

  const bindRes = await fetch(
    `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&part=id,contentDetails&streamId=${liveStreamId}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!bindRes.ok) {
    throw new Error(`Failed to bind YouTube broadcast to stream: ${await bindRes.text()}`);
  }

  updateStreamYoutubeRuntime(streamId, userId, {
    ytStreamKeyId: liveStreamId,
    ytBroadcastId: broadcastId,
    ytVideoId: broadcastId,
    youtubeLiveUrl: `https://youtu.be/${broadcastId}`,
  });

  return { ingestUrl: ingestionAddress, streamKey: streamName, videoId: broadcastId, broadcastId };
}

export async function completeYouTubeBroadcast(
  connectionId: string,
  broadcastId: string,
): Promise<void> {
  try {
    const accessToken = await getValidAccessToken(connectionId);
    await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=complete&id=${broadcastId}&part=id,status`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (error) {
    console.error("[youtube] Could not transition broadcast to complete:", error);
  }
}
