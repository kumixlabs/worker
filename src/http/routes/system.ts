/** Dashboard-facing settings, stats, metrics, and health-detail routes. */

import type { Hono } from "hono";

import { getBandwidthSummary } from "../../db/bandwidth";
import { stats } from "../../db/stats";
import { listStreams } from "../../db/streams";
import { hashPassword, isDefaultPasswordHash, verifyPassword } from "../../lib/password";
import { readSettings, writeSettings } from "../../runtime/config";
import { runtimeHealthDetails, runtimeMetrics } from "../../runtime/metrics";
import { schedulerState } from "../../runtime/scheduler";
import { passwordChangeSchema, settingsPatchSchema } from "../../schemas/settings";
import type { WorkerSettings } from "../../types/worker";
import { fail, ok, recordAuthFailure } from "../middleware";
import { doc } from "./common";

type PublicSettings = Omit<WorkerSettings, "token" | "youtubeApiKey" | "passwordHash"> & {
  hasToken: boolean;
  tokenLength: number;
  hasYoutubeApiKey: boolean;
  hasPassword: boolean;
  passwordIsDefault: boolean;
};

/**
 * Removes raw secrets from settings responses.
 *
 * @param settings - Full worker settings from config storage.
 * @returns Settings safe for dashboard responses.
 */
async function publicSettings(settings: WorkerSettings): Promise<PublicSettings> {
  const { token, youtubeApiKey, passwordHash, ...rest } = settings;
  return {
    ...rest,
    hasToken: token.length > 0,
    tokenLength: token.length,
    hasYoutubeApiKey: Boolean(youtubeApiKey),
    hasPassword: Boolean(passwordHash),
    passwordIsDefault: await isDefaultPasswordHash(passwordHash),
  };
}

/**
 * Registers settings, stats, metrics, and detailed health routes.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerSystemRoutes(app: Hono) {
  app.get(
    "/api/stats",
    doc(
      "System",
      "Read stats",
      "Returns counts for sources, targets, streams, storage, and process state.",
    ),
    (c) => c.json(ok(stats())),
  );

  app.get(
    "/api/metrics",
    doc(
      "System",
      "Read runtime metrics",
      "Returns CPU, memory, storage, live stream throughput, scheduler, and process metrics.",
    ),
    (c) => c.json(ok(runtimeMetrics(listStreams(), schedulerState()))),
  );

  app.get(
    "/api/bandwidth",
    doc(
      "System",
      "Read bandwidth summary",
      "Returns bandwidth usage: today, this month, all-time, per-stream, and 30-day daily breakdown.",
    ),
    (c) => c.json(ok(getBandwidthSummary())),
  );

  app.get(
    "/api/health/details",
    doc(
      "System",
      "Read health details",
      "Returns FFmpeg and FFprobe availability plus process uptime.",
    ),
    (c) => c.json(ok(runtimeHealthDetails())),
  );

  app.get(
    "/api/settings",
    doc("Settings", "Read settings", "Returns local Kumix Worker settings without secrets."),
    async (c) => c.json(ok(await publicSettings(readSettings()))),
  );

  app.patch(
    "/api/settings",
    doc(
      "Settings",
      "Update settings",
      "Updates disk usage limit or timezone settings. Port, token, and password are managed separately.",
    ),
    async (c) => {
      const parsed = settingsPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid settings");
      }
      const current = readSettings();
      const { youtubeApiKey, ...rest } = parsed.data;
      const next = {
        ...current,
        ...rest,
        dataDir: current.dataDir,
        youtubeApiKey:
          youtubeApiKey === undefined
            ? current.youtubeApiKey
            : youtubeApiKey === ""
              ? current.youtubeApiKey
              : youtubeApiKey,
      };
      writeSettings(next);
      return c.json(ok(await publicSettings(next)));
    },
  );

  app.post(
    "/api/settings/password",
    doc(
      "Settings",
      "Change dashboard password",
      "Updates the dashboard login password. Does not rotate the API token or re-encrypt stream keys.",
    ),
    async (c) => {
      const parsed = passwordChangeSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid password change");
      }
      const current = readSettings();
      if (!(await verifyPassword(parsed.data.currentPassword, current.passwordHash))) {
        // 400 (not 401): wrong current password must not clear the SPA Bearer session.
        // Still count against auth rate limit so brute-force of the current password is bounded.
        recordAuthFailure(c);
        return fail("BAD_REQUEST", "Current password is incorrect");
      }
      writeSettings({
        ...current,
        passwordHash: await hashPassword(parsed.data.newPassword),
      });
      return c.json(ok({ changed: true }));
    },
  );
}
