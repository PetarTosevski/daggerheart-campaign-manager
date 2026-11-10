/**
 * Wither tokens (Witherwild, D5 T5; CB 261 "Corruption from the Witherwild").
 * Every function is gated by the frame's `witherTokens` mechanic.
 *
 * - `gainWitherToken` (helper): one token plus a public Fear Die roll; at or
 *   below the tokens → a scar and the tokens cleared. Called by
 *   `characters.applyDamage` (Severe damage from a Withered source) and `gain`.
 *   With rule switch W1 `witherTokens` on Manual, `applyDamage` no longer calls
 *   it (a GM-only note instead); `gain` and `adjust` stay the GM's own hands.
 * - `gain` (GM): the manual "+ Wither" button.
 * - `adjust` (GM): corrects the tokens by a delta, no roll.
 * Every change writes an undoable `actionLog` row. No per-PC cap (decision).
 */
import { v } from "convex/values";

import { scarNote } from "../src/lib/domain/death/index";
import { adjustWither, FEAR_DIE_SIDES, gainWither, WITHER_MAX } from "../src/lib/domain/wither/index";
import { appError } from "../src/lib/errors/app-error";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { keyedGmMutation } from "./lib/functions";
import { assertMechanicEnabled } from "./lib/mechanics";
import { postRuleNote, ruleMode } from "./lib/ruleModes";
import { witherGainValidator } from "./lib/validators/wither";

export { witherGainValidator };


/**
 * Adds one Wither token to `sheet` (the character's current sheet), rolls the
 * Fear Die publicly and saves the result with an undoable `actionLog` row
 * whose `before` is `sheet`. The caller checks access and the mechanic.
 */
export async function gainWitherToken(
  ctx: MutationCtx,
  { campaignId, characterId, sheet, actorId, source }: { campaignId: Id<"campaigns">; characterId: Id<"characters">; sheet: CharacterSheet; actorId: Id<"users">; source: string },
) {
  const fearDie = rollDie(FEAR_DIE_SIDES);
  // X3 Scars in Manual (user 2026-11-10): a Wither scar is the GM's to mark too; the note joins this row's group.
  const campaign = await ctx.db.get("campaigns", campaignId);
  const scarsManual = campaign !== null && ruleMode(campaign, "scars") === "manual";
  const gain = gainWither(sheet, fearDie, scarsManual);
  await saveSheet(ctx, characterId, gain.sheet);
  const outcome = !gain.scarred
    ? `${gain.tokens} token${gain.tokens === 1 ? "" : "s"}`
    : scarsManual
      ? "tokens cleared, a scar for the GM to mark"
      : `scar gained, tokens cleared${gain.sheet.journeyEnds ? "; the last Hope slot is gone" : ""}`;
  const noteGroup = scarsManual && gain.scarred ? newGroupId() : undefined;
  const entryId = await logAction(ctx, {
    campaignId,
    characterId,
    actorId,
    ...(noteGroup === undefined ? {} : { groupId: noteGroup }),
    kind: "wither",
    visibility: "public",
    summary: `${sheet.name}: Wither token (${source}); Fear Die ${fearDie} vs ${gain.tokens}: ${outcome}`,
    roll: { kind: "free", dice: [{ sides: FEAR_DIE_SIDES, value: fearDie, role: "fear" }], modifier: 0, total: fearDie, difficulty: gain.tokens, outcome: "none", manual: false },
    before: sheet,
    undoable: true,
  });
  // No characterId: the note must not become the character's latest row (the sheet's Undo reads that row).
  if (noteGroup !== undefined && campaign !== null) await postRuleNote(ctx, campaign, { ruleId: "scars", summary: scarNote(sheet.name), groupId: noteGroup, actorId });
  return { tokens: gain.tokens, fearDie, scarred: gain.scarred, journeyEnds: gain.sheet.journeyEnds, entryId };
}

/** A character of the GM's campaign, with its sheet. */
async function campaignCharacter(ctx: MutationCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">) {
  const { character } = await loadCharacter(ctx, ctx.user, characterId, "owner");
  if (character.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { character, sheet: readSheet(character.sheet) };
}

/** The GM's "+ Wither": one token and the Fear Die, as from Severe Withered damage. */
export const gain = keyedGmMutation({
  args: { characterId: v.id("characters") },
  returns: witherGainValidator,
  handler: async (ctx, { characterId }) => {
    assertMechanicEnabled(ctx.campaign, "witherTokens");
    return ctx.once("wither_gain", { characterId }, async () => {
      const { sheet } = await campaignCharacter(ctx, characterId);
      return gainWitherToken(ctx, { campaignId: ctx.campaign._id, characterId, sheet, actorId: ctx.user._id, source: "GM" });
    });
  },
});

/** The GM corrects a character's tokens by `delta` (kept within 0..99); no Fear Die. */
export const adjust = keyedGmMutation({
  args: { characterId: v.id("characters"), delta: v.number() },
  returns: v.object({ tokens: v.number() }),
  handler: async (ctx, { characterId, delta }) => {
    assertMechanicEnabled(ctx.campaign, "witherTokens");
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > WITHER_MAX) throw appError("WITHER_RULE", "Change the tokens by a whole number.");
    return ctx.once("wither_adjust", { characterId, delta }, async () => {
      const { sheet } = await campaignCharacter(ctx, characterId);
      const next = adjustWither(sheet, delta);
      if (next.wither === sheet.wither) return { tokens: sheet.wither };
      await saveSheet(ctx, characterId, next);
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "wither",
        visibility: "public",
        summary: `${sheet.name}: Wither tokens ${sheet.wither} → ${next.wither} (GM)`,
        before: sheet,
        undoable: true,
      });
      return { tokens: next.wither };
    });
  },
});
