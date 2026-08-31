/**
 * Encryption helpers for secrets stored by Kumix Worker.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { currentEncryptionKey } from "../runtime/config";

function key(secret = currentEncryptionKey()): Buffer {
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext value using AES-256-GCM.
 * Output format: `enc:v1:<iv>:<authTag>:<ciphertext>` (each part base64url).
 */
export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

/**
 * Decrypts a value produced by encryptSecret.
 * Returns an empty string when the envelope is malformed or tampered with.
 */
export function decryptSecret(value: string): string {
  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") return "";
  try {
    const iv = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    const encrypted = Buffer.from(parts[4]!, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Masks a sensitive string, exposing only its suffix for identification.
 */
export function maskSecret(value: string, visibleSuffix = 4): string {
  if (!value) return "";
  if (value.length <= visibleSuffix) return "*".repeat(value.length);
  const maskedLength = Math.max(value.length - visibleSuffix, 0);
  return `${"*".repeat(maskedLength)}${value.slice(-visibleSuffix)}`;
}
