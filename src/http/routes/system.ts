/**
 * System stats, metrics, and settings endpoints.
 */

import type { Hono } from "hono";

import { readSettings, writeSettings } from "../../runtime/config";
import { runtimeMetrics } from "../../runtime/metrics";
import { settingsPatchSchema } from "../../schemas/settings";
import { getUserUsage } from "../../services/quota";
import type { PublicSettings, WorkerStats } from "../../types/worker";
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
    doc("System", "Read stats", "Returns storage usage, quota state, and system runtime stats."),
    (c) => {
      const user = c.get("user") as
        | { id: string; role?: string; maxStorageBytes?: number | null; maxStreams?: number | null }
        | undefined;
      const metrics = runtimeMetrics();
      const stats: WorkerStats = { storage: metrics.storage, system: metrics.process };
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
}
