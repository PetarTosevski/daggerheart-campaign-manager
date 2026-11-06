// Journey to Horizon hex-crawl rules (Hope & Fear pp.171, 176–177). Pure and
// deterministic given the injected `roll`.

/** Rolls one die with the given number of sides, returning 1..sides. */
export type Roll = (sides: number) => number;

/** Terrain rating 1–4 (p.171). */
export type Terrain = 1 | 2 | 3 | 4;
export const TERRAIN_LABEL: Record<Terrain, string> = { 1: "Optimal", 2: "Fair", 3: "Rough", 4: "Extreme" };

export type TravelMode = "land" | "riverDown" | "riverUp" | "ocean";
export const OCEAN_WEATHER: Record<Terrain, string> = { 1: "Tailwind", 2: "Fair weather", 3: "Rough waters", 4: "Extreme weather" };

function assertTerrain(terrain: number): asserts terrain is Terrain {
  if (!Number.isInteger(terrain) || terrain < 1 || terrain > 4) throw new RangeError("Terrain rating must be 1–4.");
}

/**
 * Days to enter a hex. Land: the terrain rating (Optimal 1 … Extreme 4).
 * Downstream by boat: rating − 1, at least 1 day (user default). Upstream: one
 * extra day. Ocean: roll a d4 for the weather, which is the days (p.177).
 */
export function travelDays(terrain: number, mode: TravelMode, roll: Roll): { days: number; weatherRoll?: number } {
  if (mode === "ocean") {
    const weatherRoll = roll(4);
    return { days: weatherRoll, weatherRoll };
  }
  assertTerrain(terrain);
  if (mode === "riverDown") return { days: Math.max(1, terrain - 1) };
  if (mode === "riverUp") return { days: terrain + 1 };
  return { days: terrain };
}

/**
 * Encounter roll on entering a hex (p.176): as many dice as the terrain
 * rating — d6 by default, d4 for dangerous areas or d8 for safer ones. Any 1
 * activates an encounter; otherwise the GM may spend a Fear to activate one.
 */
export function encounterRoll(terrain: number, roll: Roll, sides: 4 | 6 | 8 = 6): { dice: number[]; encounter: boolean } {
  assertTerrain(terrain);
  const dice = Array.from({ length: terrain }, () => roll(sides));
  return { dice, encounter: dice.includes(1) };
}

/** Encounter-table entries with an optional bonus (HF p.171). */
export const SETBACK_ENTRY = 4;
export const GOOD_FORTUNE_ENTRY = 12;

export type EncounterBonus = { kind: "fear"; amount: number } | { kind: "hope" } | null;

/**
 * The optional bonus of an Encounter-table entry (HF p.171) when the campaign's
 * "Horizon encounter bonuses" switch is on: 4 "temporary setback … Optional: The
 * GM gains a Fear for each PC"; 12 "a bit of good fortune … Optional: Each PC
 * gains a Hope". `on` defaults to off (the switch's default), so an unwired
 * caller gets no bonus. Other entries never have one.
 */
export function encounterBonus(total: number, pcCount: number, on = false): EncounterBonus {
  if (!on) return null;
  if (total === SETBACK_ENTRY) return { kind: "fear", amount: Math.max(0, Math.floor(pcCount)) };
  if (total === GOOD_FORTUNE_ENTRY) return { kind: "hope" };
  return null;
}
