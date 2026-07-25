/**
 * Zod schemas for worker settings API payloads.
 */

import { z } from "zod";

import { DEFAULT_DASHBOARD_PASSWORD } from "../lib/password";
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
 * Port, token, and password are managed separately.
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
 * Validates dashboard password change requests.
 */
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(6).max(128),
    confirmPassword: z.string().min(6).max(128),
  })
  .superRefine((value, ctx) => {
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Password confirmation does not match",
      });
    }
    if (value.newPassword === value.currentPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "New password must be different from the current password",
      });
    }
    if (value.newPassword === DEFAULT_DASHBOARD_PASSWORD) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "Password must not be the factory default",
      });
    }
  });

/**
 * Parsed worker settings patch payload.
 */
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;

/**
 * Parsed password change payload.
 */
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
