/**
 * Sprite labels of the GM upload screen (sprite packs P8), pure and framework-free (relative imports only) so the
 * server (`convex/spritePacks.ts`) and the browser share them: the sheet layouts, the label defaults, the Classic
 * look suggestion and D2's light rule for the Classic fallback.
 */

import type { CombatObjectKind, CombatTerrain, SightMode } from "../../../../convex/lib/validators/combatMaps";
import type { SpriteCategory, SpriteHeight, SpriteLight } from "../../../../convex/lib/validators/spritePacks";

// ---------------------------------------------------------------- sheet layouts

/** The "Sheet layout" choices (docs/sprite-packs/prompts.md): what the cut expects and the labels it starts with. */
export const SHEET_LAYOUTS = ["auto", "props", "large", "terrain", "single"] as const;
export type SheetLayout = (typeof SHEET_LAYOUTS)[number];

export const SHEET_LAYOUT_INFO: Readonly<
  Record<SheetLayout, { label: string; expected: number | null; size: number; category: SpriteCategory }>
> = {
  auto: { label: "Auto", expected: null, size: 1, category: "object" },
  props: { label: "Props 4 × 4", expected: 16, size: 1, category: "object" },
  large: { label: "Large 3 × 3", expected: 9, size: 2, category: "object" },
  terrain: { label: "Terrain 2 × 2", expected: 4, size: 4, category: "texture" },
  single: { label: "Single sprite", expected: 1, size: 1, category: "object" },
};

// ---------------------------------------------------------------- limits shared with the server

/** A dropped sheet: at most this many bytes and pixels per side (read locally, never uploaded, D9). */
export const MAX_SHEET_BYTES = 20 * 1024 * 1024;
export const MAX_SHEET_PX = 4096;
/** Pixels per square side an object sprite is encoded at (the built-in packs' SPRITE_PX_PER_SQUARE). */
export const SPRITE_PX_PER_SQUARE = 160;
/** Pixels per side of an encoded terrain texture (one swatch covers TEXTURE_SQUARES squares, as built in). */
export const TEXTURE_PX = 512;

// ---------------------------------------------------------------- Classic look (D1, D2)

/** Classic kinds that are map lights, by the sprite light they stand for (D2: same reach). */
const LIGHT_KIND: Readonly<Partial<Record<SpriteLight, CombatObjectKind>>> = { torch: "torch", campfire: "campfire" };
const LIGHT_KINDS: ReadonlySet<CombatObjectKind> = new Set(["torch", "walltorch", "campfire"]);

/** The Classic kinds a GM can pick as a sprite's Classic look, in the order the picker lists them. */
export const CLASSIC_LOOKS: readonly CombatObjectKind[] = [
  "tree",
  "bush",
  "deadtree",
  "rock",
  "boulder",
  "tent",
  "log",
  "crate",
  "barrel",
  "chest",
  "table",
  "pillar",
  "statue",
  "rubble",
  "mast",
  "mushroom",
  "crystal",
  "bones",
  "hull",
  "torch",
  "walltorch",
  "campfire",
];

/**
 * D2: a sprite's Classic fallback lights exactly like the sprite. A torch-like sprite falls back to a torch or wall
 * torch, a campfire-like one to a campfire, and a sprite that gives no light (or only a faint glow, which no Classic
 * kind has) never to a light kind.
 */
export function classicFits(kind: CombatObjectKind, light: SpriteLight): boolean {
  if (light === "torch") return kind === "torch" || kind === "walltorch";
  if (light === "campfire") return kind === "campfire";
  return !LIGHT_KINDS.has(kind);
}

/** The Classic look suggested from a sprite's labels (size, sight, light); always `classicFits`. */
export function suggestClassic(labels: { category: SpriteCategory; w: number; h: number; sight: SightMode; light: SpriteLight }): CombatObjectKind {
  const lightKind = LIGHT_KIND[labels.light];
  if (lightKind) return lightKind;
  if (labels.light === "faintglow") return "crystal";
  if (labels.category === "texture") return "rubble";
  const big = labels.w * labels.h >= 4;
  if (labels.sight === "block") return big ? "boulder" : "pillar";
  if (labels.sight === "cover") return big ? "table" : "crate";
  return "rubble";
}

/** The Classic look kept after the light changes: the current one when it still fits (D2), else the suggestion. */
export function classicAfterLight(
  current: CombatObjectKind,
  labels: { category: SpriteCategory; w: number; h: number; sight: SightMode; light: SpriteLight },
): CombatObjectKind {
  return classicFits(current, labels.light) ? current : suggestClassic(labels);
}

// ---------------------------------------------------------------- label defaults

export type SpriteLabels = {
  name: string;
  category: SpriteCategory;
  w: number;
  h: number;
  sight: SightMode;
  light: SpriteLight;
  height: SpriteHeight;
  classicKind: CombatObjectKind;
  terrain: CombatTerrain;
};

/** Labels a fresh cut starts with: object sheets are 1 x 1 (props) or 2 x 2 (large) cover; terrain swatches are grass textures. */
export function defaultLabels(layout: SheetLayout, index: number): SpriteLabels {
  const info = SHEET_LAYOUT_INFO[layout];
  const category = info.category;
  const size = category === "texture" ? 1 : info.size;
  const sight: SightMode = category === "texture" ? "none" : "cover";
  const base = { category, w: size, h: size, sight, light: "none" as const };
  return {
    name: `${category === "texture" ? "Texture" : "Sprite"} ${index + 1}`,
    ...base,
    height: category === "texture" ? "flat" : "low",
    classicKind: suggestClassic(base),
    terrain: "grass",
  };
}

/** A name the server accepts: 1..max characters after trimming. */
export function cleanName(name: string, max: number): string | null {
  const trimmed = name.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

/** URL-safe slug (as the built-in keys, D8), never empty. */
export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "sprite" : slug;
}

/** `slug`, or `slug-2`, `slug-3`, ... when it is taken. */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`;
}
