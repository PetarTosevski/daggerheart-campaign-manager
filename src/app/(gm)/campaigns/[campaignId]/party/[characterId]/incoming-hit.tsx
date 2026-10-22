"use client";

import { HitBoundary, PendingHits } from "@/components/combat-map/actions/reactions";

import { useSheet } from "./sheet-context";

/**
 * The incoming-hit prompt on the character sheet (plan combat-actions AA4), at the top of the Sheet page: the same prompt
 * as on the Combat Map (armor choice as the hit PC, reaction cards as an ally; Q13, Q14), for the character's player and
 * the GM (`adversaryActions.pending` needs edit on the character). A viewer who can't edit sees nothing. A hit that
 * takes the character to their last Hit Point opens the sheet's own death-move modal (SheetDeathMoves) at once.
 */
export function SheetIncomingHit() {
  const { character, canEdit, slot } = useSheet();
  if (!canEdit || character.corrupt) return null;
  return (
    <HitBoundary>
      <PendingHits campaignId={slot.campaignId} characterId={character._id} characterName={character.sheet.name} variant="sheet" />
    </HitBoundary>
  );
}
