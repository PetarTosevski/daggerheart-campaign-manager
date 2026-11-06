/**
 * Spotlight Tracker action tokens (optional rule `spotlightTracker`, CB p.89; plan rule-switches RT, user answer Q9 a;
 * RFB, user answers 2026-11-06; docs/tasks/TASK-RULES-RT.md, TASK-RULES-RFB.md). CB p.89: "We recommend that you start
 * with three … each time they make an action roll or perform a significant action while in the spotlight, they remove 1
 * token from their sheet … Once every player has used all their available tokens, players refill their character sheet
 * with the same number of tokens as before".
 *
 * - Tokens per PC: the rule's number `spotlightTrackerTokens` (1-6, default 3), read through `ruleMode`.
 * - A PC's tokens are tracked while the PC has a token on the live Combat Map (the tracker lives on the map). Rows:
 *   `actionTokens` (no row = full). Off: nothing is read or written, and the HUD shows no tokens.
 * - `spendActionTokens`: one PC action roll spends one (`rollAftermath.applyPcActionRoll`; a Tag Team: one of each PC),
 *   as does the GM's "significant action" without a roll (`combatSpotlight.spendToken`). At 0 the roll still goes
 *   through (Q9 a: warned, not refused) and spends nothing. When every PC on the live map is then at 0, all refill.
 * - `refillActionTokens`: the GM's refill by hand (`combatSpotlight.refillTokens`), the automatic one, and the start of
 *   an encounter (`encounters.start`).
 * - Undo gives a spent token back: `recordTokenSpends` writes a record row in the action's group, `refundTokenSpends`
 *   (called by `undoEntry`) reads it. No stored shape changed.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN } from "./characterSheet";
import { liveCombatMap, tokensOnMap } from "./combatMaps";
import { postRuleNote, ruleMode } from "./ruleModes";

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

/** The PCs with a token on the campaign's live map (each once, with its first token), or none without a live map. */
async function pcsOnLiveMap(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Map<Id<"characters">, Id<"combatTokens">>> {
  const pcs = new Map<Id<"characters">, Id<"combatTokens">>();
  const map = await liveCombatMap(ctx, campaignId);
  if (map === null) return pcs;
  for (const token of await tokensOnMap(ctx, map._id)) {
    if (token.ref.kind === "pc" && !pcs.has(token.ref.characterId)) pcs.set(token.ref.characterId, token._id);
  }
  return pcs;
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

/** One spend: the PC, its token on the live map (the spend's record names it) and the tokens it has left after it. */
export type Spent = { characterId: Id<"characters">; tokenId: Id<"combatTokens">; left: number };

/**
 * The PCs of `characterIds` (in order) that would spend a token now: the tracker on, the PC on the live map, a token
 * left. Reads only: `rollAftermath.planPcActionRoll` asks it before the roll's row is logged (a spend needs a group).
 */
export async function plannedSpends(ctx: QueryCtx, campaign: CampaignRules, characterIds: readonly Id<"characters">[]): Promise<Spent[]> {
  const of = trackerTokens(campaign);
  if (of === null) return [];
  const pcs = await pcsOnLiveMap(ctx, campaign._id);
  const out: Spent[] = [];
  for (const characterId of new Set(characterIds)) {
    const tokenId = pcs.get(characterId);
    if (tokenId === undefined) continue;
    const left = tokensLeft((await rowOf(ctx, campaign._id, characterId))?.used ?? 0, of);
    if (left > 0) out.push({ characterId, tokenId, left: left - 1 });
  }
  return out;
}

/** What an action did: who `spent` a token (none: off, not on the live map, or already at 0); `refilled` everyone after. */
export type TokenSpend = { spent: Spent[]; refilled: boolean };

/**
 * An action roll (or the GM's "significant action") spends one token of each PC in `characterIds` (a Tag Team: both)
 * that is on the live map and has one left. At 0 nothing changes for that PC (the roll went through; the HUD warns).
 * Then, when any of them is on the live map and every PC on it is at 0, all refill (CB p.89).
 */
export async function spendActionTokens(ctx: MutationCtx, campaign: CampaignRules, characterIds: readonly Id<"characters">[]): Promise<TokenSpend> {
  const of = trackerTokens(campaign);
  if (of === null) return { spent: [], refilled: false };
  const pcs = await pcsOnLiveMap(ctx, campaign._id);
  const tracked = [...new Set(characterIds)].filter((id) => pcs.has(id));
  if (tracked.length === 0) return { spent: [], refilled: false };
  const spent: Spent[] = [];
  const now = Date.now();
  for (const characterId of tracked) {
    const row = await rowOf(ctx, campaign._id, characterId);
    const used = row?.used ?? 0;
    if (tokensLeft(used, of) === 0) continue;
    if (row === null) await ctx.db.insert("actionTokens", { campaignId: campaign._id, characterId, used: used + 1, updatedAt: now });
    else await ctx.db.patch("actionTokens", row._id, { used: used + 1, updatedAt: now });
    spent.push({ characterId, tokenId: pcs.get(characterId)!, left: tokensLeft(used + 1, of) });
  }
  // Also checked after a roll at 0: everyone can be out without a spend (a PC with tokens left the map, the GM lowered N).
  for (const pc of pcs.keys()) {
    if (tokensLeft((await rowOf(ctx, campaign._id, pc))?.used ?? 0, of) > 0) return { spent, refilled: false };
  }
  await refillActionTokens(ctx, campaign._id);
  return { spent, refilled: true };
}

/** The `ruleId` of a spend's record row: the optional rule's registry id. */
export const TOKEN_RECORD_RULE = "spotlightTracker";

/**
 * Records spends in their action's group, so undoing the action gives the tokens back: one GM-only `rule` row per PC
 * that spent, through `postRuleNote`, naming the PC by its live-map token in `targets` (no `characterId`: a row on the
 * character would become its "latest row" for the Slayer choice and the Tag Team checks). `shown` false (a roll's
 * spend): hidden from the feed at once (`removedAt`, display only: undo still reads it). The GM's spend without a roll
 * shows its row, with Undo.
 */
export async function recordTokenSpends(
  ctx: MutationCtx,
  campaign: Pick<Doc<"campaigns">, "_id">,
  spent: readonly Spent[],
  row: { groupId: string; actorId: Id<"users">; summary: (s: Spent) => string; shown: boolean },
): Promise<void> {
  for (const s of spent) {
    const id = await postRuleNote(ctx, campaign, { ruleId: TOKEN_RECORD_RULE, summary: row.summary(s), groupId: row.groupId, actorId: row.actorId });
    await ctx.db.patch("actionLog", id, {
      targets: [{ tokenId: s.tokenId, side: "pc", tone: "effect" }],
      ...(row.shown ? {} : { removedAt: Date.now() }),
    });
  }
}

/**
 * Undo's half (`undoEntry`, convex/lib/actionLog.ts): each spend record of the undone group gives its PC one token
 * back, unless the tokens were refilled since (the PC's row is gone, or was made again after the record: a refill
 * deletes the rows). A record whose map token is gone gives nothing back (the tracker follows the live map). Returns
 * the PCs refunded.
 */
export async function refundTokenSpends(ctx: MutationCtx, group: readonly Doc<"actionLog">[]): Promise<Id<"characters">[]> {
  const refunded: Id<"characters">[] = [];
  const now = Date.now();
  for (const record of group) {
    if (record.kind !== "rule" || record.ruleId !== TOKEN_RECORD_RULE) continue;
    for (const target of record.targets ?? []) {
      const token = await ctx.db.get("combatTokens", target.tokenId);
      if (token === null || token.campaignId !== record.campaignId || token.ref.kind !== "pc") continue;
      const row = await rowOf(ctx, record.campaignId, token.ref.characterId);
      if (row === null || row.used <= 0 || row._creationTime > record._creationTime) continue;
      if (row.used === 1) await ctx.db.delete("actionTokens", row._id);
      else await ctx.db.patch("actionTokens", row._id, { used: row.used - 1, updatedAt: now });
      refunded.push(token.ref.characterId);
    }
  }
  return refunded;
}
