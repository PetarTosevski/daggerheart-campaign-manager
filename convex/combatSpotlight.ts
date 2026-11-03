import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { readSheet } from "./lib/characterSheet";
import { campaignQuery, keyedGmMutation } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { giveTo, moveToGm, spotlightAdversary, spotlightOf } from "./lib/spotlight";
import { spotlightReasonValidator } from "./tables/combatSpotlight";

/**
 * Who holds the spotlight (plan combat-hud H1.S, user answer 1c; CB p.100, p.149). Helpers and rules:
 * convex/lib/spotlight.ts.
 *
 * - `state` (every member): the holder (the GM, a PC with its name, or nobody in particular), since when and why, and
 *   what it means for the caller: `reactionsOnly` (a player while the GM holds it) and `canMove` (the GM).
 * - `gmTake({ tokenId? })` / `handTo({ characterId })` (the GM, keyed): the GM takes the spotlight (an interrupt, an
 *   adversary's turn; with `tokenId` the adversary it spotlights, which the map lights) or hands it back to a PC. Not logged in the action log: its undo restores sheets, adversaries, Fear and
 *   time only, so the GM's undo is the opposite move (docs/tasks/TASK-HUD-H1.S.md).
 */

const holderViewValidator = v.union(
  v.null(),
  v.object({ kind: v.literal("gm") }),
  v.object({ kind: v.literal("pc"), characterId: v.id("characters"), name: v.string() }),
);

export const spotlightStateValidator = v.object({
  /** null: the players hold it, nobody in particular (no move yet, or the PC it was handed to is gone). */
  holder: holderViewValidator,
  /** When the holder got it (ms), null without a holder. */
  since: v.union(v.number(), v.null()),
  reason: v.union(spotlightReasonValidator, v.null()),
  /** The PC whose roll moved it to the GM, for "Moss rolled with Fear". */
  rollBy: v.union(v.null(), v.object({ characterId: v.id("characters"), name: v.string() })),
  /** The caller may only react (a player, while the GM holds it): the "Reactions only" note, H6.2's disabled controls. */
  reactionsOnly: v.boolean(),
  /** The caller may take the spotlight or hand it back (the GM). */
  canMove: v.boolean(),
  /**
   * The adversary token the GM spotlighted (reason `adversary`), which the map lights (bead dcm-bxp.99.32.35); null
   * otherwise. An opaque id without a position: a player's map lights it only when that token is already among the
   * ones it draws (`combatVision.playerView` leaves fogged and hidden tokens out), so it never reveals one.
   */
  adversaryTokenId: v.union(v.id("combatTokens"), v.null()),
});

/** A campaign's character with its sheet name, or null when it is gone or belongs elsewhere. */
async function namedCharacter(ctx: QueryCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">) {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaign._id) return null;
  let name = "A character";
  try {
    name = readSheet(character.sheet).name;
  } catch {
    // A corrupt sheet still holds the spotlight; it just can't be named.
  }
  return { characterId, name };
}

export const state = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: spotlightStateValidator,
  handler: async (ctx) => {
    const { campaign } = ctx;
    const canMove = atLeast(ctx.permission, "owner");
    const row = await spotlightOf(ctx, campaign._id);
    const none = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, canMove, adversaryTokenId: null };
    if (row === null) return none;
    const rollBy = row.rollBy === undefined ? null : await namedCharacter(ctx, campaign, row.rollBy);
    if (row.holder.kind === "gm") {
      const adversaryTokenId = row.adversaryTokenId ?? null;
      return { holder: { kind: "gm" as const }, since: row.since, reason: row.reason, rollBy, reactionsOnly: !canMove, canMove, adversaryTokenId };
    }
    const pc = await namedCharacter(ctx, campaign, row.holder.characterId);
    if (pc === null) return none;
    return { holder: { kind: "pc" as const, ...pc }, since: row.since, reason: row.reason, rollBy: null, reactionsOnly: false, canMove, adversaryTokenId: null };
  },
});

const movedValidator = v.object({ moved: v.boolean() });

/**
 * The GM takes the spotlight (an interrupt for a Fear, an adversary's turn: CB p.100). With `tokenId` the GM spotlights
 * that adversary's token (reason `adversary`; COMBAT_TOKEN_NOT_FOUND, or INVALID for a token that is not an
 * adversary's) and the map lights it; without it the GM takes it generally (`gmTook`).
 */
export const gmTake = keyedGmMutation({
  args: { tokenId: v.optional(v.string()) },
  returns: movedValidator,
  handler: async (ctx, { tokenId }) =>
    ctx.once("spotlight_gm_take", tokenId === undefined ? {} : { tokenId }, async () => ({
      moved: tokenId === undefined ? await moveToGm(ctx, ctx.campaign, "gmTook") : await spotlightAdversary(ctx, ctx.campaign, tokenId),
    })),
});

/** The GM hands the spotlight to a PC ("Once the GM has finished, play passes back to the PCs", CB p.100). */
export const handTo = keyedGmMutation({
  args: { characterId: v.id("characters") },
  returns: movedValidator,
  handler: async (ctx, { characterId }) =>
    ctx.once("spotlight_hand_to", { characterId }, async () => ({ moved: await giveTo(ctx, ctx.campaign, characterId) })),
});
