"use client";

// Shared domain cards in the card pickers (CB p.21, plan rule-switches OSC; docs/tasks/TASK-RULES-OSC.md). The campaign's
// mode comes from `ruleSettings.get`, the cards the other characters hold from `charactersReads.listByCampaign` (every
// member reads every sheet). A picker shows `sharedCardNote` on a card ("Mira already has this card") and, under
// `refuse`, disables it; the server refuses the same (`assertCardsUnshared` in convex/characters.ts).
//
// ```tsx
// const shared = useSharedCards(campaignId, character._id);
// const note = shared ? sharedCardNote(shared.mode, shared.holders, card.id) : null; // "Mira already has this card"
// const refused = shared?.mode === "refuse" && note !== null;
// ```

import { useQuery } from "convex/react";
import { useMemo } from "react";

import { cardHolders, type SharedCardsMode } from "@/lib/domain/characters";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type SharedCards = { mode: SharedCardsMode; holders: ReadonlyMap<string, readonly string[]> };

/**
 * The campaign's Shared domain cards mode and who holds which card: every character of the campaign but `exceptId` (the
 * one choosing; none in the creation wizard). Undefined while loading.
 */
export function useSharedCards(campaignId: Id<"campaigns">, exceptId?: Id<"characters">): SharedCards | undefined {
  const rules = useQuery(api.ruleSettings.get, { campaignId });
  const party = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const mode = rules?.modes.sharedDomainCards;
  return useMemo(() => {
    if (mode === undefined || party === undefined) return undefined;
    const holders = mode === "allow" ? new Map<string, string[]>() : cardHolders(party.map((c) => ({ id: c._id, name: c.sheet.name, cards: [...c.sheet.domainCards.owned, ...c.sheet.domainCards.loadout] })), exceptId);
    return { mode, holders };
  }, [mode, party, exceptId]);
}
