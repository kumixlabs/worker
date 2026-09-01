/**
 * Stream runner: spawns FFmpeg to push a playlist (concat demuxer) to an
 * RTMP target. Optional background audio is amix'ed over the video track.
 * ponytail: `-c copy` concat assumes uniform codecs across playlist videos;
 * mixed-codec playlists need a re-encode profile (add when real sources vary).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { getDb } from "../db/client";
import { mediaPath } from "../db/media";
import { getPlaylistItems } from "../db/playlists";
import { getStreamById, type StreamRecord, setStreamStatus } from "../db/streams";
import { decryptSecret } from "../lib/crypto";
import { getDataDir } from "../runtime/config";
import { getFfmpegPath } from "../runtime/ffmpeg";
import { completeYouTubeBroadcast, prepareYouTubeBroadcast } from "./youtube";

interface RunningStream {
  child: ChildProcess;
  logPath: string;
  listPath: string | null;
}

const running = new Map<string, RunningStream>();

export function isStreamRunning(streamId: string): boolean {
  return running.has(streamId);
}

function logsDir(): string {
  const dir = join(getDataDir(), "logs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function streamDir(): string {
  const dir = join(getDataDir(), "tmp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConcatList(stream: StreamRecord, files: string[]): string {
  const listPath = join(streamDir(), `${stream.id}.concat.txt`);
  const body = files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n");
  const handle = createWriteStream(listPath, { flags: "w" });
  handle.end(body);
  return listPath;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function buildFfmpegArgs(options: {
  listPath: string;
  audioPath: string | null;
  loop: boolean;
  targetUrl: string;
}): string[] {
  const args = ["-nostdin", "-hide_banner"];
  if (options.loop) args.push("-stream_loop", "-1");
  args.push("-f", "concat", "-safe", "0", "-i", options.listPath);
  if (options.audioPath) {
    args.push("-stream_loop", "-1", "-i", options.audioPath);
    args.push(
      "-filter_complex",
      "[1:a]volume=0.35[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]",
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "44100",
    );
  } else {
    args.push("-map", "0", "-c", "copy");
  }
  args.push("-f", "flv", options.targetUrl);
  return args;
}

export class StreamStartError extends Error {
  code: string;

  constructor(message: string, code = "STREAM_START_FAILED") {
    super(message);
    this.code = code;
  }
}

export async function startStream(userId: string, streamId: string): Promise<StreamRecord> {
  const stream = getStreamById(streamId, userId);
  if (!stream) throw new StreamStartError("Stream not found", "NOT_FOUND");
  if (running.has(streamId))
    throw new StreamStartError("Stream already running", "ALREADY_RUNNING");

  const items = getPlaylistItems(stream.playlistId);
  const videos = items.filter((item) => item.kind !== "audio");
  if (videos.length === 0) throw new StreamStartError("Playlist has no videos", "EMPTY_PLAYLIST");

  let targetUrl = decryptSecret(stream.targetUrl);
  if (stream.youtubeConnectionId) {
    try {
      const yt = await prepareYouTubeBroadcast(userId, streamId);
      if (yt.ingestUrl && yt.streamKey) {
        targetUrl = `${yt.ingestUrl.replace(/\/$/, "")}/${yt.streamKey}`;
        logPreStart(
          streamId,
          `YouTube broadcast ${yt.broadcastId} ready (https://youtu.be/${yt.videoId})`,
        );
      }
    } catch (error) {
      cleanup(streamId);
      setStreamStatus(streamId, "failed", {
        error: `YouTube broadcast preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        stoppedAt: new Date().toISOString(),
      });
      throw new StreamStartError(
        `YouTube broadcast preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        "YOUTUBE_PREPARE_FAILED",
      );
    }
  }
  if (!targetUrl || !/^rtmps?:\/\//i.test(targetUrl))
    throw new StreamStartError("Invalid or missing RTMP target URL", "INVALID_TARGET");

  const ordered = stream.shuffle ? shuffled(videos) : videos;
  const listPath = writeConcatList(
    stream,
    ordered.map((item) => mediaPath(item.media.fileName)),
  );
  const audio = items.find((item) => item.kind === "audio");
  const args = buildFfmpegArgs({
    listPath,
    audioPath: audio ? mediaPath(audio.media.fileName) : null,
    loop: stream.loop,
    targetUrl,
  });

  const logPath = join(logsDir(), `${streamId}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
  log.write(`\n--- start ${new Date().toISOString()} ---\nffmpeg ${args.join(" ")}\n`);

  const child = spawn(getFfmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  running.set(streamId, { child, logPath, listPath });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      log.write(`spawn error: ${error.message}\n`);
      resolve(-1);
    });
    child.once("close", (code) => resolve(code));
    child.once("spawn", () => {
      // child is up; resolve start once we see it survive briefly
      setTimeout(() => resolve(null), 800);
    });
  });

  if (exitCode !== null && exitCode !== 0) {
    cleanup(streamId);
    setStreamStatus(streamId, "failed", {
      error: `FFmpeg exited with code ${exitCode}`,
      logPath,
      stoppedAt: new Date().toISOString(),
    });
    throw new StreamStartError(`FFmpeg exited with code ${exitCode}`);
  }

  setStreamStatus(streamId, "running", {
    error: null,
    logPath,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
  });

  child.once("close", (code) => {
    const entry = running.get(streamId);
    cleanup(streamId);
    if (entry) {
      const final = code === 0 || code === null ? "stopped" : "failed";
      setStreamStatus(streamId, final, {
        error: code === 0 || code === null ? null : `FFmpeg exited with code ${code}`,
        stoppedAt: new Date().toISOString(),
      });
    }
  });

  return getStreamById(streamId, userId) as StreamRecord;
}

function logPreStart(streamId: string, line: string): void {
  try {
    const logPath = join(logsDir(), `${streamId}.log`);
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // best-effort note only
  }
}

function cleanup(streamId: string): void {
  const entry = running.get(streamId);
  if (!entry) return;
  running.delete(streamId);
  entry.child.stdout?.destroy();
  entry.child.stderr?.destroy();
  entry.child.removeAllListeners();
  if (entry.listPath) rmSync(entry.listPath, { force: true });
}

export async function stopStream(userId: string, streamId: string): Promise<StreamRecord> {
  const stream = getStreamById(streamId, userId);
  if (!stream) throw new StreamStartError("Stream not found", "NOT_FOUND");
  const entry = running.get(streamId);
  if (!entry) {
    if (stream.status === "running")
      setStreamStatus(streamId, "stopped", { stoppedAt: new Date().toISOString() });
    return getStreamById(streamId, userId) as StreamRecord;
  }
  entry.child.kill("SIGINT");
  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    entry.child.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited) {
    entry.child.kill("SIGKILL");
    cleanup(streamId);
    setStreamStatus(streamId, "stopped", { stoppedAt: new Date().toISOString() });
  }
  if (stream.youtubeConnectionId && stream.ytBroadcastId) {
    await completeYouTubeBroadcast(stream.youtubeConnectionId, stream.ytBroadcastId);
  }
  return getStreamById(streamId, userId) as StreamRecord;
}

/**
 * Reconciles DB state after a crash/restart. Anything left 'running' has no
 * live process in this worker: auto-resume it (default) or mark failed via
 * KUMIX_WORKER_AUTO_RESUME=0. Call once on boot.
 */
export async function reconcileStreamsOnBoot(): Promise<void> {
  const rows = getDb().query("SELECT id, user_id FROM streams WHERE status = 'running'").all() as {
    id: string;
    user_id: string;
  }[];
  if (rows.length === 0) return;
  const disabled = ["0", "false", "off"].includes(
    (process.env.KUMIX_WORKER_AUTO_RESUME ?? "").toLowerCase(),
  );
  for (const row of rows) {
    if (disabled) {
      setStreamStatus(row.id, "failed", {
        error: "Worker restarted while stream was running",
        stoppedAt: new Date().toISOString(),
      });
      continue;
    }
    try {
      await startStream(row.user_id, row.id);
    } catch {
      // startStream already recorded the failure cause on the row.
    }
  }
}

export async function stopAllStreams(): Promise<void> {
  const ids = [...running.keys()];
  await Promise.all(
    ids.map(async (id) => {
      try {
        await new Promise<void>((resolve) => {
          const entry = running.get(id);
          if (!entry) return resolve();
          const timer = setTimeout(() => {
            entry.child.kill("SIGKILL");
            resolve();
          }, 5000);
          entry.child.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
          entry.child.kill("SIGINT");
        });
      } finally {
        cleanup(id);
      }
    }),
  );
}

export function activeStreamCount(): number {
  return running.size;
}
