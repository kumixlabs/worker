/**
 * Utility functions for common operations across the application.
 */

import { Readable } from "node:stream";

/**
 * Generates the current timestamp in ISO 8601 format.
 * Used for standardizing created_at and updated_at database fields.
 *
 * @returns The current date and time as an ISO string.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Safely parses a JSON string column into a typed object.
 * Returns null when the value is empty or cannot be parsed.
 *
 * @template T - Expected shape of the parsed value.
 * @param value - The raw JSON string from the database.
 * @returns The parsed object, or null on empty/invalid input.
 */
export function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Sanitizes an arbitrary string into a safe filename fragment. Non-alphanumeric
 * characters become underscores and the result is capped at 80 characters.
 *
 * @param value - The raw string to sanitize.
 * @param fallback - Value returned when sanitization yields an empty string.
 * @returns A filesystem-safe filename fragment.
 */
export function safeFilenamePart(value: string, fallback = "file"): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || fallback;
}

/**
 * Converts a Node.js readable stream to a web ReadableStream for Response bodies.
 * Centralizes the cast so call sites stay clean.
 *
 * @param nodeStream - The Node.js readable stream to convert.
 * @returns A web ReadableStream wrapping the Node stream.
 */
export function toWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream {
  return Readable.toWeb(nodeStream) as unknown as ReadableStream;
}
