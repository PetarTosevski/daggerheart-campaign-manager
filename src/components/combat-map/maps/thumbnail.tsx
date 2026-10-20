"use client";

import { useEffect, useRef } from "react";

import { paintMap } from "@/lib/combat-map/painter";

import type { CombatMapListRow } from "../../../../convex/combatMaps";

/** Pixels per square of a list thumbnail (terrain only: the list does not load objects). */
const THUMB_CELL = 4;

/** The board's map thumbnail (84 x 56): the uploaded image, or the painted terrain of the layout. */
export function MapThumbnail({ map }: { map: CombatMapListRow }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const terrainKey = JSON.stringify([map.w, map.h, map.seed, map.base, map.plankV ?? false, map.areas]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || map.source === "image") return;
    el.width = map.w * THUMB_CELL;
    el.height = map.h * THUMB_CELL;
    paintMap(ctx, { w: map.w, h: map.h, seed: map.seed, base: map.base, plankV: map.plankV, areas: map.areas }, { cell: THUMB_CELL, grid: false });
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
  return <canvas ref={canvas} className={`cm-thumb${map.live ? " cm-thumb-live" : ""}`} aria-hidden="true" />;
}
