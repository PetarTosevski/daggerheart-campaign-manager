/**
 * Spotlight Tracker action tokens (optional rule `spotlightTracker`, CB p.89; plan rule-switches RT, user answer Q9 a;
 * docs/tasks/TASK-RULES-RT.md). CB p.89: "We recommend that you start with three … each time they make an action roll
 * or perform a significant action while in the spotlight, they remove 1 token from their sheet … Once every player has
 * used all their available tokens, players refill their character sheet with the same number of tokens as before".
 *
 * - Tokens per PC: the rule's number `spotlightTrackerTokens` (1-6, default 3), read through `ruleMode`.
 * - A PC's tokens are tracked while the PC has a token on the live Combat Map (the tracker lives on the map). Rows:
 *   `actionTokens` (no row = full). Off: nothing is read or written, and the HUD shows no tokens.
 * - `spendActionToken`: one PC action roll spends one (`rollAftermath.applyPcActionRoll`). At 0 the roll still goes
 *   through (Q9 a: warned, not refused) and spends nothing. When every PC on the live map is then at 0, all refill.
 * - `refillActionTokens`: the GM's refill by hand (`combatSpotlight.refillTokens`), and the automatic one.
 * - Undoing a roll does not give its token back (as the spotlight, bead dcm-bxp.99.32.10).
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN } from "./characterSheet";
import { liveCombatMap, tokensOnMap } from "./combatMaps";
import { ruleMode } from "./ruleModes";

type CampaignRules = Pick<Doc<"campaigns">, "_id" | "frameId" | "ruleModes">;

/** A PC's tokens as the HUD shows them: `left` of `of`. */
export type ActionTokens = { left: number; of: number };

/** The campaign's tokens per PC when the Spotlight Tracker is on, else null. */
export function trackerTokens(campaign: Pick<Doc<"campaigns">, "frameId" | "ruleModes">): number | null {
  return ruleMode(campaign, "spotlightTracker") ? ruleMode(campaign, "spotlightTrackerTokens") : null;
}

/** Tokens left from `used` of `of` (never below 0, also after the GM lowered the number). */
export function tokensLeft(used: number, of: number): number {
  return Math.max(0, of - used);
}

async function rowOf(ctx: QueryCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">) {
  return ctx.db
    .query("actionTokens")
    .withIndex("by_campaign_character", (q) => q.eq("campaignId", campaignId).eq("characterId", characterId))
    .unique();
}

/** A PC's tokens for the HUD, or null while the Spotlight Tracker is off. */
export async function actionTokensOf(ctx: QueryCtx, campaign: CampaignRules, characterId: Id<"characters">): Promise<ActionTokens | null> {
  const of = trackerTokens(campaign);
  if (of === null) return null;
  const row = await rowOf(ctx, campaign._id, characterId);
  return { left: tokensLeft(row?.used ?? 0, of), of };
}

/** The characters with a PC token on the campaign's live map (each once), or [] without a live map. */
async function pcsOnLiveMap(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Id<"characters">[]> {
  const map = await liveCombatMap(ctx, campaignId);
  if (map === null) return [];
  const ids = new Set<Id<"characters">>();
  for (const token of await tokensOnMap(ctx, map._id)) if (token.ref.kind === "pc") ids.add(token.ref.characterId);
  return [...ids];
}

/** Refills every PC's tokens: deletes the campaign's rows (bounded: one per character). Returns how many it cleared. */
export async function refillActionTokens(ctx: MutationCtx, campaignId: Id<"campaigns">): Promise<number> {
  const rows = await ctx.db
    .query("actionTokens")
    .withIndex("by_campaign_character", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
  for (const row of rows) await ctx.db.delete("actionTokens", row._id);
  return rows.length;
}

/** What a roll did: `spent` a token (false: off, not on the live map, or already at 0), `refilled` everyone after it. */
export type TokenSpend = { spent: boolean; refilled: boolean };

/**
 * A PC's action roll spends one of its tokens (Spotlight Tracker on, the PC on the live map). At 0 nothing changes (the
 * roll went through; the HUD warns). After a spend, when every PC on the live map is at 0, all refill (CB p.89).
 */
export async function spendActionToken(ctx: MutationCtx, campaign: CampaignRules, characterId: Id<"characters">): Promise<TokenSpend> {
  const none = { spent: false, refilled: false };
  const of = trackerTokens(campaign);
  if (of === null) return none;
  const pcs = await pcsOnLiveMap(ctx, campaign._id);
  if (!pcs.includes(characterId)) return none;
  const row = await rowOf(ctx, campaign._id, characterId);
  const used = row?.used ?? 0;
  const spent = tokensLeft(used, of) > 0;
  if (spent) {
    const now = Date.now();
    if (row === null) await ctx.db.insert("actionTokens", { campaignId: campaign._id, characterId, used: used + 1, updatedAt: now });
    else await ctx.db.patch("actionTokens", row._id, { used: used + 1, updatedAt: now });
  }
  // Also checked after a roll at 0: everyone can be out without a spend (a PC with tokens left the map, the GM lowered N).
  for (const pc of pcs) {
    if (tokensLeft((await rowOf(ctx, campaign._id, pc))?.used ?? 0, of) > 0) return { spent, refilled: false };
  }
  await refillActionTokens(ctx, campaign._id);
  return { spent, refilled: true };
}
