import { describe, expect, it } from "vitest";

import {
  buildCli,
  readPackageVersion,
  sourceCreateSchema,
  streamCreateSchema,
  targetCreateSchema,
} from "../src/index";

describe("public package exports", () => {
  it("exports the CLI program factory and version", () => {
    expect(typeof buildCli).toBe("function");
    expect(buildCli().name()).toBe("kumix-worker");
    expect(typeof readPackageVersion()).toBe("string");
  });

  it("exports schemas needed by public consumers", () => {
    expect(
      sourceCreateSchema.safeParse({ kind: "url", name: "Video", url: "https://example.com/a.mp4" })
        .success,
    ).toBe(true);
    expect(
      targetCreateSchema.safeParse({
        label: "RTMP",
        ingestUrl: "rtmp://live.com",
        streamKey: "xyz",
      }).success,
    ).toBe(true);
    expect(
      streamCreateSchema.safeParse({ title: "Live", sourceId: "src_1", targetId: "tgt_1" }).success,
    ).toBe(true);
  });
});
