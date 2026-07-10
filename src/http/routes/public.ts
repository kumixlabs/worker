/** Core-facing `/api/v1/*` routes for health, stats, capabilities, and token rotation. */

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
import type {
  PublicWorkerCapabilities,
  PublicWorkerLinkInfo,
  PublicWorkerStats,
} from "../../types/worker";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const publicStatsCacheTtlMs = 2_000;
const bulkDeleteMaxIds = 100;
let cachedPublicStats: { expiresAt: number; value: PublicWorkerStats } | null = null;

/**
 * Builds the stable capability document for core integrations.
 *
 * @returns Public worker capabilities and safe settings.
 */
function publicCapabilities(): PublicWorkerCapabilities {
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
      publicStatsCacheTtlMs,
    },
    settings: {
      timezone: settings.timezone,
      diskUsageLimitPercent: settings.diskUsageLimitPercent,
    },
  };
}

/**
 * Builds link metadata used by external onboarding flows.
 *
 * @returns Public link metadata without exposing the raw token.
 */
function publicLinkInfo(): PublicWorkerLinkInfo {
  return {
    apiVersion: "v1",
    agentVersion: readPackageVersion(),
    dashboardPath: "/auth?token={token}",
    tokenLength: readSettings().token.length,
    capabilities: publicCapabilities(),
  };
}

/**
 * Aggregates fresh public monitoring stats from database and runtime state.
 *
 * @returns Public stats payload safe for core integrations.
 */
function computePublicStats(): PublicWorkerStats {
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

/**
 * Returns public stats, using a short in-memory cache to reduce polling cost.
 *
 * @returns Cached or freshly computed public stats.
 */
function publicStats(): PublicWorkerStats {
  const now = Date.now();
  if (cachedPublicStats && cachedPublicStats.expiresAt > now) return cachedPublicStats.value;
  const value = computePublicStats();
  cachedPublicStats = { expiresAt: now + publicStatsCacheTtlMs, value };
  return value;
}

/**
 * Builds lightweight public health information.
 *
 * @returns Public health payload without local file paths or secrets.
 */
function publicHealth() {
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
 * Registers public-facing health, stats, and token rotation routes.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerPublicRoutes(app: Hono) {
  app.get(
    "/api/v1/health",
    doc(
      "Public",
      "Read public health",
      "Returns lightweight worker health for external integrations.",
    ),
    (c) => c.json(ok(publicHealth())),
  );

  app.get(
    "/api/v1/capabilities",
    doc(
      "Public",
      "Read worker capabilities",
      "Returns production API capabilities and safe runtime settings for external integrations.",
    ),
    (c) => c.json(ok(publicCapabilities())),
  );

  app.get(
    "/api/v1/link",
    doc(
      "Public",
      "Read link metadata",
      "Returns worker link metadata for external integrations and onboarding flows.",
    ),
    (c) => c.json(ok(publicLinkInfo())),
  );

  app.get(
    "/api/v1/stats",
    doc(
      "Public",
      "Read Public stats",
      "Returns read-only worker monitoring data for external integrations.",
    ),
    (c) => c.json(ok(publicStats())),
  );

  app.post(
    "/api/v1/settings/token",
    doc(
      "Public",
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
