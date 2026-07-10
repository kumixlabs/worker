import type { Hono } from "hono";

import { addEvent } from "../../db/events";
import { listSources } from "../../db/sources";
import { listStreams } from "../../db/streams";
import { listTargets, reencryptTargetSecrets } from "../../db/targets";
import { signedUrlTtlMs } from "../../lib/signed-url";
import { readPackageVersion } from "../../lib/version";
import { readSettings, writeSettings } from "../../runtime/config";
import { runtimeHealthDetails, runtimeMetrics } from "../../runtime/metrics";
import { schedulerState } from "../../runtime/scheduler";
import { tokenRotateSchema } from "../../schemas/settings";
import type { WebWorkerCapabilities, WebWorkerLinkInfo, WebWorkerStats } from "../../types/worker";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const webStatsCacheTtlMs = 2_000;
const bulkDeleteMaxIds = 100;
let cachedWebStats: { expiresAt: number; value: WebWorkerStats } | null = null;

function webCapabilities(): WebWorkerCapabilities {
  const settings = readSettings();
  return {
    apiVersion: "v1",
    agentVersion: readPackageVersion(),
    features: {
      monitoring: true,
      tokenRotation: true,
      signedEventUrls: true,
      bulkDelete: true,
      scheduler: true,
      recurrence: true,
      sourceDownload: true,
      googleDriveSources: true,
    },
    limits: {
      signedUrlTtlMs,
      bulkDeleteMaxIds,
      webStatsCacheTtlMs,
    },
    settings: {
      timezone: settings.timezone,
      diskUsageLimitPercent: settings.diskUsageLimitPercent,
    },
  };
}

function webLinkInfo(): WebWorkerLinkInfo {
  return {
    apiVersion: "v1",
    agentVersion: readPackageVersion(),
    dashboardPath: "/auth?token={token}",
    tokenLength: readSettings().token.length,
    capabilities: webCapabilities(),
  };
}

function computeWebStats(): WebWorkerStats {
  const streams = listStreams();
  const sources = listSources();
  const targets = listTargets();
  const metrics = runtimeMetrics(streams, schedulerState());
  const health = runtimeHealthDetails();
  const recentStreams = streams.slice(0, 10).map((stream) => ({
    id: stream.id,
    title: stream.title,
    status: stream.status,
    source: stream.source?.name ?? null,
    target: stream.target?.label ?? null,
    startedAt: stream.startedAt,
    stoppedAt: stream.stoppedAt,
    scheduledFor: stream.scheduledFor,
    lastError: stream.lastError,
    lastMetrics: stream.lastMetrics,
  }));
  return {
    system: {
      agentVersion: readPackageVersion(),
      cpu: metrics.cpu,
      memory: metrics.memory,
      disk: metrics.storage.disk,
      cacheBytes: metrics.storage.cacheBytes,
      network: metrics.network,
      process: metrics.process,
      health: {
        status: health.status,
        ffmpeg: health.ffmpeg.available,
        ffprobe: health.ffprobe.available,
      },
    },
    streams: {
      running: streams.filter((stream) => stream.status === "running").length,
      pending: streams.filter((stream) => stream.status === "pending").length,
      stopping: streams.filter((stream) => stream.status === "stopping").length,
      stopped: streams.filter((stream) => stream.status === "stopped").length,
      failed: streams.filter((stream) => stream.status === "failed").length,
      total: streams.length,
      recent: recentStreams,
    },
    sources: {
      ready: sources.filter((source) => source.status === "ready").length,
      pending: sources.filter((source) => source.status === "pending").length,
      downloading: sources.filter((source) => source.status === "downloading").length,
      probing: sources.filter((source) => source.status === "probing").length,
      invalid: sources.filter((source) => source.status === "invalid").length,
      total: sources.length,
    },
    targets: {
      active: targets.filter((target) => target.active).length,
      total: targets.length,
    },
    scheduler: metrics.scheduler,
  };
}

function webStats(): WebWorkerStats {
  const now = Date.now();
  if (cachedWebStats && cachedWebStats.expiresAt > now) return cachedWebStats.value;
  const value = computeWebStats();
  cachedWebStats = { expiresAt: now + webStatsCacheTtlMs, value };
  return value;
}

function webHealth() {
  const streams = listStreams();
  const health = runtimeHealthDetails();
  return {
    status: health.status,
    agentVersion: readPackageVersion(),
    uptimeSec: health.uptimeSec,
    ffmpeg: health.ffmpeg.available,
    ffprobe: health.ffprobe.available,
    streamsRunning: streams.filter((stream) => stream.status === "running").length,
  };
}

/**
 * Rotates the worker token and re-encrypts all stored target stream keys.
 * Rejects when the new token matches the current token.
 *
 * @param token - The new worker token.
 * @returns The rotation timestamp and new token length.
 */
function rotateToken(token: string) {
  const current = readSettings();
  if (token === current.token) throw new Error("New token must be different from current token");
  reencryptTargetSecrets(current.token, token);
  try {
    writeSettings({ ...current, token });
  } catch (error) {
    // Roll back the secret re-encryption so config and ciphertext stay aligned.
    reencryptTargetSecrets(token, current.token);
    throw error;
  }
  const rotatedAt = new Date().toISOString();
  addEvent(null, "token_rotated", "Worker token rotated", { rotatedAt });
  return { rotatedAt, tokenLength: token.length };
}

/**
 * Registers web-facing health, stats, and token rotation routes.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerWebRoutes(app: Hono) {
  app.get(
    "/api/v1/health",
    doc("Web", "Read web health", "Returns lightweight worker health for TubeForge Web."),
    (c) => c.json(ok(webHealth())),
  );

  app.get(
    "/api/v1/capabilities",
    doc(
      "Web",
      "Read worker capabilities",
      "Returns production API capabilities and safe runtime settings for TubeForge Web.",
    ),
    (c) => c.json(ok(webCapabilities())),
  );

  app.get(
    "/api/v1/link",
    doc(
      "Web",
      "Read link metadata",
      "Returns worker link metadata for TubeForge Web install and onboarding flows.",
    ),
    (c) => c.json(ok(webLinkInfo())),
  );

  app.get(
    "/api/v1/stats",
    doc("Web", "Read web stats", "Returns read-only worker monitoring data for TubeForge Web."),
    (c) => c.json(ok(webStats())),
  );

  app.post(
    "/api/v1/settings/token",
    doc(
      "Web",
      "Rotate token",
      "Replaces the worker token after authenticating with the old token.",
    ),
    async (c) => {
      const parsed = tokenRotateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid token");
      }
      try {
        return c.json(ok(rotateToken(parsed.data.token)));
      } catch (error) {
        return fail(
          "CONFLICT",
          error instanceof Error ? error.message : "Token rotation failed",
          409,
        );
      }
    },
  );
}
