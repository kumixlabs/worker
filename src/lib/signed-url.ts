import { createHmac, timingSafeEqual } from "node:crypto";

import { readSettings } from "../runtime/config";

export const signedUrlTtlMs = 60_000;

function base64url(input: Buffer) {
  return input.toString("base64url");
}

function signPayload(method: string, path: string, expiresAt: number) {
  return base64url(
    createHmac("sha256", readSettings().token)
      .update(`${method.toUpperCase()}:${path}:${expiresAt}`)
      .digest(),
  );
}

export function createSignedUrl(path: string, method = "GET") {
  const expiresAt = Date.now() + signedUrlTtlMs;
  const signature = signPayload(method, path, expiresAt);
  return `${path}${path.includes("?") ? "&" : "?"}expires=${expiresAt}&sig=${encodeURIComponent(signature)}`;
}

export function verifySignedUrl(
  method: string,
  path: string,
  expiresAt: string | null,
  signature: string | null,
) {
  const expires = Number(expiresAt ?? "0");
  if (!expires || expires <= Date.now() || !signature) return false;
  const expected = signPayload(method, path, expires);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
