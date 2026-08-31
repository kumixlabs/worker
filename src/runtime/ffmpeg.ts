import { execFile } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

let cachedPaths: { ffmpegPath: string; ffprobePath: string } | null = null;

function envBinaryPath(
  envVar: "KUMIX_WORKER_FFMPEG_PATH" | "KUMIX_WORKER_FFPROBE_PATH",
): string | null {
  const value = process.env[envVar]?.trim();
  if (!value) return null;
  if (!existsSync(value)) {
    throw new Error(`${envVar} set to "${value}" but no file exists at path.`);
  }
  return value;
}

function requireBinaryPath(packageName: "ffmpeg-static" | "ffprobe-static"): string {
  const moduleValue = require(packageName) as string | { path?: string } | null;
  const binaryPath = typeof moduleValue === "string" ? moduleValue : moduleValue?.path;
  if (!binaryPath || !existsSync(binaryPath)) {
    throw new Error(`${packageName} binary is not available. Reinstall Kumix Worker dependencies.`);
  }
  return binaryPath;
}

export function resolveFfmpegBinaries(): { ffmpegPath: string; ffprobePath: string } {
  if (cachedPaths) return cachedPaths;
  cachedPaths = {
    ffmpegPath: envBinaryPath("KUMIX_WORKER_FFMPEG_PATH") ?? requireBinaryPath("ffmpeg-static"),
    ffprobePath: envBinaryPath("KUMIX_WORKER_FFPROBE_PATH") ?? requireBinaryPath("ffprobe-static"),
  };
  return cachedPaths;
}

export function getFfmpegPath(): string {
  return resolveFfmpegBinaries().ffmpegPath;
}

export function getFfprobePath(): string {
  return resolveFfmpegBinaries().ffprobePath;
}

export interface MediaProbeResult {
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
  formatName: string | null;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  bit_rate?: string;
}

interface FfprobeJson {
  format?: { duration?: string; bit_rate?: string; format_name?: string };
  streams?: FfprobeStream[];
}

function parseFps(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 100) / 100;
}

export async function probeMediaFile(filePath: string): Promise<MediaProbeResult | null> {
  try {
    const { stdout } = await execFileAsync(
      getFfprobePath(),
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const json = JSON.parse(stdout) as FfprobeJson;
    const video = json.streams?.find((s) => s.codec_type === "video");
    const audio = json.streams?.find((s) => s.codec_type === "audio");
    const duration = json.format?.duration ? Number(json.format.duration) : null;
    return {
      duration: duration && Number.isFinite(duration) ? duration : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: parseFps(video?.avg_frame_rate),
      bitrate: json.format?.bit_rate ? Number(json.format.bit_rate) : null,
      formatName: json.format?.format_name ?? null,
      hasAudio: Boolean(audio),
    };
  } catch {
    return null;
  }
}

export async function generateThumbnail(filePath: string, outputPath: string): Promise<boolean> {
  // temp + rename so concurrent requests never observe a half-written jpeg
  const tmpPath = `${outputPath}.${process.pid}.tmp.jpg`;
  for (const seek of ["2", "0"]) {
    try {
      await execFileAsync(
        getFfmpegPath(),
        [
          "-nostdin",
          "-y",
          "-ss",
          seek,
          "-i",
          filePath,
          "-frames:v",
          "1",
          "-vf",
          "scale=320:-2",
          "-q:v",
          "4",
          tmpPath,
        ],
        { timeout: 60_000 },
      );
      if (existsSync(tmpPath)) {
        renameSync(tmpPath, outputPath);
        return true;
      }
    } catch {
      // try next seek offset
    }
  }
  try {
    rmSync(tmpPath, { force: true });
  } catch {
    // best effort
  }
  return false;
}
