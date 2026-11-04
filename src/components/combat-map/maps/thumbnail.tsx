"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";

import { paintMap } from "@/lib/combat-map/painter";
import { spriteImages } from "@/lib/combat-map/sprites/loader";
import * as sprites from "@/lib/combat-map/sprites/painter";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapListRow } from "../../../../convex/combatMaps";
import { decodeCells } from "../map-view/cells";
import { decodeTextureCells, paintSetting } from "../map-view/paint-spec";

/** Pixels per square of a list thumbnail (terrain only: the list does not load objects). */
const THUMB_CELL = 4;

const NO_UPLOADS: sprites.UploadedSprites = new Map();

/** A thumbnail's hand-painted cells (`combatMapStyle.thumbnail`), or null before they load or when the read failed. */
type Painted = { tiles: readonly { layer: "terrain" | "texture"; tile: number; cells: string }[]; texturePalette: readonly ({ builtin: string } | { uploaded: string })[]; extends: string | null };

/**
 * The board's map thumbnail (84 x 56): the uploaded image, or the painted terrain of the layout in the map's style
 * (sprite packs P6: a Sprites map shows its textures, repainted as they load), with the GM's hand-painted terrain and
 * texture cells on top (dcm-bxp.97, `combatMapStyle.thumbnail`; a pack setting draws from the setting it extends).
 * Uploaded textures, which the thumbnail does not resolve, show their Classic terrain. If the cells read fails, the
 * layout alone is drawn.
 */
export function MapThumbnail({ map }: { map: CombatMapListRow }) {
  if (map.source === "image") return <ThumbnailView map={map} painted={null} />;
  return (
    <ThumbBoundary fallback={<ThumbnailView map={map} painted={null} />}>
      <WithCells map={map} />
    </ThumbBoundary>
  );
}

function WithCells({ map }: { map: CombatMapListRow }) {
  const { campaignId } = useParams<{ campaignId: Id<"campaigns"> }>();
  const painted = useQuery(api.combatMapStyle.thumbnail, { campaignId, mapId: map._id });
  return <ThumbnailView map={map} painted={painted ?? null} />;
}

/** Keeps a failed cells read (a map deleted meanwhile) from breaking the Maps panel: the layout alone is drawn. */
class ThumbBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ThumbnailView({ map, painted }: { map: CombatMapListRow; painted: Painted | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const style = map.style === "sprites" ? "sprites" : "classic";
  const setting = style === "sprites" ? paintSetting({ setting: map.setting, name: map.name }, painted?.extends ?? null) : "";
  const cells = useMemo(() => {
    if (painted === null) return { paint: {}, textures: {} };
    const textureCells = painted.tiles.filter((t) => t.layer === "texture");
    return {
      paint: decodeCells(painted.tiles, map.w, map.h).paint,
      textures: style === "sprites" ? decodeTextureCells({ w: map.w, h: map.h, texturePalette: painted.texturePalette, textureCells }) : {},
    };
  }, [painted, map.w, map.h, style]);
  const terrainKey = JSON.stringify([map.w, map.h, map.seed, map.base, map.plankV ?? false, map.areas, style, setting, painted?.tiles ?? null, painted?.texturePalette ?? null]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || map.source === "image") return;
    el.width = map.w * THUMB_CELL;
    el.height = map.h * THUMB_CELL;
    const terrain = { w: map.w, h: map.h, seed: map.seed, base: map.base, plankV: map.plankV, areas: map.areas };
    if (style === "classic") {
      paintMap(ctx, terrain, { cell: THUMB_CELL, grid: false, paint: cells.paint });
      return;
    }
    const art = spriteImages();
    const spec = { ...terrain, objects: [], setting, textures: cells.textures, uploaded: NO_UPLOADS };
    const prepared = sprites.paintMap(ctx, spec, { cell: THUMB_CELL, grid: false, art, paint: cells.paint });
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
    // terrainKey stands for the fields painted above (`cells` is derived from them).
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
  return <canvas ref={canvas} className={`cm-thumb${map.live ? " cm-thumb-live" : ""}`} data-style={style} data-painted={painted === null ? undefined : painted.tiles.length} aria-hidden="true" />;
}
