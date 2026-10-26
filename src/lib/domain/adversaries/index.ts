// Adversary stat block rules read from the SRD data (D8 A1). Pure module: bundled into Convex, and data-free so a
// caller that only needs a helper does not pull the 267 stat blocks (pass the list from src/lib/srd/adversaries.ts).
//
// Core Book p.199: "Horde (X) - Passive: When the Horde has marked half or more of their HP, their standard attack
//   deals X damage instead."
// Core Book p.201: "Minion (X) - Passive: This adversary is defeated when they take any damage. For every X damage a PC
//   deals to this adversary, defeat an additional Minion within range the attack would succeed against."
// Core Book p.195: "Relentless (X) - Passive: This adversary can be spotlighted up to X times per GM turn." Some blocks
//   print a variable X (Hydra: its number of heads; Xero: the number of PCs).
// Core Book p.194: "you must spend Fear as described, even if you already spent a Fear to spotlight the adversary."
// Core Book p.148 (GM Critical Successes): "Start with the highest possible value the damage dice can roll, and then
//   make a damage roll as usual, adding it to that value." (2d8+2: 16 + roll + 2.)
//
// ```ts
// minionValue(jaggedKnifeLackey);          // 3
// hordeDamage(giantMosquitoes);            // "1d4+1"
// relentlessValue(acidBurrower);           // 3; "X" for the Hydra; null without the feature
// featureFearCost("Spend 2 Fear to ...");  // 2
// parseDamage("2d10+4 phy");               // { dice: { count: 2, sides: 10 }, modifier: 4, type: "phy", direct: false }
// maxDamage({ count: 2, sides: 10 });      // 20
// adversariesFor(ADVERSARIES, { hopeAndFear: false, frameId: "witherwild" }); // the 129 Core blocks
// ```

import type { AdversaryDef } from "../../srd/types";

/** The frame whose adversaries (Weredrake, Forlorne Lykona) are exclusive to it (HF pp.142-143). */
export const WEREDRAGON_FRAME_ID = "reign-of-the-weredragon";

function featureValue(def: AdversaryDef, label: string): string | null {
  const re = new RegExp(`^${label} \\((.+)\\)$`);
  for (const f of def.features) {
    const m = re.exec(f.name);
    if (m) return m[1];
  }
  return null;
}

/** X of "Minion (X)": one extra Minion defeated per X damage; null for non-Minions. */
export function minionValue(def: AdversaryDef): number | null {
  const x = featureValue(def, "Minion");
  return x !== null && /^\d+$/.test(x) ? Number(x) : null;
}

/** X of "Horde (X)": the damage of the standard attack once half the HP are marked (ASCII minus); null for non-Hordes. */
export function hordeDamage(def: AdversaryDef): string | null {
  return featureValue(def, "Horde")?.replace(/[−–]/g, "-") ?? null;
}

/** X of "Relentless (X)": spotlights per GM turn; "X" when the block makes it variable; null without the feature. */
export function relentlessValue(def: AdversaryDef): number | "X" | null {
  const x = featureValue(def, "Relentless");
  if (x === null) return null;
  return /^\d+$/.test(x) ? Number(x) : "X";
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** Fear a feature asks for: "Spend a Fear" = 1, "spend 2 Fear" = 2; null when it names no fixed amount. */
export function featureFearCost(text: string): number | null {
  const m = /\bspend (a|an|one|two|three|four|five|six|\d+) Fear\b/i.exec(text);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return WORD_NUMBERS[word] ?? Number(word);
}

export type AdversaryDamageType = "phy" | "mag" | "phy/mag";

export interface ParsedDamage {
  /** Null for flat damage ("2 phy", Minions). */
  dice: { count: number; sides: number } | null;
  modifier: number;
  /** Null when the text names no type (a Horde (X) value such as "1d4+1"). */
  type: AdversaryDamageType | null;
  /** "direct" damage can't be reduced by Armor Slots. */
  direct: boolean;
}

/** "2d10+4 phy", "1d20 phy", "2 phy", "40 direct phy", "1d4+1" -> parts; null when unparseable. */
export function parseDamage(text: string): ParsedDamage | null {
  const m = /^\s*(?:(\d*)d(\d+))?\s*(?:([-+−–])?\s*(\d+))?\s*(direct\s+)?(phy\/mag|phy|mag)?\s*$/.exec(text);
  if (!m || (!m[2] && !m[4])) return null;
  const dice = m[2] ? { count: m[1] ? Number(m[1]) : 1, sides: Number(m[2]) } : null;
  const sign = m[3] && m[3] !== "+" ? -1 : 1;
  return {
    dice,
    modifier: m[4] ? sign * Number(m[4]) : 0,
    type: (m[6] as AdversaryDamageType | undefined) ?? null,
    direct: Boolean(m[5]),
  };
}

/** Highest result of the dice, added to the rolled damage on a critical success (CB p.148). */
export function maxDamage(dice: { count: number; sides: number } | null): number {
  return dice ? dice.count * dice.sides : 0;
}

/**
 * The adversaries a campaign can use: Core always; Hope & Fear only with the campaign's Hope & Fear switch on;
 * frame-exclusive blocks (Reign of the Weredragon) only in their own frame, whatever the switch says.
 */
export function adversariesFor<T extends Pick<AdversaryDef, "source" | "frameId">>(
  list: readonly T[],
  campaign: { hopeAndFear: boolean; frameId: string | null | undefined },
): T[] {
  return list.filter((def) => {
    if (def.frameId) return def.frameId === campaign.frameId;
    return def.source === "core" || campaign.hopeAndFear;
  });
}
