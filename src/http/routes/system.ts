/**
 * System stats, metrics, and settings endpoints.
 */

import type { Hono } from "hono";

import { getBandwidthSummary } from "../../db/bandwidth";
import { getWorkerStats } from "../../db/stats";
import { readSettings, writeSettings } from "../../runtime/config";
import { runtimeHealthDetails } from "../../runtime/metrics";
import { settingsPatchSchema } from "../../schemas/settings";
import { getUserUsage } from "../../services/quota";
import type { PublicSettings } from "../../types/worker";
import { fail, ok } from "../middleware";
import { doc } from "./common";

function publicSettings(settings = readSettings()): PublicSettings {
  return {
    diskUsageLimitPercent: settings.diskUsageLimitPercent,
    timezone: settings.timezone,
  };
}

export function registerSystemRoutes(app: Hono) {
  app.get(
    "/api/stats",
    doc(
      "System",
      "Read stats",
      "Returns the current user's aggregate counts, storage usage, and system runtime stats.",
    ),
    (c) => {
      const user = c.get("user") as
        | { id: string; role?: string; maxStorageBytes?: number | null; maxStreams?: number | null }
        | undefined;
      const stats = getWorkerStats(user?.id);
      if (user && user.role !== "admin") {
        const usage = getUserUsage(user.id);
        stats.storage = { cacheBytes: usage.storageBytes };
        stats.quota = {
          ...usage,
          maxStorageBytes: user.maxStorageBytes ?? null,
          maxStreams: user.maxStreams ?? null,
        };
      }
      return c.json(ok(stats));
    },
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
    (c) => c.json(ok(publicSettings(readSettings()))),
  );

  app.patch(
    "/api/settings",
    doc(
      "Settings",
      "Update settings",
      "Updates disk usage limit or timezone settings. Admin only — these are worker-wide settings.",
    ),
    async (c) => {
      if ((c.get("user") as { role?: string } | undefined)?.role !== "admin") {
        return fail("FORBIDDEN", "Admin access required", 403);
      }
      const parsed = settingsPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid settings");
      }
      const current = readSettings();
      const next = { ...current, ...parsed.data, dataDir: current.dataDir };
      writeSettings(next);
      return c.json(ok(publicSettings(next)));
    },
  );

  app.get(
    "/api/bandwidth",
    doc(
      "System",
      "Read bandwidth",
      "Returns bandwidth usage totals scoped to the current user's streams.",
    ),
    (c) => {
      const user = c.get("user") as { id: string } | undefined;
      return c.json(ok(getBandwidthSummary(user?.id)));
    },
  );
}
