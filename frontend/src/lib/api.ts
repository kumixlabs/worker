import { QueryClient } from "@tanstack/react-query";

import type { YouTubeAnalytics } from "../../../src/services/youtube";
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
const passwordDefaultKey = "kumix-worker-password-is-default";
/** Fallback only when server omits expiresAt (should not happen for login/exchange). */
const tokenTtlMs = 7 * 24 * 60 * 60 * 1000;

function storage(): Storage {
  try {
    return localStorage;
  } catch {
    return sessionStorage;
  }
}

export function getApiToken() {
  const store = storage();
  const expiresAt = Number(store.getItem(tokenExpiresStorageKey) ?? "0");
  if (expiresAt && expiresAt <= Date.now()) {
    setApiToken("");
    return "";
  }
  return store.getItem(tokenStorageKey) ?? "";
}

export function setApiToken(
  token: string,
  passwordIsDefault = false,
  expiresAt?: string | number | null,
) {
  const store = storage();
  if (token) {
    store.setItem(tokenStorageKey, token);
    const expMs =
      typeof expiresAt === "number"
        ? expiresAt
        : typeof expiresAt === "string" && expiresAt
          ? Date.parse(expiresAt)
          : Number.NaN;
    store.setItem(
      tokenExpiresStorageKey,
      String(Number.isFinite(expMs) ? expMs : Date.now() + tokenTtlMs),
    );
    if (passwordIsDefault) store.setItem(passwordDefaultKey, "1");
    else store.removeItem(passwordDefaultKey);
  } else {
    store.removeItem(tokenStorageKey);
    store.removeItem(tokenExpiresStorageKey);
    store.removeItem(passwordDefaultKey);
  }
}

export function getPasswordIsDefault(): boolean {
  try {
    return storage().getItem(passwordDefaultKey) === "1";
  } catch {
    return false;
  }
}

export function setPasswordIsDefault(value: boolean): void {
  try {
    const store = storage();
    if (value) store.setItem(passwordDefaultKey, "1");
    else store.removeItem(passwordDefaultKey);
  } catch {
    // ignore
  }
}

export function clearPasswordIsDefault(): void {
  setPasswordIsDefault(false);
}

/**
 * Exchanges a one-time handoff code from the dashboard URL for the worker
 * token. Prefer `#code=` fragment (not sent to servers); still accept `?code=`
 * for older handoff links.
 */
async function consumeHandoffCode(code: string) {
  try {
    const response = await fetch("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return;
    const body = (await response.json()) as ApiEnvelope<{
      token: string;
      expiresAt?: string;
      passwordIsDefault?: boolean;
    }>;
    if (body.ok && body.data.token) {
      setApiToken(
        body.data.token,
        Boolean(body.data.passwordIsDefault),
        body.data.expiresAt ?? null,
      );
    }
  } catch {
    // Ignore; the auth gate will prompt for a valid link.
  } finally {
    window.dispatchEvent(new CustomEvent("kumix-worker-auth-ready"));
  }
}

const queryParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const handoffCode = hashParams.get("code") ?? queryParams.get("code");

if (handoffCode) {
  queryParams.delete("code");
  hashParams.delete("code");
  const nextQuery = queryParams.toString();
  const nextHash = hashParams.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${
      nextHash ? `#${nextHash}` : ""
    }`,
  );
  void consumeHandoffCode(handoffCode);
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

export type PublicSettings = Omit<WorkerSettings, "token" | "youtubeApiKey" | "passwordHash"> & {
  hasToken: boolean;
  tokenLength: number;
  hasYoutubeApiKey: boolean;
  hasPassword: boolean;
  passwordIsDefault: boolean;
};

export const api = {
  stats: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<WorkerStats>("/api/stats", { signal }),
  metrics: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<WorkerMetrics>("/api/metrics", { signal }),
  healthDetails: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<WorkerHealthDetails>("/api/health/details", { signal }),
  settings: ({ signal }: { signal?: AbortSignal } = {}) =>
    request<PublicSettings>("/api/settings", { signal }),
  patchSettings: (
    body: Partial<Pick<WorkerSettings, "timezone" | "diskUsageLimitPercent" | "youtubeApiKey">>,
  ) => request<PublicSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) =>
    request<{ changed: boolean }>("/api/settings/password", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rotateToken: (token: string) =>
    request<{ rotatedAt: string; tokenLength: number }>("/api/v1/settings/token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
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
    targetId: string;
    youtubeLiveUrl?: string | null;
    scheduledFor?: string | null;
    autoStopAt?: string | null;
    recurrence: "none" | "daily" | "weekly" | "monthly";
    recurrenceRule?: { time?: string; weekdays?: number[] } | null;
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
};
