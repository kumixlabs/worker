import { describe, expect, it } from "vitest";

import { parseUserDateTime, zonedWeekday } from "../../src/lib/timezone";

describe("timezone helpers", () => {
  it("parses wall-clock input using the configured timezone", () => {
    expect(parseUserDateTime("2026-01-01T08:00", "Asia/Jakarta")).toBe("2026-01-01T01:00:00.000Z");
  });

  it("respects explicit UTC and offset input", () => {
    expect(parseUserDateTime("2026-01-01T08:00:00Z", "Asia/Jakarta")).toBe(
      "2026-01-01T08:00:00.000Z",
    );
    expect(parseUserDateTime("2026-01-01T08:00:00+07:00", "UTC")).toBe("2026-01-01T01:00:00.000Z");
  });

  it("handles midnight without shifting the day", () => {
    expect(parseUserDateTime("2026-03-01T00:00", "Asia/Jakarta")).toBe("2026-02-28T17:00:00.000Z");
  });

  it("returns null for empty values", () => {
    expect(parseUserDateTime(null, "Asia/Jakarta")).toBeNull();
    expect(parseUserDateTime(undefined, "Asia/Jakarta")).toBeNull();
    expect(parseUserDateTime("", "Asia/Jakarta")).toBeNull();
  });

  it("reads weekday in the target timezone", () => {
    expect(zonedWeekday(new Date("2026-01-01T20:00:00.000Z"), "Asia/Jakarta")).toBe(5);
  });
});
