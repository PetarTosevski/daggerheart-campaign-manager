import type { FunctionReturnType } from "convex/server";

import type { CustomAdversaryInput } from "../../../../../src/lib/adversaries/custom";
import type { AdversaryType } from "../../../../../src/lib/srd/types";
import type { api, Id } from "../../convex";

export type EncounterList = FunctionReturnType<typeof api.encounters.list>;
export type EncounterSummary = EncounterList["active"][number];
export type EncounterView = NonNullable<FunctionReturnType<typeof api.encounters.get>>;
export type EncounterInstance = EncounterView["instances"][number];
export type CustomAdversary = FunctionReturnType<typeof api.customAdversaries.list>[number];

/** What "Add to encounter" adds: an SRD entry or one of the campaign's custom adversaries. */
export type AddTarget = {
  source: { kind: "srd"; adversaryId: string } | { kind: "custom"; customId: Id<"customAdversaries"> };
  name: string;
  type: AdversaryType;
  tier: number;
};

/** The fields a stat block shows; an SRD `AdversaryDef` and a custom adversary both fit. */
export type StatBlockData = {
  name: string;
  tier: number;
  type: AdversaryType;
  hordePerHp?: number;
  description: string;
  motives: string;
  difficulty: number;
  thresholds: { major: number | null; severe: number | null };
  hp: number;
  stress: number | null;
  attack: { modifier: number | string; name: string; range: string; damage: string };
  experiences: readonly { name: string; value: number }[];
  features: readonly { name: string; kind: string; text: string }[];
};

export const STATUS_LABEL = { draft: "Draft", running: "Running", ended: "Ended" } as const;

/** The editable fields of a stored custom adversary. */
export function inputOf(row: CustomAdversary): CustomAdversaryInput {
  return {
    name: row.name,
    tier: row.tier,
    type: row.type,
    ...(row.hordePerHp !== undefined ? { hordePerHp: row.hordePerHp } : {}),
    description: row.description,
    motives: row.motives,
    difficulty: row.difficulty,
    thresholds: row.thresholds,
    hp: row.hp,
    stress: row.stress,
    attack: row.attack,
    experiences: row.experiences,
    features: row.features,
  };
}
