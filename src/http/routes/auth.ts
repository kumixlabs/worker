/** Dashboard authentication handoff and token verification routes. */

import { randomBytes } from "node:crypto";

import type { Hono } from "hono";

import { fail, ok, verifyToken } from "../middleware";
import { doc } from "./common";

const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const handoffTtlMs = 60 * 1000;

type HandoffEntry = { token: string; expiresAt: number };

/**
 * Short-lived, single-use handoff codes mapping to the worker token. The token
 * is never placed in a redirect URL or Location header; the dashboard exchanges
 * the code for the token via a POST request instead.
 */
const handoffCodes = new Map<string, HandoffEntry>();

/**
 * Removes expired handoff codes to bound memory usage.
 *
 * @param now - Current epoch milliseconds.
 */
function pruneHandoffCodes(now: number): void {
  for (const [code, entry] of handoffCodes) {
    if (entry.expiresAt <= now) handoffCodes.delete(code);
  }
}

/**
 * Registers dashboard token handoff and token verification routes.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerAuthRoutes(app: Hono) {
  app.get(
    "/auth",
    doc("Auth", "Open dashboard", "Validates a token and opens the dashboard."),
    (c) => {
      const token = new URL(c.req.url).searchParams.get("token") ?? "";
      if (!verifyToken(token)) return fail("UNAUTHORIZED", "Invalid Kumix Worker token", 401);
      const now = Date.now();
      pruneHandoffCodes(now);
      const code = randomBytes(32).toString("base64url");
      handoffCodes.set(code, { token, expiresAt: now + handoffTtlMs });
      return c.redirect(`/?code=${encodeURIComponent(code)}`, 302);
    },
  );

  app.post(
    "/api/auth/exchange",
    doc(
      "Auth",
      "Exchange handoff code",
      "Exchanges a short-lived single-use handoff code for the dashboard token.",
    ),
    async (c) => {
      const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof body?.code === "string" ? body.code : "";
      const now = Date.now();
      pruneHandoffCodes(now);
      const entry = code ? handoffCodes.get(code) : undefined;
      if (!entry || entry.expiresAt <= now) {
        if (code) handoffCodes.delete(code);
        return fail("UNAUTHORIZED", "Invalid or expired handoff code", 401);
      }
      handoffCodes.delete(code);
      return c.json(
        ok({ token: entry.token, expiresAt: new Date(now + sessionTtlMs).toISOString() }),
      );
    },
  );

  app.post(
    "/api/auth/verify",
    doc("Auth", "Verify token", "Validates a dashboard token and returns a session expiry."),
    async (c) => {
      const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
      const token = typeof body?.token === "string" ? body.token : "";
      if (!verifyToken(token)) return fail("UNAUTHORIZED", "Invalid Kumix Worker token", 401);
      return c.json(ok({ expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() }));
    },
  );
}
