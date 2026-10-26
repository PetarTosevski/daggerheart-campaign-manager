"use client";

import "./vision.css";

/**
 * Vision slot (D9 C8, on C7's server functions): light by campaign time, each player's own view, fog of war,
 * explored areas, reveals, map and carried lights, and the GM's preview and fog brush (R6–R12, Q1, Q3, Q4). Export
 * names and props follow src/components/combat-map/slots.ts.
 */

export { VisionProvider } from "./vision-state";
export { LightPill, PreviewPicker } from "./header";
export { RevealPanel, VisionPanel } from "./panels";
export { VisionLayer } from "./vision-layer";
