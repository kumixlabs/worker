import { describe, expect, it } from "vitest";

import {
  createCliProgram,
  createWorkerClient,
  maskToken,
  sourceCreateSchema,
  tokenRotateSchema,
  workerDashboardUrl,
} from "../src/index";

describe("public package exports", () => {
  it("exports the CLI program factory", () => {
    expect(typeof createCliProgram).toBe("function");
    expect(createCliProgram().name()).toBe("forge-worker");
  });

  it("exports the token mask helper", () => {
    expect(maskToken("abcdef1234567890")).toBe("abcdef...7890");
  });

  it("exports schemas needed by web consumers", () => {
    expect(
      sourceCreateSchema.safeParse({ kind: "url", name: "Video", url: "https://example.com/a.mp4" })
        .success,
    ).toBe(true);
    expect(tokenRotateSchema.safeParse({ token: "new-token-123456789" }).success).toBe(true);
  });

  it("exports worker client helpers", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            agentVersion: "0.1.0",
            ffmpeg: true,
            ffprobe: true,
            status: "ok",
            streamsRunning: 0,
            uptimeSec: 1,
          },
        }),
        { status: 200 },
      );
    const client = createWorkerClient({
      baseUrl: "http://127.0.0.1:8080/",
      fetch: fetcher as typeof fetch,
      token: "test-token-123456",
    });

    expect(workerDashboardUrl("http://127.0.0.1:8080/", "token value")).toBe(
      "http://127.0.0.1:8080/auth?token=token%20value",
    );
    await expect(client.health()).resolves.toEqual({
      agentVersion: "0.1.0",
      ffmpeg: true,
      ffprobe: true,
      status: "ok",
      streamsRunning: 0,
      uptimeSec: 1,
    });
  });
});
