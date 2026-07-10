/**
 * Source download, SSRF validation, and post-download probing helpers.
 */

import { lookup as dnsLookupCb, setDefaultResultOrder } from "node:dns";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { isIP, type LookupFunction } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Agent, fetch as undiciFetch } from "undici";

import { addEvent } from "../db/events";
import { getSource, updateSourceProbe } from "../db/sources";
import { safeFilenamePart } from "../lib/utils";
import { getCacheDir, readSettings } from "../runtime/config";
import { runtimeMetrics } from "../runtime/metrics";
import { probeAndUpdateSource } from "./probe";

const DEFAULT_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const maxDownloadBytes =
  Number(process.env.KUMIX_WORKER_MAX_DOWNLOAD_BYTES) || DEFAULT_MAX_DOWNLOAD_BYTES;
const fetchTimeoutMs = 30_000;
const downloadTimeoutMs = Number(process.env.KUMIX_WORKER_DOWNLOAD_TIMEOUT_MS) || 60 * 60 * 1000; // 1 hour
const kumixWorkerUserAgent = "Mozilla/5.0 (compatible; KumixWorker/1.0)";
const gdriveFileIdPattern = /^[A-Za-z0-9_-]{10,128}$/;

if (process.env.KUMIX_WORKER_IPV4_FIRST !== "0") {
  setDefaultResultOrder("ipv4first");
}

/**
 * DNS resolver used by the undici Agent. It re-checks every resolved address
 * against the private-range policy and connects only to a vetted IP. Because
 * the address that passes this check is the exact address used for the socket,
 * it closes the DNS-rebinding gap between validation and connection.
 */
function pinnedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (
    err: NodeJS.ErrnoException | null,
    address?: string | { address: string; family: number }[],
    family?: number,
  ) => void,
): void {
  dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, undefined);
    const list = addresses as unknown as { address: string; family: number }[];
    const safe = list.filter((record) => !isPrivateIp(record.address));
    if (safe.length === 0) {
      return callback(new Error("Blocked by SSRF protection"), undefined);
    }
    // When IPv4-first is active (default), drop IPv6 records as long as at least
    // one IPv4 address is available. Many VPS hosts publish AAAA records but have
    // broken/unrouted IPv6, which makes undici stall on the v6 address before it
    // falls back. Returning IPv4-only here avoids that connect-timeout hang.
    const preferIpv4 = process.env.KUMIX_WORKER_IPV4_FIRST !== "0";
    const hasIpv4 = safe.some((record) => record.family === 4);
    const resolved = preferIpv4 && hasIpv4 ? safe.filter((record) => record.family === 4) : safe;
    if (options.all) return callback(null, resolved);
    return callback(null, resolved[0].address, resolved[0].family);
  });
}

const secureAgent = new Agent({
  connect: { lookup: pinnedLookup as unknown as LookupFunction, timeout: fetchTimeoutMs },
});

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (url, init) =>
  undiciFetch(url, {
    ...(init as Record<string, unknown>),
    dispatcher: secureAgent,
  } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;

let fetchImpl: FetchLike = defaultFetch;

/**
 * Overrides the HTTP transport used by safeFetch. Intended for tests so they
 * can inject a deterministic fetch without real network or DNS access.
 *
 * @param fn - Replacement fetch, or null to restore the secure default.
 */
export function setFetchImplForTests(fn: FetchLike | null): void {
  fetchImpl = fn ?? defaultFetch;
}

/**
 * Computes how many bytes may still be downloaded under package and disk limits.
 *
 * @returns Remaining allowed download size in bytes.
 */
function allowedDownloadBytes(): number {
  const settings = readSettings();
  const disk = runtimeMetrics().storage.disk;
  if (disk.totalBytes <= 0) return maxDownloadBytes;
  const limitBytes = Math.floor(disk.totalBytes * (settings.diskUsageLimitPercent / 100));
  return Math.max(0, Math.min(maxDownloadBytes, limitBytes - disk.usedBytes));
}

/**
 * Deletes a cache file if it exists, ignoring cleanup failures.
 *
 * @param filePath - Cache file path to remove.
 */
async function removeCacheFile(filePath: string): Promise<void> {
  await unlink(filePath).catch((error) => {
    console.warn(`[worker] Failed to remove cache file ${filePath}:`, error);
  });
}

/**
 * Determines whether an IPv4/IPv6 address is private, loopback, link-local,
 * or otherwise non-routable. Used to block SSRF to internal hosts and cloud
 * metadata endpoints.
 *
 * @param ip - The IP address to evaluate.
 * @returns True when the address is not a public/routable destination.
 */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    // 6to4 (2002:V4ADDR::/16): embeds an IPv4 address in the next two hextets.
    const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
    if (sixToFour) {
      const high = Number.parseInt(sixToFour[1].padStart(4, "0"), 16);
      const low = Number.parseInt(sixToFour[2].padStart(4, "0"), 16);
      const embedded = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
      return isPrivateIp(embedded);
    }
    // NAT64 (64:ff9b::/96): embeds an IPv4 address in the trailing 32 bits.
    if (lower.startsWith("64:ff9b::")) {
      const nat64 = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
      if (nat64) return isPrivateIp(nat64[1]);
      const tail = lower.match(/64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (tail) {
        const high = Number.parseInt(tail[1].padStart(4, "0"), 16);
        const low = Number.parseInt(tail[2].padStart(4, "0"), 16);
        const embedded = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
        return isPrivateIp(embedded);
      }
    }
    return false;
  }
  return false;
}

/**
 * Validates a download URL to prevent SSRF. Enforces http/https scheme,
 * blocks known metadata hostnames, and resolves DNS so a hostname pointing
 * at a private address is rejected before any request is made.
 *
 * @param urlString - The URL to validate.
 * @returns True when the URL is safe to fetch.
 */
export async function validateUrl(urlString: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (hostname === "metadata.google.internal") return false;

  if (isIP(hostname)) return !isPrivateIp(hostname);
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const inner = hostname.slice(1, -1);
    if (isIP(inner)) return !isPrivateIp(inner);
  }

  try {
    const records = await lookup(hostname, { all: true });
    if (records.length === 0) return false;
    return records.every((record) => !isPrivateIp(record.address));
  } catch {
    return false;
  }
}

/**
 * Extracts the Google Drive file ID from the common share URL formats.
 *
 * @param urlString - A Google Drive share or download URL.
 * @returns The extracted file ID, or null when it cannot be parsed.
 */
export function extractGDriveFileId(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    if (url.hostname === "drive.google.com" || url.hostname === "drive.usercontent.google.com") {
      const pathMatch = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
      if (pathMatch && gdriveFileIdPattern.test(pathMatch[1])) return pathMatch[1];
      const idParam = url.searchParams.get("id");
      if (idParam && gdriveFileIdPattern.test(idParam)) return idParam;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Collapses one or more Set-Cookie header values into a single Cookie header.
 *
 * @param setCookie - The raw Set-Cookie header value(s).
 * @returns A Cookie header string, or null when there are no cookies.
 */
function toCookieHeader(setCookie: string[] | null): string | null {
  const values = setCookie ?? [];
  const cookies = values
    .map((value) => value.split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value));
  return cookies.length > 0 ? cookies.join("; ") : null;
}

/**
 * Extracts the confirmed download URL from a Google Drive virus-scan warning page.
 *
 * @param body - The HTML body of the warning page.
 * @param fileId - The Google Drive file ID.
 * @param cookie - The cookie header captured from the initial response.
 * @returns The confirmed download URL, or null when it cannot be derived.
 */
function extractGDriveConfirmedUrl(
  body: string,
  fileId: string,
  cookie: string | null,
): string | null {
  const decoded = body.replaceAll("&amp;", "&");
  const hrefMatch = decoded.match(/href="([^"]*\/download\?[^"]+)"/);
  if (hrefMatch) {
    const href = hrefMatch[1];
    const url = href.startsWith("http")
      ? new URL(href)
      : new URL(href, "https://drive.usercontent.google.com");
    if (url.searchParams.get("id") === fileId && url.searchParams.has("confirm")) {
      return url.toString();
    }
  }

  const confirm =
    decoded.match(/[?&]confirm=([0-9A-Za-z_-]+)/)?.[1] ??
    decoded.match(/name="confirm"\s+value="([^"]+)"/)?.[1] ??
    cookie?.match(/download_warning[^=]*=([^;]+)/)?.[1] ??
    null;
  if (!confirm) return null;

  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", fileId);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", confirm);
  const uuid = decoded.match(/name="uuid"\s+value="([^"]+)"/)?.[1];
  if (uuid) url.searchParams.set("uuid", uuid);
  return url.toString();
}

/**
 * Reads Set-Cookie values from a fetch response across runtime header implementations.
 *
 * @param response - Fetch response to inspect.
 * @returns Raw Set-Cookie header values.
 */
function cookieValues(response: Response): string[] {
  return (
    response.headers.getSetCookie?.() ??
    (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : [])
  );
}

/**
 * Appends response cookies to an existing Cookie header value.
 *
 * @param cookie - Existing Cookie header value.
 * @param setCookie - Set-Cookie values from the latest response.
 * @returns The combined Cookie header, or null when no cookies exist.
 */
function appendCookies(cookie: string | null, setCookie: string[]): string | null {
  const next = toCookieHeader(setCookie);
  if (!next) return cookie;
  return cookie ? `${cookie}; ${next}` : next;
}

/**
 * Removes query parameters from a URL before it is written to logs.
 *
 * @param value - URL to redact.
 * @returns Redacted URL or a placeholder for invalid input.
 */
function redactDownloadUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/**
 * Builds fetch options with worker defaults for manual redirects and browser-like headers.
 *
 * @param init - Optional caller-provided fetch options.
 * @param cookie - Cookie header to include for Google Drive continuation requests.
 * @returns Fetch options for one request hop.
 */
function fetchInit(init?: RequestInit, cookie?: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", kumixWorkerUserAgent);
  if (!headers.has("accept")) headers.set("accept", "*/*");
  if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
  return {
    ...init,
    headers,
    redirect: "manual",
    signal: init?.signal ?? AbortSignal.timeout(fetchTimeoutMs),
  };
}

/**
 * Fetches a URL while validating every redirect hop against SSRF protection.
 *
 * @param urlString - The initial URL to fetch.
 * @param init - Optional fetch init applied to each hop.
 * @param maxRedirects - Maximum number of redirects to follow.
 * @returns The final response after safe redirects.
 * @throws If a hop targets a blocked address or redirects exceed the limit.
 */
export async function safeFetch(
  urlString: string,
  init?: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = urlString;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!(await validateUrl(currentUrl))) {
      throw new Error("Blocked by SSRF protection");
    }
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, fetchInit(init));
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
      const detail = causeMessage ? `: ${causeMessage}` : "";
      console.error(
        `[worker] safeFetch failed for ${redactDownloadUrl(currentUrl)}${detail}`,
        cause instanceof Error ? { code: (cause as NodeJS.ErrnoException).code } : undefined,
      );
      throw new Error(`fetch failed: ${redactDownloadUrl(currentUrl)}${detail}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

/**
 * Fetches a URL with SSRF-safe redirects while carrying cookies across hops.
 *
 * @param urlString - The initial URL to fetch.
 * @param init - Optional fetch init applied to each hop.
 * @param maxRedirects - Maximum number of redirects to follow.
 * @returns The final response and accumulated Cookie header.
 */
async function safeFetchWithCookies(
  urlString: string,
  init?: RequestInit,
  maxRedirects = 5,
): Promise<{ response: Response; cookie: string | null }> {
  let currentUrl = urlString;
  let cookie: string | null = null;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!(await validateUrl(currentUrl))) {
      throw new Error("Blocked by SSRF protection");
    }
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, fetchInit(init, cookie));
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
      const detail = causeMessage ? `: ${causeMessage}` : "";
      console.error(
        `[worker] safeFetch failed for ${redactDownloadUrl(currentUrl)}${detail}`,
        cause instanceof Error ? { code: (cause as NodeJS.ErrnoException).code } : undefined,
      );
      throw new Error(`fetch failed: ${redactDownloadUrl(currentUrl)}${detail}`);
    }
    cookie = appendCookies(cookie, cookieValues(response));
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, cookie };
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response, cookie };
  }
  throw new Error("Too many redirects");
}

/**
 * Resolves a Google Drive file ID to a direct download request, handling the
 * large-file confirmation token flow.
 *
 * @param fileId - The Google Drive file ID.
 * @returns The resolved URL and any headers (cookies) required to download.
 */
export async function resolveGDriveDownload(
  fileId: string,
): Promise<{ url: string; headers?: Record<string, string> }> {
  const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  try {
    const { response: res, cookie } = await safeFetchWithCookies(directUrl);
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (res.ok && contentType.includes("text/html")) {
      const body = await res.text();
      const confirmedUrl = extractGDriveConfirmedUrl(body, fileId, cookie);
      return {
        url: confirmedUrl ?? directUrl,
        headers: cookie ? { cookie } : undefined,
      };
    }
    return { url: directUrl, headers: cookie ? { cookie } : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "resolve failed";
    console.error(`[worker] resolveGDriveDownload failed for fileId=${fileId}: ${message}`);
    return { url: directUrl };
  }
}

/**
 * Downloads a source to the local cache and runs ffprobe to validate it.
 * Resolves Google Drive links and enforces SSRF protection before fetching.
 *
 * @param sourceId - The ID of the source to download and probe.
 * @returns The updated source record after download and probe.
 */
export async function downloadAndProbeSource(sourceId: string) {
  const source = getSource(sourceId);
  if (!source?.url) return source;

  const effectiveKind: "url" | "gdrive" =
    source.kind === "gdrive" || extractGDriveFileId(source.url) ? "gdrive" : "url";

  if (!(await validateUrl(source.url))) {
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason: "Blocked by SSRF protection",
    });
  }

  updateSourceProbe(sourceId, { status: "downloading" });

  let downloadUrl = source.url;
  let headers: Record<string, string> | undefined;
  if (effectiveKind === "gdrive") {
    const fileId = extractGDriveFileId(source.url);
    if (!fileId) {
      return updateSourceProbe(sourceId, {
        status: "invalid",
        invalidReason: "Invalid Google Drive link",
      });
    }
    const resolved = await resolveGDriveDownload(fileId);
    downloadUrl = resolved.url;
    headers = resolved.headers;
  }

  let response: Response;
  try {
    const downloadInit: RequestInit = { signal: AbortSignal.timeout(downloadTimeoutMs) };
    if (headers) downloadInit.headers = headers;
    response = await safeFetch(downloadUrl, downloadInit);
  } catch (error) {
    console.error(`[worker] downloadAndProbeSource ${sourceId} (${effectiveKind}) failed:`, error);
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason: error instanceof Error ? error.message : "Download blocked",
    });
  }
  if (!response.ok || !response.body) {
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason: `Download failed with status ${response.status}`,
    });
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const allowedBytes = allowedDownloadBytes();
  if (contentLength > maxDownloadBytes || (contentLength > 0 && contentLength > allowedBytes)) {
    return updateSourceProbe(sourceId, {
      status: "invalid",
      invalidReason: "Download exceeds storage limit",
    });
  }

  const extension = path.extname(new URL(source.url).pathname) || ".mp4";
  const target = path.join(
    getCacheDir(),
    `${Date.now()}-${safeFilenamePart(source.id)}${extension}`,
  );
  let bytesWritten = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesWritten += chunk.byteLength;
      if (bytesWritten > maxDownloadBytes || bytesWritten > allowedBytes) {
        controller.error(new Error("Download exceeds storage limit"));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(limiter)),
      createWriteStream(target, { flags: "wx" }),
    );
    if (!getSource(sourceId)) {
      await removeCacheFile(target);
      return undefined;
    }
    return await probeAndUpdateSource(sourceId, target);
  } catch (error) {
    await removeCacheFile(target);
    if (!getSource(sourceId)) return undefined;
    const message = error instanceof Error ? error.message : "Download failed";
    addEvent(null, "source_download_failed", `Source download failed: ${source.name}`, {
      sourceId,
      message,
    });
    return updateSourceProbe(sourceId, { status: "invalid", invalidReason: message });
  }
}
