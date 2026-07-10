/**
 * Zod schemas for target API payloads.
 */

import { z } from "zod";

/**
 * Validates RTMP/RTMPS ingest URLs accepted by stream targets.
 */
const ingestUrlSchema = z
  .url()
  .max(512)
  .refine((value) => ["rtmp:", "rtmps:"].includes(new URL(value).protocol), {
    message: "Ingest URL must use rtmp or rtmps",
  });

/**
 * Validates target creation payloads.
 * The stream key is accepted in plaintext here and encrypted before persistence.
 */
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
