/**
 * HTTP response helpers and token authentication middleware.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { Context, Next } from "hono";

import { verifySignedUrl } from "../lib/signed-url";
import { readSettings } from "../runtime/config";

const authFailures = new Map<string, { count: number; resetAt: number }>();
const webApiHits = new Map<string, { count: number; resetAt: number }>();
const authWindowMs = 60_000;
const authMaxFailures = 30;
const webApiWindowMs = 60_000;
const webApiMaxRequests = 120;

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
  webApiHits.clear();
}

/**
 * Whether forwarded client-IP headers should be trusted. Disabled by default
 * because the worker binds to localhost; spoofed headers would otherwise let a
 * caller evade or poison the rate-limit buckets. Enable only when running
 * behind a known reverse proxy that sets these headers.
 */
const trustProxyHeaders = process.env.FORGE_WORKER_TRUST_PROXY === "1";

/**
 * Derives a rate-limit bucket key from the request's socket address. When a
 * trusted proxy is configured, the forwarded client IP is used instead.
 *
 * @param c - The Hono request context.
 * @returns The bucket key used to track auth failures.
 */
function requestKey(c: Context): string {
  const remote = c.env?.incoming?.socket?.remoteAddress ?? "local";
  if (!trustProxyHeaders) return remote;
  const xff = c.req.header("x-forwarded-for");
  const forwarded =
    c.req.header("x-real-ip") || xff?.split(",")[0]?.trim() || c.req.header("CF-Connecting-IP");
  return forwarded || remote;
}

export function verifyToken(token: string, expected = readSettings().token): boolean {
  if (!token || !expected) return false;
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function requestToken(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer || "";
}

function signedRequest(c: Context): boolean {
  const url = new URL(c.req.url);
  const signature = url.searchParams.get("sig");
  const expiresAt = url.searchParams.get("expires");
  const isSignablePath =
    url.pathname.includes("/events") ||
    /^\/api\/sources\/[A-Za-z0-9_-]+\/preview$/.test(url.pathname);
  if (!signature || !expiresAt || !isSignablePath) return false;
  url.searchParams.delete("expires");
  url.searchParams.delete("sig");
  const search = url.searchParams.toString();
  return verifySignedUrl(
    c.req.method,
    `${url.pathname}${search ? `?${search}` : ""}`,
    expiresAt,
    signature,
  );
}

/**
 * Hono middleware that authenticates requests against the worker token.
 * Accepts a Bearer header or a `token` query param, and rate-limits clients
 * that exceed the invalid-attempt threshold within the rolling window.
 *
 * @param c - The Hono request context.
 * @param next - The next handler in the chain.
 * @returns A 401/429 JSON response on failure, otherwise passes control on.
 */
export async function tokenAuth(c: Context, next: Next) {
  const key = requestKey(c);
  const now = Date.now();
  pruneExpiredBuckets(authFailures, now);
  const current = authFailures.get(key);
  if (current && current.resetAt > now && current.count >= authMaxFailures) {
    return c.json(
      { ok: false, error: { code: "RATE_LIMITED", message: "Too many invalid token attempts" } },
      429,
    );
  }

  if (!verifyToken(requestToken(c)) && !signedRequest(c)) {
    const nextFailure =
      current && current.resetAt > now ? current : { count: 0, resetAt: now + authWindowMs };
    nextFailure.count += 1;
    authFailures.set(key, nextFailure);
    return c.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid Forge Worker token" } },
      401,
    );
  }
  authFailures.delete(key);
  await next();
}

export async function webApiRateLimit(c: Context, next: Next) {
  const tokenHash = createHash("sha256").update(requestToken(c)).digest("hex").slice(0, 16);
  const key = `${requestKey(c)}:${tokenHash}`;
  const now = Date.now();
  pruneExpiredBuckets(webApiHits, now);
  const current = webApiHits.get(key);
  const bucket =
    current && current.resetAt > now ? current : { count: 0, resetAt: now + webApiWindowMs };
  bucket.count += 1;
  webApiHits.set(key, bucket);
  if (bucket.count > webApiMaxRequests) {
    return c.json(
      { ok: false, error: { code: "RATE_LIMITED", message: "Too many worker API requests" } },
      429,
    );
  }
  await next();
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
