/**
 * Dashboard password hashing (scrypt). Separate from the worker API token,
 * which remains the AES/HMAC secret for stream keys and signed URLs.
 */

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

/** Factory-default dashboard password for first run and config migration. */
export const DEFAULT_DASHBOARD_PASSWORD = "123456";

const keyLength = 64;
const scryptParams = { N: 16384, r: 8, p: 1 } as const;

/** Async scrypt wrapper that offloads hashing from the event loop. */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Allowed scrypt cost parameters (reject malicious/corrupt config DoS). */
const allowedScryptN = new Set([16384, 32768]);
const allowedScryptR = new Set([8]);
const allowedScryptP = new Set([1]);

/**
 * Pre-computed default hash generated once at module load so the sync config
 * helpers (normalizeSettings / writeSettings) never block the event loop at
 * runtime. The random salt means it differs every boot, but it is only
 * persisted on the very first run; subsequent boots read the stored hash.
 */
const precomputedDefaultHash: string = (() => {
  const salt = randomBytes(16);
  const hash = scryptSync(DEFAULT_DASHBOARD_PASSWORD, salt, keyLength, scryptParams);
  return `scrypt$${scryptParams.N}$${scryptParams.r}$${scryptParams.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
})();

/**
 * Returns the pre-computed factory-default password hash. Used by sync config
 * helpers to avoid blocking the event loop with scryptSync at runtime.
 *
 * @returns A scrypt hash string for the default password.
 */
export function defaultPasswordHash(): string {
  return precomputedDefaultHash;
}

/**
 * Validates a dashboard password for set/change flows.
 *
 * @param value - Candidate password.
 * @returns The trimmed password.
 */
export function validPassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid password. Expected a string.");
  }
  if (value.length < 6 || value.length > 128) {
    throw new Error("Invalid password. Expected 6-128 characters.");
  }
  if (value === DEFAULT_DASHBOARD_PASSWORD) {
    throw new Error("Password must not be the factory default.");
  }
  return value;
}

/**
 * Hashes a password with a random salt using async scrypt.
 *
 * @param password - Plaintext password.
 * @returns Encoded `scrypt$N$r$p$salt$hash` string.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, keyLength, scryptParams);
  return `scrypt$${scryptParams.N}$${scryptParams.r}$${scryptParams.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/**
 * Whether a stored value looks like a scrypt password hash from this module.
 *
 * @param value - Stored config field.
 * @returns True when the format is recognized.
 */
export function isPasswordHash(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("$");
  return parts.length === 6 && parts[0] === "scrypt" && Boolean(parts[4] && parts[5]);
}

/**
 * Verifies a plaintext password against a stored scrypt hash using async scrypt.
 *
 * @param password - Candidate plaintext.
 * @param stored - Value from config.passwordHash.
 * @returns True on match.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = stored.split("$");
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    !allowedScryptN.has(N) ||
    !allowedScryptR.has(r) ||
    !allowedScryptP.has(p) ||
    !saltB64 ||
    !hashB64
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");
    if (expected.length === 0 || salt.length === 0) return false;
    const actual = await scryptAsync(password, salt, expected.length, { N, r, p });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Cached result for isDefaultPasswordHash to avoid repeated scrypt on hot paths. */
let defaultCheckCache: { hash: string; result: boolean } | null = null;

/**
 * Whether the stored hash still verifies the factory-default dashboard password.
 * Results are cached per hash string so repeated /api/settings calls don't re-run scrypt.
 *
 * @param stored - Value from config.passwordHash.
 * @returns True when operators have not changed the default password.
 */
export async function isDefaultPasswordHash(stored: string): Promise<boolean> {
  if (defaultCheckCache?.hash === stored) return defaultCheckCache.result;
  const result = await verifyPassword(DEFAULT_DASHBOARD_PASSWORD, stored);
  defaultCheckCache = { hash: stored, result };
  return result;
}
