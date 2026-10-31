/**
 * The area-effect cutter (plan lanes-2 wave 9, tracer AO; dcm-lqnt): the six generated area sheets
 * (docs/sprite-packs/area-effects-prompts.md) -> one WebP per kind under public/area-effects/ and the generated
 * manifest src/lib/combat-map/area-effects/manifest.ts. Same cut core as the sprite packs (src/lib/sprite-packs/cut):
 *
 * - fills (`fills-1` .. `fills-4`, 2 x 2 swatches): `cutTerrain`, resized to FILL_PX square; tiled fills are seam-fixed
 *   (when that tiles better), the swirl fills (SCALED_FILLS) are kept as drawn. Opaque WebP.
 * - decals (`decals`, 3 x 3) and walls (`walls`, 4 rows): `cutSheet` finds each object's box; the object is then
 *   unmixed from the magenta (`unmix`: alpha from how far a pixel leans to #FF00FF), which keeps the soft glows and the
 *   see-through bubbles (moonlight, silence, healing barrier) that a hard key would cut away. Decals are padded to a
 *   centred square of DECAL_PX; walls resized to WALL_PX high. WebP with alpha.
 *
 * Content-hashed file names (`<kind>.<hash8>.webp`), so the files are served immutable like the sprite packs (D8).
 */

import { createHash } from "node:crypto";

import sharp from "sharp";

import { DECAL_KINDS, FILL_SHEETS, SCALED_FILLS, WALL_KINDS, type AreaKind, type AreaSheet, type FillKind } from "../../../src/lib/combat-map/area-effects/kinds";
import type { AreaManifest, AreaManifestEntry } from "../../../src/lib/combat-map/area-effects/manifest-schema";
import { cutSheet, cutTerrain, seamFix, tileability } from "../../../src/lib/sprite-packs/cut";
import type { RgbaImage } from "../../../src/lib/sprite-packs/cut";
import { unmix } from "./pipeline";

/** Pixels per side of a fill swatch (the overlay tiles it every FILL_TILE_SQUARES squares). */
export const FILL_PX = 512;
/** Pixels per side of a decal (drawn scaled to the area's circle). */
export const DECAL_PX = 512;
/** Pixels of a wall strip's thickness (drawn one square thick, repeated along the line). */
export const WALL_PX = 128;
/** Size budgets per file (as the sprite packs' textures and objects). */
export const FILL_BUDGET = 200 * 1024;
export const CUTOUT_BUDGET = 120 * 1024;

const DECAL_GRID = { rows: 3, cols: 3 } as const;
const WALL_GRID = { rows: 4, cols: 1 } as const;

export type AreaCut = { kind: AreaKind; sheet: AreaSheet; image: RgbaImage; alpha: boolean; notes: string[] };

export type SheetSource = { sheet: AreaSheet; image: RgbaImage };

function raw(img: RgbaImage) {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } });
}

async function toRgba(pipe: ReturnType<typeof sharp>): Promise<RgbaImage> {
  const { data, info } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Decodes an image file to RGBA. */
export function decodeFile(file: string): Promise<RgbaImage> {
  return toRgba(sharp(file));
}

async function resize(img: RgbaImage, w: number, h: number, fit: "inside" | "fill" | "contain"): Promise<RgbaImage> {
  return toRgba(raw(img).resize(w, h, { fit, kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } }));
}

/** The four fills of a fill sheet, in the prompts doc's order. */
export async function cutFills(sheet: keyof typeof FILL_SHEETS, image: RgbaImage): Promise<AreaCut[]> {
  const kinds: readonly FillKind[] = FILL_SHEETS[sheet];
  const terrain = cutTerrain(image);
  const flags = terrain.flags.map((f) => f.code + ("axis" in f ? ` ${f.axis}` : "") + ("index" in f ? ` #${f.index + 1}` : ""));
  const out: AreaCut[] = [];
  for (const swatch of terrain.swatches) {
    const kind = kinds[swatch.index];
    if (kind === undefined) continue;
    const sized = await resize(swatch.image, FILL_PX, FILL_PX, "fill");
    const notes = [...flags];
    let final = sized;
    if (!SCALED_FILLS.has(kind)) {
      const fixed = seamFix(sized);
      const before = tileability(sized);
      const after = tileability(fixed);
      if (after >= before) final = fixed;
      notes.push(`tileability ${before.toFixed(2)} -> ${Math.max(before, after).toFixed(2)}`);
    } else notes.push("scaled (no seam fix)");
    out.push({ kind, sheet, image: final, alpha: false, notes });
  }
  return out;
}

/** The objects of a decal or wall sheet, unmixed from the magenta, in reading order. */
async function cutOuts(sheet: "decals" | "walls", image: RgbaImage): Promise<AreaCut[]> {
  const grid = sheet === "decals" ? DECAL_GRID : WALL_GRID;
  const kinds: readonly AreaKind[] = sheet === "decals" ? DECAL_KINDS : WALL_KINDS;
  const cut = cutSheet(image, { layout: grid });
  const flags = cut.flags.filter((f) => f.code === "count-mismatch" || f.code === "components-fallback").map((f) => f.code);
  const out: AreaCut[] = [];
  for (const sprite of cut.sprites) {
    const kind = kinds[sprite.index];
    if (kind === undefined) continue;
    const soft = unmix(image, sprite.box, grid);
    const sized =
      sheet === "decals"
        ? await resize(soft, DECAL_PX, DECAL_PX, "contain")
        : await resize(soft, Math.max(1, Math.round((soft.width * WALL_PX) / soft.height)), WALL_PX, "fill");
    out.push({ kind, sheet, image: sized, alpha: true, notes: [...flags] });
  }
  return out;
}

/** Cuts one sheet into its kinds. */
export function cutAreaSheet(source: SheetSource): Promise<AreaCut[]> {
  if (source.sheet === "decals" || source.sheet === "walls") return cutOuts(source.sheet, source.image);
  return cutFills(source.sheet as keyof typeof FILL_SHEETS, source.image);
}

export type EncodedArea = { cut: AreaCut; file: string; bytes: Buffer; quality: number };

/** WebP with a content hash; the quality steps down until the file fits its budget. */
export async function encodeArea(cut: AreaCut): Promise<EncodedArea> {
  const budget = cut.alpha ? CUTOUT_BUDGET : FILL_BUDGET;
  let quality = 80;
  for (;;) {
    const pipe = raw(cut.image);
    const bytes = await (cut.alpha ? pipe.webp({ quality, alphaQuality: 90, effort: 6 }) : pipe.removeAlpha().webp({ quality, effort: 6, smartSubsample: true })).toBuffer();
    if (bytes.length <= budget || quality <= 40) {
      if (bytes.length > budget) throw new Error(`${cut.kind}: ${bytes.length} bytes over the ${budget} budget at q${quality}`);
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
      return { cut, file: `${cut.kind}.${hash}.webp`, bytes, quality };
    }
    quality -= 6;
  }
}

/** The manifest of the encoded kinds (every kind in AREA_KINDS order that was cut). */
export function areaManifest(encoded: readonly EncodedArea[]): AreaManifest {
  const kinds: Partial<Record<AreaKind, AreaManifestEntry>> = {};
  for (const e of encoded) kinds[e.cut.kind] = { file: e.file, px: { w: e.cut.image.width, h: e.cut.image.height } };
  return { schemaVersion: 1, kinds };
}
