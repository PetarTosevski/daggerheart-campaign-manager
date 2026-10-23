"use client";

import "../../../../app/(gm)/campaigns/[campaignId]/combat-map/combat-map.css";

import { useState } from "react";

import { MapBoard } from "@/components/combat-map/maps";
import type { CombatMapSummary, CombatPageState } from "@/components/combat-map/slots";
import { TokensLayer } from "@/components/combat-map/tokens";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MapToken } from "./model";

/**
 * A compact copy of the live Combat Map on the Encounter tab (plan combat-actions AA3, Q16): the Combat Map's own board
 * and tokens layer in Play, so a token dragged here moves through `combatTokens.move` and shows on the Combat Map at
 * once. Clicking a PC token picks or drops it as a target; clicking an adversary token selects that adversary. Tokens
 * can't be deleted here (AA3b: `noDelete`); that stays on the Combat Map.
 */
export function MapPane({
  campaignId,
  map,
  tokens,
  onPickToken,
}: {
  campaignId: Id<"campaigns">;
  map: CombatMapSummary;
  tokens: readonly MapToken[];
  onPickToken: (token: MapToken) => void;
}) {
  const [selectedTokenId, setSelectedTokenId] = useState<Id<"combatTokens"> | null>(null);
  const state: CombatPageState = {
    campaignId,
    role: "gm",
    mode: "play",
    map,
    selectedTokenId,
    onSelectToken: (tokenId) => {
      setSelectedTokenId(tokenId);
      const token = tokenId === null ? undefined : tokens.find((t) => t._id === tokenId);
      if (token) onPickToken(token);
    },
    previewCharacterId: null,
    onPreview: () => {},
  };
  return (
    <section className="trk-map" aria-label="Live map">
      <h3 className="trk-windows-h">Live map: {map.name}</h3>
      <p className="trk-muted">Drag tokens to move them on the Combat Map. Click a PC to target it, an adversary to select it.</p>
      <div className="cm-root trk-map-root">
        <MapBoard {...state} renderLayers={(layer) => <TokensLayer {...layer} noDelete />} />
      </div>
    </section>
  );
}
