import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  getFfmpegPath,
  getFfprobePath,
  readBinaryVersion,
  resetFfmpegBinaryCacheForTests,
  resolveFfmpegBinaries,
  resolveFfmpegBinaryDetails,
} from "../../src/runtime/ffmpeg";

describe("FFmpeg binary resolver", () => {
  afterEach(() => {
    delete process.env.KUMIX_WORKER_FFMPEG_PATH;
    delete process.env.KUMIX_WORKER_FFPROBE_PATH;
    resetFfmpegBinaryCacheForTests();
  });

  it("resolves FFmpeg and FFprobe from dependencies", () => {
    const binaries = resolveFfmpegBinaries();

    expect(existsSync(binaries.ffmpegPath)).toBe(true);
    expect(existsSync(binaries.ffprobePath)).toBe(true);
    expect(getFfmpegPath()).toBe(binaries.ffmpegPath);
    expect(getFfprobePath()).toBe(binaries.ffprobePath);
  });

  it("prefers KUMIX_WORKER_FFMPEG_PATH/KUMIX_WORKER_FFPROBE_PATH overrides when the files exist", () => {
    const fallback = resolveFfmpegBinaries();
    resetFfmpegBinaryCacheForTests();
    process.env.KUMIX_WORKER_FFMPEG_PATH = fallback.ffprobePath;
    process.env.KUMIX_WORKER_FFPROBE_PATH = fallback.ffmpegPath;

    const overridden = resolveFfmpegBinaries();

    expect(overridden.ffmpegPath).toBe(fallback.ffprobePath);
    expect(overridden.ffprobePath).toBe(fallback.ffmpegPath);
  });

  it("throws when an override path does not exist", () => {
    process.env.KUMIX_WORKER_FFMPEG_PATH = "/nonexistent/forge/ffmpeg";

    expect(() => resolveFfmpegBinaries()).toThrow("KUMIX_WORKER_FFMPEG_PATH");
  });

  it("reads binary version details when binaries are executable", () => {
    const details = resolveFfmpegBinaryDetails();
    const ffmpegVersion = readBinaryVersion(details.ffmpeg.path);
    const ffprobeVersion = readBinaryVersion(details.ffprobe.path);

    expect(details.ffmpeg.version).toBe(ffmpegVersion);
    expect(details.ffprobe.version).toBe(ffprobeVersion);
    if (ffmpegVersion) expect(ffmpegVersion).toContain("ffmpeg");
    if (ffprobeVersion) expect(ffprobeVersion).toContain("ffprobe");
  });
});
