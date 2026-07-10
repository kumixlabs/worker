/**
 * Zod schemas for worker settings API payloads.
 */

import { z } from "zod";

/**
 * Payload to update the worker daemon runtime configuration.
 * Port is intentionally excluded as it is an install-time concern.
 */
export const settingsPatchSchema = z.object({
  diskUsageLimitPercent: z.number().int().min(50).max(99).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

export const tokenRotateSchema = z.object({
  token: z.string().min(16).max(256),
});

/**
 * Parsed worker settings patch payload.
 */
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;
