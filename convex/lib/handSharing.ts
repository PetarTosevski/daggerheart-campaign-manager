/**
 * Who sees a hand (F7-H4, dcm-bxp.99.24; storage F8-I1): the GM's switch and each character's own `handHidden`. Split
 * out of `./cardHand` (dcm-uh6r) so the queries that only read hand sharing (`campaigns.*`) do not load the card
 * runner; `./cardHand` re-exports these helpers.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN } from "./characterSheet";

/** The GM's switch "Players can see each other's cards" (on unless the GM turned it off). */
export function playersSeeHands(campaign: Pick<Doc<"campaigns">, "playersSeeHands">): boolean {
  return campaign.playersSeeHands !== false;
}

/** The characters whose player hides their hand (at most the campaign's character cap). */
export async function hiddenHands(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Id<"characters">[]> {
  // The campaign's characters are capped; an index on `handHidden` would be a field-prefix duplicate of `by_campaign`.
  const rows = await ctx.db.query("characters").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).take(MAX_CHARACTERS_PER_CAMPAIGN);
  return rows.flatMap((row) => (row.handHidden === true ? [row._id] : []));
}

/**
 * Hides or shows one character's hand from the other players; writes only when it changes. Callers check access
 * first; a character missing or in another campaign is left alone.
 */
export async function writeHandHidden(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, hidden: boolean): Promise<void> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaignId) return;
  if ((character.handHidden === true) === hidden) return;
  await ctx.db.patch("characters", characterId, { handHidden: hidden ? true : undefined });
}

/** Whether the campaign's other players may read this character's hand: the GM's switch on and the hand not hidden. */
export function handSharedWithPlayers(campaign: Pick<Doc<"campaigns">, "playersSeeHands">, character: Pick<Doc<"characters">, "handHidden">): boolean {
  return playersSeeHands(campaign) && character.handHidden !== true;
}
