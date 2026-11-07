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
 * - `declineGroupOffers`: undoing an attack declines its open Minion offer, the forced attacks and the Cloaked
 *   prompt its use opened (convex/lib/actionLog.ts `undoEntry`).
 * - `openAfterRoll` (plan sheet-drawer SD5, Q1): a player's own attack held after its roll for an after-roll feature.
 * - `openServerMove` (plan drawer-answers DA12, Charge): the square a token left when the server moved it; undoing the
 *   use's group puts it back (`declineGroupOffers`).
 * - `openDifficulty` (plan lanes B2, CB p.104 "The GM sets this Difficulty"): a roll waiting for the GM's Difficulty (a
 *   player's Charge; a Cloaked rogue seen dimly only by enemies without a Difficulty). Undoing the move's group declines it.
 *
 * Open requests per campaign are few (one per waiting action); reads take at most `OPEN_SCAN`.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "../../src/lib/errors/app-error";
import type { AfterRollPayload, DifficultyPayload, MinionOfferPayload, RiderPickPayload, SanctionPayload, ServerMovePayload } from "./validators/combatRequests";

/** The most open requests a campaign's reads look at. */
export const OPEN_SCAN = 200;

type Where = { campaignId: Id<"campaigns">; encounterId: Id<"encounters">; mapId: Id<"combatMaps">; createdBy: Id<"users"> };
/**
 * Plan rule-switches OP2: a request that may belong to no encounter (an attack on PCs only, "Conflict between PCs", CB
 * p.168, happens anywhere on the live map). The row's `encounterId` is optional; `encounterRunning` counts it as running.
 */
type LooseWhere = Omit<Where, "encounterId"> & { encounterId?: Id<"encounters"> };

function open<W extends LooseWhere>(where: W) {
  return { ...where, status: "open" as const, createdAt: Date.now(), responses: [] };
}

/** OP2: an out-of-range attack on PCs only waits for the GM without an encounter. */
export function openSanction(ctx: MutationCtx, where: LooseWhere & { payload: SanctionPayload }): Promise<Id<"combatRequests">> {
  return ctx.db.insert("combatRequests", { ...open(where), kind: "sanction" });
}

export function openMinionOffer(ctx: MutationCtx, where: Where & { payload: MinionOfferPayload }): Promise<Id<"combatRequests">> {
  return ctx.db.insert("combatRequests", { ...open(where), kind: "minionOffer" });
}

/**
 * Q1 (plan sheet-drawer SD5): a player's own attack held after its roll for an after-roll feature; nothing is written
 * until `combatActions.afterRoll` answers it (Use, Pass, or the GM's Resolve now). OP2: a held attack on PCs only has no
 * encounter.
 */
export function openAfterRoll(ctx: MutationCtx, where: LooseWhere & { payload: AfterRollPayload }): Promise<Id<"combatRequests">> {
  return ctx.db.insert("combatRequests", { ...open(where), kind: "afterRoll" });
}

/**
 * DA2 (HF p.8 Death Strike, user 2026-10-30): a damage-phase rider waiting for the attacker's Use (on one creature) or
 * Pass after the damage is written; answered by `combatActions.riderPick`.
 */
export function openRiderPick(
  ctx: MutationCtx,
  where: LooseWhere & { payload: RiderPickPayload },
): Promise<Id<"combatRequests">> {
  return ctx.db.insert("combatRequests", { ...where, status: "open" as const, createdAt: Date.now(), responses: [], kind: "riderPick" });
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
export async function closeRequest(ctx: MutationCtx, id: Id<"combatRequests">, status: "resolved" | "declined" | "withdrawn", by: Id<"users">): Promise<void> {
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

/**
 * Undoing an attack declines its open Minion offer, and B2: the open Cloaked Difficulty request of a move in the group. DA12: undoing a feature use (its public row is a `combat` row) also
 * puts back a token the server moved for it (`serverMove`, Charge, CB p.59) on the square it left, and declines the row.
 */
export async function declineGroupOffers(ctx: MutationCtx, campaignId: Id<"campaigns">, groupId: string, by: Id<"users">): Promise<void> {
  for (const row of await openRequests(ctx, campaignId)) {
    const p = row.payload;
    if (p.kind === "minionOffer" && p.groupId === groupId) await closeRequest(ctx, row._id, "declined", by);
    else if (p.kind === "difficulty" && p.ask.kind === "cloak" && p.ask.groupId === groupId) await closeRequest(ctx, row._id, "declined", by);
    else if (p.kind === "forcedAttack" && p.groupId === groupId) await closeRequest(ctx, row._id, "declined", by);
    else if (p.kind === "cloakPrompt" && p.groupId === groupId) await closeRequest(ctx, row._id, "declined", by);
    else if (p.kind === "serverMove" && p.groupId === groupId) {
      const token = await ctx.db.get("combatTokens", p.tokenId);
      if (token !== null && token.campaignId === campaignId) await ctx.db.patch("combatTokens", token._id, { x: p.from.x, y: p.from.y, face: p.from.face });
      await closeRequest(ctx, row._id, "declined", by);
    }
  }
}

/**
 * DA12: records a token the server moved for a feature use (`serverMove`), so undoing the use's group puts it back. The
 * character's older open server moves are resolved first (a newer use of theirs makes the older one's undo stale), so a
 * character holds at most one open row.
 */
export async function openServerMove(
  ctx: MutationCtx,
  where: LooseWhere & { payload: ServerMovePayload },
): Promise<Id<"combatRequests">> {
  for (const row of await openRequests(ctx, where.campaignId)) {
    if (row.payload.kind === "serverMove" && row.payload.characterId === where.payload.characterId) await closeRequest(ctx, row._id, "resolved", where.createdBy);
  }
  return ctx.db.insert("combatRequests", { ...where, status: "open" as const, createdAt: Date.now(), responses: [], kind: "serverMove" });
}

/**
 * B2: opens a roll waiting for the GM's Difficulty (`difficulty`). The character's older open request of the same
 * `ask.kind` is declined first (a newer Charge or move makes it stale), so a character holds at most one of each.
 */
export async function openDifficulty(
  ctx: MutationCtx,
  where: LooseWhere & { payload: DifficultyPayload },
): Promise<Id<"combatRequests">> {
  for (const row of await openRequests(ctx, where.campaignId)) {
    const p = row.payload;
    if (p.kind === "difficulty" && p.characterId === where.payload.characterId && p.ask.kind === where.payload.ask.kind) await closeRequest(ctx, row._id, "declined", where.createdBy);
  }
  return ctx.db.insert("combatRequests", { ...where, status: "open" as const, createdAt: Date.now(), responses: [], kind: "difficulty" });
}
