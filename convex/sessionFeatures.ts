/**
 * Session-bound features on the character sheet (plan session-features, F3).
 *
 * - `bumpMoonDie`: Lunar Phases (Moon Witch mastery, HF p.17): "Once per rest, you can spend a Hope to increase the
 *   value of this die by one. If you increase the value of a 6, it becomes a 1." The rule is F0's pure `bumpMoonDie`
 *   (src/lib/domain/session-features/lunar.ts); this mutation loads, checks access, saves and logs one undoable row.
 *
 * The New Moon's "Spend a Hope to negate Minor damage" lives in `characters.applyDamage` (`negateMinor: true`).
 */
import { v } from "convex/values";

import { bumpMoonDie as bump, phaseOf } from "../src/lib/domain/session-features/index";
import { env, internalMutation } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { isE2EDeployment } from "./lib/allowlist";
import { assertCanAct, editable, readSheet, saveSheet } from "./lib/characterSheet";
import { featureScope } from "./lib/featureScope";
import { keyedUserMutation } from "./lib/functions";

/** Re-exported for `convex/characters.ts`; the one copy of the rule is `convex/lib/featureScope.ts` (dcm-bxp.68). */
export { featureScope };

/**
 * Spends a Hope to raise the moon die by one, 6 -> 1, once per rest (owner or GM). Refusals: CLASS_FEATURE_RULE
 * (no Lunar Phases in this campaign, no die, already used this rest), NOT_ENOUGH_HOPE. One undoable public row
 * "Mira spent a Hope: moon die 3 -> 4 (Full)".
 */
export const bumpMoonDie = keyedUserMutation({
  args: { characterId: v.id("characters") },
  returns: v.object({ from: v.number(), to: v.number(), hope: v.number() }),
  handler: async (ctx, { characterId }) =>
    ctx.once("lunar_bump", { characterId }, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
      // As other features: not while dead, away or unconscious.
      assertCanAct(character, sheet);
      const { sheet: next, from, to } = bump(sheet, featureScope(campaign));
      await saveSheet(ctx, character._id, next);
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "feature",
        visibility: "public",
        summary: `${sheet.name} spent a Hope: moon die ${from} -> ${to} (${phaseOf(to).name})`,
        before: sheet,
        undoable: true,
      });
      return { from, to, hope: next.hope };
    }),
});

/**
 * Test seeding for the browser specs (tests/e2e/session-features-sheet.spec.ts): sets a sheet's subclass rank and its
 * session-feature state, which no public call sets directly (the moon die comes from a session start, the pools from
 * rolls). Internal (admin key only, `convex run`), and refused on anything but the local e2e backend.
 */
export const seedForE2e = internalMutation({
  args: {
    characterId: v.id("characters"),
    subclassRank: v.optional(v.union(v.literal("foundation"), v.literal("specialization"), v.literal("mastery"))),
    level: v.optional(v.number()),
    hope: v.optional(v.number()),
    slayerDice: v.optional(v.number()),
    tideTokens: v.optional(v.number()),
    moonDie: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { characterId, subclassRank, level, hope, slayerDice, tideTokens, moonDie }) => {
    if (!isE2EDeployment(env)) throw new Error("seedForE2e runs only on the local e2e backend.");
    const character = await ctx.db.get("characters", characterId);
    if (character === null) throw new Error("No such character.");
    const sheet = readSheet(character.sheet);
    const pools = { ...(slayerDice !== undefined ? { slayerDice } : {}), ...(tideTokens !== undefined ? { tideTokens } : {}), ...(moonDie !== undefined ? { moonDie } : {}) };
    await saveSheet(ctx, characterId, {
      ...sheet,
      ...(subclassRank !== undefined ? { subclassRank } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(hope !== undefined ? { hope } : {}),
      featureUses: sheet.featureUses.filter((u) => u.key !== "lunarPhasesBump"),
      sessionFeatures: { ...sheet.sessionFeatures, ...pools },
    });
    return null;
  },
});
