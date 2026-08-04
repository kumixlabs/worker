/**
 * Media probing and checksum helpers backed by FFprobe.
 */

import { spawn } from "node:child_process";
import { rename, stat, unlink } from "node:fs/promises";

import { addEvent } from "../db/events";
import { getSource, updateSourceProbe } from "../db/sources";
import { getFfmpegPath, getFfprobePath } from "../runtime/ffmpeg";

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
  };
}

/**
 * Validates that a probed file has both video and audio streams.
 * Codec and bitrate are not checked here because normalization transcodes
 * everything to H.264/AAC with a controlled bitrate.
 *
 * @param probe - The parsed probe result.
 * @returns A human-readable reason when invalid, otherwise null.
 */
export function getInvalidProbeReason(probe: ProbeResult): string | null {
  if (!probe.videoCodec) return "No video stream found";
  if (!probe.audioCodec) return "No audio stream found";
  return null;
}

/**
 * Spawns ffprobe against a local file and resolves with parsed media metadata.
 *
 * @param filePath - Absolute path to the media file.
 * @returns The parsed probe result.
 * @throws If ffprobe exits non-zero or cannot be spawned.
 */
export function ffprobe(filePath: string, signal?: AbortSignal): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
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
}

/**
 * Builds FFmpeg arguments to transcode a source file to YouTube-safe H.264/AAC
 * with a fixed 2-second GOP (keyframe interval) so YouTube does not complain
 * about infrequent keyframes. Video is always re-encoded so the output is
 * normalized regardless of the input codec or GOP.
 *
 * @param inputPath - Source file to transcode.
 * @param outputPath - Destination for the normalized file.
 * @param fps - Frames per second from probe (defaults to 30).
 * @returns Ordered FFmpeg CLI arguments.
 */
export function buildNormalizeArgs(input: {
  inputPath: string;
  outputPath: string;
  fps: number;
}): string[] {
  const gop = Math.max(1, Math.round(input.fps * 2));
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

/**
 * Transcodes a downloaded source file in-place to YouTube-safe H.264/AAC with
 * a 2-second keyframe interval. Writes to a temporary file then atomically
 * replaces the original.
 *
 * @param filePath - Absolute path to the downloaded source file.
 * @param fps - Framerate from probe (defaults to 30).
 * @returns The same filePath after normalization.
 */
async function normalizeSource(filePath: string, fps: number): Promise<void> {
  const tempPath = `${filePath}.normalized.mp4`;
  const args = buildNormalizeArgs({
    inputPath: filePath,
    outputPath: tempPath,
    fps: fps > 0 ? fps : 30,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(getFfmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `ffmpeg normalize exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });

    await unlink(filePath);
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Probes a downloaded source file, normalizes it to YouTube-safe encoding,
 * and persists the result. Marks the source ready or invalid.
 *
 * @param sourceId - The source record ID to update.
 * @param filePath - Absolute path to the downloaded file.
 * @returns The updated source record.
 */
export async function probeAndUpdateSource(sourceId: string, filePath: string) {
  if (!getSource(sourceId)) return null;
  updateSourceProbe(sourceId, { status: "probing", filePath });

  let probe: ProbeResult;
  try {
    probe = await ffprobe(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ffprobe failed";
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason: message,
      filePath,
    });
  }

  const invalidReason = getInvalidProbeReason(probe);
  if (invalidReason) {
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason,
      ...probe,
      filePath,
    });
  }

  if (!getSource(sourceId)) {
    await unlink(filePath).catch(() => undefined);
    return null;
  }

  updateSourceProbe(sourceId, { status: "normalizing", filePath });
  try {
    await normalizeSource(filePath, probe.fps ?? 30);
  } catch (error) {
    const message = error instanceof Error ? error.message : "normalize failed";
    addEvent(null, "source_warning", `Source normalization failed: ${message}`, { sourceId });
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason: message,
      filePath,
    });
  }

  if (!getSource(sourceId)) {
    await unlink(filePath).catch(() => undefined);
    return null;
  }

  const [normalizedProbe, fileStat] = await Promise.all([ffprobe(filePath), stat(filePath)]);
  return updateSourceProbe(sourceId, {
    status: "ready",
    ...normalizedProbe,
    sizeBytes: fileStat.size,
    sha256: null,
    filePath,
  });
}
