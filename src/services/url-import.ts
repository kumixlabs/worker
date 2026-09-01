/**
 * SSRF-safe remote URL import for the media library.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1] as string);
    return false;
  }
  return false;
}

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

export async function safeFetch(
  urlString: string,
  init?: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = urlString;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!(await validateUrl(currentUrl)))
      throw new Error("URL blocked: private or invalid address (SSRF protection)");
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
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
