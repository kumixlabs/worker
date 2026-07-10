import { QueryClient } from "@tanstack/react-query";

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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const tokenStorageKey = "kumix-worker-token";
const tokenExpiresStorageKey = "kumix-worker-token-expires-at";
const tokenTtlMs = 7 * 24 * 60 * 60 * 1000;

export function getApiToken() {
  const expiresAt = Number(localStorage.getItem(tokenExpiresStorageKey) ?? "0");
  if (expiresAt && expiresAt <= Date.now()) {
    setApiToken("");
    return "";
  }
  return localStorage.getItem(tokenStorageKey) ?? "";
}

export function setApiToken(token: string) {
  if (token) {
    localStorage.setItem(tokenStorageKey, token);
    localStorage.setItem(tokenExpiresStorageKey, String(Date.now() + tokenTtlMs));
  } else {
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(tokenExpiresStorageKey);
  }
}

const queryParams = new URLSearchParams(window.location.search);
const queryCode = queryParams.get("code");
const legacyQueryToken = queryParams.get("token");

/**
 * Exchanges a one-time handoff code from the dashboard URL for the worker
 * token. The token never appears in the URL, so it cannot leak via history,
 * proxies, or access logs.
 */
async function consumeHandoffCode(code: string) {
  try {
    const response = await fetch("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return;
    const body = (await response.json()) as ApiEnvelope<{ token: string }>;
    if (body.ok && body.data.token) setApiToken(body.data.token);
  } catch {
    // Ignore; the auth gate will prompt for a valid link.
  } finally {
    window.dispatchEvent(new CustomEvent("kumix-worker-auth-ready"));
  }
}

if (queryCode) {
  window.history.replaceState(null, "", window.location.pathname);
  void consumeHandoffCode(queryCode);
} else if (legacyQueryToken) {
  // Backwards compatibility for direct token links.
  setApiToken(legacyQueryToken);
  window.history.replaceState(null, "", window.location.pathname);
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

function authHeaders(): Record<string, string> {
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value);
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    setApiToken("");
    queryClient.clear();
    window.dispatchEvent(new CustomEvent("kumix-worker-auth-invalid"));
  }
  if (response.status === 429) {
    throw new Error("Too many requests. Please slow down and try again.");
  }

  const text = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(`Request failed (${response.status} ${response.statusText})`);
  }
  if (!body.ok) {
    throw new Error(body.error.message);
  }
  return body.data;
}

export const api = {
  stats: () => request<WorkerStats>("/api/stats"),
  metrics: () => request<WorkerMetrics>("/api/metrics"),
  healthDetails: () => request<WorkerHealthDetails>("/api/health/details"),
  settings: () => request<WorkerSettings>("/api/settings"),
  patchSettings: (body: Partial<WorkerSettings>) =>
    request<WorkerSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  sources: () => request<SourceRecord[]>("/api/sources"),
  createSource: (body: { name: string; kind: "url" | "gdrive"; url: string }) =>
    request<SourceRecord>("/api/sources", { method: "POST", body: JSON.stringify(body) }),
  deleteSource: (id: string) => request<unknown>(`/api/sources/${id}`, { method: "DELETE" }),
  previewUrl: (id: string) =>
    request<{ url: string }>(`/api/sources/${id}/preview-url`, { method: "POST" }),
  deleteSources: (ids: string[]) =>
    request<{ deleted: string[]; failed: { id: string; message: string }[] }>("/api/sources", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  targets: () => request<TargetRecord[]>("/api/targets"),
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
  streams: () => request<StreamRecord[]>("/api/streams"),
  createStream: (body: {
    title: string;
    sourceId: string;
    targetId: string;
    scheduledFor?: string | null;
    autoStopAt?: string | null;
    recurrence: "none" | "daily" | "weekly" | "monthly";
    recurrenceRule?: { time?: string; weekdays?: number[] } | null;
  }) => request<StreamRecord>("/api/streams", { method: "POST", body: JSON.stringify(body) }),
  startStream: (id: string) => request<unknown>(`/api/streams/${id}/start`, { method: "POST" }),
  stopStream: (id: string) => request<unknown>(`/api/streams/${id}/stop`, { method: "POST" }),
  patchStream: (id: string, body: Partial<{ stoppedAt: string | null }>) =>
    request<StreamRecord>(`/api/streams/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteStream: (id: string) => request<unknown>(`/api/streams/${id}`, { method: "DELETE" }),
  deleteStreams: (ids: string[]) =>
    request<{ deleted: string[]; failed: { id: string; message: string }[] }>("/api/streams", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  events: () => request<EventRecord[]>("/api/events"),
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
};
