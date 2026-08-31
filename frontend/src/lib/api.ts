import { QueryClient } from "@tanstack/react-query";

import type { EventRecord } from "../../../src/types/event";
import type { WorkerMetrics, WorkerSettings, WorkerStats } from "../../../src/types/worker";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const tokenStorageKey = "kumix-worker-token";
const tokenExpiresStorageKey = "kumix-worker-token-expires-at";

function clearLegacyTokenStorage(): void {
  try {
    const store = localStorage;
    store.removeItem(tokenStorageKey);
    store.removeItem(tokenExpiresStorageKey);
    store.removeItem("kumix-worker-password-is-default");
  } catch {
    // ignore
  }
}
clearLegacyTokenStorage();

/**
 * Exchanges a one-time handoff code from the dashboard URL for the worker
 * token. Prefer `#code=` fragment (not sent to servers); still accept `?code=`
 * for older handoff links.
 */

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

async function request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (response.status === 401) {
    queryClient.clear();
    window.dispatchEvent(new CustomEvent("kumix-worker-auth-invalid"));
    throw new Error("Session expired");
  }

  const text = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    if (response.status === 429)
      throw new Error("Too many requests. Please slow down and try again.");
    throw new Error(`Request failed (${response.status} ${response.statusText})`);
  }
  if (!body.ok) {
    throw new Error(body.error.message);
  }
  return body.data;
}

export type PublicSettings = Pick<WorkerSettings, "diskUsageLimitPercent" | "timezone">;

export const api = {
  getAdminUsers: () => request<unknown[]>("/api/admin/users"),
  patchAdminUserQuotas: (
    id: string,
    body: { maxStorageBytes?: number | null; maxStreams?: number | null },
  ) => request(`/api/admin/users/${id}/quotas`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAdminUser: (id: string) => request(`/api/admin/users/${id}`, { method: "DELETE" }),
  bootstrap: () =>
    request<{
      apiVersion: string;
      hasAdmin: boolean;
    }>("/api/bootstrap"),
  stats: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<WorkerStats>("/api/stats", { signal }),
  metrics: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<WorkerMetrics>("/api/admin/metrics", { signal }),
  adminStats: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<WorkerStats>("/api/admin/stats", { signal }),
  settings: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<PublicSettings>("/api/settings", { signal }),
  patchSettings: (body: Partial<Pick<WorkerSettings, "timezone" | "diskUsageLimitPercent">>) =>
    request<PublicSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  events: (
    before?: { createdAt: string; id: string },
    { signal }: { signal?: AbortSignal } = {},
  ) => {
    const cursor = before
      ? btoa(JSON.stringify(before)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
      : "";
    return request<EventRecord[]>(`/api/events?limit=200${cursor ? `&before=${cursor}` : ""}`, {
      signal,
    });
  },
  clearEvents: () => request<{ deleted: number }>("/api/events", { method: "DELETE" }),
  signedUrl: (path: string) =>
    request<{ url: string }>("/api/events/signed-url", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  eventsExportPath: () => "/api/events/export",
  eventsStreamPath: () => "/api/events/stream",
};
