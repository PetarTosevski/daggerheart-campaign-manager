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
 * Class-feature hooks run in the campaign's `FeatureScope`: a Hope & Fear
 * class's options, overrides and prompts only with `hopeAndFear` on, and no
 * Combat Training in Motherboard (CB 295). In Motherboard the Ikonis is an
 * attack (`ikonis: true`) and damage (`source.kind: "ikonis"`) source (CB 301).
 */
import { v } from "convex/values";

import { withEffects } from "../src/lib/domain/characters/effects";
import { BRAWLERS_STRIKE } from "../src/lib/domain/class-features/classes/brawler";
import { afterDualityRoll, rollOptions, weaponOverrides } from "../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../src/lib/domain/class-features/index";
import type { FeatureScope } from "../src/lib/domain/class-features/types";
import { ikonisWeapon, type IkonisWeapon } from "../src/lib/domain/dice/ikonis";
import {
  applyDualityEffects,
  applyRollOptions,
  DiceRuleError,
  dualityEffects,
  experienceBonus,
  NotEnoughHopeError,
  OUTCOME_LABEL,
  queueRng,
  rollDamage,
  rollDuality,
  rollFree,
  spendHope,
  weaponDice,
  type DamageInput,
  type DualityInput,
  type Rng,
} from "../src/lib/domain/dice/index";
import type { RollRecord } from "../src/lib/domain/duality";
import { appError } from "../src/lib/errors/app-error";
import { getWeapon } from "../src/lib/srd/index";
import type { TraitId } from "../src/lib/srd/types";
import { FRAME_OF, TRAIT_LABEL } from "../src/lib/frames/extras/common";
import { motherboardStateSchema } from "../src/lib/frames/extras/motherboard";
import { resolveOptions } from "../src/lib/frames/options";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { parseOrCorrupt } from "./lib/blobs";
import { assertCanAct, editable, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { gainFear } from "./lib/fear";
import { gmMutation, keyedGmMutation, keyedUserMutation } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { rollValidator } from "./lib/validators/actionLog";
import { traitIdValidator } from "./lib/validators/characters";

// ---------------------------------------------------------------- validators

const dualityKind = v.union(v.literal("action"), v.literal("reaction"));

const dualityFields = {
  trait: traitIdValidator,
  modifier: v.number(),
  difficulty: v.optional(v.number()),
  /** Experiences used (1 Hope each, CB 90). */
  experienceIds: v.array(v.string()),
  advantage: v.number(),
  disadvantage: v.number(),
  /** Help an Ally dice (each helper spends their own Hope). */
  help: v.number(),
  /** An attack roll: effect attack bonuses apply. */
  attack: v.boolean(),
  /** Chosen `rollOptions` keys (auto options apply anyway). */
  options: v.array(v.string()),
  /** An Ikonis attack (Motherboard): its trait, Converge/Target bonus and Override's advantage apply. */
  ikonis: v.optional(v.boolean()),
};

const poolValidator = v.array(v.object({ count: v.number(), sides: v.number() }));

const damageSource = v.union(
  v.object({ kind: v.literal("weapon"), slot: v.union(v.literal("primary"), v.literal("secondary")) }),
  v.object({ kind: v.literal("override"), key: v.string() }),
  /** The character's Ikonis (Motherboard, CB 301). */
  v.object({ kind: v.literal("ikonis") }),
  /** Dice named by a spell or feature ("d6 using Spellcast"): rolled as given. */
  v.object({ kind: v.literal("dice"), dice: poolValidator }),
);

const damageFields = { source: damageSource, critical: v.boolean(), modifier: v.number(), options: v.array(v.string()) };

const promptValidator = v.object({
  key: v.string(),
  featureKey: v.string(),
  text: v.string(),
  choices: v.array(v.object({ key: v.string(), label: v.string() })),
});

const dualityResult = v.object({ entryId: v.id("actionLog"), roll: rollValidator, fearGained: v.number(), prompts: v.array(promptValidator) });
const damageResult = v.object({ entryId: v.id("actionLog"), roll: rollValidator });

type DualityArgs = {
  kind: "action" | "reaction";
  trait: TraitId;
  modifier: number;
  difficulty?: number;
  experienceIds: string[];
  advantage: number;
  disadvantage: number;
  help: number;
  attack: boolean;
  options: string[];
  ikonis?: boolean;
};
type DamageSource = { kind: "weapon"; slot: "primary" | "secondary" } | { kind: "override"; key: string } | { kind: "ikonis" } | { kind: "dice"; dice: { count: number; sides: number }[] };
type DamageArgs = { source: DamageSource; critical: boolean; modifier: number; options: string[] };

const MAX_OPTIONS = 20;
const MAX_VALUES = 40;

// ---------------------------------------------------------------- shared steps

/** Runs dice rules, turning their expected refusals into DICE_RULE / NOT_ENOUGH_HOPE. */
function rules<T>(run: () => T): T {
  return applyRule("NOT_ENOUGH_HOPE", NotEnoughHopeError, () => applyRule("DICE_RULE", DiceRuleError, run));
}

function changed(a: CharacterSheet, b: CharacterSheet): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** What the campaign lets class modules offer (Hope & Fear classes, Combat Training outside Motherboard). */
function scopeOf(campaign: Doc<"campaigns">): FeatureScope {
  return { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear, ikonis: campaign.frameId === FRAME_OF.motherboard };
}

/**
 * The character's Ikonis as a weapon (Motherboard only), read from its
 * `characterExtras` motherboard row (seeded by `characters.create`).
 */
async function loadIkonis(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, sheet: CharacterSheet): Promise<IkonisWeapon> {
  if (campaign.frameId !== FRAME_OF.motherboard) throw appError("DICE_RULE", "Only Motherboard characters have an Ikonis.");
  const row = await ctx.db
    .query("characterExtras")
    .withIndex("by_character_extra", (q) => q.eq("characterId", character._id).eq("extra", "motherboard"))
    .unique();
  const state = row === null ? null : parseOrCorrupt(motherboardStateSchema, row.data, "TRACKER_CORRUPT");
  const weapon = state === null ? null : ikonisWeapon(state.ikonis, state.installed, sheet.level, sheet.proficiency);
  if (weapon === null) throw appError("DICE_RULE", "Design your Ikonis first (Motherboard panel).");
  return weapon;
}

/** Pays a Duality roll's costs (Experiences, roll options) and builds the resolver's input. */
function prepareDuality(sheet: CharacterSheet, args: DualityArgs, scope: FeatureScope, ikonis: IkonisWeapon | null): { paid: CharacterSheet; input: DualityInput; extras: string[] } {
  if (args.options.length > MAX_OPTIONS) throw new DiceRuleError("Too many options.");
  const live = withEffects(sheet);
  const exp = experienceBonus(sheet.experiences, args.experienceIds);
  const opts = applyRollOptions(spendHope(sheet, exp.hope), rollOptions(sheet, args.kind, CLASS_FEATURES, scope), args.options);
  const attack = args.attack || ikonis !== null;
  return {
    paid: opts.sheet,
    input: {
      kind: args.kind,
      trait: live.traits[ikonis?.trait ?? args.trait],
      modifier: args.modifier + exp.value + opts.modifier + (attack ? live.attackBonus : 0) + (ikonis?.attack ?? 0),
      ...(args.difficulty !== undefined ? { difficulty: args.difficulty } : {}),
      advantage: args.advantage + opts.advantage + (ikonis?.advantage ? 1 : 0),
      disadvantage: args.disadvantage,
      help: args.help,
      extraDice: opts.extraDice,
      fixedDice: opts.fixedDice,
    },
    extras: [...(ikonis ? [ikonis.label, ...ikonis.augments] : []), ...exp.names, ...opts.labels],
  };
}

function dualitySummary(name: string, args: Pick<DualityArgs, "kind" | "trait">, roll: RollRecord, extras: string[]): string {
  const vs = roll.difficulty !== undefined ? ` vs ${roll.difficulty}` : "";
  const using = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  const manual = roll.manual ? " [manual]" : "";
  return `${name}: ${TRAIT_LABEL[args.trait]} ${args.kind} roll ${roll.total}${vs}, ${OUTCOME_LABEL[roll.outcome]}${using}${manual}`;
}

type Loaded = { campaign: Doc<"campaigns">; character: Doc<"characters">; sheet: CharacterSheet };

/** Rolls (or reads typed-in dice), applies Hope, Stress and Fear, saves and logs. */
async function duality(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DualityArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  assertCanAct(character, sheet);
  const scope = scopeOf(campaign);
  const ikonis = args.ikonis ? await loadIkonis(ctx, campaign, character, sheet) : null;
  const { paid, input, extras } = rules(() => prepareDuality(sheet, args, scope, ikonis));
  const trait = ikonis?.trait ?? args.trait;
  const rolled = rules(() => rollDuality(input, rng));
  const roll: RollRecord = { ...rolled.roll, manual };
  const effects = dualityEffects(args.kind, roll.outcome);
  const next = applyDualityEffects(paid, effects);
  const { gained } = effects.fear > 0 ? await gainFear(ctx, campaign._id, effects.fear) : { gained: 0 };
  const sheetChanged = changed(sheet, next);
  if (sheetChanged) await saveSheet(ctx, character._id, next);
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: ctx.user._id,
    kind: "roll",
    visibility: "public",
    summary: dualitySummary(sheet.name, { kind: args.kind, trait }, roll, extras),
    roll,
    ...(sheetChanged ? { before: sheet } : {}),
    ...(gained !== 0 ? { fearDelta: gained } : {}),
    undoable: true,
  });
  // Reaction rolls prompt too (Strange Patterns: "a Duality Die shows it", CB 50); prompts that need Hope check the roll kind.
  const prompts = afterDualityRoll(next, { hope: rolled.hope, fear: rolled.fear, roll }, CLASS_FEATURES, scope);
  return { entryId, roll, fearGained: gained, prompts };
}

/**
 * The damage dice of a source: weapon dice at Proficiency (CB 98), a class
 * override, the Ikonis, or dice as given. Option dice are bonus dice, so a
 * critical maxes them too (CB 98).
 */
function prepareDamage(sheet: CharacterSheet, args: DamageArgs, scope: FeatureScope, ikonis: IkonisWeapon | null): { paid: CharacterSheet; input: DamageInput; label: string } {
  if (args.options.length > MAX_OPTIONS) throw new DiceRuleError("Too many options.");
  const opts = applyRollOptions(sheet, rollOptions(sheet, "damage", CLASS_FEATURES, scope), args.options);
  const live = withEffects(sheet);
  const fixed = opts.fixedDice.reduce((s, d) => s + d.value, 0);
  const base = { critical: args.critical, bonusDice: opts.extraDice };
  const extra = args.modifier + opts.modifier + fixed;
  const overrides = weaponOverrides(sheet, CLASS_FEATURES, scope);
  let source = args.source;
  // Brawler's Strike as the primary weapon is the I Am the Weapon override when it applies (HF 10).
  if (source.kind === "weapon" && source.slot === "primary" && sheet.primaryWeaponId === BRAWLERS_STRIKE && overrides.some((o) => o.key === "brawlersStrike")) {
    source = { kind: "override", key: "brawlersStrike" };
  }
  let input: DamageInput;
  let label: string;
  if (source.kind === "weapon") {
    const weaponId = source.slot === "primary" ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    const weapon = weaponId ? getWeapon(weaponId) : undefined;
    if (!weapon) throw new DiceRuleError(`No ${source.slot} weapon is equipped.`);
    const { dice, flat } = weaponDice(weapon.damage, sheet.proficiency, weapon.id === BRAWLERS_STRIKE);
    input = { ...base, dice, flat: flat + extra + live.damageBonus };
    label = weapon.name;
  } else if (source.kind === "override") {
    const key = source.key;
    const override = overrides.find((o) => o.key === key);
    if (!override) throw new DiceRuleError("That attack isn't available.");
    input = { ...base, dice: override.dice, flat: override.flat + extra + live.damageBonus, ...(override.critBase !== undefined ? { critBase: override.critBase } : {}) };
    label = override.label;
  } else if (source.kind === "ikonis") {
    if (ikonis === null) throw new DiceRuleError("Only Motherboard characters have an Ikonis.");
    input = { ...base, dice: ikonis.dice, flat: ikonis.flat + extra + live.damageBonus };
    label = [ikonis.label, ...ikonis.augments].join(", ");
  } else {
    input = { ...base, dice: source.dice, flat: extra };
    label = source.dice.map((d) => `${d.count}d${d.sides}`).join("+");
  }
  return { paid: opts.sheet, input, label: [label, ...opts.labels].join(", ") };
}

async function damage(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DamageArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  assertCanAct(character, sheet);
  const ikonis = args.source.kind === "ikonis" ? await loadIkonis(ctx, campaign, character, sheet) : null;
  const { paid, input, label } = rules(() => prepareDamage(sheet, args, scopeOf(campaign), ikonis));
  const roll: RollRecord = { ...rules(() => rollDamage(input, rng)), manual };
  const sheetChanged = changed(sheet, paid);
  if (sheetChanged) await saveSheet(ctx, character._id, paid);
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: ctx.user._id,
    kind: "roll",
    visibility: "public",
    summary: `${sheet.name}: ${args.critical ? "critical " : ""}damage ${roll.total} (${label})${manual ? " [manual]" : ""}`,
    roll,
    ...(sheetChanged ? { before: sheet } : {}),
    undoable: true,
  });
  return { entryId, roll };
}

/** Typed-in dice must all be used: the queue refuses missing, out-of-range and extra values. */
function manualRng(values: number[]) {
  if (values.length > MAX_VALUES) throw appError("DICE_RULE", "Too many dice.");
  return queueRng(values);
}

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
          summary: `${sheet.name}: Tag Team ${TRAIT_LABEL[side.trait]} roll ${roll.total}${roll.difficulty !== undefined ? ` vs ${roll.difficulty}` : ""}, ${OUTCOME_LABEL[roll.outcome]} (not applied yet)`,
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

/**
 * Applies the picked Tag Team roll to both PCs (CB 97): with Hope every
 * involved PC gains a Hope (a critical also clears a Stress), with Fear the
 * GM gains a Fear per PC involved. Logged on both characters in the group.
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
      const group = (
        await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.groupId))
          .take(5)
      ).sort((a, b) => a.at - b.at || a._creationTime - b._creationTime);
      const [first] = group;
      if (first?.characterId === undefined) throw appError("NOT_FOUND");
      const lead = await loadCharacter(ctx, ctx.user, first.characterId, "edit");
      const pending = group.length === 2 && group.every((r) => r.kind === "roll" && r.roll?.kind === "action" && r.characterId !== undefined && r.undoneAt === undefined);
      if (!pending) throw appError("DICE_RULE", "This Tag Team Roll is already settled.");
      const chosen = group.find((r) => r.characterId === pick)?.roll;
      if (chosen === undefined) throw appError("DICE_RULE", "Pick one of the two rolls.");

      const effects = dualityEffects("action", chosen.outcome);
      const { gained } = effects.fear > 0 ? await gainFear(ctx, lead.campaign._id, effects.fear * group.length) : { gained: 0 };
      for (const [i, r] of group.entries()) {
        const character = await ctx.db.get("characters", r.characterId!);
        if (character === null) continue;
        const sheet = readSheet(character.sheet);
        const next = applyDualityEffects(sheet, { ...effects, fear: 0 });
        const sheetChanged = changed(sheet, next);
        if (sheetChanged) await saveSheet(ctx, character._id, next);
        const gain = effects.hope > 0 ? (next.hope > sheet.hope ? " gains a Hope" : " (Hope full)") : "";
        await logAction(ctx, {
          campaignId: lead.campaign._id,
          characterId: character._id,
          actorId: ctx.user._id,
          kind: "roll",
          visibility: "public",
          summary: `${sheet.name}: Tag Team result ${chosen.total}, ${OUTCOME_LABEL[chosen.outcome]}${gain}${i === 0 && gained > 0 ? `; GM gains ${gained} Fear` : ""}`,
          groupId: row.groupId,
          ...(sheetChanged ? { before: sheet } : {}),
          ...(i === 0 && gained !== 0 ? { fearDelta: gained } : {}),
          undoable: true,
        });
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
