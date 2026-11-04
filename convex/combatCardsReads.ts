import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { getDomainCard } from "../src/lib/srd/index";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { handCardValidator, handOf, recallRiderOptions, recallRiderOptionValidator } from "./lib/cardHandView";
import { loadCharacter, readSheet } from "./lib/characterSheet";
import { encounterRunning, openRequests } from "./lib/combatRequests";
import { campaignQuery } from "./lib/functions";
import { handSharedWithPlayers, hiddenHands, playersSeeHands } from "./lib/handSharing";
import { atLeast } from "./lib/permissions";
import { rangeBandValidator } from "./lib/validators/combatRequests";

/**
 * The Combat HUD's domain-card reads (plan combat-actions, CA4; moved out of `combatCards.ts` by dcm-uh6r so the HUD's
 * subscriptions do not load the card runner the card mutations need). Same wrappers, arguments and returns as before.
 *
 * - `hand`: the loadout and the vault with each card's state (ready / exhausted / passive / outOfCombat), reset label,
 *   tokens and recall cost. The character's player and the GM (who sees a selected PC's cards, user answer 2026-10-22)
 *   always; another player of the campaign while the GM's switch "Players can see each other's cards" is on and the
 *   character's player has not hidden their hand (F7-H4, dcm-bxp.99.24), read only; FORBIDDEN otherwise.
 * - `handSharing`: the GM's switch and the characters whose hands are hidden (every member).
 * - `pending`: the open card sanctions (own / all) the GM answers with `combatCards.sanction`.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

export const hand = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters") },
  returns: v.object({
    characterId: v.id("characters"),
    loadout: v.array(handCardValidator),
    vault: v.array(handCardValidator),
    /** Plan lanes-2, E1 (dcm-cfpv): the recall riders the Hand offers with a recall (Perfect Recall); the editor only. */
    recallRiders: v.optional(v.array(recallRiderOptionValidator)),
  }),
  handler: async (ctx, { characterId }) => {
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "view", "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    const editor = atLeast(permission, "edit");
    if (!editor && !handSharedWithPlayers(campaign, character)) throw appError("FORBIDDEN");
    const sheet = readSheet(character.sheet);
    const riders = editor ? recallRiderOptions(sheet, campaign) : [];
    return { characterId, ...handOf(sheet), ...(riders.length > 0 ? { recallRiders: riders } : {}) };
  },
});

/** Who sees whose hand (F7-H4): the GM's switch and the characters whose player hides their hand. Every member. */
export const handSharing = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({ playersSeeHands: v.boolean(), hidden: v.array(v.id("characters")) }),
  handler: async (ctx) => ({ playersSeeHands: playersSeeHands(ctx.campaign), hidden: await hiddenHands(ctx, ctx.campaign._id) }),
});

const namedToken = v.object({ tokenId: v.id("combatTokens"), name: v.string() });

/** A card sanction as `pending` shows it: names and bands only (U1, CF6). */
const pendingView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  cardId: v.string(),
  cardName: v.string(),
  useId: v.string(),
  createdAt: v.number(),
  targets: v.array(namedToken),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

async function nameOf(ctx: QueryCtx, row: Doc<"combatRequests">, tokenId: Id<"combatTokens">): Promise<string> {
  const token = await ctx.db.get("combatTokens", tokenId);
  if (token === null || token.campaignId !== row.campaignId) return "Unknown";
  if (token.ref.kind === "custom") return token.ref.name;
  if (token.ref.kind === "pc") {
    const character = await ctx.db.get("characters", token.ref.characterId);
    return character === null || character.campaignId !== row.campaignId ? "Unknown" : readSheet(character.sheet).name;
  }
  // A companion token (token refs widened by sheet-drawer SD0, Q4); nothing places one until SD-C.
  if (token.ref.kind === "companion") return "Companion";
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === row.campaignId ? instance.label : "Unknown";
}

/** The open card sanctions: a player's own, every one for the GM (the GM's queue). Those of an ended encounter are left out. */
export const pending = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(pendingView),
  handler: async (ctx) => {
    const gm = ctx.permission === "owner";
    const views = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      if (!gm && row.createdBy !== ctx.user._id) continue;
      const p = row.payload;
      if (p.kind !== "sanction" || p.action.kind !== "card" || !(await encounterRunning(ctx, row))) continue;
      const targets = [];
      for (const tokenId of p.action.targetTokenIds) targets.push({ tokenId, name: await nameOf(ctx, row, tokenId) });
      const character = await ctx.db.get("characters", p.characterId);
      views.push({
        requestId: row._id,
        characterId: p.characterId,
        characterName: character !== null && character.campaignId === row.campaignId ? readSheet(character.sheet).name : "Unknown",
        cardId: p.action.cardId,
        cardName: getDomainCard(p.action.cardId)?.name ?? p.action.cardId,
        useId: p.action.useId,
        createdAt: row.createdAt,
        targets,
        outOfRange: p.outOfRange,
      });
    }
    return views;
  },
});
