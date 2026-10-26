/**
 * The keyword fallback for Sprites maps (plan sprite-packs, tracer P7): without Claude, the Classic keyword layout
 * (src/lib/combat-map/fallback-layout.ts, unchanged, E2/E6) is made from the description steered by the setting,
 * then mapped to the setting with P1's mapping tables (D1) and topped with 0-6 of the setting's flat or cover props
 * in open squares. Deterministic per seed. Framework-free with relative imports (CH6).
 */

import type { Terrain } from "../domain/combat-map/spec";
import { rasterize, rng } from "../combat-map/raster";
import { pickSprite, textureCandidates } from "./mapping";
import { isSettingId, type SettingId } from "./settings";
import type { ClassicLayoutObject, LayoutArea, PaletteEntry, SpriteLayout, SpriteLayoutArea, SpriteLayoutObject, SpritePalette } from "./sprite-layout";

/**
 * Words that send the Classic keyword layout down the branch that fits each setting (ship deck, cavern, rooms and
 * halls, ruins, or an outdoor scene with the right ground). Added to the GM's description, never stored.
 */
export const SETTING_LAYOUT_HINT: Readonly<Record<SettingId, string>> = {
  forest: "forest",
  "grassland-and-road": "meadow road",
  "mountain-and-cliffs": "cliff rocks",
  cave: "cave",
  dungeon: "dungeon",
  "crypt-and-graveyard": "crypt",
  "castle-interior": "castle hall",
  tavern: "hall room",
  "town-street-and-market": "road crates barrels",
  temple: "temple",
  swamp: "swamp",
  "snow-and-tundra": "snow",
  desert: "desert",
  "coast-and-beach": "beach",
  "ship-deck": "ship",
  sewers: "tunnel water",
  ruins: "ruins",
  "mushroom-cavern": "cave mushroom glow",
  volcanic: "cave lava",
};

/** The description the keyword layout reads for a setting: the GM's words plus the setting's hint (built-in only). */
export function fallbackDescription(desc: string, setting: string | null): string {
  return setting !== null && isSettingId(setting) ? `${desc} (${SETTING_LAYOUT_HINT[setting]})` : desc;
}

/** Most props the fallback scatters (acceptance: 0-6). */
export const MAX_SCATTERED_PROPS = 6;

/** Terrain no prop is put on. */
const CLOSED: ReadonlySet<Terrain> = new Set<Terrain>(["wall", "void", "deep", "water", "lava"]);

/** FNV-1a 32-bit, as mapping.ts: deterministic across server and browser. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A cleaned Classic layout as `toLayout` returns it (convex/combatMapGenerate.ts). */
export type ClassicLayout = {
  w: number;
  h: number;
  base: Terrain;
  plankV: boolean;
  title: string;
  areas: LayoutArea[];
  objects: ClassicLayoutObject[];
};

/**
 * Maps a Classic keyword layout to a Sprites layout in `setting` (a built-in id, or null for a GM pack setting,
 * which maps through common only):
 * - every object whose Classic kind has a stand-in in the setting (else common) gets that sprite (D1); others stay
 *   Classic objects, which the painter draws the Classic way;
 * - every area gets a texture of its terrain from the setting (else common) when there is one;
 * - 0-6 of the palette's own 1 x 1 props that are flat or cover are put on open squares (not wall, void, water,
 *   deep or lava; clear of other objects). How many, which and where all follow `seed`.
 * The title becomes the setting's label (the keyword layout's title names its branch, such as "Dungeon halls").
 */
export function spriteFallback<U extends string>(
  layout: ClassicLayout,
  palette: SpritePalette<U>,
  setting: string | null,
  label: string,
  seed: number,
): SpriteLayout<U> {
  const folder = setting ?? "";
  const objects: (SpriteLayoutObject<U> | ClassicLayoutObject)[] = layout.objects.map((o, i) => {
    if (o.points !== undefined && o.points.length > 0) return o;
    const key = pickSprite(o.kind, o.variant, folder, `fallback-${i}`, seed);
    if (key === null) return o;
    // The sprite's own sight and light apply (D3), so the keyword object's overrides are not copied.
    return {
      kind: o.kind,
      x: o.x,
      y: o.y,
      r: o.r,
      rot: o.rot,
      ...(o.variant === undefined ? {} : { variant: o.variant }),
      ...(o.len === undefined ? {} : { len: o.len }),
      ...(o.span === undefined ? {} : { span: o.span }),
      sprite: { builtin: key },
    };
  });
  const areas: SpriteLayoutArea<U>[] = layout.areas.map((a, i) => {
    const list = textureCandidates(a.terrain, folder);
    const pick = list[hash(`area|${i}|${seed}`) % Math.max(1, list.length)];
    return pick ? { ...a, texture: { builtin: pick.key } } : a;
  });

  const props = palette.entries.filter(
    (e): e is PaletteEntry<U> => e.own && e.category === "object" && e.w === 1 && e.h === 1 && (e.sight === "none" || e.sight === "cover"),
  );
  const count = props.length === 0 ? 0 : hash(`props|${seed}`) % (MAX_SCATTERED_PROPS + 1);
  if (count > 0) {
    const grid = rasterize({ w: layout.w, h: layout.h, base: layout.base, areas: layout.areas });
    const open: [number, number][] = [];
    for (let y = 1; y < layout.h - 1; y++) {
      for (let x = 1; x < layout.w - 1; x++) {
        const terrain = grid[y]?.[x];
        if (terrain === undefined || CLOSED.has(terrain)) continue;
        if (objects.some((o) => Math.hypot(o.x - (x + 0.5), o.y - (y + 0.5)) < o.r + 0.6)) continue;
        open.push([x, y]);
      }
    }
    const random = rng(seed);
    for (let n = 0; n < count && open.length > 0; n++) {
      const [x, y] = open.splice(Math.floor(random() * open.length), 1)[0]!;
      const prop = props[Math.floor(random() * props.length)]!;
      objects.push({
        kind: prop.classicKind,
        x: x + 0.5,
        y: y + 0.5,
        r: 0.5,
        rot: Math.round(random() * 4) * (Math.PI / 2),
        ...(prop.classicVariant ? { variant: prop.classicVariant } : {}),
        sprite: prop.ref,
      });
    }
  }
  return { w: layout.w, h: layout.h, base: layout.base, plankV: layout.plankV, title: label, areas, objects };
}
