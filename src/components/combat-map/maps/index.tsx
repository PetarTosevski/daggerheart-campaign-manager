"use client";

import "./maps.css";

import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { CombatMapSummary, CurrentMapArgs, MapHeaderLineProps } from "../slots";
import { pickMap } from "./maps-panel";

/**
 * Maps slot (D9 C3): the campaign's maps, the map on screen and the map area. Export names and props follow
 * src/components/combat-map/slots.ts; the pan/zoom view lives in src/components/combat-map/map-view/.
 */
export { MapBoard } from "../map-view/map-board";
export { MapsPanel } from "./maps-panel";
export { MapImageButton } from "./image-upload";

/**
 * The map on screen (`CombatPageState.map`): `undefined` while loading, null when there is none. GM: the picked
 * map, else the live one, else the newest (from `list`). Player: the live map (`live`, Q1).
 */
export function useCurrentMap({ campaignId, role, selectedMapId }: CurrentMapArgs): CombatMapSummary | null | undefined {
  const gm = role === "gm";
  const maps = useQuery(api.combatMaps.list, gm ? { campaignId } : "skip");
  const live = useQuery(api.combatMaps.live, gm ? "skip" : { campaignId });
  const row = gm ? (maps === undefined ? undefined : pickMap(maps, selectedMapId)) : live;
  if (row === undefined || row === null) return row;
  return { _id: row._id, name: row.name, live: row.live, source: row.source, w: row.w, h: row.h };
}

/** Header line under the title (board copy). GM: "Name · W × H squares · N tokens"; players never see the size (Q1). */
export function MapHeaderLine({ campaignId, role, map }: MapHeaderLineProps) {
  const gm = role === "gm";
  const tokens = useQuery(api.combatMaps.tokenCount, gm && map ? { campaignId, mapId: map._id } : "skip");
  if (!gm) return <>{map ? map.name : "The GM hasn’t put a map live yet."}</>;
  if (!map) return <>Describe a scene to draw a battle map, then place the party and the encounter.</>;
  return (
    <>
      {map.name} · {map.w} × {map.h} squares
      {tokens === undefined ? null : ` · ${tokens} token${tokens === 1 ? "" : "s"}`}
    </>
  );
}
