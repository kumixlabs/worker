/** Dashboard authentication: password login and CLI/core handoff. */

import { randomBytes } from "node:crypto";

import type { Hono } from "hono";

import { isDefaultPasswordHash, verifyPassword } from "../../lib/password";
import { readSettings } from "../../runtime/config";
import {
  checkAuthRateLimit,
  clearAuthRateLimit,
  fail,
  ok,
  recordAuthFailure,
  verifyToken,
} from "../middleware";
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

const handoffPruneTimer = setInterval(() => pruneHandoffCodes(Date.now()), 5 * 60 * 1000);
handoffPruneTimer.unref?.();

function issueSession(token: string, passwordIsDefault = false) {
  return {
    token,
    expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
    passwordIsDefault,
  };
}

/**
 * Registers dashboard auth routes (password login and token handoff).
 *
 * @param app - Hono app to attach routes to.
 */
export function registerAuthRoutes(app: Hono) {
  app.get(
    "/auth",
    doc("Auth", "Open dashboard", "Validates a token and opens the dashboard."),
    (c) => {
      const limited = checkAuthRateLimit(c);
      if (limited) return limited;
      const token = new URL(c.req.url).searchParams.get("token") ?? "";
      if (!verifyToken(token)) {
        recordAuthFailure(c);
        return fail("UNAUTHORIZED", "Invalid Kumix Worker token", 401);
      }
      clearAuthRateLimit(c);
      const now = Date.now();
      pruneHandoffCodes(now);
      const code = randomBytes(32).toString("base64url");
      handoffCodes.set(code, { token, expiresAt: now + handoffTtlMs });
      return c.redirect(`/#code=${encodeURIComponent(code)}`, 302);
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
      const limited = checkAuthRateLimit(c);
      if (limited) return limited;
      const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof body?.code === "string" ? body.code : "";
      const now = Date.now();
      pruneHandoffCodes(now);
      const entry = code ? handoffCodes.get(code) : undefined;
      if (!entry || entry.expiresAt <= now) {
        if (code) handoffCodes.delete(code);
        recordAuthFailure(c);
        return fail("UNAUTHORIZED", "Invalid or expired handoff code", 401);
      }
      clearAuthRateLimit(c);
      handoffCodes.delete(code);
      const settings = readSettings();
      return c.json(
        ok(issueSession(entry.token, await isDefaultPasswordHash(settings.passwordHash))),
      );
    },
  );

  app.post(
    "/api/auth/login",
    doc(
      "Auth",
      "Login with password",
      "Validates the dashboard password and returns the worker API token for the SPA session.",
    ),
    async (c) => {
      const limited = checkAuthRateLimit(c);
      if (limited) return limited;
      const body = (await c.req.json().catch(() => null)) as { password?: unknown } | null;
      const password = typeof body?.password === "string" ? body.password : "";
      const settings = readSettings();
      if (!password || !(await verifyPassword(password, settings.passwordHash))) {
        recordAuthFailure(c);
        return fail("UNAUTHORIZED", "Invalid password", 401);
      }
      clearAuthRateLimit(c);
      return c.json(
        ok(issueSession(settings.token, await isDefaultPasswordHash(settings.passwordHash))),
      );
    },
  );
}
