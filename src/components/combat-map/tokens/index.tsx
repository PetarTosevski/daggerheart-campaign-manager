"use client";

import "./tokens.css";

import type { ProviderProps } from "../slots";

/**
 * Tokens slot (D9 C6): the party, encounter adversaries and custom tokens on the map; moving, facing, the token panel
 * and range circles (R3, R4, R5). Selection is page state (`selectedTokenId`) because the vision slot reads it too.
 * Export names and props follow src/components/combat-map/slots.ts.
 */

export { CombatantsPanel } from "./combatants-panel";
export { TokenPanel } from "./token-panel";
export { TokensLayer } from "./tokens-layer";

/**
 * Per-viewer token state lives in localStorage (range circles, `rings.ts`), shared by the panel and the layer
 * through one store, so the provider holds nothing and only renders its children.
 */
export function TokensProvider({ children }: ProviderProps) {
  return <>{children}</>;
}
