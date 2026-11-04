import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { loadCharacter, readSheet } from "./lib/characterSheet";
import { encounterRunning, openRequests } from "./lib/combatRequests";
import { drawerOf, drawerValidator } from "./lib/featureDrawer";
import { ownedHere } from "./lib/featureOwned";
import { campaignQuery } from "./lib/functions";
import { handSharedWithPlayers } from "./lib/handSharing";
import { installedAugments } from "./lib/motherboardState";
import { atLeast } from "./lib/permissions";
import { rangeBandValidator } from "./lib/validators/combatRequests";

/**
 * The Combat HUD's feature reads (plan sheet-drawer, SD3; moved out of `combatFeatures.ts` by dcm-uh6r so the HUD's
 * subscriptions do not load the feature and card runners the feature mutations need). Same wrappers, arguments and
 * returns as before.
 *
 * - `drawer`: trackers, every owned feature with its state, badges, tokens and uses, the D5 counters (featureDrawer.ts).
 *   The character's player and the GM always; another player only while hands are shared (as `combatCardsReads.hand`).
 * - `pending`: the feature sanctions (`combatRequests` kind `sanction`, action kind `feature`) the GM answers with
 *   `combatFeatures.sanction`.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

export const drawer = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters") },
  returns: drawerValidator,
  handler: async (ctx, { characterId }) => {
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "view", "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    if (!atLeast(permission, "edit") && !handSharedWithPlayers(campaign, character)) throw appError("FORBIDDEN");
    return drawerOf(characterId, readSheet(character.sheet), campaign, await installedAugments(ctx, campaign, characterId));
  },
});

const namedToken = v.object({ tokenId: v.id("combatTokens"), name: v.string() });

/** A feature sanction as `pending` shows it: names and bands only (U1, CF6). */
const pendingView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  featureId: v.string(),
  featureName: v.string(),
  useId: v.string(),
  createdAt: v.number(),
  targets: v.array(namedToken),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

async function nameOf(ctx: QueryCtx, row: Doc<"combatRequests">, tokenId: Id<"combatTokens">): Promise<string> {
  const token = await ctx.db.get("combatTokens", tokenId);
  if (token === null || token.campaignId !== row.campaignId) return "Unknown";
  if (token.ref.kind === "custom") return token.ref.name;
  if (token.ref.kind === "companion") return "Companion";
  if (token.ref.kind === "pc") {
    const character = await ctx.db.get("characters", token.ref.characterId);
    return character === null || character.campaignId !== row.campaignId ? "Unknown" : readSheet(character.sheet).name;
  }
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === row.campaignId ? instance.label : "Unknown";
}

/** The open feature sanctions: a player's own, every one for the GM. Those of an ended encounter are left out. */
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
      if (p.kind !== "sanction" || p.action.kind !== "feature" || !(await encounterRunning(ctx, row))) continue;
      const targets = [];
      for (const tokenId of p.action.targetTokenIds) targets.push({ tokenId, name: await nameOf(ctx, row, tokenId) });
      const character = await ctx.db.get("characters", p.characterId);
      const sheet = character !== null && character.campaignId === row.campaignId ? readSheet(character.sheet) : null;
      const featureId = p.action.featureId;
      views.push({
        requestId: row._id,
        characterId: p.characterId,
        characterName: sheet?.name ?? "Unknown",
        featureId,
        featureName: (sheet ? ownedHere(sheet, ctx.campaign).find((f) => f.featureId === featureId)?.name : undefined) ?? featureId,
        useId: p.action.useId,
        createdAt: row.createdAt,
        targets,
        outOfRange: p.outOfRange,
      });
    }
    return views;
  },
});
