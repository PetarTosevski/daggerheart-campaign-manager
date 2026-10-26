"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";

import {
  objectBounds,
  paintMap,
  paintMapRect,
  prepareMap,
  terrainDirtyRect,
  unionRect,
  withObjects,
  type MapRect,
  type PreparedMap,
} from "@/lib/combat-map/painter";
import type { PaintObject, PaintSpec, PaintedTerrain } from "@/lib/combat-map/raster";
import { spriteImages } from "@/lib/combat-map/sprites/loader";
import * as sprites from "@/lib/combat-map/sprites/painter";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { ImageGrid } from "./grid";
import { hasUploadedRefs, toPaintSpec, toSpritePaintSpec } from "./paint-spec";

/** Pixels per square on the map canvas (the painter's and the board's CELL); zoom scales it with CSS. */
export const MAP_CELL = 48;

/** The dark the board draws past an uploaded image's edge. */
const OFF_IMAGE = "#0b1214";

/** How long the map fades in after its style changed (none with reduced motion). */
const STYLE_FADE_MS = 220;

type Painted = {
  /** Terrain inputs: a change repaints everything. */
  structure: string;
  spec: PaintSpec;
  paint: PaintedTerrain;
  prepared: PreparedMap;
  objects: Map<string, PaintObject>;
};

/** The Sprites style's paint state (sprite packs P6). */
type SpritePainted = {
  structure: string;
  spec: sprites.SpritePaintSpec;
  paint: PaintedTerrain;
  prepared: sprites.SpritePreparedMap;
  objects: Map<string, sprites.SpritePaintObject>;
};

type CanvasState = { style: "classic"; painted: Painted } | { style: "sprites"; painted: SpritePainted } | null;

const NO_UPLOADS: sprites.UploadedSprites = new Map();

/** Squares whose painted terrain differs between two cell maps, as one bounding rectangle, or null. */
function paintDiff(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): MapRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const touch = (key: string) => {
    const [x, y] = key.split(",").map(Number) as [number, number];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const key in a) if (a[key] !== b[key]) touch(key);
  for (const key in b) if (!(key in a)) touch(key);
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Squares whose texture ref differs between two texture-cell maps (P9), as one bounding rectangle, or null. */
function refDiff(a: sprites.SpritePaintSpec["textures"], b: sprites.SpritePaintSpec["textures"]): MapRect | null {
  const key = (ref: { builtin: string } | { uploaded: string } | undefined) => (ref === undefined ? "" : "builtin" in ref ? `b:${ref.builtin}` : `u:${ref.uploaded}`);
  const left: Record<string, string> = {};
  const right: Record<string, string> = {};
  for (const k in a ?? {}) left[k] = key(a![k]);
  for (const k in b ?? {}) right[k] = key(b![k]);
  return paintDiff(left, right);
}

/**
 * Paints a generated or blank layout with C2's painter. The first paint (and any change of size, seed, base or
 * areas) draws the whole map; afterwards only what changed is repainted: an object's old and new bounds, or the
 * squares whose painted terrain changed (C5's "redraw only the changed area").
 */
function paintLayout(canvas: HTMLCanvasElement, layout: CombatMapLayout, paint: PaintedTerrain, prev: Painted | null): Painted | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return prev;
  const spec = toPaintSpec(layout);
  const structure = JSON.stringify([layout._id, layout.w, layout.h, layout.seed, layout.base, layout.plankV ?? false, layout.areas]);
  const objects = new Map<string, PaintObject>(layout.objects.map(({ _id, ...o }) => [_id, o]));
  if (prev === null || prev.structure !== structure || canvas.width !== layout.w * MAP_CELL) {
    canvas.width = layout.w * MAP_CELL;
    canvas.height = layout.h * MAP_CELL;
    const prepared = paintMap(ctx, spec, { cell: MAP_CELL, paint });
    return { structure, spec, paint, prepared, objects };
  }
  const dirty: MapRect[] = [];
  for (const [id, object] of objects) {
    const old = prev.objects.get(id);
    if (old === undefined) dirty.push(objectBounds(object, MAP_CELL));
    else if (JSON.stringify(old) !== JSON.stringify(object)) dirty.push(unionRect(objectBounds(old, MAP_CELL), objectBounds(object, MAP_CELL)));
  }
  for (const [id, old] of prev.objects) if (!objects.has(id)) dirty.push(objectBounds(old, MAP_CELL));
  const cellsChanged = paintDiff(prev.paint, paint);
  if (cellsChanged !== null) dirty.push(terrainDirtyRect(cellsChanged));
  if (dirty.length === 0) return { ...prev, spec, objects };
  const prepared = cellsChanged !== null ? prepareMap(spec, paint) : withObjects(prev.prepared, spec.objects ?? []);
  for (const rect of dirty) paintMapRect(ctx, prepared, rect, { cell: MAP_CELL });
  return { structure, spec, paint, prepared, objects };
}

/**
 * The same for the Sprites style (sprite packs P6): the sprite painter, with the same partial repaints. Objects are
 * compared with their sprite refs; the setting, area textures, texture cells and uploaded sprites are terrain inputs.
 */
function paintSpriteLayout(
  canvas: HTMLCanvasElement,
  layout: CombatMapLayout,
  paint: PaintedTerrain,
  uploaded: sprites.UploadedSprites,
  prev: SpritePainted | null,
): SpritePainted | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return prev;
  const spec = toSpritePaintSpec(layout, uploaded);
  const art = spriteImages();
  // Hand-painted texture cells (P9) are not structure: like painted terrain they repaint only the squares they change.
  const structure = JSON.stringify([
    layout._id, layout.w, layout.h, layout.seed, layout.base, layout.plankV ?? false, layout.areas, spec.setting,
    [...uploaded.values()].map((u) => [u._id, u.url]),
  ]);
  const objects = new Map<string, sprites.SpritePaintObject>((spec.objects ?? []).map((o) => [o.id, o]));
  if (prev === null || prev.structure !== structure || canvas.width !== layout.w * MAP_CELL) {
    canvas.width = layout.w * MAP_CELL;
    canvas.height = layout.h * MAP_CELL;
    const prepared = sprites.paintMap(ctx, spec, { cell: MAP_CELL, paint, art });
    return { structure, spec, paint, prepared, objects };
  }
  const bounds = (o: sprites.SpritePaintObject) => sprites.objectBounds(o, spec, MAP_CELL);
  const dirty: MapRect[] = [];
  for (const [id, object] of objects) {
    const old = prev.objects.get(id);
    if (old === undefined) dirty.push(bounds(object));
    else if (JSON.stringify(old) !== JSON.stringify(object)) dirty.push(unionRect(bounds(old), bounds(object)));
  }
  for (const [id, old] of prev.objects) if (!objects.has(id)) dirty.push(bounds(old));
  const terrainChanged = paintDiff(prev.paint, paint);
  const texturesChanged = refDiff(prev.spec.textures, spec.textures);
  const cellsChanged = terrainChanged && texturesChanged ? unionRect(terrainChanged, texturesChanged) : (terrainChanged ?? texturesChanged);
  if (cellsChanged !== null) dirty.push(terrainDirtyRect(cellsChanged));
  if (dirty.length === 0) return { ...prev, spec, objects };
  const prepared = cellsChanged !== null ? sprites.prepareMap(spec, paint) : sprites.withObjects(prev.prepared, spec.objects ?? []);
  for (const rect of dirty) sprites.paintMapRect(ctx, prepared, rect, { cell: MAP_CELL, art });
  return { structure, spec, paint, prepared, objects };
}

/** Repaints what the arrived images change: the whole map for a texture, else the objects drawn with them. */
function repaintArrived(canvas: HTMLCanvasElement, painted: SpritePainted, urls: ReadonlySet<string>) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const art = spriteImages();
  const used = sprites.mapUrls(painted.prepared, MAP_CELL);
  if ([...urls].some((url) => used.textures.has(url))) {
    sprites.paintMapRect(ctx, painted.prepared, { x: 0, y: 0, w: painted.prepared.w, h: painted.prepared.h }, { cell: MAP_CELL, art });
    return;
  }
  for (const url of urls) for (const rect of used.objects.get(url) ?? []) sprites.paintMapRect(ctx, painted.prepared, rect, { cell: MAP_CELL, art });
}

/** Draws an uploaded image under its square grid (the board: image scaled so one grid square = one map square). */
function paintImage(canvas: HTMLCanvasElement, w: number, h: number, image: HTMLImageElement | null, grid: ImageGrid) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = w * MAP_CELL;
  canvas.height = h * MAP_CELL;
  ctx.fillStyle = OFF_IMAGE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (image) {
    const k = MAP_CELL / grid.cell;
    ctx.drawImage(image, -grid.offsetX * k, -grid.offsetY * k, image.naturalWidth * k, image.naturalHeight * k);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    ctx.moveTo(x * MAP_CELL + 0.5, 0);
    ctx.lineTo(x * MAP_CELL + 0.5, canvas.height);
  }
  for (let y = 0; y <= h; y++) {
    ctx.moveTo(0, y * MAP_CELL + 0.5);
    ctx.lineTo(canvas.width, y * MAP_CELL + 0.5);
  }
  ctx.stroke();
}

/** A short fade-in after the style changed, so the switch reads as one change; skipped with reduced motion. */
function fadeIn(el: HTMLCanvasElement) {
  if (typeof el.animate !== "function") return;
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: STYLE_FADE_MS, easing: "ease-out" });
}

type MapCanvasProps = {
  layout: CombatMapLayout;
  paint: PaintedTerrain;
  image: HTMLImageElement | null;
  grid: ImageGrid | null;
  zoom: number;
  pad: number;
};

/**
 * The map itself: C2's painted layout (Classic) or the sprite painter's (Sprites, sprite packs P6), or the uploaded
 * image with its grid (`grid` may be a drag preview). Positioned at the stage's pad and scaled by `zoom` with CSS;
 * the canvas keeps MAP_CELL pixels per square. A Sprites map that uses uploaded sprites reads their URLs from
 * `combatMapStyle.spriteSources`; if that read fails, the map still draws (those objects Classic).
 */
export function MapCanvas(props: MapCanvasProps) {
  const sprite = props.layout.source !== "image" && props.layout.style === "sprites";
  if (sprite && hasUploadedRefs(props.layout)) {
    return (
      <SourcesBoundary resetKey={props.layout._id} fallback={<CanvasView {...props} uploaded={NO_UPLOADS} />}>
        <WithSources {...props} />
      </SourcesBoundary>
    );
  }
  return <CanvasView {...props} uploaded={NO_UPLOADS} />;
}

/** The uploaded sprites a Sprites map references (GM: labelled rows, player: only those on the live map; D10). */
function WithSources(props: MapCanvasProps) {
  const { campaignId } = useParams<{ campaignId: Id<"campaigns"> }>();
  const sources = useQuery(api.combatMapStyle.spriteSources, { campaignId, mapId: props.layout._id });
  const uploaded = useMemo<sprites.UploadedSprites>(() => (sources ? new Map(sources.sprites.map((s) => [s._id, s])) : NO_UPLOADS), [sources]);
  return <CanvasView {...props} uploaded={uploaded} />;
}

/** Keeps a failed `spriteSources` read (a map that just stopped being live) from blanking the board. */
class SourcesBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey: string }, { failed: string | null }> {
  state = { failed: null as string | null };

  static getDerivedStateFromError() {
    return { failed: "" };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: string | null }) {
    if (state.failed === "") return { failed: props.resetKey };
    return state.failed !== null && state.failed !== props.resetKey ? { failed: null } : null;
  }

  render() {
    return this.state.failed !== null ? this.props.fallback : this.props.children;
  }
}

function CanvasView({ layout, paint, image, grid, zoom, pad, uploaded }: MapCanvasProps & { uploaded: sprites.UploadedSprites }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<CanvasState>(null);
  const isImage = layout.source === "image";
  const style = !isImage && layout.style === "sprites" ? "sprites" : "classic";
  const gridKey = grid ? `${grid.cell},${grid.offsetX},${grid.offsetY}` : "";

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const prev = state.current;
    if (isImage) {
      state.current = null;
      paintImage(el, layout.w, layout.h, image, grid ?? { cell: MAP_CELL, offsetX: 0, offsetY: 0 });
    } else if (style === "sprites") {
      const painted = paintSpriteLayout(el, layout, paint, uploaded, prev?.style === "sprites" ? prev.painted : null);
      state.current = painted ? { style, painted } : null;
    } else {
      const painted = paintLayout(el, layout, paint, prev?.style === "classic" ? prev.painted : null);
      state.current = painted ? { style, painted } : null;
    }
    if (prev !== null && !isImage && prev.style !== style) fadeIn(el);
    // gridKey stands for `grid` (a new object on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, paint, image, isImage, gridKey, style, uploaded]);

  // Sprites: repaint what an image changes once it has loaded (batched per frame); until then it draws Classic.
  useEffect(() => {
    if (style !== "sprites") return;
    let arrived = new Set<string>();
    let frame = 0;
    const unsubscribe = spriteImages().subscribe((url) => {
      arrived.add(url);
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const urls = arrived;
        arrived = new Set();
        const el = canvas.current;
        const current = state.current;
        if (el && current?.style === "sprites") repaintArrived(el, current.painted, urls);
      });
    });
    return () => {
      unsubscribe();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [style]);

  const step = MAP_CELL * zoom;
  return (
    <canvas
      ref={canvas}
      className="cm-canvas"
      data-testid="combat-map-canvas"
      data-style={style}
      aria-hidden="true"
      style={{ left: pad * step, top: pad * step, width: layout.w * step, height: layout.h * step }}
    />
  );
}
