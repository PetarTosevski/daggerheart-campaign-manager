// Journey to Horizon hex crawl: region generation, Soul Echo sanctuaries and
// Locate Soul Echoes (Hope & Fear pp.169–176; frame-trackers-spec §10,
// dcm-bxp.17). Pure and deterministic given the injected `roll`: bundled into
// Convex, so no framework imports.

import { z } from "zod";

import type { Roll } from "../domain/frames/horizon";
import { RuleError } from "../errors/app-error";
import { hexDistance, hexKey, type Hex } from "./hex";

// ---- Habitat (d20), HF p.170

export const HABITAT_IDS = [
  "shadowblighted",
  "underground",
  "aquatic",
  "wetland",
  "grassland",
  "tropical",
  "forest",
  "drylands",
  "rolling",
  "mountain",
  "frozen",
  "badlands",
] as const;
export type HabitatId = (typeof HABITAT_IDS)[number];

/** The Habitat table: the d20 range, the habitat's name and its examples (HF p.170). */
export const HABITATS: Record<HabitatId, { from: number; to: number; label: string; examples: string }> = {
  shadowblighted: { from: 1, to: 1, label: "Shadowblighted", examples: "Roll again for the habitat fallen stars corrupted; another 1: the region is overtaken" },
  underground: { from: 2, to: 2, label: "Underground", examples: "Caves, mines, fungal forests" },
  aquatic: { from: 3, to: 4, label: "Aquatic", examples: "Lake, sea, reef, delta" },
  wetland: { from: 5, to: 6, label: "Wetland", examples: "Swamp, marsh, bog, fen" },
  grassland: { from: 7, to: 8, label: "Grassland", examples: "Plains, veldt, savannah" },
  tropical: { from: 9, to: 10, label: "Tropical", examples: "Jungle, rainforest, mangrove" },
  forest: { from: 11, to: 12, label: "Forest", examples: "Deciduous, evergreen, coniferous" },
  drylands: { from: 13, to: 14, label: "Drylands", examples: "Desert, canyon, prairie, salt flat" },
  rolling: { from: 15, to: 16, label: "Rolling", examples: "Hills, chaparral, moor, heath" },
  mountain: { from: 17, to: 18, label: "Mountain", examples: "Plateau, montane, alpine" },
  frozen: { from: 19, to: 19, label: "Frozen", examples: "Tundra, taiga, glacier" },
  badlands: { from: 20, to: 20, label: "Badlands", examples: "Volcano, crystalline, barren" },
};

export function habitatForRoll(d20: number): HabitatId {
  const found = HABITAT_IDS.find((id) => d20 >= HABITATS[id].from && d20 <= HABITATS[id].to);
  if (!found) throw new RangeError("A habitat roll is a d20.");
  return found;
}

/**
 * The region's habitat (HF p.170): "1 Shadowblighted: Roll again to
 * determine which kind of habitat has been corrupted by fallen stars. If you
 * roll another 1, the entire region has been completely overtaken and is nigh
 * impossible to traverse." With the Doom Track's Tier 2 rule in force ("a
 * habitat roll of 1 counts as a double 1", HF p.186), a first 1 is already
 * the overtaken region.
 */
export function rollHabitat(roll: Roll, oneIsDouble: boolean): { rolls: number[]; habitat: HabitatId; shadowblighted: boolean; impassable: boolean } {
  const first = roll(20);
  if (first !== 1) return { rolls: [first], habitat: habitatForRoll(first), shadowblighted: false, impassable: false };
  if (oneIsDouble) return { rolls: [first], habitat: "shadowblighted", shadowblighted: true, impassable: true };
  const second = roll(20);
  if (second === 1) return { rolls: [first, second], habitat: "shadowblighted", shadowblighted: true, impassable: true };
  return { rolls: [first, second], habitat: habitatForRoll(second), shadowblighted: true, impassable: false };
}

/** "Shadowblighted Forest", "Forest", or the overtaken region's label. */
export function habitatLabel(region: { habitat: HabitatId; shadowblighted: boolean; impassable: boolean }): string {
  if (region.impassable) return "Shadowblighted (overtaken)";
  const base = HABITATS[region.habitat].label;
  return region.shadowblighted ? `Shadowblighted ${base}` : base;
}

// ---- Encounter (d8 + d6), HF p.171

export const MIN_ENCOUNTER = 2;
export const MAX_ENCOUNTER = 14;

/** The Encounter table, shortened to the entry's subject (HF p.171 has the full text). */
export const ENCOUNTERS: Record<number, string> = {
  2: "Roll on this table twice and combine the entries",
  3: "Fellow travelers (pilgrims, merchants, explorers)",
  4: "A temporary setback (dead end, bad omen, spoiled rations, damaged tools). Optional: the GM gains a Fear for each PC",
  5: "The Seekers-in-Shadow make their presence known",
  6: "An extreme weather event",
  7: "Potential adversaries (bandits, brigands, mercenaries) or signs of them",
  8: "The lair or hunting grounds of a territorial beast or pack",
  9: "An environmental hazard or obstacle",
  10: "The Cult of the Two-Headed Coin, their agents or signs of them",
  11: "A wondrous or dangerous site worth exploring",
  12: "A bit of good fortune (shortcut, good omen, helpful resource). Optional: each PC gains a Hope",
  13: "A settlement or an outpost",
  14: "A cache of loot or treasure",
};

export function rollEncounter(roll: Roll): { dice: [number, number]; total: number } {
  const dice: [number, number] = [roll(8), roll(6)];
  return { dice, total: dice[0] + dice[1] };
}

// ---- Regions

/** Most regions one crawl stores (each region is its own row). */
export const MAX_REGIONS = 500;
/** Most encounters one region lists (its rolled one plus those the GM adds). */
export const MAX_REGION_ENCOUNTERS = 12;
export const REGION_NAME_MAX = 60;
export const RUMOR_TEXT_MAX = 300;

const d = (sides: number) => z.number().int().min(1).max(sides);

export const regionEncounterSchema = z.object({
  dice: z.tuple([d(8), d(6)]),
  total: z.number().int().min(MIN_ENCOUNTER).max(MAX_ENCOUNTER),
  used: z.boolean(),
});

export const regionNameSchema = z.string().trim().min(1, "Name the region.").max(REGION_NAME_MAX, `Keep the region name under ${REGION_NAME_MAX + 1} characters.`);

/** One wilderness region (HF p.170): stored in its own `frameTrackers` row (`regionKey`). */
export const regionSchema = z.object({
  id: z.number().int().min(1),
  name: regionNameSchema,
  habitatRolls: z.array(d(20)).min(1).max(2),
  habitat: z.enum(HABITAT_IDS),
  shadowblighted: z.boolean(),
  /** "Completely overtaken and nigh impossible to traverse" (HF p.170). Shown, not enforced on travel. */
  impassable: z.boolean(),
  /** d12: how many contiguous hexes the GM paints with the region. */
  size: d(12),
  terrain: z.number().int().min(1).max(4),
  encounters: z.array(regionEncounterSchema).min(1).max(MAX_REGION_ENCOUNTERS),
  /** d100 (100 for "00") on the Rumors table (HF pp.172–173); the GM writes the text. Players see it once known. */
  rumor: z.object({ roll: d(100), text: z.string().max(RUMOR_TEXT_MAX), known: z.boolean() }),
  createdAt: z.number(),
});
export type Region = z.infer<typeof regionSchema>;

/** The `frameTrackers` key of a region's row; zero-padded so keys sort by id. */
export const REGION_KEY_PREFIX = "horizonRegion:";
export const regionKey = (id: number) => `${REGION_KEY_PREFIX}${String(id).padStart(6, "0")}`;

/**
 * "Filling wilderness hexes" (HF p.170): d20 habitat, d12 size, d8+d6 encounter,
 * d4 terrain and d100 rumor. Painting the hexes is the GM's ("The shape of
 * the region can be whatever you want").
 */
export function generateRegion(roll: Roll, input: { id: number; name: string; oneIsDouble: boolean; now: number }): Region {
  const habitat = rollHabitat(roll, input.oneIsDouble);
  const size = roll(12);
  const encounter = rollEncounter(roll);
  const terrain = roll(4);
  const rumor = roll(100);
  return {
    id: input.id,
    name: input.name,
    habitatRolls: habitat.rolls,
    habitat: habitat.habitat,
    shadowblighted: habitat.shadowblighted,
    impassable: habitat.impassable,
    size,
    terrain,
    encounters: [{ ...encounter, used: false }],
    rumor: { roll: rumor, text: "", known: false },
    createdAt: input.now,
  };
}

/** Another Encounter-table roll for the region (a 2 asks for two more; more than one encounter in a region, HF p.176). */
export function addRegionEncounter(region: Region, roll: Roll): Region {
  if (region.encounters.length >= MAX_REGION_ENCOUNTERS) throw new RuleError("TRACKER_RULE", `A region lists at most ${MAX_REGION_ENCOUNTERS} encounters.`);
  return { ...region, encounters: [...region.encounters, { ...rollEncounter(roll), used: false }] };
}

export function setEncounterUsed(region: Region, index: number, used: boolean): Region {
  if (!Number.isInteger(index) || index < 0 || index >= region.encounters.length) throw new RuleError("TRACKER_RULE", "That encounter is gone.");
  return { ...region, encounters: region.encounters.map((e, i) => (i === index ? { ...e, used } : e)) };
}

// ---- Soul Echoes, Locate Soul Echoes (HF pp.169, 176)

/** "Choose nine sanctuaries in which a Soul Echo can be located" (HF p.169). */
export const MAX_ECHO_SANCTUARIES = 9;

export const BEARINGS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "here"] as const;
export type Bearing = (typeof BEARINGS)[number];

export const BEARING_LABEL: Record<Bearing, string> = {
  north: "North",
  northeast: "Northeast",
  east: "East",
  southeast: "Southeast",
  south: "South",
  southwest: "Southwest",
  west: "West",
  northwest: "Northwest",
  here: "Here, in the party's hex",
};

/** The crawl's campaign-level state (`frameTrackers` key HORIZON_CRAWL_KEY). */
export const crawlStateSchema = z.object({
  nextRegionId: z.number().int().min(1),
  regionCount: z.number().int().min(0).max(MAX_REGIONS),
  /** The sanctuary markers (`MapToken.id`) holding a Soul Echo. GM only. */
  echoes: z.array(z.object({ tokenId: z.number().int().min(1), collected: z.boolean() })).max(MAX_ECHO_SANCTUARIES),
  /** The last Locate Soul Echoes: players see the bearing and day only. */
  located: z
    .object({
      bearing: z.enum(BEARINGS),
      day: z.number().int().min(1),
      /** The sanctuary it points at. GM only. */
      tokenId: z.number().int().min(1),
      /** "At the GM's discretion, using this downtime move alerts nearby Seekers-in-Shadow" (HF p.176). GM only. */
      seekersAlerted: z.boolean(),
    })
    .nullable(),
});
export type CrawlState = z.infer<typeof crawlStateSchema>;

export const HORIZON_CRAWL_KEY = "horizonCrawl";
export const INITIAL_CRAWL_STATE: CrawlState = { nextRegionId: 1, regionCount: 0, echoes: [], located: null };

export function setEcho(state: CrawlState, tokenId: number, hasEcho: boolean): CrawlState {
  const others = state.echoes.filter((e) => e.tokenId !== tokenId);
  if (!hasEcho) return { ...state, echoes: others };
  if (others.length !== state.echoes.length) return state;
  if (state.echoes.length >= MAX_ECHO_SANCTUARIES) throw new RuleError("TRACKER_RULE", `Soul Echoes wait in ${MAX_ECHO_SANCTUARIES} sanctuaries.`);
  return { ...state, echoes: [...state.echoes, { tokenId, collected: false }] };
}

export function collectEcho(state: CrawlState, tokenId: number): CrawlState {
  const echo = state.echoes.find((e) => e.tokenId === tokenId);
  if (!echo) throw new RuleError("TRACKER_RULE", "That sanctuary holds no Soul Echo.");
  if (echo.collected) throw new RuleError("TRACKER_RULE", "That Soul Echo is already in the Vessel.");
  return { ...state, echoes: state.echoes.map((e) => (e.tokenId === tokenId ? { ...e, collected: true } : e)) };
}

/**
 * The 8-point bearing from one map point to another (image pixels, y down):
 * "the direction (north, south, east, west, or a combination)" (HF p.176).
 */
export function bearing(from: { x: number; y: number }, to: { x: number; y: number }): Exclude<Bearing, "here"> {
  const angle = (Math.atan2(from.y - to.y, to.x - from.x) * 180) / Math.PI; // 0 = east, 90 = north
  const sector = Math.round((((90 - angle) % 360) + 360) % 360 / 45) % 8; // 0 = north, clockwise
  return (["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const)[sector];
}

/**
 * Locate Soul Echoes: "the nearest sanctuary with a Soul Echo at its shrine"
 * (HF p.176), nearest by hexes from the party. Among equally near ones the
 * lowest marker id (an open question: dcm-bxp.17). Null when none is left.
 */
export function nearestEcho<T extends { tokenId: number; hex: Hex }>(party: Hex, sanctuaries: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of sanctuaries) {
    if (best === null) best = s;
    else {
      const d = hexDistance(party, s.hex) - hexDistance(party, best.hex);
      if (d < 0 || (d === 0 && s.tokenId < best.tokenId)) best = s;
    }
  }
  return best;
}

/** The bearing from the party's hex to the sanctuary's: "here" in the same hex. */
export function echoBearing(party: Hex, partyAt: { x: number; y: number }, sanctuary: { hex: Hex; at: { x: number; y: number } }): Bearing {
  return hexKey(party) === hexKey(sanctuary.hex) ? "here" : bearing(partyAt, sanctuary.at);
}
