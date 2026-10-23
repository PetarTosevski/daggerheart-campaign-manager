"use client";

import { createContext, useContext, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CombatPageState, ProviderProps } from "../../slots";
import { okView, useViewing, type OtherToken, type ViewOk } from "../../vision/use-vision";

/** Which weapon the Attack bar uses; the target hints (range) follow it. */
export type WeaponSlot = "primary" | "secondary";

/**
 * The enemy tokens the player picked as targets, shared by the vision layer (a click on an enemy token toggles it),
 * the target rings, the target list, the Attack bar and the Hand (CA6); plus the weapon slot the Attack bar uses, so
 * the rings and the list show the range of the weapon about to be used.
 */
export type CombatTargets = {
  targetTokenIds: readonly Id<"combatTokens">[];
  /**
   * Single-select (user answer 2026-10-22, CB p.96: "By default, each attack roll can only target one adversary"):
   * picking another enemy replaces the pick; picking the picked one clears it.
   */
  toggleTarget: (tokenId: Id<"combatTokens">) => void;
  /** Multi-select, for cards and features that name several targets (CA6): adds or removes one token. */
  toggleExtraTarget: (tokenId: Id<"combatTokens">) => void;
  clearTargets: () => void;
  slot: WeaponSlot;
  setSlot: (slot: WeaponSlot) => void;
  /**
   * A card the player dragged onto the map that still needs its one enemy target (plan hand-fan HF1, dcm-bxp.99.30:
   * "targeting on the map happens after it is played"): the next enemy picked on the map (`toggleTarget`) is handed to
   * `onTarget` in that click's event handler, and the aim ends. null while no card waits.
   */
  aim: Aim | null;
  setAim: Dispatch<SetStateAction<Aim | null>>;
};

/** A played card waiting for its target on the map: who plays it, and what to do with the enemy picked. */
export type Aim = { characterId: Id<"characters">; cardId: string; cardName: string; onTarget: (tokenId: Id<"combatTokens">) => void };

const NO_TARGETS: CombatTargets = {
  targetTokenIds: [],
  toggleTarget: () => {},
  toggleExtraTarget: () => {},
  clearTargets: () => {},
  slot: "primary",
  setSlot: () => {},
  aim: null,
  setAim: () => {},
};

const TargetsContext = createContext<CombatTargets>(NO_TARGETS);

/** Holds the picked targets for the whole page; renders its children and nothing else. */
export function ActionsProvider({ children }: ProviderProps) {
  const [targetTokenIds, setTargets] = useState<readonly Id<"combatTokens">[]>([]);
  const [slot, setSlot] = useState<WeaponSlot>("primary");
  const [aim, setAim] = useState<Aim | null>(null);
  const value = useMemo<CombatTargets>(
    () => ({
      targetTokenIds,
      toggleTarget: (tokenId) => {
        const picked = !(targetTokenIds.length === 1 && targetTokenIds[0] === tokenId);
        setTargets(picked ? [tokenId] : []);
        // A card waiting on the map takes the enemy just picked (in the click's handler, never an effect: rule 13).
        if (aim && picked) {
          setAim(null);
          aim.onTarget(tokenId);
        }
      },
      toggleExtraTarget: (tokenId) =>
        setTargets((ids) => (ids.includes(tokenId) ? ids.filter((id) => id !== tokenId) : [...ids, tokenId])),
      clearTargets: () => setTargets([]),
      slot,
      setSlot,
      aim,
      setAim,
    }),
    [targetTokenIds, slot, aim],
  );
  return <TargetsContext.Provider value={value}>{children}</TargetsContext.Provider>;
}

/** The picked targets (empty outside an `ActionsProvider`). */
export function useCombatTargets(): CombatTargets {
  return useContext(TargetsContext);
}

/**
 * The player's character on the map and what it sees (C7's `playerView`, one shared subscription with the vision
 * slots): null for the GM, while loading, or when the character has no token on the live map.
 */
export type Actor = { characterId: Id<"characters">; view: ViewOk; enemies: readonly OtherToken[] };

export function useActor(state: Pick<CombatPageState, "campaignId" | "role" | "mode" | "map" | "previewCharacterId">): Actor | null {
  const viewing = useViewing(state);
  if (viewing.kind !== "player") return null;
  const view = okView(viewing);
  if (!view) return null;
  return { characterId: view.characterId, view, enemies: view.others.filter((t) => t.side === "enemy") };
}

/** The picked targets the character still sees (a token that left its view drops out of the attack). */
export function seenTargets(picked: readonly Id<"combatTokens">[], enemies: readonly Pick<OtherToken, "_id">[]): Id<"combatTokens">[] {
  const seen = new Set<string>(enemies.map((t) => t._id));
  return picked.filter((id) => seen.has(id));
}
