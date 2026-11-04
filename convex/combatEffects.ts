import { v } from "convex/values";

import { tierForLevel } from "../src/lib/domain/characters/index";
import { appError } from "../src/lib/errors/app-error";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { partyMembers } from "./lib/adversaryHits";
import { adversaryBefore, endInstanceEffectByGmFear, endSheetEffectByGmFear, fearEndsOnInstance, fearEndsOnSheet, liftTargetTags, type FearEnd } from "./lib/cardRows";
import { readSheet, saveSheet } from "./lib/characterSheet";
import { spendFear } from "./lib/fear";
import { gmQuery, keyedGmMutation } from "./lib/functions";

/**
 * The GM spends Fear to end an effect (plan lanes-2 wave 9, tracer E6.3; dcm-kmr, dcm-6y00 (1); docs/tasks/TASK-LN3-E6.md).
 * Slumber (CB p.332): "Asleep until they take damage or the GM spends a Fear on their turn to clear this condition";
 * Marked for Death (HF p.8): "the GM spends a number of Fear equal to your tier to clear it". The entry's `endsOn:
 * ["gmSpendsFear"]` and `endFear` decide which effects qualify and what they cost (`gmFearToEnd`: `byTier` with the
 * PC's tier, the caster's for an instance modifier; default 1).
 *
 * - `fearEnds` (GM): the effects and condition markers on a PC sheet or an encounter instance a Fear spend ends, with the
 *   cost (the token panel's buttons).
 * - `endByFear` (GM, keyed): spends the cost and ends the effect (and the condition it stands for) in one undoable
 *   actionLog row: undo gives the Fear back and restores the sheet or instance. `fear` is the cost the button showed: a
 *   different cost (the effect changed since) is INVALID, too little Fear FEAR_EMPTY.
 */

const targetValidator = v.union(
  v.object({ kind: v.literal("character"), characterId: v.id("characters") }),
  v.object({ kind: v.literal("instance"), instanceId: v.id("encounterAdversaries") }),
);

const fearEndValidator = v.object({ effectId: v.string(), label: v.string(), source: v.string(), fear: v.number() });

type Target = { kind: "character"; characterId: Doc<"characters">["_id"] } | { kind: "instance"; instanceId: Doc<"encounterAdversaries">["_id"] };

async function loadCharacterHere(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"], id: Doc<"characters">["_id"]): Promise<Doc<"characters">> {
  const character = await ctx.db.get("characters", id);
  if (character === null || character.campaignId !== campaignId) throw appError("NOT_FOUND");
  return character;
}

async function loadInstanceHere(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"], id: Doc<"encounterAdversaries">["_id"]): Promise<Doc<"encounterAdversaries">> {
  const instance = await ctx.db.get("encounterAdversaries", id);
  if (instance === null || instance.campaignId !== campaignId) throw appError("NOT_FOUND");
  return instance;
}

/** The caster tiers of an instance's caster-tagged modifiers (their PC token's character; tier 1 without one). */
async function casterTiers(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"], instance: Doc<"encounterAdversaries">): Promise<(tokenId: string | undefined) => 1 | 2 | 3 | 4> {
  const tiers = new Map<string, 1 | 2 | 3 | 4>();
  for (const e of instance.effects ?? []) {
    const tokenId = /~(.+)$/.exec(e.id)?.[1];
    if (tokenId === undefined || tiers.has(tokenId)) continue;
    const normalized = ctx.db.normalizeId("combatTokens", tokenId);
    const token = normalized === null ? null : await ctx.db.get("combatTokens", normalized);
    if (token === null || token.campaignId !== campaignId || token.ref.kind !== "pc") continue;
    const character = await ctx.db.get("characters", token.ref.characterId);
    if (character === null || character.campaignId !== campaignId) continue;
    tiers.set(tokenId, tierForLevel(readSheet(character.sheet).level));
  }
  return (tokenId) => (tokenId === undefined ? 1 : (tiers.get(tokenId) ?? 1));
}

async function fearEndsOf(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"], target: Target): Promise<FearEnd[]> {
  if (target.kind === "character") return fearEndsOnSheet(readSheet((await loadCharacterHere(ctx, campaignId, target.characterId)).sheet));
  const instance = await loadInstanceHere(ctx, campaignId, target.instanceId);
  return fearEndsOnInstance(instance, await casterTiers(ctx, campaignId, instance));
}

export const fearEnds = gmQuery({
  args: { target: targetValidator },
  returns: v.array(fearEndValidator),
  handler: async (ctx, { target }) => fearEndsOf(ctx, ctx.campaign._id, target),
});

export const endByFear = keyedGmMutation({
  args: { target: targetValidator, effectId: v.string(), fear: v.number() },
  returns: v.object({ spent: v.number(), lines: v.array(v.string()) }),
  handler: async (ctx, { target, effectId, fear }) =>
    ctx.once("combat_effects_end_by_fear", { target, effectId, fear }, async () => {
      const campaignId = ctx.campaign._id;
      const cost = (await fearEndsOf(ctx, campaignId, target)).find((e) => e.effectId === effectId)?.fear;
      if (cost === undefined) throw appError("INVALID", "A Fear spend doesn't end that effect.");
      if (cost !== fear) throw appError("INVALID", `Ending that effect costs ${cost} Fear.`);
      if (cost > 0) await spendFear(ctx, campaignId, cost, "move");
      const groupId = newGroupId();
      const paid = cost > 0 ? `spent ${cost} Fear: ` : "";
      if (target.kind === "character") {
        const character = await loadCharacterHere(ctx, campaignId, target.characterId);
        const sheet = readSheet(character.sheet);
        const out = endSheetEffectByGmFear(sheet, effectId);
        if (out === null) throw appError("INVALID", "A Fear spend doesn't end that effect.");
        await saveSheet(ctx, character._id, out.sheet);
        await logAction(ctx, {
          campaignId,
          characterId: character._id,
          actorId: ctx.user._id,
          kind: "combat",
          visibility: "public",
          summary: `GM ${paid}${out.lines.join("; ")}`,
          groupId,
          before: sheet,
          ...(cost > 0 ? { fearDelta: -cost } : {}),
          undoable: true,
        });
        // Plan lanes-2 wave 10, E6.4 (dcm-mvoo): Marked for Death's effect names its instance; clearing it lifts the tag
        // there (HF p.8: "the GM spends a number of Fear equal to your tier to clear it"), in the same undo group.
        const ended = sheet.effects.filter((e) => e.id === effectId);
        const still = [out.sheet, ...(await partyMembers(ctx, campaignId)).filter((m) => m.character._id !== character._id).map((m) => m.sheet)];
        const lifted = await liftTargetTags(ctx, { campaignId, ended, still, groupId, actorId: ctx.user._id });
        return { spent: cost, lines: [...out.lines, ...lifted] };
      }
      const instance = await loadInstanceHere(ctx, campaignId, target.instanceId);
      const out = endInstanceEffectByGmFear(instance, effectId);
      if (out === null) throw appError("INVALID", "A Fear spend doesn't end that effect.");
      await ctx.db.patch("encounterAdversaries", instance._id, { ...out.patch, updatedAt: Date.now() });
      // The instance's row is the GM's (U1: a player never reads an enemy's modifiers).
      await logAction(ctx, {
        campaignId,
        actorId: ctx.user._id,
        kind: "combat",
        visibility: "gm",
        summary: `GM ${paid}${out.lines.join("; ")}`,
        groupId,
        adversaryBefore: [adversaryBefore(instance, true)],
        ...(cost > 0 ? { fearDelta: -cost } : {}),
        undoable: true,
      });
      return { spent: cost, lines: out.lines };
    }),
});
