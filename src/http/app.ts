/**
 * Hono API application, OpenAPI documentation, and dashboard route wiring.
 */

import { getConnInfo } from "@hono/node-server/conninfo";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { openAPIRouteHandler } from "hono-openapi";

import { requireAdmin, requireSession } from "../auth/middleware";
import { getAuth, getAuthDb } from "../auth/server";
import { readPackageVersion } from "../lib/version";
import { fail, ok, signedRequest } from "./middleware";
import { registerAdminUserRoutes } from "./routes/admin-users";
import { doc } from "./routes/common";
import { registerEventRoutes } from "./routes/events";
import { registerMediaRoutes } from "./routes/media";
import { registerPlaylistRoutes } from "./routes/playlists";
import { registerStreamRoutes } from "./routes/streams";
import { registerSystemRoutes } from "./routes/system";
import { registerYoutubeRoutes } from "./routes/youtube";
import { findPublicDir, serveStatic } from "./static";

/**
 * Builds the Kumix Worker Hono application with API routes, OpenAPI docs, and dashboard serving.
 *
 * @returns The configured Hono app instance.
 */
export function createApiApp() {
  const app = new Hono();
  const publicDir = findPublicDir();

  app.onError((error, c) => {
    console.error("[worker] HTTP request failed:", error instanceof Error ? error.message : error);
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    if (!c.res.headers.get("Content-Security-Policy")) {
      c.header(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https://*.ytimg.com https://*.ggpht.com; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
      );
    }
  });

  app.get(
    "/health",
    doc("Health", "Health check", "Returns basic process uptime without requiring a session."),
    (c) => c.json(ok({ status: "ok", uptimeSec: Math.round(process.uptime()) })),
  );

  app.get(
    "/openapi",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Kumix Worker API",
          version: readPackageVersion(),
          description:
            "Kumix Worker control daemon: authentication, user administration, audit log, and runtime settings.",
        },
        servers: [
          {
            url: `http://localhost:${process.env.KUMIX_WORKER_PORT ?? 8080}`,
            description: "Local Kumix Worker server",
          },
        ],
      },
    }),
  );

  // OpenAPI docs page: requires an admin session.
  app.get("/docs", requireSession, requireAdmin, async (c) => {
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' data: https:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' https://api.scalar.com https://cdn.jsdelivr.net",
    );
    return Scalar({ theme: "kepler", url: "/openapi" })(c, () =>
      Promise.resolve(),
    ) as unknown as Response;
  });

  app.get(
    "/api/bootstrap",
    doc(
      "System",
      "Read bootstrap data",
      "Returns public onboarding state for the dashboard (whether an admin account exists).",
    ),
    (c) => {
      const userCount = getAuthDb().prepare("SELECT COUNT(*) AS n FROM user").get() as {
        n: number;
      };
      return c.json(
        ok({
          apiVersion: "v1",
          hasAdmin: userCount.n > 0,
        }),
      );
    },
  );

  // Body limit applies to all /api/* except raw media uploads, which enforce
  // their own streaming size cap.
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/media" && c.req.method === "POST") return next();
    if (c.req.path.startsWith("/api/media/uploads/") && ["PUT", "POST"].includes(c.req.method))
      return next();
    return bodyLimit({
      maxSize: 1024 * 1024,
      onError: () => fail("payload_too_large", "Request body too large", 413),
    })(c, next);
  });

  // Auth: one-time admin bootstrap, then the Better Auth handler owns /api/auth/*.
  let setupClaimed = false;
  app.post(
    "/api/auth/setup",
    doc(
      "Auth",
      "Create admin",
      "Creates the first admin account when no user exists yet, then signs in.",
    ),
    async (c) => {
      const userCount = getAuthDb().prepare("SELECT COUNT(*) AS n FROM user").get() as {
        n: number;
      };
      if (userCount.n > 0) return fail("FORBIDDEN", "Admin already exists", 403);
      if (setupClaimed) return fail("FORBIDDEN", "Admin already exists", 403);
      setupClaimed = true;
      const raw = await c.req.json().catch(() => null);
      const email = typeof raw?.email === "string" ? raw.email.trim() : "";
      const password = typeof raw?.password === "string" ? raw.password : "";
      const name = typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : "Admin";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return fail("VALIDATION_ERROR", "A valid email is required", 400);
      }
      if (password.length < 8) {
        return fail("VALIDATION_ERROR", "Password must be at least 8 characters", 400);
      }
      try {
        const response = await getAuth().api.signUpEmail({
          body: { email, password, name, callbackURL: "/" },
          asResponse: true,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          return fail(
            "VALIDATION_ERROR",
            body?.message ?? "Could not create the admin account",
            400,
          );
        }
        getAuthDb().prepare("UPDATE user SET role = 'admin' WHERE email = ?").run(email);
      } catch (error) {
        setupClaimed = false;
        const message =
          error instanceof Error ? error.message : "Could not create the admin account";
        return fail("VALIDATION_ERROR", message, 400);
      }
      return await getAuth().api.signInEmail({
        body: { email, password },
        headers: c.req.raw.headers,
        asResponse: true,
      });
    },
  );
  // Better Auth admin plugin cannot guard role demotion of the only admin; intercept before it owns the route.
  app.on("POST", "/api/auth/admin/update-user", async (c) => {
    const raw = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as {
      userId?: string;
      data?: { role?: string | string[] };
    } | null;
    const role = raw?.data?.role;
    const demotes =
      role !== undefined &&
      (Array.isArray(role) ? role.every((r) => r !== "admin") : role !== "admin");
    if (raw?.userId && demotes) {
      const target = getAuthDb().prepare("SELECT role FROM user WHERE id = ?").get(raw.userId) as
        | { role?: string }
        | undefined;
      if (target?.role === "admin") {
        const admins = getAuthDb()
          .prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'admin'")
          .get() as { n: number };
        if (admins.n <= 1) {
          return fail("BAD_REQUEST", "Cannot demote the only admin account", 400);
        }
      }
    }
    return getAuth().handler(c.req.raw);
  });
  app.all("/api/auth/*", (c) => {
    // Node runtime requests carry no peer address, which breaks Better Auth
    // rate-limit bucketing. Direct mode: overwrite x-real-ip with the socket
    // remote address and drop client-supplied forwarding headers. Proxy mode
    // (TRUST_PROXY=1): keep the proxy's x-forwarded-for, drop spoofable ones.
    const headers = new Headers(c.req.raw.headers);
    if (process.env.KUMIX_WORKER_TRUST_PROXY === "1") {
      headers.delete("x-real-ip");
    } else {
      const ip = getConnInfo(c).remote.address;
      headers.delete("x-forwarded-for");
      if (ip) headers.set("x-real-ip", ip);
      else headers.delete("x-real-ip");
    }
    return getAuth().handler(new Request(c.req.raw, { headers }));
  });

  // Dashboard /api/* routes: require a Better Auth session unless explicitly public.
  app.use("/api/*", async (c, next) => {
    const path = c.req.path;
    if (
      path.startsWith("/api/auth") ||
      path === "/api/bootstrap" ||
      path === "/api/youtube/callback" ||
      signedRequest(c)
    ) {
      return await next();
    }
    return await requireSession(c, next);
  });

  registerSystemRoutes(app);
  registerAdminUserRoutes(app);
  registerEventRoutes(app);
  registerMediaRoutes(app);
  registerPlaylistRoutes(app);
  registerStreamRoutes(app);
  registerYoutubeRoutes(app);

  app.all("/api/*", (c) => fail("NOT_FOUND", "Unknown API route", 404));

  if (publicDir) app.get("/*", (c) => serveStatic(c, publicDir));

  return app;
}
