import { describe, expect, it } from "vitest";

import {
  buildFfmpegArgs,
  isFfmpegProgressLine,
  parseMetrics,
  redactFfmpegLog,
} from "../../src/services/stream-runner";

describe("FFmpeg runner helpers", () => {
  it("parses ffmpeg metrics incrementally", () => {
    const first = parseMetrics("frame=10 fps=29.97 bitrate=2500.5kbits/s drop=2", null);
    expect(first).toEqual({ bitrateKbps: 2500.5, droppedFrames: 2, fps: 29.97 });

    const second = parseMetrics("frame=11 fps=30.01", first);
    expect(second).toEqual({ bitrateKbps: 2500.5, droppedFrames: 2, fps: 30.01 });
  });

  it("detects progress lines so they are never stored as events", () => {
    expect(isFfmpegProgressLine("frame=489364 fps= 30 q=-1.0 size=19816332kB")).toBe(true);
    expect(isFfmpegProgressLine("  fps=30 bitrate=9952.1kbits/s")).toBe(true);
    expect(isFfmpegProgressLine("Non-monotonous DTS in output stream 0:0")).toBe(false);
  });

  it("redacts stream keys from ffmpeg logs", () => {
    expect(redactFfmpegLog("rtmp://a.rtmp.youtube.com/live2/secret-key frame=1")).toContain(
      "rtmp://a.rtmp.youtube.com/live2/[redacted]",
    );
  });

  it("builds ffmpeg args", () => {
    expect(
      buildFfmpegArgs({
        filePath: "/video.mp4",
        ingestUrl: "rtmp://a.rtmp.youtube.com/live2/",
        streamKey: "secret-key",
      }),
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "info",
      "-stream_loop",
      "-1",
      "-fflags",
      "+genpts",
      "-probesize",
      "32",
      "-analyzeduration",
      "0",
      "-re",
      "-i",
      "/video.mp4",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-af",
      "aresample=async=1:first_pts=0",
      "-flvflags",
      "no_duration_filesize",
      "-f",
      "flv",
      "rtmp://a.rtmp.youtube.com/live2/secret-key",
    ]);
  });
});
