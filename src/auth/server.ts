import { mkdirSync } from "node:fs";
import path from "node:path";

import { betterAuth } from "better-auth";
import { admin as adminPlugin } from "better-auth/plugins";
import BetterSqlite3 from "better-sqlite3";
import type { SqliteDialectConfig } from "kysely";
import { SqliteDialect } from "kysely";

import { AUTH_SCHEMA_SQL } from "../db/client";
import { getDbPath } from "../runtime/config";

let authDb: BetterSqlite3.Database | null = null;

export function getAuthDb(): BetterSqlite3.Database {
  if (!authDb) {
    mkdirSync(path.dirname(getDbPath()), { recursive: true });
    const db = new BetterSqlite3(getDbPath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.exec(AUTH_SCHEMA_SQL);
    authDb = db;
  }
  return authDb;
}

export function closeAuthDb(): void {
  if (authDb) {
    authDb.close();
    authDb = null;
  }
}

function buildAuth() {
  const database = (async () => getAuthDb()) as SqliteDialectConfig["database"];
  const corsOrigins = (process.env.KUMIX_WORKER_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const devOrigins = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
  ];
  return betterAuth({
    database: {
      dialect: new SqliteDialect({ database }),
    },
    baseURL: process.env.BETTER_AUTH_URL,
    // Dev runs on two origins (:8000 Vite, :8080 API), so a static baseURL is
    // impossible; origins are validated per-request via trustedOrigins instead.
    logger: {
      log(level, message, ...args) {
        if (level === "warn" && message.includes("Base URL is not set")) return;
        if (level === "error" || level === "warn") console.warn(message, ...args);
      },
    },
    trustedOrigins(request) {
      return request
        ? [new URL(request.url).origin, ...devOrigins, ...corsOrigins]
        : [...devOrigins, ...corsOrigins];
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
        // Empty by default: app.ts stamps the socket peer address into
        // x-real-ip itself (no client-supplied header is trusted). Broadened
        // only behind an explicit reverse proxy opt-in.
        trustedProxies:
          process.env.KUMIX_WORKER_TRUST_PROXY === "1"
            ? ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
            : [],
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
      customRules: {
        // Read-only session endpoints: hit on every SPA mount; no brute-force
        // surface. Global/sign-in limits still protect credentials.
        "/get-session": false,
        "/list-sessions": false,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        maxStorageBytes: {
          type: "number",
          required: false,
          nullable: true,
          defaultValue: null,
        },
        maxStreams: {
          type: "number",
          required: false,
          nullable: true,
          defaultValue: null,
        },
      },
    },
    plugins: [adminPlugin({ defaultRole: "user" })],
  });
}

let authInstance: ReturnType<typeof buildAuth> | null = null;

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!authInstance) authInstance = buildAuth();
  return authInstance;
}

export function resetAuthForTests(): void {
  closeAuthDb();
  authInstance = null;
}

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  maxStorageBytes?: number | null;
  maxStreams?: number | null;
};

declare module "hono" {
  interface ContextVariableMap {
    user?: AuthUser;
  }
}
