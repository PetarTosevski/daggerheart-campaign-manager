"use client";

import { useQuery } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Who sees whose hand (plan followups-7 H4, dcm-bxp.99.24; user answer 2026-10-22): "hiding hands = BOTH - a GM campaign
 * switch 'Players can see each other's cards' (on by default) and, when allowed, each player can hide their own hand.
 * The GM always sees every hand." `combatCards.handSharing` is the one subscription; the server decides in
 * `combatCards.hand` (FORBIDDEN for a hidden hand), this only keeps the client from asking.
 */

export type HandSharing = { playersSeeHands: boolean; hidden: readonly Id<"characters">[] };

/** Whether another player may read this character's hand. */
export function handShared(sharing: HandSharing, characterId: Id<"characters">): boolean {
  return sharing.playersSeeHands && !sharing.hidden.includes(characterId);
}

/** The campaign's hand sharing (undefined while loading). */
export function useHandSharing(campaignId: Id<"campaigns">): HandSharing | undefined {
  return useQuery(api.combatCards.handSharing, { campaignId });
}
