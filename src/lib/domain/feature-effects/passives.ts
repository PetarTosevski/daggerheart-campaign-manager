// Passive feature modifiers (plan sheet-drawer, tracer SD2; analysis section 5.1). Pure: `passiveMods` sums the `passive`
// uses of every feature a sheet holds (`owned`, SD1: class, subclass rank, multiclass, ancestry, community, transformation,
// Beastform, stances) from the effect tables (src/lib/srd/feature-effects), with upgrades applied and `requires` checked,
// so derived stats and the adversary attack roll read the tables instead of a hand-kept list.
// DA9 (B1, user 2026-10-29, dcm-bxp.99.19.19): a Beastform's statistics line (the `form` use of `beastform:<form>:attack`)
// and Evolved's per-base use are summed too, trait bonuses in `traits` (`derivedTraits`); an older sheet whose Beastform
// effect still carries the form's mods is not counted twice (`legacyBeastformMods`).
//
// Book texts the tests take their numbers from (printed pages, CB = Core Book, HF = Hope & Fear):
// - CB p.36, Unwavering / Unrelenting / Undaunted: "Gain a permanent +1 / +2 / +3 bonus to your damage thresholds."
// - CB p.61, Shell: "Gain a bonus to your damage thresholds equal to your Proficiency."
// - CB p.70, Nimble: "Gain a permanent +1 bonus to your Evasion at character creation."
// - HF p.21, Stoneskin: "Gain a permanent +1 bonus to your Armor Score and damage thresholds at character creation."
// - CB p.51, Conjure Shield: "While you have at least 2 Hope, you add your Proficiency to your Evasion."
// - CB p.48, Rise to the Challenge: "While you have 2 or fewer Hit Points unmarked, you can roll a d20 as your Hope Die."
//   (a `rollOptions` toggle). CB p.30, Elemental Dominion: "While Channeling … Fire: +1 bonus to your Proficiency …
//   Air: +1 bonus to your Evasion". Combat Training (CB p.48) stays D5's auto roll option `combatTraining`.
// - CB p.68, Sturdy: "When you have 1 Hit Point remaining, attacks against you have disadvantage."
// - CB p.39, Elusive Predator: "When your Focus makes an attack against you, you gain a +2 bonus to your Evasion against
//   the attack."  HF p.8, Scorpion's Poise: "+2 bonus to your Evasion against attacks made by a creature you've Marked for
//   Death."  CB p.38, Battle-Bonded: "When an adversary attacks you while they're within your companion's Melee range, you
//   gain a +2 bonus to your Evasion against the attack."  HF p.16, Vexing Malison: "You have advantage on attacks against
//   Hexed creatures."
//
// Plan lanes-2, E5 (docs/tasks/TASK-LN2-E5.md):
// - dcm-eut: a `disadvantageAgainst` mod with `from`, `buyOff` or `situation` is not summed into the always-on list
//   (`disadvantageAgainst`); it is kept in `guarded` and `versusMods` counts it against one attacker: `from` by the
//   attacker's `distance`, `situation` by what the GM confirmed, `buyOff` offered to the attacker (`VersusTotals.buyOff`)
//   and dropped once paid (`CreatureInfo.paidOff`). HF p.12, Defensive stance: "Attack rolls targeting you from within
//   Melee range have disadvantage unless the attacker marks a Stress to negate the disadvantage."
// - dcm-cqwm: the `passive` uses of every feature are read, whatever the feature's usage (Feed, HF p.39, is a combat
//   feature whose "While there are no tokens on this card, you make action and reaction rolls with disadvantage" is a
//   passive use). Before-roll toggles (`rollOptions`) stay with passive features.
//
// ```ts
// passiveMods(galapaGuardian).majorThreshold;                    // Shell: + Proficiency
// versusMods(sheet, "attacksByThem", { tags: ["Marked for Death"] }).evasion;   // Scorpion's Poise: 2
// ```

import { activeBeastformId, holdingsFor, isStatLine, owned, type OwnedFeature, type OwnedScope, type OwnedSheet } from "./owned";
import { featureEffect } from "../../srd/feature-effects/index";
import { FEATURE_CLASSIFICATION } from "../../srd/feature-effects/classification";
import { requirementMet, type RequirementState, type StateFacts } from "../card-effects/availability";
import type { CardUse, Cost, CreatureKey, Mod, NumberSource, RollFilter, Versus } from "../card-effects/types";
import { RANGE_SQUARES } from "../combat-map/ranges";
import type { CharacterSheet } from "../../validation/characters";
import { TRAIT_IDS, type TraitId } from "../../srd/types";
import { applyUpgrades } from "./upgrades";
import { FEATURE_KEY_PREFIX } from "./ids";
import { slotsFromMods, type SlotCounts } from "../characters/slots";

/** The sheet fields passives read. Every one is optional: a partial sheet holds what it names (derived-stat tests pass `{ level, subclassId }`). */
export type PassiveSheet = Partial<OwnedSheet> &
  Partial<Pick<CharacterSheet, "proficiency" | "hope" | "hp" | "hpMax" | "stress" | "stressMax" | "armorId" | "conditions" | "armorMarked" | "cardTokens">>;

/** The state a passive's `requires` reads; every field defaults from the sheet. */
export interface PassiveState {
  hope?: number;
  hp?: number;
  hpMax?: number;
  stress?: number;
  stressMax?: number;
  armor?: number;
  facts?: StateFacts;
}

/** The numeric stats a passive moves (the `ModStat`s derived stats and rolls read). */
export interface StatTotals {
  evasion: number;
  armorScore: number;
  majorThreshold: number;
  severeThreshold: number;
  proficiency: number;
  attack: number;
  damage: number;
  actionRoll: number;
}

/** What a sheet's passive features add up to right now. */
export interface PassiveMods extends StatTotals {
  /** Trait bonuses (DA9: a Beastform's statistics and Evolved bonus, CB p.30-35); `derivedTraits` adds them. */
  traits: Partial<Record<TraitId, number>>;
  /** Rolls that always have advantage (a `versus`-free `advantage` mod). */
  advantage: RollFilter[];
  /** Rolls against the bearer that always have disadvantage (Sturdy at 1 HP left). */
  disadvantageAgainst: RollFilter[];
  /**
   * Plan lanes-2, E5 (dcm-eut): disadvantage on rolls against the bearer that holds only for some attackers (`from`), on
   * the GM's word (`situation`) or until the attacker pays (`buyOff`); `versusMods` decides them per attacker.
   */
  guarded: GuardedDisadvantage[];
  /** The rules switches on (`flying`, `cannotBeMoved`, ...). */
  flags: string[];
  /** The `versus` mods, kept for `versusMods`. */
  versus: VersusMod[];
  /** Feature ids that contributed, for the drawer. */
  sources: string[];
  /**
   * Before-roll toggles of passive features whose condition holds now ("you can roll a d20 as your Hope Die", Rise to the
   * Challenge, CB p.48): offered on the roll, not summed. Combat Training's + level damage is not here: it stays D5's
   * auto roll option `combatTraining`.
   */
  rollOptions: { featureId: string; useId: string; name: string }[];
  /**
   * Plan lanes, E5 (dcm-u6z, dcm-fjh): Hit Point and Stress slots the passives' `hpMax` / `stressMax` mods name (At Ease,
   * CB p.36: "Gain an additional Stress slot"). Not added to any total: a maximum is raised once, when the feature is
   * gained, by characters/slots.ts (`gainSlots` under the feature's key), so the derived stats never count it twice.
   */
  slots: SlotCounts;
}

/** A `disadvantageAgainst` mod's gates (dcm-eut): only attackers in / beyond Melee, only when confirmed, unless paid. */
export interface DisadvantageGates {
  from?: "melee" | "beyondMelee";
  buyOff?: readonly Cost[];
  situation?: string;
}

export interface VersusMod {
  featureId: string;
  versus: Versus;
  mod: { kind: "stat"; stat: "evasion"; delta: number } | { kind: "advantage"; on: RollFilter } | ({ kind: "disadvantageAgainst"; on: RollFilter } & DisadvantageGates);
}

/** An unkeyed `disadvantageAgainst` mod with gates (dcm-eut). */
export interface GuardedDisadvantage extends DisadvantageGates {
  featureId: string;
  on: RollFilter;
}

/**
 * A creature as a `versus` key reads it: its condition tags, whether it is Hexed, whether it is within the bearer's companion's Melee range.
 * Plan lanes-2, E5 (dcm-eut), for gated disadvantage (each optional):
 * - `distance`: squares between the attacker and the bearer (absent: not known, so a `from` gate does not count).
 * - `situations`: the situation texts the GM confirmed for this attack.
 * - `paidOff`: feature ids whose `buyOff` the attacker paid for this attack (the attacker's pay prompt, lane E7).
 */
export interface CreatureInfo {
  tags?: readonly string[];
  hexed?: boolean;
  inCompanionReach?: boolean;
  distance?: number;
  situations?: readonly string[];
  paidOff?: readonly string[];
}

const EMPTY_STATS: StatTotals = { evasion: 0, armorScore: 0, majorThreshold: 0, severeThreshold: 0, proficiency: 0, attack: 0, damage: 0, actionRoll: 0 };
const STAT_KEYS = new Set(Object.keys(EMPTY_STATS));

// ---------------------------------------------------------------- sheet facts

/** FNV-1a (32 bit) in base 36. Must match `shortHash` in convex/lib/cardRunner.ts (a test pins it). */
export function effectHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

let featureByHash: ReadonlyMap<string, string> | undefined;

/** Feature id by its effect-id prefix (`feat:<hash>`), built on first use (dcm-uh6r: not hashed at every module load). */
function featureOfHash(key: string): string | undefined {
  featureByHash ??= new Map(Object.keys(FEATURE_CLASSIFICATION).map((id) => [`feat:${effectHash(id)}`, id]));
  return featureByHash.get(key);
}
const OPTION_PREFIX = "option: ";
const FLYING_EFFECT_ID = "flying";

/** The facts the sheet itself holds (as `factsOf` in convex/lib/featureRunner.ts reads them): conditions, tags, flying, feature effects, Beastform, stance. */
export function sheetFacts(sheet: PassiveSheet): StateFacts {
  const effects = sheet.effects ?? [];
  return {
    conditions: sheet.conditions ?? [],
    tags: effects.map((e) => e.text.split("; ")[0] ?? ""),
    flying: effects.some((e) => e.id === FLYING_EFFECT_ID),
    featureEffects: effects.flatMap((e) => {
      const m = /^(feat:[a-z0-9]+):\d+$/.exec(e.id);
      const featureId = m ? featureOfHash(m[1]!) : undefined;
      const option = e.text.split("; ").find((part) => part.startsWith(OPTION_PREFIX))?.slice(OPTION_PREFIX.length);
      return featureId === undefined ? [] : [{ featureId, ...(option !== undefined ? { option } : {}) }];
    }),
    beastformId: effects.length > 0 ? activeBeastformId({ effects }) : null,
    activeStance: sheet.classState?.martial?.active ?? null,
  };
}

function requirementState(sheet: PassiveSheet, state: PassiveState): RequirementState {
  const hp = state.hp ?? sheet.hp ?? 0;
  const stress = state.stress ?? sheet.stress ?? 0;
  return {
    hp,
    hpMax: state.hpMax ?? sheet.hpMax ?? Math.max(hp, 6),
    stress,
    stressMax: state.stressMax ?? sheet.stressMax ?? Math.max(stress, 6),
    armor: state.armor ?? sheet.armorMarked ?? 0,
    hope: state.hope ?? sheet.hope ?? 0,
    armorWorn: sheet.armorId !== undefined && sheet.armorId !== "",
    loadoutDomains: [],
    activeCardEffects: [],
    situations: [],
    facts: { ...sheetFacts(sheet), ...state.facts },
  };
}

// ---------------------------------------------------------------- numbers

/** A passive's amount: the sources a passive can use without a roll (fixed, Proficiency, level, sums and arithmetic). */
export function passiveAmount(source: NumberSource, sheet: { proficiency?: number; level?: number }): number {
  switch (source.kind) {
    case "fixed":
      return source.value;
    case "proficiency":
      return sheet.proficiency ?? 0;
    case "level":
      return sheet.level ?? 1;
    case "sum":
      return source.of.reduce((s, n) => s + passiveAmount(n, sheet), 0);
    case "product":
      return source.of.reduce((p, n) => p * passiveAmount(n, sheet), 1);
    case "max":
      return Math.max(...source.of.map((n) => passiveAmount(n, sheet)));
    case "calc": {
      let value = passiveAmount(source.of, sheet);
      if (source.times !== undefined) value *= source.times;
      if (source.divide !== undefined) value = (source.round === "up" ? Math.ceil : Math.floor)(value / source.divide);
      if (source.plus !== undefined) value += source.plus;
      if (source.min !== undefined) value = Math.max(value, source.min);
      if (source.max !== undefined) value = Math.min(value, passiveAmount(source.max, sheet));
      return value;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------- the sum

/**
 * The uses of the passive features a sheet holds that are on now (upgrades applied, `requires` met). By default the
 * `passive` uses; `kind: "rider"` gives the before-roll toggles of passive features instead (Rise to the Challenge).
 */
export function activePassives(
  sheet: PassiveSheet,
  state: PassiveState = {},
  scope: OwnedScope = {},
  kind: "passive" | "rider" = "passive",
): { feature: OwnedFeature; use: CardUse }[] {
  // A partial sheet holds what it names; a missing rank is the foundation card (as the derived stats always read it).
  const full = {
    level: 1,
    ancestry: { kind: "single", id: "" },
    communityId: "",
    effects: [],
    classState: {},
    ...sheet,
    subclassRank: sheet.subclassRank ?? "foundation",
  } as unknown as OwnedSheet & { level: number };
  const held = owned(full, scope);
  const req = requirementState(sheet, state);
  const out: { feature: OwnedFeature; use: CardUse }[] = [];
  for (const feature of held) {
    // DA9 (B1): a Beastform's attack and statistics line is a combat entry whose passive `form` use is the form's
    // statistics (CB p.30: "add their Evasion bonus to your Evasion, and use the trait specified"); its riders are the
    // drawer's, not roll options.
    // Plan lanes-2, E5 (dcm-cqwm): a passive use counts on any feature (the use's activation decides; Feed is a combat
    // feature with a passive use); before-roll toggles stay with passive features.
    if (kind === "rider" && feature.usage !== "passive") continue;
    const entry = featureEffect(feature.featureId);
    if (entry === undefined) continue;
    const upgraded = applyUpgrades(entry, holdingsFor({ subclassId: full.subclassId ?? "", subclassRank: full.subclassRank, level: full.level }, held, entry.owner));
    for (const use of upgraded.uses) {
      if (feature.uses && !feature.uses.includes(use.id)) continue;
      if (use.activation.kind !== kind) continue;
      if (use.activation.kind === "rider" && use.activation.trigger.kind !== "beforeYouRoll") continue;
      // Plan lanes, E5 (dcm-2g9): a `tokens` check without a name reads this feature's own tokens (Feed, HF p.39: "While
      // there are no tokens on this card"); a sheet without an entry holds none.
      const tokens = sheet.cardTokens?.find((t) => t.cardId === `${FEATURE_KEY_PREFIX}${feature.featureId}`)?.count ?? 0;
      const own = { ...req, facts: { ...req.facts, cardTokens: tokens } };
      if (!(use.requires ?? []).every((r) => requirementMet(r, own))) continue;
      out.push({ feature, use });
    }
  }
  return out;
}

const matches = (key: CreatureKey, creature: CreatureInfo): boolean => {
  switch (key.kind) {
    case "tagged":
      return creature.tags?.includes(key.tag) ?? false;
    case "hexed":
      return creature.hexed === true || (creature.tags?.includes("Hexed") ?? false);
    case "inCompanionReach":
      return creature.inCompanionReach === true;
    case "damagedAlly":
      return false;
  }
};

/**
 * Sums the passive entries a sheet holds. `only` narrows the features (the Subclass line of the Hit Points section).
 * `versus` mods are not in the totals: they hold against one creature (`versusMods`).
 */
export function passiveMods(sheet: PassiveSheet, state: PassiveState = {}, scope: OwnedScope = {}, only?: (feature: OwnedFeature) => boolean): PassiveMods {
  const totals: StatTotals = { ...EMPTY_STATS };
  const result: PassiveMods = { ...totals, traits: {}, advantage: [], disadvantageAgainst: [], guarded: [], flags: [], versus: [], sources: [], rollOptions: [], slots: { hp: 0, stress: 0 } };
  const amountSheet = { proficiency: sheet.proficiency, level: sheet.level };
  const legacy = legacyBeastformMods(sheet);
  for (const { feature, use } of activePassives(sheet, state, scope)) {
    if (only && !only(feature)) continue;
    let contributed = false;
    for (const mod of use.mods ?? []) {
      // An older sheet's Beastform effect still carries the form's trait and Evasion (`withEffects` adds them): the
      // stat line does not add them a second time (B1, dcm-bxp.99.19.19).
      if (legacy && isStatLine(feature) && use.id === "form" && (mod.kind === "trait" || (mod.kind === "stat" && mod.stat === "evasion"))) continue;
      contributed = apply(result, feature.featureId, mod, amountSheet) || contributed;
    }
    if (contributed && !result.sources.includes(feature.featureId)) result.sources.push(feature.featureId);
  }
  for (const { feature, use } of activePassives(sheet, state, scope, "rider")) {
    if (only && !only(feature)) continue;
    result.rollOptions.push({ featureId: feature.featureId, useId: use.id, name: use.name });
  }
  return result;
}

/**
 * Whether the sheet's `beastform` effect still carries the form's mods (written by D5 before DA9 / B1): `withEffects`
 * adds those, so the stat line's trait and Evasion are skipped for it.
 */
export function legacyBeastformMods(sheet: Pick<PassiveSheet, "effects">): boolean {
  const mods = sheet.effects?.find((e) => e.id === "beastform")?.mods;
  return mods !== undefined && (mods.evasion !== undefined || mods.trait !== undefined);
}

function apply(result: PassiveMods, featureId: string, mod: Mod, sheet: { proficiency?: number; level?: number }): boolean {
  switch (mod.kind) {
    case "stat": {
      const delta = passiveAmount(mod.delta, sheet);
      if (mod.versus) {
        if (mod.stat === "evasion") result.versus.push({ featureId, versus: mod.versus, mod: { kind: "stat", stat: "evasion", delta } });
        return true;
      }
      if (mod.stat === "hpMax" || mod.stat === "stressMax") {
        const slots = slotsFromMods([mod]);
        result.slots.hp += slots.hp;
        result.slots.stress += slots.stress;
        return slots.hp !== 0 || slots.stress !== 0;
      }
      if (!STAT_KEYS.has(mod.stat)) return false;
      result[mod.stat as keyof StatTotals] += delta;
      return true;
    }
    case "trait": {
      // DA9: a Beastform's "Agility +1" (CB p.32) and Evolved's "+1 bonus to the trait used by this form" (CB p.34).
      const delta = passiveAmount(mod.delta, sheet);
      for (const t of mod.trait === "all" ? TRAIT_IDS : [mod.trait]) result.traits[t] = (result.traits[t] ?? 0) + delta;
      return true;
    }
    case "advantage":
      if (mod.versus) result.versus.push({ featureId, versus: mod.versus, mod: { kind: "advantage", on: mod.on } });
      else result.advantage.push(mod.on);
      return true;
    case "disadvantageAgainst": {
      const gates: DisadvantageGates = {
        ...(mod.from !== undefined ? { from: mod.from } : {}),
        ...(mod.buyOff !== undefined ? { buyOff: mod.buyOff } : {}),
        ...(mod.situation !== undefined ? { situation: mod.situation } : {}),
      };
      if (mod.versus) result.versus.push({ featureId, versus: mod.versus, mod: { kind: "disadvantageAgainst", on: mod.on, ...gates } });
      else if (Object.keys(gates).length > 0) result.guarded.push({ featureId, on: mod.on, ...gates });
      else result.disadvantageAgainst.push(mod.on);
      return true;
    }
    case "flag":
      result.flags.push(mod.flag);
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- against one creature

/** What the passives add on one side of an attack against a particular creature (NV9). */
export interface VersusTotals {
  evasion: number;
  advantage: number;
  disadvantage: number;
  /**
   * Plan lanes-2, E5 (dcm-eut): the disadvantages counted in `disadvantage` that the attacker may pay to drop (Defensive
   * stance, HF p.12: "unless the attacker marks a Stress"). The attacker's pay prompt (lane E7) offers each; a paid one is
   * passed back in `CreatureInfo.paidOff` and no longer counts. Absent when there is none.
   */
  buyOff?: { featureId: string; costs: readonly Cost[] }[];
}

/**
 * Plan lanes-2, E5 (dcm-eut): whether a gated disadvantage counts against `creature`: `from` by its distance (unknown:
 * not counted), `situation` when confirmed, `buyOff` unless paid.
 */
export function gateHolds(gates: DisadvantageGates & { featureId: string }, creature: CreatureInfo): boolean {
  if (gates.from !== undefined) {
    if (creature.distance === undefined) return false;
    const inMelee = creature.distance <= RANGE_SQUARES.melee;
    if ((gates.from === "melee") !== inMelee) return false;
  }
  if (gates.situation !== undefined && !(creature.situations ?? []).includes(gates.situation)) return false;
  return !(gates.buyOff !== undefined && (creature.paidOff ?? []).includes(gates.featureId));
}

const attackRoll = (on: RollFilter) => on === "any" || on === "attack" || on === "weaponAttack" || on === "action";

/**
 * The passives that hold against `creature` on one side: `attacksByThem` is the creature attacking the bearer (Elusive
 * Predator, Scorpion's Poise, Battle-Bonded: Evasion; Sturdy: disadvantage, which has no `versus`), `attacksAgainstThem` the
 * bearer attacking the creature (Vexing Malison: advantage). Unkeyed advantage / disadvantage mods count on the matching side.
 */
export function versusMods(sheet: PassiveSheet, side: "attacksByThem" | "attacksAgainstThem", creature: CreatureInfo, state: PassiveState = {}, scope: OwnedScope = {}): VersusTotals {
  const mods = passiveMods(sheet, state, scope);
  const total: VersusTotals = { evasion: 0, advantage: 0, disadvantage: 0 };
  const disadvantage = (g: DisadvantageGates & { featureId: string; on: RollFilter }) => {
    if (!attackRoll(g.on) || !gateHolds(g, creature)) return;
    total.disadvantage += 1;
    if (g.buyOff !== undefined) (total.buyOff ??= []).push({ featureId: g.featureId, costs: g.buyOff });
  };
  if (side === "attacksByThem") {
    total.disadvantage += mods.disadvantageAgainst.filter(attackRoll).length;
    for (const g of mods.guarded) disadvantage(g);
  } else total.advantage += mods.advantage.filter(attackRoll).length;
  for (const v of mods.versus) {
    if (v.versus.on !== side || !matches(v.versus.creature, creature)) continue;
    if (v.mod.kind === "stat") total.evasion += v.mod.delta;
    else if (v.mod.kind === "advantage" && attackRoll(v.mod.on)) total.advantage += 1;
    else if (v.mod.kind === "disadvantageAgainst") disadvantage({ featureId: v.featureId, ...v.mod });
  }
  return total;
}
