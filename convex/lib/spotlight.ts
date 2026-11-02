/**
 * The spotlight's server helpers (plan combat-hud H1.S, user answer 1c, user answer 2026-11-01 on movement). The
 * `combatSpotlight` table holds at most one row per campaign: who holds the spotlight now, since when and why.
 *
 * Rules: CB p.100 "Battling Adversaries": "The player characters pass the spotlight between themselves, making moves
 * until someone fails a roll or rolls with Fear, or until the GM spends a Fear to interrupt the players' turns. When
 * play passes to the GM, the GM can make a move to spotlight an adversary [...] Once the GM has finished, play passes
 * back to the PCs." CB p.149 "When to Make a Move": "Rolls with Fear on an action roll. / Fails an action roll."
 *
 * - `moveToGm(ctx, campaign, reason, rollBy?)`: the engine's call when a PC's action roll comes up with Fear or fails
 *   (`rollWithFear` / `failedRoll`), or the GM spotlights an adversary (`adversary`). Wired by bead dcm-bxp.99.32.4;
 *   until then only the GM's `combatSpotlight.gmTake` moves it.
 * - `giveTo(ctx, campaign, characterId)`: the GM hands it to a PC (`combatSpotlight.handTo`).
 * - `assertMayAct(ctx, campaign, character, kind)`: refuses a player's `action` or token `move` with
 *   SPOTLIGHT_WITH_GM while the GM holds the spotlight; a `reaction` always passes, and so does the GM. Wired by bead
 *   dcm-bxp.99.32.5; until then nothing is refused.
 *
 * ```ts
 * // in a roll mutation, after the outcome is known (dcm-bxp.99.32.4):
 * if (outcome.withFear) await moveToGm(ctx, campaign, "rollWithFear", characterId);
 * else if (!outcome.success) await moveToGm(ctx, campaign, "failedRoll", characterId);
 * // at the top of a player's card use, feature use, attack or token move (dcm-bxp.99.32.5):
 * await assertMayAct(ctx, campaign, character, "action"); // or "move"; a reaction passes "reaction"
 * ```
 */
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { SpotlightHolder, SpotlightReason } from "../tables/combatSpotlight";
import { atLeast, permissionFor } from "./permissions";

/** What a player is about to do: an `action` (a roll, a card, a feature, an attack), a token `move`, or a `reaction`. */
export type ActKind = "action" | "move" | "reaction";

/** Reasons the engine moves the spotlight to the GM. */
export type MoveToGmReason = Extract<SpotlightReason, "rollWithFear" | "failedRoll" | "adversary" | "gmTook">;

/** The campaign's spotlight row, or null (the players hold it, nobody in particular). */
export async function spotlightOf(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"combatSpotlight"> | null> {
  return ctx.db
    .query("combatSpotlight")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .first();
}

/** Whether the GM holds the spotlight in the campaign now. */
export async function gmHoldsSpotlight(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  return (await spotlightOf(ctx, campaignId))?.holder.kind === "gm";
}

function sameHolder(a: SpotlightHolder, b: SpotlightHolder): boolean {
  if (a.kind === "gm" || b.kind === "gm") return a.kind === b.kind;
  return a.characterId === b.characterId;
}

/** Writes the campaign's holder; returns false (and writes nothing) when it already holds it. */
async function setHolder(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  holder: SpotlightHolder,
  reason: SpotlightReason,
  rollBy: Id<"characters"> | undefined,
): Promise<boolean> {
  const row = await spotlightOf(ctx, campaignId);
  // Unchanged holder: no write, so a run of Fear rolls does not re-run every reader (CD10).
  if (row !== null && sameHolder(row.holder, holder)) return false;
  const next = { holder, since: Date.now(), reason, rollBy };
  if (row === null) await ctx.db.insert("combatSpotlight", { campaignId, ...next });
  else await ctx.db.replace("combatSpotlight", row._id, { campaignId, ...next });
  return true;
}

/**
 * Moves the spotlight to the GM (CB p.100, p.149). `rollBy` names the PC whose roll moved it. Returns whether it moved
 * (false when the GM already held it: `since` and `reason` keep the first move).
 */
export async function moveToGm(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  reason: MoveToGmReason,
  rollBy?: Id<"characters">,
): Promise<boolean> {
  const fromRoll = reason === "rollWithFear" || reason === "failedRoll";
  return setHolder(ctx, campaign._id, { kind: "gm" }, reason, fromRoll ? rollBy : undefined);
}

/**
 * Hands the spotlight to one of the campaign's active PCs. NOT_FOUND for a character of another campaign, INVALID for
 * one that is not active (dead, retired, away). Returns whether it moved.
 */
export async function giveTo(ctx: MutationCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">): Promise<boolean> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaign._id) throw appError("NOT_FOUND");
  if (character.status !== "active") throw appError("INVALID", "Only an active character can take the spotlight.");
  return setHolder(ctx, campaign._id, { kind: "pc", characterId }, "handedBack", undefined);
}

/**
 * Refuses a player's non-reaction act while the GM holds the spotlight (answer 1c; user answer 2026-11-01: token
 * moves too). `character` is the PC acting; the GM (owner permission on the campaign, `permissionFor`) is never
 * refused, including while playing for a PC. Call it before any write, from a mutation whose ctx carries the caller.
 */
export async function assertMayAct(
  ctx: QueryCtx & { user: Doc<"users"> },
  campaign: Doc<"campaigns">,
  character: Pick<Doc<"characters">, "_id" | "campaignId">,
  kind: ActKind,
): Promise<void> {
  if (character.campaignId !== campaign._id) throw new Error("assertMayAct: the character is not in this campaign.");
  if (kind === "reaction") return;
  if (!(await gmHoldsSpotlight(ctx, campaign._id))) return;
  const permission = await permissionFor(ctx, ctx.user, { type: "campaign", campaign }, "owner");
  if (atLeast(permission, "owner")) return;
  throw appError("SPOTLIGHT_WITH_GM");
}
