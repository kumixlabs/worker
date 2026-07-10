import { describe, expect, it } from "vitest";

import { settingsPatchSchema } from "../../src/schemas/settings";
import { sourceCreateSchema } from "../../src/schemas/source";
import { streamCreateSchema } from "../../src/schemas/stream";
import { targetCreateSchema } from "../../src/schemas/target";

describe("Kumix Worker schemas", () => {
  it("validates URL sources", () => {
    expect(
      sourceCreateSchema.parse({
        kind: "url",
        name: "Intro video",
        url: "https://example.com/video.mp4",
      }),
    ).toEqual({
      kind: "url",
      name: "Intro video",
      url: "https://example.com/video.mp4",
    });
  });

  it("applies target defaults", () => {
    expect(
      targetCreateSchema.parse({
        label: "YouTube",
        streamKey: "abcd-efgh",
      }),
    ).toEqual({
      active: true,
      ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      label: "YouTube",
      streamKey: "abcd-efgh",
    });
  });

  it("applies stream defaults", () => {
    expect(
      streamCreateSchema.parse({
        sourceId: "src_123",
        targetId: "tgt_123",
        title: "Live test",
      }),
    ).toEqual({
      loop: true,
      recurrence: "none",
      sourceId: "src_123",
      targetId: "tgt_123",
      title: "Live test",
    });
  });

  it("rejects invalid settings", () => {
    expect(() => settingsPatchSchema.parse({ diskUsageLimitPercent: 200 })).toThrow();
    expect(() => settingsPatchSchema.parse({ diskUsageLimitPercent: 10 })).toThrow();
    expect(() => settingsPatchSchema.parse({ timezone: "" })).toThrow();
  });
});
