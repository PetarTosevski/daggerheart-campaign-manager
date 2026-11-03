"use client";

import { useSyncExternalStore } from "react";

import { PHONE_QUERY } from "./model";

function subscribe(onChange: () => void) {
  const list = window.matchMedia(PHONE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * Whether the HUD is at phone width (390 board; 760 px and below, as the classic page). Read from the media query
 * during render through `useSyncExternalStore` (no effect, CL7); false on the server, so the first paint is the desktop
 * HUD and a phone switches on hydration.
 */
export function usePhoneHud(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

const NARROW_QUERY = "(max-width: 1180px)";

function subscribeNarrow(onChange: () => void) {
  const list = window.matchMedia(NARROW_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** Whether the HUD is at tablet or phone width (1180 px and below, H7.1's tablet range); false on the server. */
export function useNarrowHud(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}
