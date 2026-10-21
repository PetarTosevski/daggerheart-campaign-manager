"use client";

import { useEffect, useRef } from "react";

import { paintMap } from "@/lib/combat-map/painter";
import { spriteImages } from "@/lib/combat-map/sprites/loader";
import * as sprites from "@/lib/combat-map/sprites/painter";

import type { CombatMapListRow } from "../../../../convex/combatMaps";
import { paintSetting } from "../map-view/paint-spec";

/** Pixels per square of a list thumbnail (terrain only: the list does not load objects). */
const THUMB_CELL = 4;

const NO_UPLOADS: sprites.UploadedSprites = new Map();

/**
 * The board's map thumbnail (84 x 56): the uploaded image, or the painted terrain of the layout in the map's style
 * (sprite packs P6: a Sprites map shows its textures, repainted as they load; uploaded textures, which the list does
 * not carry, show their Classic terrain).
 */
export function MapThumbnail({ map }: { map: CombatMapListRow }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const style = map.style === "sprites" ? "sprites" : "classic";
  const setting = style === "sprites" ? paintSetting({ setting: map.setting, name: map.name }) : "";
  const terrainKey = JSON.stringify([map.w, map.h, map.seed, map.base, map.plankV ?? false, map.areas, style, setting]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || map.source === "image") return;
    el.width = map.w * THUMB_CELL;
    el.height = map.h * THUMB_CELL;
    const terrain = { w: map.w, h: map.h, seed: map.seed, base: map.base, plankV: map.plankV, areas: map.areas };
    if (style === "classic") {
      paintMap(ctx, terrain, { cell: THUMB_CELL, grid: false });
      return;
    }
    const art = spriteImages();
    const prepared = sprites.paintMap(ctx, { ...terrain, objects: [], setting, uploaded: NO_UPLOADS }, { cell: THUMB_CELL, grid: false, art });
    const used = sprites.mapUrls(prepared, THUMB_CELL).textures;
    let frame = 0;
    const unsubscribe = art.subscribe((url) => {
      if (!used.has(url) || frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sprites.paintMapRect(ctx, prepared, { x: 0, y: 0, w: prepared.w, h: prepared.h }, { cell: THUMB_CELL, grid: false, art });
      });
    });
    return () => {
      unsubscribe();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // terrainKey stands for the fields painted above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainKey, map.source]);

  if (map.source === "image") {
    return map.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL (the GM's upload), not a static asset
      <img className={`cm-thumb${map.live ? " cm-thumb-live" : ""}`} src={map.imageUrl} alt="Map thumbnail" width={84} height={56} loading="lazy" decoding="async" />
    ) : (
      <span className={`cm-thumb${map.live ? " cm-thumb-live" : ""}`} aria-hidden="true" />
    );
  }
  return <canvas ref={canvas} className={`cm-thumb${map.live ? " cm-thumb-live" : ""}`} data-style={style} aria-hidden="true" />;
}
