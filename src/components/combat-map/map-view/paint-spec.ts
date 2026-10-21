/**
 * A stored combat map layout as the painter's input (D9 C3). C2's `PaintSpec` is structural; C1's `MapSpec` (the
 * cleaned layout) is assignable to it (checked in tests/convex/combat-maps.test.ts), and so is what the layout
 * queries return once the object ids are dropped. Sprite packs P6 adds the sprite painter's spec (refs, setting,
 * texture cells). Pure: no React, no Convex client (only the shared cell-code constant).
 */

import { TEXTURE_CODES } from "../../../../convex/lib/validators/combatMaps";
import type { SpritePaintArea, SpritePaintSpec, UploadedSprites } from "../../../lib/combat-map/sprites/painter";
import type { PaintObject, PaintSpec } from "../../../lib/combat-map/raster";
import { pickSetting } from "../../../lib/sprite-packs/pick-setting";
import { isSettingId } from "../../../lib/sprite-packs/settings";
import type { SpriteRef } from "../../../lib/sprite-packs/traits";
import { CELL_TILE_ROWS } from "./cells";

/** The parts of a layout (`api.combatMaps.get` / `live`) the painter reads. */
export type PaintableLayout = {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly base: string;
  readonly plankV?: boolean;
  readonly areas: PaintSpec["areas"];
  readonly objects: ReadonlyArray<PaintObject & { readonly _id: string }>;
};

/** The painter's spec for a stored layout (objects without their ids, optional keys only when set). */
export function toPaintSpec(layout: PaintableLayout): PaintSpec {
  return {
    w: layout.w,
    h: layout.h,
    seed: layout.seed,
    base: layout.base,
    ...(layout.plankV === undefined ? {} : { plankV: layout.plankV }),
    areas: layout.areas,
    objects: layout.objects.map(({ _id, ...object }) => (void _id, object)),
  };
}

// ---------------------------------------------------------------------------------------------------- Sprites style

/** The parts of a layout the sprite painter reads on top of the Classic ones (sprite packs P6). */
export type SpritePaintableLayout = Omit<PaintableLayout, "areas" | "objects"> & {
  readonly name: string;
  readonly prompt?: string;
  readonly areas: ReadonlyArray<SpritePaintArea>;
  readonly objects: ReadonlyArray<PaintObject & { readonly _id: string; readonly sprite?: SpriteRef }>;
  readonly setting?: { readonly builtin: string } | { readonly pack: string };
  readonly texturePalette?: ReadonlyArray<SpriteRef>;
  readonly textureCells?: ReadonlyArray<{ readonly tile: number; readonly cells: string }>;
};

/**
 * The built-in setting the sprite painter maps Classic kinds and terrains to (D1, D7): the stored built-in setting,
 * common only for a GM pack (its own sprites are drawn through refs), else the keyword pick (maps never switched to
 * Sprites; `setStyle` stores this same pick on the first switch).
 */
export function paintSetting(layout: Pick<SpritePaintableLayout, "setting" | "prompt" | "name">): string {
  const s = layout.setting;
  if (s && "builtin" in s) return isSettingId(s.builtin) ? s.builtin : "";
  if (s && "pack" in s) return "";
  return pickSetting(layout.prompt ?? "", layout.name);
}

/** Whether the layout references an uploaded sprite anywhere (then the canvas needs `spriteSources`). */
export function hasUploadedRefs(layout: Pick<SpritePaintableLayout, "objects" | "areas" | "texturePalette">): boolean {
  const up = (ref: SpriteRef | undefined) => ref !== undefined && "uploaded" in ref;
  return layout.objects.some((o) => up(o.sprite)) || layout.areas.some((a) => up(a.texture)) || (layout.texturePalette ?? []).some(up);
}

/** The "texture" layer decoded: square key -> the palette's ref (TEXTURE_CODES[i] = texturePalette[i]). */
export function decodeTextureCells(layout: Pick<SpritePaintableLayout, "w" | "h" | "texturePalette" | "textureCells">): Record<string, SpriteRef> {
  const out: Record<string, SpriteRef> = {};
  const palette = layout.texturePalette ?? [];
  for (const { tile, cells } of layout.textureCells ?? []) {
    const top = tile * CELL_TILE_ROWS;
    for (let i = 0; i < cells.length; i++) {
      const code = TEXTURE_CODES.indexOf(cells[i]!);
      const ref = code >= 0 ? palette[code] : undefined;
      const x = i % layout.w;
      const y = top + Math.floor(i / layout.w);
      if (ref && y < layout.h) out[`${x},${y}`] = ref;
    }
  }
  return out;
}

/** The sprite painter's spec for a stored layout and the uploaded sprites it may draw. */
export function toSpritePaintSpec(layout: SpritePaintableLayout, uploaded: UploadedSprites): SpritePaintSpec {
  return {
    ...toPaintSpec(layout),
    areas: layout.areas,
    objects: layout.objects.map(({ _id, ...object }) => ({ ...object, id: _id })),
    setting: paintSetting(layout),
    textures: decodeTextureCells(layout),
    uploaded,
  };
}
