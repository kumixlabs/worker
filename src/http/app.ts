/**
 * Hono API application, OpenAPI documentation, and dashboard route wiring.
 */

import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { openAPIRouteHandler } from "hono-openapi";

import { allowedCorsOrigins, readSettings } from "../runtime/config";
import { fail, ok, publicApiRateLimit, tokenAuth } from "./middleware";
import { registerAuthRoutes } from "./routes/auth";
import { doc } from "./routes/common";
import { registerCoreRoutes } from "./routes/core";
import { registerEventRoutes } from "./routes/events";
import { registerSourceRoutes } from "./routes/sources";
import { registerStreamRoutes } from "./routes/streams";
import { registerSystemRoutes } from "./routes/system";
import { registerTargetRoutes } from "./routes/targets";
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
    console.error("[worker] HTTP request failed:", error);
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
  });

  app.use(
    "/api/v1/*",
    cors({
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      origin: (origin) => {
        const allowed = allowedCorsOrigins();
        return origin && allowed.includes(origin) ? origin : "";
      },
    }),
  );

  app.get(
    "/health",
    doc("Health", "Health check", "Returns basic process uptime without requiring a token."),
    (c) => c.json(ok({ status: "ok", uptimeSec: Math.round(process.uptime()) })),
  );

  app.get(
    "/openapi",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Kumix Worker API",
          version: "0.1.0",
          description:
            "Local API for Kumix Worker sources, targets, streams, logs, settings, and runtime diagnostics.",
        },
        servers: [
          {
            url: `http://localhost:${process.env.KUMIX_WORKER_PORT ?? 8080}`,
            description: "Local Kumix Worker server",
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              description: "Kumix Worker token. Paste it once to authorize all /api/* requests.",
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    }),
  );

  app.get("/docs", Scalar({ theme: "kepler", url: "/openapi" }));
  app.get(
    "/api/bootstrap",
    doc(
      "System",
      "Read bootstrap data",
      "Returns public token state for the dashboard onboarding screen.",
    ),
    (c) => {
      const settings = readSettings();
      return c.json(
        ok({
          apiVersion: "v1",
          hasToken: Boolean(settings.token),
          tokenLength: settings.token.length,
          dashboardPath: "/auth?token={token}",
        }),
      );
    },
  );

  // Auth handoff routes are public by design (they validate a token or code
  // themselves) and must be registered before the dashboard tokenAuth guard.
  registerAuthRoutes(app);

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: () => fail("payload_too_large", "Request body too large", 413),
    }),
  );

  // Core-facing /api/v1/* routes: CORS + token auth + separate rate limit.
  // The tokenAuth below is scoped to non-v1 paths, so /api/v1/* is guarded here.
  app.use("/api/v1/*", tokenAuth);
  app.use("/api/v1/*", publicApiRateLimit);
  registerCoreRoutes(app);

  // Dashboard /api/* routes (excluding /api/v1/* and /api/auth/*, which are
  // already registered above): require the worker token.
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/v1")) return await next();
    return await tokenAuth(c, next);
  });
  registerSystemRoutes(app);
  registerSourceRoutes(app);
  registerTargetRoutes(app);
  registerStreamRoutes(app);
  registerEventRoutes(app);

  if (publicDir) app.get("/*", (c) => serveStatic(c, publicDir));

  return app;
}
