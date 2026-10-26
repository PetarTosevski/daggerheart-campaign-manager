// Adversary instances in an encounter (D8 A3). Pure module: bundled into Convex.
//
// An instance copies its stat block's numbers when it is added, so later edits to a custom adversary do not move
// live pips. A Minion group is one instance: "Each Minion has 1 Hit Point" (CB p.201), so its HP track is the group
// size, one Hit Point per Minion.
//
// ```ts
// nextLabels("Bear", ["Bear"], 2);              // ["Bear 2", "Bear 3"]
// instanceStats(bear);                          // { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }
// instanceStats(jaggedKnifeLackey, 4);          // { ..., major: null, severe: null, hpMax: 4, ... }
// ```

import type { AdversaryType } from "../../srd/types";

/** Longest instance label (MAX_LABEL in convex/lib/encounters.ts). */
export const LABEL_MAX = 60;

/** The fields of a stat block (an SRD `AdversaryDef` or a custom adversary) an instance snapshots. */
export type StatSource = {
  type: AdversaryType;
  difficulty: number;
  thresholds: { major: number | null; severe: number | null };
  hp: number;
  /** null = "None" (Spellbound Armor). */
  stress: number | null;
};

export type InstanceStats = {
  difficulty: number;
  major: number | null;
  severe: number | null;
  hpMax: number;
  stressMax: number;
};

/** The numbers an instance keeps: a Minion group's HP track is its size, everyone else's is the block's HP. */
export function instanceStats(def: StatSource, minionCount?: number): InstanceStats {
  return {
    difficulty: def.difficulty,
    major: def.thresholds.major,
    severe: def.thresholds.severe,
    hpMax: def.type === "Minion" ? Math.max(1, minionCount ?? 1) : def.hp,
    stressMax: def.stress ?? 0,
  };
}

function numberOf(label: string, name: string): number | null {
  if (label === name) return 1;
  if (!label.startsWith(`${name} `)) return null;
  const rest = label.slice(name.length + 1);
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : null;
}

/**
 * Labels for `count` new instances of `name`, numbered after the highest one already in the encounter: the first
 * is the bare name ("Bear"), then "Bear 2", "Bear 3". Long names are cut so a label fits LABEL_MAX characters.
 */
export function nextLabels(name: string, existing: readonly string[], count: number): string[] {
  const base = name.trim().slice(0, LABEL_MAX - 3).trimEnd();
  let highest = 0;
  for (const label of existing) highest = Math.max(highest, numberOf(label, base) ?? 0);
  return Array.from({ length: count }, (_, i) => {
    const n = highest + i + 1;
    return n === 1 ? base : `${base} ${n}`;
  });
}
