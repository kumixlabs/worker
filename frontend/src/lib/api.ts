import { QueryClient } from "@tanstack/react-query";

import type { EventRecord } from "../../../src/types/event";
import type { MediaFolderRecord, MediaRecord } from "../../../src/types/media";
import type { PlaylistItemRecord, PlaylistRecord } from "../../../src/types/playlist";
import type {
  SafeYoutubeClient,
  SafeYoutubeConnection,
  StreamRecord,
  StreamScheduleInput,
} from "../../../src/types/stream";
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

export interface StreamInput {
  name: string;
  playlistId: string;
  targetUrl?: string;
  shuffle?: boolean;
  loop?: boolean;
  schedule?: StreamScheduleInput;
  youtubeConnectionId?: string | null;
  ytTitle?: string | null;
  ytDescription?: string | null;
  ytPrivacy?: "public" | "unlisted" | "private" | null;
  ytMadeForKids?: boolean;
  ytDvr?: boolean;
}

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  importUrl: (body: { url: string; name?: string; folderId?: string }) =>
    request<MediaRecord>("/api/media/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  playlists: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<PlaylistRecord[]>("/api/playlists", { signal }),
  playlist: (id: string, { signal }: { signal?: AbortSignal } = {}) =>
    request<PlaylistRecord & { items: PlaylistItemRecord[] }>(`/api/playlists/${id}`, {
      signal,
    }),
  createPlaylist: (body: { name: string; description?: string | null; shuffle?: boolean }) =>
    request<PlaylistRecord>("/api/playlists", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchPlaylist: (
    id: string,
    body: { name?: string; description?: string | null; shuffle?: boolean },
  ) =>
    request<PlaylistRecord>(`/api/playlists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  replacePlaylistItems: (
    id: string,
    body: { videos?: string[]; audios?: string[]; mediaIds?: string[] },
  ) =>
    request<PlaylistItemRecord[]>(`/api/playlists/${id}/items`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  mediaStats: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<{ usedBytes: number; quotaBytes: number | null; mediaCount: number }>(
      "/api/media/stats",
      { signal },
    ),
  mediaUploadInit: (body: { name: string; size: number; folderId?: string }) =>
    request<{ uploadId: string; chunkSize: number }>("/api/media/uploads/init", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  completeMediaUpload: (uploadId: string) =>
    request<MediaRecord>(`/api/media/uploads/${uploadId}/complete`, { method: "POST" }),
  abortMediaUpload: (uploadId: string) =>
    request<{ aborted: boolean }>(`/api/media/uploads/${uploadId}`, { method: "DELETE" }),
  deletePlaylist: (id: string) =>
    request<{ deleted: boolean }>(`/api/playlists/${id}`, { method: "DELETE" }),
  uploadMedia: async (
    file: File,
    options: { name?: string; folderId?: string; onProgress?: (fraction: number) => void } = {},
  ) => {
    const name = options.name ?? file.name;
    const folderId = options.folderId && options.folderId !== "root" ? options.folderId : undefined;
    const chunkThreshold = 8 * 1024 * 1024;
    if (file.size > chunkThreshold) {
      return uploadMediaChunked(file, { name, folderId, onProgress: options.onProgress });
    }
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (folderId) params.set("folderId", folderId);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    options.onProgress?.(0.05);
    const response = await fetch(`/api/media${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
      credentials: "same-origin",
    });
    options.onProgress?.(1);
    return unwrapUploadResponse(response);
  },

  // Streams
  streams: (options?: RequestInit) => request<StreamRecord[]>("/api/streams", options),
  youtubeClient: (options?: RequestInit) =>
    request<SafeYoutubeClient>("/api/youtube/client", options),
  saveYoutubeClient: (body: { clientId: string; clientSecret: string }) =>
    request<{ saved: boolean }>("/api/youtube/client", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  youtubeConnections: (options?: RequestInit) =>
    request<SafeYoutubeConnection[]>("/api/youtube/connections", options),
  createYoutubeConnection: () =>
    request<{ connection: SafeYoutubeConnection; authUrl: string }>("/api/youtube/connections", {
      method: "POST",
    }),
  deleteYoutubeConnection: (id: string) =>
    request<{ deleted: boolean }>(`/api/youtube/connections/${id}`, { method: "DELETE" }),
  createStream: (body: StreamInput) =>
    request<StreamRecord>("/api/streams", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchStream: (
    id: string,
    body: Partial<StreamInput> & { schedule?: StreamScheduleInput | null },
  ) =>
    request<StreamRecord>(`/api/streams/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteStream: (id: string) =>
    request<{ deleted: boolean }>(`/api/streams/${id}`, { method: "DELETE" }),
  startStream: (id: string) =>
    request<StreamRecord>(`/api/streams/${id}/start`, { method: "POST" }),
  stopStream: (id: string) => request<StreamRecord>(`/api/streams/${id}/stop`, { method: "POST" }),
  streamLog: (id: string, options?: RequestInit) =>
    request<{ log: string }>(`/api/streams/${id}/log`, options),
};

async function unwrapUploadResponse(response: Response): Promise<MediaRecord> {
  if (response.status === 401) {
    queryClient.clear();
    window.dispatchEvent(new CustomEvent("kumix-worker-auth-invalid"));
    throw new Error("Session expired");
  }
  const body = (await response.json().catch(() => null)) as ApiEnvelope<MediaRecord> | null;
  if (!body?.ok) throw new Error(body && !body.ok ? body.error.message : "Upload failed");
  return body.data;
}

const CHUNK_SIZE = 8 * 1024 * 1024;

async function uploadMediaChunked(
  file: File,
  {
    name,
    folderId,
    onProgress,
  }: { name: string; folderId?: string; onProgress?: (f: number) => void },
): Promise<MediaRecord> {
  const init = await api.mediaUploadInit({ name, size: file.size, folderId });
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const response = await fetch(`/api/media/uploads/${init.uploadId}/chunk?offset=${offset}`, {
      method: "PUT",
      body: file.slice(offset, end),
      credentials: "same-origin",
    });
    if (response.status === 401) {
      queryClient.clear();
      window.dispatchEvent(new CustomEvent("kumix-worker-auth-invalid"));
      throw new Error("Session expired");
    }
    if (!response.ok) {
      await api.abortMediaUpload(init.uploadId).catch(() => undefined);
      const body = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      throw new Error(
        body && !body.ok ? body.error.message : `Chunk upload failed (${response.status})`,
      );
    }
    offset = end;
    onProgress?.(offset / file.size);
  }
  return api.completeMediaUpload(init.uploadId);
}
