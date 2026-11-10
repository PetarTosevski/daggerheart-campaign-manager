import { dualityEffects, OUTCOME_LABEL, type DicePool } from "../domain/dice/index";
import type { RollRecord } from "../domain/duality";

/**
 * The dice box's words for a roll (the result card, the "Earlier" list, Tag Team's headline). Framework-free (no React,
 * no "@/"), shared by the website (components/party/dice) and the phone app.
 */

const KIND_LABEL: Record<RollRecord["kind"], string> = { action: "Action", reaction: "Reaction", damage: "Damage", free: "Roll" };

/** "+2", "−1" (a real minus sign). */
export const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** "2d6+1d8+3": a dice pool and its flat bonus. */
export function poolLabel(pool: DicePool, flat: number): string {
  return pool.map((d) => `${d.count}d${d.sides}`).join("+") + (flat ? `+${flat}` : "");
}

/** The coloured outcome line: "Critical success", "Success with Hope", "With Fear" (no Difficulty), "Damage". */
export function outcomeText(roll: RollRecord): string {
  if (roll.outcome === "none") return KIND_LABEL[roll.kind];
  const base = roll.outcome !== "critical" && roll.difficulty === undefined ? (roll.outcome.endsWith("Hope") ? "with Hope" : "with Fear") : OUTCOME_LABEL[roll.outcome];
  return roll.kind === "reaction" ? `${base} · reaction` : base;
}

/** The outcome line's tone: "crit", "dmg", "hope" or "fear". */
export function outcomeTone(roll: RollRecord): string {
  if (roll.outcome === "critical") return "crit";
  if (roll.outcome === "none") return "dmg";
  return roll.outcome.endsWith("Hope") ? "hope" : "fear";
}

/** "8 + 9 + 2" when the counted dice and the modifier add up to the total (a critical's bonus does not). */
export function partsText(roll: RollRecord): string {
  const terms = roll.dice.filter((d) => !d.dropped).map((d) => (d.role === "disadvantage" ? -d.value : d.value));
  if (roll.modifier) terms.push(roll.modifier);
  if (terms.length < 2 || terms.reduce((a, b) => a + b, 0) !== roll.total) return "";
  return terms.map((t, i) => (i === 0 ? String(t) : t < 0 ? `− ${-t}` : `+ ${t}`)).join(" ");
}

/**
 * The italic consequence line: what the server applied for Hope, Stress and Fear (CB 95, `dualityEffects`).
 * `criticalManual`: R2 Manual. `hopeFearManual`: R3 Manual (user answer Q2 b, 2026-11-05): with Hope the player adds the
 * Hope on the sheet, with Fear the GM gets "gain 1 Fear?"; a critical keeps its Hope and Stress (user 2026-11-06).
 */
export function consequence(roll: RollRecord, fearGained: number | undefined, poolHidden = false, criticalManual = false, hopeFearManual = false): string {
  if (roll.kind === "reaction") return "Reaction rolls don’t generate Hope or Fear.";
  if (roll.kind !== "action") return "";
  // Rule switches WR (R2 Manual): the critical still succeeds; its Hope and Stress are the GM's call.
  if (criticalManual && roll.outcome === "critical") return "Critical success: the GM decides your Hope and Stress.";
  const fx = dualityEffects("action", roll.outcome);
  if (fx.clearStress) return "Critical success: you gain a Hope and clear a Stress.";
  // R3 Manual (dcm-bxp.134.6): nothing is gained by itself.
  if (hopeFearManual && fx.hope) return "Rolled with Hope: add 1 Hope on your sheet.";
  if (hopeFearManual && fx.fear) return "Rolled with Fear: the GM decides the Fear.";
  if (fx.hope) return "Rolled with Hope: you gain a Hope.";
  // R1: "already full" would tell a player the hidden pool is 12; the die stays ("Rolled with Fear").
  if (fx.fear && poolHidden) return "Rolled with Fear.";
  if (fx.fear) return fearGained === 0 ? "Rolled with Fear: the GM’s Fear is already full." : "Rolled with Fear: the GM gains a Fear.";
  return "";
}

/** One line of the "Earlier" list: "Action 17 · with Fear (8/9)", "Damage 9". */
export function earlierText(roll: RollRecord): string {
  const hope = roll.dice.find((d) => d.role === "hope");
  const fear = roll.dice.find((d) => d.role === "fear");
  const outcome = roll.outcome === "none" ? "" : ` · ${outcomeText(roll)}`;
  return `${KIND_LABEL[roll.kind]} ${roll.total}${outcome}${hope && fear ? ` (${hope.value}/${fear.value})` : ""}${roll.manual ? " · manual" : ""}`;
}

/** "17 with Hope · success" style headline of a roll. */
export function rollHeadline(roll: RollRecord): string {
  const outcome = roll.outcome === "none" ? "" : ` · ${OUTCOME_LABEL[roll.outcome]}`;
  const vs = roll.difficulty !== undefined ? ` vs ${roll.difficulty}` : "";
  return `${roll.total}${vs}${outcome}`;
}
