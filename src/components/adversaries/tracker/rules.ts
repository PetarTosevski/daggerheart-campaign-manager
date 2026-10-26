import type { FunctionReturnType } from "convex/server";

import { hordeDamage, maxDamage, minionValue, parseDamage, relentlessValue } from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import type { AdversaryDef } from "@/lib/srd/types";

import type { api } from "../../../../convex/_generated/api";
import type { StatBlockAdversary } from "../catalogue/stat-block";

/**
 * What the tracker reads from an instance's stat block (D8 A4): the parchment block itself, and the passives that
 * change play: Relentless (X) spotlights (CB p.195), Minion (X) (CB p.201) and Horde (X) damage (CB p.199). SRD blocks
 * use A1's parsers; a custom block (A5) is read by its feature names the same way.
 */

export type CustomBlock = FunctionReturnType<typeof api.encounterTracking.customBlocks>[number];

export type BlockRules = {
  block: StatBlockAdversary;
  relentless: number | "X" | null;
  minionX: number | null;
  /** The Horde's damage once half its HP are marked, e.g. "1d4+1". */
  hordeX: string | null;
};

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));
const TIERS = [1, 2, 3, 4] as const;

function featureValue(features: readonly { name: string }[], label: string): string | null {
  for (const f of features) {
    const m = new RegExp(`^${label} \\((.+)\\)$`).exec(f.name);
    if (m) return m[1];
  }
  return null;
}

function customRules(custom: CustomBlock): BlockRules {
  const relentless = featureValue(custom.features, "Relentless");
  const minion = featureValue(custom.features, "Minion");
  const block: StatBlockAdversary = { ...custom, tier: TIERS.find((t) => t === custom.tier) ?? 1 };
  return {
    block,
    relentless: relentless === null ? null : /^\d+$/.test(relentless) ? Number(relentless) : "X",
    minionX: minion !== null && /^\d+$/.test(minion) ? Number(minion) : null,
    hordeX: featureValue(custom.features, "Horde")?.replace(/[−–]/g, "-") ?? null,
  };
}

/** The instance's stat block and its play rules; null when a custom block was deleted. */
export function rulesFor(
  source: { kind: "srd"; adversaryId: string } | { kind: "custom"; customId: string },
  customs: readonly CustomBlock[],
): BlockRules | null {
  if (source.kind === "srd") {
    const def = SRD_BY_ID.get(source.adversaryId);
    return def ? { block: def, relentless: relentlessValue(def), minionX: minionValue(def), hordeX: hordeDamage(def) } : null;
  }
  const custom = customs.find((c) => c._id === source.customId);
  return custom ? customRules(custom) : null;
}

export type DicePool = { count: number; sides: number }[];

/** The attack roll (CB p.160): d20 + the attack modifier, or d20 + extra dice for a "+2d4" modifier; null if unreadable. */
export function attackRoll(modifier: number | string): { dice: DicePool; modifier: number } | null {
  if (typeof modifier === "number") return { dice: [{ count: 1, sides: 20 }], modifier };
  const m = /^\+?(\d*)d(\d+)$/.exec(modifier.trim());
  if (!m) return null;
  return { dice: [{ count: 1, sides: 20 }, { count: m[1] ? Number(m[1]) : 1, sides: Number(m[2]) }], modifier: 0 };
}

/** A natural 20 on the attack's d20: an automatic success, and critical damage (CB p.148). */
export function isNatural20(dice: readonly { sides: number; value: number }[]): boolean {
  return dice[0]?.sides === 20 && dice[0].value === 20;
}

/**
 * The damage roll for a damage text ("1d12+2 phy"): dice and modifier, plus the highest the dice can roll for a
 * critical (CB p.148: "Start with the highest possible value the damage dice can roll, and then make a damage roll as
 * usual, adding it to that value"). `flat` is set for damage without dice ("2 phy"), which is not rolled.
 */
export function damageRoll(text: string, critical = false): { dice: DicePool; modifier: number } | { flat: number } | null {
  const parsed = parseDamage(text);
  if (parsed === null) return null;
  if (parsed.dice === null) return { flat: parsed.modifier };
  return { dice: [parsed.dice], modifier: parsed.modifier + (critical ? maxDamage(parsed.dice) : 0) };
}
