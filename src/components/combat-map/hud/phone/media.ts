"use client";

import { useSyncExternalStore } from "react";

import { useFeature } from "@/lib/use-feature";

import { PHONE_QUERY } from "./model";

function subscribe(onChange: () => void) {
  const list = window.matchMedia(PHONE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * Whether the HUD is at phone width (390 board; 760 px and below, as the classic page). Read from the media query
 * during render through `useSyncExternalStore` (no effect, CL7); false on the server, so the first paint is the desktop
 * HUD and a phone switches on hydration. False while the owner's Phone layout switch is off for the user (config AF1):
 * the HUD then keeps its tablet layout at every width (the player's desktop regions, the GM's inline queue).
 */
export function usePhoneHud(): boolean {
  const allowed = useFeature("phoneLayout");
  const phoneWidth = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
  return allowed && phoneWidth;
}
