import type { AdminAuditAction } from "../../src/lib/admin/config";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** A before / after value: a setting's value, never a key, a secret or a code. */
export type AuditValue = string | number | boolean;

export type AdminChange = {
  action: AdminAuditAction;
  /** The setting changed (a cap key, a feature key, a Lorekeeper setting). */
  field?: string;
  from?: AuditValue;
  to?: AuditValue;
  /** The id acted on (a user, a campaign, a request). */
  target?: string;
};

/**
 * Writes one `adminAudit` row (config AD0, Q26 a) in the caller's transaction. Every admin mutation calls it, and so
 * do campaign create / delete (Q26 a). Rows expire after 365 days (`adminRetention.expireAudit`).
 */
export async function recordAdminChange(ctx: MutationCtx, actorId: Id<"users">, change: AdminChange): Promise<Id<"adminAudit">> {
  return ctx.db.insert("adminAudit", {
    at: Date.now(),
    actorId,
    action: change.action,
    ...(change.field !== undefined ? { field: change.field } : {}),
    ...(change.from !== undefined ? { from: change.from } : {}),
    ...(change.to !== undefined ? { to: change.to } : {}),
    ...(change.target !== undefined ? { target: change.target } : {}),
  });
}
