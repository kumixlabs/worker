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
    expect(first).toEqual({
      bitrateKbps: 2500.5,
      droppedFrames: 2,
      fps: 29.97,
      totalBytes: null,
    });

    const second = parseMetrics("frame=11 fps=30.01", first);
    expect(second).toEqual({
      bitrateKbps: 2500.5,
      droppedFrames: 2,
      fps: 30.01,
      totalBytes: null,
    });
  });

  it("parses totalBytes from ffmpeg size field", () => {
    const result = parseMetrics("frame=100 fps=30 size=  51200kB bitrate=2000kbits/s", null);
    expect(result?.totalBytes).toBe(52_428_800);

    const mb = parseMetrics("frame=100 fps=30 size=10.5MB", null);
    expect(mb?.totalBytes).toBe(Math.round(10.5 * 1_048_576));
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
      "copy",
      "-flvflags",
      "no_duration_filesize",
      "-f",
      "flv",
      "rtmp://a.rtmp.youtube.com/live2/secret-key",
    ]);
  });
});
