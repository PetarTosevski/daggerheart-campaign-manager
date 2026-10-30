/**
 * Weapon attacks on the Combat Map (plan combat-actions, tracer CA3): the shared steps behind `combatActions.attack`,
 * `combatActions.targets`, `combatActions.pickMinions` and the GM's sanction (`combatRequests.sanction`). Callers are
 * campaign wrappers that already loaded the character with edit permission; these helpers only scope, check, roll and
 * write. The rules are CA1's pure engine (src/lib/domain/combat-actions) and the dice internals of ./rolls.
 *
 * Rules (printed pages; quotes in docs/tasks/TASK-CA-CA3.md):
 * - R1 (CB p.96): one attack roll against each target's Difficulty; a critical hits every target (CB p.90).
 * - R2 (CB p.98): on any hit one damage roll, the weapon's dice at Proficiency; a critical adds the dice's maximum.
 * - R9 (CB p.104): one roll for all targets, the damage total applied to each target hit.
 * - R3 / R10 (CB p.91, p.99, p.193): resistance halves, immunity takes none, then thresholds 1 / 2 / 3 HP; a Minion is
 *   defeated by any damage and every X damage defeats one more Minion the attacker picks (CB p.201, Q6).
 * - R11 (CB p.103-104): out of the weapon's range waits for the GM (Q1), no line of sight refuses (Q2), cover gives
 *   the roll one disadvantage (Q2).
 * - U1: what a player receives (returns, the public row) holds hit / miss / defeated and their own dice only; HP,
 *   Stress, thresholds and Difficulty are only on the GM's row.
 *
 * Plan sheet-drawer SD5 (docs/tasks/TASK-SD-SD5.md): riders on the attack (a loadout card's or an owned feature's `rider`
 * use: Rage Up, Hold Them Off, Kick...) and the automatic ones (First Strike, Face Your Fear, Pummeljoy) run through the
 * card path (convex/lib/cardRunner.ts) and fold into the attack; Sneak Attack and Cloaked follow the map (Q9, CB p.42); an
 * attack whose attacker holds a ready after-roll feature is held after its roll (Q1, CB p.107) until Use or Pass.
 */
import { ConvexError, v, type Infer } from "convex/values";

import { featureUseKey, keyAvailability, requirementMet, stateCheckMet } from "../../src/lib/domain/card-effects/availability";
import { rollMatches, type PlanStep, type RunPlan } from "../../src/lib/domain/card-effects/run";
import type { CardUse, DamageType, Range, RollFilter, RollSpec, Step, TargetSpec, Trigger } from "../../src/lib/domain/card-effects/types";
import { lineOfSight, rangeCheck, rangeFromWeapon, resolveHits, applyDamageTo, type Combatant, type DamageResult, type RangeCheck, type SightResult } from "../../src/lib/domain/combat-actions/index";
import { tokenVisibility } from "../../src/lib/domain/combat-map/index";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import { afterDualityRoll, rollOptions } from "../../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../../src/lib/domain/class-features/index";
import { applyDualityEffects, dualityEffects, typedLabel, type Rng } from "../../src/lib/domain/dice/index";
import { actionOutcome, type RollRecord } from "../../src/lib/domain/duality";
import { holdingsFor, type OwnedFeature } from "../../src/lib/domain/feature-effects/owned";
import { actorExtras, featureAvailability, featureCostShort } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { applyUpgrades } from "../../src/lib/domain/feature-effects/upgrades";
import { SEVERITY_LABEL } from "../../src/lib/domain/encounters/damage";
import { minionValue } from "../../src/lib/domain/adversaries/index";
import { placeTideToken, rollGaveHope, WITH_HOPE } from "../../src/lib/domain/session-features/index";
import { appError } from "../../src/lib/errors/app-error";
import { TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import { cardEffect, cardUsage } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { getDomainCard, getWeapon } from "../../src/lib/srd/index";
import type { AdversaryDef, TraitId, Weapon } from "../../src/lib/srd/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { parseChoices, type CardChoice, type ParsedChoices } from "./cardChoices";
import { adversaryBefore, cardPromptValidator, gmLines, instanceWrites, promptsOf, writeInstances, type CardPrompt, type InstanceWrite } from "./cardRows";
import { actorSheetAfter, bindGates, buildRun, cardActor, pickCard, replaying, riderPartRuns, riderUse, runCard, type BuiltRun, type HostRoll, type RiderPart, type UsePick } from "./cardRunner";
import { saveSheet } from "./characterSheet";
import { loadCombatMap } from "./combatMaps";
import { loadScene, viewOf, type Scene, type Viewer } from "./combatVision";
import { costText, limitText } from "./featureDrawer";
import { factsOf, ownedHere, pickFeature } from "./featureRunner";
import { featureScope } from "./featureScope";
import { campaignFearState, gainFear, spendFear } from "./fear";
import { openAfterRoll, openMinionOffer } from "./combatRequests";
import { changed, resolveDamage, resolveDuality, type DualityArgs, type Loaded } from "./rolls";
import type { AdversaryBefore } from "./validators/actionLog";
import { traitIdValidator } from "./validators/characters";
import { MAX_RIDERS_PER_ATTACK, rangeBandValidator, sanctionRollOptionsValidator, type AfterRollChange, type AfterRollChoice, type Rider } from "./validators/combatRequests";
import { rollValidator } from "./validators/actionLog";
import { rollDie } from "./dice";

/** The most targets one attack names (the bound `combatRequests` documents, CD8). */
export const MAX_TARGETS = 20;

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));

// ---------------------------------------------------------------- validators

export const weaponSlotValidator = v.union(v.literal("primary"), v.literal("secondary"));
export type WeaponSlot = Infer<typeof weaponSlotValidator>;

/** The Duality options of an attack, as the sheet's dice box sends them (`dualityFields` without trait / kind / attack). */
export const attackRollFields = {
  /** Only for a weapon whose trait is the wielder's choice (Brawler's Strike); else the weapon's trait is used. */
  trait: v.optional(traitIdValidator),
  modifier: v.number(),
  experienceIds: v.array(v.string()),
  advantage: v.number(),
  disadvantage: v.number(),
  help: v.number(),
  /** Chosen `rollOptions` keys of the attack roll. */
  options: v.array(v.string()),
  /** Chosen `rollOptions` keys of the damage roll (Sneak Attack, Combat Training...). */
  damageOptions: v.optional(v.array(v.string())),
  slayerDice: v.optional(v.number()),
  tideTokens: v.optional(v.number()),
};

export type AttackRoll = {
  trait?: TraitId;
  modifier: number;
  experienceIds: string[];
  advantage: number;
  disadvantage: number;
  help: number;
  options: string[];
  damageOptions?: string[];
  slayerDice?: number;
  tideTokens?: number;
};

/** One target as the player learns it (U1): hit or miss, and whether it went down (Q6). */
export const targetOutcomeValidator = v.object({ tokenId: v.id("combatTokens"), hit: v.boolean(), defeated: v.boolean() });

/** The Minions a player may pick after the attack (Q6): which token, and how many of its Minions. No stats. */
export const minionOfferValidator = v.object({
  requestId: v.id("combatRequests"),
  extra: v.number(),
  candidates: v.array(v.object({ instanceId: v.id("encounterAdversaries"), tokenId: v.id("combatTokens"), name: v.string(), available: v.number() })),
});

const promptValidator = v.object({
  key: v.string(),
  featureKey: v.string(),
  text: v.string(),
  choices: v.array(v.object({ key: v.string(), label: v.string() })),
});

/** What `attack` (and the GM's approval) returns: the player's own dice and hit / miss per target, never a stat. */
export const resolvedAttackValidator = v.object({
  status: v.literal("resolved"),
  entryId: v.id("actionLog"),
  roll: rollValidator,
  /** The damage roll (null when every target was missed). */
  damage: v.union(v.null(), rollValidator),
  targets: v.array(targetOutcomeValidator),
  fearGained: v.number(),
  minionOffer: v.union(v.null(), minionOfferValidator),
  prompts: v.array(promptValidator),
  /** SD5: the riders that applied (and Sneak Attack, an after-roll feature), by name. */
  riders: v.optional(v.array(v.string())),
  /** SD5: riders the player took whose trigger didn't happen (Hold Them Off on a miss): nothing paid. */
  skipped: v.optional(v.array(v.string())),
  /** SD5: what the riders leave to the table (movement prompts, manual steps). */
  riderPrompts: v.optional(v.array(cardPromptValidator)),
});
export type ResolvedAttack = Infer<typeof resolvedAttackValidator>;

/** An attack that waits for the GM (Q1): which targets are out of range and in which band. */
export const pendingAttackValidator = v.object({
  status: v.literal("pending"),
  requestId: v.id("combatRequests"),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

/** `combatActions.targets`: per visible enemy token only the band and whether it can be attacked (U1, CF6). */
export const targetHintValidator = v.object({
  tokenId: v.id("combatTokens"),
  band: rangeBandValidator,
  inRange: v.boolean(),
  lineOfSight: v.boolean(),
  cover: v.boolean(),
});

// ---------------------------------------------------------------- the scene around the attacker

export type AttackScene = { map: Doc<"combatMaps">; scene: Scene; viewer: Viewer; attacker: Doc<"combatTokens"> };

/**
 * The live map and the character's view on it. COMBAT_MAP_NOT_FOUND for a map that is not this campaign's live map
 * (players act only on the live map, R2); COMBAT_TOKEN_NOT_FOUND when the character has no PC token there.
 */
export async function attackScene(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, mapId: string): Promise<AttackScene> {
  const map = await loadCombatMap(ctx, campaign._id, mapId);
  if (!map.live) throw appError("COMBAT_MAP_NOT_FOUND");
  const scene = await loadScene(ctx, campaign, map);
  const viewer = viewOf(scene, character);
  if (viewer === null) throw appError("COMBAT_TOKEN_NOT_FOUND");
  return { map, scene, viewer, attacker: scene.tokens[viewer.index]! };
}

/** An enemy token's encounter instance, when it can be attacked: an enemy-side adversary token of a running encounter, not defeated. */
async function enemyInstance(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<{ instance: Doc<"encounterAdversaries">; encounter: Doc<"encounters"> } | null> {
  if (token.side !== "enemy" || token.ref.kind !== "adversary") return null;
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  if (instance === null || instance.campaignId !== campaignId || instance.defeated) return null;
  const encounter = await ctx.db.get("encounters", instance.encounterId);
  if (encounter === null || encounter.campaignId !== campaignId || encounter.status !== "running") return null;
  return { instance, encounter };
}

/** Whether the viewer sees the token at all (dark, hidden, behind walls: no line of sight, CB p.104 "if you can see the target"). */
function seenBy(s: AttackScene, index: number): boolean {
  return tokenVisibility(s.viewer.view, s.scene.visionTokens[index]!) !== "hidden";
}

function sightTo(s: AttackScene, token: Doc<"combatTokens">): SightResult {
  return lineOfSight(s.scene.prepared, s.attacker, token, s.scene.visionObjects);
}

export function weaponIn(sheet: CharacterSheet, slot: WeaponSlot): Weapon | undefined {
  const id = slot === "primary" ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
  return id ? getWeapon(id) : undefined;
}

/** `combatActions.targets`: every enemy token the character sees that can be attacked, with its band and hints. */
export async function targetHints(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon | undefined): Promise<Infer<typeof targetHintValidator>[]> {
  const hints: Infer<typeof targetHintValidator>[] = [];
  for (const [i, token] of s.scene.tokens.entries()) {
    if (i === s.viewer.index || token.side !== "enemy" || !seenBy(s, i)) continue;
    if ((await enemyInstance(ctx, campaign._id, token)) === null) continue;
    const check = rangeCheck(s.attacker, token, weapon ? rangeFromWeapon(weapon.range) : "melee");
    const sight = sightTo(s, token);
    hints.push({ tokenId: token._id, band: check.band, inRange: weapon !== undefined && check.inRange, lineOfSight: sight.lineOfSight, cover: sight.cover });
  }
  return hints;
}

// ---------------------------------------------------------------- checking the targets

export type CheckedTarget = {
  token: Doc<"combatTokens">;
  instance: Doc<"encounterAdversaries">;
  encounter: Doc<"encounters">;
  check: RangeCheck;
  sight: SightResult;
};

/**
 * A plain weapon attack takes one target (CA4b user answer, bead dcm-bxp.99.18: "Plain weapon attacks take one
 * target"); more than one is COMBAT_TARGET_INVALID. Card effects keep their own bound (MAX_CARD_TARGETS).
 */
export const WEAPON_ATTACK_TARGETS = 1;

/**
 * Checks the named target: exactly one (`WEAPON_ATTACK_TARGETS`), on the map and seen with a clear line (else
 * COMBAT_NO_LINE_OF_SIGHT, Q2), an enemy token linked to an undefeated instance of a running encounter (else
 * COMBAT_TARGET_INVALID). Seen first, so a token the player can't see answers the same whatever it is. Kept as a list
 * (a stored sanction holds `targetTokenIds`); several targets would have to share one encounter.
 */
export async function checkTargets(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon, tokenIds: readonly Id<"combatTokens">[]): Promise<CheckedTarget[]> {
  if (tokenIds.length === 0 || tokenIds.length > Math.min(MAX_TARGETS, WEAPON_ATTACK_TARGETS) || new Set(tokenIds).size !== tokenIds.length) throw appError("COMBAT_TARGET_INVALID");
  const range = rangeFromWeapon(weapon.range);
  const checked: CheckedTarget[] = [];
  for (const id of tokenIds) {
    const index = s.scene.tokens.findIndex((t) => t._id === id);
    if (index < 0 || index === s.viewer.index) throw appError("COMBAT_TARGET_INVALID");
    const token = s.scene.tokens[index]!;
    if (!seenBy(s, index)) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const sight = sightTo(s, token);
    if (!sight.lineOfSight) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const linked = await enemyInstance(ctx, campaign._id, token);
    if (linked === null) throw appError("COMBAT_TARGET_INVALID");
    checked.push({ token, ...linked, check: rangeCheck(s.attacker, token, range), sight });
  }
  if (new Set(checked.map((c) => c.encounter._id)).size > 1) throw appError("COMBAT_TARGET_INVALID");
  return checked;
}

/** The weapon in the slot, or DICE_RULE (as `damageRoll`) when none is equipped. */
export function equippedWeapon(sheet: CharacterSheet, slot: WeaponSlot): Weapon {
  const weapon = weaponIn(sheet, slot);
  if (!weapon) throw appError("DICE_RULE", `No ${slot} weapon is equipped.`);
  return weapon;
}

/** The Duality arguments of a weapon attack (the weapon's trait unless it is the wielder's choice). */
export function attackDuality(weapon: Weapon, roll: AttackRoll, cover: boolean): DualityArgs {
  const trait = weapon.trait === "choice" ? roll.trait : weapon.trait;
  if (trait === undefined) throw appError("DICE_RULE", "Pick the trait this weapon attacks with.");
  return {
    kind: "action",
    trait,
    modifier: roll.modifier,
    experienceIds: roll.experienceIds,
    advantage: roll.advantage,
    // CB p.104: attack rolls against a target in cover are made with disadvantage (Q2); one roll for every target (R9).
    disadvantage: roll.disadvantage + (cover ? 1 : 0),
    help: roll.help,
    attack: true,
    options: roll.options,
    ...(roll.slayerDice !== undefined ? { slayerDice: roll.slayerDice } : {}),
    ...(roll.tideTokens !== undefined ? { tideTokens: roll.tideTokens } : {}),
  };
}

// ---------------------------------------------------------------- adversaries as the engine reads them

type Block = { minion: boolean; minionX: number | null; resistance: Combatant["resistance"] };

/** Minion type and X, and the resistance that applies now (the instance's own, a conditional one only while the GM has it on). */
async function blockOf(ctx: QueryCtx, instance: Doc<"encounterAdversaries">): Promise<Block> {
  const own = instance.resistance;
  const fromInstance = own === undefined ? undefined : own.conditional === undefined || instance.resistanceActive === true ? { physical: own.physical, magic: own.magic } : { physical: "none" as const, magic: "none" as const };
  if (instance.source.kind === "srd") {
    const def = SRD_BY_ID.get(instance.source.adversaryId);
    const minionX = def ? minionValue(def) : null;
    return { minion: def?.type === "Minion" || minionX !== null, minionX, resistance: fromInstance ?? alwaysOnResistance(instance.source.adversaryId) };
  }
  const block = await ctx.db.get("customAdversaries", instance.source.customId);
  let minionX: number | null = null;
  for (const f of block?.features ?? []) {
    const m = /^Minion \((\d+)\)$/.exec(f.name);
    if (m) minionX = Number(m[1]);
  }
  const custom = block?.resistance && block.resistance.conditional === undefined ? { physical: block.resistance.physical, magic: block.resistance.magic } : undefined;
  return { minion: block?.type === "Minion" || minionX !== null, minionX, resistance: fromInstance ?? custom };
}

/** The instance's Difficulty with card modifiers on it (Glyph of Nightfall, CA0 `effects`). Never sent to a player. */
function difficultyOf(instance: Doc<"encounterAdversaries">): number {
  return instance.stats.difficulty + (instance.effects ?? []).reduce((sum, e) => sum + (e.difficulty ?? 0), 0);
}

function combatantOf(instance: Doc<"encounterAdversaries">, block: Block): Combatant {
  return {
    id: instance._id,
    side: "adversary",
    difficulty: difficultyOf(instance),
    thresholds: { major: instance.stats.major, severe: instance.stats.severe },
    hp: instance.hp,
    hpMax: instance.stats.hpMax,
    stress: instance.stress,
    stressMax: instance.stats.stressMax,
    defeated: instance.defeated,
    resistance: block.resistance,
    conditions: instance.conditions,
    tags: instance.tags,
  };
}

/** One Minion of a group (one HP per Minion): any damage defeats it; X gives the extra defeats (CB p.201). */
function oneMinion(instance: Doc<"encounterAdversaries">, block: Block): Combatant {
  return { ...combatantOf(instance, block), hp: 0, hpMax: 1, thresholds: { major: null, severe: null }, minionX: block.minionX ?? 0 };
}

export function beforeOf(instance: Doc<"encounterAdversaries">): AdversaryBefore {
  return { instanceId: instance._id, hp: instance.hp, stress: instance.stress, defeated: instance.defeated, ...(instance.minionCount !== undefined ? { minionCount: instance.minionCount } : {}) };
}

function damageTypeOf(weapon: Weapon): "physical" | "magic" {
  // Shadowblade's "either" counts as physical, as the damage roll's `magicDamage` reads it.
  return weapon.damageType === "magic" ? "magic" : "physical";
}

const SHORT_TYPE = { physical: "phy", magic: "mag", both: "phy/mag" } as const;

function rollWord(roll: RollRecord): string {
  if (roll.outcome === "critical") return "critical";
  return roll.outcome === "successHope" || roll.outcome === "failHope" ? "with Hope" : "with Fear";
}

function diceList(roll: RollRecord): string {
  return roll.dice.filter((d) => !d.dropped).map((d) => d.value).join(", ");
}

export type AttackRequest = {
  loaded: Loaded;
  /** Who the rows belong to (the attacker's user; on a GM approval, the player who asked). */
  actorId: Id<"users">;
  scene: AttackScene;
  weapon: Weapon;
  slot: WeaponSlot;
  targets: CheckedTarget[];
  roll: AttackRoll;
  /** SD5: the riders the player took with the attack. */
  riders?: readonly Rider[];
  /** SD5 (Q1): a held attack's answer, with every die it drew before it was held (replayed, so nothing is rerolled). */
  held?: { dice: readonly number[]; answer: AfterRollChoice };
};

// ---------------------------------------------------------------- riders (plan sheet-drawer SD5)

/** What a rider rides on: the attack's roll spec (for `rollMatches`), its trait, the weapon and the weapon's range. */
export type Host = { spec: RollSpec; trait: TraitId | undefined; weapon: boolean; weaponRange: Range | null; damageType: DamageType };

export function hostOf(weapon: Weapon, slot: WeaponSlot, trait: TraitId | undefined): Host {
  return {
    spec: { kind: "attack", weapon: slot, difficulty: { kind: "target" } },
    trait: weapon.trait === "choice" ? trait : weapon.trait,
    weapon: true,
    weaponRange: rangeFromWeapon(weapon.range),
    damageType: damageTypeOf(weapon),
  };
}

/** When a rider runs: before the roll, after it (on its result), or after the damage is marked. */
export type RiderPhase = "before" | "after" | "damage";

/** Whether a use's steps change the roll itself (an after-roll answer, Q1, not a rider on the result). */
function changesRoll(steps: readonly Step[]): boolean {
  return steps.some((s) => s.kind === "modifyRoll" || (s.kind === "choose" && s.options.some((o) => changesRoll(o.steps))) || (s.kind === "optional" && changesRoll(s.steps)));
}

/**
 * The phase a rider (or automatic) use rides on a weapon attack with, or null when its trigger isn't about this attack:
 * `beforeYouRoll` an attack, action, the weapon's trait or the damage roll (Rage Up, Elementalist, Ruthless Predator);
 * `whenYouAttack` and `afterYouRoll` without a roll change on the result (Hold Them Off, Kick, Diminish My Foes);
 * `whenYouDealDamage` (Marked for Death's extra damage); `whenTargetMarksHp` and `whenEnemyTakesDamage` by you after the
 * damage (Death Strike, Ruthless Predator's Severe Stress).
 */
export function riderPhase(trigger: Trigger, host: Host, use: CardUse): RiderPhase | null {
  const matches = (filter: RollFilter) => rollMatches(filter, host.spec) || (host.trait !== undefined && filter === host.trait);
  switch (trigger.kind) {
    case "beforeYouRoll":
      return trigger.roll === "damage" || matches(trigger.roll) ? "before" : null;
    case "whenYouAttack":
      if (trigger.weapon === true && !host.weapon) return null;
      if (trigger.weaponRange !== undefined && host.weaponRange !== trigger.weaponRange) return null;
      return "after";
    case "afterYouRoll":
      return trigger.roll !== "damage" && matches(trigger.roll) && !changesRoll(use.steps) ? "after" : null;
    case "whenYouDealDamage":
      return "after";
    case "whenTargetMarksHp":
      return "damage";
    case "whenEnemyTakesDamage":
      return trigger.byYou === true ? "damage" : null;
    default:
      return null;
  }
}

/** Whether the trigger's result filter holds for the attack's roll (a critical is a success with Hope, CB p.90). */
export function resultHolds(trigger: Trigger, roll: HostRoll): boolean {
  const result = trigger.kind === "whenYouAttack" || trigger.kind === "afterYouRoll" || trigger.kind === "afterAllyRolls" ? trigger.result : undefined;
  switch (result) {
    case undefined:
    case "any":
      return true;
    case "success":
      return roll.success;
    case "failure":
      return !roll.success;
    case "critical":
      return roll.critical;
    case "successWithHope":
      return roll.success && roll.withHope;
    case "successWithFear":
      return roll.success && roll.withFear;
    case "withHope":
      return roll.withHope;
    case "withFear":
      return roll.withFear;
  }
}

/** A rider ready to run: the card or feature, its use, its trigger and phase, the player's choices. */
export type PickedRider = {
  source: "card" | "feature";
  id: string;
  useId: string;
  name: string;
  trigger: Trigger;
  phase: RiderPhase;
  choices: CardChoice[];
  /** An automatic use (no click): skipped quietly when it can't run (exhausted, unaffordable, a condition not met). */
  auto: boolean;
};

/** Features whose automatic use the attack applies another way (Sneak Attack: the D5 damage option, from positions, Q9). */
const AUTO_ELSEWHERE: ReadonlySet<string> = new Set(["class:rogue:sneak-attack"]);

/** The rider uses of a card entry or a feature entry (with its upgrades). */
function riderUses(uses: readonly CardUse[], host: Host, kinds: readonly ("rider" | "auto")[]): { use: CardUse; trigger: Trigger; phase: RiderPhase }[] {
  const out: { use: CardUse; trigger: Trigger; phase: RiderPhase }[] = [];
  for (const use of uses) {
    const a = use.activation;
    if ((a.kind !== "rider" && a.kind !== "auto") || !kinds.includes(a.kind)) continue;
    const phase = riderPhase(a.trigger, host, use);
    if (phase !== null) out.push({ use, trigger: a.trigger, phase });
  }
  return out;
}

/** The features a sheet holds with their upgraded entries. */
function heldEntries(sheet: CharacterSheet, campaign: Doc<"campaigns">): { feature: OwnedFeature; entry: FeatureEffect }[] {
  const held = ownedHere(sheet, campaign);
  const out: { feature: OwnedFeature; entry: FeatureEffect }[] = [];
  for (const feature of held) {
    if (feature.usage === "outOfCombat" || feature.usage === "narrative") continue;
    const entry = featureEffect(feature.featureId);
    if (entry === undefined) continue;
    out.push({ feature, entry: applyUpgrades(entry, holdingsFor(sheet, held, entry.owner)) });
  }
  return out;
}

/**
 * The riders the player sent, checked: the card in the loadout or the feature held (CARD_NOT_IN_LOADOUT,
 * FEATURE_NOT_OWNED), a use with activation `rider` whose trigger rides on this attack (INVALID otherwise), each once
 * (CB p.107: "you can't spend Hope or mark Stress multiple times on the same feature … on the same roll").
 */
export function pickRiders(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host, riders: readonly Rider[]): PickedRider[] {
  if (riders.length > MAX_RIDERS_PER_ATTACK) throw appError("INVALID", `At most ${MAX_RIDERS_PER_ATTACK} riders.`);
  const seen = new Set<string>();
  const out: PickedRider[] = [];
  const held = riders.some((r) => r.source === "feature") ? heldEntries(sheet, campaign) : [];
  for (const r of riders) {
    let uses: readonly CardUse[];
    let name: string;
    if (r.source === "card") {
      if (!sheet.domainCards.loadout.includes(r.id)) throw appError("CARD_NOT_IN_LOADOUT");
      const effect = cardEffect(r.id);
      if (effect === undefined) throw appError("CARD_NOT_COMBAT");
      uses = effect.uses;
      name = getDomainCard(r.id)?.name ?? r.id;
    } else {
      const found = held.find((h) => h.feature.featureId === r.id);
      if (found === undefined) throw appError("FEATURE_NOT_OWNED");
      uses = found.entry.uses;
      name = found.feature.name;
    }
    const candidates = riderUses(uses, host, ["rider"]);
    const hit = r.useId === undefined ? candidates[0] : candidates.find((c) => c.use.id === r.useId);
    if (hit === undefined) throw appError("INVALID", `${name} doesn't ride on this attack.`);
    const key = `${r.source}:${r.id}:${hit.use.id}`;
    if (seen.has(key)) throw appError("INVALID", `${name} applies once per attack (CB p.107).`);
    seen.add(key);
    out.push({ source: r.source, id: r.id, useId: hit.use.id, name: hit.use.name === name ? name : hit.use.name, trigger: hit.trigger, phase: hit.phase, choices: [...r.choices], auto: false });
  }
  return out;
}

/** The automatic uses that ride on this attack: First Strike, Face Your Fear, Pummeljoy, Marked for Death's damage... */
export function autoRiders(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host): PickedRider[] {
  const out: PickedRider[] = [];
  for (const { feature, entry } of heldEntries(sheet, campaign)) {
    if (AUTO_ELSEWHERE.has(feature.featureId)) continue;
    for (const { use, trigger, phase } of riderUses(entry.uses, host, ["auto"])) {
      out.push({ source: "feature", id: feature.featureId, useId: use.id, name: use.name, trigger, phase, choices: [], auto: true });
    }
  }
  return out;
}

// ---- the Attack bar's rider toggles

/** One rider the Attack bar offers (the character's own sheet only, U1). */
export const riderOptionValidator = v.object({
  source: v.union(v.literal("card"), v.literal("feature")),
  id: v.string(),
  useId: v.string(),
  name: v.string(),
  phase: v.union(v.literal("before"), v.literal("after"), v.literal("damage")),
  /** When it applies, in words ("Before the roll", "On a success"). */
  when: v.string(),
  ready: v.boolean(),
  resetLabel: v.union(v.null(), v.string()),
  /** Cost badges ("3 Hope", "1 Stress"). */
  costs: v.array(v.string()),
  limit: v.union(v.null(), v.string()),
  /** Numbers the player picks (`n:<id>` choices): Rage Up's times, Surrounded's Hope. */
  numbers: v.array(v.object({ id: v.string(), label: v.string(), min: v.number(), max: v.union(v.null(), v.number()) })),
  /** Options of its choose steps (`opt:<id>` choices): Elementalist's roll or damage, Kick's knock back. */
  options: v.array(v.object({ id: v.string(), label: v.string(), options: v.array(v.object({ id: v.string(), label: v.string() })) })),
  /** Situations the player confirms (Q13); the ones the map decides are not listed. */
  situations: v.array(v.string()),
  /** NV18: more targets with the same roll (`picked` choice): at most `max` (null: as many as the number picked), within `range`. */
  addTargets: v.union(v.null(), v.object({ max: v.union(v.null(), v.number()), range: v.string() })),
});
export type RiderOption = Infer<typeof riderOptionValidator>;

const RESULT_WORDS: Record<string, string> = {
  any: "After the roll",
  success: "On a success",
  failure: "On a failure",
  critical: "On a critical success",
  successWithHope: "On a success with Hope",
  successWithFear: "On a success with Fear",
  withHope: "With Hope",
  withFear: "With Fear",
};

function whenText(trigger: Trigger, phase: RiderPhase): string {
  if (phase === "before") return trigger.kind === "beforeYouRoll" && trigger.roll === "damage" ? "On the damage roll" : "Before the roll";
  if (phase === "damage") return trigger.kind === "whenTargetMarksHp" && trigger.severity === "severe" ? "On Severe damage" : "When the target marks Hit Points";
  if (trigger.kind === "whenYouAttack" || trigger.kind === "afterYouRoll") return RESULT_WORDS[trigger.result ?? "any"] ?? "After the roll";
  return "When you deal damage";
}

/** Every step of a list, nested ones included. */
function allSteps(steps: readonly Step[]): Step[] {
  return steps.flatMap((s) => [
    s,
    ...(s.kind === "optional" || s.kind === "followUp" ? allSteps(s.steps) : []),
    ...(s.kind === "choose" ? s.options.flatMap((o) => allSteps(o.steps)) : []),
    ...(s.kind === "save" ? [...allSteps(s.onFail), ...allSteps(s.onSuccess)] : []),
    ...(s.kind === "check" ? [...allSteps(s.then), ...allSteps(s.otherwise)] : []),
  ]);
}

function optionOf(source: "card" | "feature", id: string, name: string, use: CardUse, trigger: Trigger, phase: RiderPhase, availability: { state: string; label?: string }): RiderOption {
  const steps = allSteps(use.steps);
  const add = steps.find((s): s is Extract<Step, { kind: "addTargets" }> => s.kind === "addTargets");
  return {
    source,
    id,
    useId: use.id,
    name: use.name === name ? name : use.name,
    phase,
    when: whenText(trigger, phase),
    ready: availability.state === "ready",
    resetLabel: availability.state === "exhausted" ? (availability.label ?? null) : null,
    costs: (use.costs ?? []).map(costText),
    limit: use.limit ? limitText(use.limit) : null,
    numbers: (use.choices ?? []).map((c) => ({ id: `n:${c.id}`, label: c.label, min: c.min, max: c.max?.kind === "fixed" ? c.max.value : null })),
    options: steps.flatMap((st) => (st.kind === "choose" ? [{ id: `opt:${st.id}`, label: st.label, options: st.options.map((o) => ({ id: o.id, label: o.label })) }] : [])),
    situations: (use.requires ?? []).flatMap((r) => (r.kind === "situation" && r.check === undefined && MAP_SITUATIONS[r.text] === undefined ? [r.text] : [])),
    addTargets: add ? { max: add.count.kind === "fixed" ? add.count.value : null, range: add.targets.range } : null,
  };
}

/**
 * The riders the Attack bar lists for an attack (`host`): the rider uses of the loadout's cards (Rage Up) and of the
 * features the sheet holds (Hold Them Off, Kick, Elementalist...), whose trigger rides on this attack.
 */
export function riderOptions(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host): RiderOption[] {
  const out: RiderOption[] = [];
  for (const cardId of sheet.domainCards.loadout) {
    const effect = cardEffect(cardId);
    if (effect === undefined || cardUsage(cardId) === "outOfCombat") continue;
    const name = getDomainCard(cardId)?.name ?? cardId;
    for (const { use, trigger, phase } of riderUses(effect.uses, host, ["rider"])) {
      out.push(optionOf("card", cardId, name, use, trigger, phase, keyAvailability(sheet, featureUseKey(cardId, use.id), use.limit)));
    }
  }
  const held = ownedHere(sheet, campaign);
  for (const { feature, entry } of heldEntries(sheet, campaign)) {
    const raw = featureEffect(feature.featureId)!;
    const holdings = holdingsFor(sheet, held, raw.owner);
    for (const { use, trigger, phase } of riderUses(entry.uses, host, ["rider"])) {
      out.push(optionOf("feature", feature.featureId, feature.name, use, trigger, phase, featureAvailability(sheet, raw, use.id, { holdings })));
    }
  }
  return out;
}

/** The stored roll options of a sanction or a held attack (every field optional, AA0's shape) as the attack's arguments. */
export function rollFromStored(roll: Infer<typeof sanctionRollOptionsValidator>): AttackRoll {
  return {
    ...(roll.trait !== undefined ? { trait: roll.trait } : {}),
    modifier: roll.modifier ?? 0,
    experienceIds: roll.experienceIds ?? [],
    advantage: roll.advantage ?? 0,
    disadvantage: roll.disadvantage ?? 0,
    help: roll.help ?? 0,
    options: roll.options ?? [],
    ...(roll.damageOptions !== undefined ? { damageOptions: roll.damageOptions } : {}),
    ...(roll.slayerDice !== undefined ? { slayerDice: roll.slayerDice } : {}),
    ...(roll.tideTokens !== undefined ? { tideTokens: roll.tideTokens } : {}),
  };
}

// ---- running one part of a rider

/** Situations the map decides for a rider (Q13: the player confirms only what the engine can't see). */
type SituationCheck = (s: AttackScene, target: CheckedTarget | undefined, host: Host) => boolean;
const MAP_SITUATIONS: Readonly<Record<string, SituationCheck>> = {
  // Kick (CB p.58), Tusks (CB p.68): "a target within Melee range".
  "The target is within Melee range": (s, target) => target !== undefined && rangeCheck(s.attacker, target.token, "melee").inRange,
  // Surrounded (HF p.10): "When you make an attack with a Melee weapon".
  "You make this attack with a Melee weapon": (_s, _t, host) => host.weaponRange === "melee",
};

/** The situations a rider's run confirms: the player's, with the ones the map decides replaced by the map's answer. */
function situationsFor(choices: ParsedChoices, s: AttackScene, target: CheckedTarget | undefined, host: Host): string[] {
  const own = choices.situations.filter((text) => MAP_SITUATIONS[text] === undefined);
  const decided = Object.entries(MAP_SITUATIONS).flatMap(([text, check]) => (check(s, target, host) ? [text] : []));
  return [...own, ...decided];
}

/** What NV7 checks read about a creature (`hasCondition` on the target: Apex Predator's Focus). */
function creatureFacts(instance: Doc<"encounterAdversaries">) {
  return { conditions: instance.conditions, tags: instance.tags, hp: instance.hp, hpMax: instance.stats.hpMax };
}

export type RiderEnv = {
  ctx: MutationCtx;
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  scene: AttackScene;
  host: Host;
  gmFear: number;
  rng: Rng;
  rollUsedExperience: boolean;
};

export type RiderRun = { rider: PickedRider; plan: RunPlan; built: BuiltRun; name: string; sheet: CharacterSheet };

/** `whole`: the full use with its move gates bound (a damage-phase rider runs once, after the damage). */
type RunPart = RiderPart | "whole";

/**
 * Runs one part of a rider on the actor's sheet now (`sheet`) against the attack's targets (`tokenIds`), with the server's
 * dice. Nothing is written: the caller writes the plan. A part with nothing to run is "empty". A refusal throws (an
 * automatic use's is null: it just doesn't happen). A `choose` the player didn't answer is INVALID.
 */
export async function runRiderPart(env: RiderEnv, rider: PickedRider, sheet: CharacterSheet, part: RunPart, roll: HostRoll | null, tokenIds: readonly string[], target: CheckedTarget | undefined, subject?: string): Promise<RiderRun | "empty" | null> {
  const before = rider.phase === "before";
  const transform = (use: CardUse): CardUse => (part === "whole" ? { ...use, steps: roll ? bindGates(use.steps, roll) : use.steps } : riderUse(use, part, before, roll));
  try {
    let pick: UsePick;
    if (rider.source === "feature") {
      const facts = target ? { target: creatureFacts(target.instance) } : {};
      pick = pickFeature({ sheet, campaign: env.campaign, featureId: rider.id, useId: rider.useId, times: 1, rollUsedExperience: env.rollUsedExperience, party: [], transform, extraFacts: facts });
    } else {
      const base = pickCard(sheet, rider.id, rider.useId);
      const use = transform(base.use);
      pick = { ...base, use, effect: { ...base.effect, uses: base.effect.uses.map((u) => (u.id === use.id ? use : u)) } };
    }
    if (part !== "whole" && !riderPartRuns(pick.use, part)) return "empty";
    const choices = parseChoices(rider.choices);
    choices.situations = situationsFor(choices, env.scene, target, env.host);
    // The extra targets of an addTargets rider are checked by the attack itself (`addedTargets`), not as picked creatures.
    choices.picked = [];
    if (subject !== undefined) choices.triggerSubject = subject;
    const built = await buildRun(env.ctx, {
      campaign: env.campaign,
      character: env.character,
      sheet,
      scene: env.scene,
      pick,
      targetTokenIds: tokenIds,
      choices,
      roll: {},
      gmFear: env.gmFear,
      lastRollWithHope: false,
    });
    const outcome = runCard(built, pick, env.rng);
    if (outcome.kind === "needsChoice") throw appError("INVALID", `${rider.name}: ${outcome.asks.map((a) => a.label).join(", ")}.`);
    const start = outcome.delegated?.sheet ?? built.paidSheet;
    return { rider, plan: outcome.plan, built, name: pick.name, sheet: actorSheetAfter(start, outcome.plan, built.context.actor.id, pick.name) };
  } catch (e) {
    if (rider.auto && e instanceof ConvexError) return null;
    throw e;
  }
}

// ---- folding riders into the attack

/** What the riders change on the attack itself. */
export type Folds = {
  /** Added to the attack roll ("+2 to the roll"). */
  modifier: number;
  advantage: number;
  /** Added to the damage total ("an extra 2d6 damage", Rage Up's twice your Strength). */
  damageAdd: number;
  /** Added damage of another type (Face Your Fear's magic damage). */
  addTypes: DamageType[];
  /** Proficiency for this attack's damage roll (Ruthless Predator, Pummeljoy). */
  proficiency: number;
  /** "double damage" (First Strike, HF p.8). */
  multiply: number;
  minimumSeverity?: "minor" | "major" | "severe";
  /** "mark an additional Hit Point" after the thresholds (Thrive in Chaos, NV4). */
  extraHp: number;
  /** The same roll against more creatures (NV18). */
  addTargets: { rider: PickedRider; count: number; spec: TargetSpec; damage: "same" | "half" }[];
  /** What a rider does that the attack can't fold in, for the feed. */
  unsupported: string[];
};

export function emptyFolds(): Folds {
  return { modifier: 0, advantage: 0, damageAdd: 0, addTypes: [], proficiency: 0, multiply: 1, extraHp: 0, addTargets: [], unsupported: [] };
}

/** Folds a rider plan's `fold` steps into the attack. */
export function foldInto(folds: Folds, run: RiderRun): void {
  for (const s of run.plan.steps) {
    if (s.kind !== "fold") continue;
    const step = s.step;
    const amount = typeof s.amount === "number" ? s.amount : 0;
    if (step.kind === "modifyDamage") {
      // A change gated to some targets (Marked for Death's "against your Marked target") with none left doesn't apply.
      if (step.to === "targets" && s.targetIds.length === 0) continue;
      const ch = step.change;
      if (ch.kind === "add") {
        folds.damageAdd += amount;
        if (ch.type) folds.addTypes.push(ch.type);
      } else if (ch.kind === "proficiency") folds.proficiency += ch.delta;
      else if (ch.kind === "multiply") folds.multiply *= ch.factor;
      else if (ch.kind === "minimumSeverity") folds.minimumSeverity = ch.severity;
      else folds.unsupported.push(`${run.name}: ${ch.kind}`);
    } else if (step.kind === "modifyRoll") {
      const ch = step.change;
      if (ch.kind === "add") folds.modifier += amount;
      else if (ch.kind === "advantage") folds.advantage += 1;
      else folds.unsupported.push(`${run.name}: ${ch.kind}`);
    } else if (step.kind === "addTargets") {
      folds.addTargets.push({ rider: run.rider, count: amount, spec: step.targets, damage: step.damage ?? "same" });
    } else if (step.kind === "adjustHpMarked") {
      folds.extraHp += (step.change === "more" ? 1 : -1) * amount;
    }
  }
}

/**
 * NV18 (Hold Them Off, CB p.38: "use that same roll against two additional adversaries within range of the attack";
 * Surrounded, HF p.10): the creatures the rider's `picked` choice names, at most its count, each an enemy token the
 * attacker sees with a clear line (COMBAT_NO_LINE_OF_SIGHT), of an undefeated instance of the attack's encounter, not
 * already a target, and within the rider's range (COMBAT_TARGET_INVALID otherwise; an added target never waits for the GM).
 */
async function addedTargets(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon, add: Folds["addTargets"][number], taken: ReadonlySet<string>, encounterId: Id<"encounters">): Promise<CheckedTarget[]> {
  const ids = parseChoices(add.rider.choices).picked;
  if (ids.length > add.count || new Set(ids).size !== ids.length) throw appError("COMBAT_TARGET_INVALID", `${add.rider.name}: at most ${add.count} more target(s).`);
  const range = add.spec.range === "weapon" ? rangeFromWeapon(weapon.range) : add.spec.range;
  const out: CheckedTarget[] = [];
  for (const id of ids) {
    const index = s.scene.tokens.findIndex((t) => t._id === id);
    if (index < 0 || index === s.viewer.index || taken.has(id)) throw appError("COMBAT_TARGET_INVALID");
    const token = s.scene.tokens[index]!;
    if (!seenBy(s, index)) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const sight = sightTo(s, token);
    if (!sight.lineOfSight) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const linked = await enemyInstance(ctx, campaign._id, token);
    if (linked === null || linked.encounter._id !== encounterId) throw appError("COMBAT_TARGET_INVALID");
    const check = rangeCheck(s.attacker, token, range);
    if (!check.inRange) throw appError("COMBAT_TARGET_INVALID", `${add.rider.name}: a target is out of range.`);
    out.push({ token, ...linked, check, sight });
  }
  return out;
}

// ---- Sneak Attack and Cloaked (Q9)

/**
 * Q9 (a), CB p.42: "When you succeed on an attack while Cloaked or while an ally is within Melee range of your target, add a
 * number of d6s equal to your tier to your damage roll." The map decides: the attacker is Cloaked, or another PC's or an
 * ally's token is within Melee range of a target. It adds (not optional), so the player's tick is ignored.
 */
export function sneakAttackApplies(sheet: CharacterSheet, s: AttackScene, targets: readonly CheckedTarget[]): boolean {
  if (sheet.conditions.includes("cloaked")) return true;
  return s.scene.tokens.some((t, i) => i !== s.viewer.index && (t.side === "pc" || t.side === "ally") && targets.some((target) => rangeCheck(t, target.token, "melee").inRange));
}

const SNEAK_ATTACK = "sneakAttack";

/** The damage roll's D5 options with Sneak Attack decided by the map (only where the sheet's class offers it). */
function damageOptionsFor(sheet: CharacterSheet, campaign: Doc<"campaigns">, chosen: readonly string[], sneak: boolean): string[] {
  const offered = rollOptions(sheet, "damage", CLASS_FEATURES, featureScope(campaign)).some((o) => o.key === SNEAK_ATTACK);
  const rest = chosen.filter((k) => k !== SNEAK_ATTACK);
  return offered && sneak ? [...rest, SNEAK_ATTACK] : rest;
}

/** CB p.42: "After you make an attack … you are no longer Cloaked." */
function uncloaked(sheet: CharacterSheet): CharacterSheet {
  return sheet.conditions.includes("cloaked") ? { ...sheet, conditions: sheet.conditions.filter((c) => c !== "cloaked") } : sheet;
}

// ---- the after-roll step (Q1)

/** An after-roll feature the attacker may use on the held roll, as the player sees it. */
export const afterRollOfferValidator = v.object({ featureId: v.string(), useId: v.string(), name: v.string(), costs: v.array(v.string()) });
export type AfterRollOffer = Infer<typeof afterRollOfferValidator>;

/** An attack held after its roll (Q1): the player's own dice and Hit / Miss per target, and the features on offer (U1). */
export const awaitingAttackValidator = v.object({
  status: v.literal("awaiting"),
  requestId: v.id("combatRequests"),
  roll: rollValidator,
  targets: v.array(v.object({ tokenId: v.id("combatTokens"), hit: v.boolean() })),
  options: v.array(afterRollOfferValidator),
});
export type AwaitingAttack = Infer<typeof awaitingAttackValidator>;

/** The roll change an after-roll use makes (its `modifyRoll` step), or null when it makes none the attack can apply. */
export function afterRollChangeOf(use: CardUse): AfterRollChange | null {
  for (const step of use.steps) {
    if (step.kind !== "modifyRoll") continue;
    const ch = step.change;
    switch (ch.kind) {
      case "reroll":
        if (ch.dice === "all") return { kind: "reroll", ...(ch.advantage ? { advantage: true } : {}) };
        if (ch.dice === "hope" && ch.ifAtMost !== undefined) return { kind: "reroll", hopeAtMost: ch.ifAtMost };
        return null;
      case "withHope":
        return { kind: "withHope" };
      case "setOutcome":
        return { kind: "outcome", outcome: ch.outcome };
      case "add":
        return { kind: "add", amount: 0 };
      default:
        return null;
    }
  }
  return null;
}

/** Whether a trigger is the actor's own finished roll (`afterYouRoll` this attack, or `afterAllyRolls` with "you or an ally"). */
function ownRollTrigger(trigger: Trigger, host: Host): boolean {
  if (trigger.kind === "afterAllyRolls") return trigger.includeSelf === true;
  if (trigger.kind !== "afterYouRoll" || trigger.roll === "damage") return false;
  return rollMatches(trigger.roll, host.spec) || (host.trait !== undefined && trigger.roll === host.trait);
}

/**
 * Q1 (a), CB p.107 "Using Features After a Roll": the after-roll features the attacker holds that are ready, affordable and
 * whose trigger fits this roll (Patron's Boon and True Strike on a failure, Fearless and Unbound with Fear, Internal Compass
 * on a 1 on the Hope Die, Luckbender, Prayer Dice, Adaptability when an Experience was used, Ranger's Focus against the
 * Focus). `sheet` is the sheet after the roll's gains: the Hope this roll gave can pay a Hope feature (CB p.90).
 */
export function afterRollOffers(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host, roll: RollRecord, hostRoll: HostRoll, target: CheckedTarget | undefined, rollUsedExperience: boolean): AfterRollOffer[] {
  const offers: AfterRollOffer[] = [];
  const hopeDie = roll.dice.find((d) => d.role === "hope")?.value ?? 0;
  const actor = { ...cardActor("self", sheet, "", undefined), ...actorExtras(sheet) };
  const facts = { ...factsOf(sheet, rollUsedExperience), ...(target ? { target: creatureFacts(target.instance) } : {}) };
  const state = { hp: sheet.hp, hpMax: sheet.hpMax, stress: sheet.stress, stressMax: sheet.stressMax, armor: sheet.armorMarked, hope: sheet.hope, armorWorn: actor.armorWorn, loadoutDomains: actor.loadoutDomains, activeCardEffects: actor.activeCardEffects, situations: [], facts };
  const held = ownedHere(sheet, campaign);
  for (const feature of held) {
    const entry = featureEffect(feature.featureId);
    if (entry === undefined) continue;
    const holdings = holdingsFor(sheet, held, entry.owner);
    const upgraded = applyUpgrades(entry, holdings);
    for (const use of upgraded.uses) {
      const a = use.activation;
      if ((a.kind !== "reaction" && a.kind !== "rider") || !ownRollTrigger(a.trigger, host) || !resultHolds(a.trigger, hostRoll)) continue;
      const change = afterRollChangeOf(use);
      if (change === null) continue;
      if (change.kind === "reroll" && change.hopeAtMost !== undefined && hopeDie > change.hopeAtMost) continue;
      if (change.kind === "outcome" && hostRoll.success) continue;
      if (featureAvailability(sheet, entry, use.id, { holdings }).state !== "ready") continue;
      if (featureCostShort(actor, use, Object.fromEntries((use.choices ?? []).map((c) => [c.id, c.min]))).length > 0) continue;
      const pools = (use.costs ?? []).flatMap((c) => (c.kind === "tokens" && c.pool !== undefined && c.pool !== "card" && c.pool !== "favor" && c.pool !== "focus" ? [c.pool] : []));
      if (pools.some((p) => !(actor.heldDice ?? []).some((d) => d.kind === p))) continue;
      // A condition the engine knows to be false leaves the feature out; one it can't read is the player's to confirm.
      const refused = (use.requires ?? []).some((r) => (r.kind === "situation" ? (r.check ? stateCheckMet(r.check, state) === false : false) : !requirementMet(r, state)));
      if (refused) continue;
      offers.push({ featureId: feature.featureId, useId: use.id, name: use.name, costs: (use.costs ?? []).map(costText) });
    }
  }
  return offers;
}

/** A Duality roll's outcome from its dice (no Difficulty: an attack's success is its hits, R1). */
function outcomeFrom(hope: number, fear: number): RollRecord["outcome"] {
  return actionOutcome(hope, fear, 0, undefined);
}

/** Recomputes a roll record's total from its dice (the dropped ones don't count). */
function retotal(record: RollRecord): RollRecord {
  return { ...record, total: record.dice.reduce((s, d) => s + (d.dropped ? 0 : d.value), 0) + record.modifier };
}

/**
 * The roll after an after-roll change (CB p.107: "When a feature allows you to reroll a die, you always take the new
 * result"): Internal Compass rerolls the Hope Die, Fearless / Unbound make it with Hope, Prayer Dice add their value. A full
 * reroll (`reroll` without `hopeAtMost`) is rolled by the caller. `forced`: the roll counts as a success against every
 * target (True Strike, Witch's Charm).
 */
function changedRecord(roll: RollRecord, change: AfterRollChange, rng: Rng): { roll: RollRecord; forced: boolean } {
  switch (change.kind) {
    case "reroll": {
      const dice = roll.dice.map((d) => (d.role === "hope" && change.hopeAtMost !== undefined && d.value <= change.hopeAtMost ? { ...d, value: rng(d.sides) } : d));
      const next = retotal({ ...roll, dice });
      const hope = dice.find((d) => d.role === "hope")?.value ?? 0;
      const fear = dice.find((d) => d.role === "fear")?.value ?? 0;
      return { roll: { ...next, outcome: outcomeFrom(hope, fear) }, forced: false };
    }
    case "withHope": {
      const outcome = roll.outcome === "successFear" ? "successHope" : roll.outcome === "failFear" ? "failHope" : roll.outcome;
      return { roll: { ...roll, outcome }, forced: false };
    }
    case "outcome": {
      const outcome = change.outcome === "successWithFear" ? "successFear" : change.outcome === "successWithHope" ? "successHope" : roll.outcome === "failFear" ? "successFear" : roll.outcome === "failHope" ? "successHope" : roll.outcome;
      return { roll: { ...roll, outcome }, forced: true };
    }
    case "add":
      return { roll: { ...roll, modifier: roll.modifier + change.amount, total: roll.total + change.amount }, forced: false };
  }
}

// ---------------------------------------------------------------- resolving

/**
 * Onslaught (Blade 10, CB p.330; Blade table's `floor` use, CA4b): "When you successfully make an attack with your weapon,
 * you never deal damage beneath a target's Major damage threshold (the target always marks a minimum of 2 Hit Points)."
 * While the card is in the loadout, a weapon hit that deals damage marks at least Major (2 HP); no damage stays none.
 */
function hasOnslaught(sheet: CharacterSheet): boolean {
  return sheet.domainCards.loadout.includes("onslaught");
}

/** A die source that records what it draws, so a held attack replays the same dice. */
export function recorder(base: Rng): { rng: Rng; values: number[] } {
  const values: number[] = [];
  return {
    values,
    rng: (sides) => {
      const n = base(sides);
      values.push(n);
      return n;
    },
  };
}

/** Applies a change of the GM's Fear (a gain through `gainFear`, a loss through `spendFear`); returns what changed. */
export async function changeFear(ctx: MutationCtx, campaignId: Id<"campaigns">, delta: number): Promise<number> {
  if (delta > 0) return (await gainFear(ctx, campaignId, delta)).gained;
  if (delta < 0) {
    const state = await campaignFearState(ctx, campaignId);
    const lost = Math.min(state.fear, -delta);
    if (lost > 0) await spendFear(ctx, campaignId, lost, "feature");
    return -lost;
  }
  return 0;
}

type TargetResult = { target: CheckedTarget; hit: boolean; defeated: boolean; severity: DamageResult["severity"] | "none"; hpMarked: number; half: boolean };

/**
 * Resolves a weapon attack in one mutation (U4): the riders before the roll (their costs, the roll and damage they add),
 * the Duality roll (Hope, Stress, GM Fear, countdown ticks, as `actionRoll`), the after-roll step (Q1: an attack held for an
 * after-roll feature returns `awaiting` and writes nothing), hit or miss per target, the riders on the result and the
 * automatic ones (Sneak Attack from positions, Q9), one damage roll on any hit, damage marked on each instance hit (and on
 * the targets a rider added, NV18), the riders' effects on the creatures, the riders after the damage (Death Strike),
 * Cloaked ended (CB p.42), a Minion offer, and one actionLog group: a public row (the roll, the damage dice and total,
 * Hit / Miss / Defeated per target, the riders' names) and GM rows (damage, severity, HP per target, `adversaryBefore`).
 */
export async function resolveAttack(ctx: MutationCtx, req: AttackRequest): Promise<ResolvedAttack | AwaitingAttack> {
  const { loaded, weapon, slot, roll: options } = req;
  const { campaign, character } = loaded;
  const sheet0 = loaded.sheet;
  const rec = recorder(req.held ? replaying(req.held.dice, rollDie) : rollDie);
  const host = hostOf(weapon, slot, options.trait);
  const env: RiderEnv = {
    ctx,
    campaign,
    character,
    scene: req.scene,
    host,
    gmFear: (await campaignFearState(ctx, campaign._id)).fear,
    rng: rec.rng,
    rollUsedExperience: options.experienceIds.length > 0,
  };
  const picked = pickRiders(sheet0, campaign, host, req.riders ?? []);
  const autos = autoRiders(sheet0, campaign, host);
  const folds = emptyFolds();
  const runs: RiderRun[] = [];
  const allTargets: CheckedTarget[] = [...req.targets];
  const main = req.targets[0];
  /** Riders whose trigger held: their `post` parts run after the damage. */
  const used: PickedRider[] = [];
  /** Targets a rider added that take half the damage (Cannonball's "half damage", NV18). */
  const halfDamage = new Map<string, boolean>();
  let sheet = sheet0;

  // ---- riders before the roll (Rage Up, Elementalist, Surrounded): costs, limits, what they add
  for (const r of [...picked, ...autos].filter((x) => x.phase === "before")) {
    const run = await runRiderPart(env, r, sheet, "pre", null, req.targets.map((t) => t.token._id), main);
    if (run === null) continue;
    used.push(r);
    if (run === "empty") continue;
    sheet = run.sheet;
    foldInto(folds, run);
    runs.push(run);
  }
  for (const add of folds.addTargets.splice(0)) allTargets.push(...(await addedTargets(ctx, campaign, req.scene, weapon, add, new Set(allTargets.map((t) => t.token._id)), main!.encounter._id)));

  // ---- the roll (R1, R9); cover gives one disadvantage (Q2)
  const cover = allTargets.some((t) => t.sight.cover);
  const args = attackDuality(weapon, { ...options, modifier: options.modifier + folds.modifier, advantage: options.advantage + folds.advantage }, cover);
  const sheetBeforeRoll = sheet;
  const dualityAt = rec.values.length;
  const duality = await resolveDuality(ctx, { ...loaded, sheet: sheetBeforeRoll }, args, rec.rng, false);
  let roll = duality.roll;
  let effects = duality.effects;
  let rolled = duality.rolled;
  let forced = false;
  let finalSheet = duality.next;
  const hitsOf = (r: RollRecord) => resolveHits(r.total, r.outcome === "critical", allTargets.map((t) => ({ id: t.token._id, difficulty: difficultyOf(t.instance) })));
  let hits = hitsOf(roll);
  const hostRollOf = (r: RollRecord, h: readonly { hit: boolean }[]): HostRoll => {
    const critical = r.outcome === "critical";
    return { success: forced || h.some((x) => x.hit), critical, withHope: critical || r.outcome === "successHope" || r.outcome === "failHope", withFear: r.outcome === "successFear" || r.outcome === "failFear" };
  };

  // ---- the after-roll step (Q1): hold the attack when an after-roll feature is ready and affordable
  let afterRun: RiderRun | null = null;
  if (req.held === undefined) {
    const offers = afterRollOffers(duality.next, campaign, host, roll, hostRollOf(roll, hits), main, env.rollUsedExperience);
    if (offers.length > 0) {
      const requestId = await openAfterRoll(ctx, {
        campaignId: campaign._id,
        encounterId: main!.encounter._id,
        mapId: req.scene.map._id,
        createdBy: req.actorId,
        payload: {
          schemaVersion: 1,
          kind: "afterRoll",
          characterId: character._id,
          action: { kind: "attack", slot, targetTokenIds: req.targets.map((t) => t.token._id), roll: options, ...(req.riders && req.riders.length > 0 ? { riders: [...req.riders] } : {}) },
          dice: rec.values.slice(0, MAX_HELD_DICE),
          dualityAt,
          roll,
          hits: allTargets.map((t, i) => ({ tokenId: t.token._id, hit: hits[i]!.hit })),
          options: offers.map((o) => ({ featureId: o.featureId, useId: o.useId })),
        },
      });
      return { status: "awaiting", requestId, roll, targets: allTargets.map((t, i) => ({ tokenId: t.token._id, hit: hits[i]!.hit })), options: offers };
    }
  } else if (req.held.answer.kind === "use") {
    // CB p.90: the Hope this roll gave can pay a Hope feature; the roll is then changed (or rerolled), so its own Hope is
    // taken back and the final roll's Hope, Stress and Fear apply (CB p.107: the new result stands).
    const answer = req.held.answer;
    const payer = applyDualityEffects(duality.paid, { hope: effects.hope, clearStress: 0, fear: 0 });
    const gave = payer.hope - duality.paid.hope;
    const rider: PickedRider = { source: "feature", id: answer.featureId, useId: answer.useId ?? "main", name: answer.featureId, trigger: { kind: "afterYouRoll", roll: "any" }, phase: "after", choices: answer.choices, auto: false };
    const entry = featureEffect(answer.featureId);
    const use = entry?.uses.find((u) => u.id === rider.useId);
    if (entry === undefined || use === undefined) throw appError("INVALID");
    const spec = use.targets && use.targets.side !== "trigger" ? use.targets : undefined;
    const ownChoices = (use.choices ?? []).filter((c) => !answer.choices.some((x) => x.id === `n:${c.id}`)).map((c) => ({ id: `n:${c.id}`, value: c.min }));
    rider.choices = [...answer.choices, ...ownChoices];
    const ran = await runRiderPart(env, rider, payer, "whole", null, spec ? req.targets.map((t) => t.token._id) : [], main, req.scene.attacker._id);
    if (ran === null || ran === "empty") throw appError("INVALID");
    afterRun = ran;
    const fold = afterRun.plan.steps.find((s): s is Extract<PlanStep, { kind: "fold" }> => s.kind === "fold" && s.step.kind === "modifyRoll");
    let change = afterRollChangeOf(use);
    if (change === null) throw appError("INVALID", "That feature doesn't change this roll.");
    if (change.kind === "add") change = { kind: "add", amount: fold && typeof fold.amount === "number" ? fold.amount : 0 };
    const base = { ...afterRun.sheet, hope: Math.max(0, afterRun.sheet.hope - gave) };
    if (change.kind === "reroll" && change.hopeAtMost === undefined) {
      const again = await resolveDuality(ctx, { ...loaded, sheet: sheetBeforeRoll }, { ...args, advantage: args.advantage + (change.advantage ? 1 : 0) }, rec.rng, false);
      roll = again.roll;
      rolled = again.rolled;
    } else {
      const changed = changedRecord(roll, change, rec.rng);
      roll = changed.roll;
      forced = changed.forced;
      rolled = { ...rolled, hope: roll.dice.find((d) => d.role === "hope")?.value ?? rolled.hope, roll };
    }
    effects = dualityEffects("action", roll.outcome);
    finalSheet = placeTideToken(applyDualityEffects(base, effects), roll.outcome, "action").sheet;
    hits = forced ? hits.map((h) => ({ ...h, hit: true })) : hitsOf(roll);
  }
  sheet = finalSheet;
  const critical = roll.outcome === "critical";
  const hostRoll = hostRollOf(roll, hits);

  // ---- riders on the result (Hold Them Off, Kick, Tusks) and the automatic ones (First Strike, Face Your Fear)
  const hitIds = () => allTargets.filter((_, i) => hits[i]!.hit).map((t) => t.token._id);
  const skipped: string[] = [];
  for (const r of [...picked.filter((x) => x.phase === "after"), ...autos.filter((x) => x.phase === "after")]) {
    const ids = hitIds();
    if (!resultHolds(r.trigger, hostRoll) || (r.trigger.kind !== "afterYouRoll" && ids.length === 0)) {
      if (!r.auto) skipped.push(r.name);
      continue;
    }
    const run = await runRiderPart(env, r, sheet, "pre", hostRoll, ids, main);
    if (run === null) continue;
    used.push(r);
    if (run === "empty") continue;
    sheet = run.sheet;
    foldInto(folds, run);
    runs.push(run);
  }
  for (const add of folds.addTargets.splice(0)) {
    const more = await addedTargets(ctx, campaign, req.scene, weapon, add, new Set(allTargets.map((t) => t.token._id)), main!.encounter._id);
    const moreHits = resolveHits(roll.total, critical || forced, more.map((t) => ({ id: t.token._id, difficulty: difficultyOf(t.instance) })));
    allTargets.push(...more);
    hits = [...hits, ...moreHits];
    for (const t of more) halfDamage.set(t.token._id, add.damage === "half");
  }
  const anyHit = hits.some((h) => h.hit);

  // ---- R2: one damage roll after the attack's costs and gains; a critical adds the dice's maximum
  const sneak = sneakAttackApplies(sheet0, req.scene, allTargets.filter((_, i) => hits[i]!.hit));
  const damageOptions = damageOptionsFor(sheet0, campaign, options.damageOptions ?? [], sneak);
  let damageRecord: RollRecord | null = null;
  let damageLabel = "";
  if (anyHit) {
    const proficiency = sheet.proficiency;
    const rolledDamage = await resolveDamage(ctx, { ...loaded, sheet: { ...sheet, proficiency: proficiency + folds.proficiency } }, { source: { kind: "weapon", slot }, critical, modifier: 0, options: damageOptions }, rec.rng, false);
    sheet = { ...rolledDamage.paid, proficiency };
    let record = rolledDamage.roll;
    if (folds.damageAdd !== 0) record = { ...record, modifier: record.modifier + folds.damageAdd, total: Math.max(0, record.total + folds.damageAdd) };
    if (folds.multiply !== 1) record = { ...record, total: record.total * folds.multiply };
    damageRecord = record;
    damageLabel = rolledDamage.label;
  }

  // ---- damage on each instance hit (R3, R10), the riders' extra Hit Points (NV4), Onslaught's floor
  const weaponType = damageTypeOf(weapon);
  const type: DamageType | "both" = folds.addTypes.some((t) => t !== weaponType) ? "both" : weaponType;
  const onslaught = hasOnslaught(sheet0);
  const floor = onslaught ? "major" : folds.minimumSeverity;
  const now = Date.now();
  const snapshots: Doc<"encounterAdversaries">[] = [];
  const results: TargetResult[] = [];
  const publicParts: string[] = [];
  const gmParts: string[] = [];
  let extra = 0;
  for (const [i, t] of allTargets.entries()) {
    const hit = hits[i]!.hit;
    const block = await blockOf(ctx, t.instance);
    const label = t.instance.label;
    if (!hit || damageRecord === null) {
      results.push({ target: t, hit: false, defeated: false, severity: "none", hpMarked: 0, half: false });
      publicParts.push(`${label}: Miss`);
      gmParts.push(`${label}: miss (${roll.total} vs Difficulty ${difficultyOf(t.instance)})`);
      continue;
    }
    snapshots.push(t.instance);
    const half = halfDamage.get(t.token._id) === true;
    const total = half ? Math.ceil(damageRecord.total / 2) : damageRecord.total;
    let hp: number;
    let detail: string;
    let severity: TargetResult["severity"] = "none";
    let marked = 0;
    if (block.minion) {
      const result = applyDamageTo(oneMinion(t.instance, block), total, type);
      const fell = result.taken > 0 ? 1 : 0;
      hp = Math.min(t.instance.stats.hpMax, t.instance.hp + fell);
      marked = fell;
      extra += fell > 0 ? result.minionExtra : 0;
      detail = `${result.incoming} ${SHORT_TYPE[type]}${result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : ""} → ${fell > 0 ? `a Minion falls, +${result.minionExtra} to pick` : "no damage"} (${hp}/${t.instance.stats.hpMax} HP)`;
    } else {
      const result = applyDamageTo(combatantOf(t.instance, block), total, type, floor ? { minimumSeverity: floor } : {});
      const more = result.hpMarked > 0 && folds.extraHp !== 0 ? Math.max(-result.hpMarked, folds.extraHp) : 0;
      hp = Math.max(0, Math.min(t.instance.stats.hpMax, result.after.hp + more));
      severity = result.severity;
      marked = hp - t.instance.hp;
      detail = `${result.incoming} ${SHORT_TYPE[type]}${half ? " (half)" : ""}${result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : ""} → ${SEVERITY_LABEL[result.severity]}${onslaught ? " (Onslaught)" : ""} → ${result.hpMarked + more} HP${more !== 0 ? ` (${more > 0 ? "+" : ""}${more} from riders)` : ""} (${hp}/${t.instance.stats.hpMax})`;
    }
    const defeated = t.instance.defeated || hp >= t.instance.stats.hpMax;
    await ctx.db.patch("encounterAdversaries", t.instance._id, { hp, defeated, updatedAt: now });
    results.push({ target: t, hit: true, defeated, severity, hpMarked: marked, half });
    publicParts.push(`${label}: ${defeated ? "Defeated" : "Hit"}`);
    gmParts.push(`${label}: ${detail}${defeated ? ", defeated" : ""}`);
  }

  // ---- the riders' effects on the creatures (Stress, conditions, movement), then the riders after the damage
  const standing = (r: TargetResult) => !r.defeated;
  const riderWrites: InstanceWrite[] = [];
  const riderLines: string[] = [];
  const riderPrompts: CardPrompt[] = [];
  const posts: RiderRun[] = [];
  let riderFear = 0;
  const writeRun = async (run: RiderRun) => {
    const writes = instanceWrites(run.plan, run.built.creatures, run.name);
    await writeInstances(ctx, writes);
    riderWrites.push(...writes);
    const lines = gmLines(run.plan, run.built, writes);
    if (lines.length > 0) riderLines.push(`${run.name}: ${lines.join("; ")}`);
    riderPrompts.push(...promptsOf(run.plan, run.built));
    riderFear += run.plan.gmFearDelta;
    sheet = run.sheet;
  };
  for (const run of runs) {
    // The `pre` parts already changed the sheet; only their Fear and prompts are left to collect.
    riderFear += run.plan.gmFearDelta;
    riderPrompts.push(...promptsOf(run.plan, run.built));
  }
  for (const r of used) {
    const on = results.filter((x) => standing(x) && (r.phase === "before" || x.hit)).map((x) => x.target.token._id);
    const run = await runRiderPart(env, r, sheet, "post", hostRoll, on, main);
    if (run === null || run === "empty") continue;
    await writeRun(run);
    posts.push(run);
  }
  for (const r of [...picked, ...autos].filter((x) => x.phase === "damage")) {
    const severity = r.trigger.kind === "whenTargetMarksHp" || r.trigger.kind === "whenEnemyTakesDamage" ? r.trigger.severity : undefined;
    const subject = results.find((x) => x.hit && x.hpMarked > 0 && standing(x) && (severity === undefined || x.severity === severity));
    if (subject === undefined || !anyHit) {
      if (!r.auto) skipped.push(r.name);
      continue;
    }
    const id = subject.target.token._id;
    const run = await runRiderPart(env, r, sheet, "whole", hostRoll, [id], subject.target, id);
    if (run === null || run === "empty") continue;
    await writeRun(run);
    posts.push(run);
  }

  // ---- the after-roll feature's own effects (Ranger's Focus ends on its target)
  if (afterRun !== null) {
    const writes = instanceWrites(afterRun.plan, afterRun.built.creatures, afterRun.name);
    await writeInstances(ctx, writes);
    riderWrites.push(...writes);
    riderFear += afterRun.plan.gmFearDelta;
  }

  // ---- CB p.42: "After you make an attack … you are no longer Cloaked."
  sheet = uncloaked(sheet);
  finalSheet = sheet;

  const { gained } = effects.fear > 0 ? await gainFear(ctx, campaign._id, effects.fear) : { gained: 0 };
  const fearChanged = gained + (await changeFear(ctx, campaign._id, riderFear));
  const sheetChanged = changed(sheet0, finalSheet);
  if (sheetChanged) await saveSheet(ctx, character._id, finalSheet);

  // U4: each instance as it was before the attack; with its conditions, tags and effects when a rider changed them too.
  const touched = new Set<string>(riderWrites.map((w) => w.before.instanceId));
  const before: AdversaryBefore[] = snapshots.map((i) => (touched.has(i._id) ? adversaryBefore(i, true) : beforeOf(i)));
  const groupId = newGroupId();
  const riderNames = [...new Set([...(afterRun ? [featureName(afterRun)] : []), ...runs.map((r) => r.name), ...posts.map((r) => r.name), ...(damageOptions.includes(SNEAK_ATTACK) ? ["Sneak Attack"] : [])])];
  const using = [...duality.extras, ...riderNames].length > 0 ? ` (${[...duality.extras, ...riderNames].join(", ")})` : "";
  const head = `${sheet0.name} attacks with ${weapon.name}: ${TRAIT_LABEL[args.trait]} ${roll.total}${typedLabel(args.modifier)} ${rollWord(roll)}${using}`;
  const damageText = damageRecord === null ? "" : `; ${critical ? "critical " : ""}damage ${damageRecord.total} (${[damageLabel, diceList(damageRecord)].filter((s) => s !== "").join(": ")}${folds.damageAdd !== 0 ? ` ${typedLabel(folds.damageAdd)}` : ""}${folds.multiply !== 1 ? ` ×${folds.multiply}` : ""})`;
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: req.actorId,
    kind: "combat",
    visibility: "public",
    summary: `${head}${damageText} → ${publicParts.join(", ")}`.slice(0, 1000),
    roll,
    groupId,
    ...(sheetChanged ? { before: sheet0 } : {}),
    ...(fearChanged !== 0 ? { fearDelta: fearChanged } : {}),
    // As `actionRoll`: whether the roll gave its Hope (after its costs), so `rolls.storeSlayerDie` can take it back (K2).
    ...(WITH_HOPE.includes(roll.outcome) ? { hopeGained: rollGaveHope(duality.paid, roll.outcome, "action") } : {}),
    undoable: true,
  });
  await logAction(ctx, {
    campaignId: campaign._id,
    actorId: req.actorId,
    kind: "combat",
    visibility: "gm",
    summary: `${sheet0.name} → ${gmParts.join("; ")}`.slice(0, 1000),
    ...(damageRecord !== null ? { roll: damageRecord } : {}),
    groupId,
    ...(before.length > 0 ? { adversaryBefore: before } : {}),
    undoable: true,
  });
  if (riderLines.length > 0 || riderWrites.length > 0 || folds.unsupported.length > 0) {
    await logAction(ctx, {
      campaignId: campaign._id,
      actorId: req.actorId,
      kind: "combat",
      visibility: "gm",
      summary: `${sheet0.name} · riders → ${[...riderLines, ...folds.unsupported.map((u) => `${u} (not automated)`)].join("; ")}`.slice(0, 1000),
      groupId,
      ...(riderWrites.length > 0 ? { adversaryBefore: riderWrites.map((w) => w.before) } : {}),
      undoable: true,
    });
  }
  for (const p of riderPrompts.filter((x) => x.kind === "manual")) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: req.actorId, kind: "feature", visibility: "public", summary: `${sheet0.name}: ${p.text}`.slice(0, 1000), groupId, undoable: true });
  }

  // Armed countdowns tick right after the attack roll, as for `actionRoll` (countdowns-advanced K1, CB p.162).
  if (countsAsActionRoll(roll, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: roll.outcome, actorId: req.actorId });
  }

  const minionOffer = extra > 0 ? await offerMinions(ctx, req, { groupId, entryId, extra, total: roll.total, critical }) : null;
  const prompts = afterDualityRoll(finalSheet, { hope: rolled.hope, fear: rolled.fear, roll }, CLASS_FEATURES, duality.scope);
  const outcomes = results.map((r) => ({ tokenId: r.target.token._id, hit: r.hit, defeated: r.defeated }));
  return {
    status: "resolved",
    entryId,
    roll,
    damage: damageRecord,
    targets: outcomes,
    fearGained: gained,
    minionOffer,
    prompts,
    ...(riderNames.length > 0 ? { riders: riderNames } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(riderPrompts.length > 0 ? { riderPrompts: riderPrompts.filter((p) => p.kind !== "fold") } : {}),
  };
}

/** The after-roll feature's name for the feed ("Patron's Boon"). */
function featureName(run: RiderRun): string {
  return run.plan.name;
}

/** The most dice a held attack keeps (a Duality roll with advantage, help and the riders' dice is far fewer). */
const MAX_HELD_DICE = 60;

/**
 * Q6 (CB p.201): the Minions still standing that the attacker may pick: Minion instances of the same encounter on the
 * map, seen with a clear line, within the weapon's range, whose Difficulty the roll beat (or a critical). Read after the
 * hits were written, so a group hit by this attack offers only its remaining Minions.
 */
async function offerMinions(
  ctx: MutationCtx,
  req: AttackRequest,
  attack: { groupId: string; entryId: Id<"actionLog">; extra: number; total: number; critical: boolean },
): Promise<Infer<typeof minionOfferValidator> | null> {
  const s = req.scene;
  const encounterId = req.targets[0]!.encounter._id;
  const range = rangeFromWeapon(req.weapon.range);
  const candidates: Infer<typeof minionOfferValidator>["candidates"] = [];
  for (const [i, token] of s.scene.tokens.entries()) {
    if (i === s.viewer.index || token.side !== "enemy" || !seenBy(s, i)) continue;
    const linked = await enemyInstance(ctx, req.loaded.campaign._id, token);
    if (linked === null || linked.encounter._id !== encounterId) continue;
    const block = await blockOf(ctx, linked.instance);
    if (!block.minion) continue;
    if (!rangeCheck(s.attacker, token, range).inRange || !sightTo(s, token).lineOfSight) continue;
    if (!attack.critical && attack.total < difficultyOf(linked.instance)) continue;
    const available = Math.min(attack.extra, linked.instance.stats.hpMax - linked.instance.hp);
    if (available > 0) candidates.push({ instanceId: linked.instance._id, tokenId: token._id, name: linked.instance.label, available });
  }
  if (candidates.length === 0) return null;
  const requestId = await openMinionOffer(ctx, {
    campaignId: req.loaded.campaign._id,
    encounterId,
    mapId: s.map._id,
    createdBy: req.actorId,
    payload: {
      schemaVersion: 1,
      kind: "minionOffer",
      characterId: req.loaded.character._id,
      groupId: attack.groupId,
      entryId: attack.entryId,
      extra: attack.extra,
      candidates: candidates.map(({ instanceId, tokenId, available }) => ({ instanceId, tokenId, available })),
    },
  });
  return { requestId, extra: attack.extra, candidates };
}
