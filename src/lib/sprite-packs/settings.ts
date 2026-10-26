/**
 * Built-in sprite settings (D7): the 19 setting folders of
 * docs/sprite-packs/prompts.md. `common` is a folder too, but never a
 * setting: it is always added to the chosen one.
 */

export const SETTING_IDS = [
  "forest",
  "grassland-and-road",
  "mountain-and-cliffs",
  "cave",
  "dungeon",
  "crypt-and-graveyard",
  "castle-interior",
  "tavern",
  "town-street-and-market",
  "temple",
  "swamp",
  "snow-and-tundra",
  "desert",
  "coast-and-beach",
  "ship-deck",
  "sewers",
  "ruins",
  "mushroom-cavern",
  "volcanic",
] as const;
export type SettingId = (typeof SETTING_IDS)[number];

/** The shared folder every setting draws on; not offered as a setting. */
export const COMMON_FOLDER = "common";

/** Every built-in folder: the settings plus common. */
export type FolderId = SettingId | typeof COMMON_FOLDER;

/** The setting used when nothing else decides (D7). */
export const DEFAULT_SETTING: SettingId = "grassland-and-road";

export const SETTING_LABEL: Readonly<Record<SettingId, string>> = {
  forest: "Forest",
  "grassland-and-road": "Grassland and road",
  "mountain-and-cliffs": "Mountain and cliffs",
  cave: "Cave",
  dungeon: "Dungeon",
  "crypt-and-graveyard": "Crypt and graveyard",
  "castle-interior": "Castle interior",
  tavern: "Tavern",
  "town-street-and-market": "Town street and market",
  temple: "Temple",
  swamp: "Swamp",
  "snow-and-tundra": "Snow and tundra",
  desert: "Desert",
  "coast-and-beach": "Coast and beach",
  "ship-deck": "Ship deck",
  sewers: "Sewers",
  ruins: "Ruins",
  "mushroom-cavern": "Mushroom cavern (Underdark)",
  volcanic: "Volcanic",
};

/** The settings offered in the Setting picker, in the prompts doc's order. */
export const SETTINGS: readonly { readonly id: SettingId; readonly label: string }[] = SETTING_IDS.map((id) => ({
  id,
  label: SETTING_LABEL[id],
}));

const SETTING_SET: ReadonlySet<string> = new Set(SETTING_IDS);

export function isSettingId(id: string): id is SettingId {
  return SETTING_SET.has(id);
}
