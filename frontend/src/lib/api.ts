import { QueryClient } from "@tanstack/react-query";

import type { BandwidthSummary } from "../../../src/types/bandwidth";
import type { EventRecord } from "../../../src/types/event";
import type { SourceRecord } from "../../../src/types/source";
import type { StreamRecord } from "../../../src/types/stream";
import type { TargetRecord } from "../../../src/types/target";
import type {
  WorkerHealthDetails,
  WorkerMetrics,
  WorkerSettings,
  WorkerStats,
} from "../../../src/types/worker";
import type { YouTubeAnalytics } from "../../../src/types/youtube";

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
  adminBandwidth: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<BandwidthSummary>("/api/admin/bandwidth", { signal }),
  healthDetails: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<WorkerHealthDetails>("/api/health/details", { signal }),
  settings: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<PublicSettings>("/api/settings", { signal }),
  patchSettings: (body: Partial<Pick<WorkerSettings, "timezone" | "diskUsageLimitPercent">>) =>
    request<PublicSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  sources: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<SourceRecord[]>("/api/sources", { signal }),
  createSource: (body: { name: string; kind: "url" | "gdrive"; url: string }) =>
    request<SourceRecord>("/api/sources", { method: "POST", body: JSON.stringify(body) }),
  deleteSource: (id: string) => request<unknown>(`/api/sources/${id}`, { method: "DELETE" }),
  cancelSource: (id: string) => request<unknown>(`/api/sources/${id}/cancel`, { method: "POST" }),
  retrySource: (id: string) =>
    request<SourceRecord>(`/api/sources/${id}/retry`, { method: "POST" }),
  patchSource: (id: string, body: Partial<{ name: string }>) =>
    request<SourceRecord>(`/api/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  previewUrl: (id: string) =>
    request<{ url: string }>(`/api/sources/${id}/preview-url`, { method: "POST" }),
  deleteSources: (ids: string[]) =>
    request<{ deleted: string[]; failed: { id: string; message: string }[] }>("/api/sources", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  targets: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<TargetRecord[]>("/api/targets", { signal }),
  createTarget: (body: { label: string; ingestUrl: string; streamKey: string }) =>
    request<TargetRecord>("/api/targets", { method: "POST", body: JSON.stringify(body) }),
  patchTarget: (
    id: string,
    body: Partial<{ label: string; ingestUrl: string; streamKey: string; active: boolean }>,
  ) => request<TargetRecord>(`/api/targets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTarget: (id: string) => request<unknown>(`/api/targets/${id}`, { method: "DELETE" }),
  deleteTargets: (ids: string[]) =>
    request<{ deleted: string[]; failed: { id: string; message: string }[] }>("/api/targets", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  streams: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<StreamRecord[]>("/api/streams", { signal }),
  createStream: (body: {
    title: string;
    sourceId: string;
    targetId?: string;
    mode?: "rtmp" | "youtube";
    youtubeConnectionId?: string;
    ytTitle?: string;
    ytDescription?: string;
    ytTags?: string;
    ytPrivacy?: "public" | "unlisted" | "private";
    ytMadeForKids?: boolean;
    ytDvr?: boolean;
    youtubeLiveUrl?: string | null;
    scheduledFor?: string | null;
    autoStopAt?: string | null;
    recurrence: "none" | "daily" | "weekly" | "monthly";
    recurrenceRule?: { time?: string; weekdays?: number[]; day?: number } | null;
  }) => request<StreamRecord>("/api/streams", { method: "POST", body: JSON.stringify(body) }),
  startStream: (id: string) => request<unknown>(`/api/streams/${id}/start`, { method: "POST" }),
  stopStream: (id: string) => request<unknown>(`/api/streams/${id}/stop`, { method: "POST" }),
  patchStream: (
    id: string,
    body: Partial<{
      title: string;
      sourceId: string;
      targetId: string;
      youtubeLiveUrl: string | null;
      scheduledFor: string | null;
      autoStopAt: string | null;
      stoppedAt: string | null;
    }>,
  ) => request<StreamRecord>(`/api/streams/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteStream: (id: string) => request<unknown>(`/api/streams/${id}`, { method: "DELETE" }),
  deleteStreams: (ids: string[]) =>
    request<{ deleted: string[]; failed: { id: string; message: string }[] }>("/api/streams", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
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
  streamEventsExportPath: (id: string) => `/api/streams/${id}/events/export`,
  eventsStreamPath: () => "/api/events/stream",
  streamEventsPath: (id: string) => `/api/streams/${id}/events/stream`,
  streamAnalytics: (id: string, { signal }: { signal?: AbortSignal } = {}) =>
    request<YouTubeAnalytics>(`/api/streams/${id}/analytics`, { signal }),
  bandwidth: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<BandwidthSummary>("/api/bandwidth", { signal }),
  youtubeConnections: () =>
    request<
      Array<{
        id: string;
        userId: string;
        clientIdMasked: string;
        hasClientSecret: boolean;
        channelId?: string;
        channelTitle?: string;
        channelThumbnail?: string;
        subscriberCount?: number;
        status: "pending" | "connected" | "expired";
        createdAt: string;
        updatedAt: string;
      }>
    >("/api/youtube/connections"),
  createYoutubeConnection: (body: { clientId: string; clientSecret: string }) =>
    request<{
      connection: { id: string };
      authUrl: string;
    }>("/api/youtube/connections", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteYoutubeConnection: (id: string) =>
    request<{ deleted: boolean }>(`/api/youtube/connections/${id}`, {
      method: "DELETE",
    }),
};
