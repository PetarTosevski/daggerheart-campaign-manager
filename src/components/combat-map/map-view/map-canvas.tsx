"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

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
import { renderScale } from "@/lib/combat-map/render-scale";
import { rootScale } from "@/lib/css-zoom";
import { prefersReducedMotion } from "@/lib/use-reduced-motion";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { ImageGrid } from "./grid";
import { hasPackSetting, hasUploadedRefs, toPaintSpec, toSpritePaintSpec } from "./paint-spec";

/**
 * CSS pixels per square on the map (the painter's and the board's CELL); zoom scales it with CSS. The canvas's backing
 * store draws MAP_CELL x the render scale (useRenderScale) pixels per square.
 */
export const MAP_CELL = 48;

/** How long the board zoom must stay still before the canvases repaint at its render scale (not on every wheel tick). */
const ZOOM_SETTLE_MS = 150;

// ---- render scale (plan sharp-4k HD1): devicePixelRatio x the root CSS zoom x the settled board zoom.

/** The screen's device pixels per CSS pixel of the page: devicePixelRatio x the root zoom (css-zoom.ts). */
function measureDeviceScale(): number {
  return (window.devicePixelRatio || 1) * rootScale();
}

let deviceScale = 0;
const deviceListeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

/**
 * Watches what changes the device scale: a move to a screen with another pixel density (matchMedia on the current
 * resolution, re-armed after each change), the Text size preference (html[data-text-size]) and a switch between mouse
 * and touch (the root zoom follows `pointer: coarse`).
 */
function watchDeviceScale(): () => void {
  let resolution: MediaQueryList | null = null;
  const arm = () => {
    resolution?.removeEventListener("change", changed);
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    resolution.addEventListener("change", changed);
  };
  function changed() {
    arm();
    const next = measureDeviceScale();
    if (next === deviceScale) return;
    deviceScale = next;
    for (const listener of deviceListeners) listener();
  }
  arm();
  const pointer = window.matchMedia("(pointer: coarse)");
  pointer.addEventListener("change", changed);
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-size", "style", "class"] });
  return () => {
    resolution?.removeEventListener("change", changed);
    pointer.removeEventListener("change", changed);
    observer.disconnect();
  };
}

function subscribeDeviceScale(listener: () => void): () => void {
  deviceListeners.add(listener);
  stopWatching ??= watchDeviceScale();
  return () => {
    deviceListeners.delete(listener);
    if (deviceListeners.size > 0) return;
    stopWatching?.();
    stopWatching = null;
    deviceScale = 0;
  };
}

/** Measured once and then kept until a watched change (a layout read on every render would be costly). */
function readDeviceScale(): number {
  if (deviceScale === 0) deviceScale = measureDeviceScale();
  return deviceScale;
}

/** devicePixelRatio x the root CSS zoom, live (1 on the server). */
export function useDeviceScale(): number {
  return useSyncExternalStore(subscribeDeviceScale, readDeviceScale, () => 1);
}

/**
 * The board zoom once it has been still for ZOOM_SETTLE_MS (a debounce: the state follows the zoom from a timer, never
 * during the effect). Until then the canvases keep their backing store, scaled with CSS as before.
 */
function useSettledZoom(zoom: number): number {
  const [settled, setSettled] = useState(zoom);
  useEffect(() => {
    if (settled === zoom) return;
    const timer = window.setTimeout(() => setSettled(zoom), ZOOM_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [zoom, settled]);
  return settled;
}

/**
 * The render scale k of a board canvas `width` x `height` CSS pixels big at zoom 1 (render-scale.ts): the canvas
 * draws k backing-store pixels per CSS pixel. `followZoom` false leaves the board zoom out (the fog: a blur has
 * nothing to gain from it).
 */
export function useRenderScale(width: number, height: number, zoom: number, followZoom = true): number {
  const device = useDeviceScale();
  const settled = useSettledZoom(followZoom ? zoom : 1);
  return renderScale(device, settled, width, height);
}

/** The dark the board draws past an uploaded image's edge. */
const OFF_IMAGE = "#0b1214";

/** How long the map fades in after its style changed (none with reduced motion). */
const STYLE_FADE_MS = 220;

type Painted = {
  /** Terrain inputs: a change repaints everything. */
  structure: string;
  /** Backing-store pixels per square (MAP_CELL x the render scale): a change repaints everything. */
  cell: number;
  spec: PaintSpec;
  paint: PaintedTerrain;
  prepared: PreparedMap;
  objects: Map<string, PaintObject>;
};

/** The Sprites style's paint state (sprite packs P6). */
type SpritePainted = {
  structure: string;
  cell: number;
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
 * Paints a generated or blank layout with C2's painter at `cell` pixels per square. The first paint (and any change of
 * size, seed, base, areas or render scale) draws the whole map; afterwards only what changed is repainted: an object's
 * old and new bounds, or the squares whose painted terrain changed (C5's "redraw only the changed area").
 */
function paintLayout(canvas: HTMLCanvasElement, layout: CombatMapLayout, paint: PaintedTerrain, prev: Painted | null, cell: number): Painted | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return prev;
  const spec = toPaintSpec(layout);
  const structure = JSON.stringify([layout._id, layout.w, layout.h, layout.seed, layout.base, layout.plankV ?? false, layout.areas]);
  const objects = new Map<string, PaintObject>(layout.objects.map(({ _id, ...o }) => [_id, o]));
  if (prev === null || prev.structure !== structure || prev.cell !== cell || canvas.width !== layout.w * cell) {
    canvas.width = layout.w * cell;
    canvas.height = layout.h * cell;
    const prepared = paintMap(ctx, spec, { cell, paint });
    return { structure, cell, spec, paint, prepared, objects };
  }
  const dirty: MapRect[] = [];
  for (const [id, object] of objects) {
    const old = prev.objects.get(id);
    if (old === undefined) dirty.push(objectBounds(object, cell));
    else if (JSON.stringify(old) !== JSON.stringify(object)) dirty.push(unionRect(objectBounds(old, cell), objectBounds(object, cell)));
  }
  for (const [id, old] of prev.objects) if (!objects.has(id)) dirty.push(objectBounds(old, cell));
  const cellsChanged = paintDiff(prev.paint, paint);
  if (cellsChanged !== null) dirty.push(terrainDirtyRect(cellsChanged));
  if (dirty.length === 0) return { ...prev, spec, objects };
  const prepared = cellsChanged !== null ? prepareMap(spec, paint) : withObjects(prev.prepared, spec.objects ?? []);
  for (const rect of dirty) paintMapRect(ctx, prepared, rect, { cell });
  return { structure, cell, spec, paint, prepared, objects };
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
  packExtends: string | null,
  prev: SpritePainted | null,
  cell: number,
): SpritePainted | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return prev;
  const spec = toSpritePaintSpec(layout, uploaded, packExtends);
  const art = spriteImages();
  // Hand-painted texture cells (P9) are not structure: like painted terrain they repaint only the squares they change.
  const structure = JSON.stringify([
    layout._id, layout.w, layout.h, layout.seed, layout.base, layout.plankV ?? false, layout.areas, spec.setting,
    [...uploaded.values()].map((u) => [u._id, u.url]),
  ]);
  const objects = new Map<string, sprites.SpritePaintObject>((spec.objects ?? []).map((o) => [o.id, o]));
  if (prev === null || prev.structure !== structure || prev.cell !== cell || canvas.width !== layout.w * cell) {
    canvas.width = layout.w * cell;
    canvas.height = layout.h * cell;
    const prepared = sprites.paintMap(ctx, spec, { cell, paint, art });
    return { structure, cell, spec, paint, prepared, objects };
  }
  const bounds = (o: sprites.SpritePaintObject) => sprites.objectBounds(o, spec, cell);
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
  for (const rect of dirty) sprites.paintMapRect(ctx, prepared, rect, { cell, art });
  return { structure, cell, spec, paint, prepared, objects };
}

/** Repaints what the arrived images change: the whole map for a texture, else the objects drawn with them. */
function repaintArrived(canvas: HTMLCanvasElement, painted: SpritePainted, urls: ReadonlySet<string>) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const art = spriteImages();
  const { cell } = painted;
  const used = sprites.mapUrls(painted.prepared, cell);
  if ([...urls].some((url) => used.textures.has(url))) {
    sprites.paintMapRect(ctx, painted.prepared, { x: 0, y: 0, w: painted.prepared.w, h: painted.prepared.h }, { cell, art });
    return;
  }
  for (const url of urls) for (const rect of used.objects.get(url) ?? []) sprites.paintMapRect(ctx, painted.prepared, rect, { cell, art });
}

/**
 * Draws an uploaded image under its square grid (the board: image scaled so one grid square = one map square) at
 * `cell` pixels per square; the grid lines stay one 48 px pixel wide at any render scale.
 */
function paintImage(canvas: HTMLCanvasElement, w: number, h: number, image: HTMLImageElement | null, grid: ImageGrid, cell: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = w * cell;
  canvas.height = h * cell;
  ctx.fillStyle = OFF_IMAGE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (image) {
    const k = cell / grid.cell;
    ctx.drawImage(image, -grid.offsetX * k, -grid.offsetY * k, image.naturalWidth * k, image.naturalHeight * k);
  }
  const line = cell / MAP_CELL;
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = line;
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    ctx.moveTo(x * cell + line / 2, 0);
    ctx.lineTo(x * cell + line / 2, canvas.height);
  }
  for (let y = 0; y <= h; y++) {
    ctx.moveTo(0, y * cell + line / 2);
    ctx.lineTo(canvas.width, y * cell + line / 2);
  }
  ctx.stroke();
}

/** A short fade-in after the style changed, so the switch reads as one change; skipped with reduced motion (device or account). */
function fadeIn(el: HTMLCanvasElement) {
  if (typeof el.animate !== "function") return;
  if (prefersReducedMotion()) return;
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
 * the canvas draws MAP_CELL x the render scale pixels per square (sharp on a HiDPI screen and zoomed in, HD1). A Sprites map that uses uploaded sprites reads their URLs from
 * `combatMapStyle.spriteSources`; if that read fails, the map still draws (those objects Classic).
 */
export function MapCanvas(props: MapCanvasProps) {
  const sprite = props.layout.source !== "image" && props.layout.style === "sprites";
  // dcm-bxp.86: a pack-setting map reads the sources for the pack's `extends` too.
  if (sprite && (hasUploadedRefs(props.layout) || hasPackSetting(props.layout))) {
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
  return <CanvasView {...props} uploaded={uploaded} packExtends={sources?.extends ?? null} />;
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

function CanvasView({
  layout,
  paint,
  image,
  grid,
  zoom,
  pad,
  uploaded,
  packExtends = null,
}: MapCanvasProps & { uploaded: sprites.UploadedSprites; packExtends?: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<CanvasState>(null);
  const isImage = layout.source === "image";
  const style = !isImage && layout.style === "sprites" ? "sprites" : "classic";
  const gridKey = grid ? `${grid.cell},${grid.offsetX},${grid.offsetY}` : "";
  // A change of render scale (zoom settled, another screen, Text size) is a full repaint, like a structure change.
  const cell = MAP_CELL * useRenderScale(layout.w * MAP_CELL, layout.h * MAP_CELL, zoom);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const prev = state.current;
    if (isImage) {
      state.current = null;
      paintImage(el, layout.w, layout.h, image, grid ?? { cell: MAP_CELL, offsetX: 0, offsetY: 0 }, cell);
    } else if (style === "sprites") {
      const painted = paintSpriteLayout(el, layout, paint, uploaded, packExtends, prev?.style === "sprites" ? prev.painted : null, cell);
      state.current = painted ? { style, painted } : null;
    } else {
      const painted = paintLayout(el, layout, paint, prev?.style === "classic" ? prev.painted : null, cell);
      state.current = painted ? { style, painted } : null;
    }
    if (prev !== null && !isImage && prev.style !== style) fadeIn(el);
    // gridKey stands for `grid` (a new object on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, paint, image, isImage, gridKey, style, uploaded, packExtends, cell]);

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
      data-scale={cell / MAP_CELL}
      aria-hidden="true"
      style={{ left: pad * step, top: pad * step, width: layout.w * step, height: layout.h * step }}
    />
  );
}
