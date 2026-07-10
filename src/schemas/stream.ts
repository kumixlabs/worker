/**
 * Zod schemas for stream API payloads.
 */

import { z } from "zod";

/**
 * Lifecycle states of a running stream.
 */
export const streamStatusSchema = z.enum(["pending", "running", "stopping", "stopped", "failed"]);

/**
 * Coarse recurrence schedule for streams.
 */
export const recurrenceSchema = z.enum(["none", "daily", "weekly", "monthly"]);

/**
 * Payload to queue a new live stream task.
 */
export const streamCreateSchema = z.object({
  title: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  loop: z.boolean().default(true),
  scheduledFor: z.string().min(1).max(64).nullable().optional(),
  autoStopAt: z.string().min(1).max(64).nullable().optional(),
  recurrence: recurrenceSchema.default("none"),
  recurrenceRule: z
    .object({
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    })
    .nullable()
    .optional(),
});

/**
 * Payload to update a live stream task before or after it runs.
 */
export const streamPatchSchema = streamCreateSchema.partial().extend({
  stoppedAt: z.string().min(1).max(64).nullable().optional(),
});

/**
 * Parsed stream creation payload.
 */
export type StreamCreateInput = z.infer<typeof streamCreateSchema>;

/**
 * Parsed stream patch payload.
 */
export type StreamPatchInput = z.infer<typeof streamPatchSchema>;
