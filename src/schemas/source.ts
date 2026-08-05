/**
 * Zod schemas for source API payloads.
 */

import { z } from "zod";

/**
 * Valid stream source types.
 * Currently limited to direct URLs and Google Drive shared links.
 */
export const sourceKindSchema = z.enum(["url", "gdrive"]);

/**
 * Lifecycle states of a stream source.
 */
export const sourceStatusSchema = z.enum(["pending", "ready", "invalid", "downloading", "probing"]);

/**
 * Payload to create a new source.
 * Must include the remote URL to download/probe.
 */
export const sourceCreateSchema = z.object({
  name: z.string().min(1).max(160),
  kind: sourceKindSchema,
  url: z.url().max(2048),
});

/**
 * Parsed source creation payload.
 */
export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;

/**
 * Payload to update an existing source. Only the display name is editable;
 * changing the URL requires deleting and re-adding the source (or using retry).
 */
export const sourcePatchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
});

/**
 * Parsed source patch payload.
 */
export type SourcePatchInput = z.infer<typeof sourcePatchSchema>;
