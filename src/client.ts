import type { z } from "zod";

import {
  rotateWorkerTokenResultSchema,
  type WebWorkerHealth,
  webWorkerHealthSchema,
  webWorkerStatsSchema,
} from "./schemas/web";
import type { WebWorkerStats } from "./types/worker";

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

/**
 * Options for the read-only worker web API client.
 */
export type WorkerClientOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

/**
 * Result returned after successful worker token rotation.
 */
export type RotateWorkerTokenResult = {
  rotatedAt: string;
  tokenLength: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerRequestOnce<T>(
  options: WorkerClientOptions,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const fetcher = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs).unref?.()
    : null;
  let response: Response;
  try {
    response = await fetcher(`${normalizeBaseUrl(options.baseUrl)}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const text = await response.text();
  let body: ApiEnvelope<unknown>;
  try {
    body = JSON.parse(text) as ApiEnvelope<unknown>;
  } catch {
    throw new Error(`Worker API request failed: ${response.status} ${response.statusText}`);
  }
  if (!body.ok) throw new Error(body.error.message);
  return schema.parse(body.data);
}

async function workerRequest<T>(
  options: WorkerClientOptions,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
) {
  const retries = Math.max(0, options.retries ?? 0);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 500);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await workerRequestOnce<T>(options, path, schema, init);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(retryDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Builds a dashboard handoff URL that lets TubeForge Web open a local worker session.
 *
 * @param baseUrl - Worker origin, for example http://127.0.0.1:8080.
 * @param token - Worker token used by the handoff endpoint.
 * @returns Dashboard authentication URL.
 */
export function workerDashboardUrl(baseUrl: string, token: string): string {
  return `${normalizeBaseUrl(baseUrl)}/auth?token=${encodeURIComponent(token)}`;
}

/**
 * Fetches cached worker monitoring stats for TubeForge Web.
 *
 * @param options - Worker API client options.
 * @returns Worker stats validated by the public schema.
 */
export function fetchWorkerStats(options: WorkerClientOptions): Promise<WebWorkerStats> {
  return workerRequest<WebWorkerStats>(options, "/api/v1/stats", webWorkerStatsSchema);
}

/**
 * Fetches lightweight worker health for TubeForge Web.
 *
 * @param options - Worker API client options.
 * @returns Worker health validated by the public schema.
 */
export function fetchWorkerHealth(options: WorkerClientOptions): Promise<WebWorkerHealth> {
  return workerRequest<WebWorkerHealth>(options, "/api/v1/health", webWorkerHealthSchema);
}

/**
 * Rotates the worker token using the current token for authorization.
 * Retries are disabled for this non-idempotent operation.
 *
 * @param options - Worker API client options containing the current token.
 * @param newToken - New token to persist on the worker.
 * @returns Rotation metadata from the worker.
 */
export function rotateWorkerToken(
  options: WorkerClientOptions,
  newToken: string,
): Promise<RotateWorkerTokenResult> {
  return workerRequest<RotateWorkerTokenResult>(
    { ...options, retries: 0 },
    "/api/v1/settings/token",
    rotateWorkerTokenResultSchema,
    {
      method: "POST",
      body: JSON.stringify({ token: newToken }),
    },
  );
}

/**
 * Creates a small typed client for worker health, stats, dashboard URL, and token rotation.
 *
 * @param options - Worker API client options.
 * @returns Bound worker client methods.
 */
export function createWorkerClient(options: WorkerClientOptions) {
  return {
    dashboardUrl: () => workerDashboardUrl(options.baseUrl, options.token),
    stats: () => fetchWorkerStats(options),
    health: () => fetchWorkerHealth(options),
    rotateToken: (newToken: string) => rotateWorkerToken(options, newToken),
  };
}
