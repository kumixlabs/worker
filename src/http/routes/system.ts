/** Dashboard-facing settings, stats, metrics, and health-detail routes. */

import type { Hono } from "hono";

import { stats } from "../../db/stats";
import { listStreams } from "../../db/streams";
import { readSettings, writeSettings } from "../../runtime/config";
import { runtimeHealthDetails, runtimeMetrics } from "../../runtime/metrics";
import { schedulerState } from "../../runtime/scheduler";
import { settingsPatchSchema } from "../../schemas/settings";
import type { WorkerSettings } from "../../types/worker";
import { fail, ok } from "../middleware";
import { doc } from "./common";

type PublicSettings = Omit<WorkerSettings, "token" | "youtubeApiKey"> & {
  hasToken: boolean;
  tokenLength: number;
  hasYoutubeApiKey: boolean;
};

/**
 * Removes raw secrets from settings responses.
 *
 * @param settings - Full worker settings from config storage.
 * @returns Settings safe for dashboard responses.
 */
function publicSettings(settings: WorkerSettings): PublicSettings {
  const { token, youtubeApiKey, ...rest } = settings;
  return {
    ...rest,
    hasToken: token.length > 0,
    tokenLength: token.length,
    hasYoutubeApiKey: Boolean(youtubeApiKey),
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
    doc("Settings", "Read settings", "Returns local Kumix Worker settings without the raw token."),
    (c) => c.json(ok(publicSettings(readSettings()))),
  );

  app.patch(
    "/api/settings",
    doc(
      "Settings",
      "Update settings",
      "Updates disk usage limit or timezone settings. Port and token are managed separately.",
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
        // Empty string keeps the existing key; omit/undefined leaves it unchanged.
        youtubeApiKey:
          youtubeApiKey === undefined
            ? current.youtubeApiKey
            : youtubeApiKey === ""
              ? current.youtubeApiKey
              : youtubeApiKey,
      };
      writeSettings(next);
      return c.json(ok(publicSettings(next)));
    },
  );
}
