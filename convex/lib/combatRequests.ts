/**
 * Helpers of the `combatRequests` table (plan combat-actions; table AA0, these helpers CA3). Callers are campaign
 * wrappers; these only scope, bound and write.
 *
 * - `openSanction` (Q1): a player's out-of-range attack waiting for the GM; nothing is rolled or charged until
 *   `combatRequests.sanction` approves it.
 * - `openMinionOffer` (Q6, CB p.201): the extra Minions an attack may defeat, waiting for the attacker's pick.
 * - `closeEncounterRequests`: declines every open request of an encounter that ended (orchestrator note on AA0). The
 *   encounter-end path (convex/encounters.ts, not owned by CA3) should call it; until then `sanction`, `pickMinions`
 *   and `mine` treat a request whose encounter is no longer running as closed.
 * - `declineGroupOffers`: undoing an attack declines its open Minion offer (convex/lib/actionLog.ts `undoEntry`).
 *
 * Open requests per campaign are few (one per waiting action); reads take at most `OPEN_SCAN`.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "../../src/lib/errors/app-error";
import type { MinionOfferPayload, SanctionPayload } from "./validators/combatRequests";

/** The most open requests a campaign's reads look at. */
export const OPEN_SCAN = 200;

type Where = { campaignId: Id<"campaigns">; encounterId: Id<"encounters">; mapId: Id<"combatMaps">; createdBy: Id<"users"> };

function open<W extends Where>(where: W) {
  return { ...where, status: "open" as const, createdAt: Date.now(), responses: [] };
}

export function openSanction(ctx: MutationCtx, where: Where & { payload: SanctionPayload }): Promise<Id<"combatRequests">> {
  return ctx.db.insert("combatRequests", { ...open(where), kind: "sanction" });
}

export function openMinionOffer(ctx: MutationCtx, where: Where & { payload: MinionOfferPayload }): Promise<Id<"combatRequests">> {
  return ctx.db.insert("combatRequests", { ...open(where), kind: "minionOffer" });
}

/** The campaign's open requests, oldest first (bounded). */
export function openRequests(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"combatRequests">[]> {
  return ctx.db
    .query("combatRequests")
    .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaignId).eq("status", "open"))
    .take(OPEN_SCAN);
}

/** The campaign's request with this id, or NOT_FOUND (bad id, another campaign's). REQUEST_NOT_OPEN once answered. */
export async function loadOpenRequest(ctx: QueryCtx, campaignId: Id<"campaigns">, requestId: Id<"combatRequests">): Promise<Doc<"combatRequests">> {
  const row = await ctx.db.get("combatRequests", requestId);
  if (row === null || row.campaignId !== campaignId) throw appError("NOT_FOUND");
  if (row.status !== "open") throw appError("REQUEST_NOT_OPEN");
  return row;
}

/** Whether the request's encounter is still running (a request without one counts as running). */
export async function encounterRunning(ctx: QueryCtx, row: Doc<"combatRequests">): Promise<boolean> {
  if (row.encounterId === undefined) return true;
  const encounter = await ctx.db.get("encounters", row.encounterId);
  return encounter !== null && encounter.status === "running";
}

/** Closes one request: `resolved` or `declined`, with `resolvedAt` (the retention cron ranges on it). */
export async function closeRequest(ctx: MutationCtx, id: Id<"combatRequests">, status: "resolved" | "declined", by: Id<"users">): Promise<void> {
  await ctx.db.patch("combatRequests", id, { status, resolvedAt: Date.now(), resolvedBy: by });
}

/** Declines every open request of an encounter (call when it ends). Returns how many it closed. */
export async function closeEncounterRequests(ctx: MutationCtx, campaignId: Id<"campaigns">, encounterId: Id<"encounters">, by: Id<"users">): Promise<number> {
  let closed = 0;
  for (const row of await openRequests(ctx, campaignId)) {
    if (row.encounterId !== encounterId) continue;
    await closeRequest(ctx, row._id, "declined", by);
    closed++;
  }
  return closed;
}

/** The open Minion offer of an attack's actionLog group, or null. */
export async function groupOffer(ctx: QueryCtx, campaignId: Id<"campaigns">, groupId: string): Promise<Doc<"combatRequests"> | null> {
  for (const row of await openRequests(ctx, campaignId)) {
    if (row.payload.kind === "minionOffer" && row.payload.groupId === groupId) return row;
  }
  return null;
}

/** Undoing an attack declines its open Minion offer. */
export async function declineGroupOffers(ctx: MutationCtx, campaignId: Id<"campaigns">, groupId: string, by: Id<"users">): Promise<void> {
  const offer = await groupOffer(ctx, campaignId, groupId);
  if (offer !== null) await closeRequest(ctx, offer._id, "declined", by);
}
