/**
 * Domain cards used on the Combat Map (plan combat-actions, tracer CA4; docs/tasks/TASK-CA-CA4.md): the steps behind
 * `combatCards.useCard`, `combatCards.hand` and the GM's card sanction. Callers are campaign wrappers that already loaded
 * the character with edit permission; these helpers check the card, build the runner's context from the live map, run
 * CA1's pure runner (src/lib/domain/card-effects/run.ts) with the server's dice, write what the plan changes (the sheet,
 * allies' sheets, encounter instances, Fear) and log one undoable actionLog group. AA2 reuses `cardActor`,
 * `pcCombatant`, `writeSheetChanges` for reaction cards in its window.
 *
 * Rules (printed pages; quotes in the task doc):
 * - R6 / Q3 / Q4 (CB p.101): once-per limits are `featureUses` keys `card:<id>` with until rest / longRest; "on a
 *   success" limits are used up only by a success (the runner decides, this module writes `plan.actor.featureUses`).
 * - R8 (CB p.90): Hope gained on the card's own roll can pay its later costs (the runner orders it).
 * - R2 / R9 (CB p.98, p.104): damage rolled once per use and totalled per creature before thresholds; a critical adds
 *   the dice's maximum. R3 / R5 / R10: thresholds, Stress overflow, resistance (CA1's `applyDamageTo`).
 * - R12 / Q7 (CB p.161): an adversary's reaction roll is a server d20 against the card's Difficulty.
 * - R11 / Q1 / Q2 (CB p.103-104): a target outside the card's range waits for the GM; no line of sight refuses; cover
 *   gives the roll one disadvantage.
 * - U1: what a player receives (returns, public rows) holds hit / miss / defeated, their own dice and their own sheet
 *   changes; an enemy's HP, Stress, thresholds and Difficulty are only on the GM's row.
 */
import { v, type Infer } from "convex/values";

import { cardAvailability, RESET_LABEL } from "../../src/lib/domain/card-effects/availability";
import { pickUse, run, type ActorState, type PlanStep, type ResolvedMod, type RunContext, type RunPlan, type RunRefusal, type WeaponInfo } from "../../src/lib/domain/card-effects/run";
import type { CardEffect, CardUse, Duration, Range, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { lineOfSight, rangeCheck, rangeFromWeapon, tokenDistance, type Combatant, type SightResult } from "../../src/lib/domain/combat-actions/index";
import { tokenVisibility } from "../../src/lib/domain/combat-map/index";
import { derivedDefense, derivedThresholds } from "../../src/lib/domain/characters/derived";
import { withEffects } from "../../src/lib/domain/characters/effects";
import { hopeMax, tierForLevel } from "../../src/lib/domain/characters/index";
import { spellcastTraitOf } from "../../src/lib/domain/characters/spellcast";
import { minionValue } from "../../src/lib/domain/adversaries/index";
import { assertTypedModifier, experienceBonus, spendHope, type Rng } from "../../src/lib/domain/dice/index";
import type { RollRecord } from "../../src/lib/domain/duality";
import { SEVERITY_LABEL } from "../../src/lib/domain/encounters/damage";
import { appError } from "../../src/lib/errors/app-error";
import { TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import { cardEffect, cardUsage } from "../../src/lib/srd/card-effects/index";
import { getDomainCard, getWeapon } from "../../src/lib/srd/index";
import type { AdversaryDef, DomainId, TraitId, Weapon } from "../../src/lib/srd/types";
import { CONDITIONS, type CharacterSheet, type Effect } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AttackScene } from "./combatActions";
import { ENCOUNTER_CONDITIONS, type EncounterCondition } from "./validators/encounters";
import { rollValidator, type AdversaryBefore } from "./validators/actionLog";
import { cardChoiceValidator, rangeBandValidator } from "./validators/combatRequests";
import { traitIdValidator } from "./validators/characters";
import { readSheet } from "./characterSheet";
import { rules } from "./rolls";

/** The most targets (and picked, allies, follow-up creatures) one card use names (bounded sanctions, CD8). */
export const MAX_CARD_TARGETS = 20;
/** The most choice entries one use sends. */
export const MAX_CARD_CHOICES = 40;

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));

// ---------------------------------------------------------------- validators

/** The card roll's dialog options: a subset of the sanction's stored roll options (AA0), replayed on approval. */
export const cardRollValidator = v.object({
  /** A trait-roll card that names several traits ("an Agility or Strength Roll"), or a "choice" weapon's trait. */
  trait: v.optional(traitIdValidator),
  modifier: v.optional(v.number()),
  /** The GM's Difficulty for a card with no number (`difficulty: gm`, CB p.157). */
  difficulty: v.optional(v.number()),
  /** Experiences used (1 Hope each, CB p.90). */
  experienceIds: v.optional(v.array(v.string())),
  advantage: v.optional(v.number()),
  disadvantage: v.optional(v.number()),
  help: v.optional(v.number()),
});
export type CardRoll = Infer<typeof cardRollValidator>;

export const cardChoicesValidator = v.array(cardChoiceValidator);
export type CardChoice = Infer<typeof cardChoiceValidator>;

/** One target as the player learns it (U1). */
const cardTargetValidator = v.object({ tokenId: v.id("combatTokens"), hit: v.boolean(), defeated: v.boolean() });

/** Something left to the table: a manual step, a movement, a PC's reaction roll, damage to a PC, an outcome for another roll. */
export const cardPromptValidator = v.object({
  kind: v.union(v.literal("manual"), v.literal("move"), v.literal("pcSave"), v.literal("pcDamage"), v.literal("fold")),
  text: v.string(),
  tokenIds: v.array(v.id("combatTokens")),
});
export type CardPrompt = Infer<typeof cardPromptValidator>;

/** The Minions a player may pick after a card's damage (Q6, CB p.201): the same shape as the weapon attack's offer. */
const cardMinionOfferValidator = v.object({
  requestId: v.id("combatRequests"),
  extra: v.number(),
  candidates: v.array(v.object({ instanceId: v.id("encounterAdversaries"), tokenId: v.id("combatTokens"), name: v.string(), available: v.number() })),
});

/** `useCard` (and the GM's approval) resolved: the player's own dice and per-target hit / miss / defeated. Never a stat. */
export const resolvedCardValidator = v.object({
  status: v.literal("resolved"),
  entryId: v.id("actionLog"),
  cardId: v.string(),
  useId: v.string(),
  /** The card's own roll (null without one). A fixed Difficulty is the card's printed number, never an enemy's. */
  roll: v.union(v.null(), rollValidator),
  /** The damage rolls of the use (Q5: the player sees their own damage totals). */
  damage: v.array(rollValidator),
  success: v.boolean(),
  targets: v.array(cardTargetValidator),
  /** The GM's Fear change from this use (the roll with Fear, a card's Fear step). */
  fearDelta: v.number(),
  prompts: v.array(cardPromptValidator),
  minionOffer: v.union(v.null(), cardMinionOfferValidator),
});
export type ResolvedCard = Infer<typeof resolvedCardValidator>;

/** An out-of-range use waiting for the GM (Q1). */
export const pendingCardValidator = v.object({
  status: v.literal("pending"),
  requestId: v.id("combatRequests"),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

/** A choice the card needs before it can run (a `choose` step or a damage / clear split); nothing was rolled or paid. */
export const needsChoiceValidator = v.object({
  status: v.literal("needsChoice"),
  asks: v.array(
    v.union(
      v.object({ kind: v.literal("choose"), stepId: v.string(), label: v.string(), options: v.array(v.object({ id: v.string(), label: v.string() })) }),
      v.object({ kind: v.literal("split"), label: v.string(), tokenIds: v.array(v.id("combatTokens")) }),
    ),
  ),
});

// ---------------------------------------------------------------- choices

/** The player's picks, parsed from the flat `{id, value}` list the sanction stores (AA0's `cardChoiceValidator`). */
export type ParsedChoices = {
  numbers: Record<string, number>;
  options: Record<string, string[]>;
  optionals: Set<string>;
  /** `optional:<id>` sent as false: an optional the server would take by default (Banish) is left out. */
  declined: Set<string>;
  either: number[];
  splits: Record<string, number>;
  situations: string[];
  picked: string[];
  allies: string[];
  followUp: string[];
  triggerSource?: string;
  triggerSubject?: string;
  triggerAmount?: number;
  weapon?: "primary" | "secondary";
};

const invalid = (what: string) => appError("INVALID", what);

function asNumber(c: CardChoice): number {
  if (typeof c.value !== "number" || !Number.isFinite(c.value)) throw invalid(`${c.id} needs a number.`);
  return c.value;
}
function asList(c: CardChoice): string[] {
  if (typeof c.value === "string") return [c.value];
  if (!Array.isArray(c.value) || c.value.length > MAX_CARD_TARGETS) throw invalid(`${c.id} needs a list.`);
  return c.value;
}
function asText(c: CardChoice): string {
  if (typeof c.value !== "string") throw invalid(`${c.id} needs a value.`);
  return c.value;
}

/**
 * Reads the choice list. Ids: `n:<choice>` (a NumberChoice), `opt:<step>` (options of a choose step), `optional:<step>`
 * (true / false), `either:<i>` (the option index of the i-th "either" cost), `split:<tokenId>` (a share), `situations`,
 * `picked`, `allies`, `followUp` (token ids), `triggerSource`, `triggerSubject` (a token id), `triggerAmount`, `weapon`.
 */
export function parseChoices(list: readonly CardChoice[]): ParsedChoices {
  if (list.length > MAX_CARD_CHOICES) throw invalid("Too many choices.");
  const out: ParsedChoices = { numbers: {}, options: {}, optionals: new Set(), declined: new Set(), either: [], splits: {}, situations: [], picked: [], allies: [], followUp: [] };
  for (const c of list) {
    const [head, ...rest] = c.id.split(":");
    const tail = rest.join(":");
    switch (head) {
      case "n":
        out.numbers[tail] = asNumber(c);
        break;
      case "opt":
        out.options[tail] = asList(c);
        break;
      case "optional":
        if (typeof c.value !== "boolean") throw invalid(`${c.id} needs true or false.`);
        (c.value ? out.optionals : out.declined).add(tail);
        break;
      case "either": {
        const index = Number(tail);
        if (!Number.isInteger(index) || index < 0 || index > 10) throw invalid(`${c.id} is not a cost.`);
        out.either[index] = asNumber(c);
        break;
      }
      case "split":
        out.splits[tail] = asNumber(c);
        break;
      case "situations":
        out.situations = asList(c);
        break;
      case "picked":
      case "allies":
      case "followUp":
        out[head] = asList(c);
        break;
      case "triggerSource":
      case "triggerSubject":
        out[head] = asText(c);
        break;
      case "triggerAmount":
        out.triggerAmount = asNumber(c);
        break;
      case "weapon": {
        const w = asText(c);
        if (w !== "primary" && w !== "secondary") throw invalid("Pick the primary or secondary weapon.");
        out.weapon = w;
        break;
      }
      default:
        throw invalid(`Unknown choice ${c.id}.`);
    }
  }
  for (let i = 0; i < out.either.length; i++) out.either[i] ??= 0;
  return out;
}

// ---------------------------------------------------------------- the card and its use

/** Optional steps taken unless the player declines them (task doc "Notes for CA4": Banish, Sigil of Retribution's strike). */
const DEFAULT_OPTIONALS: Readonly<Record<string, readonly string[]>> = { banish: ["banish"] };

export type CardPick = { effect: CardEffect; use: CardUse; name: string };

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
  return { effect, use, name: card.name };
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

function cardIdOfEffect(effect: Effect): string | null {
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

/** The PC using the card, with the values the runner reads (traits after effects, Spellcast value, the card's tokens). */
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
    readonly scene: AttackScene,
    readonly actorSheet: CharacterSheet,
  ) {}

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

// ---------------------------------------------------------------- building the run

export type CardRequest = {
  /** The character, the campaign and the sheet (already loaded with edit). */
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  sheet: CharacterSheet;
  scene: AttackScene;
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
  outOfRange: { tokenId: Id<"combatTokens">; band: Infer<typeof rangeBandValidator> }[];
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
 * Builds the runner's context: the actor (after the Experiences' Hope), the targets checked for side, sight and range
 * (Q1, Q2), the picked / ally / follow-up creatures, the trigger, the roll options (cover disadvantage, Experiences,
 * the effects' attack bonus) and the card-specific fixes from the domain tables' notes.
 */
export async function buildRun(ctx: QueryCtx, req: CardRequest): Promise<BuiltRun> {
  const { sheet, scene, pick, choices, roll } = req;
  const { effect, use } = pick;
  const actorTokenId = scene.attacker._id;
  const creatures = new Creatures(ctx, req.campaign._id, scene, sheet);

  // Experiences: 1 Hope each, their value added to the roll (CB p.90).
  rules(() => assertTypedModifier(roll.modifier ?? 0));
  const exp = rules(() => experienceBonus(sheet.experiences, roll.experienceIds ?? []));
  if (exp.hope > 0 && use.roll === undefined) throw invalid("This card makes no roll to add an Experience to.");
  const paidSheet = rules(() => spendHope(sheet, exp.hope));
  const actor = cardActor(actorTokenId, paidSheet, effect.cardId, roll.trait);
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
  if (targets.length === 0 && spec?.count.kind === "all" && (spec.side === "enemy" || spec.side === "any") && (spec.area === undefined || spec.area === "aroundSelf")) {
    targets = (await creatures.visibleEnemies()).filter((e) => rangeCheck(scene.attacker, e.token, range).inRange);
  }
  if (spec?.side === "self" && targets.length === 0) targets = [{ kind: "self", tokenId: actorTokenId, token: scene.attacker }];
  const encounters = new Set(targets.flatMap((t) => (t.kind === "enemy" ? [t.encounter._id] : [])));
  if (encounters.size > 1) throw appError("COMBAT_TARGET_INVALID");

  // Q1: targets outside the card's range wait for the GM. With an area, only the anchor (the first target) is measured.
  const measured = spec?.area !== undefined && spec.area !== "aroundSelf" ? targets.slice(0, 1) : targets;
  const outOfRange = measured.flatMap((t) => {
    if (t.kind === "self") return [];
    const check = rangeCheck(scene.attacker, t.token, range);
    return check.inRange ? [] : [{ tokenId: t.tokenId, band: check.band }];
  });

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
  const nearest = enemies.length === 0 ? undefined : Math.min(...enemies.map((e) => tokenDistance(scene.attacker, e.token)));

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
    targets: targets.map((t) => combatantOf(t, actor)),
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

function replaying(values: readonly number[], base: Rng): Rng {
  let i = 0;
  return (sides) => {
    const n = values[i++];
    return n !== undefined && n >= 1 && n <= sides ? n : base(sides);
  };
}

export type RunOutcome = { kind: "plan"; plan: RunPlan; picked: readonly Combatant[] } | { kind: "needsChoice"; asks: Infer<typeof needsChoiceValidator>["asks"] };

/**
 * Runs the use with the server's dice. A picked creature that is also a target the roll missed is dropped and the use
 * re-run with the same dice (Blade notes: Reaper's Strike; Splendor: Stunning Sunlight's picks must be hit targets).
 * A plan that still needs a `choose` option or a split comes back as `needsChoice` (nothing is written).
 */
export function runCard(built: BuiltRun, pick: CardPick, rng: Rng): RunOutcome {
  const first = recording(rng);
  const once = (context: Omit<RunContext, "rng">, r: Rng) => {
    const result = rules(() => run(pick.effect, { ...context, rng: r }));
    if (!result.ok) throw refusalError(result);
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
  const asks: Infer<typeof needsChoiceValidator>["asks"] = [];
  for (const step of plan.steps) {
    if (step.kind !== "prompt") continue;
    if (step.prompt === "choose" && step.step?.kind === "choose") {
      asks.push({ kind: "choose", stepId: step.step.id, label: step.step.label, options: step.step.options.map((o) => ({ id: o.id, label: o.label })) });
    } else if (step.prompt === "split") {
      asks.push({ kind: "split", label: step.text, tokenIds: tokenIdsOf(built, step.targetIds) });
    }
  }
  if (asks.length > 0) return { kind: "needsChoice", asks };
  return { kind: "plan", plan, picked: context.picked ?? [] };
}

function tokenIdsOf(built: BuiltRun, ids: readonly string[]): Id<"combatTokens">[] {
  return ids.flatMap((id) => {
    if (id === built.context.actor.id) return [built.creatures.scene.attacker._id];
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

function nextEffectId(effects: readonly Effect[], cardId: string): string {
  for (let n = 1; n < 100; n++) {
    const id = `card:${cardId}:${n}`;
    if (!effects.some((e) => e.id === id)) return id;
  }
  return `card:${cardId}:0`;
}

/** The sheet effect a card's `effect` step (or a card tag on a PC) becomes, with the card's until (CA4 acceptance). */
function addEffect(effects: Effect[], cardId: string, source: string, label: string, mods: readonly ResolvedMod[], duration: Duration, endsWhen: string | undefined): Effect[] {
  const { mods: stored, text } = sheetMods(mods);
  const words = [label, ...text, ...(endsWhen ? [`ends when ${endsWhen}`] : [])].join("; ");
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
  let effects = exclusive ? sheet.effects.filter((e) => cardIdOfEffect(e) !== cardId) : [...sheet.effects];
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
      else effects = effects.filter((e) => !(cardIdOfEffect(e) !== null && e.text.split(";")[0] === cond.tag));
    } else if (step.kind === "effect") {
      effects = addEffect(effects, cardId, cardName, step.label, step.mods, step.duration, step.endsWhen);
    } else if (step.kind === "hope" && !isActor) {
      hope += step.delta;
    }
  }
  const max = hopeMax(sheet.scars, sheet.hopeSlotBonus);
  return { ...sheet, effects, conditions, hope: Math.max(0, Math.min(max, hope)) };
}

/** The actor's sheet after the plan: resources, the limit entries, the card's tokens, effects, conditions, the vault. */
export function actorSheetAfter(paidSheet: CharacterSheet, plan: RunPlan, actorId: string, cardName: string): CharacterSheet {
  const after = plan.actor.after;
  const base = writeSheetChanges(paidSheet, plan.steps, actorId, plan.cardId, cardName, plan.exclusive, true);
  const others = (paidSheet.cardTokens ?? []).filter((t) => t.cardId !== plan.cardId);
  const cardTokens = after.cardTokens > 0 ? [...others, { cardId: plan.cardId, count: Math.min(99, after.cardTokens) }] : others;
  const toVault = plan.steps.some((s) => s.kind === "toVault");
  return {
    ...base,
    hope: after.hope,
    stress: Math.min(paidSheet.stressMax, after.stress),
    hp: Math.min(paidSheet.hpMax, after.hp),
    armorMarked: Math.max(0, after.armor),
    featureUses: plan.actor.featureUses.slice(-40),
    cardTokens,
    ...(toVault ? { domainCards: { ...paidSheet.domainCards, loadout: paidSheet.domainCards.loadout.filter((c) => c !== plan.cardId) } } : {}),
  };
}

// ---------------------------------------------------------------- enemies

const ENCOUNTER_SET = new Set<string>(ENCOUNTER_CONDITIONS);

export type InstanceWrite = {
  creature: EnemyCreature;
  before: AdversaryBefore;
  patch: { hp: number; stress: number; defeated: boolean; conditions: EncounterCondition[]; tags: string[] };
};

export function adversaryBefore(instance: Doc<"encounterAdversaries">): AdversaryBefore {
  return {
    instanceId: instance._id,
    hp: instance.hp,
    stress: instance.stress,
    defeated: instance.defeated,
    ...(instance.minionCount !== undefined ? { minionCount: instance.minionCount } : {}),
    conditions: instance.conditions,
    tags: instance.tags,
  };
}

/**
 * The instance rows a plan changes. A Minion group is one instance whose HP are its Minions: a hit Minion marks one HP,
 * `defeat` without an amount takes the whole group, with an amount that many (CB p.201).
 */
export function instanceWrites(plan: RunPlan, creatures: Creatures): InstanceWrite[] {
  const writes: InstanceWrite[] = [];
  for (const changed of plan.creatures) {
    const c = creatures.get(changed.id);
    if (!c || c.kind !== "enemy") continue;
    const inst = c.instance;
    const after = changed.after;
    let hp = after.hp;
    if (c.minion) {
      const defeats = plan.steps.filter((s): s is Extract<PlanStep, { kind: "defeat" }> => s.kind === "defeat" && s.targetId === changed.id);
      const whole = defeats.some((d) => d.amount === undefined);
      const counted = defeats.reduce((n, d) => n + (d.amount ?? 0), 0);
      hp = whole ? inst.stats.hpMax : Math.min(inst.stats.hpMax, inst.hp + (after.hp > 0 ? 1 : 0) + counted);
    }
    hp = Math.max(0, Math.min(inst.stats.hpMax, hp));
    const conditions = after.conditions.filter((x): x is EncounterCondition => ENCOUNTER_SET.has(x));
    writes.push({
      creature: c,
      before: adversaryBefore(inst),
      patch: { hp, stress: Math.max(0, Math.min(inst.stats.stressMax, after.stress)), defeated: inst.defeated || hp >= inst.stats.hpMax, conditions: [...new Set(conditions)], tags: [...new Set(after.tags ?? [])].slice(0, 20) },
    });
  }
  // A Minion group hit by `defeat` with an amount is not in `plan.creatures` (the runner doesn't change it).
  for (const step of plan.steps) {
    if (step.kind !== "defeat" || step.amount === undefined || writes.some((w) => w.creature.tokenId === step.targetId)) continue;
    const c = creatures.get(step.targetId);
    if (!c || c.kind !== "enemy") continue;
    const inst = c.instance;
    const hp = Math.min(inst.stats.hpMax, inst.hp + step.amount);
    writes.push({ creature: c, before: adversaryBefore(inst), patch: { hp, stress: inst.stress, defeated: hp >= inst.stats.hpMax, conditions: inst.conditions, tags: inst.tags } });
  }
  return writes;
}

/** Writes the instances (U4: the GM row's `adversaryBefore` lets undo put them back). */
export async function writeInstances(ctx: MutationCtx, writes: readonly InstanceWrite[]): Promise<void> {
  const now = Date.now();
  for (const w of writes) await ctx.db.patch("encounterAdversaries", w.creature.instance._id, { ...w.patch, updatedAt: now });
}

// ---------------------------------------------------------------- the rows' words

const SHORT_TYPE = { physical: "phy", magic: "mag", both: "phy/mag" } as const;

export function rollWord(roll: RollRecord): string {
  if (roll.outcome === "critical") return "critical";
  if (roll.outcome === "none") return "";
  return roll.outcome === "successHope" || roll.outcome === "failHope" ? "with Hope" : "with Fear";
}

function diceList(roll: RollRecord): string {
  return roll.dice.filter((d) => !d.dropped).map((d) => d.value).join(", ");
}

/** "Spellcast 15 with Hope", "Agility 12 with Fear (vs 13)". The card's printed Difficulty only (never an enemy's). */
export function rollText(use: CardUse, roll: RollRecord, trait: TraitId | undefined): string {
  const spec = use.roll;
  let label = "Roll";
  if (spec?.kind === "spellcast" || (spec?.kind === "reaction" && spec.trait === "spellcast")) label = "Spellcast";
  else if (spec?.kind === "reaction" && spec.trait !== "spellcast") label = TRAIT_LABEL[spec.trait];
  else if (spec?.kind === "trait") label = TRAIT_LABEL[typeof spec.trait === "string" ? spec.trait : trait && spec.trait.includes(trait) ? trait : spec.trait[0]!];
  else if (spec?.kind === "attack") label = "Attack";
  const versus = roll.difficulty !== undefined ? ` vs ${roll.difficulty}` : "";
  return `${label} ${roll.total}${versus} ${rollWord(roll)}`.trim();
}

/** The public words per target (U1): Hit, Miss or Defeated, and nothing numeric. */
export function publicTargets(plan: RunPlan, built: BuiltRun, writes: readonly InstanceWrite[]): { parts: string[]; outcomes: Infer<typeof cardTargetValidator>[] } {
  const parts: string[] = [];
  const outcomes: Infer<typeof cardTargetValidator>[] = [];
  for (const t of built.targets) {
    if (t.kind === "self") continue;
    const id = t.tokenId as string;
    const hit = plan.hits.find((h) => h.id === id)?.hit ?? false;
    const write = writes.find((w) => w.creature.tokenId === t.tokenId);
    const defeated = t.kind === "enemy" ? (write?.patch.defeated ?? t.instance.defeated) : false;
    const name = t.kind === "enemy" ? t.instance.label : t.sheet.name;
    outcomes.push({ tokenId: t.tokenId, hit, defeated });
    parts.push(`${name}: ${defeated ? "Defeated" : hit ? "Hit" : "Miss"}`);
  }
  return { parts, outcomes };
}

/** The GM's words: damage → severity → HP per enemy, marks, conditions, saves, misses against the Difficulty. */
export function gmLines(plan: RunPlan, built: BuiltRun, writes: readonly InstanceWrite[]): string[] {
  const lines: string[] = [];
  const name = (id: string) => {
    if (id === built.context.actor.id) return "self";
    const c = built.creatures.get(id);
    return c === undefined ? "?" : c.kind === "enemy" ? c.instance.label : c.kind === "pc" ? c.sheet.name : "self";
  };
  const total = plan.roll?.record.total;
  for (const h of plan.hits) {
    const c = built.creatures.get(h.id);
    if (!h.hit && c?.kind === "enemy" && total !== undefined) lines.push(`${c.instance.label}: miss (${total} vs Difficulty ${difficultyOf(c.instance)})`);
  }
  for (const step of plan.steps) {
    if (step.kind === "damage") {
      const r = step.result;
      lines.push(`${name(r.targetId)}: ${r.incoming}${r.resisted !== "none" ? ` (${r.resisted}: ${r.taken})` : ""} → ${SEVERITY_LABEL[r.severity]} → ${r.hpMarked} HP`);
    } else if (step.kind === "mark") lines.push(`${name(step.targetId)}: marks ${step.amount} ${step.track}${step.overflow ? " (full: 1 HP)" : ""}`);
    else if (step.kind === "save") lines.push(`${name(step.targetId)}: reaction ${step.record.total} vs ${step.difficulty} → ${step.success ? "succeeds" : "fails"}`);
    else if (step.kind === "condition") lines.push(`${name(step.targetId)}: ${step.condition.kind === "standard" ? step.condition.condition : step.condition.tag}`);
    else if (step.kind === "defeat") lines.push(`${name(step.targetId)}: defeated${step.amount !== undefined ? ` (${step.amount})` : ""}`);
    else if (step.kind === "effect" && built.creatures.get(step.targetId)?.kind === "enemy") lines.push(`${name(step.targetId)}: ${step.label} (add in the tracker)`);
  }
  for (const id of plan.excluded) lines.push(`${name(id)}: not affected (the card's filter)`);
  for (const w of writes) lines.push(`${w.creature.instance.label} now ${w.patch.hp}/${w.creature.instance.stats.hpMax} HP, ${w.patch.stress}/${w.creature.instance.stats.stressMax} Stress${w.patch.defeated ? ", defeated" : ""}`);
  return lines;
}

/** The damage rolls of the plan, for the player and the public row (Q5). */
export function damageRolls(plan: RunPlan): { roll: RollRecord; text: string }[] {
  return plan.steps.flatMap((s) => (s.kind === "damageRoll" ? [{ roll: s.record, text: `${s.record.total} ${SHORT_TYPE[s.type]}${diceList(s.record) ? ` (${diceList(s.record)})` : ""}` }] : []));
}

/** What the table still does by hand (manual steps, moves, PC reaction rolls, damage to PCs, outcomes for other rolls). */
export function promptsOf(plan: RunPlan, built: BuiltRun): CardPrompt[] {
  const name = (id: string) => (id === built.context.actor.id ? "You" : (() => {
    const c = built.creatures.get(id);
    return c?.kind === "pc" ? c.sheet.name : c?.kind === "enemy" ? c.instance.label : "?";
  })());
  const out: CardPrompt[] = [];
  for (const s of plan.steps) {
    if (s.kind === "prompt" && (s.prompt === "manual" || s.prompt === "move" || s.prompt === "pcSave")) {
      out.push({ kind: s.prompt, text: s.prompt === "pcSave" ? `${s.targetIds.map(name).join(", ")}: make a reaction roll` : s.text, tokenIds: tokenIdsOf(built, s.targetIds) });
    } else if (s.kind === "pcDamage") {
      out.push({ kind: "pcDamage", text: `${name(s.targetId)} takes ${s.amount} ${s.type === "both" ? "physical and magic" : s.type} damage${s.direct ? " (direct)" : ""}: mark it on the sheet`, tokenIds: tokenIdsOf(built, [s.targetId]) });
    } else if (s.kind === "fold") {
      const amount = s.amount === undefined ? "" : ` (${s.amount})`;
      out.push({ kind: "fold", text: `${s.step.note ?? s.step.kind}${amount}`, tokenIds: tokenIdsOf(built, s.targetIds) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the Hand

export const handUseValidator = v.object({
  useId: v.string(),
  name: v.string(),
  activation: v.union(v.literal("action"), v.literal("reaction"), v.literal("rider"), v.literal("auto"), v.literal("passive")),
  ready: v.boolean(),
  resetLabel: v.union(v.null(), v.string()),
  usesLeft: v.union(v.null(), v.number()),
  /** Whether the use rolls (the Hand shows the roll options). */
  rolls: v.boolean(),
  /** Who it targets: side, range ("weapon", "unlimited" or a band) and count kind; null for trigger targets or none. */
  targets: v.union(v.null(), v.object({ side: v.string(), range: v.string(), count: v.string() })),
  /** NumberChoices the player sets first ("spend any number of Hope"). */
  choices: v.array(v.object({ id: v.string(), label: v.string(), min: v.number() })),
});

export const handCardValidator = v.object({
  cardId: v.string(),
  name: v.string(),
  domain: v.string(),
  level: v.number(),
  type: v.string(),
  recallCost: v.number(),
  place: v.union(v.literal("loadout"), v.literal("vault")),
  usage: v.union(v.literal("combat"), v.literal("passive"), v.literal("outOfCombat")),
  /** ready / exhausted (its card key used up, CB p.101), passive (always on), outOfCombat (CARD_NOT_COMBAT on the map). */
  state: v.union(v.literal("ready"), v.literal("exhausted"), v.literal("passive"), v.literal("outOfCombat")),
  resetLabel: v.union(v.null(), v.string()),
  tokens: v.number(),
  uses: v.array(handUseValidator),
});
export type HandCard = Infer<typeof handCardValidator>;

function countWord(spec: TargetSpec): string {
  return spec.count.kind;
}

/** One card of the Hand: its state from the sheet's `featureUses` (Q3, the same answer CA7 greys the sheet with). */
export function handCard(sheet: CharacterSheet, cardId: string, place: "loadout" | "vault"): HandCard | null {
  const card = getDomainCard(cardId);
  if (card === undefined) return null;
  const usage = cardUsage(cardId);
  const effect = cardEffect(cardId);
  const uses = (effect?.uses ?? []).map((u) => {
    const a = cardAvailability(sheet, cardId, { useId: u.id, ...(u.limit ? { limit: u.limit } : {}) });
    const spec = specOf(u);
    return {
      useId: u.id,
      name: u.name,
      activation: u.activation.kind,
      ready: a.state === "ready",
      resetLabel: a.state === "exhausted" ? a.label : null,
      usesLeft: a.state === "ready" && a.usesLeft !== undefined ? a.usesLeft : null,
      rolls: u.roll !== undefined,
      targets: spec ? { side: spec.side, range: spec.range, count: countWord(spec) } : null,
      choices: (u.choices ?? []).map((c) => ({ id: c.id, label: c.label, min: c.min })),
    };
  });
  const main = cardAvailability(sheet, cardId);
  const limited = (effect?.uses ?? []).filter((u) => u.activation.kind !== "passive");
  const allSpent = limited.length > 0 && limited.every((u) => u.limit !== undefined && cardAvailability(sheet, cardId, { useId: u.id, limit: u.limit }).state === "exhausted");
  let state: HandCard["state"];
  let resetLabel: string | null = null;
  if (usage === "outOfCombat") state = "outOfCombat";
  else if (main.state === "exhausted" || allSpent) {
    state = "exhausted";
    resetLabel = main.state === "exhausted" ? main.label : (uses.find((u) => u.resetLabel !== null)?.resetLabel ?? RESET_LABEL.rest);
  } else state = usage === "passive" ? "passive" : "ready";
  return {
    cardId,
    name: card.name,
    domain: card.domain,
    level: card.level,
    type: card.type,
    recallCost: card.recallCost,
    place,
    usage,
    state,
    resetLabel,
    tokens: sheet.cardTokens?.find((t) => t.cardId === cardId)?.count ?? 0,
    uses,
  };
}

/** The loadout, then the vault (`owned − loadout`), each card with its state. */
export function handOf(sheet: CharacterSheet): { loadout: HandCard[]; vault: HandCard[] } {
  const loadout = sheet.domainCards.loadout.flatMap((id) => handCard(sheet, id, "loadout") ?? []);
  const vault = sheet.domainCards.owned.filter((id) => !sheet.domainCards.loadout.includes(id)).flatMap((id) => handCard(sheet, id, "vault") ?? []);
  return { loadout, vault };
}
