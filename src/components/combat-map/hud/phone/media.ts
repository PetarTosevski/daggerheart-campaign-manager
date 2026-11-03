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

/**
 * Below 1440 px the GM's spotlight panel leaves the top middle for the left column (the queue sheet on a phone): at
 * 1440 it fits under the toolbar row, narrower it would cover the map's toolbar and mid-map tokens (bead
 * dcm-bxp.99.32.42, user decision 2026-11-04). Fractional, so a 1439.5 px zoomed window is "below 1440" too.
 */
const SPOT_COLUMN_QUERY = "(max-width: 1439.98px)";

function subscribeSpotColumn(onChange: () => void) {
  const list = window.matchMedia(SPOT_COLUMN_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** Whether the GM's spotlight panel sits in the left column (below 1440 px wide); false on the server. */
export function useSpotlightInColumn(): boolean {
  return useSyncExternalStore(
    subscribeSpotColumn,
    () => window.matchMedia(SPOT_COLUMN_QUERY).matches,
    () => false,
  );
}
