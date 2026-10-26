// Battle Points (D8 A3). Pure module: bundled into Convex and used by the builder UI.
//
// Core Book p.197, "Battle Guide":
//   "(3 × the number of PCs in combat) + 2"
//   "• Subtract 1 point if the fight should be less difficult or shorter.
//    • Subtract 2 points if you're using 2 or more Solo adversaries.
//    • Subtract 2 points if you add +1d4 (or a static +2) to all adversaries' damage rolls […].
//    • Add 1 point if you choose an adversary from a lower tier.
//    • Add 1 point if you don't include any Bruisers, Hordes, Leaders, or Solos.
//    • Add 2 points if the fight should be more dangerous or last longer."
//   "• Spend 1 point for each group of Minions equal to the size of the party.
//    • Spend 1 point for each Social or Support adversary.
//    • Spend 2 points for each Horde, Ranged, Skulk, or Standard adversary.
//    • Spend 3 points for each Leader adversary.
//    • Spend 4 points for each Bruiser adversary.
//    • Spend 5 points for each Solo adversary."
//   "Tip: Some adversaries summon additional enemies when they use their features—you don't need to factor those
//    into your point total."
//
// ```ts
// battlePoints({ pcs: 4, adjustments: [], entries: [bear, bear, lackeys4], partyTier: 1 }); // { budget: 14, spent: 9, left: 5, ... }
// ```

import type { AdversaryType } from "../../srd/types";

/** The adjustment ids stored on an encounter (`encounters.adjustments`, convex/lib/validators/encounters.ts). */
export type BpAdjustmentId = "easy" | "twoSolo" | "dmg" | "lowTier" | "noBig" | "hard";

/** The six adjustments of CB p.197 in the Sessions board's order, with its labels. */
export const BP_ADJUSTMENTS: readonly { id: BpAdjustmentId; label: string; delta: number }[] = [
  { id: "easy", label: "Easier or shorter fight", delta: -1 },
  { id: "twoSolo", label: "Using 2 or more Solos", delta: -2 },
  { id: "dmg", label: "+1d4 (or +2) damage to all adversaries", delta: -2 },
  { id: "lowTier", label: "Including a lower-tier adversary", delta: 1 },
  { id: "noBig", label: "No Bruisers, Hordes, Leaders or Solos", delta: 1 },
  { id: "hard", label: "Harder or longer fight", delta: 2 },
];

/** Cost per adversary (CB p.197). Minions are costed per group the size of the party, see `minionGroups`. */
export const BP_COSTS: Record<Exclude<AdversaryType, "Minion">, number> = {
  Social: 1,
  Support: 1,
  Horde: 2,
  Ranged: 2,
  Skulk: 2,
  Standard: 2,
  Leader: 3,
  Bruiser: 4,
  Solo: 5,
};

const BIG_TYPES: readonly AdversaryType[] = ["Bruiser", "Horde", "Leader", "Solo"];

/** One adversary instance as the budget sees it. `type` null = unknown (a deleted custom adversary): costs nothing. */
export type BudgetEntry = {
  type: AdversaryType | null;
  tier: number | null;
  summoned: boolean;
  /** A Minion group's size (one instance per group). */
  minionCount?: number;
};

/** "(3 × the number of PCs in combat) + 2". */
export function startingBudget(pcs: number): number {
  return 3 * pcs + 2;
}

/** The starting budget plus every chosen adjustment's delta (each counted once). */
export function budgetFor(pcs: number, adjustments: readonly BpAdjustmentId[]): number {
  const on = new Set(adjustments);
  return startingBudget(pcs) + BP_ADJUSTMENTS.reduce((sum, a) => sum + (on.has(a.id) ? a.delta : 0), 0);
}

/** Minions in the counted (not summoned) entries, in groups the size of the party, rounded up. */
export function minionGroups(entries: readonly BudgetEntry[], pcs: number): number {
  const minions = entries.reduce((n, e) => n + (!e.summoned && e.type === "Minion" ? (e.minionCount ?? 1) : 0), 0);
  return minions === 0 ? 0 : Math.ceil(minions / Math.max(1, pcs));
}

/** Battle Points spent on the counted entries; summoned adversaries are not counted. */
export function spentFor(entries: readonly BudgetEntry[], pcs: number): number {
  let spent = minionGroups(entries, pcs);
  for (const e of entries) {
    if (e.summoned || e.type === null || e.type === "Minion") continue;
    spent += BP_COSTS[e.type];
  }
  return spent;
}

/**
 * Adjustments the encounter's adversaries suggest (never applied automatically): `twoSolo` with 2 or more Solos,
 * `lowTier` when an adversary is from a lower tier than the party's (`partyTier`, the campaign's tier), `noBig` when
 * there is at least one adversary and none is a Bruiser, Horde, Leader or Solo. Summoned adversaries are ignored,
 * as for the cost.
 */
export function suggestedAdjustments(entries: readonly BudgetEntry[], partyTier: number): BpAdjustmentId[] {
  const counted = entries.filter((e) => !e.summoned && e.type !== null);
  const hints: BpAdjustmentId[] = [];
  if (counted.filter((e) => e.type === "Solo").length >= 2) hints.push("twoSolo");
  if (counted.some((e) => e.tier !== null && e.tier < partyTier)) hints.push("lowTier");
  if (counted.length > 0 && !counted.some((e) => e.type !== null && BIG_TYPES.includes(e.type))) hints.push("noBig");
  return hints;
}

export type BudgetState = "under" | "exact" | "over";

/** "N BP left" / "Right on budget" / "Over by N BP" (the Sessions board's verdicts). */
export function verdict(left: number): string {
  if (left > 0) return `${left} BP left`;
  if (left === 0) return "Right on budget";
  return `Over by ${-left} BP`;
}

export type BattlePoints = {
  budget: number;
  spent: number;
  left: number;
  state: BudgetState;
  verdict: string;
  /** Width of the progress bar, 0..100. */
  percent: number;
  minionGroups: number;
  hints: BpAdjustmentId[];
};

/** Everything the Battle Points panel shows for one encounter. */
export function battlePoints({
  pcs,
  adjustments,
  entries,
  partyTier,
}: {
  pcs: number;
  adjustments: readonly BpAdjustmentId[];
  entries: readonly BudgetEntry[];
  /** The party's tier (the campaign's), for the lower-tier hint. */
  partyTier: number;
}): BattlePoints {
  const budget = budgetFor(pcs, adjustments);
  const spent = spentFor(entries, pcs);
  const left = budget - spent;
  return {
    budget,
    spent,
    left,
    state: left < 0 ? "over" : left === 0 ? "exact" : "under",
    verdict: verdict(left),
    percent: budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 100,
    minionGroups: minionGroups(entries, pcs),
    hints: suggestedAdjustments(entries, partyTier),
  };
}
