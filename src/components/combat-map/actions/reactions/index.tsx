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
 * "When you mark your last Hit Point, you must make a death move"). The GM answers other players' hits with "Resolve now"
 * (Encounter tab, the map's adversary panel); a PC the GM owns gets this same prompt in the GM column (`GmOwnHits`).
 */
export function IncomingHit(props: IncomingHitProps) {
  if (props.role !== "player") return null;
  return (
    <HitBoundary>
      <OwnHits campaignId={props.campaignId} />
    </HitBoundary>
  );
}

/**
 * GM column on the map (plan combat-actions AA5; user answer 2026-10-22: "a PC the GM owns gets the same incoming-hit
 * prompt in the GM column on the map"): the same prompt as a player's, for each character the GM owns (`mine`). The
 * players' characters are not listed here: their players answer, and the GM has "Resolve now".
 */
export function GmOwnHits(props: Pick<IncomingHitProps, "campaignId" | "role">) {
  if (props.role !== "gm") return null;
  // In the GM column the prompt stays in the column at phone width (no bottom sheet over the adversary controls).
  return (
    <div className="ih-gm">
      <HitBoundary>
        <OwnHits campaignId={props.campaignId} />
      </HitBoundary>
    </div>
  );
}

/** The open hits (and a due death move) of every character the viewer owns. */
function OwnHits({ campaignId }: Pick<IncomingHitProps, "campaignId">) {
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
