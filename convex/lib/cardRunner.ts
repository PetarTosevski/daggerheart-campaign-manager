/**
 * Domain cards used on the Combat Map (plan combat-actions, tracers CA4 / CA4b; docs/tasks/TASK-CA-CA4.md,
 * TASK-CA-CA4b.md): the steps behind `combatCards.useCard` and the GM's card sanction. Callers are campaign wrappers that
 * already loaded the character with edit permission; these helpers check the card, build the runner's context from the
 * live map, run CA1's pure runner (src/lib/domain/card-effects/run.ts) with the server's dice and turn the plan into the
 * sheets it changes. AA2 reuses `cardActor`, `pcCombatant`, `writeSheetChanges` for reaction cards in its window.
 * Split (CH9): the arguments and kept dice are in ./cardChoices, the instance writes and row words in ./cardRows, the Hand
 * and rest timing in ./cardHand.
 *
 * Rules (printed pages; quotes in the task docs):
 * - R6 / Q3 / Q4 (CB p.101): once-per limits are `featureUses` keys `card:<id>` with until rest / longRest; "on a
 *   success" limits are used up only by a success (the runner decides, this module writes `plan.actor.featureUses`).
 * - R8 (CB p.90): Hope gained on the card's own roll can pay its later costs (the runner orders it).
 * - R2 / R9 (CB p.98, p.104): damage rolled once per use and totalled per creature before thresholds; a critical adds
 *   the dice's maximum. R3 / R5 / R10: thresholds, Stress overflow, resistance (CA1's `applyDamageTo`).
 * - R12 / Q7 (CB p.161): an adversary's reaction roll is a server d20 against the card's Difficulty.
 * - R11 / Q1 / Q2 (CB p.103-104): a creature outside the card's range waits for the GM; no line of sight refuses; cover
 *   gives the roll one disadvantage. CA4b: every target, picked, ally and follow-up creature is measured from the origin
 *   the card's wording names (`rangeOrigin`).
 * - U1: what a player receives holds hit / miss / defeated, their own dice and their own sheet changes; an enemy's HP,
 *   Stress, thresholds and Difficulty are only on the GM's row.
 *
 * Plan sheet-drawer SD3 (docs/tasks/TASK-SD-SD3.md): the card pick is a `UsePick` {effect, use, name, limitKey} that a
 * Hope / class / subclass / heritage / Beastform / transformation / stance feature fills too (convex/lib/featureRunner.ts),
 * with its own runner (`runFeature`, D5 delegation), refusal codes and actor extras. A feature use without a live map
 * builds its run with no scene (self and party uses only; a token target is FEATURE_NEEDS_MAP). A feature's effects on a
 * sheet are `feat:<hash>:<n>` (sheet effect ids hold 40 characters, a feature id up to 53), on an instance
 * `feat:<featureId>:<n>`; its tokens are `cardTokens` under `feat:<featureId>`.
 */
import { type Infer } from "convex/values";

import { pickUse, run, type ActorState, type PlanStep, type ResolvedMod, type RunContext, type RunPlan, type RunRefusal, type WeaponInfo } from "../../src/lib/domain/card-effects/run";
import type { OtherSheet } from "../../src/lib/domain/class-features/types";
import type { RollRecord } from "../../src/lib/domain/duality";
import { endsOnOccurrence, type EndRoll } from "../../src/lib/domain/characters/expiry";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CardEffect, CardUse, Duration, Mod, Range, Step, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { featureUseKey, recordUsedOn, usedOnBefore, type CreatureFacts, type PayerState, type StateFacts } from "../../src/lib/domain/card-effects/availability";
import type { MapCreature, MarkedTracks } from "../../src/lib/domain/combat-actions/numbers";
import { lastingModsOf } from "../../src/lib/domain/adversary-effects/run";
import { lineOfSight, rangeCheck, rangeFromWeapon, tokenDistance, type Combatant, type SightResult } from "../../src/lib/domain/combat-actions/index";
import { tokenVisibility } from "../../src/lib/domain/combat-map/index";
import { derivedDefense, derivedThresholds, withPassiveTraits } from "../../src/lib/domain/characters/derived";
import { withEffects } from "../../src/lib/domain/characters/effects";
import { hopeMax, tierForLevel } from "../../src/lib/domain/characters/index";
import { spellcastTraitOf } from "../../src/lib/domain/characters/spellcast";
import { gainSlots, type SlotCounts } from "../../src/lib/domain/characters/slots";
import { minionValue } from "../../src/lib/domain/adversaries/index";
import { assertTypedModifier, experienceBonus, spendHope, type Rng } from "../../src/lib/domain/dice/index";
import { appError } from "../../src/lib/errors/app-error";
import { srdAdversary } from "../../src/lib/srd/adversary-lookup";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects/index";
import { cardEffect, cardUsage } from "../../src/lib/srd/card-effects/index";
import { getDomainCard, getWeapon } from "../../src/lib/srd/index";
import type { DomainId, TraitId, Weapon } from "../../src/lib/srd/types";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { FEATURE_USES_MAX } from "../../src/lib/validation/character-constants";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { activeAreasOnMap, areaFactsFor } from "./combatAreas";
import type { AttackScene } from "./combatActions";
import { preparedFor } from "./areaSight";
import { DEFAULT_OPTIONALS, MAX_CARD_TARGETS, MAX_CHAIN_LINKS, type CardRoll, type ParsedChoices } from "./cardChoices";
import type { ChoiceAsks } from "./cardRows";
import { rangeBandValidator } from "./validators/combatRequests";
import { readSheet } from "./characterSheet";
import { rules } from "./rolls";
import { stanceDropMarker } from "./stanceDrop";
import {
  cardIdOfEffect,
  conditionMarkerOf,
  conditionSources,
  effectKeyOf,
  featureIdOfEffect,
  isFeatureUseId,
  isMarker,
  ownsEffect,
  sourceEnds,
  STANDARD,
  tokenKeyOf,
  withoutCondition,
  type EndedCondition,
} from "./conditionMarkers";

export {
  cardIdOfEffect,
  conditionMarkerOf,
  conditionSources,
  effectKeyOf,
  featureIdOfEffect,
  isFeatureUseId,
  ownsEffect,
  sourceEnds,
  tokenKeyOf,
  withoutCondition,
  type EndedCondition,
};
export { endedConditionLine } from "./conditionMarkers";
import { unshakePlan, type UnshakableRoll } from "./unshakable";


// ---------------------------------------------------------------- the card and its use

/** What a feature's D5 delegation left behind (convex/lib/featureRunner.ts): the actor's sheet, other sheets, D5 rolls. */
export type Delegated = { sheet?: CharacterSheet; others: OtherSheet[]; rolls: RollRecord[] };

/** A runner's answer: the card runner's `run`, or the feature runner's `runFeature` with what its D5 features changed. */
export type UseRunResult = { ok: true; plan: RunPlan; delegated?: Delegated } | RunRefusal;

/**
 * The use asked for (SD3: cards and features alike). `limitKey`: the `cardTokens` id of its tokens, the card id for a
 * card and `feat:<featureId>` for a feature. A feature brings its own runner (`runFeature` with D5 delegation and
 * upgrades), its refusal codes (FEATURE_*) and the actor's extras (Favor, Focus, held dice, the facts its requirements
 * read).
 */
export type UsePick = {
  effect: CardEffect;
  use: CardUse;
  name: string;
  limitKey: string;
  run?: (context: RunContext) => UseRunResult;
  refusal?: (r: RunRefusal) => Error;
  actor?: (actor: ActorState) => ActorState;
};

/** A domain card's pick (the CA4 name, kept). */
export type CardPick = UsePick;

const invalid = (what: string) => appError("INVALID", what);

/**
 * The card's effect entry and the use asked for. CARD_NOT_IN_LOADOUT for a card not in the loadout; CARD_NOT_COMBAT for
 * an out-of-combat card (CA0 classification), a card without an entry, or a passive use (always on: nothing to use).
 */
export function pickCard(sheet: CharacterSheet, cardId: string, spell: string | undefined): CardPick {
  if (!sheet.domainCards.loadout.includes(cardId)) throw appError("CARD_NOT_IN_LOADOUT");
  const card = getDomainCard(cardId);
  const effect = cardEffect(cardId);
  if (card === undefined || effect === undefined || cardUsage(cardId) === "outOfCombat") throw appError("CARD_NOT_COMBAT");
  const use = pickUse(effect, spell);
  if (use === undefined) throw invalid(`${card.name} has no "${spell ?? ""}".`);
  if (use.activation.kind === "passive") throw appError("CARD_NOT_COMBAT", `${use.name} is always on.`);
  return { effect, use, name: card.name, limitKey: cardId };
}

// ---------------------------------------------------------------- combatants

function weaponInfo(weapon: Weapon | undefined, trait: TraitId | undefined): WeaponInfo | undefined {
  if (!weapon) return undefined;
  return {
    damage: weapon.damage,
    trait: weapon.trait === "choice" ? (trait ?? "strength") : weapon.trait,
    damageType: weapon.damageType === "magic" ? "magic" : "physical",
    range: rangeFromWeapon(weapon.range),
  };
}

/** A PC as the engine reads it (an ally, or the actor before its card fields). Evasion and Armor after gear and effects. */
export function pcCombatant(id: string, sheet: CharacterSheet): Combatant & { armor: number; armorMax: number } {
  const live = withEffects(sheet);
  const defense = derivedDefense(live);
  return {
    id,
    side: "pc",
    evasion: defense.evasion,
    thresholds: derivedThresholds(sheet),
    hp: sheet.hp,
    hpMax: sheet.hpMax,
    stress: sheet.stress,
    stressMax: sheet.stressMax,
    armor: sheet.armorMarked,
    armorMax: defense.armorScore,
    defeated: false,
    conditions: sheet.conditions.filter((c) => STANDARD.has(c)),
    tags: sheet.effects.map((e) => e.source),
  };
}

/**
 * The PC using the card, with the values the runner reads (traits after effects, Spellcast value, the card's tokens).
 * `cardId` is the `cardTokens` id: the card id, or `feat:<featureId>` for a feature (SD3).
 */
export function cardActor(id: string, sheet: CharacterSheet, cardId: string, trait: TraitId | undefined): ActorState {
  // DA19 (B1, dcm-bxp.99.19.19): traits with the passive features' bonuses (a Beastform's statistics, CB p.30).
  const live = withPassiveTraits(withEffects(sheet));
  const spellTrait = spellcastTraitOf(sheet);
  const domainsOf = (ids: readonly string[]) => ids.flatMap((c) => (getDomainCard(c) ? [getDomainCard(c)!.domain as DomainId] : []));
  const vault = sheet.domainCards.owned.filter((c) => !sheet.domainCards.loadout.includes(c));
  const primary = getWeapon(sheet.primaryWeaponId);
  const secondary = sheet.secondaryWeaponId ? getWeapon(sheet.secondaryWeaponId) : undefined;
  const weapons: { primary?: WeaponInfo; secondary?: WeaponInfo } = {};
  const p = weaponInfo(primary, trait);
  const s = weaponInfo(secondary, trait);
  if (p) weapons.primary = p;
  if (s) weapons.secondary = s;
  const pc = pcCombatant(id, sheet);
  return {
    ...pc,
    // Plan lanes-2 E4.3 (dcm-q40t, dcm-rs1z): the derived stats a `stat` number reads (Armor Score, thresholds, Evasion).
    stats: { armorScore: pc.armorMax, majorThreshold: pc.thresholds.major ?? 0, severeThreshold: pc.thresholds.severe ?? 0, evasion: pc.evasion ?? 0 },
    hope: sheet.hope,
    hopeMax: hopeMax(sheet.scars, sheet.hopeSlotBonus),
    traits: live.traits,
    spellcast: spellTrait ? live.traits[spellTrait] : 0,
    proficiency: sheet.proficiency,
    level: sheet.level,
    tier: tierForLevel(sheet.level),
    loadoutDomains: domainsOf(sheet.domainCards.loadout),
    vaultDomains: domainsOf(vault),
    armorWorn: sheet.armorId !== undefined && sheet.armorId !== "",
    activeCardEffects: [...new Set(sheet.effects.flatMap((e) => cardIdOfEffect(e) ?? []))],
    cardTokens: sheet.cardTokens?.find((t) => t.cardId === cardId)?.count ?? 0,
    featureUses: sheet.featureUses,
    weapons,
  };
}

type Block = { minion: boolean; minionX: number | null; resistance: Combatant["resistance"] };

/** Minion type and X, and the resistance that applies now (as CA3's `blockOf`: the instance's own, a conditional one only while toggled on). */
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

/** The instance's Difficulty with card modifiers on it. Never sent to a player. */
export function difficultyOf(instance: Doc<"encounterAdversaries">): number {
  return instance.stats.difficulty + (instance.effects ?? []).reduce((sum, e) => sum + (e.difficulty ?? 0), 0);
}

function enemyCombatant(id: string, instance: Doc<"encounterAdversaries">, block: Block): Combatant {
  const base: Combatant = {
    id,
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
  // One Minion of a group (one HP per Minion): any damage defeats it; X gives the extra defeats (CB p.201).
  return block.minion ? { ...base, hp: 0, hpMax: 1, thresholds: { major: null, severe: null }, minionX: block.minionX ?? 0 } : base;
}

// ---------------------------------------------------------------- the scene: tokens to creatures

export type EnemyCreature = {
  kind: "enemy";
  tokenId: Id<"combatTokens">;
  token: Doc<"combatTokens">;
  instance: Doc<"encounterAdversaries">;
  encounter: Doc<"encounters">;
  minion: boolean;
  combatant: Combatant;
  sight: SightResult;
};
export type PcCreature = { kind: "pc"; tokenId: Id<"combatTokens">; token: Doc<"combatTokens">; character: Doc<"characters">; sheet: CharacterSheet; combatant: Combatant };
export type SelfCreature = { kind: "self"; tokenId: Id<"combatTokens">; token: Doc<"combatTokens"> };
export type Creature = EnemyCreature | PcCreature | SelfCreature;

function seenBy(s: AttackScene, index: number): boolean {
  return tokenVisibility(s.viewer.view, s.scene.visionTokens[index]!) !== "hidden";
}

/** An enemy token's encounter instance: an enemy-side adversary token of a running encounter, not defeated. */
async function enemyInstance(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">) {
  if (token.side !== "enemy" || token.ref.kind !== "adversary") return null;
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  if (instance === null || instance.campaignId !== campaignId || instance.defeated) return null;
  const encounter = await ctx.db.get("encounters", instance.encounterId);
  if (encounter === null || encounter.campaignId !== campaignId || encounter.status !== "running") return null;
  return { instance, encounter };
}

/**
 * One token named by the player, as a creature. Enemies must be seen with a clear line (COMBAT_NO_LINE_OF_SIGHT, Q2)
 * and belong to a running encounter's undefeated instance (COMBAT_TARGET_INVALID); PCs are the party's tokens on the map.
 * The actor's own token is `self`. Cached per token so a creature named twice is one combatant.
 */
export class Creatures {
  private readonly byId = new Map<string, Creature>();
  constructor(
    private readonly ctx: QueryCtx,
    private readonly campaignId: Id<"campaigns">,
    private readonly liveScene: AttackScene | null,
    readonly actorSheet: CharacterSheet,
  ) {}

  /** The live map (SD3: a feature used without one has none; asking for it is FEATURE_NEEDS_MAP). */
  get scene(): AttackScene {
    if (this.liveScene === null) throw appError("FEATURE_NEEDS_MAP");
    return this.liveScene;
  }

  /** Whether the use runs on a live map. */
  get onMap(): boolean {
    return this.liveScene !== null;
  }

  get all(): Creature[] {
    return [...this.byId.values()];
  }

  get(tokenId: string): Creature | undefined {
    return this.byId.get(tokenId);
  }

  async resolve(tokenId: string): Promise<Creature> {
    const cached = this.byId.get(tokenId);
    if (cached) return cached;
    const s = this.scene;
    const index = s.scene.tokens.findIndex((t) => t._id === tokenId);
    if (index < 0) throw appError("COMBAT_TARGET_INVALID");
    const token = s.scene.tokens[index]!;
    let creature: Creature;
    if (index === s.viewer.index) creature = { kind: "self", tokenId: token._id, token };
    else if (token.side === "enemy") {
      if (!seenBy(s, index)) throw appError("COMBAT_NO_LINE_OF_SIGHT");
      const sight = lineOfSight(s.attacker.ref.kind === "pc" ? preparedFor(s.scene, s.attacker.ref.characterId) : s.scene.prepared, s.attacker, token, s.scene.visionObjects);
      if (!sight.lineOfSight) throw appError("COMBAT_NO_LINE_OF_SIGHT");
      const linked = await enemyInstance(this.ctx, this.campaignId, token);
      if (linked === null) throw appError("COMBAT_TARGET_INVALID");
      const block = await blockOf(this.ctx, linked.instance);
      creature = { kind: "enemy", tokenId: token._id, token, ...linked, minion: block.minion, combatant: enemyCombatant(token._id, linked.instance, block), sight };
    } else if (token.side === "pc" && token.ref.kind === "pc") {
      const character = await this.ctx.db.get("characters", token.ref.characterId);
      if (character === null || character.campaignId !== this.campaignId) throw appError("COMBAT_TARGET_INVALID");
      const sheet = readSheet(character.sheet);
      creature = { kind: "pc", tokenId: token._id, token, character, sheet, combatant: pcCombatant(token._id, sheet) };
    } else throw appError("COMBAT_TARGET_INVALID");
    this.byId.set(tokenId, creature);
    return creature;
  }

  /** Every enemy token the actor sees with a clear line that can be attacked (for "all targets" and Minion offers). */
  async visibleEnemies(): Promise<EnemyCreature[]> {
    const out: EnemyCreature[] = [];
    if (this.liveScene === null) return out;
    for (const [i, token] of this.scene.scene.tokens.entries()) {
      if (i === this.scene.viewer.index || token.side !== "enemy" || !seenBy(this.scene, i)) continue;
      try {
        const c = await this.resolve(token._id);
        if (c.kind === "enemy") out.push(c);
      } catch {
        // not attackable (no line of sight, no running instance): skipped
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- ranges (Q1, CA4b user answer)

type Band = Infer<typeof rangeBandValidator>;
export type OutOfRange = { tokenId: Id<"combatTokens">; band: Band };


/** The `pick` of the use's first step sending to `to` (nested steps included), or the first follow-up's targets. */
function stepSpec(steps: readonly Step[], match: (s: Step) => TargetSpec | undefined): TargetSpec | undefined {
  for (const step of steps) {
    const own = match(step);
    if (own) return own;
    for (const value of Object.values(step)) {
      if (!Array.isArray(value)) continue;
      const nested = value.flatMap((x: unknown) => (x !== null && typeof x === "object" && "kind" in x ? [x as Step] : x !== null && typeof x === "object" && Array.isArray((x as { steps?: unknown }).steps) ? (x as { steps: Step[] }).steps : []));
      const found = stepSpec(nested, match);
      if (found) return found;
    }
  }
  return undefined;
}

export function extraSpecs(use: CardUse): { picked?: TargetSpec; allies?: TargetSpec; followUp?: TargetSpec } {
  const to = (recipients: string[]) => (s: Step) => ("to" in s && recipients.includes(s.to as string) && "pick" in s ? (s.pick as TargetSpec | undefined) : undefined);
  const picked = stepSpec(use.steps, to(["picked"]));
  const allies = stepSpec(use.steps, to(["allies", "selfAndAllies"]));
  const followUp = stepSpec(use.steps, (s) => (s.kind === "followUp" ? s.targets : undefined));
  return { ...(picked ? { picked } : {}), ...(allies ? { allies } : {}), ...(followUp ? { followUp } : {}) };
}

/**
 * Where a creature of `spec` is measured from (CB p.103 "Ranges are measured from the actor unless `area` says
 * otherwise"): `aroundTarget` from the use's targets (any of them; a chain also from the earlier follow-ups), `aroundSelf`
 * from the actor with the area's radius, everything else from the actor with the spec's range. Plan lanes E4 (dcm-dgu):
 * `origin: "target"` / `"chain"` measure from `from` (the use's targets; a chain also the earlier links) with the spec's
 * range (`areaRange` when it has one). `aroundPoint` / `origin: "point"`, `line`, `front`, `path` and `between` have no
 * point or shape among the use's arguments yet: the actor (task doc TASK-LN-E4.md).
 */
export function rangeOrigin(scene: AttackScene, spec: TargetSpec | undefined, range: Range | "unlimited", from: readonly Creature[], c: Creature): { inRange: boolean; band: Band } | null {
  if (spec === undefined || c.kind === "self") return null;
  const origins = from.filter((o) => o.kind !== "self" && o.tokenId !== c.tokenId);
  const fromOthers = spec.area === "aroundTarget" ? spec.areaRange : spec.origin === "target" || spec.origin === "chain" ? (spec.areaRange ?? range) : undefined;
  if (fromOthers !== undefined && origins.length > 0) {
    const checks = origins.map((o) => rangeCheck(o.token, c.token, fromOthers));
    const best = checks.reduce((a, b) => (b.distance < a.distance ? b : a));
    return { inRange: checks.some((x) => x.inRange), band: best.band };
  }
  const radius = spec.area === "aroundSelf" ? (spec.areaRange ?? range) : range;
  const check = rangeCheck(scene.attacker, c.token, radius);
  return { inRange: check.inRange, band: check.band };
}

// ---------------------------------------------------------------- building the run

export type CardRequest = {
  /** The character, the campaign and the sheet (already loaded with edit). */
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  sheet: CharacterSheet;
  /** The live map; null for a feature used without one (SD3: self and party uses only). */
  scene: AttackScene | null;
  pick: CardPick;
  targetTokenIds: readonly string[];
  choices: ParsedChoices;
  roll: CardRoll;
  gmFear: number;
  /** The latest action roll of the character succeeded with Hope (Second Wind's "The attack succeeded with Hope"). */
  lastRollWithHope: boolean;
  /**
   * Plan lanes-2 E4.3 (dcm-va0f, dcm-dgu (2)): the squares picked for a use whose targets name `points` or an
   * `aroundPoint` / `origin: "point"` area (Unleash Hellfire's bursts, Zone of Protection). At most MAX_CARD_POINTS, each
   * within the use's range of the actor. E1.3a passes `useCard`'s `point` / `points` args.
   */
  points?: readonly MapPoint[];
};

export type BuiltRun = {
  context: Omit<RunContext, "rng">;
  /** The sheet after the Experiences' Hope (the runner's actor starts from it). */
  paidSheet: CharacterSheet;
  creatures: Creatures;
  targets: Creature[];
  outOfRange: OutOfRange[];
  /** The card's range for Minion offers ("unlimited" without one). */
  range: Range | "unlimited";
};

const SECOND_WIND_SITUATION = "The attack succeeded with Hope";

function specOf(use: CardUse): TargetSpec | undefined {
  return use.targets && use.targets.side !== "trigger" ? (use.targets as TargetSpec) : undefined;
}

/** Plan lanes E4 (dcm-d7h): the fewest targets a use takes ("choose two willing creatures", CB p.333-334). */
export function targetMin(spec: TargetSpec | undefined): number | undefined {
  const count = spec?.count;
  return count !== undefined && (count.kind === "upTo" || count.kind === "any") ? count.min : undefined;
}

/**
 * The Hope a plan's paid costs took from creature `id` (`actorId`: the plan's actor, whose own `pay` steps name no payer),
 * for the session tally's exact spend (dcm-z9rz.23, `noteHopeSpent`). Pool costs (held dice, Favor, Focus) are no Hope.
 */
export function planHopePaid(plan: Pick<RunPlan, "steps">, id: string, actorId: string): number {
  let paid = 0;
  for (const step of plan.steps) {
    if (step.kind !== "pay" || !step.paid || (step.payerId ?? actorId) !== id) continue;
    for (const c of step.costs) if (c.resource === "hope" && c.pool === undefined) paid += c.amount;
  }
  return paid;
}

/** Whether a use spends Hope: its own costs or the costs of a step inside it (an optional "spend a Hope to ..."). */
export function paysHope(use: Pick<CardUse, "costs" | "steps">): boolean {
  const walk = (x: unknown): boolean => {
    if (Array.isArray(x)) return x.some(walk);
    if (x === null || typeof x !== "object") return false;
    const costs = (x as { costs?: unknown }).costs;
    if (Array.isArray(costs) && costs.some((c: { kind?: unknown } | null) => c?.kind === "hope")) return true;
    return Object.values(x).some(walk);
  };
  return walk({ costs: use.costs, steps: use.steps });
}

/**
 * Plan lanes E4 (dcm-zos): the instance's stat block has a modifier `noHopeFeaturesAgainst` (Fearsome Presence, CB p.239:
 * "PCs can't spend Hope to use features against the Zombie"), read from its adversary effect entries.
 */
export function barsHopeFeatures(instance: Doc<"encounterAdversaries">): boolean {
  if (instance.source.kind !== "srd") return false;
  return adversaryEffects(instance.source.adversaryId).some((entry) => entry.uses.some((u) => (u.modifiers ?? []).some((m) => m.kind === "mod" && m.mod.kind === "flag" && m.mod.flag === "noHopeFeaturesAgainst")));
}

// ---------------------------------------------------------------- plan lanes-2 E4.3: what each creature carries
//
// dcm-q40t, dcm-x4ft, dcm-gl9, dcm-576v (docs/tasks/TASK-LN3-E4.md): the per-creature fields run.ts reads (lasting mods,
// effect labels, Hope, gold, slot maximums and stats, payers) and the state facts its checks read. Runner ids are token
// ids (the actor's is its own token, or its character id off the map).

/** The first segment of a sheet effect's text: its label. */
const labelOf = (e: Pick<Effect, "text">) => e.text.split("; ")[0] ?? "";

/** An adversary feature's effect on a PC sheet (`card:<adversaryId>/<feature>:<n>`, lane E7) or on an instance (`adv:`). */
const ADVERSARY_SHEET_EFFECT = /^card:([^/:]+)\/(.+):\d+$/;
const ADVERSARY_INSTANCE_EFFECT = /^adv:([^/:]+)\/(.+):\d+$/;
/** A card / feature modifier on an instance: `card:<id>:<n>` / `feat:<id>:<n>`, with an optional `~<caster>`. */
const SOURCED_INSTANCE_EFFECT = /^(?:card|feat):(.+):\d+(?:~.+)?$/;

/** The steps of the entry a lasting effect came from (a card, a PC feature, or an adversary feature). */
function entryStepsOf(source: { adversaryId: string; feature: string } | { sourceId: string }): readonly unknown[] {
  if ("adversaryId" in source) return (adversaryEffects(source.adversaryId).find((e) => e.feature === source.feature)?.uses ?? []).map((u) => u.steps);
  return (cardEffect(source.sourceId)?.uses ?? featureEffect(source.sourceId)?.uses ?? []).map((u) => u.steps);
}

/** The lasting mods a PC carries (dcm-fbsr, dcm-5kxg): each sheet effect's entry mods, found by its label. */
export function sheetModsOn(sheet: Pick<CharacterSheet, "effects">): Mod[] {
  const out: Mod[] = [];
  for (const e of sheet.effects) {
    const adv = ADVERSARY_SHEET_EFFECT.exec(e.id);
    const sourceId = adv ? null : (cardIdOfEffect(e) ?? featureIdOfEffect(e));
    const steps = adv ? entryStepsOf({ adversaryId: adv[1]!, feature: adv[2]! }) : sourceId !== null ? entryStepsOf({ sourceId }) : [];
    if (steps.length > 0) out.push(...lastingModsOf(steps, labelOf(e)));
  }
  return out;
}

/** The lasting mods an adversary instance carries: each modifier's entry mods (an adversary feature's or a card's). */
export function instanceModsOn(instance: Pick<Doc<"encounterAdversaries">, "effects">): Mod[] {
  const out: Mod[] = [];
  for (const e of instance.effects ?? []) {
    const adv = ADVERSARY_INSTANCE_EFFECT.exec(e.id);
    const sourced = adv ? null : SOURCED_INSTANCE_EFFECT.exec(e.id);
    const steps = adv ? entryStepsOf({ adversaryId: adv[1]!, feature: adv[2]! }) : sourced ? entryStepsOf({ sourceId: sourced[1]! }) : [];
    if (steps.length > 0) out.push(...lastingModsOf(steps, e.label));
  }
  return out;
}

/** The rules flags among mods (`cannotSpendHope`, `cannotClearHp`, …), for a payer's `flags`. */
const flagsOf = (mods: readonly Mod[]) => mods.flatMap((m) => (m.kind === "flag" ? [m.flag as string] : []));

/** Gold as `goldOf` counts it: handfuls, a bag being 10 (CB p.104). */
export const handfulsOf = (sheet: Pick<CharacterSheet, "gold">) => sheet.gold.handfuls + sheet.gold.bags * 10;

/** A PC's numbers beyond its tracks (dcm-4zti): slot maximums, derived stats, gold. */
function pcNumbers(sheet: CharacterSheet, c: Combatant & { armorMax?: number }): Partial<MarkedTracks> {
  return {
    hpMax: sheet.hpMax,
    stressMax: sheet.stressMax,
    ...(c.armorMax !== undefined ? { armorMax: c.armorMax } : {}),
    stats: { armorScore: c.armorMax ?? 0, majorThreshold: c.thresholds.major ?? 0, severeThreshold: c.thresholds.severe ?? 0, evasion: c.evasion ?? 0 },
    gold: { handfuls: sheet.gold.handfuls, bags: sheet.gold.bags },
  };
}

/** What a PC payer holds (dcm-a9c: a `paidBy` cost; Rune Ward's holder, CB p.328). `cardTokens` are the use's own. */
function pcPayer(sheet: CharacterSheet, c: Combatant & { armor?: number; armorMax?: number }, mods: readonly Mod[], cardTokens: number): PayerState {
  const flags = flagsOf(mods);
  return {
    hope: sheet.hope,
    stress: sheet.stress,
    stressMax: sheet.stressMax,
    hp: sheet.hp,
    hpMax: sheet.hpMax,
    armor: c.armor ?? sheet.armorMarked,
    armorMax: c.armorMax ?? 0,
    cardTokens,
    gold: handfulsOf(sheet),
    ...(flags.length > 0 ? { flags } : {}),
  };
}

/** Squares from `token` to the nearest PC or ally token other than the actor's and its own (null: none). */
function nearestAllyOf(scene: AttackScene, token: Doc<"combatTokens">): number | null {
  let best: number | null = null;
  for (const [i, t] of scene.scene.tokens.entries()) {
    if (i === scene.viewer.index || t._id === token._id || (t.side !== "pc" && t.side !== "ally")) continue;
    const d = tokenDistance(t, token);
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * dcm-gl9 / dcm-576v: a named creature's facts for `who: target` / `subject` checks: its tracks, conditions, Hope, held
 * items, squares from the actor, squares to the actor's nearest ally, and the live areas it stands in.
 */
function creatureFactsOf(c: Creature, actor: ActorState, actorSheet: CharacterSheet, scene: AttackScene | null, areas: readonly Doc<"combatAreas">[]): CreatureFacts {
  const token = c.token;
  const sheet = c.kind === "pc" ? c.sheet : c.kind === "self" ? actorSheet : null;
  const combatant = c.kind === "self" ? actor : c.combatant;
  const base: CreatureFacts = {
    conditions: combatant.conditions ?? [],
    ...(c.kind === "enemy" ? { tags: c.instance.tags } : sheet ? { tags: sheet.effects.map(labelOf) } : {}),
    hp: combatant.hp,
    hpMax: combatant.hpMax,
    stress: combatant.stress,
    stressMax: combatant.stressMax,
    ...(sheet ? { armor: sheet.armorMarked, hope: sheet.hope, items: sheet.inventory.map((i) => i.name) } : {}),
    ...("armorMax" in combatant && combatant.armorMax !== undefined ? { armorMax: combatant.armorMax } : {}),
  };
  if (scene === null) return base;
  const nearestAlly = nearestAllyOf(scene, token);
  const characterId = c.kind === "pc" ? c.character._id : c.kind === "self" && scene.attacker.ref.kind === "pc" ? scene.attacker.ref.characterId : null;
  const inside = areaFactsFor(areas, scene.scene.tokens, token, characterId);
  return {
    ...base,
    distance: tokenDistance(scene.attacker, token),
    ...(nearestAlly !== null ? { nearestAlly } : {}),
    ...(inside.length > 0 ? { areas: inside } : {}),
  };
}

/** The creature a `usedOnBefore` memory names (dcm-c75): the instance for an enemy, the character for a PC. */
function memoryIdOf(c: Creature): string | null {
  return c.kind === "enemy" ? c.instance._id : c.kind === "pc" ? c.character._id : null;
}

/** Whether a card's entry reads the per-target memory (`usedOnBefore`; Words of Discord's second use, CB p.335). */
export function readsUsedOn(effect: CardEffect): boolean {
  return JSON.stringify(effect.uses).includes('"kind":"usedOnBefore"');
}

/** A picked square (Unleash Hellfire's bursts, Zone of Protection's point) as a footprint. */
type MapPoint = { x: number; y: number };

/** The most points one use picks (Unleash Hellfire: 1d4). */
export const MAX_CARD_POINTS = 10;

/**
 * dcm-va0f (Unleash Hellfire, HF p.88): for a use with `TargetSpec.points`, the indexes of the picked points whose area
 * (`areaRange`, default Very Close) holds each creature.
 */
export function pointsOfCreatures(points: readonly MapPoint[], radius: Range, creatures: readonly { id: string; token: Doc<"combatTokens"> }[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const c of creatures) {
    const inside = points.flatMap((p, i) => (rangeCheck({ x: p.x, y: p.y, size: 1 }, c.token, radius).inRange ? [i] : []));
    if (inside.length > 0) out[c.id] = inside;
  }
  return out;
}

/** The map creatures `creatureCount` counts (dcm-ttz), by token id, seen from the actor, with squares to it and the first target. */
function mapCreaturesOf(scene: AttackScene, first: Doc<"combatTokens"> | undefined, nameOf: (t: Doc<"combatTokens">) => string | undefined): MapCreature[] {
  return scene.scene.tokens.map((t, i): MapCreature => {
    const name = nameOf(t);
    return {
      id: t._id,
      side: i === scene.viewer.index ? "self" : t.side === "enemy" ? "enemy" : "ally",
      pc: t.ref.kind === "pc",
      ...(name !== undefined ? { name } : {}),
      fromSelf: tokenDistance(scene.attacker, t),
      ...(first ? { fromTarget: tokenDistance(first, t) } : {}),
      at: { x: t.x, y: t.y, size: t.size },
    };
  });
}

function rangeOf(spec: TargetSpec | undefined, actor: ActorState, weapon: "primary" | "secondary" | undefined): Range | "unlimited" {
  if (!spec) return "unlimited";
  if (spec.range === "weapon") return actor.weapons[weapon ?? "primary"]?.range ?? "melee";
  return spec.range;
}

function sideAllows(spec: TargetSpec | undefined, c: Creature): boolean {
  const side = spec?.side ?? "any";
  switch (side) {
    case "enemy":
      return c.kind === "enemy";
    case "ally":
      return c.kind === "pc";
    case "selfOrAlly":
      return c.kind === "pc" || c.kind === "self";
    case "self":
      return c.kind === "self";
    case "any":
      return c.kind !== "self" || spec?.excludeSelf !== true;
    case "point":
    case "object":
      return false;
  }
}

function combatantOf(c: Creature, actor: ActorState): Combatant {
  return c.kind === "self" ? actor : c.combatant;
}

/**
 * Builds the runner's context: the actor (after the Experiences' Hope), the targets checked for side and sight, the
 * picked / ally / follow-up creatures, every creature's range from its origin (Q1, `rangeOrigin`), the trigger, the roll
 * options (cover disadvantage, Experiences, the effects' attack bonus) and the card-specific fixes from the domain tables.
 */
export async function buildRun(ctx: QueryCtx, req: CardRequest): Promise<BuiltRun> {
  const { sheet, scene, pick, choices, roll } = req;
  const { effect, use } = pick;
  // Without a map (SD3) the actor's runner id is its character id; nothing on the map can be named.
  const actorTokenId: string = scene ? scene.attacker._id : req.character._id;
  const creatures = new Creatures(ctx, req.campaign._id, scene, sheet);

  // Experiences: 1 Hope each, their value added to the roll (CB p.90).
  rules(() => assertTypedModifier(roll.modifier ?? 0));
  const exp = rules(() => experienceBonus(sheet.experiences, roll.experienceIds ?? []));
  if (exp.hope > 0 && use.roll === undefined) throw invalid("This card makes no roll to add an Experience to.");
  const paidSheet = rules(() => spendHope(sheet, exp.hope));
  const base = cardActor(actorTokenId, paidSheet, pick.limitKey, roll.trait);
  const own = pick.actor ? pick.actor(base) : base;
  // Plan lanes E4 (SD-A, Q14): the live map areas the actor stands in at this roll (`inArea` checks).
  const mapAreas = scene ? await activeAreasOnMap(ctx, scene.scene.map._id) : [];
  const areas = scene ? areaFactsFor(mapAreas, scene.scene.tokens, scene.attacker, req.character._id) : [];
  const actor: ActorState = areas.length > 0 ? { ...own, facts: { ...(own.facts ?? {}), areas } } : own;
  const spec = specOf(use);
  const range = rangeOf(spec, actor, choices.weapon);

  // ---- targets
  const ids = [...req.targetTokenIds];
  if (ids.length > MAX_CARD_TARGETS || new Set(ids).size !== ids.length) throw appError("COMBAT_TARGET_INVALID");
  let targets: Creature[] = [];
  for (const id of ids) {
    const c = await creatures.resolve(id);
    if (!sideAllows(spec, c)) throw appError("COMBAT_TARGET_INVALID");
    targets.push(c);
  }
  // "all targets within Close range" (CB p.104, R9): with none named, every enemy the actor sees in range.
  if (scene && targets.length === 0 && spec?.count.kind === "all" && (spec.side === "enemy" || spec.side === "any") && (spec.area === undefined || spec.area === "aroundSelf")) {
    targets = (await creatures.visibleEnemies()).filter((e) => rangeCheck(scene.attacker, e.token, range).inRange);
  }
  if (scene && spec?.side === "self" && targets.length === 0) targets = [{ kind: "self", tokenId: scene.attacker._id, token: scene.attacker }];
  const encounters = new Set(targets.flatMap((t) => (t.kind === "enemy" ? [t.encounter._id] : [])));
  if (encounters.size > 1) throw appError("COMBAT_TARGET_INVALID");
  if (spec?.excludeSubject === true && choices.triggerSubject !== undefined) {
    // Plan lanes E4 (dcm-ssf): "all other adversaries" leaves the trigger's creature out (Elemental Incarnation, CB p.30).
    if (ids.includes(choices.triggerSubject)) throw appError("COMBAT_TARGET_INVALID", "The creature that set this off isn't one of its targets.");
    targets = targets.filter((t) => t.tokenId !== choices.triggerSubject);
  }
  const min = targetMin(spec);
  if (min !== undefined && targets.length < min) throw appError("COMBAT_TARGET_INVALID", `Pick at least ${min} targets.`);
  if (paysHope(use)) for (const t of targets) if (t.kind === "enemy" && barsHopeFeatures(t.instance)) throw appError("COMBAT_TARGET_INVALID", `You can't spend Hope to use features against ${t.instance.label}.`);

  // ---- other creatures
  const list = async (tokenIds: readonly string[], allow: (c: Creature) => boolean) => {
    if (tokenIds.length > MAX_CARD_TARGETS || new Set(tokenIds).size !== tokenIds.length) throw appError("COMBAT_TARGET_INVALID");
    const out: Creature[] = [];
    for (const id of tokenIds) {
      const c = await creatures.resolve(id);
      if (!allow(c)) throw appError("COMBAT_TARGET_INVALID");
      out.push(c);
    }
    return out;
  };
  const picked = await list(choices.picked, () => true);
  const allies = await list(choices.allies, (c) => c.kind === "pc");
  const followUp = await list(choices.followUp, (c) => c.kind !== "self");
  const triggerOf = async (id: string | undefined) => (id === undefined ? undefined : combatantOf(await creatures.resolve(id), actor));

  // ---- Q1: what is outside the card's range waits for the GM. An area around a point or a target measures its anchor
  // (the first target) from the actor and the rest from the anchor; the picked / ally / follow-up creatures from the
  // origin their own spec names (a chain from the creature before them).
  const outOfRange: OutOfRange[] = [];
  const flag = (c: Creature, check: { inRange: boolean; band: Band } | null) => {
    if (check !== null && !check.inRange && !outOfRange.some((o) => o.tokenId === c.tokenId)) outOfRange.push({ tokenId: c.tokenId, band: check.band });
  };
  const anchored = spec?.area === "aroundPoint" || spec?.area === "aroundTarget";
  for (const [i, t] of targets.entries()) {
    if (anchored && i > 0 && spec?.areaRange !== undefined) flag(t, rangeOrigin(creatures.scene, { ...spec, area: "aroundTarget" }, range, targets.slice(0, 1), t));
    // Plan lanes E4 (dcm-dgu): the first target from the actor, the next from the first (`target`) or from every earlier one (`chain`).
    else if (i > 0 && (spec?.origin === "target" || spec?.origin === "chain")) flag(t, rangeOrigin(creatures.scene, spec, range, spec.origin === "target" ? targets.slice(0, 1) : targets.slice(0, i), t));
    else flag(t, rangeOrigin(creatures.scene, spec && { ...spec, area: spec.area === "aroundSelf" ? "aroundSelf" : undefined }, range, [], t));
  }
  const specs = extraSpecs(use);
  if (specs.picked?.excludeSubject === true && choices.triggerSubject !== undefined && choices.picked.includes(choices.triggerSubject)) throw appError("COMBAT_TARGET_INVALID", "The creature that set this off isn't one of its picks.");
  const extraRange = (s: TargetSpec | undefined) => (s === undefined ? "unlimited" : s.range === "weapon" ? (actor.weapons[choices.weapon ?? "primary"]?.range ?? "melee") : s.range);
  for (const c of picked) flag(c, rangeOrigin(creatures.scene, specs.picked, extraRange(specs.picked), targets, c));
  for (const c of allies) flag(c, rangeOrigin(creatures.scene, specs.allies, extraRange(specs.allies), targets, c));
  // Plan lanes-2 E4.3 (dcm-io4m): a chain is the entry's `origin: "chain"` (Chain Lightning's follow-up, CB p.328).
  const chained = specs.followUp?.origin === "chain";
  for (const [i, c] of followUp.entries()) flag(c, rangeOrigin(creatures.scene, specs.followUp, extraRange(specs.followUp), chained ? [...targets, ...followUp.slice(0, i)] : targets, c));
  // dcm-x4ft (dcm-rou, dcm-7az): each further link of a repeating follow-up is measured from the link before it (link 0
  // is `followUp`; "within Close range of previous targets", CB p.328).
  const chain: Creature[][] = [];
  for (const link of (choices.chain ?? []).slice(0, MAX_CHAIN_LINKS)) {
    const linkCreatures = await list(link, (c) => c.kind !== "self");
    const previous = chain.length === 0 ? (followUp.length > 0 ? followUp : targets) : chain[chain.length - 1]!;
    for (const c of linkCreatures) flag(c, rangeOrigin(creatures.scene, specs.followUp, extraRange(specs.followUp), previous, c));
    chain.push(linkCreatures);
  }
  // dcm-q0a: the allies who pay to raise a save's Difficulty.
  const raisers = await list(choices.raisers ?? [], (c) => c.kind === "pc");
  // dcm-va0f, dcm-dgu (2): picked squares, each on the map within the use's range of the actor; a target of an
  // `aroundPoint` area is measured from the nearest point instead of the first target.
  const points = [...(req.points ?? [])];
  if (points.length > MAX_CARD_POINTS) throw appError("COMBAT_TARGET_INVALID", `At most ${MAX_CARD_POINTS} points.`);
  if (points.length > 0 && scene) {
    for (const p of points) {
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= scene.map.w || p.y >= scene.map.h) throw appError("COMBAT_TARGET_INVALID", "That point is off the map.");
      if (!rangeCheck(scene.attacker, { x: p.x, y: p.y, size: 1 }, range).inRange) throw appError("COMBAT_TARGET_INVALID", "That point is out of range.");
    }
    if (spec?.area === "aroundPoint" || spec?.origin === "point") {
      const radius = spec.areaRange ?? range;
      for (const t of targets) {
        if (t.kind === "self") continue;
        const inside = points.some((p) => rangeCheck({ x: p.x, y: p.y, size: 1 }, t.token, radius).inRange);
        const at = outOfRange.findIndex((o) => o.tokenId === t.tokenId);
        if (inside && at >= 0) outOfRange.splice(at, 1);
        else if (!inside && at < 0) outOfRange.push({ tokenId: t.tokenId, band: rangeCheck({ x: points[0]!.x, y: points[0]!.y, size: 1 }, t.token, radius).band });
      }
    }
  }

  // ---- the roll: cover gives one disadvantage (Q2); an attack roll adds the effects' attack bonus (CB p.96).
  const cover = targets.some((t) => t.kind === "enemy" && t.sight.cover);
  const attackRoll = use.roll !== undefined && (use.roll.kind === "attack" || (use.roll.kind !== "reaction" && use.roll.kind !== "adversaryAttack" && use.roll.difficulty.kind === "target"));
  const live = withEffects(paidSheet);

  // ---- card-specific fixes from the domain tables' "Notes for CA4"
  const numbers = { ...choices.numbers };
  if (effect.cardId === "share-the-burden") {
    // Grace notes: cap the Stress transferred at the target's marked Stress (dcm-fnq). Plan lanes-2 E4.3 (dcm-io4m): kept,
    // since the choice's `max` alone refuses a number above it (INVALID) where the table expects the cap.
    const target = targets[0];
    const marked = target ? combatantOf(target, actor).stress : 0;
    if (numbers.stress !== undefined) numbers.stress = Math.max(1, Math.min(numbers.stress, marked));
  }
  // Splendor notes: Second Wind's situation is the host attack's own result, not a check box.
  const situations = choices.situations.filter((s) => s !== SECOND_WIND_SITUATION);
  if (req.lastRollWithHope) situations.push(SECOND_WIND_SITUATION);
  const optionals = new Set(choices.optionals);
  for (const id of DEFAULT_OPTIONALS[effect.cardId] ?? []) if (!choices.declined.has(id)) optionals.add(id);

  const enemies = await creatures.visibleEnemies();
  const nearest = !scene || enemies.length === 0 ? undefined : Math.min(...enemies.map((e) => tokenDistance(scene.attacker, e.token)));

  const trigger: NonNullable<RunContext["trigger"]> = {};
  const source = await triggerOf(choices.triggerSource);
  const subject = await triggerOf(choices.triggerSubject);
  if (source) trigger.source = source;
  if (subject) trigger.subject = subject;
  if (choices.triggerAmount !== undefined) trigger.amount = choices.triggerAmount;
  // dcm-m5fy (Encore, CB p.335: "you deal the same damage to the target that your ally dealt"): the trigger's damage type.
  if (choices.triggerDamageType !== undefined) trigger.damageType = choices.triggerDamageType;

  // ---- Plan lanes-2 E4.3: what each named creature carries (dcm-q40t, dcm-x4ft) and the facts the checks read (dcm-gl9).
  const actorMods = sheetModsOn(paidSheet);
  const modsOn: Record<string, readonly Mod[]> = {};
  const effectsOn: Record<string, string[]> = { [actor.id]: paidSheet.effects.map(labelOf) };
  const hopeOf: Record<string, number> = { [actor.id]: actor.hope };
  const goldOf: Record<string, number> = { [actor.id]: handfulsOf(paidSheet) };
  const byId: Record<string, Partial<MarkedTracks>> = {};
  if (actorMods.length > 0) modsOn[actor.id] = actorMods;
  for (const c of creatures.all) {
    if (c.kind === "self") continue;
    const mods = c.kind === "pc" ? sheetModsOn(c.sheet) : instanceModsOn(c.instance);
    if (mods.length > 0) modsOn[c.tokenId] = mods;
    if (c.kind === "pc") {
      effectsOn[c.tokenId] = c.sheet.effects.map(labelOf);
      hopeOf[c.tokenId] = c.sheet.hope;
      goldOf[c.tokenId] = handfulsOf(c.sheet);
      byId[c.tokenId] = pcNumbers(c.sheet, c.combatant);
    } else {
      effectsOn[c.tokenId] = [...(c.instance.effects ?? []).map((e) => e.label), ...c.instance.tags];
      byId[c.tokenId] = { hpMax: c.instance.stats.hpMax, stressMax: c.instance.stats.stressMax, stats: { majorThreshold: c.instance.stats.major ?? 0, severeThreshold: c.instance.stats.severe ?? 0 } };
    }
  }
  // dcm-a9c: the payers a `paidBy` cost names (PCs; the actor is `self`).
  const selfPayer = pcPayer(paidSheet, actor, actorMods, actor.cardTokens);
  const payerOf = (c: Creature | undefined): PayerState | undefined => (c === undefined ? undefined : c.kind === "self" ? selfPayer : c.kind === "pc" ? pcPayer(c.sheet, c.combatant, modsOn[c.tokenId] ?? [], 0) : undefined);
  const payers: NonNullable<RunContext["payers"]> = { self: selfPayer };
  const subjectCreature = choices.triggerSubject !== undefined ? creatures.get(choices.triggerSubject) : undefined;
  const sourceCreature = choices.triggerSource !== undefined ? creatures.get(choices.triggerSource) : undefined;
  const subjectPayer = payerOf(subjectCreature);
  const sourcePayer = payerOf(sourceCreature);
  const pickedPayer = payerOf(picked[0]);
  if (subjectPayer) payers.triggerSubject = subjectPayer;
  if (sourcePayer) payers.triggerSource = sourcePayer;
  if (pickedPayer) payers.picked = pickedPayer;
  // dcm-va0f: which picked points hold each target.
  const pointsOf = points.length > 0 && spec?.points !== undefined ? pointsOfCreatures(points, spec.areaRange ?? "veryClose", targets.flatMap((t) => (t.kind === "self" ? [] : [{ id: t.tokenId as string, token: t.token }]))) : undefined;
  // dcm-gl9 / dcm-576v: the actor's facts (Armor Slots, the card's tokens, its nearest ally, its weapons' ranges, the
  // per-target memory) and the first target's and the trigger subject's facts.
  const first = targets.find((t) => t.kind !== "self");
  const firstMemory = first ? memoryIdOf(first) : null;
  const attacking = choices.weapon ?? (spec?.range === "weapon" || dealsWeaponDamage(use.steps) || use.roll?.kind === "attack" ? "primary" : undefined);
  const nearestAlly = scene ? nearestAllyOf(scene, scene.attacker) : null;
  const facts: StateFacts = {
    armorMax: actor.armorMax,
    cardTokens: actor.cardTokens,
    weapons: {
      primary: actor.weapons.primary?.range ?? null,
      secondary: actor.weapons.secondary?.range ?? null,
      ...(attacking !== undefined ? { attacking: actor.weapons[attacking]?.range ?? null } : {}),
    },
    ...(nearestAlly !== null ? { nearestAlly } : {}),
    ...(readsUsedOn(effect) && firstMemory !== null ? { usedOnBefore: usedOnBefore(paidSheet, featureUseKey(effect.cardId), firstMemory) } : {}),
    ...(first ? { target: creatureFactsOf(first, actor, paidSheet, scene, mapAreas) } : {}),
    ...(subjectCreature ? { subject: creatureFactsOf(subjectCreature, actor, paidSheet, scene, mapAreas) } : {}),
  };
  // What the use's own pick (a feature's extras) already knows wins.
  const ownFacts = actor.facts ?? {};
  const fullActor: ActorState = {
    ...actor,
    facts: {
      ...facts,
      ...ownFacts,
      ...(facts.target !== undefined || ownFacts.target !== undefined ? { target: { ...facts.target, ...ownFacts.target } as CreatureFacts } : {}),
      ...(facts.subject !== undefined || ownFacts.subject !== undefined ? { subject: { ...facts.subject, ...ownFacts.subject } as CreatureFacts } : {}),
    },
  };
  const nameOfToken = (t: Doc<"combatTokens">): string | undefined => {
    const c = creatures.get(t._id);
    if (c?.kind !== "enemy") return undefined;
    return c.instance.source.kind === "srd" ? (srdAdversary(c.instance.source.adversaryId)?.name ?? c.instance.label) : c.instance.label;
  };

  const context: Omit<RunContext, "rng"> = {
    actor: fullActor,
    // dcm-qoq9 (user answer 2026-10-31, Chain Lightning, CB p.328: "every new wave of chained targets gets a fresh 2d8+4
    // roll"): each chain link rolls its damage again.
    freshLinkDamage: true,
    gmFear: req.gmFear,
    useId: use.id,
    // Off the map a self use targets the actor itself (SD3).
    targets: !scene && spec?.side === "self" ? [actor] : targets.map((t) => combatantOf(t, actor)),
    picked: picked.map((t) => combatantOf(t, actor)),
    allies: allies.map((t) => combatantOf(t, actor)),
    followUp: followUp.map((t) => combatantOf(t, actor)),
    ...(Object.keys(trigger).length > 0 ? { trigger } : {}),
    choices: numbers,
    options: choices.options,
    optionals: [...optionals],
    eitherCosts: choices.either,
    splits: choices.splits,
    situations,
    ...(nearest !== undefined ? { nearestEnemy: nearest } : {}),
    // Plan lanes-2 E4.3 (dcm-x4ft): per-chooser picks, held dice, chain links, save raisers, other creatures' Hope and gold,
    // the effect labels each carries (dcm-kkx stacking).
    ...(choices.chooserOptions ? { chooserOptions: choices.chooserOptions } : {}),
    ...(choices.chooserOptionals ? { chooserOptionals: choices.chooserOptionals } : {}),
    ...(choices.heldDice ? { heldDicePicks: choices.heldDice } : {}),
    ...(chain.length > 0 ? { chain: chain.map((link) => link.map((t) => combatantOf(t, actor))) } : {}),
    ...(raisers.length > 0 ? { saveRaisers: raisers.map((t) => combatantOf(t, actor)) } : {}),
    hopeOf,
    goldOf,
    effectsOn,
    // dcm-q40t (dcm-4zti, dcm-a9c, dcm-fbsr, dcm-5kxg, dcm-va0f): numbers, payers, lasting mods, points.
    numbers: {
      self: pcNumbers(paidSheet, actor),
      byId,
      ...(scene ? { creatures: mapCreaturesOf(scene, first?.token, nameOfToken) } : {}),
    },
    payers,
    modsOn,
    ...(pointsOf ? { pointsOf } : {}),
    roll: {
      ...(roll.trait !== undefined ? { trait: roll.trait } : {}),
      ...(choices.weapon !== undefined ? { weapon: choices.weapon } : {}),
      advantage: roll.advantage ?? 0,
      disadvantage: (roll.disadvantage ?? 0) + (cover ? 1 : 0),
      help: roll.help ?? 0,
      modifier: (roll.modifier ?? 0) + exp.value + (attackRoll ? live.attackBonus : 0),
      ...(roll.difficulty !== undefined ? { difficulty: roll.difficulty } : {}),
    },
  };
  return { context, paidSheet, creatures, targets, outOfRange, range };
}

// ---------------------------------------------------------------- running

/** The runner's refusals as error codes (CA1: noUse, requirement, exhausted, cost, choice, targets). */
export function refusalError(r: RunRefusal) {
  switch (r.reason) {
    case "exhausted":
      return appError("CARD_EXHAUSTED", r.detail);
    case "cost":
      return appError("CARD_COST_UNPAID", `Short of: ${r.detail}.`, r.shortfall);
    case "targets":
      return appError("COMBAT_TARGET_INVALID", r.detail);
    case "requirement":
      return appError("INVALID", `The card's condition isn't met (${r.detail}).`);
    case "noUse":
    case "choice":
      return appError("INVALID", r.detail);
  }
}

/** A die source that records what it rolls, so a second pass can replay the same dice (Reaper's Strike's pick). */
function recording(base: Rng): { rng: Rng; values: number[] } {
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

/** Replays recorded dice in order (a value that doesn't fit the die is rolled fresh), then rolls fresh ones. */
export function replaying(values: readonly number[], base: Rng): Rng {
  let i = 0;
  return (sides) => {
    const n = values[i++];
    return n !== undefined && n >= 1 && n <= sides ? n : base(sides);
  };
}

export type RunOutcome = ({ kind: "plan"; plan: RunPlan; picked: readonly Combatant[]; delegated?: Delegated } | { kind: "needsChoice"; asks: ChoiceAsks }) & {
  /** Every die value the use rolled, in order (kept for a choice after the roll, convex/lib/cardChoices.ts). */
  dice: number[];
};

/**
 * Runs the use with the server's dice (`rng`: fresh, or replaying kept dice). A picked creature that is also a target
 * the roll missed is dropped and the use re-run with the same dice (Blade notes: Reaper's Strike; Splendor: Stunning
 * Sunlight's picks must be hit targets). A plan that still needs a `choose` option or a split comes back as
 * `needsChoice` with the dice it rolled.
 */
export function runCard(built: BuiltRun, pick: CardPick, rng: Rng): RunOutcome {
  const first = recording(rng);
  const runner = pick.run ?? ((context: RunContext): UseRunResult => run(pick.effect, context));
  let delegated: Delegated | undefined;
  const once = (context: Omit<RunContext, "rng">, r: Rng) => {
    const result = rules(() => runner({ ...context, rng: r }));
    if (!result.ok) throw (pick.refusal ?? refusalError)(result);
    delegated = result.delegated;
    return result.plan;
  };
  let context = built.context;
  let plan = once(context, first.rng);
  const missed = new Set(plan.hits.filter((h) => !h.hit).map((h) => h.id));
  const keep = (context.picked ?? []).filter((c) => !missed.has(c.id));
  if (keep.length !== (context.picked ?? []).length) {
    context = { ...context, picked: keep };
    plan = once(context, replaying(first.values, rng));
  }
  const asks = choiceAsks(built, plan);
  if (asks.length > 0) return { kind: "needsChoice", asks, dice: first.values };
  const remembered = withUsedOn(plan, built, pick.effect);
  return { kind: "plan", plan: withOnslaught(remembered, built.paidSheet, pick.use), picked: context.picked ?? [], dice: first.values, ...(delegated ? { delegated } : {}) };
}

/**
 * The choices a plan still needs (nothing was paid or written): a `choose` step's options (plan lanes-2 E4.3, dcm-sc54:
 * one ask per chooser of a `choose` with `by`, answered `by:<stepId>:<chooserId>`), a damage / clear split, and the next
 * link of a repeating follow-up (`followUp`, answered `chain:<link>`; an empty list ends the chain).
 */
export function choiceAsks(built: BuiltRun, plan: RunPlan): ChoiceAsks {
  const asks: ChoiceAsks = [];
  for (const step of plan.steps) {
    if (step.kind !== "prompt") continue;
    if (step.prompt === "choose" && step.step?.kind === "choose") {
      const chooser = step.chooserId !== undefined ? tokenIdsOf(built, [step.chooserId])[0] : undefined;
      asks.push({ kind: "choose", stepId: step.step.id, label: step.step.label, options: step.step.options.map((o) => ({ id: o.id, label: o.label })), ...(chooser ? { chooserId: chooser } : {}) });
    } else if (step.prompt === "split") {
      asks.push({ kind: "split", label: step.text, tokenIds: tokenIdsOf(built, step.targetIds), ...(step.amount !== undefined ? { amount: step.amount } : {}) });
    } else if (step.prompt === "followUp" && chainGoesOn(built, step)) {
      asks.push({ kind: "followUp", label: step.text, link: step.amount ?? 1, tokenIds: tokenIdsOf(built, step.targetIds) });
    }
  }
  return asks;
}

/**
 * Whether a repeating follow-up can take another link (Chain Lightning, CB p.328: "This chain continues until there are no
 * more adversaries within range"): some creature of the follow-up's side on the map, not yet targeted by the use, within
 * its range of a creature of the last link. Off the map, or a range the map can't measure, the chain asks.
 */
function chainGoesOn(built: BuiltRun, step: Extract<PlanStep, { kind: "prompt" }>): boolean {
  const spec = step.step?.kind === "followUp" ? step.step.targets : undefined;
  // A creature out of range waits for the GM first (pending); the next link is asked after.
  if (built.outOfRange.length > 0) return false;
  if (!built.creatures.onMap || spec === undefined || spec.range === "weapon" || spec.range === "unlimited") return true;
  const range = spec.range;
  const tokens = built.creatures.scene.scene.tokens;
  const last = tokens.filter((t) => tokenIdsOf(built, step.targetIds).includes(t._id));
  if (last.length === 0) return true;
  const ctx = built.context;
  const used = new Set<string>([...(ctx.targets ?? []), ...(ctx.followUp ?? []), ...(ctx.chain ?? []).flat()].map((c) => c.id));
  for (const id of tokenIdsOf(built, [...used])) used.add(id);
  const sideOk = (t: Doc<"combatTokens">) => (spec.side === "enemy" ? t.side === "enemy" : spec.side === "ally" || spec.side === "selfOrAlly" ? t.side !== "enemy" : true);
  return tokens.some((t) => !used.has(t._id) && t._id !== built.creatures.scene.attacker._id && sideOk(t) && last.some((l) => rangeCheck(l, t, range).inRange));
}

/**
 * Plan lanes-2 E4.3 (dcm-gl9, dcm-c75; Words of Discord, CB p.335: "The next time you cast Words of Discord on them, gain a
 * -5 penalty"; user answer 2026-10-31: remembered for the whole campaign): a successful use of a card whose entry reads the
 * per-target memory (`usedOnBefore`) remembers the creatures it hit (every target, for a roll against a fixed Difficulty)
 * in the actor's `featureUses` (`recordUsedOn`; an enemy by its instance, a PC by its character). `buildRun` reads it back.
 */
export function withUsedOn(plan: RunPlan, built: BuiltRun, effect: CardEffect): RunPlan {
  if (!plan.success || !readsUsedOn(effect)) return plan;
  const hit = plan.hits.length > 0 ? plan.hits.filter((h) => h.hit).map((h) => h.id) : (built.context.targets ?? []).map((t) => t.id);
  let featureUses = plan.actor.featureUses;
  for (const id of hit) {
    const c = built.creatures.get(id);
    const memory = c ? memoryIdOf(c) : null;
    if (memory !== null) featureUses = recordUsedOn(featureUses, featureUseKey(effect.cardId), memory);
  }
  return featureUses === plan.actor.featureUses ? plan : { ...plan, actor: { ...plan.actor, featureUses } };
}

/** Whether a use deals the weapon's damage (a `damage` step rolling `weapon`, nested steps included). */
export function dealsWeaponDamage(steps: readonly unknown[]): boolean {
  for (const s of steps) {
    if (s === null || typeof s !== "object") continue;
    const step = s as { kind?: unknown; roll?: { kind?: unknown } };
    if (step.kind === "damage" && step.roll?.kind === "weapon") return true;
    for (const value of Object.values(s)) {
      if (Array.isArray(value) && dealsWeaponDamage(value)) return true;
      if (value !== null && typeof value === "object" && Array.isArray((value as { steps?: unknown }).steps) && dealsWeaponDamage((value as { steps: unknown[] }).steps)) return true;
    }
  }
  return false;
}

/**
 * Onslaught (Blade 10, CB p.330): "When you successfully make an attack with your weapon, you never deal damage beneath a
 * target's Major damage threshold (the target always marks a minimum of 2 Hit Points)." User answer 2026-10-22 (bead
 * dcm-bxp.99.23): the floor applies to any weapon-damage hit, cards attacking with the weapon's damage included (CA4b
 * applied it to plain attacks in `resolveAttack`). A Minor hit on an enemy the use hit becomes Major: one more HP.
 */
export function withOnslaught(plan: RunPlan, sheet: CharacterSheet, use: CardUse): RunPlan {
  if (!sheet.domainCards.loadout.includes("onslaught") || !plan.success || !dealsWeaponDamage(use.steps)) return plan;
  const missed = new Set(plan.hits.filter((h) => !h.hit).map((h) => h.id));
  let creatures = plan.creatures;
  const steps = plan.steps.map((s): PlanStep => {
    if (s.kind !== "damage" || s.result.severity !== "minor" || missed.has(s.result.targetId)) return s;
    const r = s.result;
    const extra = Math.min(1, Math.max(0, r.after.hpMax - r.after.hp));
    const hp = r.after.hp + extra;
    const defeated = r.after.defeated || hp >= r.after.hpMax;
    creatures = creatures.map((c) => (c.id === r.targetId ? { ...c, after: { ...c.after, hp: Math.min(c.after.hpMax, c.after.hp + extra), defeated: c.after.defeated || c.after.hp + extra >= c.after.hpMax } } : c));
    return { ...s, result: { ...r, severity: "major", hpMarked: r.hpMarked + extra, defeated, after: { ...r.after, hp, defeated } } };
  });
  return { ...plan, steps, creatures };
}

/** The map tokens of runner ids (the actor's id is its own token). */
export function tokenIdsOf(built: BuiltRun, ids: readonly string[]): Id<"combatTokens">[] {
  return ids.flatMap((id) => {
    if (id === built.context.actor.id) return built.creatures.onMap ? [built.creatures.scene.attacker._id] : [];
    const c = built.creatures.get(id);
    return c ? [c.tokenId] : [];
  });
}

// ---------------------------------------------------------------- plan lanes-2 E4.3: the new plan entries (dcm-q40t)

/** A creature's name for the feed: the actor is "you", a PC its sheet's name, an enemy its instance label. */
function runnerName(built: BuiltRun, id: string): string {
  if (id === built.context.actor.id) return "you";
  const c = built.creatures.get(id);
  return c?.kind === "pc" ? c.sheet.name : c?.kind === "enemy" ? c.instance.label : "a creature";
}

/** What the plan's E3 entries hand to the server lanes (E7's forced attack prompt, E7's form change), by token id. */
export type PlanHandoff = {
  /** Feed words for setStance / exhaust / forcedAttack / changeForm / heldReroll, in plan order. */
  notes: string[];
  /** Words of Discord / Beguiled (CB p.335, HF p.75): attackers and the creatures named to be attacked (empty: GM picks). */
  forcedAttacks: { attackerTokenIds: Id<"combatTokens">[]; againstTokenIds: Id<"combatTokens">[] }[];
  /** Transform (HF p.142): the instance token that takes stat block `adversaryId`. */
  changeForms: { tokenId: Id<"combatTokens">; adversaryId: string }[];
};

/**
 * Plan lanes-2 E4.3 (dcm-q40t): reads the plan entries run.ts added in lanes-2 E3 that `writeSheetChanges` /
 * `actorSheetAfter` don't write themselves: `setStance` (the actor's stance; featureRunner's `stancesOf` + `setStance`
 * write it), `exhaust` (already in `plan.actor.featureUses`; feed only), `forcedAttack` and `changeForm` (handed to
 * E7's adversary engine), `heldReroll` (feed: the dice before and after). Pure; the caller logs `notes`.
 */
export function planHandoff(built: BuiltRun, plan: RunPlan): PlanHandoff {
  const out: PlanHandoff = { notes: [], forcedAttacks: [], changeForms: [] };
  for (const s of plan.steps) {
    if (s.kind === "setStance") out.notes.push(`${runnerName(built, s.targetId)}: stance ${s.stance}`);
    else if (s.kind === "exhaust") out.notes.push(`spent until ${s.until}`);
    else if (s.kind === "heldReroll") out.notes.push(`${s.die} dice rerolled: ${s.before.join(", ")} → ${s.after.join(", ")}`);
    else if (s.kind === "changeForm") {
      const tokenId = tokenIdsOf(built, [s.targetId])[0];
      if (tokenId !== undefined) out.changeForms.push({ tokenId, adversaryId: s.adversaryId });
      out.notes.push(`${runnerName(built, s.targetId)} changes form (${srdAdversary(s.adversaryId)?.name ?? s.adversaryId})`);
    } else if (s.kind === "forcedAttack") {
      out.forcedAttacks.push({ attackerTokenIds: tokenIdsOf(built, s.attackerIds), againstTokenIds: tokenIdsOf(built, s.againstIds) });
      const against = s.againstIds.length > 0 ? s.againstIds.map((id) => runnerName(built, id)).join(", ") : "a creature the GM picks";
      out.notes.push(`${s.attackerIds.map((id) => runnerName(built, id)).join(", ")} must attack ${against}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- sheet changes

const UNTIL: Record<Duration, Effect["until"]> = {
  temporary: "manual",
  rest: "rest",
  longRest: "longRest",
  session: "session",
  scene: "scene",
  hit: "hit",
  nextRoll: "manual",
  manual: "manual",
  permanent: "manual",
};

const clampMod = (n: number) => Math.max(-10, Math.min(10, Math.trunc(n)));

/** Mods the sheet stores (Evasion, attack, damage, one trait); the rest are named in the effect's text. */
function sheetMods(mods: readonly ResolvedMod[]): { mods: NonNullable<Effect["mods"]>; text: string[] } {
  const out: NonNullable<Effect["mods"]> = {};
  const text: string[] = [];
  for (const m of mods) {
    if (m.kind === "stat" && (m.stat === "evasion" || m.stat === "attack" || m.stat === "damage")) out[m.stat] = clampMod((out[m.stat] ?? 0) + m.delta);
    else if (m.kind === "trait" && m.trait !== "all" && out.trait === undefined) out.trait = { id: m.trait, delta: clampMod(m.delta) };
    else if (m.kind === "stat" || m.kind === "trait") text.push(`${m.delta >= 0 ? "+" : ""}${m.delta} ${m.kind === "stat" ? m.stat : m.trait}`);
    else if (m.kind === "set") text.push(`${m.stat} = ${m.to}`);
    else if (m.kind === "advantage") text.push(`advantage on ${m.on}`);
    else if (m.kind === "disadvantageAgainst") text.push(`${m.on} against them with disadvantage`);
    else if (m.kind === "resistance") text.push(`${m.level} to ${m.type} damage`);
    else if (m.kind === "flag") text.push(m.flag);
    // Plan lanes, tracer V: widened mods show by kind until their lane stores them.
    else text.push(m.kind);
  }
  return { mods: out, text };
}

// ---- SD3: which use an effect belongs to (cards `card:<cardId>:<n>`, features `feat:<hash>:<n>`)

/** The text segment that names an effect step's option ("Channeling Fire", NV7); `effectOption` reads it back. */
const OPTION_PREFIX = "option: ";

/** The option a feature effect stands for (NV7), from its text. */
export function effectOption(effect: Pick<Effect, "text">): string | undefined {
  return effect.text
    .split("; ")
    .find((part) => part.startsWith(OPTION_PREFIX))
    ?.slice(OPTION_PREFIX.length);
}

function nextEffectId(effects: readonly Effect[], cardId: string): string {
  const key = effectKeyOf(cardId);
  for (let n = 1; n < 100; n++) {
    const id = `${key}:${n}`;
    if (!effects.some((e) => e.id === id)) return id;
  }
  return `${key}:0`;
}

/** The sheet effect a card's `effect` step (or a card tag on a PC) becomes, with the card's until (CA4 acceptance). */
function addEffect(effects: Effect[], cardId: string, source: string, label: string, mods: readonly ResolvedMod[], duration: Duration, endsWhen: string | undefined, option?: string): Effect[] {
  const { mods: stored, text } = sheetMods(mods);
  const words = [label, ...(option ? [`${OPTION_PREFIX}${option}`] : []), ...text, ...(endsWhen ? [`ends when ${endsWhen}`] : [])].join("; ");
  const effect: Effect = { id: nextEffectId(effects, cardId), source: source.slice(0, 80), text: words.slice(0, 300), until: UNTIL[duration], ...(Object.keys(stored).length > 0 ? { mods: stored } : {}) };
  // The sheet holds at most 20 effects: the oldest goes first.
  return [...effects, effect].slice(-20);
}

/**
 * Applies the plan's steps for one PC (the actor or an ally) to their sheet: conditions (standard ones on the sheet, card
 * tags as effects), effects, Hope for an ally (the actor's Hope is in `plan.actor`), and an exclusive card's old effects
 * removed. Tracks (HP, Stress, Armor) come from the caller.
 */
export function writeSheetChanges(sheet: CharacterSheet, steps: readonly PlanStep[], who: string, cardId: string, cardName: string, exclusive: boolean, isActor: boolean): CharacterSheet {
  let effects = exclusive ? sheet.effects.filter((e) => !ownsEffect(e, cardId)) : [...sheet.effects];
  let conditions = [...sheet.conditions];
  let hope = sheet.hope;
  let slotted: Pick<CharacterSheet, "hp" | "hpMax" | "stress" | "stressMax" | "slotBonuses"> = sheet;
  for (const step of steps) {
    // DA10 (dcm-bxp.99.19.10): a condition the actor gives that ends when their stance drops (Grappling's Restrain) leaves
    // a marker on the actor's sheet naming the target's token; `dropStance` (convex/lib/stanceDrop.ts) reads it.
    if (isActor && step.kind === "condition" && step.targetId !== who && step.endsOn?.includes("stanceDrops")) {
      const marker = stanceDropMarker(step.targetId, cardName, step.condition.kind === "standard" ? step.condition.condition : step.condition.tag);
      effects = [...effects.filter((e) => e.id !== marker.id), marker].slice(-20);
      continue;
    }
    if (!("targetId" in step) || step.targetId !== who) continue;
    if (step.kind === "condition") {
      if (step.condition.kind === "standard") {
        const condition = step.condition.condition;
        if (!conditions.includes(condition)) conditions.push(condition);
        // Lane C2 (dcm-bxp.99.19.52): a condition its entry ends on events (Vanishing Act's Cloaked) records its source.
        if (sourceEnds(cardId, condition) !== undefined) {
          effects = addEffect(
            effects.filter((e) => !isMarker(e, cardId, condition)),
            cardId,
            cardName,
            condition,
            [],
            step.duration,
            step.endsWhen,
          );
        }
      } else {
        for (const c of step.condition.implies ?? []) if (!conditions.includes(c)) conditions.push(c);
        // Plan lanes-2 E4.3 (dcm-q40t, dcm-iedr): the condition's own mods ride on its effect (stored or named in its text).
        effects = addEffect(effects, cardId, cardName, step.condition.tag, step.mods ?? [], step.duration, step.endsWhen);
      }
    } else if (step.kind === "clearCondition") {
      const cond = step.condition;
      if (cond.kind === "standard") {
        conditions = conditions.filter((c) => c !== cond.condition);
        effects = effects.filter((e) => conditionMarkerOf(e)?.condition !== cond.condition);
      } else effects = effects.filter((e) => !((cardIdOfEffect(e) !== null || featureIdOfEffect(e) !== null) && e.text.split(";")[0] === cond.tag));
    } else if (step.kind === "effect") {
      // Plan lanes-2 E4.3 (dcm-o3j; Vitality, CB p.330: "permanently gain ... one Stress slot, one Hit Point slot"): a
      // permanent effect's Hit Point / Stress slot mods raise the sheet's maxima once (`gainSlots`, keyed by the use and
      // its option); its other mods stay an effect.
      const slots = step.duration === "permanent" ? slotCounts(step.mods) : null;
      if (slots !== null) {
        slotted = gainSlots(slotted, `${effectKeyOf(cardId)}:${(step.option ?? step.label).slice(0, 30)}`, capSlots(slotted, slots));
        const rest = step.mods.filter((m) => !isSlotMod(m));
        if (rest.length > 0) effects = addEffect(effects, cardId, cardName, step.label, rest, step.duration, step.endsWhen, step.option);
      } else effects = addEffect(effects, cardId, cardName, step.label, step.mods, step.duration, step.endsWhen, step.option);
    } else if (step.kind === "hope" && !isActor) {
      hope += step.delta;
    }
  }
  const max = hopeMax(sheet.scars, sheet.hopeSlotBonus);
  const slots = slotted === sheet ? {} : { hpMax: slotted.hpMax, stressMax: slotted.stressMax, ...(slotted.slotBonuses ? { slotBonuses: slotted.slotBonuses } : {}) };
  return { ...sheet, ...slots, effects, conditions, hope: Math.max(0, Math.min(max, hope)) };
}

/** The most Hit Point or Stress slots a sheet holds (src/lib/validation/characters.ts). */
const SLOTS_MAX = 12;

const isSlotMod = (m: ResolvedMod) => m.kind === "stat" && (m.stat === "hpMax" || m.stat === "stressMax");

/** Hit Point / Stress slot counts of resolved mods, or null when there are none (as slots.ts `slotsFromMods`). */
function slotCounts(mods: readonly ResolvedMod[]): SlotCounts | null {
  const out: SlotCounts = { hp: 0, stress: 0 };
  for (const m of mods) {
    if (m.kind !== "stat") continue;
    if (m.stat === "hpMax") out.hp += m.delta;
    else if (m.stat === "stressMax") out.stress += m.delta;
  }
  return out.hp === 0 && out.stress === 0 ? null : out;
}

/** Counts that keep the maxima within the sheet's limits. */
function capSlots(sheet: Pick<CharacterSheet, "hpMax" | "stressMax">, c: SlotCounts): SlotCounts {
  return { hp: Math.max(-sheet.hpMax + 1, Math.min(c.hp, SLOTS_MAX - sheet.hpMax)), stress: Math.max(-sheet.stressMax + 1, Math.min(c.stress, SLOTS_MAX - sheet.stressMax)) };
}

/**
 * The actor's sheet after the plan: resources, the limit entries, the card's tokens, effects, conditions, the vault.
 * SD3: a feature's Favor, Focus and held dice too (the runner's `after`; a held die it spent is gone). `paidSheet` is the
 * sheet the plan started from (a feature's D5 delegation passes the sheet its D5 features left: classState, held dice).
 * DA10 (CB p.59 Unshakable, user 2026-10-30): an Unshakable actor rolls a d6 for each Stress the plan marks on them (its
 * Stress costs and Stress steps; `convex/lib/unshakable.ts`) and a 6 skips that Stress. The roll goes to
 * `unshakable.out` for the caller's log; `unshakable.rng` replaces the server's dice (rests pass theirs).
 */
export function actorSheetAfter(paidSheet: CharacterSheet, plan: RunPlan, actorId: string, cardName: string, unshakable: { rng?: Rng; out?: UnshakableRoll[] } = {}): CharacterSheet {
  const sheet = sheetAfterPlan(paidSheet, plan, actorId, cardName);
  const u = unshakePlan(paidSheet, sheet, plan, actorId, true, unshakable.rng);
  if (u.roll) unshakable.out?.push(u.roll);
  return u.sheet;
}

function sheetAfterPlan(paidSheet: CharacterSheet, plan: RunPlan, actorId: string, cardName: string): CharacterSheet {
  const after = plan.actor.after;
  // Lane C2: the use's own roll ends the actor's sourced conditions first (Vanishing Act: "until you roll with Fear"), so
  // a condition the use itself gives is not ended by the roll that gave it.
  const rolled = plan.roll === null ? paidSheet : endConditionsOnRoll(paidSheet, plan.roll.record).sheet;
  const base = writeSheetChanges(rolled, plan.steps, actorId, plan.cardId, cardName, plan.exclusive, true);
  const tokenKey = tokenKeyOf(plan.cardId);
  const others = (paidSheet.cardTokens ?? []).filter((t) => t.cardId !== tokenKey);
  const cardTokens = after.cardTokens > 0 ? [...others, { cardId: tokenKey, count: Math.min(99, after.cardTokens) }] : others;
  const toVault = plan.steps.some((s) => s.kind === "toVault");
  const kept = after.heldDice ? new Set(after.heldDice.map((d) => d.id)) : null;
  const classState = {
    ...base.classState,
    ...(after.favor !== undefined ? { favor: after.favor } : {}),
    ...(after.focus !== undefined && base.classState.martial ? { martial: { ...base.classState.martial, focus: after.focus } } : {}),
  };
  return {
    ...base,
    hope: after.hope,
    stress: Math.min(paidSheet.stressMax, after.stress),
    hp: Math.min(paidSheet.hpMax, after.hp),
    armorMarked: Math.max(0, after.armor),
    featureUses: plan.actor.featureUses.slice(-FEATURE_USES_MAX),
    classState,
    ...(kept ? { heldDice: base.heldDice.filter((d) => kept.has(d.id)) } : {}),
    cardTokens,
    ...(toVault ? { domainCards: { ...paidSheet.domainCards, loadout: paidSheet.domainCards.loadout.filter((c) => c !== plan.cardId) } } : {}),
  };
}

// ---------------------------------------------------------------- condition sources (plan lanes, tracer C2)
//
// dcm-bxp.99.19.52 (docs/tasks/TASK-LN-C2.md). A standard condition on a PC sheet is a bare name (`conditions`). When the
// entry that gives it ends it on events of its own (Vanishing Act, CB p.42: "You remain Cloaked in this way until you
// roll with Fear or until your next rest"), `writeSheetChanges` also writes a source marker: a sheet effect of that entry
// (`card:<cardId>:<n>` / `feat:<hash>:<n>`, as any card or feature effect) whose label is the condition's name and whose
// `until` is the step's duration. The marker is the record of where the condition came from:
// - `conditionSources` reads it (combatMovement / combatActions: a sourced Cloaked ends only by its own endings);
// - `endConditionsOnRoll` ends a marker whose entry ends on the roll (and the condition with it);
// - `lapsedConditions` drops a condition whose marker `expire` took (restHooks: "until your next rest");
// - `withoutCondition` drops a condition with every marker for it (unconscious or dead, an ordinary Cloaked ending).
// No stored shape changes: markers are ordinary `effects` entries (rule 7 needs no widening).

/**
 * `after` without the conditions whose markers were on `before` and are gone from `after` (an `expire` took them: a
 * rest; or `endConditionsOnRoll`), unless another marker still holds the condition. The same sheet when none lapsed.
 */
export function lapsedConditions<T extends Pick<CharacterSheet, "conditions" | "effects">>(before: Pick<CharacterSheet, "effects">, after: T): { sheet: T; ended: EndedCondition[] } {
  const kept = new Set(after.effects.map((e) => e.id));
  const ended: EndedCondition[] = [];
  let sheet = after;
  for (const e of before.effects) {
    const m = conditionMarkerOf(e);
    if (m === null || kept.has(e.id) || !sheet.conditions.includes(m.condition)) continue;
    if (sheet.effects.some((x) => conditionMarkerOf(x)?.condition === m.condition)) continue;
    sheet = { ...sheet, conditions: sheet.conditions.filter((c) => c !== m.condition) };
    ended.push({ condition: m.condition, source: e.source });
  }
  return { sheet, ended };
}

/** A made roll as the end engine reads it (`attack`: an attack roll). Damage and free rolls end nothing (null). */
export function endRollOf(record: Pick<RollRecord, "kind" | "outcome">, attack?: EndRoll["attack"]): EndRoll | null {
  if (record.kind !== "action" && record.kind !== "reaction") return null;
  const o = record.outcome;
  const duality = o === "critical" ? "critical" : o === "successHope" || o === "failHope" ? "hope" : o === "successFear" || o === "failFear" ? "fear" : undefined;
  const success = o === "critical" || o === "successHope" || o === "successFear" ? true : o === "failHope" || o === "failFear" ? false : undefined;
  return { kind: record.kind, ...(duality ? { duality } : {}), ...(success !== undefined ? { success } : {}), ...(attack ? { attack } : {}) };
}

/**
 * The sheet after its bearer made `record`: every marker whose entry ends on that roll (Vanishing Act: a roll with Fear)
 * goes, and its condition with it unless another marker still holds it. `ended` names them for the caller's feed.
 */
export function endConditionsOnRoll<T extends Pick<CharacterSheet, "conditions" | "effects">>(
  sheet: T,
  record: Pick<RollRecord, "kind" | "outcome">,
  attack?: EndRoll["attack"],
): { sheet: T; ended: EndedCondition[] } {
  const roll = endRollOf(record, attack);
  if (roll === null) return { sheet, ended: [] };
  const gone = new Set(
    sheet.effects
      .filter((e) => {
        const m = conditionMarkerOf(e);
        const ends = m === null ? undefined : sourceEnds(m.sourceId, m.condition);
        return ends !== undefined && endsOnOccurrence(ends, { kind: "roll", roll }, "bearer");
      })
      .map((e) => e.id),
  );
  if (gone.size === 0) return { sheet, ended: [] };
  return lapsedConditions(sheet, { ...sheet, effects: sheet.effects.filter((e) => !gone.has(e.id)) });
}

// ---------------------------------------------------------------- riders (plan sheet-drawer SD5)

/**
 * Riders (SD5; docs/tasks/TASK-SD-SD5.md): a card's or a feature's `rider` (or `auto`) use rides on the actor's own attack.
 * The server runs it as its own plan on the attack's targets and folds what lands on the attack itself (`modifyRoll`,
 * `modifyDamage`, `addTargets`, `adjustHpMarked`) into the attack. A rider has no roll of its own, so the attack's roll
 * decides its gates: `bindGates` keeps the steps whose move gates the attack's roll meets and drops the gates.
 *
 * A rider runs in two parts: `pre` (its costs, limit, folds and steps on the actor) before the attack's damage, and `post`
 * (its steps on other creatures: Stress, conditions, movement prompts) after the damage is written, so they land on the
 * instances as the damage left them. A before-roll rider's move-gated steps wait for the roll (`post`).
 */

/** The attack's roll as a rider's gates read it (a critical is a success with Hope, CB p.90). */
export type HostRoll = { success: boolean; critical: boolean; withHope: boolean; withFear: boolean };

/** Steps whose effect lands on the attack itself (the server folds them in). */
export const FOLD_KINDS: ReadonlySet<Step["kind"]> = new Set<Step["kind"]>(["modifyDamage", "modifyRoll", "addTargets", "adjustHpMarked"]);

const MOVE_GATE_NAMES: ReadonlySet<string> = new Set(["success", "failure", "critical", "withHope", "withFear"]);

const isMoveGate = (g: unknown): g is string => typeof g === "string" && MOVE_GATE_NAMES.has(g);

/** Whether a step waits on the move's roll (a `success`, `failure`, `critical`, `withHope` or `withFear` gate). */
export function hasMoveGate(step: Step): boolean {
  return (step.when ?? []).some(isMoveGate);
}

/** The same step with its nested step lists changed by `f`. */
function mapNested(step: Step, f: (steps: readonly Step[]) => Step[]): Step {
  switch (step.kind) {
    case "optional":
      return { ...step, steps: f(step.steps) };
    case "choose":
      return { ...step, options: step.options.map((o) => ({ ...o, steps: f(o.steps) })) };
    case "save":
      return { ...step, onFail: f(step.onFail), onSuccess: f(step.onSuccess) };
    case "check":
      return { ...step, then: f(step.then), otherwise: f(step.otherwise) };
    case "followUp":
      return { ...step, steps: f(step.steps) };
    default:
      return step;
  }
}

/** The step without its move gates (they were decided by the host roll). */
function withoutMoveGates(step: Step): Step {
  const rest = (step.when ?? []).filter((g) => !isMoveGate(g));
  const { when: _when, ...base } = step;
  void _when;
  return (rest.length > 0 ? { ...base, when: rest } : base) as Step;
}

/** Keeps the steps whose move gates the attack's roll meets, without those gates (nested lists too). */
export function bindGates(steps: readonly Step[], roll: HostRoll): Step[] {
  const holds = (g: string) => (g === "success" ? roll.success : g === "failure" ? !roll.success : g === "critical" ? roll.critical : g === "withHope" ? roll.withHope : roll.withFear);
  const out: Step[] = [];
  for (const step of steps) {
    if ((step.when ?? []).some((g) => isMoveGate(g) && !holds(g))) continue;
    out.push(mapNested(withoutMoveGates(step), (list) => bindGates(list, roll)));
  }
  return out;
}

export type RiderPart = "pre" | "post";

/** Which part a step runs in; `split` for an optional or a choose whose own steps split. */
function partOf(step: Step, before: boolean): RiderPart | "split" {
  if (before && hasMoveGate(step)) return "post";
  switch (step.kind) {
    case "optional":
    case "choose":
      return "split";
    case "save":
    case "check":
    case "followUp":
      return "post";
    case "pay":
    case "fear":
      return "pre";
    default:
      return FOLD_KINDS.has(step.kind) || ("to" in step && step.to === "self") ? "pre" : "post";
  }
}

/**
 * The steps of one part of a rider (`before`: a before-roll rider, whose move-gated steps all wait for `post`). An
 * optional step keeps its costs and limit in `pre` and runs without them in `post`; a choose step stays in a part while
 * one of its options has steps there.
 */
export function splitSteps(steps: readonly Step[], part: RiderPart, before: boolean): Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    const p = partOf(step, before);
    if (p === part) out.push(step);
    if (p !== "split") continue;
    if (step.kind === "optional") {
      const inner = splitSteps(step.steps, part, before);
      if (part === "pre") out.push({ ...step, steps: inner });
      else if (inner.length > 0) {
        const { costs: _costs, limit: _limit, ...bare } = step;
        void _costs;
        void _limit;
        out.push({ ...bare, steps: inner });
      }
    } else if (step.kind === "choose") {
      const options = step.options.map((o) => ({ ...o, steps: splitSteps(o.steps, part, before) }));
      if (options.some((o) => o.steps.length > 0)) out.push({ ...step, options });
    }
  }
  return out;
}

/**
 * One part of a rider's use, ready to run: `pre` keeps the costs, limit and requirements; `post` drops them (they were
 * paid and checked in `pre`). `roll` binds the move gates (absent: a before-roll rider's `pre`, which keeps no gated step).
 */
export function riderUse(use: CardUse, part: RiderPart, before: boolean, roll: HostRoll | null): CardUse {
  // Plan lanes E4 (dcm-jx6): a before-roll rider splits on its move gates first and binds them after, so a step gated on
  // the host roll (Signature Move's "On a success, clear a Stress", CB p.331) lands in `post` and runs when the gate holds.
  const steps = !roll ? splitSteps(use.steps, part, before) : before ? bindGates(splitSteps(use.steps, part, before), roll) : splitSteps(bindGates(use.steps, roll), part, before);
  if (part === "pre") return { ...use, steps };
  const { costs: _costs, limit: _limit, requires: _requires, ...rest } = use;
  void _costs;
  void _limit;
  void _requires;
  return { ...rest, steps };
}

/** Whether a part has anything to run (a `pre` part with costs or a limit runs even without steps). */
export function riderPartRuns(use: CardUse, part: RiderPart): boolean {
  return use.steps.length > 0 || (part === "pre" && ((use.costs ?? []).length > 0 || use.limit !== undefined));
}
