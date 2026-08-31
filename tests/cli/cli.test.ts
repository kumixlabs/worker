import { describe, expect, it } from "vitest";

import { buildCli } from "../../src/cli";

describe("CLI", () => {
  it("uses kumix-worker as command name", () => {
    expect(buildCli().name()).toBe("kumix-worker");
  });
});
