/**
 * Zod schemas for stream API payloads.
 */

import { z } from "zod";

export const streamStatusSchema = z.enum(["pending", "running", "stopping", "stopped", "failed"]);

export const recurrenceSchema = z.enum(["none", "daily", "weekly", "monthly"]);

export const streamCreateSchema = z
  .object({
    title: z.string().min(1).max(200),
    sourceId: z.string().min(1).max(64),
    targetId: z.string().min(1).max(64).optional(),
    mode: z.enum(["rtmp", "youtube"]).default("rtmp"),
    youtubeConnectionId: z.string().min(1).max(64).optional(),
    ytTitle: z.string().min(1).max(100).optional(),
    ytDescription: z.string().max(5000).optional(),
    ytTags: z.string().max(1000).optional(),
    ytPrivacy: z.enum(["public", "unlisted", "private"]).default("public").optional(),
    ytMadeForKids: z.boolean().default(false).optional(),
    ytDvr: z.boolean().default(true).optional(),
    ytStreamKeyId: z.string().max(64).optional(),
    loop: z
      .boolean()
      .default(true)
      .transform(() => true),
    youtubeLiveUrl: z
      .union([z.string().url().max(512), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" ? null : value)),
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
        day: z.number().int().min(1).max(31).optional(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "rtmp" && !data.targetId) {
      ctx.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "Target is required for RTMP mode",
      });
    }
    if (data.mode === "youtube" && !data.youtubeConnectionId) {
      ctx.addIssue({
        code: "custom",
        path: ["youtubeConnectionId"],
        message: "YouTube channel connection is required for YouTube mode",
      });
    }
  });

export const streamPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  sourceId: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(64).optional(),
  mode: z.enum(["rtmp", "youtube"]).optional(),
  youtubeConnectionId: z.string().min(1).max(64).optional(),
  ytTitle: z.string().min(1).max(100).optional(),
  ytDescription: z.string().max(5000).optional(),
  ytTags: z.string().max(1000).optional(),
  ytPrivacy: z.enum(["public", "unlisted", "private"]).optional(),
  ytMadeForKids: z.boolean().optional(),
  ytDvr: z.boolean().optional(),
  ytStreamKeyId: z.string().max(64).optional(),
  ytBroadcastId: z.string().max(128).optional(),
  ytVideoId: z.string().max(32).optional(),
  loop: z
    .boolean()
    .optional()
    .transform((v) => (v === undefined ? undefined : true)),
  youtubeLiveUrl: z
    .union([z.string().url().max(512), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value)),
  scheduledFor: z.string().min(1).max(64).nullable().optional(),
  autoStopAt: z.string().min(1).max(64).nullable().optional(),
  recurrence: recurrenceSchema.optional(),
  recurrenceRule: z
    .object({
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
      day: z.number().int().min(1).max(31).optional(),
    })
    .nullable()
    .optional(),
  stoppedAt: z.string().min(1).max(64).nullable().optional(),
});

export type StreamCreateInput = z.input<typeof streamCreateSchema>;
export type StreamPatchInput = z.input<typeof streamPatchSchema>;
