import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { readSheet } from "./lib/characterSheet";
import { encounterRunning, openRequests } from "./lib/combatRequests";
import { gmQuery } from "./lib/functions";

/**
 * The GM queue's read of the open "Does <name>'s Cloaked end?" prompts (plan lanes-2 wave 10, E1.4a; dcm-vx5n; moved out
 * of `cloakPrompts.ts` by dcm-uh6r so the queue's subscription does not load the movement runner `cloakPrompts.answer`
 * needs). `pending`: the open prompts, with the character's, the use's and the enemies' names (the GM's column). Same
 * wrapper, arguments and returns as before.
 */

const promptView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  label: v.string(),
  targets: v.array(v.object({ tokenId: v.id("combatTokens"), name: v.string() })),
  createdAt: v.number(),
});

async function tokenName(ctx: QueryCtx, campaignId: Id<"campaigns">, tokenId: Id<"combatTokens">): Promise<string> {
  const token = await ctx.db.get("combatTokens", tokenId);
  if (token === null || token.campaignId !== campaignId) return "Unknown";
  if (token.ref.kind === "custom") return token.ref.name;
  if (token.ref.kind === "companion") return "Companion";
  if (token.ref.kind === "pc") {
    const character = await ctx.db.get("characters", token.ref.characterId);
    return character === null || character.campaignId !== campaignId ? "Unknown" : readSheet(character.sheet).name;
  }
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === campaignId ? instance.label : "Unknown";
}

export const pending = gmQuery({
  args: {},
  returns: v.array(promptView),
  handler: async (ctx) => {
    const out = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      const p = row.payload;
      if (p.kind !== "cloakPrompt" || !(await encounterRunning(ctx, row))) continue;
      const character = await ctx.db.get("characters", p.characterId);
      const targets = [];
      for (const tokenId of p.targetTokenIds) targets.push({ tokenId, name: await tokenName(ctx, ctx.campaign._id, tokenId) });
      out.push({
        requestId: row._id,
        characterId: p.characterId,
        characterName: character !== null && character.campaignId === ctx.campaign._id ? readSheet(character.sheet).name : "Unknown",
        label: p.label,
        targets,
        createdAt: row.createdAt,
      });
    }
    return out;
  },
});
