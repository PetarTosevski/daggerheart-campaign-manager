// The rule switches on card and feature uses (plan rule-switches, tracer RFC; bead dcm-jh6d.70). Pure: the server
// (convex/lib/cardRunner.ts `buildRun`, `ruleNotesOfUse`) reads the campaign's modes, adds the dice the Book gives and
// collects the GM-only notes Manual leaves; the caller posts them with `postRuleNote` in the use's group.
//
// C1 `conditionDice` (CB p.102): "While Hidden, any rolls against you have disadvantage"; "While you are Vulnerable, all
//   rolls targeting you have advantage"; Cloaked (CB p.42) is Hidden with more benefits. User 2026-11-06: card attack
//   rolls get the dice like weapon attacks. Book: a Vulnerable target gives the card's attack roll an advantage die, a
//   Hidden / Cloaked one a disadvantage die; with several targets only what every target gives counts (as the weapon
//   attack's `targetsEdge`, convex/lib/combatActions.ts). Manual: no die; "Bandit is Vulnerable: add advantage?",
//   "Bandit is Hidden: disadvantage?" (RC1's words, `conditionNotes`).
// D4 `stressOverflow` (CB p.92): "If you're ever forced to mark 1 or more Stress but your slots are already full, you must
//   instead mark 1 Hit Point." Manual drops the extra Stress (the engine's `mark` step keeps `overflow` true with no HP);
//   "Bandit: Stress full, mark 1 HP?" (RDM's words).
//
// ```ts
// conditionDice(["vulnerable"]);            // { advantage: 1, disadvantage: 0 }
// conditionDice(["vulnerable"], "manual");  // { advantage: 0, disadvantage: 0 }
// conditionDiceNotes("Bandit", ["hidden"], "manual"); // ["Bandit is Hidden: disadvantage?"]
// ```

import type { ModeOf } from "../../rules/registry";
import type { PlanStep } from "./run";

export type ConditionDiceMode = ModeOf<"conditionDice">;
export type StressOverflowMode = ModeOf<"stressOverflow">;

/** A Manual rule's note on a card or feature use: which rule and the GM's line. */
export type UseRuleNote = { ruleId: "lineOfSight" | "conditionDice" | "stressOverflow"; summary: string };

export type Edge = { advantage: number; disadvantage: number };

/** C1 for one target: Vulnerable gives advantage, Hidden / Cloaked disadvantage (Book); nothing in Manual. */
export function conditionDice(conditions: Iterable<string>, mode: ConditionDiceMode = "book"): Edge {
  if (mode === "manual") return { advantage: 0, disadvantage: 0 };
  const set = new Set(conditions);
  return { advantage: set.has("vulnerable") ? 1 : 0, disadvantage: set.has("hidden") || set.has("cloaked") ? 1 : 0 };
}

/** C1 for one roll against several targets (R9: one roll): only what every target gives counts. */
export function targetsConditionDice(each: readonly (readonly string[])[], mode: ConditionDiceMode = "book"): Edge {
  if (each.length === 0) return { advantage: 0, disadvantage: 0 };
  const edges = each.map((c) => conditionDice(c, mode));
  return { advantage: Math.min(...edges.map((e) => e.advantage)), disadvantage: Math.min(...edges.map((e) => e.disadvantage)) };
}

/** C1 Manual: the GM's lines for a target whose conditions would change the dice. Empty in Book. */
export function conditionDiceNotes(label: string, conditions: Iterable<string>, mode: ConditionDiceMode = "book"): string[] {
  if (mode !== "manual") return [];
  const set = new Set(conditions);
  const notes: string[] = [];
  if (set.has("vulnerable")) notes.push(`${label} is Vulnerable: add advantage?`);
  if (set.has("hidden") || set.has("cloaked")) notes.push(`${label} is ${set.has("cloaked") && !set.has("hidden") ? "Cloaked" : "Hidden"}: disadvantage?`);
  return notes;
}

/**
 * D4 Manual: one note per creature whose Stress went past a full track in the plan (the engine dropped the extra Stress
 * and marked no HP). `nameOf` names a creature by its runner id (null: not named, skipped). Empty in Book.
 */
export function stressOverflowNotes(steps: readonly PlanStep[], mode: StressOverflowMode = "book", nameOf: (id: string) => string | null): string[] {
  if (mode !== "manual") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of steps) {
    if (s.kind !== "mark" || s.track !== "stress" || !s.overflow || seen.has(s.targetId)) continue;
    seen.add(s.targetId);
    const name = nameOf(s.targetId);
    if (name !== null) out.push(`${name}: Stress full, mark 1 HP?`);
  }
  return out;
}
