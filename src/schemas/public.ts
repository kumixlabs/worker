/**
 * Zod schemas for public-facing worker API responses consumed by external integrations.
 */

import { z } from "zod";

const diskSchema = z
  .object({
    totalBytes: z.number(),
    freeBytes: z.number(),
    usedBytes: z.number(),
    usedPercent: z.number(),
  })
  .optional();

const recentStreamSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  source: z.string().nullable(),
  target: z.string().nullable(),
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  scheduledFor: z.string().nullable(),
  lastError: z.string().nullable(),
  lastMetrics: z.unknown().nullable(),
});

/**
 * Validates the read-only worker stats payload returned by `/api/v1/stats`.
 */
export const publicWorkerStatsSchema = z.object({
  system: z.object({
    agentVersion: z.string(),
    cpu: z.object({
      cores: z.number(),
      usagePercent: z.number(),
      loadAverage: z.array(z.number()),
      userMicros: z.number(),
      systemMicros: z.number(),
    }),
    memory: z.object({
      totalBytes: z.number(),
      freeBytes: z.number(),
      usedBytes: z.number(),
    }),
    disk: diskSchema,
    cacheBytes: z.number(),
    network: z.object({ outboundMbps: z.number() }),
    process: z.object({
      pid: z.number(),
      startedAt: z.string(),
      uptimeSec: z.number(),
      platform: z.string(),
    }),
    health: z.object({
      status: z.string(),
      ffmpeg: z.boolean(),
      ffprobe: z.boolean(),
    }),
  }),
  streams: z.object({
    running: z.number(),
    pending: z.number(),
    stopping: z.number(),
    stopped: z.number(),
    failed: z.number(),
    total: z.number(),
    recent: z.array(recentStreamSchema),
  }),
  sources: z.object({
    ready: z.number(),
    pending: z.number(),
    downloading: z.number(),
    probing: z.number(),
    invalid: z.number(),
    total: z.number(),
  }),
  targets: z.object({ active: z.number(), total: z.number() }),
  scheduler: z.object({
    running: z.boolean(),
    intervalMs: z.number(),
    lastTickAt: z.string().nullable(),
    lastStarted: z.number(),
    lastStopped: z.number(),
  }),
});

/**
 * Validates the lightweight health payload returned by `/api/v1/health`.
 */
export const publicWorkerHealthSchema = z.object({
  status: z.string(),
  agentVersion: z.string(),
  uptimeSec: z.number(),
  ffmpeg: z.boolean(),
  ffprobe: z.boolean(),
  streamsRunning: z.number(),
});

/**
 * Validates the token rotation result returned by `/api/v1/settings/token`.
 */
export const rotateWorkerTokenResultSchema = z.object({
  rotatedAt: z.string(),
  tokenLength: z.number(),
});

/** Parsed public worker health payload. */
export type PublicWorkerHealth = z.infer<typeof publicWorkerHealthSchema>;
