/**
 * Admin routes: user management plus global (cross-user) stats, bandwidth,
 * and system metrics. Everything requires an admin session.
 */

import type { Hono } from "hono";
import { z } from "zod";

import { requireAdmin } from "../../auth/middleware";
import { getAuthDb } from "../../auth/server";
import { getDb } from "../../db/client";
import { addEvent } from "../../db/events";
import { runtimeMetrics } from "../../runtime/metrics";
import { getUserUsage } from "../../services/quota";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const userQuotasPatchSchema = z.object({
  maxStorageBytes: z.number().int().nonnegative().nullable().optional(),
  maxStreams: z.number().int().nonnegative().nullable().optional(),
});

export function registerAdminUserRoutes(app: Hono) {
  app.get(
    "/api/admin/metrics",
    doc("Admin", "System metrics", "Hardware metrics including CPU, memory, and disk usage."),
    requireAdmin,
    (c) => c.json(ok(runtimeMetrics())),
  );

  app.get(
    "/api/admin/users",
    doc("Admin", "List users", "Lists all users with quota and usage statistics."),
    requireAdmin,
    async (c) => {
      const users = (getAuthDb()
        .prepare(
          "SELECT id, name, email, emailVerified, image, role, banned, banReason, banExpires, maxStorageBytes, maxStreams, createdAt, updatedAt FROM user ORDER BY createdAt ASC",
        )
        .all() ?? []) as Array<{
        id: string;
        name: string;
        email: string;
        emailVerified: number;
        image: string | null;
        role: string | null;
        banned: number | null;
        banReason: string | null;
        banExpires: number | null;
        maxStorageBytes: number | null;
        maxStreams: number | null;
        createdAt: number;
        updatedAt: number;
      }>;

      const results = users.map((u) => {
        const usage = getUserUsage(u.id);
        return {
          ...u,
          banned: Boolean(u.banned),
          emailVerified: Boolean(u.emailVerified),
          usage: {
            storageBytes: usage.storageBytes,
            storageQuota: u.maxStorageBytes,
            streamCount: usage.streamCount,
            streamQuota: u.maxStreams,
          },
        };
      });

      return c.json(ok(results));
    },
  );

  app.patch(
    "/api/admin/users/:id/quotas",
    doc("Admin", "Update quotas", "Updates storage and stream quotas for a user."),
    requireAdmin,
    async (c) => {
      const id = c.req.param("id");
      const parsed = userQuotasPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid quota payload");
      }
      const existing = getAuthDb().prepare("SELECT id FROM user WHERE id = ?").get(id);
      if (!existing) return fail("NOT_FOUND", "User not found", 404);

      const updates: string[] = [];
      const values: unknown[] = [];
      if (parsed.data.maxStorageBytes !== undefined) {
        updates.push("maxStorageBytes = ?");
        values.push(parsed.data.maxStorageBytes);
      }
      if (parsed.data.maxStreams !== undefined) {
        updates.push("maxStreams = ?");
        values.push(parsed.data.maxStreams);
      }
      if (updates.length > 0) {
        updates.push("updatedAt = ?");
        values.push(Date.now());
        values.push(id);
        getAuthDb()
          .prepare(`UPDATE user SET ${updates.join(", ")} WHERE id = ?`)
          .run(...values);
      }

      const updated = getAuthDb()
        .prepare(
          "SELECT id, name, email, role, banned, maxStorageBytes, maxStreams FROM user WHERE id = ?",
        )
        .get(id);
      addEvent(null, "admin_user_quotas", `Admin updated quotas for user ${id}`, {
        actorId: c.get("user")?.id ?? null,
        targetId: id,
        ...parsed.data,
      });
      return c.json(ok(updated));
    },
  );

  app.delete(
    "/api/admin/users/:id",
    doc("Admin", "Delete user", "Deletes the user account, sessions, and audit history."),
    requireAdmin,
    async (c) => {
      const id = c.req.param("id");
      const currentUser = c.get("user");
      if (currentUser?.id === id) {
        return fail("CONFLICT", "Cannot delete your own admin account", 409);
      }
      const targetUser = getAuthDb().prepare("SELECT id FROM user WHERE id = ?").get(id);
      if (!targetUser) return fail("NOT_FOUND", "User not found", 404);

      getAuthDb().prepare("DELETE FROM session WHERE userId = ?").run(id);
      getAuthDb().prepare("DELETE FROM account WHERE userId = ?").run(id);
      getAuthDb().prepare("DELETE FROM user WHERE id = ?").run(id);
      getDb().query("DELETE FROM events WHERE user_id = ?").run(id);

      addEvent(null, "admin_user_deleted", `Admin deleted user ${id}`, {
        actorId: currentUser?.id ?? null,
        targetId: id,
      });
      return c.json(ok({ deleted: true }));
    },
  );
}
