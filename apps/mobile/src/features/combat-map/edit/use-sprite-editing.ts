import { useQuery } from "convex/react";
import { useMemo } from "react";

import { spritePalette, spriteName, type SpritePalette, type UploadedRow } from "../../../../../../src/components/combat-map/editor/sprite-palette";
import { hasUploadedRefs, paintSetting } from "../../../../../../src/components/combat-map/map-view/paint-spec";
import { spriteTraits, type SpriteTraits } from "../../../../../../src/lib/sprite-packs/traits";

import { api } from "../../../convex";
import type { Id } from "../../../convex";
import type { CombatMapLayout } from "../contract";

export type SpriteEditing = {
  active: boolean;
  palette: SpritePalette;
  traitsOf: (o: { sprite?: CombatMapLayout["objects"][number]["sprite"] }) => SpriteTraits | null;
  nameOf: (o: { sprite?: CombatMapLayout["objects"][number]["sprite"] }) => string | null;
};

const EMPTY: SpritePalette = { objects: [], textures: [] };

export function useSpriteEditing(campaignId: Id<"campaigns">, layout: CombatMapLayout): SpriteEditing {
  const isImage = layout.source === "image";
  const active = !isImage && layout.style === "sprites";
  const needSources = !isImage && (active || hasUploadedRefs(layout));
  const sources = useQuery(api.combatMapStyle.spriteSources, needSources ? { campaignId, mapId: layout._id } : "skip");
  const packSetting = active && layout.setting !== undefined && "pack" in layout.setting ? layout.setting.pack : null;
  const settings = useQuery(api.combatMapStyle.settings, packSetting !== null ? { campaignId } : "skip");

  const rows = useMemo<UploadedRow[]>(() => (sources?.view === "gm" ? sources.sprites : []), [sources]);
  const byId = useMemo(() => new Map(rows.map((r) => [r._id as string, r])), [rows]);
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
