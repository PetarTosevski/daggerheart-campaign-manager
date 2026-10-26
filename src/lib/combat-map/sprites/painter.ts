// Sprite painter (sprite packs P6): draws a layout in the "Sprites" style with pack sprites, app-added shadows and
// blended, variant-mixed terrain textures. The same layout draws in Classic through ../painter.ts, untouched (D1, E2).
//
// Same interface as the Classic painter, so the map canvas's partial repaints (C5 edits, light switches, C8's player
// view) work the same way:
//   prepareMap(spec, paint)              terrain plan, texture plan and resolved objects, reused across repaints.
//   paintMapRect(ctx, map, rect, opts)   repaint one rectangle in squares; pixel-identical to that area of paintMap.
//   withObjects(map, objects)            the same terrain with another object list.
//   paintMap(ctx, spec, opts)            the whole map.
// Drawing order per rectangle: Classic terrain (and its strokes) -> textures composited over it -> Classic hulls ->
// flat sprites -> shadows -> light glows -> sprites and Classic objects in layout order -> grid -> vignette.
// Pure TypeScript over a CanvasRenderingContext2D (identity transform); images come from `opts.art`.

import {
  DEFAULT_CELL,
  paintMapRect as classicPaintMapRect,
  prepareMap as classicPrepareMap,
  type MapRect,
  type PaintOptions,
  type PreparedMap,
} from "../painter";
import type { PaintSpec, PaintedTerrain } from "../raster";
import type { SpriteRef } from "../../sprite-packs/traits";
import type { SpriteArt } from "./loader";
import {
  blankClassicMap,
  classicObjectContext,
  drawClassicObject,
  drawGlow,
  drawShadow,
  drawSprite,
  placeObject,
  placedBounds,
  spriteReady,
  type PlacedObject,
  type SpritePaintObject,
} from "./objects";
import type { UploadedSprites } from "./resolve";
import { classicSquares, compositeTextures, loadTiles, planTextures, planUrls, type SpritePaintArea, type TexturePlan } from "./terrain";

export type { SpritePaintArea } from "./terrain";
export type { SpritePaintObject } from "./objects";
export type { SpriteArt } from "./loader";
export type { UploadedSprite, UploadedSprites } from "./resolve";

/** Hard cap on drawn objects, as on the board (and the Classic painter). */
const MAX_DRAWN_OBJECTS = 400;

/** A layout in the Sprites style: the Classic spec plus refs, the setting and the uploaded sprites it may use. */
export interface SpritePaintSpec extends PaintSpec {
  readonly areas?: ReadonlyArray<SpritePaintArea>;
  readonly objects?: ReadonlyArray<SpritePaintObject>;
  /** The built-in setting whose sprites stand in for Classic kinds and terrains (D1, D7); "" = common only. */
  readonly setting: string;
  /** Hand-painted textures (layer "texture") by square key `x,y`. */
  readonly textures?: Readonly<Record<string, SpriteRef>>;
  /** Uploaded sprites by id (combatMapStyle.spriteSources). */
  readonly uploaded?: UploadedSprites;
}

export interface SpritePreparedMap {
  readonly spec: SpritePaintSpec;
  readonly w: number;
  readonly h: number;
  /** The Classic preparation of the terrain (no objects): painted underneath, and the terrain classes. */
  readonly classic: PreparedMap;
  /** A blank Classic preparation for drawing single Classic objects. */
  readonly blank: PreparedMap;
  readonly plan: TexturePlan;
  readonly objects: readonly PlacedObject[];
}

export interface SpritePaintOptions extends PaintOptions {
  /** Where sprite and texture images come from (loader.ts); a missing image draws Classic. */
  readonly art: SpriteArt;
}

const NO_UPLOADS: UploadedSprites = new Map();

const placeAll = (spec: SpritePaintSpec, seed: number): PlacedObject[] =>
  (spec.objects ?? [])
    .filter((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y))
    .slice(0, MAX_DRAWN_OBJECTS)
    .map((o) => placeObject(o, spec.setting, seed, spec.uploaded ?? NO_UPLOADS));

export const prepareMap = (spec: SpritePaintSpec, paint?: PaintedTerrain): SpritePreparedMap => {
  const classic = classicPrepareMap({ w: spec.w, h: spec.h, seed: spec.seed, base: spec.base, plankV: spec.plankV, areas: spec.areas, objects: [] }, paint);
  const plan = planTextures(classic, spec.areas ?? [], paint, spec.textures, spec.setting, spec.uploaded ?? NO_UPLOADS);
  return { spec, w: classic.w, h: classic.h, classic, blank: blankClassicMap(classic), plan, objects: placeAll(spec, classic.seed) };
};

/** The same prepared terrain with another object list (an object moved, was added or a light switched). */
export const withObjects = (m: SpritePreparedMap, objects: ReadonlyArray<SpritePaintObject>): SpritePreparedMap => {
  const spec = { ...m.spec, objects };
  return { ...m, spec, objects: placeAll(spec, m.classic.seed) };
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const intersects = (a: MapRect, b: MapRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The rectangle (squares) an object can touch on a Sprites map (sprite, shadow, glow and its Classic drawing). */
export const objectBounds = (o: SpritePaintObject, spec: Pick<SpritePaintSpec, "setting" | "seed" | "uploaded">, cell = DEFAULT_CELL): MapRect =>
  placedBounds(placeObject(o, spec.setting, (spec.seed || 1) | 0, spec.uploaded ?? NO_UPLOADS), cell);

/** Image URLs the map draws: object sprites (with their bounds) and textures. The canvas repaints when one arrives. */
export const mapUrls = (m: SpritePreparedMap, cell = DEFAULT_CELL): { objects: Map<string, MapRect[]>; textures: Set<string> } => {
  const objects = new Map<string, MapRect[]>();
  for (const p of m.objects) {
    if (!p.art) continue;
    const list = objects.get(p.art.url) ?? [];
    list.push(placedBounds(p, cell));
    objects.set(p.art.url, list);
  }
  return { objects, textures: planUrls(m.plan) };
};

/**
 * Repaint one rectangle (in squares) of a Sprites map, clipped to it. The result is pixel-identical to the same
 * area of paintMap with the same images loaded.
 */
export const paintMapRect = (ctx: CanvasRenderingContext2D, m: SpritePreparedMap, rect: MapRect, opts: SpritePaintOptions): void => {
  const C = opts.cell ?? DEFAULT_CELL;
  const PW = m.w * C, PH = m.h * C;
  const x0 = clamp(Math.floor(rect.x * C), 0, PW), y0 = clamp(Math.floor(rect.y * C), 0, PH);
  const x1 = clamp(Math.ceil((rect.x + rect.w) * C), 0, PW), y1 = clamp(Math.ceil((rect.y + rect.h) * C), 0, PH);
  if (x1 <= x0 || y1 <= y0) return;
  const area: MapRect = { x: x0 / C, y: y0 / C, w: (x1 - x0) / C, h: (y1 - y0) / C };

  // Terrain: the Classic terrain where textures do not cover every pixel (untextured terrains, edges, textures
  // still loading), in runs of squares per row, then the textures over it.
  const tiles = loadTiles(m.plan, opts.art, C, m.classic.seed);
  const textured = tiles.some((t) => t.length > 0);
  if (!textured) classicPaintMapRect(ctx, m.classic, area, { cell: C, grid: false, vignette: false });
  else {
    const sx0 = Math.floor(area.x), sy0 = Math.floor(area.y), sx1 = Math.min(m.w, Math.ceil(area.x + area.w)), sy1 = Math.min(m.h, Math.ceil(area.y + area.h));
    const need = classicSquares(m.plan, m.classic, tiles, sx0, sy0, sx1, sy1);
    const cols = sx1 - sx0;
    for (let sy = sy0; sy < sy1; sy++)
      for (let sx = sx0; sx < sx1; sx++) {
        if (!need[(sy - sy0) * cols + (sx - sx0)]) continue;
        let end = sx + 1;
        while (end < sx1 && need[(sy - sy0) * cols + (end - sx0)]) end++;
        const run = { x: Math.max(sx, area.x), y: Math.max(sy, area.y), w: 0, h: 0 };
        const right = Math.min(end, area.x + area.w), bottom = Math.min(sy + 1, area.y + area.h);
        classicPaintMapRect(ctx, m.classic, { ...run, w: right - run.x, h: bottom - run.y }, { cell: C, grid: false, vignette: false });
        sx = end;
      }
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    if (compositeTextures(img.data, x0, y0, x1 - x0, y1 - y0, m.classic, m.plan, tiles, C)) ctx.putImageData(img, x0, y0);
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

  const placed = m.objects.filter((p) => intersects(placedBounds(p, C), area));
  const sprite = placed.map((p) => spriteReady(p, opts.art, C));
  const classicCtx = classicObjectContext(ctx);
  placed.forEach((p, i) => {
    if (!sprite[i] && p.o.kind === "hull") drawClassicObject(classicCtx, m.blank, p.o, C, opts.lights);
  });
  placed.forEach((p, i) => {
    if (sprite[i] && p.art!.height === "flat") drawSprite(ctx, p, opts.art, C);
  });
  placed.forEach((p, i) => {
    if (sprite[i]) drawShadow(ctx, p, opts.art, C);
  });
  placed.forEach((p, i) => {
    if (sprite[i]) drawGlow(ctx, p, C, opts.lights);
  });
  placed.forEach((p, i) => {
    if (sprite[i]) {
      if (p.art!.height !== "flat") drawSprite(ctx, p, opts.art, C);
    } else if (p.o.kind !== "hull") drawClassicObject(classicCtx, m.blank, p.o, C, opts.lights);
  });

  // Grid and vignette as the Classic painter draws them.
  if (opts.grid !== false) {
    ctx.strokeStyle = "rgba(20,24,16,0.22)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let gx = Math.floor(area.x); gx <= Math.min(m.w, Math.ceil(area.x + area.w)); gx++) { ctx.moveTo(gx * C + 0.5, y0); ctx.lineTo(gx * C + 0.5, y1); }
    for (let gy = Math.floor(area.y); gy <= Math.min(m.h, Math.ceil(area.y + area.h)); gy++) { ctx.moveTo(x0, gy * C + 0.5); ctx.lineTo(x1, gy * C + 0.5); }
    ctx.stroke();
  }
  if (opts.vignette !== false) {
    const vg = ctx.createRadialGradient(PW / 2, PH / 2, Math.min(PW, PH) * 0.45, PW / 2, PH / 2, Math.max(PW, PH) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vg; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.restore();
};

/** Paint the whole map at (0, 0) (canvas mapPixelSize(spec, cell) big). Returns the prepared map for later repaints. */
export const paintMap = (ctx: CanvasRenderingContext2D, spec: SpritePaintSpec, opts: SpritePaintOptions & { paint?: PaintedTerrain }): SpritePreparedMap => {
  const m = prepareMap(spec, opts.paint);
  paintMapRect(ctx, m, { x: 0, y: 0, w: m.w, h: m.h }, opts);
  return m;
};
