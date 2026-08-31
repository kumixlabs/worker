import { QueryClient } from "@tanstack/react-query";

import type { EventRecord } from "../../../src/types/event";
import type { MediaFolderRecord, MediaRecord } from "../../../src/types/media";
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
  media: (folderId?: string, { signal }: { signal?: AbortSignal } = {}) =>
    request<MediaRecord[]>(
      `/api/media${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`,
      {
        signal,
      },
    ),
  mediaFolders: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<MediaFolderRecord[]>("/api/media/folders", { signal }),
  createMediaFolder: (name: string) =>
    request<MediaFolderRecord>("/api/media/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameMediaFolder: (id: string, name: string) =>
    request<MediaFolderRecord>(`/api/media/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteMediaFolder: (id: string) =>
    request<{ deleted: boolean }>(`/api/media/folders/${id}`, { method: "DELETE" }),
  patchMedia: (id: string, body: { name?: string; folderId?: string | null }) =>
    request<MediaRecord>(`/api/media/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMedia: (id: string) => request<MediaRecord>(`/api/media/${id}`, { method: "DELETE" }),
  importGdrive: (body: { url: string; name?: string; folderId?: string }) =>
    request<MediaRecord>("/api/media/import-gdrive", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadMedia: async (file: File, options: { name?: string; folderId?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.name) params.set("name", options.name);
    if (options.folderId && options.folderId !== "root") params.set("folderId", options.folderId);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    const response = await fetch(`/api/media${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
      credentials: "same-origin",
    });
    if (response.status === 401) {
      queryClient.clear();
      window.dispatchEvent(new CustomEvent("kumix-worker-auth-invalid"));
      throw new Error("Session expired");
    }
    const body = (await response.json().catch(() => null)) as ApiEnvelope<MediaRecord> | null;
    if (!body || !body.ok) throw new Error(body && !body.ok ? body.error.message : "Upload failed");
    return body.data;
  },
};
