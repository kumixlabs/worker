import { describe, expect, it } from "vitest";

import { createCliProgram, dashboardUrl, maskToken } from "../../src/cli";

describe("CLI", () => {
  it("uses kumix-worker as command name", () => {
    expect(createCliProgram().name()).toBe("kumix-worker");
  });

  it("masks tokens for status output", () => {
    expect(maskToken("short")).toBe("••••");
    expect(maskToken("abcdef1234567890")).toBe("abcdef...7890");
  });

  it("builds dashboard auth URLs", () => {
    expect(dashboardUrl("0.0.0.0", 8080)).toBe("http://localhost:8080");
    expect(dashboardUrl("192.0.2.10", 8080, "token with space")).toBe(
      "http://192.0.2.10:8080/auth?token=token%20with%20space",
    );
  });
});
