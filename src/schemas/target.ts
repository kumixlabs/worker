/**
 * Zod schemas for target API payloads.
 */

import { z } from "zod";

/**
 * Payload to create a new target destination.
 * The streamKey is passed in plaintext and encrypted at rest by the backend.
 */
const ingestUrlSchema = z
  .url()
  .max(512)
  .refine((value) => ["rtmp:", "rtmps:"].includes(new URL(value).protocol), {
    message: "Ingest URL must use rtmp or rtmps",
  });

export const targetCreateSchema = z.object({
  label: z.string().min(1).max(160),
  ingestUrl: ingestUrlSchema.default("rtmp://a.rtmp.youtube.com/live2"),
  streamKey: z.string().min(1).max(512),
  active: z.boolean().default(true),
});

/**
 * Payload to update an existing target.
 */
export const targetPatchSchema = z.object({
  label: z.string().min(1).max(160).optional(),
  ingestUrl: ingestUrlSchema.optional(),
  streamKey: z.string().min(1).max(512).optional(),
  active: z.boolean().optional(),
});

/**
 * Parsed target creation payload.
 */
export type TargetCreateInput = z.infer<typeof targetCreateSchema>;

/**
 * Parsed target patch payload.
 */
export type TargetPatchInput = z.infer<typeof targetPatchSchema>;
