import type { FunctionReturnType } from "convex/server";

import type { api } from "../../convex";

/** Live map payload from `maps.get`. The server filters player-visible tokens and hexes. */
export type WorldMapData = FunctionReturnType<typeof api.maps.get>;

/** Slot id the C5-world-edit tracer will mount (palette, paint, token panel). */
export const WORLD_EDIT_SLOT = "world-edit-slot";
