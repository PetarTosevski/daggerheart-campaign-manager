/**
 * Falling and collision damage (optional rule, plan rule-switches OFA; docs/tasks/TASK-RULES-OFA.md). Pure: the GM's
 * hazard button (`combatHazards.fall`) rolls one of these and hits the PC through the normal incoming hit.
 *
 * CB p.168 "FALLING AND COLLISION DAMAGE": "A fall from Very Close range deals 1d10+3 physical damage. A fall from Close
 * range deals 1d20+5 physical damage. A fall from Far or Very Far range deals 1d100+15 physical damage, or death at the
 * GM's discretion. If a character collides with an object or another character at a dangerous speed, they take 1d20+5
 * direct physical damage."
 *
 * The d100 is one die of 100 sides (the dice box's own sizes stop at d20; the server's `rollDie` rolls any size).
 */
import type { Rng } from "./dice/index";
import type { RollRecord } from "./duality";

export const HAZARD_KINDS = ["veryClose", "close", "far", "collision"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export type HazardDef = {
  /** The button's words. */
  label: string;
  /** The feed's noun phrase ("Ash took damage from a fall from Close range"). */
  phrase: string;
  sides: number;
  flat: number;
  /** Direct damage: no Armor Slot (CB p.99). Only the collision. */
  direct: boolean;
  /** CB p.168: "or death at the GM's discretion" (Far or Very Far). */
  deathAtDiscretion: boolean;
};

export const HAZARDS: Readonly<Record<HazardKind, HazardDef>> = {
  veryClose: { label: "Fall from Very Close", phrase: "a fall from Very Close range", sides: 10, flat: 3, direct: false, deathAtDiscretion: false },
  close: { label: "Fall from Close", phrase: "a fall from Close range", sides: 20, flat: 5, direct: false, deathAtDiscretion: false },
  far: { label: "Fall from Far or Very Far", phrase: "a fall from Far or Very Far range", sides: 100, flat: 15, direct: false, deathAtDiscretion: true },
  collision: { label: "Collision", phrase: "a collision", sides: 20, flat: 5, direct: true, deathAtDiscretion: false },
};

/** The book's dice of a hazard: "1d20+5". */
export function hazardFormula(kind: HazardKind): string {
  const h = HAZARDS[kind];
  return `1d${h.sides}+${h.flat}`;
}

/** Rolls a hazard's damage (one damage die plus the flat bonus; never a critical). */
export function rollHazard(kind: HazardKind, rng: Rng): RollRecord {
  const h = HAZARDS[kind];
  const value = rng(h.sides);
  return { kind: "damage", dice: [{ sides: h.sides, value, role: "damage" }], modifier: h.flat, total: value + h.flat, outcome: "none", manual: false };
}

/** The GM's feed line: "Fall from Close: 1d20+5 = 17 physical", "Collision: 1d20+5 = 12 direct physical". */
export function hazardLine(kind: HazardKind, total: number): string {
  const h = HAZARDS[kind];
  return `${h.label}: ${hazardFormula(kind)} = ${total} ${h.direct ? "direct " : ""}physical${h.deathAtDiscretion ? ", or death at the GM's discretion" : ""}`;
}
