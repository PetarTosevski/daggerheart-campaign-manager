/**
 * Hope features and class actions (D5 T8a). `use` pays a feature's cost and
 * runs its pure `use` from the class registry (src/lib/domain/class-features);
 * `endEffect` and `gotHit` end temporary effects. Every change writes an
 * actionLog row per changed character, in one group when it touches several,
 * so `actionLog.undo` reverts it.
 *
 * - A Hope feature costs 3 Hope (CB 27): NOT_ENOUGH_HOPE below that.
 * - Cross-character features (Life Support, Witch's Charm) write the target
 *   only through the feature and log on both characters, with no target
 *   confirmation (decision 7). The target must be in the same campaign and
 *   neither dead nor away.
 * - Features that act on a roll (Volatile Magic, Patron's Boon, Witch's Charm)
 *   get the latest live roll of the chosen ally, or of the user without one;
 *   the changed roll is logged on that character's row, so it becomes their
 *   latest roll.
 */
import { v } from "convex/values";

import { expire, withCasterOnNew } from "../src/lib/domain/characters/expiry";
import { findFeature, hopeFeature } from "../src/lib/domain/class-features/hooks";
import { rallyDieStress } from "../src/lib/domain/class-features/held-dice";
import { CLASS_FEATURES, classFeaturesAvailable } from "../src/lib/domain/class-features/index";
import type { FeatureMeta, OtherSheet } from "../src/lib/domain/class-features/types";
import { appError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { partyMembers } from "./lib/adversaryHits";
import { afterUnstoppable, liftTargetTags } from "./lib/cardRows";
import { assertCanAct, editable, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { payCost } from "./lib/classFeatureCost";
import { rollDie } from "./lib/dice";
import { gainFear, revertFear } from "./lib/fear";
import { keyedUserMutation, userQuery } from "./lib/functions";
import { rollValidator, type StoredRoll } from "./lib/validators/actionLog";

/** How far back the latest live roll is looked for. */
const ROLL_SCAN = 20;
/** The most characters a party feature reaches. */
const PARTY_MAX = 50;

/** The Guardian's D5 Unstoppable actions that can remove the die (src/lib/domain/class-features/classes/guardian.ts). */
const UNSTOPPABLE_ACTIONS: ReadonlySet<string> = new Set(["unstoppableHit", "endUnstoppable"]);

/** The character's newest action log row that carries a roll and is not undone, or null. */
async function latestRoll(ctx: QueryCtx, characterId: Id<"characters">): Promise<StoredRoll | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(ROLL_SCAN);
  return rows.find((row) => row.undoneAt === undefined && row.roll !== undefined)?.roll ?? null;
}

/** The class whose module grants this feature: the Hope feature is the primary class's, a class action may be the multiclass's. */
function grantingClass(sheet: CharacterSheet, key: string): string | undefined {
  if (hopeFeature(sheet)?.key === key) return sheet.classId;
  return [sheet.classId, sheet.multiclass?.classId].find((id) => id !== undefined && CLASS_FEATURES[id]?.classActions?.some((f) => f.key === key));
}

/** A target character: same campaign, present (not dead or away). */
async function loadTarget(ctx: QueryCtx, campaignId: Id<"campaigns">, targetId: Id<"characters">): Promise<Doc<"characters">> {
  const target = await ctx.db.get("characters", targetId);
  if (target === null || target.campaignId !== campaignId) throw appError("NOT_FOUND");
  if (target.status === "dead" || target.status === "away") throw appError("CLASS_FEATURE_RULE", "That character can't be targeted now.");
  return target;
}

type Other = OtherSheet & { id: Id<"characters"> };

/** The other characters the feature reads: the chosen ally, or every other active PC for a party feature. */
async function othersFor(
  ctx: QueryCtx,
  feature: FeatureMeta,
  campaignId: Id<"campaigns">,
  self: Id<"characters">,
  targetId: Id<"characters"> | undefined,
): Promise<Other[]> {
  const other = (c: Doc<"characters">): Other => ({ id: c._id, characterId: c._id, sheet: readSheet(c.sheet) });
  if (feature.target === "ally") {
    if (targetId === undefined || targetId === self) return [];
    return [other(await loadTarget(ctx, campaignId, targetId))];
  }
  if (feature.target === "party") {
    const rows = await ctx.db
      .query("characters")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .take(PARTY_MAX + 1);
    // Never a silent skip of the 51st character (review M5).
    if (rows.length > PARTY_MAX) throw appError("CLASS_FEATURE_RULE", `A party feature reaches at most ${PARTY_MAX} characters.`);
    return rows.filter((c) => c._id !== self && c.status === "active").map(other);
  }
  return [];
}

/** Gains or (negative) takes back GM Fear; returns the signed amount that changed. */
async function changeFear(ctx: MutationCtx, campaignId: Id<"campaigns">, delta: number): Promise<number> {
  if (delta > 0) return (await gainFear(ctx, campaignId, delta)).gained;
  if (delta < 0) return -(await revertFear(ctx, campaignId, -delta)).reverted;
  return 0;
}

const paramsValidator = v.object({
  targetId: v.optional(v.id("characters")),
  choice: v.optional(v.string()),
  dieIndexes: v.optional(v.array(v.number())),
  amount: v.optional(v.number()),
});

/**
 * Uses a Hope feature or class action of the character (owner or GM; the
 * character must be able to act, decision 9). Pays the cost, applies the
 * feature, saves every changed sheet and logs one row per character.
 */
export const use = keyedUserMutation({
  rateLimit: "roll",
  args: { characterId: v.id("characters"), featureKey: v.string(), params: paramsValidator },
  returns: v.object({ summary: v.string(), roll: v.union(v.null(), rollValidator) }),
  handler: async (ctx, { characterId, featureKey, params }) =>
    ctx.once("class_feature_use", { characterId, featureKey, params }, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
      assertCanAct(character, sheet);
      const feature = findFeature(sheet, featureKey);
      const owner = grantingClass(sheet, featureKey);
      if (feature?.use === undefined || owner === undefined) throw appError("CLASS_FEATURE_RULE", "This character has no such feature to use.");
      // A Rally Die comes from a Bard, not the character's class: it works with Hope & Fear off too (CB 28).
      if (featureKey !== rallyDieStress.key && !classFeaturesAvailable(owner, resolveOptions(campaign.frameId, campaign.options).hopeAndFear)) {
        throw appError("CLASS_FEATURE_RULE", "Hope & Fear classes are off in this campaign.");
      }

      const paid = payCost(sheet, feature.cost);
      const others = await othersFor(ctx, feature, campaign._id, character._id, params.targetId);
      // The roll a feature acts on belongs to the chosen ally, or to the user without one.
      const subjectId = (feature.target === "ally" ? others[0]?.id : undefined) ?? character._id;
      const roll = (await latestRoll(ctx, subjectId)) ?? undefined;

      const used = feature.use({ sheet: paid, params, rng: rollDie, others: others.map(({ characterId, sheet }) => ({ characterId, sheet })), roll });
      // Plan lanes-2 E6.3 (dcm-v17): once a D5 Unstoppable action removed the die, the feature's sheet effect ends too.
      const lapsed = UNSTOPPABLE_ACTIONS.has(featureKey) ? { ...used, sheet: afterUnstoppable(used.sheet) } : used;
      // Plan lanes-2 wave 10, E6.4 (dcm-lztq): the effects this use writes record their caster, on the user's sheet and
      // on the others' (Life Support, Witch's Charm), so caster-tied ends find them.
      const result = {
        ...lapsed,
        sheet: withCasterOnNew(sheet, lapsed.sheet, character._id),
        ...(lapsed.others ? { others: lapsed.others.map((o) => ({ ...o, sheet: withCasterOnNew(others.find((x) => x.characterId === o.characterId)?.sheet ?? { effects: [] }, o.sheet, character._id) })) } : {}),
      };
      const fearDelta = await changeFear(ctx, campaign._id, result.fearDelta ?? 0);

      const loaded = new Map<string, { id: Id<"characters">; before: CharacterSheet }>([
        [character._id, { id: character._id, before: sheet }],
        ...others.map((o) => [o.characterId, { id: o.id, before: o.sheet }] as const),
      ]);
      // Rows: the user, each changed other, and the roll's owner when the roll changed.
      const rows = new Set<string>([character._id]);
      await saveSheet(ctx, character._id, result.sheet);
      for (const other of result.others ?? []) {
        const target = loaded.get(other.characterId);
        if (target === undefined) throw new Error(`Feature ${featureKey} changed a sheet it was not given.`);
        await saveSheet(ctx, target.id, other.sheet);
        rows.add(other.characterId);
      }
      if (result.roll !== undefined) rows.add(subjectId);
      const groupId = rows.size > 1 ? newGroupId() : undefined;
      for (const key of rows) {
        const { id, before } = loaded.get(key)!;
        const self = id === character._id;
        await logAction(ctx, {
          campaignId: campaign._id,
          characterId: id,
          actorId: ctx.user._id,
          kind: "feature",
          visibility: "public",
          summary: self ? result.summary : `${feature.name} from ${sheet.name}`,
          ...(result.roll !== undefined && id === subjectId ? { roll: result.roll } : {}),
          groupId,
          before,
          ...(self && fearDelta !== 0 ? { fearDelta } : {}),
          undoable: true,
        });
      }
      return { summary: result.summary, roll: result.roll ?? null };
    }),
});

/**
 * Effects that end together with another (user 2026-10-30, dcm-bxp.99.19.46 (1)): dropping out of Beastform (the drawer's
 * Drop out, the Party sheet's End) also ends Evolution's +1 trait (CB p.30 Evolution: "choose one trait to raise by +1
 * until you drop out of that Beastform").
 */
const ENDS_WITH: Readonly<Record<string, readonly string[]>> = { beastform: ["evolution"] };

/**
 * Ends one active effect by its End button (owner or GM), and the effects that end with it (`ENDS_WITH`), in one
 * write and one undoable actionLog row.
 */
export const endEffect = keyedUserMutation({
  args: { characterId: v.id("characters"), effectId: v.string() },
  returns: v.null(),
  handler: async (ctx, { characterId, effectId }) =>
    ctx.once("class_feature_end_effect", { characterId, effectId }, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
      const effect = sheet.effects.find((e) => e.id === effectId);
      if (effect === undefined) throw appError("CLASS_FEATURE_RULE", "That effect has already ended.");
      const ending = new Set([effectId, ...(ENDS_WITH[effectId] ?? [])]);
      const ended = sheet.effects.filter((e) => ending.has(e.id));
      const after = { ...sheet, effects: sheet.effects.filter((e) => !ending.has(e.id)) };
      await saveSheet(ctx, character._id, after);
      // Plan lanes-2 wave 10, E6.4 (dcm-mvoo): an ended effect that names its instance (Marked for Death, HF p.8) lifts
      // the tag there, in the same undo group.
      const groupId = ended.some((e) => e.targetInstanceId !== undefined) ? newGroupId() : undefined;
      if (groupId !== undefined) {
        const still = [after, ...(await partyMembers(ctx, campaign._id)).filter((m) => m.character._id !== character._id).map((m) => m.sheet)];
        await liftTargetTags(ctx, { campaignId: campaign._id, ended, still, groupId, actorId: ctx.user._id });
      }
      await logAction(ctx, {
        ...(groupId !== undefined ? { groupId } : {}),
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "feature",
        visibility: "public",
        summary: `ended ${ended.map((e) => e.source).join(", ")}`,
        before: sheet,
        undoable: true,
      });
      return null;
    }),
});

/** An attack succeeded against the character (decision 8: a manual button until D8 reports hits): ends every "until hit" effect. */
export const gotHit = keyedUserMutation({
  args: { characterId: v.id("characters") },
  returns: v.null(),
  handler: async (ctx, { characterId }) =>
    ctx.once("class_feature_got_hit", { characterId }, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
      const ended = sheet.effects.filter((e) => e.until === "hit");
      if (ended.length === 0) throw appError("CLASS_FEATURE_RULE", "No effect ends on a hit.");
      await saveSheet(ctx, character._id, expire(sheet, "hit"));
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "feature",
        visibility: "public",
        summary: `was hit: ${ended.map((e) => e.source).join(", ")} ended`,
        before: sheet,
        undoable: true,
      });
      return null;
    }),
});

/** The character's latest live roll (everyone in the campaign; character rolls are public, decision 2), for Volatile Magic's dice picker. */
export const lastRoll = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.union(v.null(), rollValidator),
  handler: async (ctx, { characterId }) => {
    await loadCharacter(ctx, ctx.user, characterId, "view");
    return latestRoll(ctx, characterId);
  },
});
