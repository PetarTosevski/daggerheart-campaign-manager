// Beast Feast cooking rules (Core Book pp.277–278). Pure and deterministic
// given the injected `roll`, so the dice can be scripted in tests.

/** Rolls one die with the given number of sides, returning 1..sides. */
export type Roll = (sides: number) => number;

export const FLAVORS = ["sweet", "salty", "bitter", "sour", "savory", "weird"] as const;
export type Flavor = (typeof FLAVORS)[number];

/** "Each flavor has a die size associated with it" (p.277). */
export const FLAVOR_DIE: Record<Flavor, number> = { sweet: 4, salty: 6, bitter: 8, sour: 10, savory: 12, weird: 20 };

export const FLAVOR_LABEL: Record<Flavor, string> = {
  sweet: "Sweet",
  salty: "Salty",
  bitter: "Bitter",
  sour: "Sour",
  savory: "Savory",
  weird: "Weird",
};

/** A flavor's strength (1–3) is how many of its dice the ingredient adds. */
export type FlavorStrength = { flavor: Flavor; strength: number };
export type Ingredient = { flavors: FlavorStrength[] };

/** The meal's flavor dice (as die sizes) from the chosen ingredients. */
export function flavorPool(ingredients: Ingredient[]): number[] {
  return ingredients.flatMap((i) => i.flavors.flatMap((f) => Array.from({ length: f.strength }, () => FLAVOR_DIE[f.flavor])));
}

export type RolledDie = { sides: number; value: number };
export type MatchedSet = { value: number; dice: RolledDie[] };
export type FeastRound = { rolled: RolledDie[]; sets: MatchedSet[]; discarded: RolledDie | "token" | null };
export type FeastResult = {
  rounds: FeastRound[];
  sets: MatchedSet[];
  /** Sum of each matched set's face value. */
  mealRating: number;
  /** The die size left when cooking ended (for features like Last Drop), or null. */
  lastDie: number | null;
  tokensLeft: number;
};

/**
 * Which rolled die to discard when nothing matched (the players' choice).
 * Default: the largest die, the one least likely to match.
 */
export type ChooseDiscard = (rolled: RolledDie[]) => number;

const discardLargest: ChooseDiscard = (rolled) =>
  rolled.reduce((best, d, i) => (d.sides > rolled[best].sides ? i : best), 0);

/**
 * Make a Feast (p.278): roll the pool; set aside every group of matching
 * values (two or more dice each); if nothing matched, discard one die — or a
 * cookbook token instead, while any remain; roll again until one die (or none)
 * is left. Meal Rating = sum of each set's value. `tokens` = the party's tier
 * when the flavor profile is already in the cookbook, else 0.
 */
export function makeFeast(pool: number[], tokens: number, roll: Roll, chooseDiscard: ChooseDiscard = discardLargest): FeastResult {
  let dice = [...pool];
  let tokensLeft = Math.max(0, tokens);
  const rounds: FeastRound[] = [];
  const sets: MatchedSet[] = [];

  while (dice.length > 1) {
    const rolled = dice.map((sides) => ({ sides, value: roll(sides) }));
    const byValue = new Map<number, RolledDie[]>();
    for (const d of rolled) byValue.set(d.value, [...(byValue.get(d.value) ?? []), d]);
    const roundSets = [...byValue.entries()]
      .filter(([, group]) => group.length >= 2)
      .map(([value, group]) => ({ value, dice: group }));

    let discarded: FeastRound["discarded"] = null;
    if (roundSets.length > 0) {
      sets.push(...roundSets);
      dice = rolled.filter((d) => byValue.get(d.value)!.length < 2).map((d) => d.sides);
    } else if (tokensLeft > 0) {
      tokensLeft -= 1;
      discarded = "token";
    } else {
      const index = chooseDiscard(rolled);
      discarded = rolled[index];
      dice = rolled.filter((_, i) => i !== index).map((d) => d.sides);
    }
    rounds.push({ rolled, sets: roundSets, discarded });
  }

  return {
    rounds,
    sets,
    mealRating: sets.reduce((sum, s) => sum + s.value, 0),
    lastDie: dice.length === 1 ? dice[0] : null,
    tokensLeft,
  };
}

/** Bloom table (p.277): the Hope Die result picks the flavor, strength 1. */
export function bloomFlavor(hopeDie: number): Flavor {
  if (!Number.isInteger(hopeDie) || hopeDie < 1 || hopeDie > 12) throw new RangeError("The Hope Die shows 1–12.");
  return FLAVORS[Math.ceil(hopeDie / 2) - 1];
}

export function rollBloom(roll: Roll): { hopeDie: number; flavor: Flavor; strength: 1 } {
  const hopeDie = roll(12);
  return { hopeDie, flavor: bloomFlavor(hopeDie), strength: 1 };
}

/**
 * Hit Point Guide (p.277): ingredients from a beast's maximum HP. The book
 * skips 11; it yields 3 (user default).
 */
export function harvestCount(maxHp: number): number {
  if (maxHp <= 4) return 1;
  if (maxHp <= 7) return 2;
  if (maxHp <= 11) return 3;
  return 4;
}
