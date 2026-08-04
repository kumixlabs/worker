import { describe, expect, it } from "vitest";

import {
  buildNormalizeArgs,
  getInvalidProbeReason,
  parseFfprobeJson,
} from "../../src/services/probe";

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

  it("validates video and audio stream presence", () => {
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
    ).toBeNull();
    expect(
      getInvalidProbeReason({
        audioCodec: null,
        durationSec: 1,
        fps: 30,
        height: 720,
        videoBitrate: 5000,
        videoCodec: "h264",
        width: 1280,
      }),
    ).toBe("No audio stream found");
    expect(
      getInvalidProbeReason({
        audioCodec: "aac",
        durationSec: 1,
        fps: 30,
        height: 720,
        videoBitrate: null,
        videoCodec: null,
        width: 1280,
      }),
    ).toBe("No video stream found");
  });

  it("builds normalize args with 2-second GOP", () => {
    const args = buildNormalizeArgs({
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output.mp4",
      fps: 30,
    });
    const gIdx = args.indexOf("-g");
    expect(gIdx).toBeGreaterThan(-1);
    expect(args[gIdx + 1]).toBe("60");
    expect(args).toContain("libx264");
    expect(args).toContain("veryfast");
    expect(args).toContain("yuv420p");
  });

  it("builds normalize args with fallback fps for zero", () => {
    const args = buildNormalizeArgs({
      inputPath: "/tmp/in.mp4",
      outputPath: "/tmp/out.mp4",
      fps: 0,
    });
    const gIdx = args.indexOf("-g");
    expect(args[gIdx + 1]).toBe("1");
  });
});
