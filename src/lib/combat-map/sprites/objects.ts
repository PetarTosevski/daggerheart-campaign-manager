// Sprite painter objects (sprite packs P6): sprites with app-added shadows, Classic light glows, and the Classic
// drawing for every object without a sprite (or whose image has not loaded yet).
//
// Size (D4): an object's own sprite fits its w x h squares and is scaled by r / (max(w, h) / 2); a sprite that stands
// in for a Classic kind (no ref, D1) is sized like the Classic drawing of that kind at that r, so layouts made for
// Classic keep their spacing. `rot` turns the sprite about its centre.

import { objectBounds as classicObjectBounds, paintMapRect as classicPaintMapRect, unionRect, type MapRect, type PreparedMap } from "../painter";
import type { PaintObject } from "../raster";
import type { SpriteLight } from "../../sprite-packs/catalog/index";
import type { SpriteRef } from "../../sprite-packs/traits";
import type { SpriteArt } from "./loader";
import { objectArt, type ObjectArt, type UploadedSprites } from "./resolve";
import { shadowReach, shadowSpec, type ShadowSpec } from "./shadows";

/** A layout object on a Sprites map: a Classic object with its id (for the stand-in pick) and maybe a sprite ref. */
export interface SpritePaintObject extends PaintObject {
  readonly id: string;
  readonly sprite?: SpriteRef;
}

/**
 * Diameter in squares of the Classic drawing of a kind at r = 1 (read off painter.ts: a tree's canopy has radius
 * r, a crate is 0.7 r wide, ...). Stand-in sprites take this size so they cover what the Classic object covered.
 */
const CLASSIC_DIAMETER: Readonly<Record<string, number>> = {
  tree: 2, bush: 1.4, deadtree: 2.2, rock: 0.9, boulder: 1.15, tent: 1.1, campfire: 1.5, crate: 0.8, barrel: 0.7,
  chest: 0.75, table: 1.4, pillar: 0.9, statue: 0.9, rubble: 1.2, mushroom: 0.5, crystal: 0.6, torch: 0.5,
  walltorch: 0.5, bones: 0.7,
};
/** Stand-in sprites are never drawn smaller or bigger than this share of their own size. */
const MAPPED_SCALE_MIN = 0.6;
const MAPPED_SCALE_MAX = 3;

/** Light glow radius in squares and its colour, per sprite light (Classic-style glow overlay, R9). */
export const GLOW: Readonly<Record<Exclude<SpriteLight, "none">, { readonly radius: number; readonly rgba: readonly [string, string] }>> = {
  campfire: { radius: 1.5, rgba: ["rgba(255,190,80,0.55)", "rgba(255,140,40,0)"] },
  torch: { radius: 1.3, rgba: ["rgba(255,170,60,0.6)", "rgba(255,170,60,0)"] },
  faintglow: { radius: 0.75, rgba: ["rgba(255,226,160,0.42)", "rgba(255,226,160,0)"] },
};

const PX_MARGIN = 12;

/** An object with the art it is drawn with and its drawn size in squares; art null = Classic drawing. */
export interface PlacedObject {
  readonly o: SpritePaintObject;
  readonly art: ObjectArt | null;
  /** Drawn size in squares (art's aspect kept). */
  readonly sw: number;
  readonly sh: number;
}

/** The sprite scale of an object (D4 for refs, the Classic size for stand-ins). */
function spriteScale(o: SpritePaintObject, art: ObjectArt): number {
  const nominal = Math.max(art.w, art.h);
  if (art.via === "ref") return (o.r || nominal / 2) / (nominal / 2);
  const diameter = o.kind === "log" ? Math.max(1, o.len || 2.5) : (CLASSIC_DIAMETER[o.kind] ?? 1) * (o.r || 1);
  return Math.max(MAPPED_SCALE_MIN, Math.min(MAPPED_SCALE_MAX, diameter / nominal));
}

/** Resolves an object's art and drawn size. */
export function placeObject(o: SpritePaintObject, setting: string, seed: number, uploaded: UploadedSprites): PlacedObject {
  const art = objectArt(o, setting, seed, uploaded);
  if (!art) return { o, art: null, sw: 0, sh: 0 };
  const k = Math.min(art.w / art.px.w, art.h / art.px.h);
  const scale = spriteScale(o, art);
  return { o, art, sw: art.px.w * k * scale, sh: art.px.h * k * scale };
}

const lightOn = (o: PaintObject, lights: "spec" | "lit" | "unlit" | undefined) => (lights === "lit" ? true : lights === "unlit" ? false : o.lit !== false);

/** The object's shadow at `cell` pixels per square (null: flat or Classic). */
export function placedShadow(p: PlacedObject, cell: number): ShadowSpec | null {
  return p.art ? shadowSpec(p.art.height, Math.max(p.sw, p.sh) / 2, cell) : null;
}

/**
 * The rectangle (squares) an object's drawing can touch, sprite or Classic, shadow and glow included. It covers
 * both drawings, so the repaint when its image arrives (Classic -> sprite) is inside it too.
 */
export function placedBounds(p: PlacedObject, cell: number): MapRect {
  const classic = classicObjectBounds(p.o, cell);
  if (!p.art) return classic;
  const glow = p.art.light === "none" ? 0 : GLOW[p.art.light].radius;
  const rad = Math.max(0.5 * Math.hypot(p.sw, p.sh) + shadowReach(placedShadow(p, cell)) / cell, glow) + PX_MARGIN / cell;
  return unionRect(classic, { x: p.o.x - rad, y: p.o.y - rad, w: 2 * rad, h: 2 * rad });
}

const noop = () => undefined;

/**
 * A view of `ctx` that ignores clipping (clip and the rect that builds its path) and image-data writes. Classic objects are drawn by the Classic painter's own
 * paintMapRect on a one-pixel rectangle at the object (so its terrain pass costs one pixel and is thrown away, and
 * its clip is skipped): the object then comes out exactly as on a Classic map, clipped only by the caller's clip.
 */
export function classicObjectContext(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  return new Proxy(ctx, {
    get(target, prop) {
      // painter.ts uses rect() only to build its clip path.
      if (prop === "clip" || prop === "rect" || prop === "putImageData") return noop;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

/**
 * A Classic preparation with no terrain to speak of (all wall: no strokes, no edges) the size of the map, for drawing
 * single Classic objects through `classicObjectContext`.
 */
export function blankClassicMap(classic: PreparedMap): PreparedMap {
  const fineRow = Array(classic.fine[0]?.length ?? 0).fill("wall");
  const gridRow = Array(classic.w).fill("wall");
  return {
    ...classic,
    spec: { w: classic.w, h: classic.h, seed: classic.seed, objects: [] },
    grid: Array(classic.h).fill(gridRow),
    fine: Array(classic.fine.length).fill(fineRow),
    edge: new Uint8Array(classic.edge.length),
    crisp: new Set(),
  };
}

/** Draws one object the Classic way (shadow and body, as painter.ts draws it). */
export function drawClassicObject(
  classicCtx: CanvasRenderingContext2D,
  blank: PreparedMap,
  o: PaintObject,
  cell: number,
  lights: "spec" | "lit" | "unlit" | undefined,
): void {
  const px = 1 / cell;
  const x = Math.max(0, Math.min(blank.w - px, o.x)), y = Math.max(0, Math.min(blank.h - px, o.y));
  const b = classicObjectBounds(o, cell);
  if (!(x < b.x + b.w && b.x < x + px && y < b.y + b.h && b.y < y + px)) return;
  classicPaintMapRect(classicCtx, { ...blank, spec: { ...blank.spec, objects: [o] } }, { x, y, w: px, h: px }, { cell, grid: false, vignette: false, lights });
}

/** The pixel size an object's sprite is drawn at. */
const drawnPx = (p: PlacedObject, cell: number) => [Math.max(1, Math.round(p.sw * cell)), Math.max(1, Math.round(p.sh * cell))] as const;

/** Whether the object's sprite image is ready (asking starts its load). */
export function spriteReady(p: PlacedObject, art: SpriteArt, cell: number): boolean {
  if (!p.art) return false;
  const [w, h] = drawnPx(p, cell);
  return art.sprite(p.art.url, w, h) !== null;
}

export function drawShadow(ctx: CanvasRenderingContext2D, p: PlacedObject, art: SpriteArt, cell: number): void {
  const spec = placedShadow(p, cell);
  if (!p.art || !spec) return;
  const [w, h] = drawnPx(p, cell);
  const rot = p.o.rot || 0;
  const img = art.shadow(p.art.url, w, h, rot, spec) as (CanvasImageSource & { width: number; height: number }) | null;
  if (!img) return;
  ctx.drawImage(img, Math.round(p.o.x * cell + spec.dx - img.width / 2), Math.round(p.o.y * cell + spec.dy - img.height / 2));
}

export function drawGlow(ctx: CanvasRenderingContext2D, p: PlacedObject, cell: number, lights: "spec" | "lit" | "unlit" | undefined): void {
  if (!p.art || p.art.light === "none" || !lightOn(p.o, lights)) return;
  const glow = GLOW[p.art.light];
  const x = p.o.x * cell, y = p.o.y * cell, r = glow.radius * cell;
  const gr = ctx.createRadialGradient(x, y, 1, x, y, r);
  gr.addColorStop(0, glow.rgba[0]);
  gr.addColorStop(1, glow.rgba[1]);
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
}

export function drawSprite(ctx: CanvasRenderingContext2D, p: PlacedObject, art: SpriteArt, cell: number): void {
  if (!p.art) return;
  const [w, h] = drawnPx(p, cell);
  const img = art.sprite(p.art.url, w, h);
  if (!img) return;
  const rot = p.o.rot || 0;
  if (rot === 0) {
    ctx.drawImage(img, Math.round(p.o.x * cell - w / 2), Math.round(p.o.y * cell - h / 2));
    return;
  }
  ctx.save();
  ctx.translate(p.o.x * cell, p.o.y * cell);
  ctx.rotate(rot);
  ctx.drawImage(img, -w / 2, -h / 2);
  ctx.restore();
}
