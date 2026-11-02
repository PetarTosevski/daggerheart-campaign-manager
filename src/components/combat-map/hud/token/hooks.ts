"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useHudEnabled } from "../flag";
import { useHud, type HudState } from "../state";
import { hopeByToken } from "./model";

/**
 * The HUD state when a token layer draws the HUD face, else null (the classic face). The face shows when the switch is
 * on, the map is in Play and the layer sits inside the HUD shell's `HudProvider`: exactly when the page renders the
 * shell (`page.tsx`: `hud && state.mode === "play"`). The Encounter tab's map pane and the classic page never mount the
 * provider, so they keep the classic face whatever the switch says.
 */
export function useHudTokens(mode: "play" | "edit"): HudState | null {
  const enabled = useHudEnabled();
  const hud = useOptionalHud();
  return enabled && mode === "play" ? hud : null;
}

/** Each PC token's Hope from `combatHud.party` (HD1), read only while the HUD face shows; empty while loading. */
export function useTokenHope(campaignId: Id<"campaigns">, mapId: Id<"combatMaps">, on: boolean): ReadonlyMap<string, number> {
  const rows = useQuery(api.combatHud.party, on ? { campaignId, mapId } : "skip");
  return useMemo(() => hopeByToken(rows), [rows]);
}

/**
 * The HUD state when the layer sits inside the HUD shell's `HudProvider`, else null (the classic page, the Encounter
 * tab). `useHud` reads the context unconditionally before it throws, so the hook order is the same either way.
 */
export function useOptionalHud(): HudState | null {
  try {
    return useHud();
  } catch {
    return null;
  }
}
