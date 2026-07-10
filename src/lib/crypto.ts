/**
 * Token-derived encryption helpers for secrets stored by Kumix Worker.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { readSettings } from "../runtime/config";

/**
 * Derives a 32-byte AES key by hashing the worker auth token with SHA-256.
 *
 * @returns The derived encryption key.
 */
function key(token = readSettings().token): Buffer {
  return createHash("sha256").update(token).digest();
}

/**
 * Encrypts a plaintext value using AES-256-GCM.
 * Output format: `enc:v1:<iv>:<authTag>:<ciphertext>` (each part base64url).
 *
 * @param value - The plaintext to encrypt.
 * @returns The encoded ciphertext envelope.
 */
export function encryptSecret(value: string): string {
  return encryptSecretWithToken(value);
}

/**
 * Encrypts a plaintext value using an explicit token-derived key.
 * Used when re-encrypting secrets during worker token rotation.
 *
 * @param value - The plaintext to encrypt.
 * @param token - Optional token to derive the AES key from.
 * @returns The encoded ciphertext envelope.
 */
export function encryptSecretWithToken(value: string, token?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(token), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

/**
 * Decrypts a value produced by encryptSecret.
 * Returns an empty string when the envelope is malformed or tampered with.
 *
 * @param value - The encoded ciphertext envelope.
 * @returns The decrypted plaintext, or "" on failure.
 */
export function decryptSecret(value: string): string {
  return decryptSecretWithToken(value);
}

/**
 * Decrypts a value using an explicit token-derived key.
 * Used when re-encrypting secrets during worker token rotation.
 *
 * @param value - The encoded ciphertext envelope.
 * @param token - Optional token to derive the AES key from.
 * @returns The decrypted plaintext, or "" on failure.
 */
export function decryptSecretWithToken(value: string, token?: string): string {
  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") return "";
  try {
    const iv = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    const encrypted = Buffer.from(parts[4]!, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(token), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Produces a masked preview of a secret for safe display.
 * Short values are fully masked; longer values reveal only the first and last 4 chars.
 *
 * @param value - The secret to mask.
 * @returns The masked representation.
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
