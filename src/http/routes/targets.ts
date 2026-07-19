/** Target CRUD and bulk delete routes with encrypted stream key handling. */

import type { Hono } from "hono";
import { z } from "zod";

import {
  createTarget,
  deleteTarget,
  getTarget,
  listTargets,
  patchTarget,
  safeTarget,
} from "../../db/targets";
import { targetCreateSchema, targetPatchSchema } from "../../schemas/target";
import { fail, ok } from "../middleware";
import { doc } from "./common";

const bulkDeleteSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });

/**
 * Registers CRUD routes for RTMP targets and encrypted stream keys.
 *
 * @param app - Hono app to attach routes to.
 */
export function registerTargetRoutes(app: Hono) {
  app.get(
    "/api/targets",
    doc("Targets", "List targets", "Lists streaming targets with secrets omitted."),
    (c) =>
      c.json(
        ok(
          listTargets().map((target) => {
            const full = getTarget(target.id);
            return full ? safeTarget(full) : target;
          }),
        ),
      ),
  );

  app.post(
    "/api/targets",
    doc("Targets", "Create target", "Creates a streaming target and encrypts its stream key.", 201),
    async (c) => {
      const parsed = targetCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid target");
      }
      return c.json(ok(createTarget(parsed.data)), 201);
    },
  );

  app.delete(
    "/api/targets",
    doc("Targets", "Delete targets", "Deletes multiple streaming targets."),
    async (c) => {
      const parsed = bulkDeleteSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail("BAD_REQUEST", "Invalid target ids");
      const deleted: string[] = [];
      const failed: { id: string; message: string }[] = [];
      for (const id of parsed.data.ids) {
        try {
          if (deleteTarget(id)) deleted.push(id);
          else failed.push({ id, message: "Target not found" });
        } catch (error) {
          failed.push({ id, message: error instanceof Error ? error.message : "Target is in use" });
        }
      }
      return c.json(ok({ deleted, failed }));
    },
  );

  app.get(
    "/api/targets/:id",
    doc("Targets", "Read target", "Returns one target with a masked stream key."),
    (c) => {
      const target = getTarget(c.req.param("id"));
      if (!target) return fail("NOT_FOUND", "Target not found", 404);
      return c.json(ok(safeTarget(target)));
    },
  );

  app.patch(
    "/api/targets/:id",
    doc(
      "Targets",
      "Update target",
      "Updates target label, ingest URL, active state, or stream key.",
    ),
    async (c) => {
      const parsed = targetPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return fail("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid target");
      }
      const updated = patchTarget(c.req.param("id"), parsed.data);
      if (!updated) return fail("NOT_FOUND", "Target not found", 404);
      return c.json(ok(safeTarget(updated)));
    },
  );

  app.delete(
    "/api/targets/:id",
    doc("Targets", "Delete target", "Deletes a streaming target."),
    (c) => {
      try {
        return c.json(ok(deleteTarget(c.req.param("id"))));
      } catch (error) {
        return fail("CONFLICT", error instanceof Error ? error.message : "Target is in use", 409);
      }
    },
  );
}
