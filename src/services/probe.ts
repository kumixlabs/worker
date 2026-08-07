/**
 * Media probing and checksum helpers backed by FFprobe.
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import { getSource, updateSourceProbe } from "../db/sources";
import { getFfprobePath } from "../runtime/ffmpeg";

/**
 * Normalized media metadata returned by FFprobe.
 */
export interface ProbeResult {
  durationSec: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  videoBitrate: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  keyframeInterval: number | null;
}

/**
 * Parses raw ffprobe JSON output into a normalized ProbeResult.
 *
 * @param stdout - The ffprobe JSON stdout string.
 * @returns The extracted media metadata.
 */
export function parseFfprobeJson(stdout: string): ProbeResult {
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      bit_rate?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const fps = (() => {
    const [left, right] = (video?.r_frame_rate ?? "").split("/").map(Number);
    if (!left || !right) return null;
    return Math.round((left / right) * 100) / 100;
  })();
  const rawBitrate = video?.bit_rate ?? parsed.format?.bit_rate;
  return {
    durationSec: parsed.format?.duration ? Math.round(Number(parsed.format.duration)) : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoBitrate: rawBitrate ? Math.round(Number(rawBitrate) / 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps,
    keyframeInterval: null,
  };
}

const maxYouTubeVideoBitrateKbps = 35_000;

/**
 * Validates probe results against streaming requirements.
 * Requires H.264 video, AAC audio, and a YouTube-compatible video bitrate.
 *
 * @param probe - The parsed probe result.
 * @returns A human-readable reason when invalid, otherwise null.
 */
export function getInvalidProbeReason(probe: ProbeResult): string | null {
  const video = (probe.videoCodec ?? "").toLowerCase();
  const audio = (probe.audioCodec ?? "").toLowerCase();
  return !["h264", "avc1"].includes(video)
    ? `Unsupported video codec: ${video || "unknown"}`
    : !["aac", "mp4a"].includes(audio)
      ? `Unsupported audio codec: ${audio || "unknown"}`
      : probe.videoBitrate && probe.videoBitrate > maxYouTubeVideoBitrateKbps
        ? `Video bitrate too high: ${probe.videoBitrate} kbps (max ${maxYouTubeVideoBitrateKbps} kbps)`
        : null;
}

/**
 * Probes the average keyframe interval (in seconds) by sampling the first 11
 * keyframe packets of the video stream. Returns null if it cannot be determined.
 *
 * @param filePath - Absolute path to the media file.
 * @returns The average interval between keyframes, or null.
 */
function probeKeyframeInterval(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,flags",
      "-of",
      "csv=p=0",
      filePath,
    ];
    const child = spawn(getFfprobePath(), args);
    const keyframeTimes: number[] = [];
    let leftover = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve(null);
    }, 15_000);
    timer.unref?.();

    child.stdout.on("data", (chunk: Buffer) => {
      leftover += chunk.toString();
      const lines = leftover.split("\n");
      leftover = lines.pop() ?? "";

      for (const line of lines) {
        const parts = line.trim().split(",");
        if (parts.length >= 2 && parts[1].includes("K")) {
          const t = Number.parseFloat(parts[0]);
          if (!Number.isNaN(t)) keyframeTimes.push(t);
        }
        if (keyframeTimes.length >= 11) {
          child.kill("SIGKILL");
          return;
        }
      }
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const times = keyframeTimes;
      if (times.length < 2) {
        resolve(null);
        return;
      }
      const intervals: number[] = [];
      for (let i = 1; i < times.length; i++) {
        intervals.push(times[i] - times[i - 1]);
      }
      const avg = intervals.reduce((sum, n) => sum + n, 0) / intervals.length;
      resolve(Math.round(avg * 100) / 100);
    });
  });
}

/**
 * Spawns ffprobe against a local file and resolves with parsed media metadata.
 *
 * @param filePath - Absolute path to the media file.
 * @returns The parsed probe result.
 * @throws If ffprobe exits non-zero or cannot be spawned.
 */
export async function ffprobe(filePath: string, signal?: AbortSignal): Promise<ProbeResult> {
  const result = await new Promise<ProbeResult>((resolve, reject) => {
    const child = spawn(getFfprobePath(), [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("ffprobe aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("ffprobe timed out"));
    }, 30_000);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (code !== 0) {
        reject(new Error(stderr || "ffprobe failed"));
        return;
      }
      resolve(parseFfprobeJson(stdout));
    });
  });
  result.keyframeInterval = await probeKeyframeInterval(filePath);
  return result;
}

/**
 * Probes a downloaded source file, validates it, and persists the result.
 * Marks the source ready or invalid based on codec/bitrate checks.
 *
 * @param sourceId - The source record ID to update.
 * @param filePath - Absolute path to the downloaded file.
 * @returns The updated source record.
 */
export async function probeAndUpdateSource(sourceId: string, filePath: string) {
  try {
    if (!getSource(sourceId)) return null;
    updateSourceProbe(sourceId, { status: "probing", filePath });
    const [probe, fileStat] = await Promise.all([ffprobe(filePath), stat(filePath)]);
    const invalidReason = getInvalidProbeReason(probe);
    return updateSourceProbe(sourceId, {
      status: invalidReason ? "invalid" : "ready",
      invalidReason,
      ...probe,
      sizeBytes: fileStat.size,
      sha256: null,
      filePath,
    });
  } catch (error) {
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason: error instanceof Error ? error.message : "ffprobe failed",
      filePath,
    });
  }
}
