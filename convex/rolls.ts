/**
 * Dice rolls (D5 T1): the server rolls (or takes typed-in physical dice,
 * marked manual), applies Hope, Stress and GM Fear, and writes one action log
 * row per character, which the roll feed (`feed.list`) shows and
 * `actionLog.undo` reverts. Rules live in src/lib/domain/dice (book pages there).
 *
 * - `actionRoll` / `damageRoll` / `manualRoll`: a character's owner or the GM
 *   (`loadCharacter` edit); dead, away and unconscious characters can't roll.
 * - `tagTeam` then `tagTeamApply`: both PCs roll, then the initiator picks the
 *   roll that applies to both (CB 97); the four rows share one group.
 * - `gmRoll` / `reveal`: GM free rolls, hidden from players until revealed.
 *
 * Session features (plan session-features F2, rules in src/lib/domain/session-features):
 * - `slayerDice` (attack and damage rolls): spends Slayer Dice, rolled with the server rng (also for a
 *   manual roll) and added as extra d6s labelled "Slayer d6" (K2, U3).
 * - `tideTokens` (action rolls): spends Know the Tide tokens for +1 each (K3, U5).
 * - a roll with Fear places a Tide token in the same saved sheet and log row (U4, Q1): action rolls and the
 *   applied Tag Team result for both PCs, never a reaction roll or a critical.
 * - `pendingChoices` / `storeSlayerDie`: the Slayer choice after an action roll with Hope (U2), and the
 *   pending Tag Team pick, which either participant's editor or the GM makes (U9).
 *
 * Countdowns (plan countdowns-advanced K1): a counted action roll (`actionRoll` / `manualRoll` kind "action") and
 * an applied Tag Team result (once, on the group's first result row) tick the campaign's armed countdowns right
 * after the roll resolves (`tickArmedCountdowns` in ./countdownRolls); undo takes the ticks back.
 *
 * Class-feature hooks run in the campaign's `FeatureScope`: a Hope & Fear
 * class's options, overrides and prompts only with `hopeAndFear` on, and no
 * Combat Training in Motherboard (CB 295). `physicalOnly` options (Combat
 * Training, CB 48) are dropped for a magic damage source (`magicDamage`). In Motherboard the Ikonis is an
 * attack (`ikonis: true`) and damage (`source.kind: "ikonis"`) source (CB 301).
 */
import { v } from "convex/values";

import { withEffects } from "../src/lib/domain/characters/effects";
import { applyDualityEffects, assertTypedModifier, dualityEffects, OUTCOME_LABEL, rollDuality, rollFree, spendHope, typedLabel } from "../src/lib/domain/dice/index";
import { countsAsActionRoll } from "../src/lib/domain/countdowns/advanced";
import {
  featuresOf,
  placeTideToken,
  rollGaveHope,
  slayerCapacity,
  slayerDice,
  slayerStorePrompt,
  storeSlayerDie as storeDie,
  WITH_HOPE,
} from "../src/lib/domain/session-features/index";
import { appError } from "../src/lib/errors/app-error";
import { TRAIT_LABEL } from "../src/lib/frames/extras/common";
import { tickArmedCountdowns } from "./countdownRolls";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { latestLiveRow, logAction, newGroupId } from "./lib/actionLog";
import { assertCanAct, findCharacter, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { gainFear } from "./lib/fear";
import { gmMutation, keyedGmMutation, keyedUserMutation, userQuery } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import {
  changed,
  damage,
  damageFields,
  damageResult,
  duality,
  dualityFields,
  dualityKind,
  dualityResult,
  editable,
  manualRng,
  poolValidator,
  promptValidator,
  rules,
  signed,
  versus,
} from "./lib/rolls";
import { rollValidator } from "./lib/validators/actionLog";
import { traitIdValidator } from "./lib/validators/characters";

// ---------------------------------------------------------------- character rolls

/** An action or reaction roll with the Duality Dice, rolled by the server. */
export const actionRoll = keyedUserMutation({
  rateLimit: "roll",
  args: { characterId: v.id("characters"), kind: dualityKind, ...dualityFields },
  returns: dualityResult,
  handler: async (ctx, { characterId, ...args }) =>
    ctx.once("roll_action", { characterId, ...args }, async () => duality(ctx, await editable(ctx, ctx.user, characterId), args, rollDie, false)),
});

/** A damage roll: a weapon at Proficiency, a class override, or dice as given; `critical` adds the dice's maximum. */
export const damageRoll = keyedUserMutation({
  rateLimit: "roll",
  args: { characterId: v.id("characters"), ...damageFields },
  returns: damageResult,
  handler: async (ctx, { characterId, ...args }) =>
    ctx.once("roll_damage", { characterId, ...args }, async () => damage(ctx, await editable(ctx, ctx.user, characterId), args, rollDie, false)),
});

/**
 * Physical dice typed in (decision 1), applied like a server roll and marked
 * manual. `values` in rolling order: Duality → Hope die, Fear die, then the
 * advantage dice (`advantagePlan`) and option dice; damage → every damage die.
 */
export const manualRoll = keyedUserMutation({
  rateLimit: "roll",
  args: {
    characterId: v.id("characters"),
    values: v.array(v.number()),
    roll: v.union(v.object({ kind: dualityKind, ...dualityFields }), v.object({ kind: v.literal("damage"), ...damageFields })),
  },
  returns: v.union(dualityResult, damageResult),
  handler: async (ctx, { characterId, values, roll }) =>
    ctx.once("roll_manual", { characterId, values, roll }, async () => {
      const loaded = await editable(ctx, ctx.user, characterId);
      const rng = manualRng(values);
      const check = () => rules(() => rng.done());
      if (roll.kind === "damage") {
        const result = await damage(ctx, loaded, roll, rng, true);
        check();
        return result;
      }
      const result = await duality(ctx, loaded, roll, rng, true);
      check();
      return result;
    }),
});

// ---------------------------------------------------------------- tag team

const TAG_TEAM_HOPE = 3;
const TAG_TEAM_USE = "tagTeam";
const tagTeamSide = v.object({ trait: traitIdValidator, modifier: v.number() });

/**
 * Starts a Tag Team Roll (CB 97): the initiator spends 3 Hope (once per
 * session, `featureUses` tagTeam), both PCs roll an action roll. The result
 * applies only once the initiator picks one roll (`tagTeamApply`).
 */
export const tagTeam = keyedUserMutation({
  rateLimit: "roll",
  args: {
    characterId: v.id("characters"),
    partnerId: v.id("characters"),
    difficulty: v.optional(v.number()),
    initiator: tagTeamSide,
    partner: tagTeamSide,
  },
  returns: v.object({ groupId: v.string(), rolls: v.array(v.object({ characterId: v.id("characters"), entryId: v.id("actionLog"), roll: rollValidator })) }),
  handler: async (ctx, args) =>
    ctx.once("roll_tag_team", args, async () => {
      const lead = await editable(ctx, ctx.user, args.characterId);
      const partner = await loadCharacter(ctx, ctx.user, args.partnerId, "view");
      if (partner.character._id === lead.character._id || partner.campaign._id !== lead.campaign._id) {
        throw appError("DICE_RULE", "Pick another character in this campaign.");
      }
      const partnerSheet = readSheet(partner.character.sheet);
      assertCanAct(lead.character, lead.sheet);
      assertCanAct(partner.character, partnerSheet);
      rules(() => [args.initiator, args.partner].forEach((side) => assertTypedModifier(side.modifier)));
      if (lead.sheet.featureUses.some((u) => u.key === TAG_TEAM_USE)) throw appError("DICE_RULE", "You already started a Tag Team Roll this session.");
      const paid = rules(() => spendHope(lead.sheet, TAG_TEAM_HOPE));
      await saveSheet(ctx, lead.character._id, { ...paid, featureUses: [...paid.featureUses, { key: TAG_TEAM_USE, until: "session" }] });

      const groupId = newGroupId();
      const sides = [
        { loaded: lead, sheet: lead.sheet, side: args.initiator, before: lead.sheet },
        { loaded: partner, sheet: partnerSheet, side: args.partner, before: undefined },
      ];
      const rolls = [];
      for (const { loaded, sheet, side, before } of sides) {
        const live = withEffects(sheet);
        const { roll } = rules(() =>
          rollDuality(
            { kind: "action", trait: live.traits[side.trait], modifier: side.modifier, ...(args.difficulty !== undefined ? { difficulty: args.difficulty } : {}), advantage: 0, disadvantage: 0, help: 0 },
            rollDie,
          ),
        );
        const entryId = await logAction(ctx, {
          campaignId: lead.campaign._id,
          characterId: loaded.character._id,
          actorId: ctx.user._id,
          kind: "roll",
          visibility: "public",
          summary: `${sheet.name}: Tag Team ${TRAIT_LABEL[side.trait]} roll ${roll.total}${typedLabel(side.modifier)}${versus(roll.difficulty, lead.gm)}, ${OUTCOME_LABEL[roll.outcome]} (not applied yet)`,
          roll,
          groupId,
          ...(before ? { before } : {}),
          undoable: true,
        });
        rolls.push({ characterId: loaded.character._id, entryId, roll });
      }
      return { groupId, rolls };
    }),
});

/** The rows of a Tag Team group, initiator first (at most 4: two rolls, two results). */
async function tagTeamGroup(ctx: QueryCtx, row: Doc<"actionLog">): Promise<Doc<"actionLog">[]> {
  if (row.groupId === undefined) return [];
  return (
    await ctx.db
      .query("actionLog")
      .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.groupId))
      .take(5)
  ).sort((a, b) => a.at - b.at || a._creationTime - b._creationTime);
}

/** Exactly two live action rolls of two characters: a Tag Team Roll waiting for its pick. */
function isPendingTagTeam(group: readonly Doc<"actionLog">[]): boolean {
  return group.length === 2 && group.every((r) => r.kind === "roll" && r.roll?.kind === "action" && r.characterId !== undefined && r.undoneAt === undefined);
}

/** How far back the Slayer choice and the Tag Team pick look for a character's latest live row. */
const LATEST_SCAN = 20;

/** The character's newest row that is not undone (as `latestLiveRow`, readable in a query). */
async function latestLive(ctx: QueryCtx, characterId: Id<"characters">): Promise<Doc<"actionLog"> | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(LATEST_SCAN);
  return rows.find((r) => r.undoneAt === undefined) ?? null;
}

/**
 * The roll whose Slayer choice is open (U2, K5): the character's latest live row, when it is an action roll with
 * Hope (critical included) that applied to the character - a plain roll, or the character's applied Tag Team
 * result (Q1), never a Tag Team roll still waiting for its pick, or a weapon attack on the Combat Map (its public
 * `combat` row, CA3; its group is the attack's, not a Tag Team). Null otherwise.
 */
async function slayerRoll(ctx: QueryCtx, characterId: Id<"characters">): Promise<Doc<"actionLog"> | null> {
  const row = await latestLive(ctx, characterId);
  if (row === null) return null;
  const attack = row.kind === "combat" && row.visibility === "public";
  if ((row.kind !== "roll" && !attack) || row.roll?.kind !== "action" || !WITH_HOPE.includes(row.roll.outcome)) return null;
  if (!attack && row.groupId !== undefined && (await tagTeamGroup(ctx, row)).length !== 4) return null;
  return row;
}

const pendingRollValidator = v.object({ characterId: v.id("characters"), entryId: v.id("actionLog"), roll: rollValidator, name: v.string() });

/**
 * What the dice box still offers a character's editors (the owner and the GM), whoever rolled or picked:
 * - `slayer`: the open Slayer choice (U2), only while the pool has room and the roll is unanswered;
 * - `tagTeam`: a Tag Team Roll the character is in that waits for its pick (U9: either participant picks).
 */
export const pendingChoices = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.object({
    slayer: v.union(v.null(), v.object({ entryId: v.id("actionLog"), prompt: promptValidator })),
    tagTeam: v.union(v.null(), v.object({ entryId: v.id("actionLog"), rolls: v.array(pendingRollValidator) })),
  }),
  handler: async (ctx, { characterId }) => {
    const { character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
    const sheet = readSheet(character.sheet);
    const open = await slayerRoll(ctx, characterId);
    const prompt = open?.roll !== undefined && featuresOf(sheet).slayerClaim !== open._id ? slayerStorePrompt(sheet, { hope: 0, fear: 0, roll: open.roll })[0] : undefined;
    const slayer = open !== null && prompt !== undefined ? { entryId: open._id, prompt } : null;

    const latest = await latestLive(ctx, characterId);
    const group = latest === null ? [] : await tagTeamGroup(ctx, latest);
    if (!isPendingTagTeam(group)) return { slayer, tagTeam: null };
    const rolls = [];
    for (const r of group) {
      const other = await ctx.db.get("characters", r.characterId!);
      // Applying over a newer action is refused (tagTeamApply), so such a roll is not offered either.
      if (other === null || (await latestLive(ctx, other._id))?._id !== r._id) return { slayer, tagTeam: null };
      rolls.push({ characterId: other._id, entryId: r._id, roll: r.roll!, name: readSheet(other.sheet).name });
    }
    return { slayer, tagTeam: { entryId: group[0]!._id, rolls } };
  },
});

/**
 * Answers the Slayer choice with "store" (U2, K2): the character's latest live roll must be an action roll with
 * Hope (`slayerRoll`), unanswered, and the pool below Proficiency. Takes back the Hope the roll gave (derived
 * from the row's `before` sheet and the outcome: a roll at Hope max gave none) and keeps a critical's cleared
 * Stress. One undoable public row. Refusals: NOT_FOUND (no such row of this character), CLASS_FEATURE_RULE.
 */
export const storeSlayerDie = keyedUserMutation({
  rateLimit: "roll",
  args: { characterId: v.id("characters"), entryId: v.id("actionLog") },
  returns: v.object({ slayerDice: v.number(), capacity: v.number(), hope: v.number() }),
  handler: async (ctx, { characterId, entryId }) =>
    ctx.once("roll_slayer_store", { characterId, entryId }, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
      const row = await ctx.db.get("actionLog", entryId);
      if (row === null || row.characterId !== character._id) throw appError("NOT_FOUND");
      const open = await slayerRoll(ctx, character._id);
      if (open?._id !== row._id || row.roll === undefined) throw appError("CLASS_FEATURE_RULE", "Only your latest roll with Hope can store a Slayer Die.");
      // The roll records whether it gave the Hope (after its costs, dcm-bxp.65). An older row falls back to its
      // `before` sheet (absent: the roll changed nothing); a roll made at Hope max gave no Hope back.
      const before = row.before === undefined ? sheet : readSheet(JSON.parse(row.before));
      const next = storeDie(sheet, { hopeGained: row.hopeGained ?? rollGaveHope(before, row.roll.outcome, "action"), entryId: row._id });
      await saveSheet(ctx, character._id, next);
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "feature",
        visibility: "public",
        summary: `${sheet.name} stored a Slayer Die (${slayerDice(next)}/${slayerCapacity(next)})`,
        before: sheet,
        undoable: true,
      });
      return { slayerDice: slayerDice(next), capacity: slayerCapacity(next), hope: next.hope };
    }),
});

/**
 * Applies the picked Tag Team roll to both PCs (CB 97): with Hope every
 * involved PC gains a Hope (a critical also clears a Stress), with Fear the
 * GM gains a Fear per PC involved and a Know the Tide holder places a token
 * (Q1). Logged on both characters in the group, each result row carrying the
 * chosen roll (the Slayer choice reads it). Either participant's editor or
 * the GM picks (U9).
 */
export const tagTeamApply = keyedUserMutation({
  rateLimit: "roll",
  args: { entryId: v.id("actionLog"), pick: v.id("characters") },
  returns: v.object({ outcome: rollValidator.fields.outcome, fearGained: v.number() }),
  handler: async (ctx, { entryId, pick }) =>
    ctx.once("roll_tag_team_apply", { entryId, pick }, async () => {
      const row = await ctx.db.get("actionLog", entryId);
      if (row === null || row.groupId === undefined || row.characterId === undefined) throw appError("NOT_FOUND");
      // The rows of a pending tag team: exactly two live action rolls, initiator first.
      const group = await tagTeamGroup(ctx, row);
      const [first] = group;
      if (first?.characterId === undefined) throw appError("NOT_FOUND");
      // U9: the GM, or the editor (owner) of either character in the Tag Team, picks.
      const lead = await findCharacter(ctx, ctx.user, first.characterId, "edit");
      if (lead === null) throw appError("NOT_FOUND");
      const second = group.find((r) => r.characterId !== undefined && r.characterId !== first.characterId);
      const partner = atLeast(lead.permission, "edit") || second === undefined ? null : await findCharacter(ctx, ctx.user, second.characterId!, "edit");
      if (!atLeast(lead.permission, "edit") && !atLeast(partner?.permission ?? null, "edit")) throw appError("FORBIDDEN");
      if (!isPendingTagTeam(group)) throw appError("DICE_RULE", "This Tag Team Roll is already settled.");
      const chosen = group.find((r) => r.characterId === pick)?.roll;
      if (chosen === undefined) throw appError("DICE_RULE", "Pick one of the two rolls.");
      // Applying over a newer action would make the group undo wipe it (review H2).
      for (const r of group) {
        const latest = await latestLiveRow(ctx, r.characterId!);
        if (latest?._id !== r._id) throw appError("DICE_RULE", "Someone in this Tag Team Roll has acted since; it can't be applied any more.");
      }

      const effects = dualityEffects("action", chosen.outcome);
      const { gained } = effects.fear > 0 ? await gainFear(ctx, lead.campaign._id, effects.fear * group.length) : { gained: 0 };
      let firstResult: Id<"actionLog"> | null = null;
      for (const [i, r] of group.entries()) {
        const character = await ctx.db.get("characters", r.characterId!);
        if (character === null) continue;
        const sheet = readSheet(character.sheet);
        // Q1: only the chosen roll counts, for both participants, as an action roll.
        const next = placeTideToken(applyDualityEffects(sheet, { ...effects, fear: 0 }), chosen.outcome, "action").sheet;
        const sheetChanged = changed(sheet, next);
        if (sheetChanged) await saveSheet(ctx, character._id, next);
        const gain = effects.hope > 0 ? (next.hope > sheet.hope ? " gains a Hope" : " (Hope full)") : "";
        const resultId = await logAction(ctx, {
          campaignId: lead.campaign._id,
          characterId: character._id,
          actorId: ctx.user._id,
          kind: "roll",
          visibility: "public",
          summary: `${sheet.name}: Tag Team result ${chosen.total}, ${OUTCOME_LABEL[chosen.outcome]}${gain}${i === 0 && gained > 0 ? `; GM gains ${gained} Fear` : ""}`,
          roll: chosen,
          groupId: row.groupId,
          ...(sheetChanged ? { before: sheet } : {}),
          ...(i === 0 && gained !== 0 ? { fearDelta: gained } : {}),
          ...(WITH_HOPE.includes(chosen.outcome) ? { hopeGained: rollGaveHope(sheet, chosen.outcome, "action") } : {}),
          undoable: true,
        });
        firstResult ??= resultId;
      }
      // R10 (CB p.97): the pair's Tag Team counts as one action roll for countdowns, keyed on the group's first result row.
      if (firstResult !== null && countsAsActionRoll(chosen, { logKind: "roll", undone: false, tagTeam: "result" })) {
        await tickArmedCountdowns(ctx, { campaignId: lead.campaign._id, entryId: firstResult, outcome: chosen.outcome, actorId: ctx.user._id });
      }
      return { outcome: chosen.outcome, fearGained: gained };
    }),
});

// ---------------------------------------------------------------- GM free rolls

const LABEL_MAX = 80;

/** A GM free roll (any dice plus a modifier): only the GM sees it until revealed (decision 2). */
export const gmRoll = keyedGmMutation({
  rateLimit: "roll",
  args: { dice: poolValidator, modifier: v.number(), label: v.optional(v.string()) },
  returns: damageResult,
  handler: async (ctx, { dice, modifier, label }) =>
    ctx.once("roll_gm", { dice, modifier, label }, async () => {
      const roll = rules(() => rollFree(dice, modifier, rollDie));
      const formula = dice.map((d) => `${d.count}d${d.sides}`).join("+") + (modifier ? signed(modifier) : "");
      const name = label?.trim().slice(0, LABEL_MAX);
      const entryId = await logAction(ctx, {
        campaignId: ctx.campaign._id,
        actorId: ctx.user._id,
        kind: "gmRoll",
        visibility: "gm",
        summary: `GM: ${name ? `${name}, ` : ""}${formula} = ${roll.total}`,
        roll,
        undoable: true,
      });
      return { entryId, roll };
    }),
});

/** Shows a GM free roll to every member. Revealing twice changes nothing. */
export const reveal = gmMutation({
  args: { entryId: v.id("actionLog") },
  returns: v.null(),
  handler: async (ctx, { entryId }) => {
    const row = await ctx.db.get("actionLog", entryId);
    if (row === null || row.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
    if (row.kind !== "gmRoll") throw appError("DICE_RULE", "Only GM rolls are revealed.");
    if (row.visibility !== "public") await ctx.db.patch("actionLog", entryId, { visibility: "public" });
    return null;
  },
});
