/**
 * The shared internals of the dice rolls (moved from convex/rolls.ts by plan combat-actions CA3, CF8: plain helpers in
 * convex/lib, no `ctx.runMutation`). Behaviour is unchanged: `convex/rolls.ts` keeps the public functions and calls these;
 * `convex/combatActions.ts` reuses the same Duality and damage steps for weapon attacks on the Combat Map.
 *
 * - `duality(ctx, loaded, args, rng, manual)`: a character's Duality roll, saved and logged (one public row), Fear gained,
 *   armed countdowns ticked, class-feature prompts returned. `resolveDuality` is its first half (pay, roll, apply Hope /
 *   Stress) without saving or logging, for callers that log their own rows (a combat attack).
 * - `damage(ctx, loaded, args, rng, manual)`: a damage roll, saved and logged. `resolveDamage` is its first half.
 * - Validators of the roll arguments and results (`dualityFields`, `damageFields`, ...), shared by both modules.
 */
import { v } from "convex/values";

import { withEffects } from "../../src/lib/domain/characters/effects";
import { BRAWLERS_STRIKE } from "../../src/lib/domain/class-features/classes/brawler";
import { afterDualityRoll, rollOptions, weaponOverrides } from "../../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../../src/lib/domain/class-features/index";
import type { FeatureScope, WeaponOverride } from "../../src/lib/domain/class-features/types";
import { ikonisWeapon, type IkonisWeapon } from "../../src/lib/domain/dice/ikonis";
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
  spendHope,
  typedLabel,
  weaponDice,
  type DamageInput,
  type DualityInput,
  type Rng,
} from "../../src/lib/domain/dice/index";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import type { RollRecord } from "../../src/lib/domain/duality";
import { placeTideToken, rollGaveHope, SLAYER_DIE_SIDES, spendSlayerDice, spendTideTokens, WITH_HOPE } from "../../src/lib/domain/session-features/index";
import { appError } from "../../src/lib/errors/app-error";
import { getWeapon } from "../../src/lib/srd/index";
import type { TraitId } from "../../src/lib/srd/types";
import { FRAME_OF, TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { motherboardState } from "../characterExtras";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { assertCanAct, loadCharacter, readSheet, saveSheet } from "./characterSheet";
import { rollDie } from "./dice";
import { featureScope } from "./featureScope";
import { gainFear } from "./fear";
import { applyRule } from "./mechanics";
import { rollValidator } from "./validators/actionLog";
import { traitIdValidator } from "./validators/characters";

// ---------------------------------------------------------------- validators

export const dualityKind = v.union(v.literal("action"), v.literal("reaction"));

export const dualityFields = {
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

export const poolValidator = v.array(v.object({ count: v.number(), sides: v.number() }));

export const damageSource = v.union(
  v.object({ kind: v.literal("weapon"), slot: v.union(v.literal("primary"), v.literal("secondary")) }),
  v.object({ kind: v.literal("override"), key: v.string() }),
  /** The character's Ikonis (Motherboard, CB 301). */
  v.object({ kind: v.literal("ikonis") }),
  /** Dice named by a spell or feature ("d6 using Spellcast"): rolled as given. */
  v.object({ kind: v.literal("dice"), dice: poolValidator }),
);

export const damageFields = {
  source: damageSource,
  critical: v.boolean(),
  modifier: v.number(),
  options: v.array(v.string()),
  /** Slayer Dice to spend (CB 48): rolled by the server and added. */
  slayerDice: v.optional(v.number()),
};

export const promptValidator = v.object({
  key: v.string(),
  featureKey: v.string(),
  text: v.string(),
  choices: v.array(v.object({ key: v.string(), label: v.string() })),
});

export const dualityResult = v.object({ entryId: v.id("actionLog"), roll: rollValidator, fearGained: v.number(), prompts: v.array(promptValidator) });
export const damageResult = v.object({ entryId: v.id("actionLog"), roll: rollValidator });

export type DualityArgs = {
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
export function rules<T>(run: () => T): T {
  return applyRule("NOT_ENOUGH_HOPE", NotEnoughHopeError, () => applyRule("DICE_RULE", DiceRuleError, run));
}

export function changed(a: CharacterSheet, b: CharacterSheet): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function signed(n: number): string {
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
export function prepareDuality(sheet: CharacterSheet, args: DualityArgs, scope: FeatureScope, ikonis: IkonisWeapon | null): { paid: CharacterSheet; input: DualityInput; extras: string[] } {
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
export function versus(difficulty: number | undefined, gm: boolean): string {
  if (difficulty === undefined) return "";
  return gm ? ` vs ${difficulty}` : ` vs DC ${difficulty} (player)`;
}

function dualitySummary(name: string, args: Pick<DualityArgs, "kind" | "trait" | "modifier">, roll: RollRecord, extras: string[], gm: boolean): string {
  const using = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  const manual = roll.manual ? " [manual]" : "";
  return `${name}: ${TRAIT_LABEL[args.trait]} ${args.kind} roll ${roll.total}${typedLabel(args.modifier)}${versus(roll.difficulty, gm)}, ${OUTCOME_LABEL[roll.outcome]}${using}${manual}`;
}

/** `gm`: the roller is the campaign's GM, so their typed values are the GM's call. */
export type Loaded = { campaign: Doc<"campaigns">; character: Doc<"characters">; sheet: CharacterSheet; gm: boolean };

/** A character the user edits (owner or GM), with its sheet. */
export async function editable(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">): Promise<Loaded> {
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

/**
 * The first half of `duality`: checks the character can act, pays the roll's costs, rolls (or reads typed-in dice) and
 * applies Hope, Stress and a Know the Tide token to the sheet. Saves and logs nothing: `paid` is the sheet after the
 * costs, `next` the sheet to save, `effects.fear` the Fear the GM should gain.
 */
export async function resolveDuality(ctx: QueryCtx, loaded: Loaded, args: DualityArgs, rng: Rng, manual: boolean) {
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
  return { scope, paid, next, extras, trait, rolled, roll, effects };
}

/** Rolls (or reads typed-in dice), applies Hope, Stress and Fear, saves and logs. */
export async function duality(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DualityArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  const { scope, paid, next, extras, trait, rolled, roll, effects } = await resolveDuality(ctx, loaded, args, rng, manual);
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

/**
 * The first half of `damage`: checks the character can act, pays the roll options and rolls the damage dice (Slayer
 * Dice added) on `loaded.sheet`. Saves and logs nothing: `paid` is the sheet to save, `label` names the source.
 */
export async function resolveDamage(ctx: QueryCtx, loaded: Loaded, args: DamageArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  assertCanAct(character, sheet);
  const ikonis = args.source.kind === "ikonis" ? await loadIkonis(ctx, campaign, character, sheet) : null;
  const { paid, input, label } = rules(() => prepareDamage(sheet, args, featureScope(campaign), ikonis));
  const slayer = rollSlayerDice(args.slayerDice ?? 0);
  const roll: RollRecord = withSlayerDamage({ ...rules(() => rollDamage(input, rng)), manual }, slayer);
  return { paid, roll, label, slayer };
}

export async function damage(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DamageArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  const { paid, roll, label, slayer } = await resolveDamage(ctx, loaded, args, rng, manual);
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
export function manualRng(values: number[]) {
  if (values.length > MAX_VALUES) throw appError("DICE_RULE", "Too many dice.");
  return queueRng(values);
}
