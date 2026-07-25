import { describe, expect, it } from "vitest";

import {
  DEFAULT_DASHBOARD_PASSWORD,
  defaultPasswordHash,
  hashPassword,
  isDefaultPasswordHash,
  isPasswordHash,
  validPassword,
  verifyPassword,
} from "../../src/lib/password";

describe("password helpers", () => {
  it("hashes and verifies the factory default", async () => {
    const hash = await hashPassword(DEFAULT_DASHBOARD_PASSWORD);
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword(DEFAULT_DASHBOARD_PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("rejects short passwords and the factory default", () => {
    expect(() => validPassword("12345")).toThrow(/6-128/);
    expect(() => validPassword(DEFAULT_DASHBOARD_PASSWORD)).toThrow(/factory default/);
    expect(validPassword("newpass1")).toBe("newpass1");
  });

  it("defaultPasswordHash returns a valid hash for the default password", async () => {
    const hash = defaultPasswordHash();
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword(DEFAULT_DASHBOARD_PASSWORD, hash)).toBe(true);
  });

  it("isDefaultPasswordHash returns true for default and false after change", async () => {
    const defaultHash = defaultPasswordHash();
    expect(await isDefaultPasswordHash(defaultHash)).toBe(true);

    const customHash = await hashPassword("custom-password-123");
    expect(await isDefaultPasswordHash(customHash)).toBe(false);
  });

  it("isDefaultPasswordHash caches result for repeated calls", async () => {
    const hash = defaultPasswordHash();
    const first = await isDefaultPasswordHash(hash);
    const second = await isDefaultPasswordHash(hash);
    expect(first).toBe(second);
    expect(first).toBe(true);
  });

  it("rejects corrupt scrypt parameters", async () => {
    expect(await verifyPassword("pw", "scrypt$999$r$p$salt$hash")).toBe(false);
    expect(await verifyPassword("pw", "scrypt$16384$8$1$$hash")).toBe(false);
    expect(await verifyPassword("pw", "scrypt$16384$8$1$salt$")).toBe(false);
    expect(await verifyPassword("pw", "not-a-hash")).toBe(false);
    expect(await verifyPassword("pw", "")).toBe(false);
  });

  it("isPasswordHash rejects malformed values", () => {
    expect(isPasswordHash("")).toBe(false);
    expect(isPasswordHash("plaintext")).toBe(false);
    expect(isPasswordHash("scrypt$16384$8$1")).toBe(false);
    expect(isPasswordHash(123)).toBe(false);
    expect(isPasswordHash(null)).toBe(false);
  });
});
