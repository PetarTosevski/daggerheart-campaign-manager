// Death moves, scars and Castle High's less-lethal rule (D5 T4). Pure module: bundled into Convex.
//
// Core Book p. 106 ("Death", "Death Move", "Scars"): when a character marks their last Hit Point they choose
// - Blaze of Glory: one action that critically succeeds, then they cross through the veil of death;
// - Avoid Death: they drop unconscious (woken when an ally clears a Hit Point or on a long rest), then roll the
//   Hope Die: at or under their level they gain a scar. Crossing out the last Hope slot ends their journey;
// - Risk It All: roll the Duality Dice. Hope higher: clear Hit Points and Stress totalling the Hope Die, split
//   as the player likes; Fear higher: death; matching dice: clear every Hit Point and Stress.
// Hope & Fear p. 127 ("A Less Lethal Campaign", Castle High): a death move that would kill a character sends
// them to the infirmary or home instead, unplayable for some time but not dead.
// Core Book p. 261 (Witherwild): a character who dies with Wither tokens is taken by the Witherwild.
//
// ```ts
// canMakeDeathMove({ status: "active", hp: 6, hpMax: 6, conditions: [] }); // true
// avoidDeath(sheet, 2);            // level 3: scarred, unconscious
// riskItAll(9, 4);                 // { result: "hope", value: 9 }
// splitRiskItAll(sheet, 9, 5, 4);  // clears 5 HP and 4 Stress (throws DeathMoveError on a bad split)
// deathStatus(true, "sentHome");   // { status: "away", away: { reason: "sentHome" } }
// ```

import type { Condition } from "../../validation/characters";
import { applyResourceDelta, hopeMax } from "../characters/index";
import { dualityOutcome } from "../duality";

export const DEATH_MOVES = ["blazeOfGlory", "avoidDeath", "riskItAll"] as const;
export type DeathMove = (typeof DEATH_MOVES)[number];

export const DEATH_MOVE_LABELS: Record<DeathMove, string> = {
  blazeOfGlory: "Blaze of Glory",
  avoidDeath: "Avoid Death",
  riskItAll: "Risk It All",
};

/** Why a Castle High character is away (HF 127). */
export type AwayReason = "infirmary" | "sentHome";

export const AWAY_REASON_LABELS: Record<AwayReason, string> = { infirmary: "in the infirmary", sentHome: "sent home" };

/** An expected rule violation; Convex turns it into DEATH_MOVE_RULE through `applyRule`. */
export class DeathMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeathMoveError";
  }
}

type Tracks = {
  level: number;
  hp: number;
  hpMax: number;
  stress: number;
  stressMax: number;
  hope: number;
  scars: number;
  hopeSlotBonus?: number;
  conditions: readonly Condition[];
  journeyEnds?: boolean;
};

/** A death move is made when the last Hit Point is marked, by an active character who is not already unconscious (CB 106). */
export function canMakeDeathMove(c: { status: string; hp: number; hpMax: number; conditions: readonly string[] }): boolean {
  return c.status === "active" && c.hpMax > 0 && c.hp >= c.hpMax && !c.conditions.includes("unconscious");
}

/**
 * Avoid Death (CB 106): the character drops unconscious; a Hope Die at or under
 * the level adds a scar. A scar on the last Hope slot sets `journeyEnds`.
 */
export function avoidDeath<T extends Tracks>(sheet: T, hopeDie: number): { sheet: T; scarred: boolean; journeyEnds: boolean } {
  const conditions: readonly Condition[] = sheet.conditions.includes("unconscious") ? sheet.conditions : [...sheet.conditions, "unconscious"];
  let next: T = { ...sheet, conditions };
  const scarred = hopeDie <= sheet.level;
  let journeyEnds = Boolean(sheet.journeyEnds);
  if (scarred) {
    // Scars go up to 6 + hopeSlotBonus (scarsMax); the journey ends when no Hope slot is left.
    journeyEnds = journeyEnds || hopeMax(sheet.scars + 1, sheet.hopeSlotBonus ?? 0) <= 0;
    next = { ...applyResourceDelta(next, "scars", 1), journeyEnds };
  }
  return { sheet: next, scarred, journeyEnds };
}

/** Risk It All (CB 106): which die won, and the Hope Die's value to clear when Hope won. */
export function riskItAll(hope: number, fear: number): { result: "critical" | "hope" | "fear"; value: number } {
  return { result: dualityOutcome(hope, fear), value: hope };
}

/** Risk It All with matching dice: the character stays up and clears all Hit Points and Stress. */
export function clearAllHpAndStress<T extends Tracks>(sheet: T): T {
  return { ...sheet, hp: 0, stress: 0 };
}

/**
 * Risk It All with Hope higher: clears `hp` Hit Points and `stress` Stress,
 * together the Hope Die's value (or everything marked, when less is marked).
 */
export function splitRiskItAll<T extends Tracks>(sheet: T, value: number, hp: number, stress: number): T {
  if (!Number.isInteger(hp) || !Number.isInteger(stress) || hp < 0 || stress < 0) throw new DeathMoveError("Clear whole numbers of Hit Points and Stress.");
  if (hp > sheet.hp) throw new DeathMoveError(`Only ${sheet.hp} Hit Points are marked.`);
  if (stress > sheet.stress) throw new DeathMoveError(`Only ${sheet.stress} Stress is marked.`);
  const total = Math.min(value, sheet.hp + sheet.stress);
  if (hp + stress !== total) throw new DeathMoveError(`Clear ${total} in total, split between Hit Points and Stress.`);
  return { ...sheet, hp: sheet.hp - hp, stress: sheet.stress - stress };
}

/** What dying does: `dead`, or `away` in a Castle High campaign with the less-lethal rule on (HF 127). */
export function deathStatus(lessLethal: boolean, reason: AwayReason = "infirmary"): { status: "dead" } | { status: "away"; away: { reason: AwayReason } } {
  return lessLethal ? { status: "away", away: { reason } } : { status: "dead" };
}

/** The feed line for a character leaving play by a death move. */
export function deathSummary(name: string, outcome: ReturnType<typeof deathStatus>, wither: number): string {
  if (outcome.status === "away") return `${name} would have died, but is ${AWAY_REASON_LABELS[outcome.away.reason]} instead (less lethal).`;
  return `${name} crosses through the veil of death${wither > 0 ? ", taken by the Witherwild" : ""}.`;
}

/** The roll fields of a death-move log row that `pendingDeathMove` reads back. */
type LoggedRoll = { outcome: string; dice: readonly { role: string; value: number }[] };

/**
 * The death move still waiting for its second step, read from the character's
 * latest live log row: a Blaze of Glory waiting for its action (a critical with
 * no dice), or a Risk It All won with Hope waiting for the player's split.
 */
export function pendingDeathMove(row: { kind: string; roll?: LoggedRoll } | null): { move: "blazeOfGlory" } | { move: "riskItAll"; value: number } | null {
  if (row === null || row.kind !== "death" || row.roll === undefined) return null;
  if (row.roll.outcome === "critical" && row.roll.dice.length === 0) return { move: "blazeOfGlory" };
  const hope = row.roll.dice.find((d) => d.role === "hope");
  if (row.roll.outcome === "successHope" && hope) return { move: "riskItAll", value: hope.value };
  return null;
}
