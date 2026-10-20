"use client";

import type { CombatantsPanelProps, MapLayerProps, ProviderProps, TokenPanelProps } from "../slots";

/**
 * Tokens slot (C6 fills it): the party, encounter adversaries and custom tokens on the map; moving, facing, the
 * token panel and range circles (R3, R4, R5). Selection is page state (`selectedTokenId`) because the vision slot
 * reads it too. Keep the export names and props (src/components/combat-map/slots.ts).
 */

/** Holds per-viewer token state (range circles on/off, kept in localStorage; R3). Stub: no state. */
export function TokensProvider({ children }: ProviderProps) {
  return <>{children}</>;
}

/** GM, left column in Play: the board's Combatants card. Stub: the card's heading only. */
export function CombatantsPanel(props: CombatantsPanelProps) {
  void props;
  return (
    <section className="cm-card" aria-labelledby="cm-combatants-h">
      <div className="cm-row cm-between">
        <h2 id="cm-combatants-h" className="cm-h">
          Combatants
        </h2>
        <span className="cm-muted">No tokens</span>
      </div>
    </section>
  );
}

/** Left column: the selected token's card. Stub: nothing is ever selected. */
export function TokenPanel(props: TokenPanelProps) {
  void props;
  return null;
}

/** Map area: tokens, facing handles and range circles. Stub: draws nothing. */
export function TokensLayer(props: MapLayerProps) {
  void props;
  return null;
}
