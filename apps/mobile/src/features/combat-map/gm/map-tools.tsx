import { useQuery } from "convex/react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { Brush } from "../../../../../../src/components/combat-map/editor/edit-model";

import { api, type Id } from "../../../convex";

import { useFogMasks, useStoredExplored, type ViewOk } from "../vision-sync";
import type { FogMasks } from "../fog-paint";
import type { FogStroke } from "./fog-brush";

/** The GM's fog brush (R12): off, or the mark a stroke paints ("erase" gives the squares back to automatic vision). */
export type FogTool = "off" | FogStroke;

export type GmMapTools = {
  campaignId: Id<"campaigns">;
  mapId: Id<"combatMaps">;
  /** The PC the GM previews (R12: exactly what that player gets), or null for the GM's own view. */
  previewId: Id<"characters"> | null;
  setPreviewId: (id: Id<"characters"> | null) => void;
  /** `previewAs` while previewing: undefined while loading. */
  preview: ViewOk | null | undefined;
  /** The previewed PC's fog (their view and stored explored area), null without a preview. */
  previewFog: FogMasks | null;
  fogTool: FogTool;
  setFogTool: (tool: FogTool) => void;
  brush: Brush;
  setBrush: (brush: Brush) => void;
};

const Ctx = createContext<GmMapTools | null>(null);

/**
 * What the GM's dock and the GM's map share (dcm-gdzi.17): the preview (`previewAs` and the PC's explored area,
 * subscribed here once for both) and the fog brush. The board puts it around the map and the dock; the GM tools
 * make their own when used alone.
 */
export function GmMapToolsProvider({ campaignId, mapId, children }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; children: ReactNode }) {
  const [previewId, setPreviewId] = useState<Id<"characters"> | null>(null);
  const [fogTool, setFogTool] = useState<FogTool>("off");
  const [brush, setBrush] = useState<Brush>(1);
  const result = useQuery(api.combatVision.previewAs, previewId ? { campaignId, characterId: previewId, mapId } : "skip");
  const ok: ViewOk | null = result?.state === "ok" && result.mapId === mapId ? result : null;
  const stored = useStoredExplored(campaignId, ok);
  const previewFog = useFogMasks(ok, stored.mask);
  const preview = previewId === null ? null : result === undefined ? undefined : ok;
  const value = useMemo<GmMapTools>(
    () => ({ campaignId, mapId, previewId, setPreviewId, preview, previewFog, fogTool, setFogTool, brush, setBrush }),
    [campaignId, mapId, previewId, preview, previewFog, fogTool, brush],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The shared tools, or null outside a provider. */
export function useGmMapTools(): GmMapTools | null {
  return useContext(Ctx);
}

/** Puts a provider around `children` unless one is already there (the GM tools rendered on their own). */
export function EnsureGmMapTools({ campaignId, mapId, children }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; children: ReactNode }) {
  const outer = useContext(Ctx);
  if (outer !== null) return <>{children}</>;
  return (
    <GmMapToolsProvider campaignId={campaignId} mapId={mapId}>
      {children}
    </GmMapToolsProvider>
  );
}
