/**
 * Google Drive import: resolves share URLs to direct downloads, including the
 * large-file virus-scan confirmation flow. Only Google-owned hosts are ever
 * fetched, so there is no arbitrary-URL SSRF surface.
 */

const gdriveFileIdPattern = /^[A-Za-z0-9_-]{10,128}$/;
const gdriveHosts = new Set([
  "drive.google.com",
  "drive.usercontent.google.com",
  "docs.google.com",
]);
const gdriveUserAgent = "Mozilla/5.0 (compatible; KumixWorker/1.0)";

/**
 * Extracts a Google Drive file ID from common share URL formats.
 */
export function extractGDriveFileId(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    if (!gdriveHosts.has(url.hostname)) return null;
    const pathMatch = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (pathMatch && gdriveFileIdPattern.test(pathMatch[1])) return pathMatch[1];
    const idParam = url.searchParams.get("id");
    if (idParam && gdriveFileIdPattern.test(idParam)) return idParam;
    return null;
  } catch {
    return null;
  }
}

function toCookieHeader(setCookie: string[]): string | null {
  const cookies = setCookie
    .map((value) => value.split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value));
  return cookies.length > 0 ? cookies.join("; ") : null;
}

/**
 * Extracts the confirmed download URL from a Google Drive warning page.
 */
function extractConfirmedUrl(body: string, fileId: string, cookie: string | null): string | null {
  const decoded = body.replaceAll("&amp;", "&");
  const hrefMatch = decoded.match(/href="([^"]*\/download\?[^"]+)"/);
  if (hrefMatch) {
    try {
      const url = new URL(hrefMatch[1], "https://drive.usercontent.google.com");
      if (gdriveHosts.has(url.hostname)) return url.toString();
    } catch {
      // fall through to confirm-token derivation
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
 * Resolves a Google Drive file ID to a downloadable response. Handles the
 * confirmation interstitial and carries its cookies to the real download.
 */
export async function resolveGDriveDownload(
  fileId: string,
  signal?: AbortSignal,
): Promise<{ response: Response; fileName?: string }> {
  const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  let cookie: string | null = null;
  let response = await fetch(directUrl, {
    redirect: "manual",
    headers: { "User-Agent": gdriveUserAgent },
    signal,
  });
  // Follow same-host redirects manually so cookies accumulate.
  for (let hop = 0; hop < 5 && response.status >= 300 && response.status < 400; hop += 1) {
    cookie = mergeCookie(cookie, response.headers.getSetCookie?.() ?? []);
    const location = response.headers.get("location");
    if (!location) break;
    const next = new URL(location, directUrl);
    if (!gdriveHosts.has(next.hostname)) throw new Error("Unexpected redirect host during import");
    response = await fetch(next, {
      redirect: "manual",
      headers: { "User-Agent": gdriveUserAgent, ...(cookie ? { Cookie: cookie } : {}) },
      signal,
    });
  }
  cookie = mergeCookie(cookie, response.headers.getSetCookie?.() ?? []);

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html")) {
    const body = await response.text();
    // Google serves a JSON-ish action page for some files.
    const jsonMatch = body.match(/"(?:downloadUrl|directDownloadUrl)"\s*:\s*"([^"]+)"/);
    const fileNameMatch = body.match(/"fileName"\s*:\s*"([^"]+)"/);
    if (jsonMatch) {
      const confirmed = jsonMatch[1].replaceAll("\\u003d", "=").replaceAll("\\u0026", "&");
      const url = new URL(confirmed, "https://drive.usercontent.google.com");
      if (!gdriveHosts.has(url.hostname)) throw new Error("Unexpected download host during import");
      const download = await fetch(url, {
        headers: { "User-Agent": gdriveUserAgent, ...(cookie ? { Cookie: cookie } : {}) },
        signal,
      });
      if (!download.ok) throw new Error(`Google Drive download failed (${download.status})`);
      return {
        response: download,
        fileName: fileNameMatch?.[1]?.replaceAll(/\\"/g, '"'),
      };
    }
    const confirmedUrl = extractConfirmedUrl(body, fileId, cookie);
    if (!confirmedUrl) throw new Error("Google Drive confirmation page could not be resolved");
    const download = await fetch(confirmedUrl, {
      headers: { "User-Agent": gdriveUserAgent, ...(cookie ? { Cookie: cookie } : {}) },
      signal,
    });
    if (!download.ok) throw new Error(`Google Drive download failed (${download.status})`);
    return { response: download, fileName: fileNameMatch?.[1] };
  }
  if (!response.ok) {
    throw new Error(
      response.status === 404 || response.status === 403
        ? "Google Drive file not found or not shared publicly"
        : `Google Drive download failed (${response.status})`,
    );
  }
  return { response };
}

function mergeCookie(current: string | null, setCookie: string[]): string | null {
  const next = toCookieHeader(setCookie);
  if (!next) return current;
  return current ? `${current}; ${next}` : next;
}
