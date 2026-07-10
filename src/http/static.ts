/**
 * Static asset discovery and serving helpers for bundled worker dashboard files.
 */

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Context } from "hono";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Guards against path traversal by rejecting any segment containing ".." or backslashes.
 *
 * @param requestPath - The request path to validate.
 * @returns True when the path is safe to serve.
 */
function isSafePath(requestPath: string): boolean {
  return !requestPath.split("/").some((part) => part === ".." || part.includes("\\"));
}

/**
 * Resolves the content-type header for a file based on its extension.
 *
 * @param filePath - The file path being served.
 * @returns The matching MIME type, or application/octet-stream as fallback.
 */
function getContentType(filePath: string): string {
  return contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Determines the cache-control header: immutable for hashed assets, no-cache otherwise.
 *
 * @param filePath - The file path being served.
 * @returns The cache-control header value.
 */
function getCacheControl(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() ?? "";
  const isHashed = /[-.][A-Za-z0-9_-]{8,}\.(css|js|png|svg|webp|woff2?)$/i.test(name);
  return isHashed ? "public, max-age=31536000, immutable" : "no-cache";
}

/**
 * Locates the built SPA public directory by checking common build output paths.
 *
 * @returns The absolute path to the public directory, or null if not found.
 */
export function findPublicDir(): string | null {
  const candidates = [
    join(process.cwd(), "public"),
    join(process.cwd(), "dist", "public"),
    resolve(__dirname, "../public"),
    resolve(__dirname, "../../public"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }

  return null;
}

/**
 * Serves static assets from the public directory.
 *
 * @param c - The Hono context.
 * @param publicDir - The path to the public directory.
 * @returns The response.
 */
export async function serveStatic(c: Context, publicDir: string): Promise<Response> {
  const url = new URL(c.req.url);
  const rawPath = url.pathname;
  let requestPath: string;
  try {
    requestPath = decodeURIComponent(rawPath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!isSafePath(rawPath) || !isSafePath(requestPath) || rawPath.toLowerCase().includes("%2e")) {
    return new Response("Not found", { status: 404 });
  }

  const normalizedPath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const publicRoot = resolve(publicDir);
  const requestedFile = resolve(publicRoot, normalizedPath);
  const relativePath = relative(publicRoot, requestedFile);
  if (relativePath.startsWith("..") || relativePath === ".." || relativePath.includes(`..${sep}`)) {
    return new Response("Not found", { status: 404 });
  }

  const indexFile = join(publicRoot, "index.html");
  const requestedStats = await stat(requestedFile).catch(() => null);
  const filePath = requestedStats?.isFile() ? requestedFile : indexFile;
  const file = await readFile(filePath).catch(() => null);

  if (!file) {
    return new Response("UI not built", { status: 404 });
  }

  return new Response(file, {
    headers: {
      "cache-control": getCacheControl(filePath),
      "content-type": getContentType(filePath),
    },
  });
}
