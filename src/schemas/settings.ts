/**
 * Zod schemas for worker settings API payloads.
 */

import { z } from "zod";

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
});

/**
 * Validates worker token rotation requests.
 */
export const tokenRotateSchema = z.object({
  token: z.string().min(16).max(256),
});

/**
 * Parsed worker settings patch payload.
 */
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;
