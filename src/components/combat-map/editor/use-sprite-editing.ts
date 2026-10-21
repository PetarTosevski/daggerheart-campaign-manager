"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";

import { spriteTraits, type SpriteTraits } from "@/lib/sprite-packs/traits";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import { hasUploadedRefs, paintSetting } from "../map-view/paint-spec";
import { spritePalette, spriteName, type SpritePalette, type UploadedRow } from "./sprite-palette";

export type SpriteEditing = {
  /** The map is drawn with sprites (not an uploaded image): the pickers show sprites and textures. */
  active: boolean;
  /** The pickers (empty lists outside the Sprites style). */
  palette: SpritePalette;
  /** An object's sprite traits (D3, Q1): catalog or uploaded row; null for no sprite or a broken ref. */
  traitsOf: (o: { sprite?: CombatMapLayout["objects"][number]["sprite"] }) => SpriteTraits | null;
  /** An object's sprite name, or null. */
  nameOf: (o: { sprite?: CombatMapLayout["objects"][number]["sprite"] }) => string | null;
};

const EMPTY: SpritePalette = { objects: [], textures: [] };

/**
 * The editor's view of a map's sprites (sprite packs P9). Reads `combatMapStyle.spriteSources` (the setting's
 * uploaded sprites and every uploaded ref on the map, labelled for the GM) when the map is drawn with sprites or
 * holds uploaded refs, and `combatMapStyle.settings` only for a pack setting (to list the built-in setting it adds
 * to). Callers sit inside the editor slot's error boundary.
 */
export function useSpriteEditing(campaignId: Id<"campaigns">, layout: CombatMapLayout): SpriteEditing {
  const isImage = layout.source === "image";
  const active = !isImage && layout.style === "sprites";
  const needSources = !isImage && (active || hasUploadedRefs(layout));
  const sources = useQuery(api.combatMapStyle.spriteSources, needSources ? { campaignId, mapId: layout._id } : "skip");
  const packSetting = active && layout.setting !== undefined && "pack" in layout.setting ? layout.setting.pack : null;
  const settings = useQuery(api.combatMapStyle.settings, packSetting !== null ? { campaignId } : "skip");

  const rows = useMemo<UploadedRow[]>(() => (sources?.view === "gm" ? sources.sprites : []), [sources]);
  const byId = useMemo(() => new Map(rows.map((r) => [r._id as string, r])), [rows]);
  // A pack setting draws its own sprites plus the built-in setting it extends (Q3); one of its own: common only.
  const folder = packSetting !== null ? (settings?.packs.find((p) => p._id === packSetting)?.extends?.id ?? "") : paintSetting(layout);
  const palette = useMemo(() => (active ? spritePalette(folder, rows) : EMPTY), [active, folder, rows]);

  return useMemo<SpriteEditing>(
    () => ({
      active,
      palette,
      traitsOf: (o) => (o.sprite ? spriteTraits(o.sprite, { uploaded: (id) => byId.get(id) }) : null),
      nameOf: (o) => (o.sprite ? spriteName(o.sprite, byId) : null),
    }),
    [active, palette, byId],
  );
}
