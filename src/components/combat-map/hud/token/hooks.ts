"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { blockedReason, type Blocked } from "../blocked/reason";
import { useHud, type HudState } from "../state";
import { hudToasts } from "../toasts/store";
import { hopeByToken } from "./model";

/**
 * The HUD state when a token layer draws the HUD face, else null (the classic face). The face shows when the map is in
 * Play and the layer sits inside the HUD shell's `HudProvider`: exactly when the page renders the shell (`page.tsx`:
 * `state.mode === "play"`). The Encounter tab's map pane and the GM's Edit mode never mount the provider, so they keep
 * the classic face.
 */
export function useHudTokens(mode: "play" | "edit"): HudState | null {
  const hud = useOptionalHud();
  return mode === "play" ? hud : null;
}

/** Each PC token's Hope from `combatHud.party` (HD1), read only while the HUD face shows; empty while loading. */
export function useTokenHope(campaignId: Id<"campaigns">, mapId: Id<"combatMaps">, on: boolean): ReadonlyMap<string, number> {
  const rows = useQuery(api.combatHud.party, on ? { campaignId, mapId } : "skip");
  return useMemo(() => hopeByToken(rows), [rows]);
}

/**
 * Why a player's token can't move now (H6.2; user answer 2026-11-01: while the GM holds the spotlight token moves are
 * refused like actions), or null. Read only inside the HUD for a player (`combatSpotlight.state`, the subscription the
 * spotlight parts share). The token layer then starts no drag or key move and `refuseMove` says why.
 */
export function useHudMoveLock(campaignId: Id<"campaigns">, role: "gm" | "player", on: boolean): Blocked | null {
  const state = useQuery(api.combatSpotlight.state, on && role === "player" ? { campaignId } : "skip");
  return blockedReason({ spotlightWithGm: state?.reactionsOnly === true });
}

/** A move tried while it is locked: the refusal as a toast near the hand (a token has no control to show it under). */
export function refuseMove(lock: Blocked): void {
  hudToasts.refusal(lock.refusal);
}

/**
 * The HUD shell's `HudProvider` state when the layer sits inside it, else null (the classic page, the Encounter
 * tab). `useHud` reads the context unconditionally before it throws, so the hook order is the same either way.
 */
export function useOptionalHud(): HudState | null {
  try {
    return useHud();
  } catch {
    return null;
  }
}
