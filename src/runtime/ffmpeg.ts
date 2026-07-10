/**
 * FFmpeg and FFprobe binary resolution and runtime health helpers.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let cachedPaths: { ffmpegPath: string; ffprobePath: string } | null = null;
let cachedDetails: {
  ffmpeg: { path: string; version: string | null };
  ffprobe: { path: string; version: string | null };
} | null = null;

/**
 * Returns a binary path from an environment variable when it is set and points
 * to an existing file. Used to let operators override the bundled static
 * binaries with system FFmpeg/FFprobe (e.g. when the static build cannot
 * resolve DNS for RTMP output on a host).
 *
 * @param envVar - The environment variable name to read.
 * @returns The verified override path, or null when unset/missing.
 */
function envBinaryPath(
  envVar: "KUMIX_WORKER_FFMPEG_PATH" | "KUMIX_WORKER_FFPROBE_PATH",
): string | null {
  const value = process.env[envVar]?.trim();
  if (!value) return null;
  if (!existsSync(value)) {
    throw new Error(`${envVar} is set to "${value}" but no file exists at that path.`);
  }
  return value;
}

/**
 * Resolves the absolute binary path exported by a static FFmpeg dependency package.
 * Handles both string and `{ path }` module shapes.
 *
 * @param packageName - The dependency to resolve.
 * @returns The verified absolute path to the binary.
 * @throws If the binary path is missing or does not exist on disk.
 */
function requireBinaryPath(packageName: "ffmpeg-static" | "ffprobe-static"): string {
  const moduleValue = require(packageName) as string | { path?: string } | null;
  const binaryPath = typeof moduleValue === "string" ? moduleValue : moduleValue?.path;

  if (!binaryPath || !existsSync(binaryPath)) {
    throw new Error(`${packageName} binary is not available. Reinstall Kumix Worker dependencies.`);
  }

  return binaryPath;
}

/**
 * Resolves and caches the FFmpeg and FFprobe binary paths from dependencies.
 *
 * @returns The resolved binary paths.
 */
export function resolveFfmpegBinaries(): { ffmpegPath: string; ffprobePath: string } {
  if (cachedPaths) return cachedPaths;

  cachedPaths = {
    ffmpegPath: envBinaryPath("KUMIX_WORKER_FFMPEG_PATH") ?? requireBinaryPath("ffmpeg-static"),
    ffprobePath: envBinaryPath("KUMIX_WORKER_FFPROBE_PATH") ?? requireBinaryPath("ffprobe-static"),
  };

  return cachedPaths;
}

/**
 * Returns the absolute path to the FFmpeg binary.
 *
 * @returns The FFmpeg binary path.
 */
export function getFfmpegPath(): string {
  return resolveFfmpegBinaries().ffmpegPath;
}

/**
 * Returns the absolute path to the FFprobe binary.
 *
 * @returns The FFprobe binary path.
 */
export function getFfprobePath(): string {
  return resolveFfmpegBinaries().ffprobePath;
}

/**
 * Reads the first line of a binary's `-version` output.
 *
 * @param binaryPath - Path to the FFmpeg/FFprobe binary.
 * @returns The version string, or null if it could not be read.
 */
export function readBinaryVersion(binaryPath: string): string | null {
  const result = spawnSync(binaryPath, ["-version"], { encoding: "utf8", timeout: 5000 });
  const firstLine = (result.stdout ?? "").split(/\r?\n/)[0]?.trim();
  return firstLine || null;
}

/**
 * Resolves the binaries and reports their paths and version strings.
 * Used for health diagnostics.
 *
 * @returns The FFmpeg and FFprobe path/version details.
 */
export function resolveFfmpegBinaryDetails() {
  if (cachedDetails) return cachedDetails;

  const binaries = resolveFfmpegBinaries();
  cachedDetails = {
    ffmpeg: { path: binaries.ffmpegPath, version: readBinaryVersion(binaries.ffmpegPath) },
    ffprobe: { path: binaries.ffprobePath, version: readBinaryVersion(binaries.ffprobePath) },
  };
  return cachedDetails;
}

/**
 * Clears the cached binary paths. Intended for use in tests.
 */
export function resetFfmpegBinaryCacheForTests(): void {
  cachedPaths = null;
  cachedDetails = null;
}
