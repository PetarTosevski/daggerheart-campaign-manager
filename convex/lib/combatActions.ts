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
 *
 * Plan drawer-answers DA2 (docs/tasks/TASK-DA-DA2.md, user answers 2026-10-30): a damage-phase rider (Death Strike, HF
 * p.8) is a Use / Pass prompt on ONE creature the player picks (`riderPick` requests); a rider's extra target out of range
 * waits for the GM (Q1); First Strike doubles the whole damage after a critical (`foldedDamage`); Rise to the Challenge's
 * d20 Hope Die is on by default while it applies (`defaultOnRiders`, `hopeDieSwitch`); Surrounded may add allies.
 */
import { ConvexError, v, type Infer } from "convex/values";

import { featureUseKey, keyAvailability, requirementMet, stateCheckMet } from "../../src/lib/domain/card-effects/availability";
import { rollMatches, type PlanStep, type RunPlan } from "../../src/lib/domain/card-effects/run";
import type { CardUse, CreatureKey, DamageType, Range, RollFilter, RollResult, RollSpec, Step, TargetSpec, Trigger } from "../../src/lib/domain/card-effects/types";
import { lineOfSight, RANGE_ORDER, rangeCheck, rangeFromWeapon, resolveHits, applyDamageTo, type Combatant, type DamageResult, type RangeCheck, type SightResult } from "../../src/lib/domain/combat-actions/index";
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
import type { AdversaryDef, DomainId, TraitId, Weapon } from "../../src/lib/srd/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { parseChoices, type CardChoice, type ParsedChoices } from "./cardChoices";
import { adversaryBefore, cardPromptValidator, gmLines, instanceWrites, promptsOf, writeInstances, type CardPrompt, type InstanceWrite } from "./cardRows";
import { actorSheetAfter, bindGates, buildRun, cardActor, pcCombatant, pickCard, replaying, riderPartRuns, riderUse, runCard, type BuiltRun, type HostRoll, type RiderPart, type UsePick } from "./cardRunner";
import { saveSheet } from "./characterSheet";
import { loadCombatMap } from "./combatMaps";
import { loadScene, viewOf, type Scene, type Viewer } from "./combatVision";
import { costText, limitText } from "./featureDrawer";
import { factsOf, ownedHere, pickFeature } from "./featureRunner";
import { featureScope } from "./featureScope";
import { campaignFearState, gainFear, spendFear } from "./fear";
import { closeRequest, openAfterRoll, openMinionOffer, openRiderPick } from "./combatRequests";
import { bandsOnMap, partyMembers } from "./adversaryHits";
import { openIncomingHit } from "./incomingHits";
import { readSheet } from "./characterSheet";
import { changed, liveMods, resolveDamage, resolveDuality, rollResultHolds, type DualityArgs, type LiveMod, type Loaded } from "./rolls";
import type { AdversaryBefore } from "./validators/actionLog";
import { traitIdValidator } from "./validators/characters";
import { MAX_RIDERS_PER_ATTACK, rangeBandValidator, sanctionRollOptionsValidator, type AfterRollChange, type AfterRollChoice, type Rider, type RiderPickChoice } from "./validators/combatRequests";
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
  /**
   * DA2 (CB p.48 Rise to the Challenge, user 2026-10-30): the d20 Hope Die is ON while 2 or fewer Hit Points are unmarked;
   * `false` turns it off for this roll (fishing for a critical). Ignored when the feature doesn't apply.
   */
  riseToTheChallenge: v.optional(v.boolean()),
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
  riseToTheChallenge?: boolean;
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

/** DA2: what the attacker learns of a damage-phase prompt (Death Strike, U1): its name and the candidate tokens, no stat. */
export const riderPickOfferValidator = v.object({ requestId: v.id("combatRequests"), name: v.string(), candidates: v.array(v.id("combatTokens")) });

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
  /** DA2: damage-phase riders waiting for the player's Use / Pass and pick (Death Strike, HF p.8). */
  riderPicks: v.optional(v.array(riderPickOfferValidator)),
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
  if (token.side !== "enemy") return null;
  return adversaryInstance(ctx, campaignId, token);
}

/** An adversary token's encounter instance whatever its side (a GM ally too), when it is of a running encounter and standing. */
async function adversaryInstance(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<{ instance: Doc<"encounterAdversaries">; encounter: Doc<"encounters"> } | null> {
  if (token.ref.kind !== "adversary") return null;
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
  const most = Math.min(MAX_TARGETS, WEAPON_ATTACK_TARGETS + (await extraAttackTargets(ctx, campaign, s)));
  if (tokenIds.length === 0 || tokenIds.length > most || new Set(tokenIds).size !== tokenIds.length) throw appError("COMBAT_TARGET_INVALID");
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

/**
 * Plan lanes, E1 (dcm-y3e): the extra targets a weapon attack may take from the attacker's live `extraTargets` mods
 * (Parallela, CB p.332: "The next time the target makes an attack, they can hit an additional target within range that
 * their attack roll would succeed against"): each target is checked as the first, and the one roll hits those it beats.
 */
export function extraTargetsOf(mods: readonly LiveMod[]): number {
  let n = 0;
  for (const { mod } of mods) {
    if (mod.kind !== "extraTargets" || !(mod.on === "attack" || mod.on === "weaponAttack" || mod.on === "any")) continue;
    n += mod.count.kind === "fixed" ? mod.count.value : 1;
  }
  return Math.max(0, Math.min(n, MAX_TARGETS - WEAPON_ATTACK_TARGETS));
}

/** The attacker's extra weapon-attack targets (their sheet's live mods); 0 for a token that is not a PC of the campaign. */
async function extraAttackTargets(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene): Promise<number> {
  if (s.attacker.ref.kind !== "pc") return 0;
  const character = await ctx.db.get("characters", s.attacker.ref.characterId);
  if (character === null || character.campaignId !== campaign._id) return 0;
  return extraTargetsOf(liveMods(readSheet(character.sheet), featureScope(campaign)));
}

/**
 * Plan lanes, E1 (dcm-5dg): the trait a live `weaponTrait` mod makes a weapon attack roll with (Versatile Fighter, CB
 * p.330: "You can use a different character trait for an equipped weapon, rather than the trait the weapon calls for"): a
 * fixed trait, or the player's pick (`chosen`) for a mod with a `choice`; undefined when no mod covers the slot (or the
 * player picked none: the weapon's own trait).
 */
export function weaponTraitFor(mods: readonly LiveMod[], slot: WeaponSlot, chosen: TraitId | undefined): TraitId | undefined {
  for (const { mod } of mods) {
    if (mod.kind !== "weaponTrait" || (mod.weapon !== "either" && mod.weapon !== slot)) continue;
    return mod.choice !== undefined ? chosen : mod.trait;
  }
  return undefined;
}

/** The weapon in the slot, or DICE_RULE (as `damageRoll`) when none is equipped. */
export function equippedWeapon(sheet: CharacterSheet, slot: WeaponSlot): Weapon {
  const weapon = weaponIn(sheet, slot);
  if (!weapon) throw appError("DICE_RULE", `No ${slot} weapon is equipped.`);
  return weapon;
}

/**
 * The Duality arguments of a weapon attack (the weapon's trait unless it is the wielder's choice). Plan lanes, E1:
 * `traitOverride`, a `weaponTrait` mod's trait (Versatile Fighter, dcm-5dg).
 */
export function attackDuality(weapon: Weapon, roll: AttackRoll, cover: boolean, traitOverride?: TraitId): DualityArgs {
  const trait = traitOverride ?? (weapon.trait === "choice" ? roll.trait : weapon.trait);
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
  /** DA2: rider-added targets out of range that the GM approved (Q1). */
  waived?: readonly Id<"combatTokens">[];
};

// ---------------------------------------------------------------- riders (plan sheet-drawer SD5)

/**
 * What a rider rides on: the attack's roll spec (for `rollMatches`), its trait, the weapon and the weapon's range.
 * Plan lanes, E1: `slot` (the weapon slot of a weapon attack: `weaponSlot` filters, Ignition, dcm-ab5), `fromUse` (the card
 * or feature use the roll belongs to: `fromUse` filters, Feed on Fangs, dcm-bn1), `cardDomain` (the domain of the card
 * cast: Fane of the Wilds, dcm-z1a), `damage` (whether the move makes a damage roll: Twilight Toll's "doesn't result in
 * making a damage roll", dcm-94h).
 */
export type Host = {
  spec: RollSpec;
  trait: TraitId | undefined;
  weapon: boolean;
  weaponRange: Range | null;
  damageType: DamageType;
  slot?: WeaponSlot;
  fromUse?: { id: string; useId: string };
  cardDomain?: DomainId;
  damage?: boolean;
};

export function hostOf(weapon: Weapon, slot: WeaponSlot, trait: TraitId | undefined): Host {
  return {
    spec: { kind: "attack", weapon: slot, difficulty: { kind: "target" } },
    trait: weapon.trait === "choice" ? trait : weapon.trait,
    weapon: true,
    weaponRange: rangeFromWeapon(weapon.range),
    damageType: damageTypeOf(weapon),
    slot,
    damage: true,
  };
}

/**
 * Plan lanes, E1 (dcm-gvr, dcm-bn1): whether a roll spec is a weapon attack: an `attack` roll, or a trait roll whose
 * feature is its own weapon (`asWeapon`: Elemental Breath, CB p.54 "treating it as an Instinct weapon"; Long Tongue, CB p.69).
 */
export function isWeaponRoll(spec: RollSpec): boolean {
  return spec.kind === "attack" || (spec.kind === "trait" && spec.asWeapon === true);
}

/** Plan lanes, E1: `rollMatches` with a feature that is its own weapon counting as a weapon attack and an attack (dcm-gvr). */
export function hostMatches(filter: RollFilter, host: Pick<Host, "spec" | "trait">): boolean {
  if (filter === "damage") return false;
  if ((filter === "attack" || filter === "weaponAttack") && isWeaponRoll(host.spec)) return true;
  return rollMatches(filter, host.spec) || (host.trait !== undefined && filter === host.trait);
}

/** Plan lanes, E1 (dcm-bn1, dcm-13s): a trigger's `fromUse` (`<id>` or `<id>:<useId>`) against the host's use. */
export function fromUseHolds(filter: string | undefined, host: Pick<Host, "fromUse">): boolean {
  if (filter === undefined) return true;
  const from = host.fromUse;
  return from !== undefined && (filter === from.id || filter === `${from.id}:${from.useId}`);
}

/** Whether `range` is at most `max` along the Defined Ranges (CB p.103: Melee, Very Close, Close, Far, Very Far). */
function rangeAtMost(range: Range | null, max: Range): boolean {
  return range !== null && RANGE_ORDER.indexOf(range) <= RANGE_ORDER.indexOf(max);
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
 *
 * Plan lanes, E1: the filters V widened hold here: `weaponSlot` (Ignition, HF p.22, dcm-ab5) and `weaponRange` (at most
 * that range: Surrounded, HF p.10) on `beforeYouRoll`; `weaponSlot` on `whenYouAttack`; `fromUse` on every roll trigger
 * (Feed on a Fangs attack, HF p.39, dcm-bn1); `cardDomain` on `afterYouRoll` (Fane of the Wilds, CB p.339, dcm-z1a). A
 * `whenYouAttack` needs an attack roll (a plain trait roll is not one, dcm-bn1), and a feature that is its own weapon
 * (`asWeapon`) counts as a weapon (dcm-gvr).
 */
export function riderPhase(trigger: Trigger, host: Host, use: CardUse): RiderPhase | null {
  const matches = (filter: RollFilter) => hostMatches(filter, host);
  switch (trigger.kind) {
    case "beforeYouRoll":
      if (!fromUseHolds(trigger.fromUse, host)) return null;
      if (trigger.weaponSlot !== undefined && host.slot !== trigger.weaponSlot) return null;
      if (trigger.weaponRange !== undefined && !rangeAtMost(host.weaponRange, trigger.weaponRange)) return null;
      return trigger.roll === "damage" || matches(trigger.roll) ? "before" : null;
    case "whenYouAttack":
      if (!matches("attack")) return null;
      if (!fromUseHolds(trigger.fromUse, host)) return null;
      if (trigger.weapon === true && !host.weapon) return null;
      if (trigger.weaponSlot !== undefined && host.slot !== trigger.weaponSlot) return null;
      if (trigger.weaponRange !== undefined && host.weaponRange !== trigger.weaponRange) return null;
      return "after";
    case "afterYouRoll":
      if (!fromUseHolds(trigger.fromUse, host)) return null;
      if (trigger.cardDomain !== undefined && host.cardDomain !== trigger.cardDomain) return null;
      return trigger.roll !== "damage" && matches(trigger.roll) && !changesRoll(use.steps) ? "after" : null;
    case "afterAllyRolls":
      // Plan lanes, E1: "you or an ally" (`includeSelf`): the actor's own roll (Eclipse, CB p.337, dcm-0gi).
      if (trigger.includeSelf !== true) return null;
      return matches(trigger.roll ?? "action") && !changesRoll(use.steps) ? "after" : null;
    case "whenYouDealDamage":
      return fromUseHolds(trigger.fromUse, host) ? "after" : null;
    case "whenTargetMarksHp":
      return fromUseHolds(trigger.fromUse, host) ? "damage" : null;
    case "whenEnemyTakesDamage":
      return trigger.byYou === true ? "damage" : null;
    case "gmWouldGainFear":
      // Plan lanes, E1 (dcm-1o3): the Fear the actor's own roll would give (Dread-Touched, HF p.181: "When you succeed with
      // Fear, you can mark 2 Stress to prevent the GM from gaining a Fear"); its `negate` step stops that gain.
      return trigger.byYou === true ? "after" : null;
    default:
      return null;
  }
}

/** The result and Hope / Fear filters of a roll trigger (`whenYouAttack`, `afterYouRoll`, `afterAllyRolls`, `gmWouldGainFear`). */
function rollFilters(trigger: Trigger): { result: RollResult | undefined; duality: "hope" | "fear" | undefined } {
  switch (trigger.kind) {
    case "whenYouAttack":
      return { result: trigger.result, duality: undefined };
    case "afterYouRoll":
    case "afterAllyRolls":
      return { result: trigger.result, duality: trigger.duality };
    case "gmWouldGainFear":
      return { result: trigger.result, duality: undefined };
    default:
      return { result: undefined, duality: undefined };
  }
}

/**
 * Whether the trigger's result filter holds for the attack's roll (a critical is a success with Hope, CB p.90).
 * Plan lanes, E1: `duality` narrows it to a roll with Hope / with Fear (Courage, CB p.48: "When you fail a roll with Fear":
 * `failure` + `fear`, dcm-5z3); `successWithHope` (Favor, HF p.14; Ethereal Visage, CB p.45; dcm-a9n, dcm-nhr) and
 * `successWithFear` (Dread-Touched, HF p.181; dcm-1o3) hold on every roll trigger.
 */
export function resultHolds(trigger: Trigger, roll: HostRoll): boolean {
  const { result, duality } = rollFilters(trigger);
  return rollResultHolds(result, duality, roll);
}

/** A creature a roll was against, as `RollTarget` filters read it. */
export type RollSubject = { token: Doc<"combatTokens">; enemy: boolean; tags: readonly string[]; conditions: readonly string[] };

/** Whether a creature is the one a `CreatureKey` names (tagged / Hexed); undefined for the keys the player confirms. */
function creatureKeyHolds(key: CreatureKey, subject: RollSubject): boolean | undefined {
  switch (key.kind) {
    case "tagged":
      return subject.tags.includes(key.tag) || subject.conditions.includes(key.tag);
    case "hexed":
      return subject.tags.includes("Hexed") || subject.conditions.includes("Hexed");
    default:
      return undefined;
  }
}

/**
 * Plan lanes, E1: the target filters of a roll trigger, read from the map (dcm-94h, dcm-0gi, dcm-g6t). `against.enemy` (the
 * roll was against an adversary), `against.within` (that creature within the range of `from`), `against.creature` (the
 * tagged / Hexed one: Twilight Toll's mark, CB p.337); `noDamageRoll` (the move made no damage roll: Twilight Toll). A filter
 * the server can't read (`inArea` of a live area, the other creature keys) is the player's to confirm and holds here
 * (Q13). With no target an `against` filter fails.
 */
export function rollTargetHolds(trigger: Trigger, host: Pick<Host, "damage">, from: Doc<"combatTokens"> | undefined, subject: RollSubject | undefined): boolean {
  if (trigger.kind !== "afterYouRoll" && trigger.kind !== "afterAllyRolls") return true;
  if (trigger.kind === "afterYouRoll" && trigger.noDamageRoll === true && host.damage === true) return false;
  const against = trigger.against;
  if (against === undefined) return true;
  if (subject === undefined) return false;
  if (against.enemy === true && !subject.enemy) return false;
  if (against.within !== undefined && (from === undefined || !rangeCheck(from, subject.token, against.within).inRange)) return false;
  if (against.creature !== undefined && creatureKeyHolds(against.creature, subject) === false) return false;
  return true;
}

/** An attack target as a `RollSubject`. */
export function subjectOf(target: CheckedTarget): RollSubject {
  return { token: target.token, enemy: target.token.side === "enemy", tags: target.instance.tags, conditions: target.instance.conditions };
}

/** Whether a trigger is about the roll itself, so it holds without a target hit (`afterYouRoll`, `afterAllyRolls`). */
export function rollOnly(trigger: Trigger): boolean {
  return trigger.kind === "afterYouRoll" || trigger.kind === "afterAllyRolls" || trigger.kind === "gmWouldGainFear";
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
  /** NV18: the creatures its `addTargets` step may add (Hold Them Off, Surrounded), for the range check before the roll. */
  addSpec?: TargetSpec;
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
    const add = allSteps(hit.use.steps).find((s): s is Extract<Step, { kind: "addTargets" }> => s.kind === "addTargets");
    out.push({ source: r.source, id: r.id, useId: hit.use.id, name: hit.use.name === name ? name : hit.use.name, trigger: hit.trigger, phase: hit.phase, choices: [...r.choices], auto: false, ...(add ? { addSpec: add.targets } : {}) });
  }
  return out;
}

/**
 * The automatic uses that ride on this attack: First Strike, Face Your Fear, Pummeljoy, Marked for Death's damage...
 * Plan lanes, E1: a loadout card's automatic use too (Eclipse's "succeeds with Hope", CB p.337; Fane of the Wilds' token
 * on a critical Spellcast Roll for a Sage spell, CB p.339, dcm-z1a); it is skipped quietly when it can't run.
 */
export function autoRiders(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host): PickedRider[] {
  const out: PickedRider[] = [];
  for (const cardId of sheet.domainCards.loadout) {
    const effect = cardEffect(cardId);
    if (effect === undefined || cardUsage(cardId) === "outOfCombat") continue;
    for (const { use, trigger, phase } of riderUses(effect.uses, host, ["auto"])) {
      out.push({ source: "card", id: cardId, useId: use.id, name: use.name, trigger, phase, choices: [], auto: true });
    }
  }
  for (const { feature, entry } of heldEntries(sheet, campaign)) {
    if (AUTO_ELSEWHERE.has(feature.featureId)) continue;
    for (const { use, trigger, phase } of riderUses(entry.uses, host, ["auto"])) {
      out.push({ source: "feature", id: feature.featureId, useId: use.id, name: use.name, trigger, phase, choices: [], auto: true });
    }
  }
  return out;
}

/**
 * DA2 (user 2026-10-30, replaces SD2's opt-in): rider uses that are ON by default while their condition holds, with a
 * toggle to turn them off. Rise to the Challenge (CB p.48): "While you have 2 or fewer Hit Points unmarked, you can roll a
 * d20 as your Hope Die."
 */
export const DEFAULT_ON_RIDERS: ReadonlySet<string> = new Set(["subclass:call-of-the-brave:rise-to-the-challenge"]);

/** The requirement state of a sheet (Hit Points, Stress, Hope, Armor) for a default-on rider's condition. */
function sheetState(sheet: CharacterSheet) {
  const actor = { ...cardActor("self", sheet, "", undefined), ...actorExtras(sheet) };
  return { hp: sheet.hp, hpMax: sheet.hpMax, stress: sheet.stress, stressMax: sheet.stressMax, armor: sheet.armorMarked, hope: sheet.hope, armorWorn: actor.armorWorn, loadoutDomains: actor.loadoutDomains, activeCardEffects: actor.activeCardEffects, situations: [] };
}

/**
 * The default-on riders that apply to this roll now (their requirements met), unless the player turned them off
 * (`off`) or already sent them. Run as automatic uses: one that can't run just doesn't happen.
 */
export function defaultOnRiders(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host, off: boolean, already: readonly PickedRider[]): PickedRider[] {
  if (off) return [];
  const out: PickedRider[] = [];
  const state = sheetState(sheet);
  for (const { feature, entry } of heldEntries(sheet, campaign)) {
    if (!DEFAULT_ON_RIDERS.has(feature.featureId)) continue;
    for (const { use, trigger, phase } of riderUses(entry.uses, host, ["rider"])) {
      if (already.some((p) => p.source === "feature" && p.id === feature.featureId && p.useId === use.id)) continue;
      if (!(use.requires ?? []).every((r) => r.kind !== "situation" && requirementMet(r, state))) continue;
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
  /**
   * DA2: ON unless the player turns it off (Rise to the Challenge, CB p.48); listed only while its condition holds. Not sent
   * as a rider: turning it off sends `riseToTheChallenge: false`.
   */
  defaultOn: v.optional(v.boolean()),
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
  if (trigger.kind === "whenYouAttack" || trigger.kind === "gmWouldGainFear") return RESULT_WORDS[trigger.result ?? "any"] ?? "After the roll";
  if (trigger.kind === "afterYouRoll") {
    const words = RESULT_WORDS[trigger.result ?? "any"] ?? "After the roll";
    // Plan lanes, E1 (Courage, CB p.48: "When you fail a roll with Fear"; dcm-5z3).
    return trigger.duality === undefined ? words : `${words} with ${trigger.duality === "hope" ? "Hope" : "Fear"}`;
  }
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
      if (phase === "damage") continue;
      out.push(optionOf("card", cardId, name, use, trigger, phase, keyAvailability(sheet, featureUseKey(cardId, use.id), use.limit)));
    }
  }
  const held = ownedHere(sheet, campaign);
  const state = sheetState(sheet);
  for (const { feature, entry } of heldEntries(sheet, campaign)) {
    const raw = featureEffect(feature.featureId)!;
    const holdings = holdingsFor(sheet, held, raw.owner);
    for (const { use, trigger, phase } of riderUses(entry.uses, host, ["rider"])) {
      // DA2: a damage-phase rider (Death Strike) is a prompt after the damage, never a toggle before the attack.
      if (phase === "damage") continue;
      if (DEFAULT_ON_RIDERS.has(feature.featureId)) {
        if (!(use.requires ?? []).every((r) => r.kind !== "situation" && requirementMet(r, state))) continue;
        out.push({ ...optionOf("feature", feature.featureId, feature.name, use, trigger, phase, { state: "ready" }), defaultOn: true });
        continue;
      }
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
    ...(roll.riseToTheChallenge !== undefined ? { riseToTheChallenge: roll.riseToTheChallenge } : {}),
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
  /**
   * "double damage" (First Strike, HF p.8), applied to the whole damage total after the critical's added maximum and every
   * added die and bonus (dcm-bxp.99.19.43, user 2026-10-30: "crit damage first, then doubled").
   */
  multiply: number;
  /** DA2: the Hope Die's sides for this roll ("roll a d20 as your Hope Die", Rise to the Challenge, CB p.48). */
  hopeDie?: number;
  /**
   * Plan lanes, E1 (dcm-3ou, dcm-jog): bonuses to one duality die's result (Ill Omen, HF p.95: "their Fear Die gains a
   * bonus equal to the amount of Fear you have"; Backhanded Guidance, HF p.87: "add 1d6 to the result of their Fear Die").
   */
  dieBonus: { die: "hope" | "fear"; amount: number }[];
  /** Plan lanes, E1 (dcm-1o3): the GM gains no Fear from this roll (Dread-Touched's `negate` on `gmWouldGainFear`). */
  preventFear?: boolean;
  minimumSeverity?: "minor" | "major" | "severe";
  /** "mark an additional Hit Point" after the thresholds (Thrive in Chaos, NV4). */
  extraHp: number;
  /** The same roll against more creatures (NV18). */
  addTargets: { rider: PickedRider; count: number; spec: TargetSpec; damage: "same" | "half" }[];
  /** What a rider does that the attack can't fold in, for the feed. */
  unsupported: string[];
};

export function emptyFolds(): Folds {
  return { modifier: 0, advantage: 0, damageAdd: 0, addTypes: [], proficiency: 0, multiply: 1, extraHp: 0, addTargets: [], unsupported: [], dieBonus: [] };
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
      else if (ch.kind === "hopeDie") folds.hopeDie = ch.sides;
      else if (ch.kind === "dieBonus" && ch.die !== "hopeOrFear") folds.dieBonus.push({ die: ch.die, amount });
      else folds.unsupported.push(`${run.name}: ${ch.kind}`);
    } else if (step.kind === "addTargets") {
      folds.addTargets.push({ rider: run.rider, count: amount, spec: step.targets, damage: step.damage ?? "same" });
    } else if (step.kind === "adjustHpMarked") {
      folds.extraHp += (step.change === "more" ? 1 : -1) * amount;
    } else if (step.kind === "negate" && run.rider.trigger.kind === "gmWouldGainFear") {
      folds.preventFear = true;
    }
  }
}

/** A PC a rider added to the attack (Surrounded's "additional creatures", allies included: dcm-bxp.99.19.44). */
export type PcTarget = { token: Doc<"combatTokens">; character: Doc<"characters">; sheet: CharacterSheet; evasion: number; sight: SightResult; rider: PickedRider; half: boolean };

/** Whether a rider's added targets may be any creature (Surrounded, HF p.10: "additional creatures"), allies included. */
function anyCreature(spec: TargetSpec): boolean {
  return spec.side === "any" || spec.side === "ally" || spec.side === "selfOrAlly";
}

/** The range of a rider's added targets on the map. */
function addRange(spec: TargetSpec, weapon: Weapon): Range {
  return spec.range === "weapon" ? rangeFromWeapon(weapon.range) : (spec.range as Range);
}

/**
 * DA2 (combat-actions Q1, user 2026-10-30): the extra targets the riders name (their `picked` choice) that are outside the
 * rider's range, with their band. A player's attack with any of these waits for the GM like card targets; tokens not on
 * the map are left to the attack's own checks.
 */
export function addedOutOfRange(s: AttackScene, weapon: Weapon, picked: readonly PickedRider[]): { tokenId: Id<"combatTokens">; band: RangeCheck["band"] }[] {
  const out: { tokenId: Id<"combatTokens">; band: RangeCheck["band"] }[] = [];
  for (const r of picked) {
    if (r.addSpec === undefined) continue;
    const range = addRange(r.addSpec, weapon);
    for (const id of parseChoices(r.choices).picked) {
      const token = s.scene.tokens.find((t) => t._id === id);
      if (token === undefined || out.some((o) => o.tokenId === token._id)) continue;
      const check = rangeCheck(s.attacker, token, range);
      if (!check.inRange) out.push({ tokenId: token._id, band: check.band });
    }
  }
  return out;
}

/**
 * DA2: the riders with the declined extra targets taken out of their `picked` choice (the GM's Decline drops that target
 * only). A rider left with no extra target is dropped (nothing paid); a number the player picked per target (Surrounded's
 * Hope) goes down by the targets dropped, never below 1.
 */
export function withoutTargets(riders: readonly Rider[], dropped: ReadonlySet<string>): Rider[] {
  const out: Rider[] = [];
  for (const r of riders) {
    const picked = r.choices.find((c) => c.id === "picked");
    if (picked === undefined || !Array.isArray(picked.value)) {
      out.push(r);
      continue;
    }
    const kept = picked.value.filter((id) => !dropped.has(id));
    const removed = picked.value.length - kept.length;
    if (removed === 0) {
      out.push(r);
      continue;
    }
    if (kept.length === 0) continue;
    out.push({ ...r, choices: r.choices.map((c) => (c.id === "picked" ? { ...c, value: kept } : c.id.startsWith("n:") && typeof c.value === "number" ? { ...c, value: Math.max(1, c.value - removed) } : c)) });
  }
  return out;
}

/**
 * NV18 (Hold Them Off, CB p.38: "use that same roll against two additional adversaries within range of the attack";
 * Surrounded, HF p.10: "additional creatures within Melee range"): the creatures the rider's `picked` choice names, at
 * most its count, each seen with a clear line (COMBAT_NO_LINE_OF_SIGHT) and not already a target: an enemy adversary
 * token of the attack's encounter, or, when the rider may target any creature (Surrounded, dcm-bxp.99.19.44), an ally
 * adversary token or another PC's token. Out of the rider's range: COMBAT_TARGET_INVALID unless the GM waived it
 * (`waived`, DA2: the attack waited for the GM's approval first). COMBAT_TARGET_INVALID otherwise.
 */
async function addedTargets(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  s: AttackScene,
  weapon: Weapon,
  add: Folds["addTargets"][number],
  taken: ReadonlySet<string>,
  encounterId: Id<"encounters">,
  waived: ReadonlySet<string>,
): Promise<{ adversaries: CheckedTarget[]; pcs: PcTarget[] }> {
  const ids = parseChoices(add.rider.choices).picked;
  if (ids.length > add.count || new Set(ids).size !== ids.length) throw appError("COMBAT_TARGET_INVALID", `${add.rider.name}: at most ${add.count} more target(s).`);
  const range = addRange(add.spec, weapon);
  const adversaries: CheckedTarget[] = [];
  const pcs: PcTarget[] = [];
  for (const id of ids) {
    const index = s.scene.tokens.findIndex((t) => t._id === id);
    if (index < 0 || index === s.viewer.index || taken.has(id)) throw appError("COMBAT_TARGET_INVALID");
    const token = s.scene.tokens[index]!;
    if (!seenBy(s, index)) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const sight = sightTo(s, token);
    if (!sight.lineOfSight) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const check = rangeCheck(s.attacker, token, range);
    if (!check.inRange && !waived.has(id)) throw appError("COMBAT_TARGET_INVALID", `${add.rider.name}: a target is out of range.`);
    if (anyCreature(add.spec) && token.ref.kind === "pc") {
      const character = await ctx.db.get("characters", token.ref.characterId);
      if (character === null || character.campaignId !== campaign._id) throw appError("COMBAT_TARGET_INVALID");
      const sheet = readSheet(character.sheet);
      pcs.push({ token, character, sheet, evasion: pcCombatant(token._id, sheet).evasion ?? 0, sight, rider: add.rider, half: add.damage === "half" });
      continue;
    }
    const linked = anyCreature(add.spec) ? await adversaryInstance(ctx, campaign._id, token) : await enemyInstance(ctx, campaign._id, token);
    if (linked === null || linked.encounter._id !== encounterId) throw appError("COMBAT_TARGET_INVALID");
    adversaries.push({ token, ...linked, check, sight });
  }
  return { adversaries, pcs };
}

// ---- allies' automatic uses on the roll (plan lanes, E1)

/** An ally's automatic use that ran on the attacker's roll, to write in the attack's group. */
export type AllyRun = { character: Doc<"characters">; before: CharacterSheet; run: RiderRun };

/**
 * Plan lanes, E1 (dcm-0gi, dcm-g6t, dcm-3ft): the other PCs' automatic `afterAllyRolls` uses this roll sets off: Eclipse
 * (CB p.337: "when you or an ally succeeds with Hope against an adversary within this shadow, the target must mark a
 * Stress"). Each PC on the map other than the roller, within the trigger's `range` of the roller (any range without
 * one), whose loadout card or held feature has an `auto` use with that trigger whose roll filter (default `action`; `any`
 * covers every roll), result, Hope / Fear and target filters hold. It runs as that PC's use (their sheet, limits and
 * costs; `triggerSubject` = the roller) against the targets the roll hit. One that can't run is skipped. A `reaction`
 * (Adjust Reality, Tactician, Forest Sprites) asks another player and is not run here (follow-up).
 */
export async function allyAutoRuns(ctx: MutationCtx, campaign: Doc<"campaigns">, s: AttackScene, roller: Id<"characters">, host: Host, roll: HostRoll, subject: RollSubject | undefined, hitIds: readonly string[], rng: Rng): Promise<AllyRun[]> {
  const out: AllyRun[] = [];
  const gmFear = (await campaignFearState(ctx, campaign._id)).fear;
  for (const token of s.scene.tokens) {
    if (token._id === s.attacker._id || token.side !== "pc" || token.ref.kind !== "pc" || token.ref.characterId === roller) continue;
    const character = await ctx.db.get("characters", token.ref.characterId);
    if (character === null || character.campaignId !== campaign._id || character.status !== "active") continue;
    let sheet: CharacterSheet;
    try {
      sheet = readSheet(character.sheet);
    } catch {
      continue;
    }
    const fits = (use: CardUse): Trigger | null => {
      const a = use.activation;
      if (a.kind !== "auto" || a.trigger.kind !== "afterAllyRolls") return null;
      const t = a.trigger;
      if (t.range !== undefined && !rangeCheck(token, s.attacker, t.range).inRange) return null;
      if (!hostMatches(t.roll ?? "action", host) || !resultHolds(t, roll) || !rollTargetHolds(t, host, token, subject)) return null;
      return t;
    };
    const candidates: PickedRider[] = [];
    for (const cardId of sheet.domainCards.loadout) {
      for (const use of cardEffect(cardId)?.uses ?? []) {
        const t = fits(use);
        if (t) candidates.push({ source: "card", id: cardId, useId: use.id, name: use.name, trigger: t, phase: "after", choices: [], auto: true });
      }
    }
    for (const { feature, entry } of heldEntries(sheet, campaign)) {
      for (const use of entry.uses) {
        const t = fits(use);
        if (t) candidates.push({ source: "feature", id: feature.featureId, useId: use.id, name: use.name, trigger: t, phase: "after", choices: [], auto: true });
      }
    }
    if (candidates.length === 0) continue;
    let scene: AttackScene;
    try {
      scene = await attackScene(ctx, campaign, character, s.map._id);
    } catch {
      continue;
    }
    const env: RiderEnv = { ctx, campaign, character, scene, host, gmFear, rng, rollUsedExperience: false };
    let now = sheet;
    for (const r of candidates) {
      const run = await runRiderPart(env, r, now, "whole", roll, hitIds, undefined, s.attacker._id);
      if (run === null || run === "empty") continue;
      out.push({ character, before: now, run });
      now = run.sheet;
    }
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

/**
 * Plan lanes, E1 (dcm-y3e): the sheet without the effects that end when their bearer attacks: an effect carrying an
 * `extraTargets` mod (Parallela: "The next time the target makes an attack") or one whose step ends on `bearerAttacks`.
 */
export function endedByAttack(sheet: CharacterSheet, mods: readonly LiveMod[]): CharacterSheet {
  const ended = new Set(mods.flatMap((m) => (m.effectId !== undefined && (m.mod.kind === "extraTargets" || m.endsOnAttack === true) ? [m.effectId] : [])));
  if (ended.size === 0) return sheet;
  return { ...sheet, effects: sheet.effects.filter((e) => !ended.has(e.id)) };
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
  if (!fromUseHolds(trigger.fromUse, host) || (trigger.cardDomain !== undefined && host.cardDomain !== trigger.cardDomain)) return false;
  return hostMatches(trigger.roll, host);
}

/**
 * Q1 (a), CB p.107 "Using Features After a Roll": the after-roll features the attacker holds that are ready, affordable and
 * whose trigger fits this roll (Patron's Boon and True Strike on a failure, Fearless and Unbound with Fear, Internal Compass
 * on a 1 on the Hope Die, Luckbender, Prayer Dice, Adaptability when an Experience was used, Ranger's Focus against the
 * Focus). `sheet` is the sheet after the roll's gains: the Hope this roll gave can pay a Hope feature (CB p.90).
 */
export function afterRollOffers(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host, roll: RollRecord, hostRoll: HostRoll, target: CheckedTarget | undefined, rollUsedExperience: boolean, from?: Doc<"combatTokens">): AfterRollOffer[] {
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
      if (!rollTargetHolds(a.trigger, host, from, target ? subjectOf(target) : undefined)) continue;
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

/**
 * DA2 (Rise to the Challenge, CB p.48: "roll a d20 as your Hope Die"): a die source whose next 12-sided draw, once armed,
 * draws `sides` instead. A Duality roll draws its Hope Die first (`rollDuality`: Hope, Fear, then the advantage dice), so
 * arming it right before the roll swaps the Hope Die only. Put it outside a recorder so the held attack replays the value.
 */
export function hopeDieSwitch(base: Rng): { rng: Rng; arm: (sides: number | undefined) => void } {
  let next: number | undefined;
  return {
    rng: (sides) => {
      if (next !== undefined && sides === 12) {
        const s = next;
        next = undefined;
        return base(s);
      }
      return base(sides);
    },
    arm: (sides) => {
      next = sides !== undefined && sides !== 12 ? sides : undefined;
    },
  };
}

/**
 * Plan lanes, E1 (dcm-3ou, dcm-jog): the roll with a bonus added to one duality die's result, its total and its outcome
 * read again (the bonus can turn a roll with Hope into one with Fear: Backhanded Guidance, HF p.87). The die keeps its
 * sides; its value is the result with the bonus.
 */
export function withDieBonus(record: RollRecord, die: "hope" | "fear", amount: number): RollRecord {
  if (amount === 0) return record;
  const dice = record.dice.map((d) => (d.role === die && !d.dropped ? { ...d, value: d.value + amount } : d));
  const next = retotal({ ...record, dice });
  const hope = dice.find((d) => d.role === "hope")?.value ?? 0;
  const fear = dice.find((d) => d.role === "fear")?.value ?? 0;
  return { ...next, outcome: actionOutcome(hope, fear, next.total, record.difficulty) };
}

/** The roll record with its Hope Die's sides set (the value was already drawn from those sides). */
export function withHopeSides(record: RollRecord, sides: number | undefined): RollRecord {
  if (sides === undefined || sides === 12) return record;
  return { ...record, dice: record.dice.map((d) => (d.role === "hope" ? { ...d, sides } : d)) };
}

/**
 * The damage total of a weapon attack (R2, CB p.98) with the riders folded in: the damage roll's total (a critical's
 * added maximum already in it), plus the riders' added damage, then multiplied ("double damage", First Strike, HF p.8).
 * User 2026-10-30 (dcm-bxp.99.19.43): the whole damage is doubled, added dice included, after the critical.
 */
export function foldedDamage(record: RollRecord, folds: Pick<Folds, "damageAdd" | "multiply">): RollRecord {
  let out = record;
  if (folds.damageAdd !== 0) out = { ...out, modifier: out.modifier + folds.damageAdd, total: Math.max(0, out.total + folds.damageAdd) };
  if (folds.multiply !== 1) out = { ...out, total: out.total * folds.multiply };
  return out;
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
  // DA2: the Hope Die switch sits outside the recorder, so a held attack replays a d20 Hope Die as drawn.
  const hope = hopeDieSwitch(rec.rng);
  // Plan lanes, E1: the attacker's live card-effect mods (Versatile Fighter's trait, Parallela's extra target).
  const mods = liveMods(sheet0, featureScope(campaign));
  const traitOverride = weaponTraitFor(mods, slot, options.trait);
  const host: Host = { ...hostOf(weapon, slot, options.trait), ...(traitOverride !== undefined ? { trait: traitOverride } : {}) };
  const env: RiderEnv = {
    ctx,
    campaign,
    character,
    scene: req.scene,
    host,
    gmFear: (await campaignFearState(ctx, campaign._id)).fear,
    rng: hope.rng,
    rollUsedExperience: options.experienceIds.length > 0,
  };
  // DA2: damage-phase riders (Death Strike) are prompts after the damage (`damagePrompts`), never run from a toggle.
  const picked = pickRiders(sheet0, campaign, host, req.riders ?? []).filter((r) => r.phase !== "damage");
  const autos = [...autoRiders(sheet0, campaign, host), ...defaultOnRiders(sheet0, campaign, host, options.riseToTheChallenge === false, picked)];
  const folds = emptyFolds();
  const runs: RiderRun[] = [];
  const allTargets: CheckedTarget[] = [...req.targets];
  const pcTargets: PcTarget[] = [];
  const waived = new Set<string>(req.waived ?? []);
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
  const taken = () => new Set<string>([...allTargets.map((t) => t.token._id), ...pcTargets.map((t) => t.token._id)]);
  for (const add of folds.addTargets.splice(0)) {
    const more = await addedTargets(ctx, campaign, req.scene, weapon, add, taken(), main!.encounter._id, waived);
    allTargets.push(...more.adversaries);
    pcTargets.push(...more.pcs);
    for (const t of more.adversaries) halfDamage.set(t.token._id, add.damage === "half");
  }

  // ---- the roll (R1, R9); cover gives one disadvantage (Q2)
  const cover = allTargets.some((t) => t.sight.cover) || pcTargets.some((t) => t.sight.cover);
  const args = attackDuality(weapon, { ...options, modifier: options.modifier + folds.modifier, advantage: options.advantage + folds.advantage }, cover, traitOverride);
  const sheetBeforeRoll = sheet;
  const dualityAt = rec.values.length;
  // DA2: Rise to the Challenge's d20 Hope Die (CB p.48), on by default while it applies; the Hope Die is drawn first.
  hope.arm(folds.hopeDie);
  const duality = await resolveDuality(ctx, { ...loaded, sheet: sheetBeforeRoll }, args, hope.rng, false);
  hope.arm(undefined);
  let roll = withHopeSides(duality.roll, folds.hopeDie);
  let effects = duality.effects;
  let finalSheet = duality.next;
  // Plan lanes, E1: a bonus on one duality die (dcm-3ou, dcm-jog) changes the roll, so its Hope, Stress and Fear follow it.
  if (folds.dieBonus.length > 0) {
    for (const b of folds.dieBonus) roll = withDieBonus(roll, b.die, b.amount);
    effects = dualityEffects("action", roll.outcome);
    finalSheet = placeTideToken(applyDualityEffects(duality.paid, effects), roll.outcome, "action").sheet;
  }
  let rolled = { ...duality.rolled, roll };
  let forced = false;
  const hitsOf = (r: RollRecord) => resolveHits(r.total, r.outcome === "critical", allTargets.map((t) => ({ id: t.token._id, difficulty: difficultyOf(t.instance) })));
  let hits = hitsOf(roll);
  const pcHitsOf = (r: RollRecord, more: readonly PcTarget[] = pcTargets) => resolveHits(r.total, forced || r.outcome === "critical", more.map((t) => ({ id: t.token._id, difficulty: t.evasion })));
  const hostRollOf = (r: RollRecord, h: readonly { hit: boolean }[]): HostRoll => {
    const critical = r.outcome === "critical";
    return { success: forced || h.some((x) => x.hit) || pcHitsOf(r).some((x) => x.hit), critical, withHope: critical || r.outcome === "successHope" || r.outcome === "failHope", withFear: r.outcome === "successFear" || r.outcome === "failFear" };
  };

  // ---- the after-roll step (Q1): hold the attack when an after-roll feature is ready and affordable
  let afterRun: RiderRun | null = null;
  if (req.held === undefined) {
    const offers = afterRollOffers(duality.next, campaign, host, roll, hostRollOf(roll, hits), main, env.rollUsedExperience, req.scene.attacker);
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
          action: {
            kind: "attack",
            slot,
            targetTokenIds: req.targets.map((t) => t.token._id),
            roll: options,
            ...(req.riders && req.riders.length > 0 ? { riders: [...req.riders] } : {}),
            ...(req.waived && req.waived.length > 0 ? { waived: [...req.waived] } : {}),
          },
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
      hope.arm(folds.hopeDie);
      const again = await resolveDuality(ctx, { ...loaded, sheet: sheetBeforeRoll }, { ...args, advantage: args.advantage + (change.advantage ? 1 : 0) }, hope.rng, false);
      hope.arm(undefined);
      roll = withHopeSides(again.roll, folds.hopeDie);
      rolled = { ...again.rolled, roll };
    } else {
      const changed = changedRecord(roll, change, hope.rng);
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
    const onTarget = rollTargetHolds(r.trigger, host, req.scene.attacker, main ? subjectOf(main) : undefined);
    if (!resultHolds(r.trigger, hostRoll) || !onTarget || (!rollOnly(r.trigger) && ids.length === 0)) {
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
    const more = await addedTargets(ctx, campaign, req.scene, weapon, add, taken(), main!.encounter._id, waived);
    const moreHits = resolveHits(roll.total, critical || forced, more.adversaries.map((t) => ({ id: t.token._id, difficulty: difficultyOf(t.instance) })));
    allTargets.push(...more.adversaries);
    pcTargets.push(...more.pcs);
    hits = [...hits, ...moreHits];
    for (const t of more.adversaries) halfDamage.set(t.token._id, add.damage === "half");
  }
  // Plan lanes, E1 (dcm-1o3): a rider on the GM's Fear from this roll stops it (Dread-Touched).
  if (folds.preventFear === true && effects.fear > 0) effects = { ...effects, fear: 0 };
  const pcHits = pcHitsOf(roll);
  const anyHit = hits.some((h) => h.hit) || pcHits.some((h) => h.hit);

  // ---- R2: one damage roll after the attack's costs and gains; a critical adds the dice's maximum
  const sneak = sneakAttackApplies(sheet0, req.scene, allTargets.filter((_, i) => hits[i]!.hit));
  const damageOptions = damageOptionsFor(sheet0, campaign, options.damageOptions ?? [], sneak);
  let damageRecord: RollRecord | null = null;
  let damageLabel = "";
  if (anyHit) {
    const proficiency = sheet.proficiency;
    const rolledDamage = await resolveDamage(ctx, { ...loaded, sheet: { ...sheet, proficiency: proficiency + folds.proficiency } }, { source: { kind: "weapon", slot }, critical, modifier: 0, options: damageOptions }, hope.rng, false);
    sheet = { ...rolledDamage.paid, proficiency };
    damageRecord = foldedDamage(rolledDamage.roll, folds);
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
  // A PC a rider added (Surrounded, allies included): the same roll against their Evasion; on a hit the damage opens their
  // incoming-hit window (armor, reactions) in this attack's group, as card damage to another PC does (AA2b).
  const pcHitTotals: { target: PcTarget; amount: number }[] = [];
  for (const [i, t] of pcTargets.entries()) {
    const hit = pcHits[i]!.hit && damageRecord !== null;
    publicParts.push(`${t.sheet.name}: ${hit ? "Hit" : "Miss"}`);
    if (!hit) {
      gmParts.push(`${t.sheet.name}: miss (${roll.total} vs Evasion ${t.evasion})`);
      continue;
    }
    const amount = t.half ? Math.ceil(damageRecord!.total / 2) : damageRecord!.total;
    pcHitTotals.push({ target: t, amount });
    gmParts.push(`${t.sheet.name}: ${amount} ${SHORT_TYPE[type]}${t.half ? " (half)" : ""} → their reaction window`);
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
  const qualifying = (r: PickedRider) => {
    const severity = r.trigger.kind === "whenTargetMarksHp" || r.trigger.kind === "whenEnemyTakesDamage" ? r.trigger.severity : undefined;
    return anyHit ? results.filter((x) => x.hit && x.hpMarked > 0 && standing(x) && (severity === undefined || x.severity === severity)) : [];
  };
  // Automatic damage-phase uses (Ruthless Predator's Severe Stress) run on the first creature that qualifies.
  for (const r of autos.filter((x) => x.phase === "damage")) {
    const subject = qualifying(r)[0];
    if (subject === undefined) continue;
    const id = subject.target.token._id;
    const run = await runRiderPart(env, r, sheet, "whole", hostRoll, [id], subject.target, id);
    if (run === null || run === "empty") continue;
    await writeRun(run);
    posts.push(run);
  }
  // Plan lanes, E1: the allies' automatic uses on this roll (Eclipse for an ally's success with Hope, dcm-0gi).
  const allyRuns = await allyAutoRuns(ctx, campaign, req.scene, character._id, host, hostRoll, main ? subjectOf(main) : undefined, results.filter((x) => x.hit && standing(x)).map((x) => x.target.token._id), hope.rng);
  const allySheets = new Map<string, { character: Doc<"characters">; before: CharacterSheet; after: CharacterSheet }>();
  for (const a of allyRuns) {
    const writes = instanceWrites(a.run.plan, a.run.built.creatures, a.run.name);
    await writeInstances(ctx, writes);
    riderWrites.push(...writes);
    const lines = gmLines(a.run.plan, a.run.built, writes);
    riderLines.push(`${a.run.name} (${readSheet(a.character.sheet).name})${lines.length > 0 ? `: ${lines.join("; ")}` : ""}`);
    riderFear += a.run.plan.gmFearDelta;
    const seen = allySheets.get(a.character._id);
    allySheets.set(a.character._id, { character: a.character, before: seen?.before ?? a.before, after: a.run.sheet });
  }
  // DA2 (HF p.8 Death Strike; user 2026-10-30): a damage-phase rider is never applied without a prompt: the player gets Use /
  // Pass (its cost is optional, "you can"), and picks the ONE creature when several qualify. Opened after the rows below.
  const toPrompt = damagePrompts(sheet0, campaign, host).flatMap((r) => {
    const candidates = qualifying(r).map((x) => x.target.token._id);
    return candidates.length > 0 ? [{ rider: r, candidates }] : [];
  });

  // ---- the after-roll feature's own effects (Ranger's Focus ends on its target)
  if (afterRun !== null) {
    const writes = instanceWrites(afterRun.plan, afterRun.built.creatures, afterRun.name);
    await writeInstances(ctx, writes);
    riderWrites.push(...writes);
    riderFear += afterRun.plan.gmFearDelta;
  }

  // ---- CB p.42: "After you make an attack … you are no longer Cloaked."
  sheet = uncloaked(sheet);
  // Plan lanes, E1 (dcm-y3e): an effect that gave this attack its extra target ends with it (Parallela, CB p.332: "The next
  // time the target makes an attack"), as does one that ends when its bearer attacks.
  sheet = endedByAttack(sheet, mods);
  finalSheet = sheet;

  const { gained } = effects.fear > 0 ? await gainFear(ctx, campaign._id, effects.fear) : { gained: 0 };
  const fearChanged = gained + (await changeFear(ctx, campaign._id, riderFear));
  const sheetChanged = changed(sheet0, finalSheet);
  if (sheetChanged) await saveSheet(ctx, character._id, finalSheet);

  // U4: each instance as it was before the attack; with its conditions, tags and effects when a rider changed them too.
  const touched = new Set<string>(riderWrites.map((w) => w.before.instanceId));
  const before: AdversaryBefore[] = snapshots.map((i) => (touched.has(i._id) ? adversaryBefore(i, true) : beforeOf(i)));
  const groupId = newGroupId();
  for (const { target, amount } of pcHitTotals) {
    await openIncomingHit(ctx, {
      campaignId: campaign._id,
      encounterId: main!.encounter._id,
      mapId: req.scene.map._id,
      createdBy: req.actorId,
      groupId,
      attacker: { kind: "pc", characterId: character._id, label: sheet0.name, cardId: target.rider.id, feature: target.rider.name },
      targetCharacterId: target.character._id,
      targetTokenId: target.token._id,
      hit: { amount, type, direct: false, forcedArmor: 0, critical },
      party: await partyMembers(ctx, campaign._id),
      bands: await bandsOnMap(ctx, req.scene.map._id),
    });
  }
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
  // Plan lanes, E1: an ally whose automatic use ran on this roll: their sheet in the group (undo reverts it).
  for (const a of allySheets.values()) {
    if (!changed(a.before, a.after)) continue;
    await saveSheet(ctx, a.character._id, a.after);
    await logAction(ctx, { campaignId: campaign._id, characterId: a.character._id, actorId: req.actorId, kind: "feature", visibility: "public", summary: `${a.before.name}: ${allyRuns.filter((r) => r.character._id === a.character._id).map((r) => r.run.name).join(", ")} on ${sheet0.name}'s roll`.slice(0, 1000), groupId, before: a.before, undoable: true });
  }

  // Armed countdowns tick right after the attack roll, as for `actionRoll` (countdowns-advanced K1, CB p.162).
  if (countsAsActionRoll(roll, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: roll.outcome, actorId: req.actorId });
  }

  const minionOffer = extra > 0 ? await offerMinions(ctx, req, { groupId, entryId, extra, total: roll.total, critical }) : null;
  const riderPicks: Infer<typeof riderPickOfferValidator>[] = [];
  for (const { rider, candidates } of toPrompt) {
    const requestId = await openRiderPick(ctx, {
      campaignId: campaign._id,
      encounterId: main!.encounter._id,
      mapId: req.scene.map._id,
      createdBy: req.actorId,
      payload: { schemaVersion: 1, kind: "riderPick", characterId: character._id, groupId, entryId, rider: { source: rider.source, id: rider.id, useId: rider.useId, name: rider.name }, candidates, hostRoll },
    });
    riderPicks.push({ requestId, name: rider.name, candidates });
  }
  const prompts = afterDualityRoll(finalSheet, { hope: rolled.hope, fear: rolled.fear, roll }, CLASS_FEATURES, duality.scope);
  const outcomes = [
    ...results.map((r) => ({ tokenId: r.target.token._id, hit: r.hit, defeated: r.defeated })),
    ...pcTargets.map((t, i) => ({ tokenId: t.token._id, hit: pcHits[i]!.hit && damageRecord !== null, defeated: false })),
  ];
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
    ...(riderPicks.length > 0 ? { riderPicks } : {}),
  };
}

/**
 * DA2: the damage-phase rider uses the attacker holds and can use now (a loadout card's or a held feature's `rider` use
 * whose trigger is the damage it deals: Death Strike, HF p.8). Each becomes a Use / Pass prompt after the damage.
 */
export function damagePrompts(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host): PickedRider[] {
  const out: PickedRider[] = [];
  for (const cardId of sheet.domainCards.loadout) {
    const effect = cardEffect(cardId);
    if (effect === undefined || cardUsage(cardId) === "outOfCombat") continue;
    for (const { use, trigger, phase } of riderUses(effect.uses, host, ["rider"])) {
      if (phase !== "damage" || keyAvailability(sheet, featureUseKey(cardId, use.id), use.limit).state !== "ready") continue;
      out.push({ source: "card", id: cardId, useId: use.id, name: use.name === "main" ? (getDomainCard(cardId)?.name ?? cardId) : use.name, trigger, phase, choices: [], auto: false });
    }
  }
  const held = ownedHere(sheet, campaign);
  for (const { feature, entry } of heldEntries(sheet, campaign)) {
    const raw = featureEffect(feature.featureId)!;
    for (const { use, trigger, phase } of riderUses(entry.uses, host, ["rider"])) {
      if (phase !== "damage" || featureAvailability(sheet, raw, use.id, { holdings: holdingsFor(sheet, held, raw.owner) }).state !== "ready") continue;
      out.push({ source: "feature", id: feature.featureId, useId: use.id, name: use.name, trigger, phase, choices: [], auto: false });
    }
  }
  return out;
}

/**
 * DA2 (HF p.8 Death Strike: "When you deal Severe damage to a creature, you can mark a Stress to force them to mark an
 * additional Hit Point"; user 2026-10-30): answers a `riderPick` prompt. `pass`: nothing paid. `use`: the rider runs on the
 * ONE picked candidate (its cost paid now; a refusal such as CARD_COST_UNPAID leaves the prompt open), logged into the
 * attack's group, so undoing the attack undoes it too. The prompt of an undone attack is declined. INVALID for a token
 * that isn't a candidate; COMBAT_TARGET_INVALID when the creature is no longer standing.
 */
export async function answerRiderPick(ctx: MutationCtx, loaded: Loaded, row: Doc<"combatRequests">, choice: RiderPickChoice, actorId: Id<"users">): Promise<"resolved" | "passed" | "declined"> {
  if (row.payload.kind !== "riderPick") throw appError("NOT_FOUND");
  const p = row.payload;
  const { campaign, character } = loaded;
  const entry = await ctx.db.get("actionLog", p.entryId);
  if (entry === null || entry.undoneAt !== undefined || row.mapId === undefined) {
    await closeRequest(ctx, row._id, "declined", actorId);
    return "declined";
  }
  if (choice.kind === "pass") {
    await closeRequest(ctx, row._id, "resolved", actorId);
    return "passed";
  }
  if (!p.candidates.includes(choice.tokenId)) throw appError("INVALID", "Pick one of the creatures that took the damage.");
  const uses = p.rider.source === "card" ? cardEffect(p.rider.id)?.uses : featureEffect(p.rider.id)?.uses;
  const use = uses?.find((u) => u.id === p.rider.useId);
  if (use === undefined || (use.activation.kind !== "rider" && use.activation.kind !== "auto")) throw appError("INVALID");
  const scene = await attackScene(ctx, campaign, character, row.mapId);
  const index = scene.scene.tokens.findIndex((t) => t._id === choice.tokenId);
  const token = scene.scene.tokens[index];
  const linked = token ? await adversaryInstance(ctx, campaign._id, token) : null;
  if (token === undefined || linked === null) throw appError("COMBAT_TARGET_INVALID");
  const target: CheckedTarget = { token, ...linked, check: rangeCheck(scene.attacker, token, "melee"), sight: sightTo(scene, token) };
  const host: Host = { spec: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } }, trait: undefined, weapon: true, weaponRange: null, damageType: "physical" };
  const env: RiderEnv = { ctx, campaign, character, scene, host, gmFear: (await campaignFearState(ctx, campaign._id)).fear, rng: rollDie, rollUsedExperience: false };
  const rider: PickedRider = { source: p.rider.source, id: p.rider.id, useId: p.rider.useId, name: p.rider.name, trigger: use.activation.trigger, phase: "damage", choices: [], auto: false };
  const run = await runRiderPart(env, rider, loaded.sheet, "whole", p.hostRoll, [token._id], target, token._id);
  if (run === null || run === "empty") throw appError("INVALID");
  const writes = instanceWrites(run.plan, run.built.creatures, run.name);
  await writeInstances(ctx, writes);
  const lines = gmLines(run.plan, run.built, writes);
  const fearDelta = await changeFear(ctx, campaign._id, run.plan.gmFearDelta);
  const sheetChanged = changed(loaded.sheet, run.sheet);
  if (sheetChanged) await saveSheet(ctx, character._id, run.sheet);
  await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId,
    kind: "combat",
    visibility: "public",
    summary: `${loaded.sheet.name} uses ${run.name} on ${linked.instance.label}`.slice(0, 1000),
    groupId: p.groupId,
    ...(sheetChanged ? { before: loaded.sheet } : {}),
    ...(fearDelta !== 0 ? { fearDelta } : {}),
    undoable: true,
  });
  await logAction(ctx, {
    campaignId: campaign._id,
    actorId,
    kind: "combat",
    visibility: "gm",
    summary: `${loaded.sheet.name} · ${run.name} → ${lines.join("; ") || linked.instance.label}`.slice(0, 1000),
    groupId: p.groupId,
    ...(writes.length > 0 ? { adversaryBefore: writes.map((w) => w.before) } : {}),
    undoable: true,
  });
  await closeRequest(ctx, row._id, "resolved", actorId);
  return "resolved";
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
