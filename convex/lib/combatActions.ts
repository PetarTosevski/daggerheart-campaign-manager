/**
 * Weapon attacks on the Combat Map (plan combat-actions, tracer CA3): the shared steps behind `combatActions.attack`,
 * `combatActionsReads.targets`, `combatActions.pickMinions` and the GM's sanction (`combatRequests.sanction`). Callers are
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

import { featureUseKey, keyAvailability, requirementMet, stateCheckMet, type CreatureFacts } from "../../src/lib/domain/card-effects/availability";
import { rollMatches, run as runCardUse, type PlanStep, type RunPlan } from "../../src/lib/domain/card-effects/run";
import { rangeAsk } from "../../src/lib/domain/card-effects/rule-notes";
import type { AttackedRider, CardUse, CreatureKey, DamageKeyword, DamageType, Mod, Range, RollFilter, RollResult, RollSpec, Step, TargetSpec, Trigger } from "../../src/lib/domain/card-effects/types";
import { adversaryNumberEnv, passiveSummary, type PassiveSummary } from "../../src/lib/domain/adversary-actions/index";
import { conditionName, conditionStepsOf, lastingModsOf } from "../../src/lib/domain/adversary-effects/run";
import { resolveNumber } from "../../src/lib/domain/combat-actions/numbers";
import { adversaryEffects, allAdversaryEffects } from "../../src/lib/srd/adversary-effects/index";
import { lineOfSight, RANGE_ORDER, rangeCheck, rangeFromWeapon, resolveHits, applyDamageTo, tokenDistance, type Combatant, type DamageResult, type RangeCheck, type SightResult } from "../../src/lib/domain/combat-actions/index";
import { damageRuleNotes, minionNote, minionPicker, type DamageRuleNote } from "../../src/lib/domain/combat-actions/damage";
import { sightRule } from "../../src/lib/domain/combat-actions/sight";
import { darknessEdge, darknessLabels, underwaterDisadvantage } from "../../src/lib/domain/combat-map/light";
import type { ModeOf, RuleModes } from "../../src/lib/rules/registry";
import { tokenVisibility } from "../../src/lib/domain/combat-map/index";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import { afterDualityRoll, rollOptions } from "../../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../../src/lib/domain/class-features/index";
import { advantagePlan, applyDualityEffects, criticalDamageNote, dualityEffects, typedLabel, type Rng } from "../../src/lib/domain/dice/index";
import { actionOutcome, type RollRecord } from "../../src/lib/domain/duality";
import { holdingsFor, owned, type OwnedFeature } from "../../src/lib/domain/feature-effects/owned";
import { actorExtras, featureAvailability, featureCostShort, flagsOf } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { applyUpgrades } from "../../src/lib/domain/feature-effects/upgrades";
import { SEVERITY_LABEL } from "../../src/lib/domain/encounters/damage";
import { minionValue } from "../../src/lib/domain/adversaries/index";
import { placeTideToken, rollGaveHope, WITH_HOPE } from "../../src/lib/domain/session-features/index";
import { appError } from "../../src/lib/errors/app-error";
import { TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import { srdAdversary } from "../../src/lib/srd/adversary-lookup";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import { allCardEffects, cardEffect, cardUsage } from "../../src/lib/srd/card-effects/index";
import { allFeatureEffects, featureEffect } from "../../src/lib/srd/feature-effects/index";
import { getDomainCard, getWeapon } from "../../src/lib/srd/index";
import type { DomainId, TraitId, Weapon } from "../../src/lib/srd/types";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import type { EndRoll, EndSeverity } from "../../src/lib/domain/characters/expiry";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { attachResultPanel, logAction, newGroupId } from "./actionLog";
import { parseChoices, type CardChoice, type ParsedChoices } from "./cardChoices";
import { adversaryBefore, cardPromptValidator, endAdversaryConditionsForCaster, endAdversaryConditionsOnRoll, endForCasterOnInstances, endForCasterOnSheets, endOnDefeat, endOnInstance, endOnSheet, gmLines, holdsSource, instanceEffectSource, instanceWrites, lastHpNotes, promptsOf, srdUses, writeInstances, type CardPrompt, type InstanceWrite, type SourceLookup } from "./cardRows";
import { adversaryState, blockOf as adversaryBlockOf, riderStepsText } from "./adversaryFeatures";
import { activeAreasOnMap, memberConditionsFor, observerConditions } from "./combatAreas";
import {
  actorSheetAfter,
  bindGates,
  buildRun,
  cardActor,
  conditionMarkerOf,
  conditionSources,
  endConditionsOnRoll,
  endRollOf,
  endedConditionLine,
  extraSpecs,
  pcCombatant,
  pickCard,
  planHopePaid,
  replaying,
  riderPartRuns,
  riderUse,
  runCard,
  withoutCondition,
  type BuiltRun,
  type HostRoll,
  type RiderPart,
  type UsePick,
} from "./cardRunner";
import { noteHopeSpent, saveSheet } from "./characterSheet";
import { loadCombatMap } from "./combatMaps";
import { loadScene, viewOf, type Scene, type Viewer } from "./combatVision";
import { costText, limitText } from "./featureDrawer";
import { factsOf, ownedHere, pickFeature, withCreatureAreas } from "./featureRunner";
import { featureScope } from "./featureScope";
import { campaignFearState, gainFear, spendFear } from "./fear";
import { afterPcActionRoll, fearWithheldBy } from "./rollAftermath";
import { helpersField, payHelpers, planHelp } from "./helpAnAlly";
import { postRuleNote, ruleModesOf } from "./ruleModes";
import { hiddenAttackNote, hiddenEndsManual, hiddenLabel } from "./combatMovement";
import { closeRequest, openAfterRoll, openMinionOffer, openRiderPick } from "./combatRequests";
import { bandsOnMap, partyMembers } from "./adversaryHits";
import { pcRollAdversaryUses } from "./adversaryActions";
import { openIncomingHit } from "./incomingHits";
import { openRiderAllyPicks, riderHasOwnPicks } from "./allyPicks";
import { readSheet } from "./characterSheet";
import { changed, hopeDieSwitch, liveMods, sheetCarriedMods, prepareDuality, resolveDamage, resolveDuality, retotal, rollResultHolds, rules, sheetBearerMods, withDieBonus, withDieBonuses, withHopeSides, type DualityArgs, type LiveMod, type Loaded } from "./rolls";

// E1.4b: these moved to ./rolls (the plain roll uses them too); re-exported for the existing callers.
export { hopeDieSwitch, withDieBonus, withDieBonuses, withHopeSides };
import type { AdversaryBefore, TargetDamage } from "./validators/actionLog";
import { traitIdValidator } from "./validators/characters";
import { MAX_RIDERS_PER_ATTACK, rangeBandValidator, sanctionRollOptionsValidator, type AfterRollChange, type AfterRollChoice, type AfterRollPayload, type Rider, type RiderPickChoice } from "./validators/combatRequests";
import { rollValidator } from "./validators/actionLog";
import { rollDie } from "./dice";

/** The most targets one attack names (the bound `combatRequests` documents, CD8). */
export const MAX_TARGETS = 20;


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
  /** R7 Book (plan rule-switches WR): the PCs who help; each spends 1 Hope (`planHelp`). Manual uses `help`. */
  helpers: helpersField,
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
  /**
   * Plan lanes-2 wave 9, E1.3b (dcm-xbtw, user answer 2026-10-31): the "Use as Spirit Weapon" check box (CB p.44). Ticked,
   * with an equipped Melee / Very Close weapon and Spirit Weapon held: the attack reaches Close, may take one more target
   * for a Stress, and Sacred Resonance doubles matching damage dice. Ignored otherwise.
   */
  spiritWeapon: v.optional(v.boolean()),
};

export type AttackRoll = {
  trait?: TraitId;
  modifier: number;
  experienceIds: string[];
  advantage: number;
  disadvantage: number;
  help: number;
  helpers?: Id<"characters">[];
  options: string[];
  damageOptions?: string[];
  slayerDice?: number;
  tideTokens?: number;
  riseToTheChallenge?: boolean;
  spiritWeapon?: boolean;
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
  /** The GM's Fear gain; absent for a player while "Players see the GM's Fear" is off (dcm-jh6d.62). */
  fearGained: v.optional(v.number()),
  minionOffer: v.union(v.null(), minionOfferValidator),
  /**
   * Rule switches RC1, D6 variant "GM picks the extra Minions" (not in the books, Q5 a): how many extra Minions the damage
   * can defeat; the GM picks them (the offer waits on the GM's HUD, `minionOffer` is null). Absent otherwise.
   */
  minionsForGm: v.optional(v.number()),
  prompts: v.array(promptValidator),
  /** SD5: the riders that applied (and Sneak Attack, an after-roll feature), by name. */
  riders: v.optional(v.array(v.string())),
  /** SD5: riders the player took whose trigger didn't happen (Hold Them Off on a miss): nothing paid. */
  skipped: v.optional(v.array(v.string())),
  /** SD5: what the riders leave to the table (movement prompts, manual steps). */
  riderPrompts: v.optional(v.array(cardPromptValidator)),
  /** DA2: damage-phase riders waiting for the player's Use / Pass and pick (Death Strike, HF p.8). */
  riderPicks: v.optional(v.array(riderPickOfferValidator)),
  /** FH-AP (user 2026-11-05): riders whose choosers each pick their own option (Rousing Strike), waiting for the picks. */
  allyPicks: v.optional(v.array(v.object({ requestId: v.id("combatRequests"), name: v.string() }))),
});
export type ResolvedAttack = Infer<typeof resolvedAttackValidator>;

/** An attack that waits for the GM (Q1): which targets are out of range and in which band. */
export const pendingAttackValidator = v.object({
  status: v.literal("pending"),
  requestId: v.id("combatRequests"),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

/** `combatActionsReads.targets`: per visible enemy token only the band and whether it can be attacked (U1, CF6). */
export const targetHintValidator = v.object({
  tokenId: v.id("combatTokens"),
  band: rangeBandValidator,
  inRange: v.boolean(),
  lineOfSight: v.boolean(),
  cover: v.boolean(),
  /**
   * E1.4b (dcm-kso9): what this target's riders let the attacker pick before rolling (Lead by Example, CB p.342: clear a
   * Stress or gain a Hope). Absent: none. Names only (U1).
   */
  benefits: v.optional(v.array(v.object({ label: v.string(), options: v.array(v.object({ id: v.string(), label: v.string() })) }))),
});

// ---------------------------------------------------------------- the scene around the attacker

export type AttackScene = {
  map: Doc<"combatMaps">;
  scene: Scene;
  viewer: Viewer;
  attacker: Doc<"combatTokens">;
  /**
   * Rule switches ODR: the campaign's Defined Ranges (CB p.103 optional rule). False: no range check refuses or waits
   * for the GM (`rangesOn`). Absent (a scene built without `attackScene`) = on, today's behaviour.
   */
  definedRanges?: boolean;
};

/** Rule switches ODR: whether the scene's range checks count squares (Defined Ranges on; absent = on). */
export function rangesOn(s: Pick<AttackScene, "definedRanges"> | null | undefined): boolean {
  return s?.definedRanges !== false;
}

/**
 * Plan rule-switches OE / OE2: what the environment adds to a PC's weapon attack roll. M3 `darkness` (CB p.104; user
 * answers Q6, 2026-11-05, and 2026-11-06: "dim-light variants affect EVERY PC action roll with a Difficulty"): in the
 * campaign's dim light any attack, Melee too, gets a disadvantage die ("disadvantage", "both") and / or
 * `darknessDifficulty` added to each target's Difficulty or Evasion ("difficulty", "both"); Book and Manual add nothing
 * (`darknessEdge`). Underwater (optional rule, CB p.168): the live map marked Underwater gives one disadvantage unless the
 * attacker's token "fights underwater". `labels` name what applied, for the roll's public line.
 */
export function attackEnvironment(
  s: Pick<AttackScene, "map" | "attacker"> & { scene: Pick<Scene, "light"> },
  modes: Pick<RuleModes, "darkness" | "darknessDifficulty" | "underwater">,
): { disadvantage: number; difficulty: number; labels: string[] } {
  const dark = darknessEdge(s.scene.light, modes.darkness, modes.darknessDifficulty);
  const water = underwaterDisadvantage(modes.underwater && s.map.underwater === true, s.attacker.fightsUnderwater === true);
  const labels = [...darknessLabels(dark), ...(water > 0 ? ["underwater: disadvantage"] : [])];
  return { disadvantage: dark.disadvantage + water, difficulty: dark.difficulty, labels };
}

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
  return { map, scene, viewer, attacker: scene.tokens[viewer.index]!, definedRanges: ruleModesOf(campaign).definedRanges };
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

/** `combatActionsReads.targets`: every enemy token the character sees that can be attacked, with its band and hints. */
export async function targetHints(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon | undefined, attacker?: { sheet: CharacterSheet; characterId: string }): Promise<Infer<typeof targetHintValidator>[]> {
  const hints: Infer<typeof targetHintValidator>[] = [];
  // Rule switches ODR: Defined Ranges off marks every target in range (the GM judges by eye).
  const ranges = ruleModesOf(campaign).definedRanges;
  for (const [i, token] of s.scene.tokens.entries()) {
    if (i === s.viewer.index || token.side !== "enemy" || !seenBy(s, i)) continue;
    const linked = await enemyInstance(ctx, campaign._id, token);
    if (linked === null) continue;
    const check = rangeCheck(s.attacker, token, weapon ? rangeFromWeapon(weapon.range) : "melee", ranges);
    const sight = sightTo(s, token);
    // E1.4b (dcm-kso9): the rider benefits the attacker would get on this target.
    const benefits = attacker ? riderBenefits(instanceAttackedRiders(linked.instance, attacker.sheet, { tokenId: s.attacker._id, characterId: attacker.characterId })) : [];
    hints.push({ tokenId: token._id, band: check.band, inRange: weapon !== undefined && check.inRange, lineOfSight: sight.lineOfSight, cover: sight.cover, ...(benefits.length > 0 ? { benefits } : {}) });
  }
  // Plan rule-switches OP (optional rule "Conflict between PCs", CB p.168): with the rule on, the other PCs' tokens the
  // character sees can be attacked too (against their Evasion).
  if (ruleModesOf(campaign).pcConflict) {
    for (const [i, token] of s.scene.tokens.entries()) {
      if (i === s.viewer.index || !isPcToken(token) || !seenBy(s, i)) continue;
      const check = rangeCheck(s.attacker, token, weapon ? rangeFromWeapon(weapon.range) : "melee", ranges);
      const sight = sightTo(s, token);
      hints.push({ tokenId: token._id, band: check.band, inRange: weapon !== undefined && check.inRange, lineOfSight: sight.lineOfSight, cover: sight.cover });
    }
  }
  return hints;
}

/** A PC's own token (side `pc`, linked to a character). */
function isPcToken(token: Doc<"combatTokens">): token is Doc<"combatTokens"> & { ref: { kind: "pc"; characterId: Id<"characters"> } } {
  return token.side === "pc" && token.ref.kind === "pc";
}

// ---------------------------------------------------------------- checking the targets

export type CheckedTarget = {
  token: Doc<"combatTokens">;
  instance: Doc<"encounterAdversaries">;
  encounter: Doc<"encounters">;
  check: RangeCheck;
  sight: SightResult;
  /** Rule switches RC1, M1 Manual: the attacker's view doesn't show the token (dark, behind them); let through, the GM is told. */
  unseen?: true;
};

/**
 * M1 (CB p.104) for one named target: Book refuses a token the attacker doesn't see or has no line to
 * (COMBAT_NO_LINE_OF_SIGHT); Manual lets it through (`unseen` when the view doesn't show it). Null = refused.
 */
function sightAllows(mode: ModeOf<"lineOfSight">, seen: boolean, sight: SightResult): { unseen?: true } | null {
  if (sightRule("", sight, mode, seen).refused) return null;
  return seen ? {} : { unseen: true };
}

/**
 * Rule switches RC1, M1: whether cover gives the attack its disadvantage (Book: any target in cover, CB p.104; Manual:
 * never, the GM is told). The attack's own check and its GM sanction's pre-check read it.
 */
export function coverApplies(campaign: Pick<Doc<"campaigns">, "frameId" | "ruleModes">, targets: readonly Pick<CheckedTarget, "sight" | "unseen">[]): boolean {
  const mode = ruleModesOf(campaign).lineOfSight;
  return targets.some((t) => sightRule("", t.sight, mode, t.unseen !== true).cover);
}

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
export async function checkTargets(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon, tokenIds: readonly Id<"combatTokens">[], roll: Pick<AttackRoll, "spiritWeapon"> = {}, reach = 0): Promise<CheckedTarget[]> {
  return (await checkAll(ctx, campaign, s, weapon, tokenIds, roll, reach, false)).adversaries;
}

/**
 * Plan rule-switches OP (optional rule "Conflict between PCs", CB p.168: "On an attack roll against a PC, the attacker
 * rolls against the defender's Evasion, just like an adversary"): `checkTargets`, where with the rule on another PC's
 * token is a target too (`pcs`: seen with a clear line like any target, its Evasion read from the sheet, its range check
 * kept). Off: exactly `checkTargets` (a PC token is COMBAT_TARGET_INVALID).
 */
export async function checkAttackTargets(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  s: AttackScene,
  weapon: Weapon,
  tokenIds: readonly Id<"combatTokens">[],
  roll: Pick<AttackRoll, "spiritWeapon"> = {},
  reach = 0,
): Promise<{ adversaries: CheckedTarget[]; pcs: PcTarget[] }> {
  return checkAll(ctx, campaign, s, weapon, tokenIds, roll, reach, ruleModesOf(campaign).pcConflict);
}

async function checkAll(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  s: AttackScene,
  weapon: Weapon,
  tokenIds: readonly Id<"combatTokens">[],
  roll: Pick<AttackRoll, "spiritWeapon">,
  reach: number,
  pcsAllowed: boolean,
): Promise<{ adversaries: CheckedTarget[]; pcs: PcTarget[] }> {
  // E1.3b (dcm-xbtw): a ticked Spirit Weapon reaches Close and may take one more target (its Stress is paid in the attack).
  const spirit = roll.spiritWeapon === true && (await spiritWeaponFor(ctx, campaign, s, weapon, roll));
  const most = Math.min(MAX_TARGETS, WEAPON_ATTACK_TARGETS + (spirit ? 1 : 0) + (await extraAttackTargets(ctx, campaign, s)));
  if (tokenIds.length === 0 || tokenIds.length > most || new Set(tokenIds).size !== tokenIds.length) throw appError("COMBAT_TARGET_INVALID");
  // E1.4b (dcm-lbai): a reach picked with the attack widens its own range check (`setupReach`).
  const range = widenRange(spirit ? "close" : rangeFromWeapon(weapon.range), reach);
  // Rule switches RC1, M1 Manual: an unseen target is let through (the GM is told); one that isn't a target still
  // answers COMBAT_NO_LINE_OF_SIGHT, so an unseen token answers as before whatever it is.
  const sightMode = ruleModesOf(campaign).lineOfSight;
  const checked: CheckedTarget[] = [];
  const pcs: PcTarget[] = [];
  for (const id of tokenIds) {
    const index = s.scene.tokens.findIndex((t) => t._id === id);
    if (index < 0 || index === s.viewer.index) throw appError("COMBAT_TARGET_INVALID");
    const token = s.scene.tokens[index]!;
    const seen = seenBy(s, index);
    const sight = sightTo(s, token);
    const allowed = sightAllows(sightMode, seen, sight);
    if (allowed === null) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    // Plan rule-switches OP: another PC's token, with "Conflict between PCs" on (CB p.168).
    if (pcsAllowed && isPcToken(token)) {
      const character = await ctx.db.get("characters", token.ref.characterId);
      if (character === null || character.campaignId !== campaign._id) throw appError("COMBAT_TARGET_INVALID");
      const sheet = readSheet(character.sheet);
      pcs.push({ token, character, sheet, evasion: pcCombatant(token._id, sheet).evasion ?? 0, sight, half: false, check: rangeCheck(s.attacker, token, range, ruleModesOf(campaign).definedRanges) });
      continue;
    }
    const linked = await enemyInstance(ctx, campaign._id, token);
    if (linked === null) throw appError(seen && sight.lineOfSight ? "COMBAT_TARGET_INVALID" : "COMBAT_NO_LINE_OF_SIGHT");
    // Rule switches ODR: Defined Ranges off, every target is in range (no refusal, no GM sanction for range).
    checked.push({ token, ...linked, check: rangeCheck(s.attacker, token, range, ruleModesOf(campaign).definedRanges), sight, ...allowed });
  }
  if (new Set(checked.map((c) => c.encounter._id)).size > 1) throw appError("COMBAT_TARGET_INVALID");
  return { adversaries: checked, pcs };
}

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-lbai; user answer 2026-10-31: "the reach option is picked at attack setup and widens the
 * attack's target range"): the range steps the riders taken with the attack add (`modifyRoll` `reach`; Manipulate Magic,
 * CB p.47: "Extend the spell or attack's reach by one range"), counting a `choose` step's options the player picked.
 */
export function setupReach(picked: readonly PickedRider[]): number {
  let reach = 0;
  for (const r of picked) {
    const uses: readonly CardUse[] = r.source === "card" ? (cardEffect(r.id)?.uses ?? []) : (featureEffect(r.id)?.uses ?? []);
    const use = uses.find((u) => u.id === r.useId);
    if (use === undefined) continue;
    const options = parseChoices(r.choices).options;
    const walk = (steps: readonly Step[]): void => {
      for (const st of steps) {
        if (st.kind === "modifyRoll" && st.change.kind === "reach") reach += st.change.steps;
        else if (st.kind === "choose") for (const o of st.options) if ((options[st.id] ?? []).includes(o.id)) walk(o.steps);
      }
    };
    walk(use.steps);
  }
  return Math.max(0, Math.min(reach, RANGE_ORDER.length));
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

/** E1.3b (dcm-xbtw): whether the attacker's ticked Spirit Weapon applies (`spiritWeaponOn` on their sheet). */
async function spiritWeaponFor(ctx: QueryCtx, campaign: Doc<"campaigns">, s: AttackScene, weapon: Weapon, roll: Pick<AttackRoll, "spiritWeapon">): Promise<boolean> {
  if (s.attacker.ref.kind !== "pc") return false;
  const character = await ctx.db.get("characters", s.attacker.ref.characterId);
  if (character === null || character.campaignId !== campaign._id) return false;
  return spiritWeaponOn(readSheet(character.sheet), campaign, weapon, roll);
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
    const def = srdAdversary(instance.source.adversaryId);
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
  /**
   * Plan rule-switches OP ("Conflict between PCs", CB p.168): the other PCs the attacker named (`checkAttackTargets`), hit
   * against their Evasion; on a hit the damage opens their incoming-hit window. Absent: none (`targets` holds one or more).
   */
  pcTargets?: PcTarget[];
  roll: AttackRoll;
  /** SD5: the riders the player took with the attack. */
  riders?: readonly Rider[];
  /** SD5 (Q1): a held attack's answer, with every die it drew before it was held (replayed, so nothing is rerolled). */
  held?: { dice: readonly number[]; answer: AfterRollChoice };
  /** DA2: rider-added targets out of range that the GM approved (Q1). */
  waived?: readonly Id<"combatTokens">[];
  /**
   * Plan rule-switches WF, M4 `outOfRange` Manual (CB p.103): the attack went through with a target out of range; the GM's
   * note ("Mira attacked Theo out of range"), posted in the attack's group with the other notes.
   */
  outOfRangeNote?: string;
  /** E1.4b (dcm-kso9): the option the attacker picked for a target's rider benefit (Lead by Example's Stress or Hope). */
  benefit?: string;
  /**
   * Plan lanes-2 wave 10, E1.4b (dcm-uxsd): the actionLog group the attack's rows join (a forced attack joins the forcing
   * use's group, so undoing that use undoes the attack too). Absent: a new group.
   */
  groupId?: string;
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
 * (Q13). With no target an `against` filter fails. Plan rule-switches ODR3: Defined Ranges off (`definedRanges` false),
 * `against.within` holds (the GM judges by eye).
 */
export function rollTargetHolds(trigger: Trigger, host: Pick<Host, "damage">, from: Doc<"combatTokens"> | undefined, subject: RollSubject | undefined, definedRanges = true): boolean {
  if (trigger.kind !== "afterYouRoll" && trigger.kind !== "afterAllyRolls") return true;
  if (trigger.kind === "afterYouRoll" && trigger.noDamageRoll === true && host.damage === true) return false;
  const against = trigger.against;
  if (against === undefined) return true;
  if (subject === undefined) return false;
  if (against.enemy === true && !subject.enemy) return false;
  if (against.within !== undefined && definedRanges && (from === undefined || !rangeCheck(from, subject.token, against.within).inRange)) return false;
  if (against.creature !== undefined && creatureKeyHolds(against.creature, subject) === false) return false;
  return true;
}

/**
 * Plan lanes-2, E1 (dcm-76l5 (1), dcm-ssf, dcm-ofy): `whenYouDealDamage.within` / `.toEnemy` against the damaged creature:
 * it must be within that range of the actor (Elemental Incarnation, Water, CB p.30: "When you deal damage to an adversary
 * within Melee range"; Dark Army, HF p.181: "a target within Very Close range"). Other triggers hold. ODR3: Defined
 * Ranges off, `within` holds.
 */
export function dealDamageHolds(trigger: Trigger, from: Doc<"combatTokens">, damaged: RollSubject | undefined, definedRanges = true): boolean {
  if (trigger.kind !== "whenYouDealDamage") return true;
  if (trigger.within === undefined && trigger.toEnemy !== true) return true;
  if (damaged === undefined) return false;
  if (trigger.toEnemy === true && !damaged.enemy) return false;
  return trigger.within === undefined || rangeCheck(from, damaged.token, trigger.within, definedRanges).inRange;
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
 * The order the riders' `post` parts run in (dcm-npgb): a card's or feature's automatic uses before the uses of the same
 * card the player picked, everything else as it was. Each post part writes the creatures before the next one reads them,
 * so an automatic use that consumes a mark (Breaking Blow's `extra`, CB p.331: "the next successful attack against that
 * same target deal an extra 2d12 damage", then clear the tag) must see the target as it was before this attack's own
 * rider placed a new one; otherwise it clears the tag the same attack just placed.
 */
export function postOrder<R extends Pick<PickedRider, "source" | "id" | "auto">>(used: readonly R[]): R[] {
  const out: R[] = [];
  const done = new Set<R>();
  for (const r of used) {
    if (done.has(r)) continue;
    if (!r.auto) {
      for (const a of used) {
        if (a.auto && !done.has(a) && a.source === r.source && a.id === r.id) {
          out.push(a);
          done.add(a);
        }
      }
    }
    out.push(r);
    done.add(r);
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
    // FH-AP: a `choose` with `by` is each chooser's own pick after the attack (convex/lib/allyPicks.ts), never asked here.
    options: steps.flatMap((st) => (st.kind === "choose" && st.by === undefined ? [{ id: `opt:${st.id}`, label: st.label, options: st.options.map((o) => ({ id: o.id, label: o.label })) }] : [])),
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
    ...(roll.helpers !== undefined ? { helpers: roll.helpers } : {}),
    options: roll.options ?? [],
    ...(roll.damageOptions !== undefined ? { damageOptions: roll.damageOptions } : {}),
    ...(roll.slayerDice !== undefined ? { slayerDice: roll.slayerDice } : {}),
    ...(roll.tideTokens !== undefined ? { tideTokens: roll.tideTokens } : {}),
    ...(roll.riseToTheChallenge !== undefined ? { riseToTheChallenge: roll.riseToTheChallenge } : {}),
    // E1.4b (dcm-1sk4, V4 widened the stored shape): a held or sanctioned attack keeps the Spirit Weapon box.
    ...(roll.spiritWeapon !== undefined ? { spiritWeapon: roll.spiritWeapon } : {}),
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

/** ODR3: the map situations decided by counting squares; with Defined Ranges off they are the player's to confirm (Q13). */
const RANGE_SITUATIONS: ReadonlySet<string> = new Set(["The target is within Melee range"]);

/** The situations a rider's run confirms: the player's, with the ones the map decides replaced by the map's answer. */
function situationsFor(choices: ParsedChoices, s: AttackScene, target: CheckedTarget | undefined, host: Host): string[] {
  const decides = (text: string) => MAP_SITUATIONS[text] !== undefined && (rangesOn(s) || !RANGE_SITUATIONS.has(text));
  const own = choices.situations.filter((text) => !decides(text));
  const decided = Object.entries(MAP_SITUATIONS).flatMap(([text, check]) => (decides(text) && check(s, target, host) ? [text] : []));
  return [...own, ...decided];
}

/**
 * What NV7 checks read about a creature (`hasCondition` on the target: Apex Predator's Focus). Plan lanes-2, E1 (dcm-aeg):
 * with the scene, `distance` (squares from the attacker; Kick / Tusks, "a target within Melee range") and `nearestAlly`
 * (squares from the creature to the nearest PC or ally token other than the attacker; Sneak Attack, CB p.40: "an ally
 * is within Melee range of the target"). ODR3: with Defined Ranges off neither is known (the player confirms, Q13).
 */
export function creatureFacts(instance: Doc<"encounterAdversaries">, s?: AttackScene, token?: Doc<"combatTokens">) {
  const base = { conditions: instance.conditions, tags: instance.tags, hp: instance.hp, hpMax: instance.stats.hpMax };
  if (s === undefined || token === undefined || !rangesOn(s)) return base;
  let nearestAlly: number | undefined;
  for (const [i, t] of s.scene.tokens.entries()) {
    if (i === s.viewer.index || t._id === token._id || (t.side !== "pc" && t.side !== "ally")) continue;
    const d = tokenDistance(t, token);
    if (nearestAlly === undefined || d < nearestAlly) nearestAlly = d;
  }
  return { ...base, distance: tokenDistance(s.attacker, token), ...(nearestAlly !== undefined ? { nearestAlly } : {}) };
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
  /**
   * Plan lanes-2, E1 (dcm-n0dv): the host roll's Hope and Fear Die once rolled, for a rider's `dualityDie` number
   * (Midnight-Touched, CB p.337: "add the result of your Fear Die"). Set by the caller after the roll.
   */
  hostDice?: { hope: number; fear: number };
  /**
   * Plan rule-switches ODR3: GM-only questions ("Elemental Incarnation: who is within Very Close range?") for what a rider
   * would have picked by range with Defined Ranges off; the caller posts them as `definedRanges` notes in its group.
   */
  rangeNotes?: string[];
};

export type RiderRun = { rider: PickedRider; plan: RunPlan; built: BuiltRun; name: string; sheet: CharacterSheet };

/**
 * Plan lanes-2, E1 (dcm-umti): the creatures an automatic use's `picked` step with count `all` names, picked by the server
 * (Elemental Incarnation, Water, CB p.30: "all other adversaries within Very Close range must mark a Stress"): every
 * creature of the spec's side within its range of the actor (`weapon`: the host's weapon range), the trigger's subject
 * left out with `excludeSubject`. Enemies must be seen with a clear line and stand in a running encounter (as a picked
 * creature is checked); allies are the other PCs' tokens. Any other count is the player's to pick: none.
 * Plan rule-switches ODR3 (user 2026-11-06): with Defined Ranges off a ranged pick (`autoPickRange`) names no one; the
 * caller asks the GM who is in range.
 */
export async function autoPicked(env: Pick<RiderEnv, "ctx" | "campaign" | "scene" | "host">, spec: TargetSpec | undefined, subject: string | undefined): Promise<string[]> {
  if (spec === undefined || spec.count.kind !== "all") return [];
  const s = env.scene;
  const range = spec.range === "weapon" ? (env.host.weaponRange ?? "melee") : spec.range;
  if (range !== "unlimited" && !rangesOn(s)) return [];
  const enemies = spec.side === "enemy" || spec.side === "any";
  const allies = spec.side === "ally" || spec.side === "selfOrAlly" || spec.side === "any";
  const out: string[] = [];
  for (const [i, token] of s.scene.tokens.entries()) {
    if (out.length >= MAX_TARGETS) break;
    if (i === s.viewer.index || (spec.excludeSubject === true && token._id === subject)) continue;
    if (range !== "unlimited" && !rangeCheck(s.attacker, token, range).inRange) continue;
    if (token.side === "enemy" && enemies) {
      if (!seenBy(s, i) || !sightTo(s, token).lineOfSight || (await enemyInstance(env.ctx, env.campaign._id, token)) === null) continue;
      out.push(token._id);
    } else if (token.side === "pc" && token.ref.kind === "pc" && allies) out.push(token._id);
  }
  return out;
}

/** ODR3: the range an automatic `all` pick counts by (null: none, or `unlimited`). */
export function autoPickRange(host: Pick<Host, "weaponRange">, spec: TargetSpec | undefined): Range | null {
  if (spec === undefined || spec.count.kind !== "all") return null;
  const range = spec.range === "weapon" ? (host.weaponRange ?? "melee") : spec.range;
  return range === "unlimited" ? null : range;
}

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-b41o, dcm-7udv, dcm-iia9): the facts a feature rider's checks read: the target's and
 * the trigger subject's (`creatureFacts`) with the live areas their tokens stand in (`withCreatureAreas`; Circle of Power,
 * HF p.16: "you or an ally within the circle"), and the attacking weapon's range (`weapons.attacking`; Surrounded, HF
 * p.10: "an attack with a Melee weapon").
 */
export async function riderFacts(env: Pick<RiderEnv, "ctx" | "campaign" | "scene" | "host">, target: CheckedTarget | undefined, subject: string | undefined): Promise<NonNullable<Parameters<typeof pickFeature>[0]["extraFacts"]>> {
  const targetFacts = target ? await withCreatureAreas(env.ctx, env.scene, target.token, creatureFacts(target.instance, env.scene, target.token)) : undefined;
  let subjectFacts: CreatureFacts | undefined;
  if (subject !== undefined && target !== undefined && subject === target.token._id) subjectFacts = targetFacts;
  else if (subject !== undefined) {
    const token = env.scene.scene.tokens.find((t) => t._id === subject);
    if (token?.ref.kind === "adversary") {
      const instance = await env.ctx.db.get("encounterAdversaries", token.ref.adversaryId);
      if (instance !== null && instance.campaignId === env.campaign._id) subjectFacts = await withCreatureAreas(env.ctx, env.scene, token, creatureFacts(instance, env.scene, token));
    } else if (token?.ref.kind === "pc") {
      const character = await env.ctx.db.get("characters", token.ref.characterId);
      if (character !== null && character.campaignId === env.campaign._id) {
        const sh = readSheet(character.sheet);
        subjectFacts = await withCreatureAreas(env.ctx, env.scene, token, { conditions: sh.conditions, hp: sh.hp, hpMax: sh.hpMax, stress: sh.stress, stressMax: sh.stressMax, hope: sh.hope }, character._id);
      }
    }
  }
  return {
    ...(targetFacts ? { target: targetFacts } : {}),
    ...(subjectFacts ? { subject: subjectFacts } : {}),
    ...(env.host.weaponRange !== null ? { weapons: { attacking: env.host.weaponRange } } : {}),
  };
}

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
      pick = pickFeature({ sheet, campaign: env.campaign, featureId: rider.id, useId: rider.useId, times: 1, rollUsedExperience: env.rollUsedExperience, party: [], transform, extraFacts: await riderFacts(env, target, subject) });
    } else {
      const base = pickCard(sheet, rider.id, rider.useId);
      const use = transform(base.use);
      pick = { ...base, use, effect: { ...base.effect, uses: base.effect.uses.map((u) => (u.id === use.id ? use : u)) } };
    }
    if (part !== "whole" && !riderPartRuns(pick.use, part)) return "empty";
    const choices = parseChoices(rider.choices);
    choices.situations = situationsFor(choices, env.scene, target, env.host);
    // The extra targets of an addTargets rider are checked by the attack itself (`addedTargets`), not as picked creatures.
    // Plan lanes-2, E1 (dcm-umti): an automatic use whose step picks "all" creatures gets them from the map.
    const pickSpec = extraSpecs(pick.use).picked;
    choices.picked = rider.auto ? await autoPicked(env, pickSpec, subject) : [];
    // ODR3: Defined Ranges off, the automatic pick named no one (Elemental Incarnation's "all other adversaries within
    // Very Close range"); the GM is asked who is in range.
    const askRange = rider.auto && !rangesOn(env.scene) ? autoPickRange(env.host, pickSpec) : null;
    if (askRange !== null) env.rangeNotes?.push(rangeAsk(pick.name, askRange));
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
    if (env.hostDice !== undefined && roll !== null) built.context.hostRoll = env.hostDice;
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
  /** E1.3b (dcm-c09o): keywords of added damage ("fire"), for a target's weakness (Made of Straw, HF p.79). */
  keywords: DamageKeyword[];
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
  /**
   * Plan lanes-2, E1 (dcm-76l5 (2), dcm-x7p): ranges the host move reaches farther (`RollChange` `reach`; Manipulate Magic,
   * CB p.47: "Extend the spell or attack's reach by one range"). Widens the range of a rider's added targets that use the
   * host's range (`hostRange`, or `weapon`).
   */
  reach: number;
  minimumSeverity?: "minor" | "major" | "severe";
  /** "mark an additional Hit Point" after the thresholds (Thrive in Chaos, NV4). */
  extraHp: number;
  /** The same roll against more creatures (NV18). */
  addTargets: { rider: PickedRider; count: number; spec: TargetSpec; damage: "same" | "half" }[];
  /** What a rider does that the attack can't fold in, for the feed. */
  unsupported: string[];
};

export function emptyFolds(): Folds {
  return { modifier: 0, advantage: 0, damageAdd: 0, addTypes: [], keywords: [], proficiency: 0, multiply: 1, extraHp: 0, addTargets: [], unsupported: [], dieBonus: [], reach: 0 };
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
        if (ch.keyword) folds.keywords.push(ch.keyword);
      } else if (ch.kind === "proficiency") folds.proficiency += ch.delta;
      else if (ch.kind === "multiply") folds.multiply *= ch.factor;
      else if (ch.kind === "minimumSeverity") folds.minimumSeverity = ch.severity;
      else folds.unsupported.push(`${run.name}: ${ch.kind}`);
    } else if (step.kind === "modifyRoll") {
      const ch = step.change;
      if (ch.kind === "add") folds.modifier += amount;
      else if (ch.kind === "advantage") folds.advantage += 1;
      else if (ch.kind === "hopeDie") folds.hopeDie = ch.sides;
      else if (ch.kind === "reach") folds.reach += ch.steps;
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

/**
 * A PC target of the attack: one a rider added (Surrounded's "additional creatures", allies included: dcm-bxp.99.19.44;
 * `rider` set), or, plan rule-switches OP, one the attacker named with "Conflict between PCs" on (CB p.168; no `rider`,
 * `check` the weapon's range check).
 */
export type PcTarget = { token: Doc<"combatTokens">; character: Doc<"characters">; sheet: CharacterSheet; evasion: number; sight: SightResult; rider?: PickedRider; half: boolean; check?: RangeCheck };

/** Whether a rider's added targets may be any creature (Surrounded, HF p.10: "additional creatures"), allies included. */
function anyCreature(spec: TargetSpec): boolean {
  return spec.side === "any" || spec.side === "ally" || spec.side === "selfOrAlly";
}

/** A range `steps` bands farther along the Defined Ranges (CB p.103), at most Very Far. */
export function widenRange(range: Range, steps: number): Range {
  const i = Math.min(RANGE_ORDER.length - 1, Math.max(0, RANGE_ORDER.indexOf(range) + steps));
  return RANGE_ORDER[i]!;
}

/**
 * The range of a rider's added targets on the map. Plan lanes-2, E1 (dcm-76l5 (2)): `weapon` or `hostRange` is the host
 * attack's range (Manipulate Magic, CB p.47: "Hit an additional target within range"), widened by the riders' `reach`.
 */
export function addRange(spec: TargetSpec, weapon: Weapon, reach = 0): Range {
  if (spec.range === "weapon" || spec.hostRange === true) return widenRange(rangeFromWeapon(weapon.range), reach);
  return spec.range as Range;
}

/**
 * DA2 (combat-actions Q1, user 2026-10-30): the extra targets the riders name (their `picked` choice) that are outside the
 * rider's range, with their band. A player's attack with any of these waits for the GM like card targets; tokens not on
 * the map are left to the attack's own checks.
 */
export function addedOutOfRange(s: AttackScene, weapon: Weapon, picked: readonly PickedRider[]): { tokenId: Id<"combatTokens">; band: RangeCheck["band"] }[] {
  const out: { tokenId: Id<"combatTokens">; band: RangeCheck["band"] }[] = [];
  // Rule switches ODR: Defined Ranges off, no extra target is out of range.
  if (!rangesOn(s)) return out;
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
  /** The attack's encounter; undefined when it named only PCs (plan rule-switches OP): any running encounter's adversary. */
  encounterId: Id<"encounters"> | undefined,
  waived: ReadonlySet<string>,
  reach = 0,
): Promise<{ adversaries: CheckedTarget[]; pcs: PcTarget[] }> {
  const ids = parseChoices(add.rider.choices).picked;
  if (ids.length > add.count || new Set(ids).size !== ids.length) throw appError("COMBAT_TARGET_INVALID", `${add.rider.name}: at most ${add.count} more target(s).`);
  const range = addRange(add.spec, weapon, reach);
  const adversaries: CheckedTarget[] = [];
  const pcs: PcTarget[] = [];
  // Rule switches RC1, M1 Manual: as `checkTargets`, an unseen added target is let through and the GM is told.
  const sightMode = ruleModesOf(campaign).lineOfSight;
  for (const id of ids) {
    const index = s.scene.tokens.findIndex((t) => t._id === id);
    if (index < 0 || index === s.viewer.index || taken.has(id)) throw appError("COMBAT_TARGET_INVALID");
    const token = s.scene.tokens[index]!;
    const sight = sightTo(s, token);
    const allowed = sightAllows(sightMode, seenBy(s, index), sight);
    if (allowed === null) throw appError("COMBAT_NO_LINE_OF_SIGHT");
    const check = rangeCheck(s.attacker, token, range, ruleModesOf(campaign).definedRanges);
    if (!check.inRange && !waived.has(id)) throw appError("COMBAT_TARGET_INVALID", `${add.rider.name}: a target is out of range.`);
    if (anyCreature(add.spec) && token.ref.kind === "pc") {
      const character = await ctx.db.get("characters", token.ref.characterId);
      if (character === null || character.campaignId !== campaign._id) throw appError("COMBAT_TARGET_INVALID");
      const sheet = readSheet(character.sheet);
      pcs.push({ token, character, sheet, evasion: pcCombatant(token._id, sheet).evasion ?? 0, sight, rider: add.rider, half: add.damage === "half" });
      continue;
    }
    const linked = anyCreature(add.spec) ? await adversaryInstance(ctx, campaign._id, token) : await enemyInstance(ctx, campaign._id, token);
    if (linked === null || (encounterId !== undefined && linked.encounter._id !== encounterId)) throw appError("COMBAT_TARGET_INVALID");
    adversaries.push({ token, ...linked, check, sight, ...allowed });
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
export async function allyAutoRuns(ctx: MutationCtx, campaign: Doc<"campaigns">, s: AttackScene, roller: Id<"characters">, host: Host, roll: HostRoll, subject: RollSubject | undefined, hitIds: readonly string[], rng: Rng, rangeNotes?: string[]): Promise<AllyRun[]> {
  const out: AllyRun[] = [];
  // ODR3 (user 2026-11-06): Defined Ranges off, a use whose trigger needs the roller within its range doesn't run on its
  // own; the GM is asked ("Eclipse (Mira): who is within Close range?").
  const ranges = rangesOn(s);
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
      if (ranges && t.range !== undefined && !rangeCheck(token, s.attacker, t.range).inRange) return null;
      if (!hostMatches(t.roll ?? "action", host) || !resultHolds(t, roll) || !rollTargetHolds(t, host, token, subject, ranges)) return null;
      const gate = ranges ? undefined : (t.range ?? t.against?.within);
      if (gate !== undefined) {
        rangeNotes?.push(rangeAsk(`${use.name} (${sheet.name})`, gate));
        return null;
      }
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
    const env: RiderEnv = { ctx, campaign, character, scene, host, gmFear, rng, rollUsedExperience: false, ...(rangeNotes ? { rangeNotes } : {}) };
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
 * Plan rule-switches ODR3 (user 2026-11-06): with Defined Ranges off the ally-in-Melee half is not decided by the map:
 * null ("unknown") unless the attacker is Cloaked; the player's tick decides and the GM is asked (`damageOptionsFor`).
 */
export function sneakAttackApplies(sheet: CharacterSheet, s: AttackScene, targets: readonly CheckedTarget[]): boolean | null {
  if (sheet.conditions.includes("cloaked")) return true;
  if (!rangesOn(s)) return null;
  return s.scene.tokens.some((t, i) => i !== s.viewer.index && (t.side === "pc" || t.side === "ally") && targets.some((target) => rangeCheck(t, target.token, "melee").inRange));
}

const SNEAK_ATTACK = "sneakAttack";

/** ODR3: the GM's question when Defined Ranges is off and the player didn't tick Sneak Attack. */
export function sneakAttackAsk(attacker: string, targets: readonly string[]): string {
  return `Sneak Attack (${attacker}): is an ally within Melee range of ${targets.join(", ")}? If so, add the tier's d6s to the damage.`;
}

/**
 * The damage roll's D5 options with Sneak Attack decided by the map (only where the sheet's class offers it). `sneak`
 * null (ODR3, Defined Ranges off and not Cloaked): the player's tick stands, and `ask` says the GM should be asked.
 */
function damageOptionsFor(sheet: CharacterSheet, campaign: Doc<"campaigns">, chosen: readonly string[], sneak: boolean | null): { options: string[]; ask: boolean } {
  const offered = rollOptions(sheet, "damage", CLASS_FEATURES, featureScope(campaign)).some((o) => o.key === SNEAK_ATTACK);
  if (sneak === null) return { options: offered ? [...chosen] : chosen.filter((k) => k !== SNEAK_ATTACK), ask: offered && !chosen.includes(SNEAK_ATTACK) };
  const rest = chosen.filter((k) => k !== SNEAK_ATTACK);
  return { options: offered && sneak ? [...rest, SNEAK_ATTACK] : rest, ask: false };
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

/**
 * CB p.42 (Rogue, Cloaked): "After you make an attack … you are no longer Cloaked." User R5 (dcm-bxp.99.19.52): an attack
 * does not end Vanishing Act's Cloaked (a sourced Cloaked, `conditionSources`); that one ends on a roll with Fear or the
 * next rest (CB p.42: "You remain Cloaked in this way until you roll with Fear or until your next rest").
 */
export function uncloakedByAttack(sheet: CharacterSheet): CharacterSheet {
  // C2 Book (plan rule-switches RFA, user 2026-11-06; CB p.102 "or you make an attack, you are no longer Hidden"): an
  // ordinary Hidden (no source of its own) ends too.
  let out = sheet;
  for (const c of ["cloaked", "hidden"] as const) {
    if (out.conditions.includes(c) && conditionSources(out, c).length === 0) out = withoutCondition(out, c);
  }
  return out;
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
export function afterRollOffers(sheet: CharacterSheet, campaign: Doc<"campaigns">, host: Host, roll: RollRecord, hostRoll: HostRoll, target: CheckedTarget | undefined, rollUsedExperience: boolean, from?: Doc<"combatTokens">, scene?: AttackScene): AfterRollOffer[] {
  const offers: AfterRollOffer[] = [];
  const hopeDie = roll.dice.find((d) => d.role === "hope")?.value ?? 0;
  const actor = { ...cardActor("self", sheet, "", undefined), ...actorExtras(sheet) };
  // Plan lanes-2, E1 (dcm-aeg): the attacking weapon's range (Surrounded, HF p.10: "an attack with a Melee weapon").
  const own = factsOf(sheet, rollUsedExperience);
  const weapons = host.weaponRange !== null ? { weapons: { ...(own.weapons ?? {}), attacking: host.weaponRange } } : {};
  const facts = { ...own, ...weapons, ...(target ? { target: creatureFacts(target.instance, scene, target.token) } : {}) };
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
      if (!rollTargetHolds(a.trigger, host, from, target ? subjectOf(target) : undefined, scene === undefined || rangesOn(scene))) continue;
      const change = afterRollChangeOf(use);
      if (change === null) continue;
      if (change.kind === "reroll" && change.hopeAtMost !== undefined && hopeDie > change.hopeAtMost) continue;
      if (change.kind === "outcome" && hostRoll.success) continue;
      if (featureAvailability(sheet, entry, use.id, { holdings }).state !== "ready") continue;
      // E1.4b (dcm-b41o): the payer's flags (Ravenous's cannotSpendHope, HF p.94) keep a cost it can't pay out.
      if (featureCostShort(actor, use, Object.fromEntries((use.choices ?? []).map((c) => [c.id, c.min])), payerFlags(sheet, campaign)).length > 0) continue;
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

/** A made roll as E6's end engine reads it, with what the caller knows besides its outcome (dcm-wn7). */
export function endRollFor(record: RollRecord, extra: Omit<EndRoll, "kind" | "success" | "duality">): EndRoll | null {
  const base = endRollOf(record, extra.attack);
  return base === null ? null : { ...base, ...extra };
}

const SEVERITY_RANK: Readonly<Record<EndSeverity, number>> = { none: 0, minor: 1, major: 2, severe: 3 };

/**
 * Plan lanes-2, E1 (dcm-wn7): the effect ends a weapon attack sets off, on top of the condition markers
 * (`endConditionsOnRoll`) and Parallela (`endedByAttack`):
 * (1) the attacker's own effects that end on this roll (`EndRoll` with the weapon slot, trait and `targetsCreature`:
 *     Menacing Reach, HF p.15: "a successful attack with that weapon"; duration `nextRoll`; `bearerAttacks`);
 * (2) caster side, the instances' modifiers this attacker's token made that end on its roll (Timejammer, CB p.334: "the
 *     next time you make an action roll that targets another creature");
 * (3) on each instance the attack hit, its modifiers that end on taking damage (Slumber, CB p.332: "until they take
 *     damage"); on the attacker, `damageDealt` with the worst severity dealt (Patron's Fury, HF p.15);
 * (4) for each instance this attack defeated, the attacker's effects tied to its tag (Marked for Death, HF p.8).
 * Party members' sheets (a caster-side end on an ally's effect, another PC's Marked for Death) are not changed here.
 * `touched`: instances whose modifiers changed (the GM row snapshots them with their effects); `casterBefore`: the
 * caster-side instances as they were.
 */
export async function endsFromAttack(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  attackerTokenId: Id<"combatTokens">,
  sheet0: CharacterSheet,
  record: RollRecord,
  at: { slot: WeaponSlot; trait: TraitId | undefined; results: readonly TargetResult[]; alreadyDefeated: ReadonlySet<string> },
): Promise<{ sheet: CharacterSheet; lines: string[]; gmLines: string[]; touched: string[]; casterBefore: AdversaryBefore[]; endRoll: EndRoll | null; worst: EndSeverity }> {
  let sheet = sheet0;
  const lines: string[] = [];
  const gm: string[] = [];
  const touched: string[] = [];
  const notMarker = (e: Effect) => conditionMarkerOf(e) === null;
  const endRoll = endRollFor(record, { attack: "weapon", weapon: at.slot, ...(at.trait !== undefined ? { trait: at.trait } : {}), targetsCreature: at.results.length > 0 });
  if (endRoll !== null) {
    const own = endOnSheet(sheet, { kind: "roll", roll: endRoll }, { only: notMarker });
    sheet = own.sheet;
    lines.push(...own.lines);
  }
  const casterBefore: AdversaryBefore[] = [];
  if (endRoll !== null && endRoll.kind === "action") {
    const caster = await endForCasterOnInstances(ctx, campaignId, attackerTokenId, { kind: "roll", roll: endRoll });
    casterBefore.push(...caster.before);
    touched.push(...caster.before.map((b) => b.instanceId));
    gm.push(...caster.lines);
  }
  let worst: EndSeverity = "none";
  for (const r of at.results.filter((x) => x.hit)) {
    const instance = await ctx.db.get("encounterAdversaries", r.target.instance._id);
    if (instance === null) continue;
    // "defeat" (a block with no thresholds: any hit defeats it) took damage but has no severity: read as Minor.
    const severity: EndSeverity = r.severity === "defeat" ? "minor" : r.severity;
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity;
    const lastHp = r.defeated && !at.alreadyDefeated.has(instance._id);
    const out = await endOnInstance(ctx, instance, { kind: "damageTaken", severity, hpMarked: Math.max(0, r.hpMarked), lastHp });
    if (out.before !== null) touched.push(instance._id);
    gm.push(...out.lines);
    if (lastHp) {
      const defeat = endOnDefeat(sheet, instance);
      sheet = defeat.sheet;
      lines.push(...defeat.lines);
    }
  }
  if (worst !== "none") {
    const dealt = endOnSheet(sheet, { kind: "damageDealt", severity: worst }, { only: notMarker });
    sheet = dealt.sheet;
    lines.push(...dealt.lines);
  }
  return { sheet, lines, gmLines: gm, touched, casterBefore, endRoll, worst };
}

// ---------------------------------------------------------------- plan lanes-2 wave 9, E1.3b: what the target brings to the attack

/**
 * CB p.102 (Hidden): "While Hidden, any rolls against you have disadvantage." Cloaked (CB p.42) is Hidden with more
 * benefits. Vulnerable (CB p.102): rolls targeting a Vulnerable creature have advantage.
 */
export function conditionEdge(conditions: Iterable<string>, mode: ModeOf<"conditionDice"> = "book"): { advantage: number; disadvantage: number } {
  if (mode === "manual") return { advantage: 0, disadvantage: 0 };
  const set = new Set(conditions);
  return { advantage: set.has("vulnerable") ? 1 : 0, disadvantage: set.has("hidden") || set.has("cloaked") ? 1 : 0 };
}

/**
 * Plan rule-switches OP ("Conflict between PCs", CB p.168: "just like an adversary"): what the named PCs' conditions add to
 * the roll (`conditionEdge` per PC). Only when the attack names no adversary (`adversaries` 0) and every PC gives the same
 * edge: one roll can't carry different edges for a PC and an adversary here (the adversaries' own split is per instance).
 */
export function conflictEdge(conditions: readonly (readonly string[])[], adversaries: number, mode: ModeOf<"conditionDice"> = "book"): Edge {
  const edges = conditions.map((c) => conditionEdge(c, mode));
  if (adversaries > 0 || edges.length === 0 || !sameEdges(edges)) return { advantage: 0, disadvantage: 0 };
  return edges[0]!;
}

/**
 * Rule switches RC1, C1 Manual (CB p.102): the GM's lines for a target whose conditions would change the dice
 * ("Bandit is Vulnerable: add advantage?", "Bandit is Hidden: disadvantage?"). Empty in Book (the dice change by themselves).
 */
export function conditionNotes(label: string, conditions: Iterable<string>, mode: ModeOf<"conditionDice"> = "book"): string[] {
  if (mode !== "manual") return [];
  const set = new Set(conditions);
  const notes: string[] = [];
  if (set.has("vulnerable")) notes.push(`${label} is Vulnerable: add advantage?`);
  if (set.has("hidden") || set.has("cloaked")) notes.push(`${label} is ${set.has("cloaked") && !set.has("hidden") ? "Cloaked" : "Hidden"}: disadvantage?`);
  return notes;
}

/** The steps of the entry a stored effect or tag came from: an adversary feature (`<adversaryId>/<feature>`) or a card / PC feature. */
function entryStepsOf(source: { adversaryId: string; feature: string } | { sourceId: string }): readonly unknown[] {
  if ("adversaryId" in source) return (adversaryEffects(source.adversaryId).find((e) => e.feature === source.feature)?.uses ?? []).map((u) => u.steps);
  const entry = srdUses(source.sourceId);
  if (entry === undefined) return [];
  if (Array.isArray(entry)) return entry.map((u) => u.steps);
  const whole = entry as { uses: readonly { steps: unknown }[]; upgrades?: readonly unknown[] };
  return [...whole.uses.map((u) => u.steps), ...(whole.upgrades ?? [])];
}

const ADV_INSTANCE_EFFECT = /^adv:([^/:]+)\/(.+):\d+$/;

type TagRiderSource = { kind: "pc"; sourceId: string } | { kind: "adversary" };
let TAG_RIDERS: Map<string, { source: TagRiderSource; mods: readonly Mod[] }> | null = null;

/** The first SRD entry (card, PC feature, adversary feature) giving a tag or condition of this name with mods, cached. */
function tagRiderEntry(tag: string): { source: TagRiderSource; mods: readonly Mod[] } | undefined {
  if (TAG_RIDERS === null) {
    const map = new Map<string, { source: TagRiderSource; mods: readonly Mod[] }>();
    const add = (source: TagRiderSource, uses: readonly { steps: readonly unknown[] }[]) => {
      for (const [name, step] of conditionStepsOf(uses.map((u) => u.steps))) {
        if (step.mods && step.mods.length > 0 && !map.has(name)) map.set(name, { source, mods: step.mods });
      }
    };
    for (const e of allCardEffects().values()) add({ kind: "pc", sourceId: e.cardId }, e.uses);
    for (const e of allFeatureEffects().values()) add({ kind: "pc", sourceId: e.featureId }, e.uses);
    for (const list of allAdversaryEffects().values()) for (const e of list) add({ kind: "adversary" }, e.uses);
    TAG_RIDERS = map;
  }
  return TAG_RIDERS.get(tag);
}

/**
 * Whether an `attackedRider`'s `by` holds for a PC's attack. `anyone` and `pcs` always; `caster`: the PC holds the card or
 * feature that made it (an adversary's own rider never); `others`: the PC doesn't (Breaking Blow, Chokehold: the caster's
 * own attacks add the extra damage through their own `auto` use, so it is never added twice).
 */
function attackedByHolds(rider: AttackedRider, source: TagRiderSource, attacker: CharacterSheet, caster?: string, me?: AttackerIds): boolean {
  if (rider.by === "anyone" || rider.by === "pcs") return true;
  // E1.4b (dcm-j5aw, user answer 2026-10-31): the placing PC recorded on the instance (its marker's caster) is excluded,
  // not every holder of the card; without a recorded caster, the old holder rule.
  const mine = caster !== undefined && me !== undefined ? caster === me.tokenId || caster === me.characterId : source.kind === "pc" && holdsSource(attacker, source.sourceId);
  return rider.by === "caster" ? mine : !mine;
}

/** The attacker as an instance marker may name it (`~<caster>`: a token id; a character id from E1.4a's `casterId`). */
export type AttackerIds = { tokenId: string; characterId: string };

/**
 * dcm-yd5h / dcm-9gw / dcm-kso9: the `attackedRider`s a PC's attack on this instance gets, read back from the entries of
 * what it carries (E7's `adv:` instance modifiers, a card's or feature's `card:` / `feat:` modifier, and a bare tag or
 * condition a card left: Breaking Blow, CB p.331; Chokehold, CB p.336).
 */
export function instanceAttackedRiders(instance: Pick<Doc<"encounterAdversaries">, "effects" | "tags" | "conditions">, attacker: CharacterSheet, me?: AttackerIds): { label: string; rider: AttackedRider }[] {
  const out: { label: string; rider: AttackedRider }[] = [];
  const seen = new Set<string>();
  // E1.4b (dcm-j5aw): the caster a marker of this label records (a tag's caster lives on its marker).
  // Orchestrator (merge with E1.4a): the stored `casterId` (E1.4a's `castWrites`, a character id) wins over the id's `~` suffix.
  const casterIn = (e: NonNullable<typeof instance.effects>[number], src: ReturnType<typeof instanceEffectSource>) => e.casterId ?? src?.caster;
  const casterOf = (label: string) => {
    for (const e of instance.effects ?? []) {
      const src = instanceEffectSource(e);
      const caster = src !== null && src.label === label ? casterIn(e, src) : undefined;
      if (caster !== undefined) return caster;
    }
    return undefined;
  };
  for (const e of instance.effects ?? []) {
    const adv = ADV_INSTANCE_EFFECT.exec(e.id);
    const src = adv ? null : instanceEffectSource(e);
    if (adv === null && src === null) continue;
    seen.add(e.label);
    const steps = adv ? entryStepsOf({ adversaryId: adv[1]!, feature: adv[2]! }) : entryStepsOf({ sourceId: src!.sourceId });
    const source: TagRiderSource = adv ? { kind: "adversary" } : { kind: "pc", sourceId: src!.sourceId };
    for (const m of lastingModsOf(steps, e.label)) if (m.kind === "attackedRider" && attackedByHolds(m.rider, source, attacker, src === null ? undefined : casterIn(e, src), me)) out.push({ label: e.label, rider: m.rider });
  }
  for (const tag of [...(instance.tags ?? []), ...instance.conditions]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    const found = tagRiderEntry(tag);
    if (found) for (const m of found.mods) if (m.kind === "attackedRider" && attackedByHolds(m.rider, found.source, attacker, casterOf(tag), me)) out.push({ label: tag, rider: m.rider });
  }
  return out;
}

/**
 * E1.4b (dcm-kso9): runs a rider benefit's steps on the attacker (`self`), as a card use would, with the attack's dice.
 * `line` names what changed ("Lead by Example: clears 1 Stress").
 */
export function attackerStepsRun(sheet: CharacterSheet, label: string, steps: readonly Step[], rng: Rng): { sheet: CharacterSheet; line: string } {
  const use: CardUse = { id: "benefit", name: label, activation: { kind: "action" }, steps };
  const result = runCardUse({ cardId: `benefit-${label}`, uses: [use] } as never, { actor: cardActor("self", sheet, "", undefined), gmFear: 0, useId: "benefit", targets: [], rng });
  if (!result.ok) return { sheet, line: `${label}: ${riderStepsText(steps)} (not automated)` };
  const after = actorSheetAfter(sheet, result.plan, "self", label, { rng });
  const parts: string[] = [];
  if (after.stress < sheet.stress) parts.push(`clears ${sheet.stress - after.stress} Stress`);
  if (after.stress > sheet.stress) parts.push(`marks ${after.stress - sheet.stress} Stress`);
  if (after.hope > sheet.hope) parts.push(`gains ${after.hope - sheet.hope} Hope`);
  if (after.hope < sheet.hope) parts.push(`spends ${sheet.hope - after.hope} Hope`);
  return { sheet: after, line: `${label}: ${parts.length > 0 ? parts.join(", ") : "no change"}` };
}

/** E1.4b (dcm-b41o): the rules flags on a payer's sheet: its live mods and what it carries (adversary-applied effects too). */
export function payerFlags(sheet: CharacterSheet, campaign: Doc<"campaigns">): string[] {
  return flagsOf([...liveMods(sheet, featureScope(campaign)).map((m) => m.mod), ...sheetCarriedMods(sheet).map((m) => m.mod)]);
}

/** One choice an attacker makes before the roll for a target's `attackedRider` (Lead by Example: clear a Stress or gain a Hope). */
export type RiderBenefit = { label: string; options: { id: string; label: string }[] };

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-kso9; user answer 2026-11-01, Q3): the benefits a target's riders give the attacker
 * (`attackerSteps`; Lead by Example, CB p.342: "The next PC to make an attack against that adversary can clear a Stress or
 * gain a Hope"). A `choose` among the steps is the attacker's pick before rolling.
 */
export function riderBenefits(riders: readonly { label: string; rider: AttackedRider }[]): RiderBenefit[] {
  return riders.flatMap(({ label, rider }) => {
    const steps = rider.attackerSteps ?? [];
    if (steps.length === 0) return [];
    const choose = steps.find((st): st is Extract<Step, { kind: "choose" }> => st.kind === "choose");
    return [{ label, options: choose ? choose.options.map((o) => ({ id: o.id, label: o.label })) : [] }];
  });
}

/**
 * E1.4b (dcm-kso9): the attacker steps with the picked option in place of their `choose` (`option` absent: the attacker took
 * none, so a `choose` gives nothing); null when there is nothing to run.
 */
export function benefitSteps(steps: readonly Step[], option: string | undefined): Step[] | null {
  const out = steps.flatMap((st) => (st.kind === "choose" ? (st.options.find((o) => o.id === option)?.steps ?? []) : [st]));
  return out.length > 0 ? out : null;
}

/** What one adversary target brings to a PC's attack (dcm-c09o, dcm-wuu, dcm-bhp, dcm-yd5h). */
export type TargetFacts = {
  passives: PassiveSummary | null;
  /** The conditions the attack reads: the instance's own, its passive self conditions, the areas it stands in, toward the attacker. */
  conditions: string[];
  riders: { label: string; rider: AttackedRider }[];
};

/**
 * dcm-c09o (Hand of Glory, HF p.67: Hidden while its stat block has a token), dcm-wuu (Shadow Swarm, HF p.82: Vulnerable
 * inside the area; `memberConditionsFor`), dcm-bhp (a sight-blocking area between the two: `observerConditions`),
 * dcm-yd5h (instance riders): the target as the attack reads it.
 */
export async function targetFacts(ctx: QueryCtx, s: AttackScene, areas: readonly Doc<"combatAreas">[], target: Pick<CheckedTarget, "instance" | "token">, attacker: CharacterSheet, me?: AttackerIds): Promise<TargetFacts> {
  const block = await adversaryBlockOf(ctx, target.instance);
  const passives = block === null ? null : passiveSummary(block.effects, { ...adversaryState(target.instance), situations: [] }, block.tier);
  const conditions = new Set<string>([...target.instance.conditions, ...(target.instance.tags ?? [])]);
  for (const c of passives?.selfConditions ?? []) conditions.add(conditionName(c));
  for (const m of memberConditionsFor(areas, s.scene.tokens, target.token)) conditions.add(conditionName(m.condition));
  for (const o of observerConditions(areas, s.scene.tokens, target.token, s.attacker)) conditions.add(o.condition);
  return { passives, conditions: [...conditions], riders: instanceAttackedRiders(target.instance, attacker, me) };
}

/**
 * The advantage and disadvantage the targets give the one attack roll (R9: one roll for every target). Each target's
 * edge: its conditions (`conditionEdge`), a passive `disadvantageAgainst` covering the attack (Wind Lord), an
 * `attackedRider` with `advantage` (Mark Target, Drag and Bag). With several targets only what every target gives
 * counts (simplest reading, QUESTIONS in TASK-LN3-E1B.md).
 */
export function targetsEdge(facts: readonly TargetFacts[], host: Pick<Host, "spec" | "trait">, conditionMode: ModeOf<"conditionDice"> = "book"): { advantage: number; disadvantage: number } {
  if (facts.length === 0) return { advantage: 0, disadvantage: 0 };
  const each = facts.map((f) => targetEdge(f, host, conditionMode));
  return { advantage: Math.min(...each.map((e) => e.advantage)), disadvantage: Math.min(...each.map((e) => e.disadvantage)) };
}

export type Edge = { advantage: number; disadvantage: number };

/** One target's own edge on the attack roll (see `targetsEdge`); C1 Manual drops the conditions' part (RC1). */
export function targetEdge(f: TargetFacts, host: Pick<Host, "spec" | "trait">, conditionMode: ModeOf<"conditionDice"> = "book"): Edge {
  const edge = conditionEdge(f.conditions, conditionMode);
  const against = (f.passives?.disadvantageAgainst ?? []).filter((on) => hostMatches(on, host) || on === "any").length;
  const riderAdvantage = f.riders.some((r) => r.rider.advantage === true) ? 1 : 0;
  return { advantage: edge.advantage + riderAdvantage, disadvantage: edge.disadvantage + against };
}

/** Whether every target gives the same edge (then the roll takes it as before, no per-target total). */
export function sameEdges(edges: readonly Edge[]): boolean {
  return edges.every((e) => e.advantage === edges[0]!.advantage && e.disadvantage === edges[0]!.disadvantage);
}

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-svux; user answers 2026-10-31 and 2026-11-01): an attack on several targets is ONE roll
 * (CB p.104: "you only make one attack roll and compare its result to the Difficulty of each eligible target"), compared per
 * target with that target's own advantage / disadvantage (CB p.100: "you add a d6 advantage die to your total ... you
 * subtract a d6 disadvantage die"). One d6 is rolled once: added against a target that leaves the roll with advantage,
 * subtracted against one that leaves it with disadvantage, ignored otherwise.
 *
 * `record` was rolled with `own` (the roller's effective advantage, disadvantage and help, no target edge). Each target's
 * dice follow `advantagePlan(own + its edge)` read from one pool: the record's advantage / disadvantage die (the shared
 * d6) and its help dice; a die the pool lacks is drawn once with `draw` and shared. `deltas[i]`: what target i's total
 * differs from `record.total`; `drawn`: the dice drawn here (for the log).
 */
export function perTargetDeltas(record: RollRecord, own: { advantage: number; disadvantage: number; help: number }, edges: readonly Edge[], draw: (sides: number) => number): { deltas: number[]; drawn: number[]; edgeDie: number | null } {
  const drawn: number[] = [];
  let edgeDie = record.dice.find((d) => d.role === "advantage" || d.role === "disadvantage")?.value ?? null;
  const helps = record.dice.filter((d) => d.role === "help").map((d) => d.value);
  const shared = () => {
    if (edgeDie === null) {
      edgeDie = draw(6);
      drawn.push(edgeDie);
    }
    return edgeDie;
  };
  const help = (i: number) => {
    while (helps.length <= i) {
      const v = draw(6);
      drawn.push(v);
      helps.push(v);
    }
    return helps[i]!;
  };
  const valueOf = (advantage: number, disadvantage: number): number => {
    const plan = advantagePlan(Math.min(advantage, 6), Math.min(disadvantage, 6), own.help);
    if (plan.length === 0) return 0;
    if (plan[0] === "disadvantage") return -shared();
    let best = 0;
    let h = 0;
    for (const role of plan) best = Math.max(best, role === "advantage" ? shared() : help(h++));
    return best;
  };
  const base = valueOf(own.advantage, own.disadvantage);
  const deltas = edges.map((e) => valueOf(own.advantage + e.advantage, own.disadvantage + e.disadvantage) - base);
  return { deltas, drawn, edgeDie };
}

/** Whether a passive weakness (Made of Straw, HF p.79: "double damage from fire") matches the attack's damage. */
export function weaknessMatches(weaknesses: PassiveSummary["weaknesses"], types: readonly DamageType[], keywords: readonly DamageKeyword[]): boolean {
  return (weaknesses ?? []).some((w) => (w.type === undefined || types.includes(w.type)) && (w.keyword === undefined || keywords.includes(w.keyword)) && (w.type !== undefined || w.keyword !== undefined));
}

/**
 * dcm-yd5h: the extra damage the target's `attackedRider`s add to a successful attack on it (Breaking Blow's 2d12, CB
 * p.331; Chokehold's 2d6, CB p.336; I've Got 'Em's double damage, CB p.213). Dice are rolled with the attack's rng.
 */
export function attackedRiderDamage(riders: readonly { label: string; rider: AttackedRider }[], instance: Doc<"encounterAdversaries">, rng: Rng): { add: number; multiply: number; dice: { sides: number; value: number }[]; labels: string[]; manual: string[] } {
  let add = 0;
  let multiply = 1;
  const dice: { sides: number; value: number }[] = [];
  const labels: string[] = [];
  const manual: string[] = [];
  const env = adversaryNumberEnv({ hp: instance.hp, stress: instance.stress, tokens: instance.tokens ?? 0 }, 1);
  for (const { label, rider } of riders) {
    const d = rider.damage;
    if (d !== undefined) {
      if (d.kind === "add") {
        const record = (sides: number) => {
          const value = rng(sides);
          dice.push({ sides, value });
          return value;
        };
        const amount = resolveNumber(d.amount, env, record);
        add += amount;
        labels.push(`${label} +${amount}`);
      } else if (d.kind === "multiply") {
        multiply *= d.factor;
        labels.push(`${label} ×${d.factor}`);
      } else manual.push(`${label}: ${d.kind} (not automated)`);
    }
  }
  return { add, multiply, dice, labels, manual };
}

/**
 * dcm-c09o (Tireless, HF p.68: "can't be forced to mark Stress"): a rider's write that marks Stress on an instance whose
 * passives say `noForcedStress` keeps its Stress.
 */
export async function withoutForcedStress(ctx: QueryCtx, writes: readonly InstanceWrite[], known: ReadonlyMap<string, PassiveSummary | null>): Promise<InstanceWrite[]> {
  const out: InstanceWrite[] = [];
  for (const w of writes) {
    const inst = w.creature.instance;
    if (w.patch.stress <= inst.stress) {
      out.push(w);
      continue;
    }
    let passives = known.get(inst._id);
    if (passives === undefined) {
      const block = await adversaryBlockOf(ctx, inst);
      passives = block === null ? null : passiveSummary(block.effects, { ...adversaryState(inst), situations: [] }, block.tier);
    }
    out.push(passives?.flags.includes("noForcedStress") ? { ...w, patch: { ...w.patch, stress: inst.stress } } : w);
  }
  return out;
}

// ---- Spirit Weapon (CB p.44; user answer 2026-10-31, dcm-xbtw)

export const SPIRIT_WEAPON = "subclass:divine-wielder:spirit-weapon";
export const SACRED_RESONANCE = "subclass:divine-wielder:sacred-resonance";

/**
 * Spirit Weapon (CB p.44): "When you have an equipped weapon with a range of Melee or Very Close, it can fly from your hand
 * to attack an adversary within Close range and then return to you. You can mark a Stress to target an additional
 * adversary within range with the same attack roll." User answer (dcm-xbtw): a per-attack check box; ticked, with such a
 * weapon and the feature held, the attack reaches Close and may take one more target for a Stress.
 */
export function spiritWeaponOn(sheet: CharacterSheet, campaign: Doc<"campaigns">, weapon: Weapon, roll: Pick<AttackRoll, "spiritWeapon">): boolean {
  if (roll.spiritWeapon !== true) return false;
  const range = rangeFromWeapon(weapon.range);
  if (range !== "melee" && range !== "veryClose") return false;
  return owned(sheet, featureScope(campaign)).some((f) => f.featureId === SPIRIT_WEAPON);
}

/**
 * Sacred Resonance (CB p.44): "When you roll damage for your Spirit Weapon feature, if any of the die results match, double
 * the value of each matching die." Dice of the damage roll that share a value are doubled; the total follows.
 */
export function sacredResonance(record: RollRecord): RollRecord {
  const live = record.dice.filter((d) => !d.dropped);
  const counts = new Map<number, number>();
  for (const d of live) counts.set(d.value, (counts.get(d.value) ?? 0) + 1);
  if (![...counts.values()].some((n) => n > 1)) return record;
  const dice = record.dice.map((d) => (!d.dropped && (counts.get(d.value) ?? 0) > 1 ? { ...d, value: d.value * 2 } : d));
  const total = Math.max(0, dice.filter((d) => !d.dropped).reduce((s, d) => s + d.value, 0) + record.modifier);
  return { ...record, dice, total };
}

/**
 * Plan lanes-2 wave 9, E1.3b (dcm-uwg1): the party's sheets an attack ends effects on: caster-side ends on another PC's
 * sheet (`endForCasterOnSheets`: an effect this attacker made on an ally that ends on the caster's roll or damage dealt)
 * and another PC's effects tied to an instance this attack defeated (Marked for Death, HF p.8: "the current adversary
 * Marked for Death is defeated"; `endOnDefeat`). Returns only the sheets that changed.
 */
export function partyEndsFromAttack<K>(
  attacker: CharacterSheet,
  party: readonly { key: K; sheet: CharacterSheet }[],
  endRoll: EndRoll | null,
  worst: EndSeverity,
  defeated: readonly Pick<Doc<"encounterAdversaries">, "tags">[],
  lookup?: SourceLookup,
): { key: K; sheet: CharacterSheet; lines: string[] }[] {
  const current = new Map<K, { key: K; sheet: CharacterSheet; lines: string[] }>(party.map((p) => [p.key, { key: p.key, sheet: p.sheet, lines: [] }]));
  const apply = (outs: readonly { key: K; sheet: CharacterSheet; lines: string[] }[]) => {
    for (const o of outs) {
      const c = current.get(o.key)!;
      current.set(o.key, { key: o.key, sheet: o.sheet, lines: [...c.lines, ...o.lines] });
    }
  };
  const list = () => [...current.values()].map((c) => ({ key: c.key, sheet: c.sheet }));
  if (endRoll !== null) apply(endForCasterOnSheets(attacker, list(), { kind: "roll", roll: endRoll }, lookup));
  if (worst !== "none") apply(endForCasterOnSheets(attacker, list(), { kind: "damageDealt", severity: worst }, lookup));
  for (const instance of defeated) {
    for (const c of [...current.values()]) {
      const out = endOnDefeat(c.sheet, instance, lookup);
      if (out.ended.length > 0) current.set(c.key, { key: c.key, sheet: out.sheet, lines: [...c.lines, ...out.lines] });
    }
  }
  return [...current.values()].filter((c) => c.lines.length > 0);
}

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
  // Rule switches RC1: C1, M1, D6 and the damage modes (D2, D8, Massive Damage); Manual rules leave GM notes in the group.
  const modes = ruleModesOf(campaign);
  const ruleNotes: { ruleId: "conditionDice" | "lineOfSight" | "minions" | "hiddenEnds" | "definedRanges" | "experienceCost" | "criticalDamage" | "outOfRange" | DamageRuleNote["ruleId"]; summary: string }[] = [];
  if (req.outOfRangeNote !== undefined) ruleNotes.push({ ruleId: "outOfRange", summary: req.outOfRangeNote });
  /** ODR3: the riders' Defined Ranges questions (`RiderEnv.rangeNotes`), posted with the other notes. */
  const rangeNotes: string[] = [];
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
    rangeNotes,
  };
  // DA2: damage-phase riders (Death Strike) are prompts after the damage (`damagePrompts`), never run from a toggle.
  const pickedAll = pickRiders(sheet0, campaign, host, req.riders ?? []).filter((r) => r.phase !== "damage");
  // FH-AP (user 2026-11-05): a rider whose choosers each pick their own option (Rousing Strike) never runs inline; it
  // waits for the picks after the attack (`openRiderAllyPicks` below).
  const ownPicks = pickedAll.filter(riderHasOwnPicks);
  const picked = pickedAll.filter((r) => !ownPicks.includes(r));
  const autos = [...autoRiders(sheet0, campaign, host), ...defaultOnRiders(sheet0, campaign, host, options.riseToTheChallenge === false, pickedAll)];
  const folds = emptyFolds();
  const runs: RiderRun[] = [];
  const allTargets: CheckedTarget[] = [...req.targets];
  // Plan rule-switches OP: the PCs the attacker named ("Conflict between PCs"), then any a rider adds.
  const conflict: readonly PcTarget[] = req.pcTargets ?? [];
  const pcTargets: PcTarget[] = [...conflict];
  const waived = new Set<string>(req.waived ?? []);
  /** The first adversary target; undefined when the attack named only PCs (OP). */
  const main = req.targets[0];
  const encounterId = main?.encounter._id;
  /** Riders whose trigger held: their `post` parts run after the damage. */
  const used: PickedRider[] = [];
  /** Plan lanes-2, E1 (dcm-umti): the creature a rider is about (a `whenYouDealDamage`'s damaged target), for its `post` part. */
  const subjects = new Map<PickedRider, string>();
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
    const more = await addedTargets(ctx, campaign, req.scene, weapon, add, taken(), encounterId, waived, folds.reach);
    allTargets.push(...more.adversaries);
    pcTargets.push(...more.pcs);
    for (const t of more.adversaries) halfDamage.set(t.token._id, add.damage === "half");
  }

  // ---- E1.3b: what the targets bring (dcm-c09o passives, dcm-wuu / dcm-bhp area conditions, dcm-yd5h instance riders)
  const areas = await activeAreasOnMap(ctx, req.scene.map._id);
  const facts = new Map<string, TargetFacts>();
  const factsOf = async (t: CheckedTarget) => {
    const known = facts.get(t.token._id);
    if (known !== undefined) return known;
    const read = await targetFacts(ctx, req.scene, areas, t, sheet0, { tokenId: req.scene.attacker._id, characterId: character._id });
    facts.set(t.token._id, read);
    return read;
  };
  for (const t of allTargets) await factsOf(t);
  // E1.4b (dcm-svux): every target its own edge; when they differ the roll is made without them and compared per target.
  const edgesOf = (list: readonly CheckedTarget[]) => list.map((t) => targetEdge(facts.get(t.token._id)!, host, modes.conditionDice));
  const targetEdges = edgesOf(allTargets);
  const uniformEdge = targetEdges.length === 0 || sameEdges(targetEdges);
  const edge: Edge = uniformEdge ? { ...(targetEdges[0] ?? { advantage: 0, disadvantage: 0 }) } : { advantage: 0, disadvantage: 0 };
  // Plan rule-switches OP: a named PC's conditions change the roll as an adversary's do (C1, CB p.102: Vulnerable gives
  // advantage, Hidden / Cloaked disadvantage; Manual: the GM's note below), when the attack names only PCs and they agree.
  const pcEdge = conflictEdge(conflict.map((t) => t.sheet.conditions), allTargets.length, modes.conditionDice);
  edge.advantage += pcEdge.advantage;
  edge.disadvantage += pcEdge.disadvantage;
  // E1.3b (dcm-mm0f): a bearer's disadvantage on attacks from beyond a range (Sandstorm, CB p.339: "Attacks made from beyond
  // Melee range have disadvantage"); the ones without a range are counted in `prepareDuality`.
  // ODR3: Defined Ranges off, no band is counted (the GM judges "from beyond Melee range" by eye).
  const bands = rangesOn(req.scene) ? [...allTargets.map((t) => t.check.band), ...conflict.flatMap((t) => (t.check ? [t.check.band] : []))] : [];
  edge.disadvantage += sheetBearerMods(sheet0).filter(({ mod }) => mod.kind === "disadvantage" && mod.beyond !== undefined && mod.unlessTarget === undefined && mod.situation === undefined && hostMatches(mod.on, host) && bands.some((band) => !rangeAtMost(band, mod.beyond!))).length;
  // E1.3b (dcm-xbtw): a ticked Spirit Weapon's extra adversary costs a Stress (CB p.44: "You can mark a Stress to target an
  // additional adversary within range with the same attack roll").
  const spirit = spiritWeaponOn(sheet0, campaign, weapon, options);
  if (spirit && req.targets.length > WEAPON_ATTACK_TARGETS + extraTargetsOf(mods)) {
    if (sheet.stress >= sheet.stressMax) throw appError("INVALID", "No Stress left to mark for Spirit Weapon's extra target.");
    sheet = { ...sheet, stress: sheet.stress + 1 };
  }

  // ---- plan rule-switches OE / OE2: the environment. M3's variants (CB p.104) on any attack in dim light (a disadvantage
  // die and / or +N to every target's Difficulty); Underwater (optional rule, CB p.168) gives the roll disadvantage
  // unless the attacker's token is marked "fights underwater".
  const environment = attackEnvironment(req.scene, modes);
  // ---- the roll (R1, R9); cover gives one disadvantage (Q2), unless M1 is Manual (RC1: the GM is told instead)
  const cover = coverApplies(campaign, allTargets) || pcTargets.some((t) => sightRule(t.sheet.name, t.sight, modes.lineOfSight).cover);
  for (const t of allTargets) {
    const note = sightRule(t.instance.label, t.sight, modes.lineOfSight, t.unseen !== true).note;
    if (note !== null) ruleNotes.push({ ruleId: "lineOfSight", summary: note });
    for (const summary of conditionNotes(t.instance.label, facts.get(t.token._id)!.conditions, modes.conditionDice)) ruleNotes.push({ ruleId: "conditionDice", summary });
  }
  for (const t of pcTargets) {
    const note = sightRule(t.sheet.name, t.sight, modes.lineOfSight).note;
    if (note !== null) ruleNotes.push({ ruleId: "lineOfSight", summary: note });
  }
  for (const t of conflict) for (const summary of conditionNotes(t.sheet.name, t.sheet.conditions, modes.conditionDice)) ruleNotes.push({ ruleId: "conditionDice", summary });
  // Plan rule-switches WR (R7): the helpers named (Book: 1 Hope each, paid with the attack's rows) or counted (Manual).
  const help = await planHelp(ctx, campaign, { characterId: character._id, name: sheet0.name }, { kind: "action", help: options.help, ...(options.helpers !== undefined ? { helpers: options.helpers } : {}) });
  const args = attackDuality(
    weapon,
    { ...options, help: help.help, modifier: options.modifier + folds.modifier, advantage: options.advantage + folds.advantage + edge.advantage, disadvantage: options.disadvantage + edge.disadvantage + environment.disadvantage },
    cover,
    traitOverride,
  );
  const sheetBeforeRoll = sheet;
  const dualityAt = rec.values.length;
  // DA2: Rise to the Challenge's d20 Hope Die (CB p.48), on by default while it applies; the Hope Die is drawn first.
  hope.arm(folds.hopeDie);
  const duality = await resolveDuality(ctx, { ...loaded, sheet: sheetBeforeRoll }, args, hope.rng, false);
  hope.arm(undefined);
  let roll = withHopeSides(duality.roll, folds.hopeDie);
  let effects = duality.effects;
  let finalSheet = duality.next;
  /** The sheet the roll's own Hope / Stress apply to (after its costs): changes when an after-roll feature paid from it. */
  let effectsBase = duality.paid;
  // Plan lanes, E1: a bonus on one duality die (dcm-3ou, dcm-jog) changes the roll, so its Hope, Stress and Fear follow it.
  if (folds.dieBonus.length > 0) {
    roll = withDieBonuses(roll, folds.dieBonus);
    effects = dualityEffects("action", roll.outcome, duality.hopeFear, duality.critical);
    finalSheet = placeTideToken(applyDualityEffects(duality.paid, effects), roll.outcome, "action").sheet;
  }
  let rolled = { ...duality.rolled, roll };
  let forced = false;
  // E1.4b (dcm-svux): per-target totals when the targets' edges differ (one shared d6, `perTargetDeltas`).
  const ownDice = uniformEdge ? null : rules(() => prepareDuality(sheetBeforeRoll, args, featureScope(campaign), null, duality.experienceCost)).input;
  const deltas = new Map<string, number>();
  let edgeDie: number | null = null;
  const readDeltas = (r: RollRecord, list: readonly CheckedTarget[]) => {
    if (ownDice === null || list.length === 0) return;
    const out = perTargetDeltas(r, ownDice, edgesOf(list), hope.rng);
    edgeDie = out.edgeDie;
    for (const [i, t] of list.entries()) deltas.set(t.token._id, out.deltas[i]!);
  };
  readDeltas(roll, allTargets);
  const totalFor = (r: RollRecord, t: CheckedTarget) => r.total + (deltas.get(t.token._id) ?? 0);
  const hitsOf = (r: RollRecord, list: readonly CheckedTarget[] = allTargets) => list.map((t) => resolveHits(totalFor(r, t), r.outcome === "critical", [{ id: t.token._id, difficulty: difficultyOf(t.instance) + environment.difficulty }])[0]!);
  let hits = hitsOf(roll);
  const pcHitsOf = (r: RollRecord, more: readonly PcTarget[] = pcTargets) => resolveHits(r.total, forced || r.outcome === "critical", more.map((t) => ({ id: t.token._id, difficulty: t.evasion + environment.difficulty })));
  const hostRollOf = (r: RollRecord, h: readonly { hit: boolean }[]): HostRoll => {
    const critical = r.outcome === "critical";
    return { success: forced || h.some((x) => x.hit) || pcHitsOf(r).some((x) => x.hit), critical, withHope: critical || r.outcome === "successHope" || r.outcome === "failHope", withFear: r.outcome === "successFear" || r.outcome === "failFear" };
  };

  // ---- the after-roll step (Q1): hold the attack when an after-roll feature is ready and affordable
  let afterRun: RiderRun | null = null;
  if (req.held === undefined) {
    const offers = afterRollOffers(duality.next, campaign, host, roll, hostRollOf(roll, hits), main, env.rollUsedExperience, req.scene.attacker, req.scene);
    if (offers.length > 0) {
      // Plan rule-switches OP: the named PCs are held with the adversaries (the replay checks them again).
      const conflictHits = pcHitsOf(roll, conflict);
      const heldHits = [...allTargets.map((t, i) => ({ tokenId: t.token._id, hit: hits[i]!.hit })), ...conflict.map((t, i) => ({ tokenId: t.token._id, hit: conflictHits[i]!.hit }))];
      const payload: AfterRollPayload = {
        schemaVersion: 1,
        kind: "afterRoll",
        characterId: character._id,
        action: {
          kind: "attack",
          slot,
          targetTokenIds: [...req.targets.map((t) => t.token._id), ...conflict.map((t) => t.token._id)],
          roll: options,
          ...(req.riders && req.riders.length > 0 ? { riders: [...req.riders] } : {}),
          ...(req.waived && req.waived.length > 0 ? { waived: [...req.waived] } : {}),
        },
        dice: rec.values.slice(0, MAX_HELD_DICE),
        dualityAt,
        roll,
        hits: heldHits,
        options: offers.map((o) => ({ featureId: o.featureId, useId: o.useId })),
      };
      const where = { campaignId: campaign._id, mapId: req.scene.map._id, createdBy: req.actorId, payload };
      // OP / OP2: an attack on PCs only belongs to no encounter (the row's `encounterId` is optional).
      const requestId = await openAfterRoll(ctx, { ...where, ...(encounterId !== undefined ? { encounterId } : {}) });
      return { status: "awaiting", requestId, roll, targets: heldHits, options: offers };
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
      readDeltas(roll, allTargets);
    } else {
      const changed = changedRecord(roll, change, hope.rng);
      roll = changed.roll;
      forced = changed.forced;
      rolled = { ...rolled, hope: roll.dice.find((d) => d.role === "hope")?.value ?? rolled.hope, roll };
    }
    effects = dualityEffects("action", roll.outcome, duality.hopeFear, duality.critical);
    effectsBase = base;
    finalSheet = placeTideToken(applyDualityEffects(base, effects), roll.outcome, "action").sheet;
    hits = forced ? hits.map((h) => ({ ...h, hit: true })) : hitsOf(roll);
  }
  // E1.4b (dcm-m7tm, roll half): the running encounter's adversary uses on a PC's roll (Ill Omen, HF p.95; Backhanded
  // Guidance, HF p.87) once the attack resolves (never on a held one: it writes). Their die bonuses decide Hope vs Fear
  // only (user answer 2026-10-31: no critical, a tie is with Fear; `withDieBonuses`).
  // The attack's undo group (its rows below); ODR3: a range-gated trigger's GM note joins it.
  const groupId = req.groupId ?? newGroupId();
  const advUses = await pcRollAdversaryUses(ctx, campaign, {
    groupId,
    actorId: req.actorId,
    characterId: character._id,
    roll: { kind: "action", trait: host.trait ?? args.trait, attack: true, weapon: true, ...hostRollOf(roll, hits), total: roll.total },
  });
  if (advUses.bonuses.length > 0) {
    roll = withDieBonuses(roll, advUses.bonuses);
    rolled = { ...rolled, roll };
    effects = dualityEffects("action", roll.outcome, duality.hopeFear, duality.critical);
    finalSheet = placeTideToken(applyDualityEffects(effectsBase, effects), roll.outcome, "action").sheet;
    hits = forced ? hits.map((h) => ({ ...h, hit: true })) : hitsOf(roll);
  }
  sheet = finalSheet;
  const critical = roll.outcome === "critical";
  const hostRoll = hostRollOf(roll, hits);
  // Plan lanes-2, E1 (dcm-n0dv): the riders on the result read the roll's Hope and Fear Die (Midnight-Touched).
  env.hostDice = { hope: roll.dice.find((d) => d.role === "hope")?.value ?? 0, fear: roll.dice.find((d) => d.role === "fear")?.value ?? 0 };

  // ---- riders on the result (Hold Them Off, Kick, Tusks) and the automatic ones (First Strike, Face Your Fear)
  const hitIds = () => allTargets.filter((_, i) => hits[i]!.hit).map((t) => t.token._id);
  const skipped: string[] = [];
  for (const r of [...picked.filter((x) => x.phase === "after"), ...autos.filter((x) => x.phase === "after")]) {
    const ids = hitIds();
    // Plan lanes-2, E1 (dcm-76l5): the creature a `whenYouDealDamage` is about: the first hit target that fits its range.
    const damaged = r.trigger.kind === "whenYouDealDamage" ? allTargets.find((t, i) => hits[i]!.hit && dealDamageHolds(r.trigger, req.scene.attacker, subjectOf(t), rangesOn(req.scene))) : undefined;
    const onTarget = rollTargetHolds(r.trigger, host, req.scene.attacker, main ? subjectOf(main) : undefined, rangesOn(req.scene)) &&(r.trigger.kind !== "whenYouDealDamage" || damaged !== undefined);
    if (!resultHolds(r.trigger, hostRoll) || !onTarget || (!rollOnly(r.trigger) && ids.length === 0)) {
      if (!r.auto) skipped.push(r.name);
      continue;
    }
    const run = await runRiderPart(env, r, sheet, "pre", hostRoll, ids, main, damaged?.token._id);
    if (run === null) continue;
    used.push(r);
    if (damaged !== undefined) subjects.set(r, damaged.token._id);
    if (run === "empty") continue;
    sheet = run.sheet;
    foldInto(folds, run);
    runs.push(run);
  }
  for (const add of folds.addTargets.splice(0)) {
    const more = await addedTargets(ctx, campaign, req.scene, weapon, add, taken(), encounterId, waived, folds.reach);
    for (const t of more.adversaries) await factsOf(t);
    readDeltas(roll, more.adversaries);
    const moreHits = hitsOf(roll, more.adversaries).map((h) => ({ ...h, hit: h.hit || critical || forced }));
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
  const hitTargets = allTargets.filter((_, i) => hits[i]!.hit);
  const sneak = sneakAttackApplies(sheet0, req.scene, hitTargets);
  const { options: damageOptions, ask: askSneak } = damageOptionsFor(sheet0, campaign, options.damageOptions ?? [], sneak);
  // ODR3: Defined Ranges off, Sneak Attack's "an ally is within Melee range of your target" is the GM's call (CB p.42).
  if (askSneak && hitTargets.length > 0) ruleNotes.push({ ruleId: "definedRanges", summary: sneakAttackAsk(sheet0.name, hitTargets.map((t) => t.instance.label)) });
  let damageRecord: RollRecord | null = null;
  /** E1.3b (dcm-c09o): the same damage without the critical's added maximum, for a target with `noCritDamage` (No Vital Organs, HF p.69). */
  let noCritRecord: RollRecord | null = null;
  let damageLabel = "";
  const resonance = spirit && owned(sheet0, featureScope(campaign)).some((f) => f.featureId === SACRED_RESONANCE);
  for (const t of allTargets) await factsOf(t);
  if (anyHit) {
    const proficiency = sheet.proficiency;
    const damageSheet = { ...sheet, proficiency: proficiency + folds.proficiency };
    const rolledDamage = await resolveDamage(ctx, { ...loaded, sheet: damageSheet }, { source: { kind: "weapon", slot }, critical, modifier: 0, options: damageOptions }, hope.rng, false);
    sheet = { ...rolledDamage.paid, proficiency };
    // E1.3b (dcm-xbtw): Sacred Resonance doubles each matching die of a Spirit Weapon's damage (CB p.44).
    const dice = resonance ? sacredResonance(rolledDamage.roll) : rolledDamage.roll;
    damageRecord = foldedDamage(dice, folds);
    damageLabel = rolledDamage.label;
    // WR (R10 Manual): rolled like a normal hit; the GM is told the maximum left out.
    if (rolledDamage.criticalWithheld > 0) ruleNotes.push({ ruleId: "criticalDamage", summary: criticalDamageNote(sheet0.name, rolledDamage.criticalWithheld) });
    const noCritHit = allTargets.some((t, i) => hits[i]!.hit && facts.get(t.token._id)?.passives?.flags.includes("noCritDamage") === true);
    if (critical && noCritHit) {
      const plain = await resolveDamage(ctx, { ...loaded, sheet: damageSheet }, { source: { kind: "weapon", slot }, critical: false, modifier: 0, options: damageOptions }, replaying(rolledDamage.roll.dice.map((d) => d.value), rollDie), false);
      noCritRecord = foldedDamage(resonance ? sacredResonance(plain.roll) : plain.roll, folds);
    }
  }

  // ---- damage on each instance hit (R3, R10), the riders' extra Hit Points (NV4), Onslaught's floor
  const weaponType = damageTypeOf(weapon);
  const type: DamageType | "both" = folds.addTypes.some((t) => t !== weaponType) ? "both" : weaponType;
  const onslaught = hasOnslaught(sheet0);
  const floor = onslaught ? "major" : folds.minimumSeverity;
  const now = Date.now();
  const snapshots: Doc<"encounterAdversaries">[] = [];
  /** E1.3b: what the targets' riders ask that the attack can't apply (Lead by Example's benefit), and the riders that added damage. */
  const knownPassives = new Map<string, PassiveSummary | null>([...allTargets].map((t) => [t.instance._id as string, facts.get(t.token._id)?.passives ?? null]));
  const riderManual: string[] = [];
  const publicExtras: string[] = [];
  const results: TargetResult[] = [];
  const publicParts: string[] = [];
  const gmParts: string[] = [];
  // dcm-uemx: severity and HP per adversary hit, on the GM row for the GM's result panel (U1: never a player's).
  const targetDamage: TargetDamage[] = [];
  let extra = 0;
  for (const [i, t] of allTargets.entries()) {
    const hit = hits[i]!.hit;
    const block = await blockOf(ctx, t.instance);
    const label = t.instance.label;
    if (!hit || damageRecord === null) {
      results.push({ target: t, hit: false, defeated: false, severity: "none", hpMarked: 0, half: false });
      publicParts.push(`${label}: Miss`);
      gmParts.push(`${label}: miss (${totalFor(roll, t)} vs Difficulty ${difficultyOf(t.instance) + environment.difficulty})`);
      continue;
    }
    snapshots.push(t.instance);
    const half = halfDamage.get(t.token._id) === true;
    // E1.3b: per target, the critical's maximum dropped (noCritDamage), the target's attackedRider damage (Breaking Blow,
    // Chokehold, I've Got 'Em), then a weakness doubles it (Made of Straw); half damage last.
    const f = facts.get(t.token._id);
    const notes: string[] = [];
    let base = damageRecord.total;
    if (noCritRecord !== null && f?.passives?.flags.includes("noCritDamage") === true) {
      base = noCritRecord.total;
      notes.push("no critical damage");
    }
    if (f !== undefined && f.riders.length > 0) {
      const extraDamage = attackedRiderDamage(f.riders, t.instance, hope.rng);
      base = (base + extraDamage.add) * extraDamage.multiply;
      notes.push(...extraDamage.labels);
      riderManual.push(...extraDamage.manual);
      if (extraDamage.labels.length > 0) publicExtras.push(...f.riders.filter((r) => r.rider.damage !== undefined).map((r) => r.label));
    }
    if (weaknessMatches(f?.passives?.weaknesses, [weaponType, ...folds.addTypes], folds.keywords)) {
      base *= 2;
      notes.push("weakness ×2");
    }
    const total = half ? Math.ceil(base / 2) : base;
    let hp: number;
    let detail: string;
    let severity: TargetResult["severity"] = "none";
    let marked = 0;
    let gmDamage: Omit<TargetDamage, "tokenId" | "hpMarked">;
    const resistedOf = (r: { resisted: TargetDamage["resisted"] | "none"; resistanceApplied?: false }) => (r.resisted !== undefined && r.resisted !== "none" && r.resistanceApplied !== false ? { resisted: r.resisted } : {});
    if (block.minion) {
      // D6: a Minion falls to any damage (its own rule, not D8); D2 still applies to it.
      const result = applyDamageTo(oneMinion(t.instance, block), total, type, { rules: modes });
      for (const n of damageRuleNotes(label, { resisted: result.resisted, incoming: result.incoming, ...(result.resistanceApplied === false ? { resistanceApplied: false as const } : {}) })) ruleNotes.push(n);
      const fell = result.taken > 0 ? 1 : 0;
      hp = Math.min(t.instance.stats.hpMax, t.instance.hp + fell);
      marked = fell;
      gmDamage = { severity: fell > 0 ? "defeat" : "none", ...resistedOf(result) };
      extra += fell > 0 ? result.minionExtra : 0;
      detail = `${result.incoming} ${SHORT_TYPE[type]}${result.resisted !== "none" ? ` (${result.resisted}: ${result.taken})` : ""} → ${fell > 0 ? `a Minion falls, +${result.minionExtra} to pick` : "no damage"} (${hp}/${t.instance.stats.hpMax} HP)`;
    } else {
      // RC1: the campaign's damage modes (D2 resistance, D8 defeat at the last HP, Massive Damage on adversaries).
      const result = applyDamageTo(combatantOf(t.instance, block), total, type, { rules: modes, ...(floor ? { minimumSeverity: floor } : {}) });
      const more = result.hpMarked > 0 && folds.extraHp !== 0 ? Math.max(-result.hpMarked, folds.extraHp) : 0;
      hp = Math.max(0, Math.min(t.instance.stats.hpMax, result.after.hp + more));
      severity = result.severity;
      marked = hp - t.instance.hp;
      gmDamage = { severity: result.severity, ...resistedOf(result), ...(result.massive ? { massive: true as const } : {}) };
      // D8 Manual: the last HP leaves it up (a rider's extra HP counts too); the GM gets the note once, when it is reached.
      const lastHpUp = modes.adversaryDefeated === "manual" && !t.instance.defeated && hp >= t.instance.stats.hpMax && t.instance.hp < t.instance.stats.hpMax;
      for (const n of damageRuleNotes(label, { resisted: result.resisted, incoming: result.incoming, ...(result.resistanceApplied === false ? { resistanceApplied: false as const } : {}), ...(lastHpUp ? { lastHp: true as const } : {}) })) ruleNotes.push(n);
      detail = `${result.incoming} ${SHORT_TYPE[type]}${half ? " (half)" : ""}${result.resisted !== "none" ? ` (${result.resisted}${result.resistanceApplied === false ? ", not applied" : ""}: ${result.taken})` : ""} → ${SEVERITY_LABEL[result.severity]}${result.massive ? " (Massive)" : ""}${onslaught ? " (Onslaught)" : ""} → ${result.hpMarked + more} HP${more !== 0 ? ` (${more > 0 ? "+" : ""}${more} from riders)` : ""} (${hp}/${t.instance.stats.hpMax})`;
    }
    const defeated = t.instance.defeated || (hp >= t.instance.stats.hpMax && (block.minion || modes.adversaryDefeated !== "manual"));
    await ctx.db.patch("encounterAdversaries", t.instance._id, { hp, defeated, updatedAt: now });
    results.push({ target: t, hit: true, defeated, severity, hpMarked: marked, half });
    targetDamage.push({ tokenId: t.token._id, hpMarked: Math.max(0, marked), ...gmDamage });
    publicParts.push(`${label}: ${defeated ? "Defeated" : "Hit"}`);
    gmParts.push(`${label}: ${detail}${notes.length > 0 ? ` [${notes.join("; ")}]` : ""}${defeated ? ", defeated" : ""}`);
  }
  // A PC a rider added (Surrounded, allies included): the same roll against their Evasion; on a hit the damage opens their
  // incoming-hit window (armor, reactions) in this attack's group, as card damage to another PC does (AA2b).
  const pcHitTotals: { target: PcTarget; amount: number }[] = [];
  for (const [i, t] of pcTargets.entries()) {
    const hit = pcHits[i]!.hit && damageRecord !== null;
    publicParts.push(`${t.sheet.name}: ${hit ? "Hit" : "Miss"}`);
    if (!hit) {
      gmParts.push(`${t.sheet.name}: miss (${roll.total} vs Evasion ${t.evasion + environment.difficulty})`);
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
    const writes = await withoutForcedStress(ctx, instanceWrites(run.plan, run.built.creatures, run.name, srdUses, modes), knownPassives);
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
  for (const r of postOrder(used)) {
    const on = results.filter((x) => standing(x) && (r.phase === "before" || x.hit)).map((x) => x.target.token._id);
    const run = await runRiderPart(env, r, sheet, "post", hostRoll, on, main, subjects.get(r));
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
  const allyRuns = await allyAutoRuns(ctx, campaign, req.scene, character._id, host, hostRoll, main ? subjectOf(main) : undefined, results.filter((x) => x.hit && standing(x)).map((x) => x.target.token._id), hope.rng, rangeNotes);
  const allySheets = new Map<string, { character: Doc<"characters">; before: CharacterSheet; after: CharacterSheet }>();
  for (const a of allyRuns) {
    const writes = await withoutForcedStress(ctx, instanceWrites(a.run.plan, a.run.built.creatures, a.run.name, srdUses, modes), knownPassives);
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
    const writes = await withoutForcedStress(ctx, instanceWrites(afterRun.plan, afterRun.built.creatures, afterRun.name, srdUses, modes), knownPassives);
    await writeInstances(ctx, writes);
    riderWrites.push(...writes);
    riderFear += afterRun.plan.gmFearDelta;
  }

  // ---- E1.4b (dcm-kso9; user answer 2026-11-01, Q3): a target's rider benefit for the attacker (Lead by Example, CB p.342:
  // "The next PC to make an attack against that adversary can clear a Stress or gain a Hope"): the pick made before the
  // roll (`benefit`) runs on the attacker, and the attack uses the rider up, hit or miss (its tag and marker go).
  const consumed: { target: CheckedTarget; label: string }[] = [];
  const benefitLines: string[] = [];
  for (const [i, t] of allTargets.entries()) {
    for (const { label, rider } of facts.get(t.token._id)?.riders ?? []) {
      if (!rider.attackerSteps || rider.attackerSteps.length === 0) continue;
      if (rider.onSuccess === true && !hits[i]!.hit) continue;
      consumed.push({ target: t, label });
      const steps = benefitSteps(rider.attackerSteps, req.benefit);
      if (steps === null) {
        benefitLines.push(`${label}: no benefit taken`);
        continue;
      }
      const ran = attackerStepsRun(sheet, label, steps, hope.rng);
      sheet = ran.sheet;
      benefitLines.push(ran.line);
    }
  }
  const consumedBefore: AdversaryBefore[] = [];
  for (const { target, label } of consumed) {
    const live = await ctx.db.get("encounterAdversaries", target.instance._id);
    if (live === null) continue;
    const tags = (live.tags ?? []).filter((x) => x !== label);
    const conditions = live.conditions.filter((x) => x !== label);
    const effects = (live.effects ?? []).filter((e) => e.label !== label);
    if (tags.length === (live.tags ?? []).length && conditions.length === live.conditions.length && effects.length === (live.effects ?? []).length) continue;
    await ctx.db.patch("encounterAdversaries", live._id, { tags, conditions, effects, updatedAt: Date.now() });
    consumedBefore.push(adversaryBefore(target.instance, true));
  }

  // ---- Lane C2: the attack roll ends the attacker's sourced conditions that end on it (Vanishing Act's Cloaked on a roll
  // with Fear, CB p.42); then CB p.42: "After you make an attack … you are no longer Cloaked." (an ordinary Cloaked only).
  const rollEnds = endConditionsOnRoll(sheet, roll, "weapon");
  // E1.4b (dcm-wli0, roll half): the adversary-given conditions that end on the bearer's roll (Slowed, Rattled, HF p.69:
  // "until they roll with Hope").
  const advRollEnds = endAdversaryConditionsOnRoll(rollEnds.sheet, roll, "weapon");
  // Rule switches (RM's C2 `hiddenEnds`, wired here by RC1): Manual keeps the Cloaked / Hidden and tells the GM instead.
  if (hiddenEndsManual(campaign)) {
    sheet = advRollEnds.sheet;
    const hidden = hiddenLabel(sheet);
    if (hidden !== null) ruleNotes.push({ ruleId: "hiddenEnds", summary: hiddenAttackNote(sheet0.name, weapon.name, hidden) });
  } else sheet = uncloakedByAttack(advRollEnds.sheet);
  // Plan lanes, E1 (dcm-y3e): an effect that gave this attack its extra target ends with it (Parallela, CB p.332: "The next
  // time the target makes an attack"), as does one that ends when its bearer attacks.
  sheet = endedByAttack(sheet, mods);
  // Plan lanes-2, E1 (dcm-wn7): the effect ends this attack sets off (E6's end engine, convex/lib/cardRows.ts).
  const attackEnds = await endsFromAttack(ctx, campaign._id, req.scene.attacker._id, sheet, roll, { slot, trait: host.trait, results, alreadyDefeated: new Set(snapshots.filter((i) => i.defeated).map((i) => i._id)) });
  sheet = attackEnds.sheet;
  finalSheet = sheet;
  // E1.3b (dcm-uwg1): the party's sheets: caster-side ends of this attacker's effects on allies, and other PCs' effects tied
  // to an instance this attack defeated (Marked for Death, HF p.8), saved in this attack's group below.
  const wasDefeated = new Set(snapshots.filter((i) => i.defeated).map((i) => i._id as string));
  const others = (await partyMembers(ctx, campaign._id)).filter((m) => m.character._id !== character._id);
  const partyEnds = partyEndsFromAttack(
    sheet,
    others.map((m) => ({ key: m.character._id as string, sheet: allySheets.get(m.character._id)?.after ?? m.sheet })),
    attackEnds.endRoll,
    attackEnds.worst,
    results.filter((r) => r.defeated && !wasDefeated.has(r.target.instance._id)).map((r) => r.target.instance),
  );
  const partyLines = new Map<string, string[]>();
  for (const pe of partyEnds) {
    const member = others.find((m) => m.character._id === pe.key)!;
    const seen = allySheets.get(member.character._id);
    allySheets.set(member.character._id, { character: member.character, before: seen?.before ?? member.sheet, after: pe.sheet });
    partyLines.set(pe.key, pe.lines);
  }

  const { gained } = effects.fear > 0 ? await gainFear(ctx, campaign._id, effects.fear) : { gained: 0 };
  const fearChanged = gained + (await changeFear(ctx, campaign._id, riderFear));
  // dcm-z9rz.23: the Hope this attack paid (the roll's Experiences and options, every rider's costs, an after-roll feature
  // paid from the roll's own Hope) counts as spent, even when the roll's Hope gives it back.
  const hopePaid =
    Math.max(0, sheetBeforeRoll.hope - duality.paid.hope) +
    [...runs, ...(afterRun ? [afterRun] : [])].reduce((n, r) => n + planHopePaid(r.plan, r.built.context.actor.id, r.built.context.actor.id), 0);
  const sheetChanged = changed(sheet0, finalSheet) || hopePaid > 0;
  noteHopeSpent(ctx, character._id, hopePaid);
  if (sheetChanged) await saveSheet(ctx, character._id, finalSheet);

  // U4: each instance as it was before the attack; with its conditions, tags and effects when a rider changed them too.
  const touched = new Set<string>([...riderWrites.map((w) => w.before.instanceId), ...attackEnds.touched, ...consumedBefore.map((b) => b.instanceId)]);
  const before: AdversaryBefore[] = snapshots.map((i) => (touched.has(i._id) ? adversaryBefore(i, true) : beforeOf(i)));
  // An instance a caster-side end changed that the attack did not touch otherwise (Timejammer's Time Lock elsewhere).
  const inGroup = new Set<string>([...before.map((b) => b.instanceId), ...riderWrites.map((w) => w.before.instanceId)]);
  before.push(...attackEnds.casterBefore.filter((b) => !inGroup.has(b.instanceId)));
  // E1.4b (dcm-kso9): a missed target whose rider this attack used up.
  for (const b of consumedBefore) {
    if (inGroup.has(b.instanceId) || attackEnds.casterBefore.some((c) => c.instanceId === b.instanceId)) continue;
    before.push(b);
    inGroup.add(b.instanceId);
  }
  for (const { target, amount } of pcHitTotals) {
    // Plan rule-switches OP: a PC the attacker named takes the weapon's hit with the attack's total (Evasion answers in
    // their window compare with it, as for an adversary's attack, CB p.168); a rider-added PC keeps the rider's name.
    const by = target.rider ? { cardId: target.rider.id, feature: target.rider.name } : { cardId: weapon.id, feature: weapon.name };
    await openIncomingHit(ctx, {
      campaignId: campaign._id,
      ...(encounterId !== undefined ? { encounterId } : {}),
      mapId: req.scene.map._id,
      createdBy: req.actorId,
      groupId,
      attacker: { kind: "pc", characterId: character._id, label: sheet0.name, ...by },
      targetCharacterId: target.character._id,
      targetTokenId: target.token._id,
      hit: { amount, type, direct: false, forcedArmor: 0, critical, ...(target.rider ? {} : { attackTotal: roll.total }) },
      party: await partyMembers(ctx, campaign._id),
      bands: await bandsOnMap(ctx, req.scene.map._id),
    });
  }
  const riderNames = [...new Set([...(afterRun ? [featureName(afterRun)] : []), ...runs.map((r) => r.name), ...posts.map((r) => r.name), ...(damageOptions.includes(SNEAK_ATTACK) ? ["Sneak Attack"] : []), ...(spirit ? ["Spirit Weapon"] : []), ...(resonance && damageRecord !== null ? ["Sacred Resonance"] : []), ...publicExtras])];
  // E1.4b (dcm-m7tm): the adversary bonuses on the roll's dice, named in the public row ("Ill Omen +3 Fear Die").
  const advBonusNames = advUses.bonuses.map((b) => `${b.feature} ${b.amount >= 0 ? "+" : ""}${b.amount} ${b.die === "hope" ? "Hope" : "Fear"} Die`);
  const usingList = [...duality.extras, ...riderNames, ...advBonusNames, ...environment.labels];
  const using = usingList.length > 0 ? ` (${usingList.join(", ")})` : "";
  // E1.4b (dcm-svux): the per-target totals when the targets' edges differ ("edge d6 4: Shade 15, Brute 7").
  const perTarget = deltas.size > 0 && [...deltas.values()].some((d) => d !== 0) ? ` [edge d6 ${edgeDie ?? "-"}: ${allTargets.map((t) => `${t.instance.label} ${totalFor(roll, t)}`).join(", ")}]` : "";
  const head = `${sheet0.name} attacks with ${weapon.name}: ${TRAIT_LABEL[args.trait]} ${roll.total}${typedLabel(args.modifier)}${perTarget} ${rollWord(roll)}${using}`;
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
    ...(WITH_HOPE.includes(roll.outcome) ? { hopeGained: effects.hope > 0 && rollGaveHope(duality.paid, roll.outcome, "action") } : {}),
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
    ...(targetDamage.length > 0 ? { targetDamage } : {}),
    undoable: true,
  });
  // Rule switches RC1: the Manual rules' GM notes (C1, M1, D2, D8; D6 below), in the attack's group (undo takes them back).
  for (const summary of lastHpNotes(riderWrites, modes)) ruleNotes.push({ ruleId: "adversaryDefeated", summary });
  for (const summary of rangeNotes) ruleNotes.push({ ruleId: "definedRanges", summary });
  if (duality.experienceManual !== null) ruleNotes.push({ ruleId: "experienceCost", summary: duality.experienceManual });
  const posted = new Set<string>();
  for (const n of ruleNotes) {
    if (posted.has(n.summary)) continue;
    posted.add(n.summary);
    await postRuleNote(ctx, campaign, { ruleId: n.ruleId, summary: n.summary, groupId, actorId: req.actorId });
  }
  // E1.4b (dcm-kso9): the rider benefits taken (Lead by Example's Stress or Hope), in the attack's group.
  if (benefitLines.length > 0) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: req.actorId, kind: "feature", visibility: "public", summary: `${sheet0.name}: ${benefitLines.join("; ")}`.slice(0, 1000), groupId, undoable: true });
  }
  // E1.3b: what a target's rider asks that the attack can't apply (its damage kinds the engine doesn't run).
  for (const text of [...new Set(riderManual)]) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: req.actorId, kind: "feature", visibility: "public", summary: `${sheet0.name}: ${text}`.slice(0, 1000), groupId, undoable: true });
  }
  riderLines.push(...advUses.lines);
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
  if (rollEnds.ended.length > 0 || advRollEnds.lines.length > 0) {
    await logAction(ctx, {
      campaignId: campaign._id,
      characterId: character._id,
      actorId: req.actorId,
      kind: "feature",
      visibility: "public",
      summary: [...rollEnds.ended.map((e) => endedConditionLine(sheet0.name, e)), ...advRollEnds.lines].join("; ").slice(0, 1000),
      groupId,
      undoable: true,
    });
  }
  if (attackEnds.lines.length > 0) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: req.actorId, kind: "feature", visibility: "public", summary: attackEnds.lines.join("; ").slice(0, 1000), groupId, undoable: true });
  }
  if (attackEnds.gmLines.length > 0) {
    await logAction(ctx, { campaignId: campaign._id, actorId: req.actorId, kind: "combat", visibility: "gm", summary: attackEnds.gmLines.join("; ").slice(0, 1000), groupId, undoable: true });
  }
  for (const p of riderPrompts.filter((x) => x.kind === "manual")) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: req.actorId, kind: "feature", visibility: "public", summary: `${sheet0.name}: ${p.text}`.slice(0, 1000), groupId, undoable: true });
  }
  // Plan lanes, E1: an ally whose automatic use ran on this roll: their sheet in the group (undo reverts it).
  for (const a of allySheets.values()) {
    if (!changed(a.before, a.after)) continue;
    await saveSheet(ctx, a.character._id, a.after);
    const ran = allyRuns.filter((r) => r.character._id === a.character._id).map((r) => r.run.name);
    const parts = [...(ran.length > 0 ? [`${a.before.name}: ${ran.join(", ")} on ${sheet0.name}'s roll`] : []), ...(partyLines.get(a.character._id) ?? [])];
    await logAction(ctx, { campaignId: campaign._id, characterId: a.character._id, actorId: req.actorId, kind: "feature", visibility: "public", summary: parts.join("; ").slice(0, 1000), groupId, before: a.before, undoable: true });
  }

  // E1.4b (dcm-wli0, attack half): an instance this attack damaged ends the PC conditions it gave that end on its damage
  // (Envelop's Restrained on Severe; Hold Them Down / Encumber on Major or more). Last, on the sheets as saved above; each
  // changed sheet is its own row in this group (undo puts it back).
  for (const r of results) {
    if (!r.hit || (r.hpMarked <= 0 && r.severity === "none")) continue;
    const severity: EndSeverity = r.severity === "defeat" ? "minor" : r.severity;
    await endAdversaryConditionsForCaster(ctx, { campaignId: campaign._id, casterId: r.target.instance._id, occ: { kind: "damageTaken", severity, hpMarked: Math.max(0, r.hpMarked), lastHp: r.defeated && !wasDefeated.has(r.target.instance._id) }, groupId, actorId: req.actorId });
  }

  // Armed countdowns tick right after the attack roll, as for `actionRoll` (countdowns-advanced K1, CB p.162).
  if (countsAsActionRoll(roll, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: roll.outcome, actorId: req.actorId });
  }
  // Plan rule-switches RA (S1, R3): an attack that hit nobody failed (CB p.96); with Fear or failed, the spotlight goes to the
  // GM (or the GM gets a note); R3 Manual notes the Fear the roll did not gain. In the attack's group.
  await afterPcActionRoll(ctx, campaign, {
    characterId: character._id,
    name: sheet0.name,
    kind: "action",
    success: hostRoll.success,
    withFear: hostRoll.withFear,
    fearWithheld: fearWithheldBy(duality.hopeFear, "action", roll.outcome),
    critical,
    groupId,
    actorId: req.actorId,
  });
  // WR (R7): Book takes each helper's Hope (one row each in the group, undo refunds it); Manual posts the GM's note.
  await payHelpers(ctx, campaign, help, { groupId, actorId: req.actorId, rollerName: sheet0.name });

  const minions = extra > 0 ? await offerMinions(ctx, req, { groupId, entryId, extra, total: roll.total - environment.difficulty, critical, damage: damageRecord?.total ?? 0 }) : { offer: null };
  const minionOffer = minions.offer;
  const riderPicks: Infer<typeof riderPickOfferValidator>[] = [];
  for (const { rider, candidates } of toPrompt) {
    const requestId = await openRiderPick(ctx, {
      campaignId: campaign._id,
      ...(encounterId !== undefined ? { encounterId } : {}),
      mapId: req.scene.map._id,
      createdBy: req.actorId,
      payload: { schemaVersion: 1, kind: "riderPick", characterId: character._id, groupId, entryId, rider: { source: rider.source, id: rider.id, useId: rider.useId, name: rider.name }, candidates, hostRoll },
    });
    riderPicks.push({ requestId, name: rider.name, candidates });
  }
  // FH-AP (user 2026-11-05): the riders whose choosers each pick their own option, when their trigger held (Rousing
  // Strike on a critical): each chooser answers on their own screen and the rider runs once all picked.
  const holding = ownPicks.filter((r) => {
    const holds = resultHolds(r.trigger, hostRoll) && rollTargetHolds(r.trigger, host, req.scene.attacker, main ? subjectOf(main) : undefined, rangesOn(req.scene)) &&(rollOnly(r.trigger) || hitIds().length > 0);
    if (!holds) skipped.push(r.name);
    return holds;
  });
  const allyPicks = holding.length > 0 ? await openRiderAllyPicks(ctx, { env, riders: holding, hostRoll, entryId, groupId, ...(encounterId !== undefined ? { encounterId } : {}), createdBy: req.actorId }) : [];
  const prompts = afterDualityRoll(finalSheet, { hope: rolled.hope, fear: rolled.fear, roll }, CLASS_FEATURES, duality.scope);
  const outcomes = [
    ...results.map((r) => ({ tokenId: r.target.token._id, hit: r.hit, defeated: r.defeated })),
    ...pcTargets.map((t, i) => ({ tokenId: t.token._id, hit: pcHits[i]!.hit && damageRecord !== null, defeated: false })),
  ];
  // dcm-uemx (user 2026-11-09): the GM's HUD shows the player's result panel too (`combatHud.playerResults`).
  const targetNames = new Map<string, string>([...results.map((r) => [r.target.token._id as string, r.target.instance.label] as const), ...pcTargets.map((t) => [t.token._id as string, t.sheet.name] as const)]);
  await attachResultPanel(ctx, entryId, {
    kind: "attack",
    title: weapon.name,
    actorName: sheet0.name,
    damageType: damageTypeOf(weapon),
    roll,
    damage: damageRecord !== null ? [damageRecord] : [],
    success: hostRoll.success,
    targets: outcomes.map((o) => ({ ...o, name: targetNames.get(o.tokenId) ?? "Target" })),
    prompts: riderPrompts.filter((p) => p.kind !== "fold").map((p) => ({ kind: p.kind, text: p.text })),
    notes: [],
    ...(riderNames.length > 0 ? { riders: riderNames } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(minionOffer !== null ? { minionOffer: true as const } : {}),
    ...(minions.forGm !== undefined ? { minionsForGm: minions.forGm } : {}),
  });
  return {
    status: "resolved",
    entryId,
    roll,
    damage: damageRecord,
    targets: outcomes,
    fearGained: gained,
    minionOffer,
    ...(minions.forGm !== undefined ? { minionsForGm: minions.forGm } : {}),
    prompts,
    ...(riderNames.length > 0 ? { riders: riderNames } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(riderPrompts.length > 0 ? { riderPrompts: riderPrompts.filter((p) => p.kind !== "fold") } : {}),
    ...(riderPicks.length > 0 ? { riderPicks } : {}),
    ...(allyPicks.length > 0 ? { allyPicks } : {}),
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
  const target: CheckedTarget = { token, ...linked, check: rangeCheck(scene.attacker, token, "melee", rangesOn(scene)), sight: sightTo(scene, token) };
  const host: Host = { spec: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } }, trait: undefined, weapon: true, weaponRange: null, damageType: "physical" };
  const env: RiderEnv = { ctx, campaign, character, scene, host, gmFear: (await campaignFearState(ctx, campaign._id)).fear, rng: rollDie, rollUsedExperience: false };
  const rider: PickedRider = { source: p.rider.source, id: p.rider.id, useId: p.rider.useId, name: p.rider.name, trigger: use.activation.trigger, phase: "damage", choices: [], auto: false };
  const run = await runRiderPart(env, rider, loaded.sheet, "whole", p.hostRoll, [token._id], target, token._id);
  if (run === null || run === "empty") throw appError("INVALID");
  // RC1: D8 Manual leaves the instance up at its last HP (the GM is told, in the attack's group).
  const modes = ruleModesOf(campaign);
  const writes = await withoutForcedStress(ctx, instanceWrites(run.plan, run.built.creatures, run.name, srdUses, modes), new Map());
  await writeInstances(ctx, writes);
  for (const summary of lastHpNotes(writes, modes)) await postRuleNote(ctx, campaign, { ruleId: "adversaryDefeated", summary, groupId: p.groupId, actorId });
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
  attack: { groupId: string; entryId: Id<"actionLog">; extra: number; total: number; critical: boolean; damage: number },
): Promise<MinionDeal> {
  const s = req.scene;
  const campaign = req.loaded.campaign;
  const encounterId = req.targets[0]!.encounter._id;
  const range = rangeFromWeapon(req.weapon.range);
  const modes = ruleModesOf(campaign);
  const picker = minionPicker(modes.minions);
  const candidates: Infer<typeof minionOfferValidator>["candidates"] = [];
  for (const [i, token] of s.scene.tokens.entries()) {
    if (i === s.viewer.index || token.side !== "enemy") continue;
    // M1 (RC1): Book needs the token seen with a clear line; Manual drops the line, but the attacker picks only what they see.
    const seen = seenBy(s, i);
    if (sightRule("", sightTo(s, token), modes.lineOfSight, seen).refused || (!seen && picker === "attacker")) continue;
    const linked = await enemyInstance(ctx, campaign._id, token);
    if (linked === null || linked.encounter._id !== encounterId) continue;
    const block = await blockOf(ctx, linked.instance);
    if (!block.minion) continue;
    // Rule switches ODR: Defined Ranges off, every Minion is offered (the attacker or GM judges the range by eye).
    if (!rangeCheck(s.attacker, token, range, modes.definedRanges).inRange) continue;
    if (!attack.critical && attack.total < difficultyOf(linked.instance)) continue;
    const available = Math.min(attack.extra, linked.instance.stats.hpMax - linked.instance.hp);
    if (available > 0) candidates.push({ instanceId: linked.instance._id, tokenId: token._id, name: linked.instance.label, available });
  }
  return dealMinions(ctx, campaign, {
    picker,
    encounterId,
    mapId: s.map._id,
    actorId: req.actorId,
    characterId: req.loaded.character._id,
    attackerName: req.loaded.sheet.name,
    groupId: attack.groupId,
    entryId: attack.entryId,
    extra: attack.extra,
    damage: attack.damage,
    candidates,
  });
}

/** D6 (RC1): the offer for the attacker (Book), the offer waiting on the GM (`forGm`, variant), or nothing (Manual: a note). */
export type MinionDeal = { offer: Infer<typeof minionOfferValidator> | null; forGm?: number };

/**
 * D6 (CB p.201; plan rule-switches RC1): what a PC's extra Minion defeats open, once the candidates are known. Book: the
 * attacker's offer (`combatActions.pickMinions`). Variant "GM picks the extra Minions" (not in the books, Q5 a): the same
 * offer marked `picker: "gm"`, picked on the GM's HUD; the player learns only how many (`forGm`). Manual: no offer; only
 * the hit Minion fell, and the GM gets "Ash's 7 damage: defeat 2 more Minions? (in range: Rats)" in the attack's group.
 * Nothing when no Minion is left to pick.
 */
export async function dealMinions(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  deal: {
    picker: ReturnType<typeof minionPicker>;
    encounterId: Id<"encounters">;
    mapId: Id<"combatMaps">;
    actorId: Id<"users">;
    characterId: Id<"characters">;
    attackerName: string;
    groupId: string;
    entryId: Id<"actionLog">;
    extra: number;
    damage: number;
    candidates: Infer<typeof minionOfferValidator>["candidates"];
  },
): Promise<MinionDeal> {
  const { candidates, extra } = deal;
  if (candidates.length === 0) return { offer: null };
  if (deal.picker === null) {
    await postRuleNote(ctx, campaign, { ruleId: "minions", summary: minionNote(deal.attackerName, deal.damage, extra, candidates.map((c) => c.name)), groupId: deal.groupId, actorId: deal.actorId });
    return { offer: null };
  }
  const requestId = await openMinionOffer(ctx, {
    campaignId: campaign._id,
    encounterId: deal.encounterId,
    mapId: deal.mapId,
    createdBy: deal.actorId,
    payload: {
      schemaVersion: 1,
      kind: "minionOffer",
      characterId: deal.characterId,
      groupId: deal.groupId,
      entryId: deal.entryId,
      extra,
      candidates: candidates.map(({ instanceId, tokenId, available }) => ({ instanceId, tokenId, available })),
      ...(deal.picker === "gm" ? { picker: "gm" as const } : {}),
    },
  });
  return deal.picker === "gm" ? { offer: null, forGm: extra } : { offer: { requestId, extra, candidates } };
}
