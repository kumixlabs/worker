/**
 * Zod schemas for worker settings API payloads.
 */

import { z } from "zod";

import { validToken } from "../runtime/config";

/**
 * Validates an IANA timezone setting accepted by the worker runtime.
 */
const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Expected a valid IANA timezone");

/**
 * Validates dashboard settings updates.
 * Port and token are intentionally excluded because they are managed separately.
 */
export const settingsPatchSchema = z.object({
  diskUsageLimitPercent: z.number().int().min(50).max(99).optional(),
  timezone: timezoneSchema.optional(),
  youtubeApiKey: z.string().max(256).optional(),
});

/**
 * Validates worker token rotation requests (same strength rules as CLI tokens).
 */
export const tokenRotateSchema = z.object({
  token: z
    .string()
    .min(16)
    .max(256)
    .superRefine((value, ctx) => {
      try {
        validToken(value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Invalid token",
        });
      }
    }),
});

/**
 * Parsed worker settings patch payload.
 */
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;
