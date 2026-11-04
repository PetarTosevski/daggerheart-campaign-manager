/**
 * "Seen by the party this scene" (user 2026-11-03, docs/tasks/TASK-SPOTLIGHT-SEEN.md): which adversary tokens a
 * player's character has seen since the scene began, in the `combatSeen` table (one row per campaign + token).
 *
 * The rule it serves (`combatSpotlight.state`): a player learns which adversary the GM spotlighted only when the party
 * saw it this scene; never seen, they get null.
 *
 * How rows are written: a player's view (`combatVision.playerView`, the one place a player's visible tokens are
 * computed) lists the adversaries it shows that have no row yet (`unseenAdversaries`); the player's client sends them
 * to `combatVision.markSeen`, which recomputes the character's view and keeps only those it sees now
 * (`recordSeen`). Every reveal path (a token or PC move, a light, a door, fog, a GM reveal, the time of day, an area)
 * ends in that view, so this one hook catches them all, as long as the player's map is open. Queries cannot write, and
 * hooking each of those mutations would mean a scene load in every one of them.
 *
 * Rows are deleted at End scene (`forgetSeen`, from `endScene` and the session end) and with the campaign (purge).
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_COMBAT_TOKENS } from "./combatMaps";

/**
 * Rows read or deleted at once: every token of the largest map, several times over (maps change within a scene). A
 * scene end deletes at most this many; any left over are deleted by the next one.
 */
export const SEEN_MAX = MAX_COMBAT_TOKENS * 5;

/** Whether the party saw this token during the current scene. */
export async function seenThisScene(ctx: QueryCtx, campaignId: Id<"campaigns">, tokenId: Id<"combatTokens">): Promise<boolean> {
  const row = await ctx.db
    .query("combatSeen")
    .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId).eq("tokenId", tokenId))
    .first();
  return row !== null;
}

/** The campaign's tokens seen this scene (at most `SEEN_MAX`). */
export async function seenTokenIds(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Set<Id<"combatTokens">>> {
  const rows = await ctx.db
    .query("combatSeen")
    .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId))
    .take(SEEN_MAX);
  return new Set(rows.map((r) => r.tokenId));
}

/** Records tokens as seen this scene (the caller checked that a character sees each now); returns how many were new. */
export async function recordSeen(ctx: MutationCtx, campaignId: Id<"campaigns">, tokenIds: readonly Id<"combatTokens">[]): Promise<number> {
  let added = 0;
  const now = Date.now();
  for (const tokenId of new Set(tokenIds)) {
    if (await seenThisScene(ctx, campaignId, tokenId)) continue;
    await ctx.db.insert("combatSeen", { campaignId, tokenId, seenAt: now });
    added += 1;
  }
  return added;
}

/** End scene: the party has seen nothing of the next scene yet. Returns how many rows were deleted. */
export async function forgetSeen(ctx: MutationCtx, campaignId: Id<"campaigns">): Promise<number> {
  const rows = await ctx.db
    .query("combatSeen")
    .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId))
    .take(SEEN_MAX);
  for (const row of rows) await ctx.db.delete("combatSeen", row._id);
  return rows.length;
}
