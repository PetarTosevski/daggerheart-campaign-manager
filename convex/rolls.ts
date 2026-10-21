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
import { BRAWLERS_STRIKE } from "../src/lib/domain/class-features/classes/brawler";
import { afterDualityRoll, rollOptions, weaponOverrides } from "../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../src/lib/domain/class-features/index";
import type { FeatureScope, WeaponOverride } from "../src/lib/domain/class-features/types";
import { ikonisWeapon, type IkonisWeapon } from "../src/lib/domain/dice/ikonis";
import {
  applyDualityEffects,
  applyRollOptions,
  assertTypedModifier,
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
  typedLabel,
  weaponDice,
  type DamageInput,
  type DualityInput,
  type Rng,
} from "../src/lib/domain/dice/index";
import { countsAsActionRoll } from "../src/lib/domain/countdowns/advanced";
import type { RollRecord } from "../src/lib/domain/duality";
import {
  featuresOf,
  placeTideToken,
  rollGaveHope,
  SLAYER_DIE_SIDES,
  slayerCapacity,
  slayerDice,
  slayerStorePrompt,
  spendSlayerDice,
  spendTideTokens,
  storeSlayerDie as storeDie,
  WITH_HOPE,
} from "../src/lib/domain/session-features/index";
import { appError } from "../src/lib/errors/app-error";
import { getWeapon } from "../src/lib/srd/index";
import type { TraitId } from "../src/lib/srd/types";
import { FRAME_OF, TRAIT_LABEL } from "../src/lib/frames/extras/common";
import type { CharacterSheet } from "../src/lib/validation/characters";
import { motherboardState } from "./characterExtras";
import { tickArmedCountdowns } from "./countdownRolls";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { latestLiveRow, logAction, newGroupId } from "./lib/actionLog";
import { assertCanAct, findCharacter, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { featureScope } from "./lib/featureScope";
import { gainFear } from "./lib/fear";
import { gmMutation, keyedGmMutation, keyedUserMutation, userQuery } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { atLeast } from "./lib/permissions";
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
  /** Slayer Dice to spend (attack rolls only, CB 48): rolled by the server and added. */
  slayerDice: v.optional(v.number()),
  /** Know the Tide tokens to spend (action rolls only, CB 77): +1 each. */
  tideTokens: v.optional(v.number()),
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

const damageFields = {
  source: damageSource,
  critical: v.boolean(),
  modifier: v.number(),
  options: v.array(v.string()),
  /** Slayer Dice to spend (CB 48): rolled by the server and added. */
  slayerDice: v.optional(v.number()),
};

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
  slayerDice?: number;
  tideTokens?: number;
};
type DamageSource = { kind: "weapon"; slot: "primary" | "secondary" } | { kind: "override"; key: string } | { kind: "ikonis" } | { kind: "dice"; dice: { count: number; sides: number }[] };
type DamageArgs = { source: DamageSource; critical: boolean; modifier: number; options: string[]; slayerDice?: number };

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

/**
 * The character's Ikonis as a weapon (Motherboard only), read from its
 * Motherboard module (`motherboardState`: its `characterExtras` row, seeded by
 * `characters.create`, or the legacy tracker row).
 */
async function loadIkonis(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, sheet: CharacterSheet): Promise<IkonisWeapon> {
  if (campaign.frameId !== FRAME_OF.motherboard) throw appError("DICE_RULE", "Only Motherboard characters have an Ikonis.");
  const state = await motherboardState(ctx, campaign, character._id);
  const weapon = state === null ? null : ikonisWeapon(state.ikonis, state.installed, sheet.level, sheet.proficiency);
  if (weapon === null) throw appError("DICE_RULE", "Design your Ikonis first (Motherboard panel).");
  return weapon;
}

/** Pays a Duality roll's costs (Experiences, roll options) and builds the resolver's input. */
function prepareDuality(sheet: CharacterSheet, args: DualityArgs, scope: FeatureScope, ikonis: IkonisWeapon | null): { paid: CharacterSheet; input: DualityInput; extras: string[] } {
  if (args.options.length > MAX_OPTIONS) throw new DiceRuleError("Too many options.");
  assertTypedModifier(args.modifier);
  const live = withEffects(sheet);
  const exp = experienceBonus(sheet.experiences, args.experienceIds);
  const opts = applyRollOptions(spendHope(sheet, exp.hope), rollOptions(sheet, args.kind, CLASS_FEATURES, scope), args.options);
  const attack = args.attack || ikonis !== null;
  const spent = spendSessionFeatures(opts.sheet, args, attack);
  return {
    paid: spent.sheet,
    input: {
      kind: args.kind,
      trait: live.traits[ikonis?.trait ?? args.trait],
      modifier: args.modifier + exp.value + opts.modifier + spent.tide + (attack ? live.attackBonus : 0) + (ikonis?.attack ?? 0),
      ...(args.difficulty !== undefined ? { difficulty: args.difficulty } : {}),
      advantage: args.advantage + opts.advantage + (ikonis?.advantage ? 1 : 0),
      disadvantage: args.disadvantage,
      help: args.help,
      extraDice: [...opts.extraDice, ...opts.namedDice],
      // Slayer Dice come last, already rolled by the server rng (a manual roll types in only its own dice).
      fixedDice: [...opts.fixedDice, ...spent.slayer],
    },
    extras: [...(ikonis ? [ikonis.label, ...ikonis.augments] : []), ...exp.names, ...opts.labels, ...spent.labels],
  };
}

/** One Slayer d6 each, rolled with the server's rng whatever the roll's own dice come from (U3). */
function rollSlayerDice(n: number): { sides: number; value: number }[] {
  return Array.from({ length: n }, () => ({ sides: SLAYER_DIE_SIDES, value: rollDie(SLAYER_DIE_SIDES) }));
}

/** "Slayer d6 ×2 (4, 6)". */
function slayerLabel(dice: readonly { value: number }[]): string[] {
  return dice.length === 0 ? [] : [`Slayer d6${dice.length > 1 ? ` ×${dice.length}` : ""} (${dice.map((d) => d.value).join(", ")})`];
}

/**
 * Spends a Duality roll's Slayer Dice (attack rolls only, K2) and Tide tokens (action rolls only, K3) through the
 * session-features rules, and rolls the Slayer Dice. Refusals: DICE_RULE (wrong roll, more than held),
 * CLASS_FEATURE_RULE (Tide tokens without Know the Tide).
 */
function spendSessionFeatures(sheet: CharacterSheet, args: DualityArgs, attack: boolean): { sheet: CharacterSheet; tide: number; slayer: { sides: number; value: number }[]; labels: string[] } {
  const slayerCount = args.slayerDice ?? 0;
  const tideCount = args.tideTokens ?? 0;
  if (slayerCount !== 0 && (args.kind !== "action" || !attack)) throw new DiceRuleError("Slayer Dice add to attack rolls and damage rolls only.");
  const afterSlayer = spendSlayerDice(sheet, slayerCount);
  const tide = spendTideTokens(afterSlayer, tideCount);
  if (tideCount !== 0 && args.kind !== "action") throw new DiceRuleError("Know the Tide tokens add to action rolls only.");
  const slayer = rollSlayerDice(slayerCount);
  return { sheet: tide.sheet, tide: tide.modifier, slayer, labels: [...(tide.modifier > 0 ? [`Know the Tide +${tide.modifier}`] : []), ...slayerLabel(slayer)] };
}

/** " vs 14" when the GM set the Difficulty, " vs DC 14 (player)" when a player typed it (review M1). */
function versus(difficulty: number | undefined, gm: boolean): string {
  if (difficulty === undefined) return "";
  return gm ? ` vs ${difficulty}` : ` vs DC ${difficulty} (player)`;
}

function dualitySummary(name: string, args: Pick<DualityArgs, "kind" | "trait" | "modifier">, roll: RollRecord, extras: string[], gm: boolean): string {
  const using = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  const manual = roll.manual ? " [manual]" : "";
  return `${name}: ${TRAIT_LABEL[args.trait]} ${args.kind} roll ${roll.total}${typedLabel(args.modifier)}${versus(roll.difficulty, gm)}, ${OUTCOME_LABEL[roll.outcome]}${using}${manual}`;
}

/** `gm`: the roller is the campaign's GM, so their typed values are the GM's call. */
type Loaded = { campaign: Doc<"campaigns">; character: Doc<"characters">; sheet: CharacterSheet; gm: boolean };

/** A character the user edits (owner or GM), with its sheet. */
async function editable(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">): Promise<Loaded> {
  const { campaign, character, permission } = await loadCharacter(ctx, user, characterId, "edit", "owner");
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
}

/** How far back a damage roll looks for the character's latest action roll. */
const CRITICAL_SCAN = 20;

/** A damage critical counts as rolled when the character's latest live action roll was a critical success; else it is declared (review M1). */
async function criticalRolled(ctx: QueryCtx, characterId: Id<"characters">): Promise<boolean> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(CRITICAL_SCAN);
  const last = rows.find((r) => r.undoneAt === undefined && r.roll?.kind === "action");
  return last?.roll?.outcome === "critical";
}

/** Rolls (or reads typed-in dice), applies Hope, Stress and Fear, saves and logs. */
async function duality(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DualityArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  assertCanAct(character, sheet);
  const scope = featureScope(campaign);
  const ikonis = args.ikonis ? await loadIkonis(ctx, campaign, character, sheet) : null;
  const { paid, input, extras } = rules(() => prepareDuality(sheet, args, scope, ikonis));
  const trait = ikonis?.trait ?? args.trait;
  const rolled = rules(() => rollDuality(input, rng));
  const roll: RollRecord = { ...rolled.roll, manual };
  const effects = dualityEffects(args.kind, roll.outcome);
  // A roll with Fear places a Know the Tide token in the same saved sheet and row, so undoing the roll takes it back (U4).
  const next = placeTideToken(applyDualityEffects(paid, effects), roll.outcome, args.kind).sheet;
  const { gained } = effects.fear > 0 ? await gainFear(ctx, campaign._id, effects.fear) : { gained: 0 };
  const sheetChanged = changed(sheet, next);
  if (sheetChanged) await saveSheet(ctx, character._id, next);
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: ctx.user._id,
    kind: "roll",
    visibility: "public",
    summary: dualitySummary(sheet.name, { kind: args.kind, trait, modifier: args.modifier }, roll, extras, loaded.gm),
    roll,
    ...(sheetChanged ? { before: sheet } : {}),
    ...(gained !== 0 ? { fearDelta: gained } : {}),
    // `paid` is the sheet after the roll's costs and before its gains (K2: the Slayer store takes back only a gained Hope).
    ...(args.kind === "action" && WITH_HOPE.includes(roll.outcome) ? { hopeGained: rollGaveHope(paid, roll.outcome, args.kind) } : {}),
    undoable: true,
  });
  // Armed countdowns tick right after the action roll resolves (countdowns-advanced K1, CB p.162); never a reaction roll (CB p.99).
  if (countsAsActionRoll(roll, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: roll.outcome, actorId: ctx.user._id });
  }
  // Reaction rolls prompt too (Strange Patterns: "a Duality Die shows it", CB 50); prompts that need Hope check the roll kind.
  const prompts = afterDualityRoll(next, { hope: rolled.hope, fear: rolled.fear, roll }, CLASS_FEATURES, scope);
  return { entryId, roll, fearGained: gained, prompts };
}

/**
 * Whether a damage source deals magic damage, for `physicalOnly` options (Combat Training, CB 48): a weapon by
 * its damage type, where "either" (Shadowblade: "you can deal physical or magic damage") counts as physical; an
 * override by its definition (unset is physical); the Ikonis and custom dice as physical (Motherboard has no
 * Combat Training anyway, CB 295).
 */
function magicDamage(sheet: CharacterSheet, source: DamageSource, overrides: readonly WeaponOverride[]): boolean {
  if (source.kind === "weapon") {
    const weaponId = source.slot === "primary" ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    return (weaponId ? getWeapon(weaponId) : undefined)?.damageType === "magic";
  }
  if (source.kind === "override") return overrides.find((o) => o.key === source.key)?.damageType === "magic";
  return false;
}

/**
 * The damage dice of a source: weapon dice at Proficiency (CB 98), a class
 * override, the Ikonis, or dice as given. Option dice are bonus dice, so a
 * critical maxes feature damage dice (Sneak Attack) but not named held dice (a Rally Die; CB 98, user 2026-10-21).
 */
function prepareDamage(sheet: CharacterSheet, args: DamageArgs, scope: FeatureScope, ikonis: IkonisWeapon | null): { paid: CharacterSheet; input: DamageInput; label: string } {
  if (args.options.length > MAX_OPTIONS) throw new DiceRuleError("Too many options.");
  assertTypedModifier(args.modifier);
  const overrides = weaponOverrides(sheet, CLASS_FEATURES, scope);
  let source = args.source;
  // Brawler's Strike as the primary weapon is the I Am the Weapon override when it applies (HF 10).
  if (source.kind === "weapon" && source.slot === "primary" && sheet.primaryWeaponId === BRAWLERS_STRIKE && overrides.some((o) => o.key === "brawlersStrike")) {
    source = { kind: "override", key: "brawlersStrike" };
  }
  const magic = magicDamage(sheet, source, overrides);
  const available = rollOptions(sheet, "damage", CLASS_FEATURES, scope).filter((o) => !(magic && o.physicalOnly));
  const opts = applyRollOptions(sheet, available, args.options);
  const live = withEffects(sheet);
  const fixed = opts.fixedDice.reduce((s, d) => s + d.value, 0);
  const base = { critical: args.critical, bonusDice: opts.extraDice, namedDice: opts.namedDice };
  const extra = args.modifier + opts.modifier + fixed;
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
  return { paid: spendSlayerDice(opts.sheet, args.slayerDice ?? 0), input, label: [label, ...opts.labels].join(", ") };
}

/**
 * Adds spent Slayer Dice to a damage roll as extra d6s (K2: "rolling them and adding their result to the roll").
 * A critical does not max them: it maxes the damage dice only (CB 98; user 2026-10-21).
 */
function withSlayerDamage(roll: RollRecord, slayer: readonly { sides: number; value: number }[]): RollRecord {
  if (slayer.length === 0) return roll;
  const dice = [...roll.dice, ...slayer.map((d) => ({ ...d, role: "extra" as const }))];
  const total = Math.max(0, dice.reduce((s, d) => s + d.value, 0) + roll.modifier);
  return { ...roll, dice, total };
}

async function damage(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DamageArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  assertCanAct(character, sheet);
  const ikonis = args.source.kind === "ikonis" ? await loadIkonis(ctx, campaign, character, sheet) : null;
  const { paid, input, label } = rules(() => prepareDamage(sheet, args, featureScope(campaign), ikonis));
  const slayer = rollSlayerDice(args.slayerDice ?? 0);
  const roll: RollRecord = withSlayerDamage({ ...rules(() => rollDamage(input, rng)), manual }, slayer);
  const critical = !args.critical ? "" : (await criticalRolled(ctx, character._id)) ? "critical " : "critical (declared) ";
  const sheetChanged = changed(sheet, paid);
  if (sheetChanged) await saveSheet(ctx, character._id, paid);
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: ctx.user._id,
    kind: "roll",
    visibility: "public",
    summary: `${sheet.name}: ${critical}damage ${roll.total}${typedLabel(args.modifier)} (${[label, ...slayerLabel(slayer)].join(", ")})${manual ? " [manual]" : ""}`,
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
 * result (Q1), never a Tag Team roll still waiting for its pick. Null otherwise.
 */
async function slayerRoll(ctx: QueryCtx, characterId: Id<"characters">): Promise<Doc<"actionLog"> | null> {
  const row = await latestLive(ctx, characterId);
  if (row === null || row.kind !== "roll" || row.roll?.kind !== "action" || !WITH_HOPE.includes(row.roll.outcome)) return null;
  if (row.groupId !== undefined && (await tagTeamGroup(ctx, row)).length !== 4) return null;
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
