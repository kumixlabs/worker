/**
 * HTTP response helpers and token authentication middleware.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { Context, Next } from "hono";

import { verifySignedUrl } from "../lib/signed-url";
import { readSettings } from "../runtime/config";

const authFailures = new Map<string, { count: number; resetAt: number }>();
const publicApiHits = new Map<string, { count: number; resetAt: number }>();
const authWindowMs = 60_000;
const authMaxFailures = 30;
const publicApiWindowMs = 60_000;
const publicApiMaxRequests = 120;

function pruneExpiredBuckets(
  map: Map<string, { count: number; resetAt: number }>,
  now: number,
): void {
  if (map.size < 1024) return;
  for (const [key, bucket] of map) {
    if (bucket.resetAt <= now) map.delete(key);
  }
}

/**
 * Clears the in-memory rate-limit buckets. Intended for test isolation so
 * state does not leak between cases.
 */
export function resetRateLimitsForTests(): void {
  authFailures.clear();
  publicApiHits.clear();
}

/**
 * Whether forwarded client-IP headers should be trusted. Disabled by default
 * because the worker binds to localhost; spoofed headers would otherwise let a
 * caller evade or poison the rate-limit buckets. Enable only when running
 * behind a known reverse proxy that sets these headers. Read on each call so
 * tests and runtime toggles take effect without a module reload.
 *
 * @returns True when forwarded client-IP headers should be trusted.
 */
function isTrustProxyEnabled(): boolean {
  return process.env.KUMIX_WORKER_TRUST_PROXY === "1";
}

/**
 * Derives a rate-limit bucket key from the request's socket address. When a
 * trusted proxy is configured, the forwarded client IP is used instead.
 *
 * @param c - The Hono request context.
 * @returns The bucket key used to track auth failures.
 */
function requestKey(c: Context): string {
  const remote = c.env?.incoming?.socket?.remoteAddress ?? "local";
  if (!isTrustProxyEnabled()) return remote;
  const xff = c.req.header("x-forwarded-for");
  const forwarded =
    c.req.header("x-real-ip") || xff?.split(",")[0]?.trim() || c.req.header("CF-Connecting-IP");
  return forwarded || remote;
}

/**
 * Compares a candidate token against the expected worker token using constant-time comparison.
 *
 * @param token - The candidate token from the request.
 * @param expected - The expected token (defaults to the current settings token).
 * @returns True when the tokens match.
 */
export function verifyToken(token: string, expected = readSettings().token): boolean {
  if (!token || !expected) return false;
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

/** Extracts the Bearer token from the Authorization header. */
function requestToken(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer || "";
}

/** Checks whether the request carries a valid signed URL for an allowed path. */
function signedRequest(c: Context): boolean {
  const url = new URL(c.req.url);
  const signature = url.searchParams.get("sig");
  const expiresAt = url.searchParams.get("expires");
  const isSignablePath =
    /^\/api\/events\/(export|stream)$/.test(url.pathname) ||
    /^\/api\/streams\/[A-Za-z0-9_-]+\/events\/(export|stream)$/.test(url.pathname) ||
    /^\/api\/sources\/[A-Za-z0-9_-]+\/preview$/.test(url.pathname);
  if (!signature || !expiresAt || !isSignablePath) return false;
  return verifySignedUrl(c.req.method, url.pathname + url.search, expiresAt, signature);
}

/**
 * Checks whether a client has exceeded the invalid-auth-attempt threshold.
 * Intended for routes that validate tokens themselves (e.g. `/auth`,
 * `/api/auth/verify`) and therefore bypass the full `tokenAuth` middleware.
 *
 * @param c - The Hono request context.
 * @returns A 429 JSON Response when rate-limited, otherwise null.
 */
export function checkAuthRateLimit(c: Context): Response | null {
  const key = requestKey(c);
  const now = Date.now();
  pruneExpiredBuckets(authFailures, now);
  const current = authFailures.get(key);
  if (current && current.resetAt > now && current.count >= authMaxFailures) {
    return Response.json(
      { ok: false, error: { code: "RATE_LIMITED", message: "Too many invalid token attempts" } },
      { status: 429 },
    );
  }
  return null;
}

/**
 * Records an invalid auth attempt for a client. Pairs with checkAuthRateLimit
 * for routes that do their own token validation.
 *
 * @param c - The Hono request context.
 */
export function recordAuthFailure(c: Context): void {
  const key = requestKey(c);
  const now = Date.now();
  const current = authFailures.get(key);
  const bucket =
    current && current.resetAt > now ? current : { count: 0, resetAt: now + authWindowMs };
  bucket.count += 1;
  authFailures.set(key, bucket);
}

/**
 * Clears the auth failure counter for a client after a successful auth.
 *
 * @param c - The Hono request context.
 */
export function clearAuthRateLimit(c: Context): void {
  authFailures.delete(requestKey(c));
}

/**
 * Hono middleware that authenticates requests against the worker token.
 * Accepts a Bearer header or a valid signed URL, and rate-limits clients that
 * exceed the invalid-attempt threshold within the rolling window.
 *
 * @param c - The Hono request context.
 * @param next - The next handler in the chain.
 * @returns A 401/429 JSON response on failure, otherwise passes control on.
 */
export async function tokenAuth(c: Context, next: Next) {
  const limited = checkAuthRateLimit(c);
  if (limited) return limited;

  if (!verifyToken(requestToken(c)) && !signedRequest(c)) {
    recordAuthFailure(c);
    return c.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid Kumix Worker token" } },
      401,
    );
  }
  clearAuthRateLimit(c);
  await next();
}

/**
 * Hono middleware that rate-limits `/api/v1/*` requests per client+token.
 *
 * @param c - The Hono request context.
 * @param next - The next handler in the chain.
 * @returns A 429 JSON response when the limit is exceeded, otherwise passes control on.
 */
export async function publicApiRateLimit(c: Context, next: Next) {
  const tokenHash = createHash("sha256").update(requestToken(c)).digest("hex").slice(0, 16);
  const key = `${requestKey(c)}:${tokenHash}`;
  const now = Date.now();
  pruneExpiredBuckets(publicApiHits, now);
  const current = publicApiHits.get(key);
  const bucket =
    current && current.resetAt > now ? current : { count: 0, resetAt: now + publicApiWindowMs };
  bucket.count += 1;
  publicApiHits.set(key, bucket);
  if (bucket.count > publicApiMaxRequests) {
    return c.json(
      { ok: false, error: { code: "RATE_LIMITED", message: "Too many worker API requests" } },
      429,
    );
  }
  await next();
  // Drop the bucket once the window closes so idle clients don't linger in the
  // map until the 1024-entry prune sweep triggers.
  if (bucket.resetAt <= Date.now()) publicApiHits.delete(key);
}

/**
 * Wraps a payload in the standard success envelope.
 *
 * @param data - The response data.
 * @returns The `{ ok: true, data }` envelope.
 */
export function ok<T>(data: T) {
  return { ok: true as const, data };
}

/**
 * Builds a standard JSON error response with the given status code.
 *
 * @param code - A machine-readable error code.
 * @param message - A human-readable error message.
 * @param status - The HTTP status code (default 400).
 * @returns A JSON Response carrying the error envelope.
 */
export function fail(code: string, message: string, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
