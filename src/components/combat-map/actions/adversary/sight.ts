"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";

import { lineOfSight, type SightResult } from "@/lib/domain/combat-actions/sight";
import type { Footprint } from "@/lib/domain/combat-actions/distance";
import { prepareMap, type VisionObject } from "@/lib/domain/combat-map/vision";
import { spriteTraits } from "@/lib/sprite-packs/traits";

import { api } from "../../../../../convex/_generated/api";
import type { CombatMapLayout } from "../../../../../convex/combatMaps";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { decodeCells } from "../../map-view/cells";

/** A layout object as the vision engine reads it; built-in sprites with their catalog traits (as the movement overlay). */
function visionObject(o: CombatMapLayout["objects"][number]): VisionObject {
  const builtin = o.sprite !== undefined && "builtin" in o.sprite ? o.sprite : null;
  return {
    kind: o.kind,
    x: o.x,
    y: o.y,
    r: o.r,
    rot: o.rot,
    sight: o.sight ?? null,
    lit: o.lit ?? null,
    open: o.open ?? null,
    traits: builtin ? spriteTraits(builtin) : null,
  };
}

/** Line of sight on a layout, as the server's scene prepares it (walls, painted blockers, sight-blocking objects). */
export function sightOn(layout: CombatMapLayout): (from: Footprint, to: Footprint) => SightResult {
  const cells = decodeCells(layout.cells, layout.w, layout.h);
  const objects = layout.objects.map(visionObject);
  const map = prepareMap({
    w: layout.w,
    h: layout.h,
    base: layout.base,
    areas: layout.areas,
    objects,
    paint: cells.paint,
    block: cells.block,
    image: layout.source === "image",
  });
  return (from, to) => lineOfSight(map, from, to, objects);
}

/**
 * Line of sight on the live map for the adversary panel's range list (Q2). A hint only: the server checks it again on
 * the attack (COMBAT_NO_LINE_OF_SIGHT); an uploaded sprite counts as its Classic kind here. Null while loading.
 */
export function useLiveSight(campaignId: Id<"campaigns">, mapId: Id<"combatMaps"> | null): ((from: Footprint, to: Footprint) => SightResult) | null {
  const layout = useQuery(api.combatMaps.get, mapId ? { campaignId, mapId } : "skip");
  return useMemo(() => (layout ? sightOn(layout) : null), [layout]);
}
