// Map token types from World.dc.html: built-in types plus the GM's custom
// markers and renamed labels. Pure module: bundled into Convex.

import { BUILTIN_TOKEN_TYPES, type MapState } from "./map-state";

export type BuiltinTokenType = (typeof BUILTIN_TOKEN_TYPES)[number];
export type TokenType = { id: string; label: string; colour: string; path: string; custom: boolean };

/** The board's TYPES: label, colour and SVG icon path (24 × 24). */
export const TOKEN_TYPE_ART: Record<BuiltinTokenType, { label: string; colour: string; path: string }> = {
  village: { label: "Village", colour: "#5a7a3a", path: "M3 11 L12 4 L21 11 V20 H3 Z M9 20 V14 H15 V20" },
  city: { label: "City", colour: "#3a5a8a", path: "M3 20 V9 L6 6 L9 9 V20 M9 20 V12 H15 V20 M15 20 V7 L18 4 L21 7 V20 M2 20 H22" },
  cave: { label: "Cave", colour: "#5a4a3a", path: "M2 20 C4 10 8 5 12 5 C16 5 20 10 22 20 Z M8 20 C8 15 10 12 12 12 C14 12 16 15 16 20" },
  ruins: { label: "Ruins", colour: "#6a6258", path: "M4 20 V8 H8 V12 M12 20 V6 H16 V10 M16 13 V20 M19 20 V15 M2 20 H22" },
  temple: { label: "Temple", colour: "#8a6a2a", path: "M3 9 L12 3 L21 9 Z M5 9 V18 M9 9 V18 M15 9 V18 M19 9 V18 M3 18 H21 M2 21 H22" },
  dungeon: { label: "Dungeon", colour: "#3a2a3a", path: "M5 21 V10 A7 7 0 0 1 19 10 V21 Z M12 4 V21 M9 14 H10 M14 14 H15" },
  ambush: {
    label: "Ambush",
    colour: "#8e2b2b",
    path: "M4 4 L15 15 M4 4 H8 M4 4 V8 M20 4 L9 15 M20 4 H16 M20 4 V8 M7 13 L11 17 M17 13 L13 17 M9 17 L6 20 M15 17 L18 20",
  },
  monster: {
    label: "Monster lair",
    colour: "#5a2a6a",
    path: "M12 3c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4 2.6 5v2.5c0 .8.6 1.5 1.4 1.5h7c.8 0 1.4-.7 1.4-1.5V15c1.5-1 2.6-2.6 2.6-5 0-4-3.1-7-7.5-7z M9 10.5h.01 M15 10.5h.01 M10 19v2 M14 19v2",
  },
  camp: { label: "Camp", colour: "#9a5a1a", path: "M3 20 L12 5 L21 20 Z M9 20 L12 14 L15 20" },
  quest: { label: "Quest", colour: "#c0902a", path: "M12 3 a9 9 0 1 0 0.01 0 Z M12 7 V13 M12 16.5 V17" },
  treasure: { label: "Treasure", colour: "#a07a1a", path: "M3 10 H21 V20 H3 Z M3 10 C3 6 21 6 21 10 M10 13 H14 V16 H10 Z" },
  landmark: { label: "Landmark", colour: "#2a6a6a", path: "M12 22 C12 22 5 14 5 9 a7 7 0 0 1 14 0 C19 14 12 22 12 22 Z M10 9 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0" },
};

/** Custom marker colours (the board's SW swatches). */
export const MARKER_SWATCHES = ["#5a7a3a", "#3a5a8a", "#8e2b2b", "#5a2a6a", "#8a6a2a", "#2a6a6a", "#9a5a1a", "#3a3a3a"] as const;

export function isBuiltinType(id: string): id is BuiltinTokenType {
  return (BUILTIN_TOKEN_TYPES as readonly string[]).includes(id);
}

/** Every type on the palette: built-ins (with GM labels) then custom markers. */
export function tokenTypes(state: Pick<MapState, "customTypes" | "typeLabels">): TokenType[] {
  const labels = state.typeLabels;
  const out: TokenType[] = BUILTIN_TOKEN_TYPES.map((id) => ({ id, label: labels[id] || TOKEN_TYPE_ART[id].label, colour: TOKEN_TYPE_ART[id].colour, path: TOKEN_TYPE_ART[id].path, custom: false }));
  for (const c of state.customTypes) {
    const icon = isBuiltinType(c.icon) ? TOKEN_TYPE_ART[c.icon] : TOKEN_TYPE_ART.village;
    out.push({ id: c.id, label: labels[c.id] || c.label, colour: c.color, path: icon.path, custom: true });
  }
  return out;
}

/** A type by id; unknown ids fall back to the last type, as the board does. */
export function tokenType(types: TokenType[], id: string): TokenType {
  return types.find((t) => t.id === id) ?? types[types.length - 1];
}
