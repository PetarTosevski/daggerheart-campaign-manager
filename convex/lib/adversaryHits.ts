/**
 * The building blocks of incoming hits (plan combat-actions; split out of ./incomingHits.ts by AA2c, CH9: logic files
 * under 800 lines). The party a window reads, the PC as the window sees them, the seeded dice of card answers, the
 * stored row rebuilt into AA1's window state, a reaction card's payment, and the riders and after-hit card uses of
 * AA2b. ./incomingHits.ts opens, answers, resolves and reads hits with them and re-exports the public names, so callers
 * keep importing from there (docs/tasks/TASK-CA-AA2.md, TASK-CA-AA2b.md, TASK-CA-AA2c.md).
 *
 * Rules (printed pages): CB p.91 thresholds; CB p.92 Stress overflow; CB p.101 the vault; CB p.114 Armor Slots.
 */
import { applyStressTo, rangeCheck, type Combatant } from "../../src/lib/domain/combat-actions/index";
import { rollD20, run as runCardUse, type ActorState, type HeldDieState, type PlanStep, type RunPlan, type RunRefusal } from "../../src/lib/domain/card-effects/run";
import type { CardEffect, Mod, Range, Step } from "../../src/lib/domain/card-effects/types";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import { hopeMax } from "../../src/lib/domain/characters/index";
import {
  openWindow,
  progress as progressOf,
  respond as windowRespond,
  runReactionCard,
  runReactionFeature,
  type ArmorCost,
  type Fold,
  type PcDefense,
  type WindowHit,
  type WindowPc,
  type WindowState,
} from "../../src/lib/domain/adversary-actions/index";
import { maxDamage, parseDamage } from "../../src/lib/domain/adversaries/index";
import { rollDamage, type Rng } from "../../src/lib/domain/dice/index";
import type { RollRecord } from "../../src/lib/domain/duality";
import { activeBeastformId, holdingsFor, owned } from "../../src/lib/domain/feature-effects/owned";
import { actorExtras } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { applyUpgrades } from "../../src/lib/domain/feature-effects/upgrades";
import { appError } from "../../src/lib/errors/app-error";
import { resolveOptions } from "../../src/lib/frames/options";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { blockOf } from "./adversaryFeatures";
import { parseChoices, type CardChoice } from "./cardChoices";
import { cardActor, cardIdOfEffect, effectOption, featureIdOfEffect, pcCombatant, writeSheetChanges } from "./cardRunner";
import { partyOf, readSheet } from "./characterSheet";
import { tokensOnMap } from "./combatMaps";
import type { HitRider, IncomingHitPayload, PcAttacker } from "./validators/combatRequests";

/** One hit before armor, as the runner's `IncomingHitDraft` gives it. */
export type HitDraft = {
  amount: number;
  type: "physical" | "magic" | "both";
  direct: boolean;
  forcedArmor: number;
  critical: boolean;
  /** Kept only in memory (an Evasion fold compares against it at once); never stored (Q14). */
  attackTotal?: number;
};

export type HitAttacker = IncomingHitPayload["attacker"];

/** A PC attacker (a card's damage to an ally, AA2b); otherwise the attacker is an adversary instance. */
export function isPcAttacker(attacker: HitAttacker): attacker is PcAttacker {
  return "kind" in attacker && attacker.kind === "pc";
}

/** The attacking instance, or null for a PC attacker. */
export function attackerInstanceId(attacker: HitAttacker): Id<"encounterAdversaries"> | null {
  return isPcAttacker(attacker) ? null : attacker.instanceId;
}

/** An active character of the campaign with a readable sheet. */
export type PartyMember = { character: Doc<"characters">; sheet: CharacterSheet };

/** Distance band between two characters' tokens on the live map; undefined without a map (Q18: any range). */
export type BandBetween = (from: Id<"characters">, to: Id<"characters">) => Range | undefined;

// ---------------------------------------------------------------- the party

/** The campaign's active characters with readable sheets (bounded by the campaign's character cap). */
export async function partyMembers(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<PartyMember[]> {
  const out: PartyMember[] = [];
  for (const character of await partyOf(ctx, campaignId)) {
    if (character.status !== "active") continue;
    try {
      out.push({ character, sheet: readSheet(character.sheet) });
    } catch {
      // A corrupt sheet can't take or answer a hit; its own reads report CHARACTER_CORRUPT.
    }
  }
  return out;
}

/** Bands between the PCs' tokens on a map (the window's card ranges, I Am Your Shield's Very Close). */
export async function bandsOnMap(ctx: QueryCtx, mapId: Id<"combatMaps"> | undefined): Promise<BandBetween> {
  if (mapId === undefined) return () => undefined;
  const map = await ctx.db.get("combatMaps", mapId);
  if (map === null || !map.live) return () => undefined;
  const tokens = await tokensOnMap(ctx, mapId);
  const tokenOf = (id: Id<"characters">) => tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === id);
  return (from, to) => {
    const a = tokenOf(from);
    const b = tokenOf(to);
    return a && b ? rangeCheck(a, b, "melee").band : undefined;
  };
}

/** The sheet effect the Flying toggle writes (Q16; SD3's `FLYING_EFFECT_ID` in ./featureRunner.ts). */
const FLYING_EFFECT_ID = "flying";

/** What a PC's feature answers need besides the sheet (SD4): the campaign's Hope & Fear option, the band to the attacker. */
export type FeatureScope = { hopeAndFear: boolean; bandToAttacker?: Range };

/**
 * SD4: the PC as the card runner's actor for a feature answer: the card actor (resources, traits), SD1's Favor, Focus and
 * held dice, and the facts NV7 requirements read (conditions, tags, Flying (Q16), feature effects such as Channeling).
 */
export function featureActor(id: string, sheet: CharacterSheet): ActorState {
  return {
    ...cardActor(id, sheet, "", undefined),
    ...actorExtras(sheet),
    facts: {
      conditions: sheet.conditions,
      tags: sheet.effects.map((e) => e.text.split("; ")[0] ?? ""),
      flying: sheet.effects.some((e) => e.id === FLYING_EFFECT_ID),
      featureEffects: sheet.effects.flatMap((e) => {
        const featureId = featureIdOfEffect(e);
        const option = effectOption(e);
        return featureId === null ? [] : [{ featureId, ...(option !== undefined ? { option } : {}) }];
      }),
      // DA8: the active stance (Q5) and Beastform, as `factsOf` (./featureRunner.ts) reads them: without them a stance's
      // answer (Stable, HF p.12) asks for a confirmation the prompt never shows and the server refuses it.
      beastformId: activeBeastformId(sheet),
      activeStance: sheet.classState.martial?.active ?? null,
    },
  };
}

/**
 * SD4: the features a sheet holds (`owned()`, Hope & Fear content by the campaign's option) whose effect entry has a
 * reaction or automatic use, with the upgrades that hold applied (NV3).
 */
export function answeringFeatures(sheet: CharacterSheet, hopeAndFear: boolean): FeatureEffect[] {
  const held = owned(sheet, { hopeAndFear });
  const out: FeatureEffect[] = [];
  for (const f of held) {
    if (f.usage !== "combat") continue;
    const entry = featureEffect(f.featureId);
    if (!entry || !entry.uses.some((u) => u.activation.kind === "reaction" || u.activation.kind === "auto")) continue;
    out.push(applyUpgrades(entry, holdingsFor(sheet, held, entry.owner)));
  }
  return out;
}

/** The campaign's Hope & Fear option (feature ownership, SD1's `owned` scope). */
export async function hopeAndFearOf(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  const campaign = await ctx.db.get("campaigns", campaignId);
  return campaign === null ? true : resolveOptions(campaign.frameId, campaign.options).hopeAndFear;
}

/**
 * A PC as the window reads them: thresholds (armor + level, CB p.91), tracks, Evasion, loadout cards with effects; with
 * `scope` (SD4) also the actor and the features they may answer with, and the band to the attacker.
 */
export function windowPcOf(member: PartyMember, bandToTarget?: Range, scope?: FeatureScope): WindowPc {
  const { character, sheet } = member;
  const c = pcCombatant(character._id, sheet);
  const cards = sheet.domainCards.loadout.flatMap((id) => {
    const effect = cardEffect(id);
    return effect ? [effect] : [];
  });
  return {
    id: character._id,
    thresholds: derivedThresholds(sheet),
    hp: sheet.hp,
    hpMax: sheet.hpMax,
    stress: sheet.stress,
    stressMax: sheet.stressMax,
    armor: c.armor,
    armorMax: c.armorMax,
    hope: sheet.hope,
    ...(c.evasion !== undefined ? { evasion: c.evasion } : {}),
    ...withResistance(pcResistance(sheet, { hopeAndFear: scope?.hopeAndFear ?? true, ...(scope?.bandToAttacker !== undefined ? { attackerBand: scope.bandToAttacker } : {}) })),
    featureUses: sheet.featureUses,
    cards,
    ...(bandToTarget !== undefined ? { bandToTarget } : {}),
    ...(scope ? { actor: featureActor(character._id, sheet), features: answeringFeatures(sheet, scope.hopeAndFear) } : {}),
    ...(scope?.bandToAttacker !== undefined ? { bandToAttacker: scope.bandToAttacker } : {}),
  };
}

// ---------------------------------------------------------------- a PC's resistance (E2, dcm-nt4)

type Level = "none" | "resistant" | "immune";
const LEVELS: readonly Level[] = ["none", "resistant", "immune"];
const stronger = (a: Level, b: Level): Level => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);

/** Every step of a use, nested optional / choose / check steps included. */
function everyStep(steps: readonly Step[]): Step[] {
  return steps.flatMap((s): Step[] => {
    if (s.kind === "optional") return [s, ...everyStep(s.steps)];
    if (s.kind === "choose") return [s, ...s.options.flatMap((o) => everyStep(o.steps))];
    if (s.kind === "check") return [s, ...everyStep(s.then), ...everyStep(s.otherwise)];
    return [s];
  });
}

/** The mods of the step that wrote a sheet effect: its card's or feature's `effect` (or tag `condition`) step of that label. */
function effectMods(entry: Pick<CardEffect, "uses"> | undefined, label: string): Mod[] {
  if (!entry) return [];
  return entry.uses.flatMap((u) =>
    everyStep(u.steps).flatMap((s) => {
      if (s.kind === "effect" && s.label === label) return [...s.mods];
      if (s.kind === "condition" && s.condition.kind === "tag" && s.condition.tag === label) return [...(s.mods ?? [])];
      return [];
    }),
  );
}

/**
 * E2 (dcm-nt4): whether a resistance mod holds against this hit. `from` "melee" / "beyondMelee" reads the attacker's
 * band (unknown: any range, Q18); `outsideArea` (Rejuvenation Barrier, CB p.339: "resistance to physical damage from
 * outside the barrier") holds while the engine can't place the attacker in the area (no area runtime yet: as Q18, an
 * unknown position doesn't take the protection away; see TASK-LN-E2 QUESTIONS); a `keyword` resistance (Fireproof) needs a
 * hit with that keyword, which adversary hits don't carry yet.
 */
export function resistanceHolds(mod: Extract<Mod, { kind: "resistance" }>, attackerBand: Range | undefined): boolean {
  if (mod.keyword !== undefined) return false;
  if (mod.from === "melee") return attackerBand === undefined || attackerBand === "melee";
  if (mod.from === "beyondMelee") return attackerBand === undefined || attackerBand !== "melee";
  return true;
}

/**
 * E2 (dcm-nt4): a PC's resistance and immunity against an incoming hit (CB p.99), from what the sheet holds: the sheet
 * effects a card or feature wrote (Rejuvenation Barrier, Retract, Book of Yarrow's immunity; the `effect` / tag
 * `condition` step of that label) and the passive uses of the features they hold without a requirement (Armored Shell).
 * Each damage type takes its strongest level. Undefined when nothing applies.
 */
export function pcResistance(sheet: CharacterSheet, scope: { hopeAndFear: boolean; attackerBand?: Range }): PcDefense["resistance"] {
  const mods: Mod[] = [];
  for (const e of sheet.effects) {
    const label = e.text.split("; ")[0] ?? "";
    const cardId = cardIdOfEffect(e);
    if (cardId !== null) mods.push(...effectMods(cardEffect(cardId), label));
    const featureId = featureIdOfEffect(e);
    if (featureId !== null) mods.push(...effectMods(featureEffect(featureId), label));
  }
  for (const f of owned(sheet, { hopeAndFear: scope.hopeAndFear })) {
    for (const u of featureEffect(f.featureId)?.uses ?? []) if (u.activation.kind === "passive" && (u.requires ?? []).length === 0) mods.push(...(u.mods ?? []));
  }
  let physical: Level = "none";
  let magic: Level = "none";
  for (const m of mods) {
    if (m.kind !== "resistance" || !resistanceHolds(m, scope.attackerBand)) continue;
    if (m.type === "physical" || m.type === "both") physical = stronger(physical, m.level);
    if (m.type === "magic" || m.type === "both") magic = stronger(magic, m.level);
  }
  return physical === "none" && magic === "none" ? undefined : { physical, magic };
}

const withResistance = (r: PcDefense["resistance"]) => (r ? { resistance: r } : {});

// ---------------------------------------------------------------- the attacker's dearer Armor Slots (E2, dcm-s77)

/**
 * E2 (dcm-s77): the `armorCost` steps of the attacker's stat block that apply to this hit (the server re-reads the
 * entries, as the payload names the feature): the attacking feature's own action or reaction uses (Tormenting Lash, CB
 * p.235; Boiling Blast, CB p.236; Rending Jaws, HF p.81), and every automatic or passive use set off by "a successful
 * attack" with no narrowing beyond the attack kind (Armor Eater, HF p.71: "When the Pangolati makes a successful attack
 * against a PC"). The dearest `slotsPerStep` wins; `alsoMark` adds up. Undefined when none applies.
 */
export function hitArmorCost(effects: readonly AdversaryFeatureEffect[], feature: string | undefined): ArmorCost | undefined {
  const steps: Extract<Step, { kind: "armorCost" }>[] = [];
  const collect = (list: readonly unknown[]) => {
    for (const s of everyStep(list as readonly Step[])) if (s.kind === "armorCost") steps.push(s);
  };
  for (const effect of effects) {
    for (const use of effect.uses) {
      const a = use.activation;
      if ((a.kind === "action" || a.kind === "reaction") && feature !== undefined && effect.feature === feature) collect(use.steps);
      else if (a.kind === "auto" && a.trigger.kind === "onHit") {
        const { kind: _kind, attack, ...narrowing } = a.trigger;
        void _kind;
        if (Object.keys(narrowing).length > 0 || (attack === "standard" && feature !== undefined)) continue;
        collect(use.steps);
      }
    }
  }
  if (steps.length === 0) return undefined;
  const per = Math.max(1, ...steps.map((s) => s.slotsPerStep ?? 1));
  const marks = steps.flatMap((s) => (s.alsoMark ? [s.alsoMark] : []));
  const track = marks[0]?.track;
  const amount = marks.filter((m) => m.track === track).reduce((n, m) => n + m.amount, 0);
  return { ...(per > 1 ? { slotsPerStep: per } : {}), ...(track && amount > 0 ? { alsoMark: { track, amount } } : {}) };
}

/** E2 (dcm-s77): the hit's dearer Armor Slots from its attacking instance's stat block; none for a PC attacker. */
export async function armorCostOf(ctx: QueryCtx, row: { campaignId: Id<"campaigns">; payload: Pick<IncomingHitPayload, "attacker"> }): Promise<ArmorCost | undefined> {
  const attacker = row.payload.attacker;
  if (isPcAttacker(attacker)) return undefined;
  const instance = await ctx.db.get("encounterAdversaries", attacker.instanceId);
  if (instance === null || instance.campaignId !== row.campaignId) return undefined;
  const block = await blockOf(ctx, instance);
  return block ? hitArmorCost(block.effects, attacker.feature) : undefined;
}

/** The typed id of a character the window names by string (always one of the party, or the stored target). */
export function memberId(members: readonly PartyMember[], id: string, fallback: Id<"characters">): Id<"characters"> {
  return members.find((m) => m.character._id === id)?.character._id ?? fallback;
}

/** Band from a PC's token to the attacker's token on the live map (SD4: Not This Time's Far, Eye for an Eye's Melee). */
export type BandToAttacker = (characterId: Id<"characters">) => Range | undefined;

export function windowParty(party: readonly PartyMember[], targetId: Id<"characters">, bands: BandBetween, features?: { hopeAndFear: boolean; toAttacker: BandToAttacker }): WindowPc[] {
  return party.map((m) => {
    const toAttacker = features?.toAttacker(m.character._id);
    return windowPcOf(m, m.character._id === targetId ? undefined : bands(m.character._id, targetId), features ? { hopeAndFear: features.hopeAndFear, ...(toAttacker !== undefined ? { bandToAttacker: toAttacker } : {}) } : undefined);
  });
}

/** SD4: bands from the PCs' tokens to the attacker's token on the live map (an instance or a PC attacker); none without one. */
export async function attackerBandsOnMap(ctx: QueryCtx, mapId: Id<"combatMaps"> | undefined, attacker: HitAttacker): Promise<BandToAttacker> {
  if (mapId === undefined) return () => undefined;
  const map = await ctx.db.get("combatMaps", mapId);
  if (map === null || !map.live) return () => undefined;
  const tokens = await tokensOnMap(ctx, mapId);
  const from = isPcAttacker(attacker)
    ? tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === attacker.characterId)
    : tokens.find((t) => t.ref.kind === "adversary" && t.ref.adversaryId === attacker.instanceId);
  if (!from) return () => undefined;
  return (id) => {
    const token = tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === id);
    return token ? rangeCheck(token, from, "melee").band : undefined;
  };
}

// ---------------------------------------------------------------- dice for card answers

/** FNV-1a, 32 bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Dice seeded from the request and the answer's index (mulberry32): a card answer's folds rebuild the same every time. */
export function seededRng(seed: string): Rng {
  let a = hash(seed);
  return (sides: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * sides) + 1;
  };
}

export function windowHitOf(attacker: HitAttacker, hit: Pick<HitDraft, "amount" | "type" | "direct" | "forcedArmor" | "critical" | "attackTotal">, riders: readonly HitRider[] = [], armorCost?: ArmorCost): WindowHit {
  return {
    amount: hit.amount,
    ...(armorCost ? { armorCost } : {}),
    type: hit.type,
    direct: hit.direct,
    ...(hit.forcedArmor > 0 ? { forcedArmor: hit.forcedArmor } : {}),
    attackerId: isPcAttacker(attacker) ? attacker.characterId : attacker.instanceId,
    critical: hit.critical,
    ...(hit.attackTotal !== undefined ? { attackTotal: hit.attackTotal } : {}),
    ...(riders.some(isConditionRider) ? { conditionRiders: true } : {}),
  };
}

/** A rider Bold Presence avoids ("when you would gain a condition"): a condition, or a card tag's effect. */
export function isConditionRider(r: HitRider): boolean {
  return r.kind === "condition" || (r.kind === "effect" && r.fromCondition === true);
}

/** The party a hit's window reads: a PC attacker doesn't answer their own card's hit. */
export function respondingParty(party: readonly PartyMember[], attacker: HitAttacker): readonly PartyMember[] {
  return isPcAttacker(attacker) ? party.filter((m) => m.character._id !== attacker.characterId) : party;
}

// ---------------------------------------------------------------- rebuilding a window

export type HitRow = Doc<"combatRequests"> & { payload: IncomingHitPayload };

export function isHitRow(row: Doc<"combatRequests">): row is HitRow {
  return row.kind === "incomingHit" && row.payload.kind === "incomingHit";
}

/**
 * The attacker as a creature (the card runner's trigger `source`): the instance, or a PC attacker's character (AA2b,
 * `instance` null); null when it is gone.
 */
export async function attackerCombatant(ctx: QueryCtx, row: { campaignId: Id<"campaigns">; payload: Pick<IncomingHitPayload, "attacker"> }, members: readonly PartyMember[]): Promise<{ instance: Doc<"encounterAdversaries"> | null; combatant: Combatant } | null> {
  const attacker = row.payload.attacker;
  if (isPcAttacker(attacker)) {
    const member = members.find((m) => m.character._id === attacker.characterId);
    return member ? { instance: null, combatant: pcCombatant(member.character._id, member.sheet) } : null;
  }
  const instance = await ctx.db.get("encounterAdversaries", attacker.instanceId);
  if (instance === null || instance.campaignId !== row.campaignId) return null;
  return {
    instance,
    combatant: {
      id: instance._id,
      side: "adversary",
      difficulty: instance.stats.difficulty,
      thresholds: { major: instance.stats.major, severe: instance.stats.severe },
      hp: instance.hp,
      hpMax: instance.stats.hpMax,
      stress: instance.stress,
      stressMax: instance.stats.stressMax,
      defeated: instance.defeated,
      ...(instance.resistance ? { resistance: { physical: instance.resistance.physical, magic: instance.resistance.magic } } : {}),
      conditions: instance.conditions,
      tags: instance.tags,
    },
  };
}

/** The responder's sheet with its card's resources topped up, so re-running a paid card for its folds can't refuse. */
function replayActor(member: PartyMember, cardId: string) {
  const s = member.sheet;
  const sheet: CharacterSheet = {
    ...s,
    hope: hopeMax(s.scars, s.hopeSlotBonus),
    stress: 0,
    hp: 0,
    armorMarked: 0,
    featureUses: s.featureUses.filter((u) => !u.key.startsWith(`card:${cardId}`)),
  };
  return cardActor(member.character._id, sheet, cardId, undefined);
}

/** Feature ids carry their source (`<source>:<owner>:<slug>`); card ids are plain slugs. */
export const isFeatureId = (id: string) => id.includes(":");

/** The stored choice id under which a feature answer keeps the held dice it spent (SD4: Prayer Dice values replay). */
export const SPENT_DICE = "spentDice";

/**
 * SD4: the responder topped up for re-running a paid feature answer for its folds (as `replayActor` for cards): Hope,
 * Favor and Focus full, tracks clear, the feature's own limit entries gone, and the held dice it spent (their values, kept
 * in the stored answer) back in hand, so Prayer Dice reduce by the same amount every time.
 */
export function featureReplayActor(member: PartyMember, featureId: string, choices: readonly CardChoice[]): ActorState {
  const s = member.sheet;
  const sheet: CharacterSheet = { ...s, hope: hopeMax(s.scars, s.hopeSlotBonus), stress: 0, hp: 0, armorMarked: 0, featureUses: s.featureUses.filter((u) => !u.key.startsWith(`feat:${featureId}`)) };
  const spent = choices.find((c) => c.id === SPENT_DICE);
  const held: HeldDieState[] = Array.isArray(spent?.value)
    ? spent.value.flatMap((text, i) => {
        const [kind, sides, value] = text.split(":");
        return kind && sides && value ? [{ id: `replay-${i}`, kind: kind as HeldDieState["kind"], sides: Number(sides), value: Number(value) }] : [];
      })
    : [];
  const actor = featureActor(member.character._id, sheet);
  return { ...actor, favor: 99, focus: 6, heldDice: [...held, ...(actor.heldDice ?? [])] };
}

/** The held dice a feature answer spent, as the stored `spentDice` choice (`kind:sides:value`). */
export function spentDiceChoice(plan: RunPlan): CardChoice | null {
  const after = new Set((plan.actor.after.heldDice ?? []).map((d) => d.id));
  const spent = (plan.actor.before.heldDice ?? []).filter((d) => !after.has(d.id) && d.value !== undefined);
  return spent.length > 0 ? { id: SPENT_DICE, value: spent.map((d) => `${d.kind}:${d.sides}:${d.value}`) } : null;
}

/** The feature answer's choices as the runner reads them (`useFeature`'s ids; the stored `spentDice` left out). */
export function featureChoices(list: readonly CardChoice[]) {
  const parsed = parseChoices(list.filter((c) => c.id !== SPENT_DICE));
  // DA8: an `optional:<id>` sent false turns a `defaultOn` step off (Draining Bane's "clear a Stress", dcm-bxp.99.19.15).
  return { choices: parsed.numbers, options: parsed.options, optionals: [...parsed.optionals], optionalsOff: [...parsed.declined], situations: parsed.situations };
}

/**
 * The adversary's attack roll of the hit's action (its GM row): never sent to players (Q14); the window compares it.
 * DA8 (DA1 follow-up 1): found by the roll's kind (`action`, the adversary attack's record), not by a d20 in it: a
 * Drained attacker's attack dice are d12s (HF p.14).
 */
export async function attackRollOf(ctx: QueryCtx, row: { campaignId: Id<"campaigns">; payload: { groupId: string } }): Promise<RollRecord | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.payload.groupId))
    .take(50);
  return rows.find((r) => r.visibility === "gm" && r.roll !== undefined && r.roll.kind === "action")?.roll ?? null;
}

/** The size of a stored attack roll's attack dice: 20, or 12 for a Drained attacker (HF p.14). */
export function attackDieSides(record: RollRecord): number {
  return record.dice.find((d) => d.role !== "damage")?.sides ?? 20;
}

/**
 * DA8: the attack roll again with the record's die size (a Drained attacker's d12s, HF p.14: "including for advantage or
 * disadvantage") and `advantage` / `disadvantage` sources (net, as `rollD20` counts them); critical only on a natural 20
 * of a d20 (CB p.148: "Whenever you roll a 20 on the d20").
 */
function rerollAttackDice(rng: Rng, sides: number, modifier: number, advantage: number, disadvantage: number): { total: number; critical: boolean } {
  if (sides === 20) {
    const { record, natural } = rollD20(rng, modifier, advantage, disadvantage);
    return { total: record.total, critical: natural === 20 };
  }
  const net = advantage - disadvantage;
  const first = rng(sides);
  const natural = net === 0 ? first : net > 0 ? Math.max(first, rng(sides)) : Math.min(first, rng(sides));
  return { total: natural + modifier, critical: false };
}

/**
 * SD4: the attacker's rerolls a feature answer forced (Not This Time, Danger Sense; CB p.107 "you always take the new
 * result"), rolled with dice seeded from the answer: the attack roll again with the same advantage or disadvantage
 * (`attackRoll`), or the standard attack's damage again (`damageRoll`, its critical kept). A reroll the server can't
 * make (no stored roll, a feature's damage) stays for the GM. DA8 (DA1 follow-ups 1, 2): the attack dice keep the
 * record's size (Drained d12s), and `own.disadvantage` (the hit's stored `attackDisadvantage`) adds the target's own
 * disadvantage to the reroll.
 */
export function resolveRerolls(folds: readonly Fold[], seed: string, attack: RollRecord | null, damage: { text: string; critical: boolean } | null, own: { disadvantage?: number } = {}): Fold[] {
  const rng = seededRng(seed);
  return folds.map((f): Fold => {
    if (f.kind === "rerollAttack" && attack) {
      const adv = attack.dice.some((d) => d.role === "advantage") ? 1 : 0;
      const dis = (attack.dice.some((d) => d.role === "disadvantage") ? 1 : 0) + Math.max(0, own.disadvantage ?? 0);
      return { kind: "attackRoll", ...rerollAttackDice(rng, attackDieSides(attack), attack.modifier, adv, dis) };
    }
    if (f.kind === "rerollDamage" && damage) {
      const parsed = parseDamage(damage.text);
      if (!parsed) return f;
      const record = rollDamage({ dice: parsed.dice ? [parsed.dice] : [], flat: parsed.modifier, critical: damage.critical, critBase: maxDamage(parsed.dice) }, rng);
      return { kind: "damageRoll", amount: record.total };
    }
    return f;
  });
}

export type Rebuilt = { state: WindowState; party: WindowPc[]; members: PartyMember[]; attacker: Awaited<ReturnType<typeof attackerCombatant>> };

/** The standard attack's damage text of an adversary hit (Not This Time's damage reroll); null for a feature or a PC. */
export async function standardDamageOf(ctx: QueryCtx, row: HitRow, attacker: Rebuilt["attacker"]): Promise<{ text: string; critical: boolean } | null> {
  if (isPcAttacker(row.payload.attacker) || row.payload.attacker.feature !== undefined || !attacker?.instance) return null;
  const block = await blockOf(ctx, attacker.instance);
  return block ? { text: block.attack.damage, critical: row.payload.critical } : null;
}

/**
 * The row's window now: opened with today's party and the stored responders, then every stored answer replayed. SD4:
 * the PCs carry their features; feature answers are re-run (dice seeded from the row and the answer's index, the
 * responder topped up) for their folds, and forced rerolls are rolled the same way; the attack roll comes from the
 * action's GM row when the caller has none (Evasion answers compare against it; never shown to players, Q14).
 */
export async function rebuildWindow(ctx: QueryCtx, row: HitRow, attackTotal?: number): Promise<Rebuilt> {
  const p = row.payload;
  const everyone = await partyMembers(ctx, row.campaignId);
  const members = [...respondingParty(everyone, p.attacker)];
  const bands = await bandsOnMap(ctx, row.mapId);
  const hopeAndFear = await hopeAndFearOf(ctx, row.campaignId);
  const toAttacker = await attackerBandsOnMap(ctx, row.mapId, p.attacker);
  const party = windowParty(members, p.targetCharacterId, bands, { hopeAndFear, toAttacker });
  const attacker = await attackerCombatant(ctx, row, everyone);
  const attackRoll = isPcAttacker(p.attacker) ? null : await attackRollOf(ctx, row);
  // DA8 (DA1 follow-up 2): the target's own total, stored with the hit, before the whole roll's.
  const total = attackTotal ?? p.attackTotal ?? attackRoll?.total;
  const hit = windowHitOf(p.attacker, { amount: p.damage, type: p.damageType, direct: p.direct, forcedArmor: p.forcedArmor ?? 0, critical: p.critical, ...(total !== undefined ? { attackTotal: total } : {}) }, p.riders ?? [], await armorCostOf(ctx, row));
  const responders = p.responders.map((r) => {
    const featureIds = r.cardIds.filter(isFeatureId);
    return { characterId: r.characterId, role: r.role, cardIds: r.cardIds.filter((id) => !isFeatureId(id)), ...(featureIds.length > 0 ? { featureIds } : {}) };
  });
  // The stored responders stand (no eligibility re-run); only the armor capacity is read from today's party.
  const opened = openWindow({ hit, targetId: p.targetCharacterId, party: party.map((x) => ({ ...x, features: [], cards: [] })) });
  let state: WindowState = { ...opened, party, responders, ...(attacker ? { attacker: attacker.combatant } : {}) };
  let damage: { text: string; critical: boolean } | null | undefined;
  for (const [i, answer] of row.responses.entries()) {
    let folds: Fold[] | undefined;
    const member = members.find((m) => m.character._id === answer.characterId);
    const target = members.find((m) => m.character._id === state.targetId);
    const creatures = target ? { target: pcCombatant(target.character._id, target.sheet), ...(attacker ? { attacker: attacker.combatant } : {}) } : null;
    if (answer.choice.kind === "card") {
      const card = cardEffect(answer.choice.cardId);
      if (card && member && creatures) {
        const actor = replayActor(member, card.cardId);
        folds = runReactionCard(card, actor, state, creatures, seededRng(`${row._id}:${i}`), answer.choice.useId).folds;
      }
    } else if (answer.choice.kind === "feature") {
      const choice = answer.choice;
      const effect = party.find((x) => x.id === answer.characterId)?.features?.find((f) => f.featureId === choice.featureId);
      const defense = party.find((x) => x.id === state.targetId);
      if (effect && member && creatures && defense) {
        const actor = featureReplayActor(member, effect.featureId, choice.choices);
        const amount = progressAmount(state, defense);
        const ran = runReactionFeature(effect, actor, state, creatures, seededRng(`${row._id}:${i}`), { ...(choice.useId ? { useId: choice.useId } : {}), amount, ...featureChoices(choice.choices) });
        if (ran.folds.some((f) => f.kind === "rerollDamage") && damage === undefined) damage = await standardDamageOf(ctx, row, attacker);
        folds = resolveRerolls(ran.folds, `${row._id}:${i}:reroll`, attackRoll, damage ?? null, { disadvantage: p.attackDisadvantage ?? 0 });
      }
    }
    const next = windowRespond(state, { characterId: answer.characterId, choice: answer.choice, ...(folds ? { folds } : {}) }, { replay: true });
    if (next.ok) state = next.state;
  }
  return { state, party, members, attacker };
}

/** The damage the window's answers so far left (the trigger amount of the next feature answer). */
export function progressAmount(state: WindowState, target: WindowPc): number {
  return progressOf(state, target).amount;
}

export function cardRefusal(r: RunRefusal) {
  switch (r.reason) {
    case "exhausted":
      return appError("CARD_EXHAUSTED", r.detail);
    case "cost":
      return appError("CARD_COST_UNPAID", `Short of: ${r.detail}.`);
    case "targets":
      return appError("COMBAT_TARGET_INVALID", r.detail);
    default:
      return appError("INVALID", r.detail);
  }
}

/** The responder's sheet after paying a reaction card: resources, its once-per entry, tokens, effects, the vault (CB p.101). */
export function sheetAfterCard(sheet: CharacterSheet, plan: RunPlan, who: string, cardName: string): CharacterSheet {
  const after = plan.actor.after;
  const base = writeSheetChanges(sheet, plan.steps, who, plan.cardId, cardName, plan.exclusive, true);
  const others = (sheet.cardTokens ?? []).filter((t) => t.cardId !== plan.cardId);
  const cardTokens = after.cardTokens > 0 ? [...others, { cardId: plan.cardId, count: Math.min(99, after.cardTokens) }] : others;
  const toVault = plan.steps.some((s: PlanStep) => s.kind === "toVault");
  return {
    ...base,
    hope: after.hope,
    stress: Math.min(sheet.stressMax, after.stress),
    hp: Math.min(sheet.hpMax, after.hp),
    armorMarked: Math.max(0, after.armor),
    featureUses: plan.actor.featureUses.slice(-40),
    cardTokens,
    ...(toVault ? { domainCards: { ...sheet.domainCards, loadout: sheet.domainCards.loadout.filter((c) => c !== plan.cardId) } } : {}),
  };
}

// ---------------------------------------------------------------- riders and after-hit uses (AA2b)

const EFFECT_ID = /^(.*):(\d+)$/;

/** An effect id not on the sheet yet (a rider's effect keeps its id unless the target already has it). */
function freeEffectId(effects: readonly { id: string }[], id: string): string {
  if (!effects.some((e) => e.id === id)) return id;
  const base = EFFECT_ID.exec(id)?.[1] ?? id.slice(0, 36);
  for (let n = 1; n < 100; n++) {
    const next = `${base}:${n}`.slice(-40);
    if (!effects.some((e) => e.id === next)) return next;
  }
  return id;
}

/**
 * The riders on the sheet of whoever took the hit (user answer 2026-10-22: the rider moves with the damage): conditions,
 * effects (the sheet keeps at most 20), Hope, Stress (a full track marks HP instead, CB p.92), forced HP. Bold Presence's
 * fold (`skipConditions`) keeps conditions and card tags off. DA8 (`ignoreHp`, Dark Aegis, user answer 2026-10-29: "any
 * extra 'mark HP' from them is also ignored"): forced HP riders are skipped and a Stress past a full track marks no HP.
 */
export function applyRiders(sheet: CharacterSheet, riders: readonly HitRider[], skipConditions: boolean, ignoreHp = false): { sheet: CharacterSheet; applied: number } {
  let next = sheet;
  let applied = 0;
  for (const r of riders) {
    if (skipConditions && isConditionRider(r)) continue;
    if (ignoreHp && r.kind === "hp") continue;
    applied++;
    switch (r.kind) {
      case "condition":
        if (!next.conditions.includes(r.condition)) next = { ...next, conditions: [...next.conditions, r.condition] };
        break;
      case "effect":
        next = { ...next, effects: [...next.effects, { ...r.effect, id: freeEffectId(next.effects, r.effect.id) }].slice(-20) };
        break;
      case "hope":
        next = { ...next, hope: Math.max(0, Math.min(hopeMax(next.scars, next.hopeSlotBonus), next.hope + r.delta)) };
        break;
      case "stress": {
        const marked = applyStressTo(pcCombatant("rider", next), r.amount).after;
        next = { ...next, stress: Math.min(next.stressMax, marked.stress), hp: ignoreHp ? next.hp : Math.min(next.hpMax, marked.hp) };
        break;
      }
      case "hp":
        next = { ...next, hp: Math.min(next.hpMax, next.hp + Math.max(0, Math.trunc(r.amount))) };
        break;
    }
  }
  return { sheet: next, applied };
}

/** Runs one of the hit PC's after-hit card uses with the hit as its trigger (dice seeded from the row: no fishing). */
export function runAfterHitCard(member: PartyMember, sheet: CharacterSheet, cardId: string, useId: string | undefined, trigger: { amount: number; source?: Combatant }, seed: string): { plan: RunPlan; cardName: string } | RunRefusal {
  const card = cardEffect(cardId);
  if (!card) return { ok: false, reason: "noUse", detail: cardId };
  const actor = cardActor(member.character._id, sheet, cardId, undefined);
  const reactionUse = useId ?? card.uses.find((u) => u.activation.kind === "reaction")?.id;
  const result = runCardUse(card, { actor, gmFear: 0, ...(reactionUse ? { useId: reactionUse } : {}), trigger: { amount: trigger.amount, subject: pcCombatant(member.character._id, sheet), ...(trigger.source ? { source: trigger.source } : {}) }, rng: seededRng(seed) });
  if (!result.ok) return result;
  return { plan: result.plan, cardName: getDomainCard(cardId)?.name ?? cardId };
}