import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { getAuth } from "./server";

type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  banned: boolean;
  maxStorageBytes: number | null;
  maxStreams: number | null;
};

function cfail(c: Context, code: string, message: string, status: ContentfulStatusCode) {
  return c.json({ ok: false, error: { code, message } }, status);
}

export async function requireSession(c: Context, next: Next) {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers });
  if (!session) return cfail(c, "UNAUTHORIZED", "Authentication required", 401);
  if (session.user.banned) return cfail(c, "FORBIDDEN", "This account is banned", 403);
  const user: SessionUser = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role ?? "user",
    banned: Boolean(session.user.banned),
    maxStorageBytes: session.user.maxStorageBytes ?? null,
    maxStreams: session.user.maxStreams ?? null,
  };
  c.set("user", user);
  return await next();
}

export async function requireAdmin(c: Context, next: Next) {
  if (c.get("user")?.role !== "admin") {
    return cfail(c, "FORBIDDEN", "Admin access required", 403);
  }
  return await next();
}
