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
import { featureKey, parseFeatureId } from "../../src/lib/domain/feature-effects/ids";
import { FEATURE_CLASSIFICATION } from "../../src/lib/srd/feature-effects/classification";
import type { CardEffect, CardUse, Duration, Range, Step, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { lineOfSight, rangeCheck, rangeFromWeapon, tokenDistance, type Combatant, type SightResult } from "../../src/lib/domain/combat-actions/index";
import { tokenVisibility } from "../../src/lib/domain/combat-map/index";
import { derivedDefense, derivedThresholds } from "../../src/lib/domain/characters/derived";
import { withEffects } from "../../src/lib/domain/characters/effects";
import { hopeMax, tierForLevel } from "../../src/lib/domain/characters/index";
import { spellcastTraitOf } from "../../src/lib/domain/characters/spellcast";
import { minionValue } from "../../src/lib/domain/adversaries/index";
import { assertTypedModifier, experienceBonus, spendHope, type Rng } from "../../src/lib/domain/dice/index";
import { appError } from "../../src/lib/errors/app-error";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import { cardEffect, cardUsage } from "../../src/lib/srd/card-effects/index";
import { getDomainCard, getWeapon } from "../../src/lib/srd/index";
import type { AdversaryDef, DomainId, TraitId, Weapon } from "../../src/lib/srd/types";
import { CONDITIONS, FEATURE_USES_MAX, type CharacterSheet, type Effect } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { AttackScene } from "./combatActions";
import { DEFAULT_OPTIONALS, MAX_CARD_TARGETS, type CardRoll, type ParsedChoices } from "./cardChoices";
import type { ChoiceAsks } from "./cardRows";
import { rangeBandValidator } from "./validators/combatRequests";
import { readSheet } from "./characterSheet";
import { rules } from "./rolls";

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));

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

/** Sheet effect ids written by cards: `card:<cardId>:<n>` (the sheet's list ids are at most 40 characters). */
const CARD_EFFECT = /^card:([a-z0-9-]+):\d+$/;

export function cardIdOfEffect(effect: Effect): string | null {
  return CARD_EFFECT.exec(effect.id)?.[1] ?? null;
}

const STANDARD = new Set<string>(CONDITIONS);

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
  const live = withEffects(sheet);
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
  return {
    ...pcCombatant(id, sheet),
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
      const sight = lineOfSight(s.scene.prepared, s.attacker, token, s.scene.visionObjects);
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

/**
 * Cards whose follow-up creatures chain from the creature before them (CA4b user answer: "some cards may need to check
 * range from the target initially hit (chain lightning)"). Chain Lightning (Arcana 5, CB p.328): "Additional adversaries not already
 * targeted by Chain Lightning and within Close range of previous targets who took damage also make the saving throw ...
 * This chain continues until there are no more adversaries within range." The vocabulary can't name a chain origin
 * (`area: "aroundTarget"` reads as "of the target"), so the server lists them (gap bead dcm-dgu).
 */
const CHAIN_CARDS = new Set(["chain-lightning"]);

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
 * from the actor with the area's radius, everything else from the actor with the spec's range. `aroundPoint`, `line`,
 * `front`, `path` and `between` have no point or shape on the map: the actor (gap bead dcm-dgu).
 */
export function rangeOrigin(scene: AttackScene, spec: TargetSpec | undefined, range: Range | "unlimited", from: readonly Creature[], c: Creature): { inRange: boolean; band: Band } | null {
  if (spec === undefined || c.kind === "self") return null;
  const origins = from.filter((o) => o.kind !== "self" && o.tokenId !== c.tokenId);
  if (spec.area === "aroundTarget" && spec.areaRange !== undefined && origins.length > 0) {
    const checks = origins.map((o) => rangeCheck(o.token, c.token, spec.areaRange!));
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
  const actor = pick.actor ? pick.actor(base) : base;
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
    else flag(t, rangeOrigin(creatures.scene, spec && { ...spec, area: spec.area === "aroundSelf" ? "aroundSelf" : undefined }, range, [], t));
  }
  const specs = extraSpecs(use);
  const extraRange = (s: TargetSpec | undefined) => (s === undefined ? "unlimited" : s.range === "weapon" ? (actor.weapons[choices.weapon ?? "primary"]?.range ?? "melee") : s.range);
  for (const c of picked) flag(c, rangeOrigin(creatures.scene, specs.picked, extraRange(specs.picked), targets, c));
  for (const c of allies) flag(c, rangeOrigin(creatures.scene, specs.allies, extraRange(specs.allies), targets, c));
  const chain = CHAIN_CARDS.has(effect.cardId);
  for (const [i, c] of followUp.entries()) flag(c, rangeOrigin(creatures.scene, specs.followUp, extraRange(specs.followUp), chain ? [...targets, ...followUp.slice(0, i)] : targets, c));

  // ---- the roll: cover gives one disadvantage (Q2); an attack roll adds the effects' attack bonus (CB p.96).
  const cover = targets.some((t) => t.kind === "enemy" && t.sight.cover);
  const attackRoll = use.roll !== undefined && (use.roll.kind === "attack" || (use.roll.kind !== "reaction" && use.roll.kind !== "adversaryAttack" && use.roll.difficulty.kind === "target"));
  const live = withEffects(paidSheet);

  // ---- card-specific fixes from the domain tables' "Notes for CA4"
  const numbers = { ...choices.numbers };
  if (effect.cardId === "share-the-burden") {
    // Grace notes: cap the Stress transferred at the target's marked Stress (dcm-fnq).
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

  const context: Omit<RunContext, "rng"> = {
    actor,
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
      return appError("CARD_COST_UNPAID", `Short of: ${r.detail}.`);
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
  const asks: ChoiceAsks = [];
  for (const step of plan.steps) {
    if (step.kind !== "prompt") continue;
    if (step.prompt === "choose" && step.step?.kind === "choose") {
      asks.push({ kind: "choose", stepId: step.step.id, label: step.step.label, options: step.step.options.map((o) => ({ id: o.id, label: o.label })) });
    } else if (step.prompt === "split") {
      asks.push({ kind: "split", label: step.text, tokenIds: tokenIdsOf(built, step.targetIds) });
    }
  }
  if (asks.length > 0) return { kind: "needsChoice", asks, dice: first.values };
  return { kind: "plan", plan: withOnslaught(plan, built.paidSheet, pick.use), picked: context.picked ?? [], dice: first.values, ...(delegated ? { delegated } : {}) };
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
    else text.push(m.flag);
  }
  return { mods: out, text };
}

// ---- SD3: which use an effect belongs to (cards `card:<cardId>:<n>`, features `feat:<hash>:<n>`)

/** FNV-1a (32 bit) in base 36: a short, stable name for a feature id. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Whether a runner id is a feature id (`<source>:<owner>[:<slug>]`); a card id has no colon. */
export function isFeatureUseId(id: string): boolean {
  return parseFeatureId(id) !== null;
}

/** The `cardTokens` id of a use's tokens: the card id, or `feat:<featureId>` for a feature. */
export function tokenKeyOf(id: string): string {
  return isFeatureUseId(id) ? featureKey(id) : id;
}

/**
 * The prefix of a use's sheet effect ids: `card:<cardId>`, or `feat:<hash>` for a feature (sheet effect ids hold at most
 * 40 characters and a feature id up to 53; `featureIdOfEffect` reads the hash back).
 */
export function effectKeyOf(id: string): string {
  return isFeatureUseId(id) ? `feat:${shortHash(id)}` : `card:${id}`;
}

const FEATURE_BY_HASH = new Map(Object.keys(FEATURE_CLASSIFICATION).map((id) => [effectKeyOf(id), id]));

/** Whether a sheet effect belongs to this card or feature (`<prefix>:<n>`). */
export function ownsEffect(effect: Pick<Effect, "id">, id: string): boolean {
  const prefix = `${effectKeyOf(id)}:`;
  return effect.id.startsWith(prefix) && /^\d+$/.test(effect.id.slice(prefix.length));
}

/** The feature id of a sheet effect written by a feature use, or null (NV7 `featureEffect` facts read it). */
export function featureIdOfEffect(effect: Pick<Effect, "id">): string | null {
  const m = /^(feat:[a-z0-9]+):\d+$/.exec(effect.id);
  return m ? (FEATURE_BY_HASH.get(m[1]!) ?? null) : null;
}

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
  for (const step of steps) {
    if (!("targetId" in step) || step.targetId !== who) continue;
    if (step.kind === "condition") {
      if (step.condition.kind === "standard") {
        if (!conditions.includes(step.condition.condition)) conditions.push(step.condition.condition);
      } else {
        for (const c of step.condition.implies ?? []) if (!conditions.includes(c)) conditions.push(c);
        effects = addEffect(effects, cardId, cardName, step.condition.tag, [], step.duration, step.endsWhen);
      }
    } else if (step.kind === "clearCondition") {
      const cond = step.condition;
      if (cond.kind === "standard") conditions = conditions.filter((c) => c !== cond.condition);
      else effects = effects.filter((e) => !((cardIdOfEffect(e) !== null || featureIdOfEffect(e) !== null) && e.text.split(";")[0] === cond.tag));
    } else if (step.kind === "effect") {
      effects = addEffect(effects, cardId, cardName, step.label, step.mods, step.duration, step.endsWhen, step.option);
    } else if (step.kind === "hope" && !isActor) {
      hope += step.delta;
    }
  }
  const max = hopeMax(sheet.scars, sheet.hopeSlotBonus);
  return { ...sheet, effects, conditions, hope: Math.max(0, Math.min(max, hope)) };
}

/**
 * The actor's sheet after the plan: resources, the limit entries, the card's tokens, effects, conditions, the vault.
 * SD3: a feature's Favor, Focus and held dice too (the runner's `after`; a held die it spent is gone). `paidSheet` is the
 * sheet the plan started from (a feature's D5 delegation passes the sheet its D5 features left: classState, held dice).
 */
export function actorSheetAfter(paidSheet: CharacterSheet, plan: RunPlan, actorId: string, cardName: string): CharacterSheet {
  const after = plan.actor.after;
  const base = writeSheetChanges(paidSheet, plan.steps, actorId, plan.cardId, cardName, plan.exclusive, true);
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
