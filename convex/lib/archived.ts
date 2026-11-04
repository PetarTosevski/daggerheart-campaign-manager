/**
 * Q9 a: an archived campaign (`archivedAt` set) is read-only for everyone.
 *
 * - `refuseArchived(campaign, archived?)`: throws CAMPAIGN_ARCHIVED for an archived campaign unless `archived` is
 *   `"allow"`. The campaign mutation wrappers in convex/lib/functions.ts call it after their access check (config G1).
 * - `refuseArchivedWrite(ctx, campaign)`: the same refusal for a write that loads its campaign itself instead of
 *   through a campaign wrapper (dcm-jh6d.64): character writes through `loadCharacter`, the World
 *   map, the Codex, countdown and objective operations, undo, invite revocation. It refuses only in a mutation, whose
 *   `ctx.db` writes; a query (the same loaders serve reads) still reads the archived campaign. Call it after the access
 *   check, so a stranger still gets NOT_FOUND.
 */
import { appError } from "../../src/lib/errors/app-error";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export function refuseArchived(campaign: Pick<Doc<"campaigns">, "archivedAt">, archived?: "allow"): void {
  if (campaign.archivedAt !== undefined && archived !== "allow") throw appError("CAMPAIGN_ARCHIVED");
}

/** Whether `ctx` writes: a mutation's database has `insert`, a query's does not. */
function writes(ctx: QueryCtx): boolean {
  return "insert" in ctx.db;
}

export function refuseArchivedWrite(ctx: QueryCtx, campaign: Pick<Doc<"campaigns">, "archivedAt">): void {
  if (writes(ctx)) refuseArchived(campaign);
}
