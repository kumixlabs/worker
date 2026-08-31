import { describe, expect, it } from "vitest";

import { settingsPatchSchema } from "../../src/schemas/settings";

describe("Kumix Worker schemas", () => {
  it("accepts valid settings patches", () => {
    expect(settingsPatchSchema.parse({ timezone: "Asia/Jakarta" })).toEqual({
      timezone: "Asia/Jakarta",
    });
  });

  it("rejects invalid timezones", () => {
    expect(() => settingsPatchSchema.parse({ timezone: "Not/AZone" })).toThrow();
  });
});
