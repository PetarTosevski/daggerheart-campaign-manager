/**
 * Keyword setting picker (D7, P7's fallback): scores the GM's description and
 * the map name against keyword families per setting, mirroring the families
 * of the Classic keyword layout (src/lib/combat-map/fallback-layout.ts). The
 * highest score wins; ties go to the more specific setting (the order of
 * SETTING_KEYWORDS); no match gives DEFAULT_SETTING.
 */

import { DEFAULT_SETTING, type SettingId } from "./settings";

/**
 * Keyword families, most specific first. Each entry is a word (or stem
 * ending in `*`) matched on word boundaries, case-insensitive.
 */
export const SETTING_KEYWORDS: readonly (readonly [SettingId, readonly string[]])[] = [
  ["mushroom-cavern", ["underdark", "drow", "myconid*", "spore*", "mushroom cave*", "mushroom cavern*", "fungal cave*", "fungal cavern*", "glowing mushroom*", "luminous"]],
  ["volcanic", ["volcan*", "lava", "magma", "obsidian", "ember*", "basalt", "caldera", "eruption", "fire giant*", "molten"]],
  ["sewers", ["sewer*", "drain*", "cistern*", "culvert*", "gutter*", "sludge"]],
  ["ship-deck", ["ship", "ships", "boat", "deck", "galleon", "sail*", "vessel", "pirate*", "frigate", "schooner", "mast", "masts"]],
  ["crypt-and-graveyard", ["crypt*", "tomb*", "graveyard*", "cemetery", "cemeteries", "grave*", "mausole*", "undead", "necropolis", "catacomb*", "ossuary", "barrow*"]],
  ["tavern", ["tavern*", "inn", "inns", "pub", "alehouse", "taproom", "saloon", "brawl", "bar fight"]],
  ["temple", ["temple*", "shrine*", "church*", "cathedral*", "chapel*", "monaster*", "sanctum", "sanctuary", "altar*", "abbey"]],
  ["dungeon", ["dungeon*", "prison*", "cell", "cells", "jail*", "vault*", "labyrinth*", "oubliette", "chamber*", "halls", "torture"]],
  ["castle-interior", ["castle*", "throne*", "palace*", "fortress*", "manor*", "great hall", "hall", "ballroom", "court"]],
  ["town-street-and-market", ["town*", "city", "cities", "market*", "street*", "village*", "square", "bazaar*", "alley*", "plaza", "docks"]],
  ["cave", ["cave*", "cavern*", "tunnel*", "mine", "mines", "underground", "grotto*", "lair", "stalag*"]],
  ["swamp", ["swamp*", "marsh*", "bog*", "fen", "fens", "mire*", "bayou*", "wetland*"]],
  ["snow-and-tundra", ["snow*", "winter*", "frozen", "ice", "icy", "tundra", "glacier*", "blizzard*", "frost*", "arctic"]],
  ["desert", ["desert*", "dune*", "oasis", "sand", "sands", "wasteland*", "scorching"]],
  ["coast-and-beach", ["beach*", "coast*", "shore*", "harbo*", "cove", "pier*", "seaside", "tide*", "sea", "ocean"]],
  ["ruins", ["ruin*", "overgrown", "crumbl*"]],
  ["mountain-and-cliffs", ["mountain*", "cliff*", "ridge*", "peak*", "mountain pass", "ravine*", "canyon*", "ledge*", "crag*", "alpine", "summit"]],
  ["forest", ["forest*", "woods", "wood", "woodland*", "jungle*", "grove*", "thicket*", "glade*", "clearing", "trees"]],
  ["grassland-and-road", ["road*", "meadow*", "field*", "farm*", "plain*", "grassland*", "hill*", "bridge*", "crossroad*", "prairie", "pasture*"]],
];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(words: readonly string[]): RegExp[] {
  return words.map((w) => {
    const stem = w.endsWith("*");
    const body = escape(stem ? w.slice(0, -1) : w).replace(/ /g, "\\s+");
    return new RegExp(`\\b${body}${stem ? "\\w*" : "\\b"}`, "i");
  });
}

const FAMILIES: readonly (readonly [SettingId, readonly RegExp[]])[] = SETTING_KEYWORDS.map(([id, words]) => [
  id,
  compile(words),
]);

/** Score per setting: how many of its keywords occur (each counted once). */
export function scoreSettings(text: string): ReadonlyMap<SettingId, number> {
  const scores = new Map<SettingId, number>();
  for (const [id, patterns] of FAMILIES) {
    const score = patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
    if (score > 0) scores.set(id, score);
  }
  return scores;
}

/** The built-in setting for a description (and optional map name); DEFAULT_SETTING when nothing matches. */
export function pickSetting(description: string, name = ""): SettingId {
  const scores = scoreSettings(`${description} ${name}`);
  let best: SettingId = DEFAULT_SETTING;
  let bestScore = 0;
  for (const [id] of FAMILIES) {
    const score = scores.get(id) ?? 0;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}
