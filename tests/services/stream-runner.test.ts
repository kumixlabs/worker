import { describe, expect, it } from "vitest";

import { buildFfmpegArgs, parseMetrics, redactFfmpegLog } from "../../src/services/stream-runner";

describe("FFmpeg runner helpers", () => {
  it("parses ffmpeg metrics incrementally", () => {
    const first = parseMetrics("frame=10 fps=29.97 bitrate=2500.5kbits/s drop=2", null);
    expect(first).toEqual({ bitrateKbps: 2500.5, droppedFrames: 2, fps: 29.97 });

    const second = parseMetrics("frame=11 fps=30.01", first);
    expect(second).toEqual({ bitrateKbps: 2500.5, droppedFrames: 2, fps: 30.01 });
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
        loop: true,
        streamKey: "secret-key",
      }),
    ).toEqual([
      "-hide_banner",
      "-loglevel",
      "info",
      "-stream_loop",
      "-1",
      "-re",
      "-i",
      "/video.mp4",
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-f",
      "flv",
      "rtmp://a.rtmp.youtube.com/live2/secret-key",
    ]);
  });
});
