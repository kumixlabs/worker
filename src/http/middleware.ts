/**
 * Shared Hono middleware: rate limiting, signed URL verification, and JSON envelopes.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { verifySignedUrl } from "../lib/signed-url";

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(code: string, message: string, status: ContentfulStatusCode = 400): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/** Checks whether the request carries a valid signed URL for an allowed path. */
export function signedRequest(c: Context): boolean {
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
