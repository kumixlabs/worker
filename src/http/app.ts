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
import { registerEventRoutes } from "./routes/events";
import { registerPublicRoutes } from "./routes/public";
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

  app.use(
    "/api/v1/*",
    cors({
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      origin: (origin) => {
        const allowed = allowedCorsOrigins();
        if (allowed.length === 0) {
          if (process.env.NODE_ENV !== "production") return origin || "*";
          return origin && allowed.includes(origin) ? origin : "";
        }
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

  registerAuthRoutes(app);

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: () => fail("payload_too_large", "Request body too large", 413),
    }),
  );
  app.use("/api/v1/*", tokenAuth);
  app.use("/api/v1/*", publicApiRateLimit);
  registerPublicRoutes(app);

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
