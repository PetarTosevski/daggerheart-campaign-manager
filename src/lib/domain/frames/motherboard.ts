// Motherboard scrap rules (Core Book pp.302–303). Pure and deterministic
// given the injected `roll`.

/** Rolls one die with the given number of sides, returning 1..sides. */
export type Roll = (sides: number) => number;

export type ScrapCategory = "shards" | "metals" | "components";
export type ScrapItem = { name: string; value: number };

/** Scrap Category Tables (p.302). Each value is both the roll threshold and the quantum worth. */
export const SCRAP_TABLES: Record<ScrapCategory, { label: string; die: number; items: ScrapItem[] }> = {
  shards: {
    label: "Shards",
    die: 6,
    items: [
      { name: "Gear", value: 1 },
      { name: "Coil", value: 2 },
      { name: "Wire", value: 3 },
      { name: "Trigger", value: 4 },
      { name: "Lens", value: 5 },
      { name: "Crystal", value: 6 },
    ],
  },
  metals: {
    label: "Metals",
    die: 8,
    items: [
      { name: "Aluminum", value: 1 },
      { name: "Copper", value: 3 },
      { name: "Cobalt", value: 5 },
      { name: "Silver", value: 6 },
      { name: "Platinum", value: 7 },
      { name: "Gold", value: 8 },
    ],
  },
  components: {
    label: "Components",
    die: 10,
    items: [
      { name: "Fuse", value: 1 },
      { name: "Circuit", value: 3 },
      { name: "Disc", value: 6 },
      { name: "Relay", value: 8 },
      { name: "Capacitor", value: 9 },
      { name: "Battery", value: 10 },
    ],
  },
};

export const SCRAP_CATEGORIES: ScrapCategory[] = ["shards", "metals", "components"];

/** "Relics are worth 20 quantum" (p.303). */
export const RELIC_VALUE = 20;
/** 10 quantum = 1 handful of gold (p.302). */
export const QUANTUM_PER_HANDFUL = 10;
export const STARTING_QUANTUM = 5;

/** "If a rolled result falls between two values, select the lower numbered option." */
export function scrapForRoll(category: ScrapCategory, result: number): ScrapItem {
  const table = SCRAP_TABLES[category];
  if (!Number.isInteger(result) || result < 1 || result > table.die) {
    throw new RangeError(`${table.label} roll must be 1–${table.die}.`);
  }
  return table.items.reduce((found, item) => (item.value <= result ? item : found), table.items[0]);
}

export type ScrapCounts = Record<ScrapCategory, number>;
export type GatheredScrap = { category: ScrapCategory; roll: number; item: ScrapItem };

/** One player's gather: one piece of scrap per die, in category order. */
export function gatherScrap(counts: ScrapCounts, roll: Roll): GatheredScrap[] {
  return SCRAP_CATEGORIES.flatMap((category) =>
    Array.from({ length: Math.max(0, counts[category]) }, () => {
      const result = roll(SCRAP_TABLES[category].die);
      return { category, roll: result, item: scrapForRoll(category, result) };
    }),
  );
}

export type RewardGroup = "few" | "mostly" | "all";
export type FightDifficulty = "easy" | "standard" | "difficult" | "veryDifficult";

const counts = (shards: number, metals: number, components: number): ScrapCounts => ({ shards, metals, components });

/** Scrap Reward Table (p.303): dice per category by how many foes were remnants and the fight's difficulty. */
export const SCRAP_REWARD_TABLE: Record<RewardGroup, Record<FightDifficulty, ScrapCounts>> = {
  few: {
    easy: counts(2, 0, 0),
    standard: counts(2, 1, 0),
    difficult: counts(2, 1, 1),
    veryDifficult: counts(2, 2, 1),
  },
  mostly: {
    easy: counts(2, 1, 0),
    standard: counts(2, 2, 1),
    difficult: counts(3, 2, 1),
    veryDifficult: counts(3, 3, 2),
  },
  all: {
    easy: counts(2, 1, 1),
    standard: counts(3, 2, 2),
    difficult: counts(3, 3, 2),
    veryDifficult: counts(4, 3, 3),
  },
};

export const REWARD_GROUP_LABEL: Record<RewardGroup, string> = {
  few: "A few remnants",
  mostly: "Mostly remnants",
  all: "All remnants",
};

/** Quantum worth of one piece of scrap by name (buying or selling, p.303). */
export function scrapValue(name: string): number | undefined {
  if (name === "Relic") return RELIC_VALUE;
  for (const c of SCRAP_CATEGORIES) {
    const item = SCRAP_TABLES[c].items.find((i) => i.name === name);
    if (item) return item.value;
  }
  return undefined;
}

/** A scrap shack's daily stock: "1d10 of each Shard, 1d8 of each Metal, and 1d6 of each Component" (p.303). */
export function rollShackStock(roll: Roll): Record<string, number> {
  const stockDie: ScrapCounts = { shards: 10, metals: 8, components: 6 };
  const stock: Record<string, number> = {};
  for (const c of SCRAP_CATEGORIES) for (const item of SCRAP_TABLES[c].items) stock[item.name] = roll(stockDie[c]);
  return stock;
}
