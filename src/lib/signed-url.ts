/**
 * HMAC-signed URL helpers for short-lived authenticated browser requests.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { readSettings } from "../runtime/config";

/** Lifetime of generated signed URLs in milliseconds. */
export const signedUrlTtlMs = 60_000;

/** Encodes binary signature data as base64url. */
function base64url(input: Buffer): string {
  return input.toString("base64url");
}

/** Signs the normalized request method, path, and expiration timestamp. */
function signPayload(method: string, path: string, expiresAt: number): string {
  return base64url(
    createHmac("sha256", readSettings().token)
      .update(`${method.toUpperCase()}:${path}:${expiresAt}`)
      .digest(),
  );
}

/**
 * Creates a short-lived signed URL for an internal worker endpoint.
 *
 * @param path - Absolute request path, including any query string to protect.
 * @param method - HTTP method authorized by the signature.
 * @returns The path with expiration and signature query parameters.
 */
export function createSignedUrl(path: string, method = "GET"): string {
  const expiresAt = Date.now() + signedUrlTtlMs;
  const signature = signPayload(method, path, expiresAt);
  return `${path}${path.includes("?") ? "&" : "?"}expires=${expiresAt}&sig=${encodeURIComponent(signature)}`;
}

/**
 * Verifies a signed request using the current worker token and expiration time.
 *
 * @param method - HTTP method received by the worker.
 * @param path - Request path and query string without signature parameters.
 * @param expiresAt - Expiration timestamp supplied by the request.
 * @param signature - Base64url HMAC signature supplied by the request.
 * @returns True when the signature is valid and has not expired.
 */
export function verifySignedUrl(
  method: string,
  path: string,
  expiresAt: string | null,
  signature: string | null,
): boolean {
  const expires = Number(expiresAt ?? "0");
  if (!Number.isSafeInteger(expires) || expires <= Date.now() || !signature) return false;
  const expected = signPayload(method, path, expires);
  const actualBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
