import type { RollRecord } from "../../../../../../src/lib/domain/duality";
import { TRAIT_LABEL } from "../../../../../../src/lib/frames/extras/common";
import { signed } from "../../../../../../src/lib/party/roll-copy";
import type { TraitId } from "../../../../../../src/lib/srd/types";

// The phone-only roll words. The shared ones (outcome line, parts, consequence, "Earlier" line, headline) come from
// src/lib/party/roll-copy.ts, as on the website.

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
