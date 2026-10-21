"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { ActionsPanelProps, ProviderProps } from "../slots";
import { AttackBar } from "./attack";
import { MapDice } from "./dice";
import { Hand } from "./hand";
import { TargetList } from "./targets";

export { Resolutions } from "./gm";
export { TargetsLayer } from "./targets";

/**
 * Combat actions slot (plan combat-actions; CA0 stub, CA5 fills it): the player's Hand, Attack bar, targets, map dice
 * box and mini feed, and the GM's Resolutions. Export names and props follow src/components/combat-map/slots.ts.
 */

/** The enemy tokens the player picked as targets, shared by the vision layer, the target rings, the Attack bar and the Hand. */
export type CombatTargets = {
  targetTokenIds: readonly Id<"combatTokens">[];
  toggleTarget: (tokenId: Id<"combatTokens">) => void;
  clearTargets: () => void;
};

const NO_TARGETS: CombatTargets = { targetTokenIds: [], toggleTarget: () => {}, clearTargets: () => {} };

const TargetsContext = createContext<CombatTargets>(NO_TARGETS);

/** Holds the picked targets for the whole page; renders its children and nothing else. */
export function ActionsProvider({ children }: ProviderProps) {
  const [targetTokenIds, setTargets] = useState<readonly Id<"combatTokens">[]>([]);
  const value = useMemo<CombatTargets>(
    () => ({
      targetTokenIds,
      toggleTarget: (tokenId) =>
        setTargets((ids) => (ids.includes(tokenId) ? ids.filter((id) => id !== tokenId) : [...ids, tokenId])),
      clearTargets: () => setTargets([]),
    }),
    [targetTokenIds],
  );
  return <TargetsContext.Provider value={value}>{children}</TargetsContext.Provider>;
}

/** The picked targets (empty outside an `ActionsProvider`). */
export function useCombatTargets(): CombatTargets {
  return useContext(TargetsContext);
}

/** Player column: everything a player does on the map. The stub's parts render nothing yet. */
export function ActionsPanel(props: ActionsPanelProps) {
  return (
    <>
      <Hand {...props} />
      <AttackBar {...props} />
      <TargetList {...props} />
      <MapDice {...props} />
    </>
  );
}
