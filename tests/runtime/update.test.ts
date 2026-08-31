import { describe, expect, it } from "vitest";

import { compareVersions, parseVersion } from "../../src/runtime/update";

describe("parseVersion", () => {
  it("parses a simple semver string", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });

  it("strips pre-release and build suffixes", () => {
    expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersion("0.1.0+build.42")).toEqual([0, 1, 0]);
  });

  it("returns null for non-semver strings", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("returns zero for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("compares major version differences", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("compares minor version differences", () => {
    expect(compareVersions("1.3.0", "1.2.0")).toBeGreaterThan(0);
  });

  it("compares patch version differences", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
  });

  it("ignores pre-release suffixes in comparison", () => {
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
  });

  it("falls back to lexical comparison for non-semver strings", () => {
    expect(compareVersions("latest", "1.2.3")).not.toBe(0);
  });
});
