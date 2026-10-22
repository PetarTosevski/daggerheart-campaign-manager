"use client";

import { useQuery } from "convex/react";

import { DeathMoveModal } from "@/components/party/death";

import { api } from "../../../../../convex/_generated/api";
import type { CharacterView } from "../../../../../convex/characters";
import type { IncomingHitProps } from "../../slots";
import { HitBoundary, PendingHits } from "./prompt";

export { HitBoundary, PendingHits, type PromptVariant } from "./prompt";

/**
 * The incoming-hit prompt on the Combat Map (plan combat-actions AA4), first in the player column: for each of the
 * player's own characters, the open hits from `adversaryActions.pending` (armor choice as the hit PC, reaction cards as
 * an ally; Q13, Q14, Q17). At phone width an owed prompt is a bottom sheet with 44 px buttons (Q11). A hit that takes the
 * character to their last Hit Point brings up the existing death-move choice here too (user answer 2026-10-22; CB p.91
 * "When you mark your last Hit Point, you must make a death move"). The GM answers from the Encounter tab or the map's
 * adversary panel ("Resolve now"), so the GM column shows nothing from here.
 */
export function IncomingHit(props: IncomingHitProps) {
  if (props.role !== "player") return null;
  return (
    <HitBoundary>
      <PlayerHits {...props} />
    </HitBoundary>
  );
}

function PlayerHits({ campaignId }: IncomingHitProps) {
  const characters = useQuery(api.characters.listByCampaign, { campaignId });
  if (characters === undefined) return null;
  const mine = characters.filter((c) => c.mine && !c.corrupt);
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((c) => (
        <div key={c._id} className="ih-char">
          <PendingHits campaignId={campaignId} characterId={c._id} characterName={c.sheet.name} variant="map" />
          <MapDeathMove campaignId={campaignId} character={c} />
        </div>
      ))}
    </>
  );
}

/** The sheet's death-move modal (CB p.106), mounted on the map only while a move is due, so it opens at once. */
function MapDeathMove({ campaignId, character }: { campaignId: IncomingHitProps["campaignId"]; character: CharacterView }) {
  const state = useQuery(api.deathMoves.state, { characterId: character._id });
  if (state === undefined || !(state.awaitingMove || state.pending !== null)) return null;
  return (
    <div className="ih-death" data-testid="incoming-hit-death">
      <DeathMoveModal campaignId={campaignId} character={character} canEdit={character.canEdit} isGm={false} hopeAndFear={false} />
    </div>
  );
}
