import { describe, expect, it } from "vitest";

import { getInvalidProbeReason, parseFfprobeJson } from "../../src/services/probe";

describe("probe helpers", () => {
  it("parses ffprobe json", () => {
    expect(
      parseFfprobeJson(
        JSON.stringify({
          format: { duration: "60.4" },
          streams: [
            {
              bit_rate: "4500000",
              codec_name: "h264",
              codec_type: "video",
              height: 1080,
              r_frame_rate: "30000/1001",
              width: 1920,
            },
            { codec_name: "aac", codec_type: "audio" },
          ],
        }),
      ),
    ).toEqual({
      audioCodec: "aac",
      durationSec: 60,
      fps: 29.97,
      height: 1080,
      videoBitrate: 4500,
      videoCodec: "h264",
      width: 1920,
    });
  });

  it("validates codec and bitrate constraints", () => {
    expect(
      getInvalidProbeReason({
        audioCodec: "aac",
        durationSec: 1,
        fps: 30,
        height: 720,
        videoBitrate: 5000,
        videoCodec: "h264",
        width: 1280,
      }),
    ).toBeNull();
    expect(
      getInvalidProbeReason({
        audioCodec: "aac",
        durationSec: 1,
        fps: 30,
        height: 720,
        videoBitrate: 5000,
        videoCodec: "vp9",
        width: 1280,
      }),
    ).toBe("Unsupported video codec: vp9");
    expect(
      getInvalidProbeReason({
        audioCodec: "opus",
        durationSec: 1,
        fps: 30,
        height: 720,
        videoBitrate: 5000,
        videoCodec: "h264",
        width: 1280,
      }),
    ).toBe("Unsupported audio codec: opus");
    expect(
      getInvalidProbeReason({
        audioCodec: "aac",
        durationSec: 1,
        fps: 30,
        height: 720,
        videoBitrate: 35_000,
        videoCodec: "h264",
        width: 1280,
      }),
    ).toBeNull();
    expect(
      getInvalidProbeReason({
        audioCodec: "aac",
        durationSec: 1,
        fps: 30,
        height: 720,
        videoBitrate: 35_001,
        videoCodec: "h264",
        width: 1280,
      }),
    ).toBe("Video bitrate too high: 35001 kbps (max 35000 kbps)");
  });
});
