import { v, type Infer } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { appError } from "../src/lib/errors/app-error";
import { refillActionTokens, trackerTokens } from "./lib/actionTokens";
import { readSheet } from "./lib/characterSheet";
import { campaignQuery, keyedGmMutation } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { giveTo, giveToParty, moveToGm, spotlightAdversary, spotlightOf, takeWithFear } from "./lib/spotlight";
import { adversaryArtSrc } from "./lib/encounters";
import { seenThisScene } from "./lib/spotlightSeen";
import { spotlightReasonValidator } from "./tables/combatSpotlight";

/**
 * Who holds the spotlight (plan combat-hud H1.S, user answer 1c; CB p.100, p.149). Helpers and rules:
 * convex/lib/spotlight.ts.
 *
 * - `state` (every member): the holder (the GM, a PC with its name, or nobody in particular), since when and why, and
 *   what it means for the caller: `reactionsOnly` (a player while the GM holds it) and `canMove` (the GM).
 * - `gmTake({ tokenId?, pay? })` / `handTo({ characterId })` / `handToParty()` (the GM, keyed): the GM takes the
 *   spotlight (an interrupt, an adversary's turn; with `tokenId` the adversary it spotlights, which the map lights),
 *   hands it back to a PC, or hands it to the whole party with nobody chosen (H9.S, user answer Q8 a). `pay: "fear"`
 *   spends 1 Fear for the interrupt and counts as that adversary's spotlight this GM turn (H9.S, user answer Q7 a;
 *   `takeWithFear`); `"free"` (the default) costs nothing, and handing it to a PC or the party never costs Fear. Moves
 *   without Fear are not logged in the action log: its undo restores sheets, adversaries, Fear and time only, so the
 *   GM's undo is the opposite move (docs/tasks/TASK-HUD-H1.S.md). A paid take is logged, and its undo gives the Fear back
 *   (docs/tasks/TASK-HUD-H9.S.md).
 * - `refillTokens()` (the GM, keyed): Spotlight Tracker (optional rule, CB p.89, plan rule-switches RT): every PC's
 *   action tokens back to full before everyone is out (the app refills by itself once every PC on the live map is at
 *   0). MECHANIC_DISABLED while the rule is off. Not logged, like the moves without Fear.
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
   * Players (user 2026-11-03): only when the party has seen that token this scene (`combatSeen`); never seen, null.
   * Seen by any player's character counts for every player (dcm-onze). The GM always.
   */
  adversaryTokenId: v.union(v.id("combatTokens"), v.null()),
  /**
   * That adversary's display name (its encounter instance's label, the full name its token shows), for the players'
   * GM's-turn card ("Jagged Knife Lieutenant has the spotlight", dcm-onze) and the disc. Null whenever
   * `adversaryTokenId` is null, or the token is no longer an adversary of this campaign.
   */
  adversaryName: v.union(v.string(), v.null()),
  /**
   * That adversary's portrait (the rulebook art its map token draws, `adversaryArtSrc`), for the spotlight disc's face
   * (dcm-onze: seen is party knowledge, so a player whose map does not draw the token gets it too). Null whenever
   * `adversaryName` is null, or the adversary has no art (the disc draws its initial).
   */
  adversaryPortrait: v.union(v.string(), v.null()),
});
export type SpotlightStateView = Infer<typeof spotlightStateValidator>;

type SpotlitAdversary = Pick<SpotlightStateView, "adversaryTokenId" | "adversaryName" | "adversaryPortrait">;

/**
 * The spotlighted adversary for the caller: the GM always; a player only one the party saw this scene (user 2026-11-03).
 * Seen is party knowledge (dcm-onze, user 2026-11-04): `combatSeen` is per campaign, so once any player's character saw
 * it, every player learns it, one who never saw it or has no token on the map included. Never seen: nothing.
 */
async function spotlitAdversary(ctx: QueryCtx, campaign: Doc<"campaigns">, tokenId: Id<"combatTokens"> | undefined, gm: boolean): Promise<SpotlitAdversary> {
  const none = { adversaryTokenId: null, adversaryName: null, adversaryPortrait: null };
  if (tokenId === undefined) return none;
  if (!gm && !(await seenThisScene(ctx, campaign._id, tokenId))) return none;
  const token = await ctx.db.get("combatTokens", tokenId);
  if (token !== null && token.ref.kind === "adversary") {
    const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
    if (instance !== null && instance.campaignId === campaign._id) {
      return { adversaryTokenId: tokenId, adversaryName: instance.label, adversaryPortrait: await adversaryArtSrc(ctx, campaign._id, instance) };
    }
  }
  return { adversaryTokenId: tokenId, adversaryName: null, adversaryPortrait: null };
}

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
  handler: async (ctx): Promise<SpotlightStateView> => {
    const { campaign } = ctx;
    const canMove = atLeast(ctx.permission, "owner");
    const row = await spotlightOf(ctx, campaign._id);
    const noAdversary = { adversaryTokenId: null, adversaryName: null, adversaryPortrait: null };
    const none = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, canMove, ...noAdversary };
    if (row === null) return none;
    const rollBy = row.rollBy === undefined ? null : await namedCharacter(ctx, campaign, row.rollBy);
    if (row.holder.kind === "gm") {
      const adversary = await spotlitAdversary(ctx, campaign, row.adversaryTokenId, canMove);
      return { holder: { kind: "gm" as const }, since: row.since, reason: row.reason, rollBy, reactionsOnly: !canMove, canMove, ...adversary };
    }
    const pc = await namedCharacter(ctx, campaign, row.holder.characterId);
    if (pc === null) return none;
    return { holder: { kind: "pc" as const, ...pc }, since: row.since, reason: row.reason, rollBy: null, reactionsOnly: false, canMove, ...noAdversary };
  },
});

const movedValidator = v.object({ moved: v.boolean() });

/** How the GM pays for taking the spotlight (H9.S, user answer Q7 a): `free` (the default) or `fear` (1 Fear, CB p.155). */
const payValidator = v.union(v.literal("free"), v.literal("fear"));

/**
 * The GM takes the spotlight (an interrupt for a Fear, an adversary's turn: CB p.100). With `tokenId` the GM spotlights
 * that adversary's token (reason `adversary`; COMBAT_TOKEN_NOT_FOUND, or INVALID for a token that is not an
 * adversary's, ADVERSARY_DEFEATED for a defeated one, user 2026-11-04) and the map lights it; without it the GM takes it generally (`gmTook`). `pay` (widened, H9.S): `free`
 * (default, as before) or `fear`: 1 Fear spent in the same mutation (NOT_ENOUGH_FEAR when the GM has none; nothing spent
 * when the spotlight does not move), which counts as that adversary's spotlight this GM turn (`takeWithFear`).
 */
export const gmTake = keyedGmMutation({
  args: { tokenId: v.optional(v.string()), pay: v.optional(payValidator) },
  returns: movedValidator,
  handler: async (ctx, { tokenId, pay }) =>
    ctx.once("spotlight_gm_take", { ...(tokenId === undefined ? {} : { tokenId }), ...(pay === "fear" ? { pay } : {}) }, async () => {
      if (pay === "fear") return { moved: (await takeWithFear(ctx, ctx.campaign, ctx.user._id, tokenId)).moved };
      return {
        moved: tokenId === undefined ? await moveToGm(ctx, ctx.campaign, "gmTook") : await spotlightAdversary(ctx, ctx.campaign, tokenId),
      };
    }),
});

/** The GM hands the spotlight to a PC ("Once the GM has finished, play passes back to the PCs", CB p.100). */
export const handTo = keyedGmMutation({
  args: { characterId: v.id("characters") },
  returns: movedValidator,
  handler: async (ctx, { characterId }) =>
    ctx.once("spotlight_hand_to", { characterId }, async () => ({ moved: await giveTo(ctx, ctx.campaign, characterId) })),
});

/**
 * The GM hands the spotlight to the whole party, nobody chosen (H9.S, user answer Q8 a: "The whole party (players
 * decide who acts)"): `state` reads holder null and every player's controls unlock. Idempotent: `moved` false when
 * nobody held it already. Never costs Fear.
 */
export const handToParty = keyedGmMutation({
  args: {},
  returns: movedValidator,
  handler: async (ctx) => ctx.once("spotlight_hand_to_party", {}, async () => ({ moved: await giveToParty(ctx, ctx.campaign) })),
});

/**
 * The GM refills every PC's Spotlight Tracker action tokens by hand (plan rule-switches RT, user answer Q9 a: "GM can
 * refill early"; CB p.89). `refilled`: how many PCs had spent tokens (0: everyone was full already). MECHANIC_DISABLED
 * while the optional rule is off.
 */
export const refillTokens = keyedGmMutation({
  args: {},
  returns: v.object({ refilled: v.number() }),
  handler: async (ctx) =>
    ctx.once("spotlight_refill_tokens", {}, async () => {
      if (trackerTokens(ctx.campaign) === null) throw appError("MECHANIC_DISABLED", "The Spotlight Tracker is off in this campaign.");
      return { refilled: await refillActionTokens(ctx, ctx.campaign._id) };
    }),
});
