/**
 * Zod schemas for worker settings API payloads.
 */

import { z } from "zod";

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

export const settingsPatchSchema = z.object({
  diskUsageLimitPercent: z.number().int().min(50).max(99).optional(),
  timezone: timezoneSchema.optional(),
});

export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;
