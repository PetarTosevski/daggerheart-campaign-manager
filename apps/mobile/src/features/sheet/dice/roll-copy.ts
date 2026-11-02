import { dualityEffects, OUTCOME_LABEL, type DicePool } from "../../../../../../src/lib/domain/dice";
import type { RollRecord } from "../../../../../../src/lib/domain/duality";
import { TRAIT_LABEL } from "../../../../../../src/lib/frames/extras/common";
import type { TraitId } from "../../../../../../src/lib/srd/types";

const KIND_LABEL: Record<RollRecord["kind"], string> = {
  action: "Action",
  reaction: "Reaction",
  damage: "Damage",
  free: "Roll",
};

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `−${-n}`;
}

export function poolLabel(pool: DicePool, flat: number): string {
  return pool.map((d) => `${d.count}d${d.sides}`).join("+") + (flat ? `+${flat}` : "");
}

export function outcomeText(roll: RollRecord): string {
  if (roll.outcome === "none") return KIND_LABEL[roll.kind];
  const base =
    roll.outcome !== "critical" && roll.difficulty === undefined
      ? roll.outcome.endsWith("Hope")
        ? "with Hope"
        : "with Fear"
      : OUTCOME_LABEL[roll.outcome];
  return roll.kind === "reaction" ? `${base} · reaction` : base;
}

export function outcomeColor(roll: RollRecord): string {
  if (roll.outcome === "critical") return "crit";
  if (roll.outcome === "none") return "dmg";
  return roll.outcome.endsWith("Hope") ? "hope" : "fear";
}

export function partsText(roll: RollRecord): string {
  const terms = roll.dice.filter((d) => !d.dropped).map((d) => (d.role === "disadvantage" ? -d.value : d.value));
  if (roll.modifier) terms.push(roll.modifier);
  if (terms.length < 2 || terms.reduce((a, b) => a + b, 0) !== roll.total) return "";
  return terms.map((t, i) => (i === 0 ? String(t) : t < 0 ? `− ${-t}` : `+ ${t}`)).join(" ");
}

export function consequence(roll: RollRecord, fearGained: number | undefined): string {
  if (roll.kind === "reaction") return "Reaction rolls don’t generate Hope or Fear.";
  if (roll.kind !== "action") return "";
  const fx = dualityEffects("action", roll.outcome);
  if (fx.clearStress) return "Critical success: you gain a Hope and clear a Stress.";
  if (fx.hope) return "Rolled with Hope: you gain a Hope.";
  if (fx.fear) return fearGained === 0 ? "Rolled with Fear: the GM’s Fear is already full." : "Rolled with Fear: the GM gains a Fear.";
  return "";
}

export function earlierText(roll: RollRecord): string {
  const hope = roll.dice.find((d) => d.role === "hope");
  const fear = roll.dice.find((d) => d.role === "fear");
  const outcome = roll.outcome === "none" ? "" : ` · ${outcomeText(roll)}`;
  return `${KIND_LABEL[roll.kind]} ${roll.total}${outcome}${hope && fear ? ` (${hope.value}/${fear.value})` : ""}${roll.manual ? " · manual" : ""}`;
}

export function slayerResultSuffix(roll: RollRecord, n: number): string {
  if (n === 0) return "";
  const values = roll.dice.slice(-n).map((d) => d.value);
  return ` · Slayer d6${n > 1 ? ` ×${n}` : ""} (${values.join(", ")})`;
}

export function traitRollLabel(trait: TraitId, modifier: number, mode: "action" | "reaction", difficulty?: number, tideCount?: number): string {
  const diff = difficulty !== undefined ? ` vs ${difficulty}` : "";
  const tide = tideCount && tideCount > 0 ? ` · Know the Tide +${tideCount}` : "";
  return `${TRAIT_LABEL[trait]} ${signed(modifier)} ${mode} roll${diff}${tide}`;
}

export function rollHeadline(roll: RollRecord): string {
  const outcome = roll.outcome === "none" ? "" : ` · ${OUTCOME_LABEL[roll.outcome]}`;
  const vs = roll.difficulty !== undefined ? ` vs ${roll.difficulty}` : "";
  return `${roll.total}${vs}${outcome}`;
}
