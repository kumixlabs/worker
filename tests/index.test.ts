import { describe, expect, it } from "vitest";

import { buildCli, readPackageVersion } from "../src/index";

describe("public package exports", () => {
  it("exports the CLI program factory and version", () => {
    expect(typeof buildCli).toBe("function");
    expect(buildCli().name()).toBe("kumix-worker");
    expect(typeof readPackageVersion()).toBe("string");
  });
});
