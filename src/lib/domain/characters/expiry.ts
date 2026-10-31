// Expiry of temporary sheet state (D5 T0). Pure module: bundled into Convex.
//
// Contract: every temporary thing on a sheet (an effect, a held die, a used
// feature) carries `until`, and `expire(sheet, event)` is the ONE place that
// removes it. Rests (T3), session start/end (T5), the GM's End scene (RF1;
// CB 107: the GM decides when a scene has played out) and "Got hit" (T8a) call it;
// no class-specific code is needed. What each event ends:
//
// | event       | effects                 | heldDice   | featureUses       |
// |-------------|-------------------------|------------|-------------------|
// | shortRest   | rest                    | -          | rest              |
// | longRest    | rest, longRest          | longRest   | rest, longRest    |
// | session     | session, scene          | session    | session, scene    |
// | scene       | scene                   | -          | scene             |
// | hit         | hit                     | -          | -                 |
// | gmTurn      | -                       | -          | gmTurn            |
// | day         | -                       | -          | gmTurn, day       |
// | week        | -                       | -          | gmTurn, day, week |
//
// Plan lanes-2 E6 (dcm-55k): a `gmTurn` / `day` / `week` limit (availability.ts `limitPeriod`) is stored in featureUses
// and ends here: `gmTurn` when the GM's turn ends (and with any scene, session or rest end: a GM turn never outlasts
// them), `day` and `week` as campaign time passes (the caller fires them; frames without a calendar never do, E5 Q1).
//
// A scene end (the encounter ends, the GM's End scene, or the session ends; sheet-drawer Q7, CB 107) also drops what
// the book ties to the scene outside those lists: the Guardian's Unstoppable Die (CB 36: "until the end of the scene")
// and the Martial Artist's active stance (HF 12: "you drop out of your active stance at the end of the scene"). Focus
// and known stances stay. Rests leave both alone, as before. It also clears the tokens of Walk Between Worlds (Hedge
// specialization, HF p.16: "When the last token is removed or at the end of the scene, you return to the Mortal Realm").
//
// A long rest refreshes "rest" features too (CB 105: rest features refresh on
// any rest). `manual` effects and dice end only through their End button.
//
// ```ts
// const rested = expire(sheet, "longRest");    // Rogue's Dodge (`hit`) stays, No Mercy (`rest`) goes
// await saveSheet(ctx, characterId, rested);
// ```

import type { Cost, Duration, EndEvent, Maintain, NumberSource, RollEnd, RollFilter, RollResult } from "../card-effects/types";
import { featureKey } from "../feature-effects/ids";
import type { TraitId } from "../../srd/types";
import type { CardTokens, ClassState, Effect, FeatureUse, HeldDie } from "../../validation/characters";

export type ExpiryEvent = "shortRest" | "longRest" | "session" | "scene" | "hit" | "gmTurn" | "day" | "week";

const EFFECTS: Record<ExpiryEvent, readonly Effect["until"][]> = {
  shortRest: ["rest"],
  longRest: ["rest", "longRest"],
  session: ["session", "scene"],
  scene: ["scene"],
  hit: ["hit"],
  gmTurn: [],
  day: [],
  week: [],
};
const HELD_DICE: Record<ExpiryEvent, readonly HeldDie["until"][]> = {
  shortRest: [],
  longRest: ["longRest"],
  session: ["session"],
  scene: [],
  hit: [],
  gmTurn: [],
  day: [],
  week: [],
};
const FEATURE_USES: Record<ExpiryEvent, readonly FeatureUse["until"][]> = {
  shortRest: ["rest", "gmTurn"],
  longRest: ["rest", "longRest", "gmTurn"],
  session: ["session", "scene", "gmTurn"],
  scene: ["scene", "gmTurn"],
  hit: [],
  gmTurn: ["gmTurn"],
  day: ["gmTurn", "day"],
  week: ["gmTurn", "day", "week"],
};
const ENDS_SCENE: Record<ExpiryEvent, boolean> = { shortRest: false, longRest: false, session: true, scene: true, hit: false, gmTurn: false, day: false, week: false };

/** The featureUses periods some `expire` event ends (all of them since dcm-55k): a limit may store any of these. */
export const EXPIRING_FEATURE_USES: readonly FeatureUse["until"][] = [...new Set(Object.values(FEATURE_USES).flat())];

/** Feature tokens (`cardTokens` keys) that end with the scene: Walk Between Worlds (HF p.16). */
export const SCENE_TOKEN_KEYS: readonly string[] = [featureKey("subclass:hedge:walk-between-worlds")];

type Expirable = {
  effects?: readonly Effect[];
  heldDice?: readonly HeldDie[];
  featureUses?: readonly FeatureUse[];
  classState?: ClassState;
  cardTokens?: readonly CardTokens[];
};

/** The class state without what a scene end drops (Unstoppable Die, active stance); the same object when nothing goes. */
function afterScene(state: ClassState | undefined): ClassState | undefined {
  if (state === undefined) return state;
  const dropsStance = state.martial?.active !== undefined;
  if (state.unstoppable === undefined && !dropsStance) return state;
  const { unstoppable: _die, martial, ...rest } = state;
  void _die;
  if (!martial) return rest;
  const { active: _active, ...kept } = martial;
  void _active;
  return { ...rest, martial: kept };
}

/** The sheet without the effects, held dice and feature uses that `event` ends. Other fields are untouched. */
export function expire<T extends Expirable>(sheet: T, event: ExpiryEvent): T {
  const classState = ENDS_SCENE[event] ? afterScene(sheet.classState) : sheet.classState;
  const tokens = sheet.cardTokens;
  const dropsTokens = ENDS_SCENE[event] && tokens !== undefined && tokens.some((t) => SCENE_TOKEN_KEYS.includes(t.cardId));
  return {
    ...sheet,
    ...(classState !== sheet.classState && classState !== undefined ? { classState } : {}),
    ...(dropsTokens ? { cardTokens: tokens.filter((t) => !SCENE_TOKEN_KEYS.includes(t.cardId)) } : {}),
    effects: (sheet.effects ?? []).filter((e) => !EFFECTS[event].includes(e.until)),
    heldDice: (sheet.heldDice ?? []).filter((d) => !HELD_DICE[event].includes(d.until)),
    featureUses: (sheet.featureUses ?? []).filter((u) => !FEATURE_USES[event].includes(u.until)),
  };
}

// ---------------------------------------------------------------- end events (plan lanes, tracer E6)
//
// Besides its `until`, a lasting effect or condition ends on EVENTS (card-effects/types.ts `EndEvent`, `RollEnd`,
// `endsOnCaster`, `maintain`; widened by tracer V, docs/tasks/TASK-LN-V.md). The sheet does not store them: the server
// reads them from the effect's entry (`EffectEnds`, looked up by an `EndsOf`; convex/lib/cardRows.ts `effectEndsOf` for
// the SRD entries). The caller says what happened (`EndOccurrence`) and to whom: the effect's bearer, or the creature
// that made it (`role: "caster"`; Eye of the Storm, HF p.23: "until you take Severe damage"). Pure; the caller saves
// and logs. docs/tasks/TASK-LN-E6.md.
//
// ```ts
// const out = endEffects(sheet, { kind: "damageTaken", severity: "minor", hpMarked: 1, lastHp: false }, effectEndsOf);
// // Transform (CB p.334: "until you take damage") is gone from out.sheet; out.ended names it for the feed.
// ```

/** What ends one effect besides its `until`: its entry's step (an `effect`, or a `condition`). */
export type EffectEnds = {
  duration?: Duration;
  endsOn?: readonly EndEvent[];
  endsOnRoll?: RollEnd;
  endsOnCaster?: readonly EndEvent[];
  maintain?: Maintain;
  /** Plan lanes-2 E6 (dcm-8bv): the Fear a `gmSpendsFear` end costs (default 1). */
  endFear?: NumberSource;
  /** Plan lanes-2 E6 (dcm-rao5): one grant shared by every recipient of the use; ending on one ends it on all. */
  sharedGrant?: boolean;
};

/** A made roll as an end reads it. `action` covers attack rolls and Spellcast Rolls (CB p.95); a reaction roll is not one. */
export type EndRoll = {
  kind: "action" | "reaction" | "damage";
  /** An attack roll: with a weapon, a spell, or another attack (a Beastform's form attack). */
  attack?: "weapon" | "spell" | "other";
  /** The weapon of a weapon attack (Menacing Reach, HF p.15: "a successful attack with that weapon"). */
  weapon?: "primary" | "secondary";
  /** A Spellcast Roll. */
  spellcast?: boolean;
  /** The trait rolled (Reliable Backup, CB p.43: "a Presence Roll"). */
  trait?: TraitId;
  success?: boolean;
  /** Which Duality Die was higher; `critical`: matching dice (CB p.90: a critical success counts as a success with Hope). */
  duality?: "hope" | "fear" | "critical";
  /** The roll targets another creature (Timejammer, CB p.334: "an action roll that targets another creature"). */
  targetsCreature?: boolean;
};

/** Hit severities as the ends read them (`none`: the damage was reduced to no Hit Points). */
export type EndSeverity = "none" | "minor" | "major" | "severe";

/** What happened to the bearer (or, with `role: "caster"`, to the creature that made the effect). */
export type EndOccurrence =
  | { kind: "roll"; roll: EndRoll }
  /** A resolved hit on the creature: its severity after armor and the Hit Points it marked. */
  | { kind: "damageTaken"; severity: EndSeverity; hpMarked: number; lastHp: boolean }
  /** The creature dealt damage (Night's Glamour, HF p.17; Patron's Fury, HF p.15). */
  | { kind: "damageDealt"; severity: EndSeverity }
  /** Any other event by name (`gmSpendsFear`, `targetDefeated`, `stanceDrops`, `usedAgain`, `moves`, `tokensGone`, …). */
  | { kind: "event"; event: EndEvent };

/** The `EndEvent`s an occurrence sets off. */
export function occurredEvents(occ: EndOccurrence): ReadonlySet<EndEvent> {
  const out = new Set<EndEvent>();
  if (occ.kind === "event") out.add(occ.event);
  else if (occ.kind === "damageTaken") {
    // CB p.92: damage reduced to 0 marks no Hit Points; the hit still landed but no damage was taken (Q1 in the task).
    const took = occ.severity !== "none" || occ.hpMarked > 0;
    if (took) out.add("takeDamage");
    else out.add("reducedToNoHp");
    if (occ.hpMarked > 0) out.add("markHp");
    if (occ.severity === "major" || occ.severity === "severe") out.add("majorDamage");
    if (occ.severity === "severe") out.add("takeSevere");
    if (occ.lastHp) out.add("lastHp");
  } else if (occ.kind === "damageDealt") {
    if (occ.severity !== "none") out.add("dealDamage");
    if (occ.severity === "severe") out.add("dealSevere");
  } else {
    const r = occ.roll;
    if (r.kind === "action") out.add("actionRoll");
    if (r.attack !== undefined) out.add("bearerAttacks");
    if (r.kind !== "damage" && r.duality === "fear") out.add("rollWithFear");
    if (r.success === false && r.duality !== "critical") out.add("bearerFails");
    if (r.success === false && r.duality === "fear") out.add("failWithFear");
    if (r.attack !== undefined && (r.success === true || r.duality === "critical")) out.add("attackSucceeds");
  }
  return out;
}

/** Whether a made roll is of the kind a `RollFilter` names (as `rollMatches` in card-effects/run.ts does for a spec). */
export function endRollFilter(filter: RollFilter, roll: EndRoll): boolean {
  switch (filter) {
    case "any":
      return true;
    case "action":
      return roll.kind === "action";
    case "attack":
      return roll.attack !== undefined;
    case "weaponAttack":
      return roll.attack === "weapon";
    case "spellcast":
      return roll.spellcast === true;
    case "reaction":
      return roll.kind === "reaction";
    case "damage":
      return roll.kind === "damage";
    default:
      return roll.kind !== "damage" && roll.trait === filter;
  }
}

/** Whether a roll's outcome is the one a `RollResult` names (CB p.90: a critical is a success with Hope). */
export function endRollResult(result: RollResult, roll: EndRoll): boolean {
  const critical = roll.duality === "critical";
  const success = roll.success === true || critical;
  const hope = roll.duality === "hope" || critical;
  switch (result) {
    case "any":
      return true;
    case "success":
      return success;
    case "failure":
      return roll.success === false && !critical;
    case "withHope":
      return hope;
    case "withFear":
      return roll.duality === "fear";
    case "critical":
      return critical;
    case "successWithHope":
      return success && hope;
    case "successWithFear":
      return success && roll.duality === "fear";
  }
}

/** Whether a `RollEnd` holds for a roll (whose roll it must be is the caller's `role`). */
export function rollEndHolds(end: RollEnd, roll: EndRoll): boolean {
  if (!endRollFilter(end.roll, roll)) return false;
  if (end.targetsCreature === true && roll.targetsCreature !== true) return false;
  if (end.result !== undefined && !endRollResult(end.result, roll)) return false;
  return end.weapon === undefined || roll.weapon === end.weapon;
}

/** Whose event it was: the effect's bearer, or the creature that made the effect. */
export type EndRole = "bearer" | "caster";

/**
 * Whether an effect with these ends ends on what happened. The bearer side: `endsOn`, a `RollEnd` by the bearer, and
 * duration `nextRoll` ("until the next time you make an action roll"; the sheet stores it as `manual`). The caster
 * side: `endsOnCaster` and a `RollEnd` with `by: "caster"`. A creature that made an effect on itself is asked once per
 * role.
 */
export function endsOnOccurrence(ends: EffectEnds, occ: EndOccurrence, role: EndRole): boolean {
  const events = occurredEvents(occ);
  const roll = occ.kind === "roll" ? occ.roll : null;
  if (role === "bearer") {
    if ((ends.endsOn ?? []).some((e) => events.has(e))) return true;
    if (ends.duration === "nextRoll" && events.has("actionRoll")) return true;
    return roll !== null && ends.endsOnRoll !== undefined && (ends.endsOnRoll.by ?? "bearer") === "bearer" && rollEndHolds(ends.endsOnRoll, roll);
  }
  if ((ends.endsOnCaster ?? []).some((e) => events.has(e))) return true;
  return roll !== null && ends.endsOnRoll?.by === "caster" && rollEndHolds(ends.endsOnRoll, roll);
}

/** The ends of a sheet effect; undefined for one no entry describes (a D5 effect, a marker, a hand-written effect). */
export type EndsOf = (effect: Effect) => EffectEnds | undefined;

export type EndOptions = {
  role?: EndRole;
  /** Only these effects (the caster side: the effects this caster made). Default every effect. */
  only?: (effect: Effect) => boolean;
  /** Effects whose `maintain` the bearer paid this time (Night's Glamour): they stay. */
  maintained?: ReadonlySet<string>;
};

/**
 * The sheet without the effects `occ` ends. `ended`: the effects that went. `maintainable`: those among them whose
 * entry lets the bearer pay to keep them (`maintain`, dcm-4qv), for the caller to offer; an effect whose id is in
 * `maintained` stays and is in neither list.
 */
export function endEffects<T extends { effects: readonly Effect[] }>(sheet: T, occ: EndOccurrence, endsOf: EndsOf, opts: EndOptions = {}): { sheet: T; ended: Effect[]; maintainable: Effect[] } {
  const role = opts.role ?? "bearer";
  const ended: Effect[] = [];
  const maintainable: Effect[] = [];
  const kept = sheet.effects.filter((e) => {
    if (opts.only && !opts.only(e)) return true;
    const ends = endsOf(e);
    if (ends === undefined || !endsOnOccurrence(ends, occ, role)) return true;
    if (ends.maintain !== undefined) {
      if (opts.maintained?.has(e.id)) return true;
      maintainable.push(e);
    }
    ended.push(e);
    return false;
  });
  if (ended.length === 0) return { sheet, ended, maintainable };
  return { sheet: { ...sheet, effects: kept }, ended, maintainable };
}

/**
 * Night's Glamour (HF p.17: "Unless you mark a Stress to maintain your Glamour, it drops when you mark a Hit Point or
 * deal damage"): the sheet after paying a `maintain`'s costs, or null when it can't be paid. Fixed Hope and Stress only
 * (the costs a maintain names in the book); Stress past a full track marks a Hit Point instead (CB p.92). The server runs
 * Unshakable (convex/lib/unshakable.ts) on the Stress where it calls this.
 */
export function payMaintain<T extends { hope: number; stress: number; stressMax: number; hp: number; hpMax: number }>(sheet: T, maintain: Maintain): T | null {
  let next = sheet;
  for (const cost of maintain.costs) {
    const amount = fixedAmount(cost);
    if (amount === null) return null;
    if (cost.kind === "hope") {
      if (next.hope < amount) return null;
      next = { ...next, hope: next.hope - amount };
    } else {
      const overflow = Math.max(0, next.stress + amount - next.stressMax);
      if (next.hp + overflow > next.hpMax) return null;
      next = { ...next, stress: Math.min(next.stressMax, next.stress + amount), hp: next.hp + overflow };
    }
  }
  return next;
}

function fixedAmount(cost: Cost): number | null {
  if (cost.kind !== "hope" && cost.kind !== "stress") return null;
  return cost.amount.kind === "fixed" ? cost.amount.value : null;
}

/**
 * Unstoppable (CB p.36: "When the die's value would exceed its maximum value or when the scene ends, remove the die and
 * drop out of Unstoppable"; dcm-v17): once the die is gone (D5's "Dealt Hit Points" past the maximum, End Unstoppable),
 * the Unstoppable feature's sheet effects (`isUnstoppable`) go too. The same sheet while the die is held.
 */
export function withoutLapsedUnstoppable<T extends { effects: readonly Effect[]; classState?: ClassState }>(sheet: T, isUnstoppable: (effect: Effect) => boolean): T {
  if (sheet.classState?.unstoppable !== undefined || !sheet.effects.some(isUnstoppable)) return sheet;
  return { ...sheet, effects: sheet.effects.filter((e) => !isUnstoppable(e)) };
}

// ---------------------------------------------------------------- plan lanes-2, tracer E6

/**
 * dcm-8bv / dcm-kmr: the Fear the GM spends to end an effect whose ends hold `gmSpendsFear`, or null when a Fear spend
 * does not end it. Slumber (CB p.332): "the GM spends a Fear" (the default 1); Marked for Death (HF p.8): "a number of
 * Fear equal to your tier" (`endFear` `byTier`, read with the tier of the PC the effect belongs to). A fixed number is
 * itself; any other number source is 1 until the caller can resolve it (E6 Q2).
 */
export function gmFearToEnd(ends: EffectEnds | undefined, tier: 1 | 2 | 3 | 4): number | null {
  if (ends === undefined || !(ends.endsOn ?? []).includes("gmSpendsFear")) return null;
  const fear = ends.endFear;
  if (fear === undefined) return 1;
  if (fear.kind === "fixed") return Math.max(0, fear.value);
  if (fear.kind === "byTier") return Math.max(0, fear.values[tier - 1] ?? 1);
  return 1;
}

/**
 * dcm-erhv / dcm-u2wx: the `cardTokens` keys whose tokens are gone after a change (more than 0 before, 0 or no entry
 * after). Flight (CB p.328): "After the action that spends the last token is resolved, you descend"; Invisibility (CB
 * p.334): "After the action that spends the last token is resolved, the effect ends".
 */
export function tokensGoneKeys(before: Pick<Expirable, "cardTokens">, after: Pick<Expirable, "cardTokens">): string[] {
  const left = new Map((after.cardTokens ?? []).map((t) => [t.cardId, t.count]));
  return (before.cardTokens ?? []).filter((t) => t.count > 0 && (left.get(t.cardId) ?? 0) <= 0).map((t) => t.cardId);
}
