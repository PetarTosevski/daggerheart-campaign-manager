"use client";

import "./spotlight.css";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { hudButtonClass } from "../ui";
import { afterHandTo, afterTake, gmTurnTitle, pcHolds, spotlightReasonLine, type SpotlightState } from "./model";

export { PhoneSpotlight, SpotlightDisc, type SpotlightDiscProps } from "./disc";

/**
 * The spotlight in the HUD (plan combat-hud H1.S, user answer 1c; H9.1; boards Main 'GM's turn', CmpTokens, GMDesktop).
 * One subscription (`combatSpotlight.state`, deduplicated by Convex across the parts) feeds:
 *
 * - `SpotlightDisc` (disc.tsx, H9.1, in the fear region): the hanging disc on every screen; the GM's opens the
 *   Party / Adversaries popover. `PhoneSpotlight`: the phone's 44 px disc under the party strip.
 * - `HudSpotlight` (the shell's pop region): for a player while the GM holds it, the "The GM has the spotlight" card
 *   (board `.gms`) and the note "Reactions only until the spotlight comes back to you" (`.gmh`). Nothing for the GM
 *   (H9.1: the GM's spotlight panel is gone; the disc moves it).
 * - `SpotlightBannerTag` (H1.1's banner class line, board `.bn-c` " · Spotlight"): the PC who holds it (kept, user
 *   answer Q11 b; the Fear banner's SPOTLIGHT pill is gone).
 * - `SpotlightHandBack` (GM only): "Give <name> the spotlight".
 *
 * Each of these calls `useQuery`, so it must sit under a `PartBoundary` (the shell gives every region part one, CL1).
 */

/** The spotlight state for the caller; `undefined` while loading. */
export function useSpotlight(campaignId: Id<"campaigns">): SpotlightState | undefined {
  return useQuery(api.combatSpotlight.state, { campaignId });
}

/** The GM's moves (intents with optimistic updates, CL3 / CL4) and the last refusal's text. */
export function useSpotlightMoves(campaignId: Id<"campaigns">) {
  const [error, setError] = useState<string | null>(null);
  const take = useMutation(api.combatSpotlight.gmTake);
  const hand = useMutation(api.combatSpotlight.handTo);
  const fail = (e: unknown) => setError(errorMessage(e));
  // The optimistic updaters are built at the click (they stamp `since` with the click's time).
  return {
    error,
    /** The GM takes it; with `tokenId` the GM spotlights that adversary, whose token the map lights. */
    take: (tokenId?: Id<"combatTokens">) => {
      setError(null);
      take
        .withOptimisticUpdate((store, args) => {
          const current = store.getQuery(api.combatSpotlight.state, { campaignId: args.campaignId });
          if (current !== undefined) store.setQuery(api.combatSpotlight.state, { campaignId: args.campaignId }, afterTake(current, Date.now(), tokenId));
        })({ campaignId, idempotencyKey: crypto.randomUUID(), ...(tokenId ? { tokenId } : {}) })
        .catch(fail);
    },
    handTo: (pc: { characterId: Id<"characters">; name: string }) => {
      setError(null);
      hand
        .withOptimisticUpdate((store, args) => {
          const current = store.getQuery(api.combatSpotlight.state, { campaignId: args.campaignId });
          if (current !== undefined) store.setQuery(api.combatSpotlight.state, { campaignId: args.campaignId }, afterHandTo(current, pc, Date.now()));
        })({ campaignId, characterId: pc.characterId, idempotencyKey: crypto.randomUUID() })
        .catch(fail);
    },
  };
}

function SpotlightIcon() {
  // The boards' Fear flame (Main `.gms-i`).
  return (
    <svg className="hud-spot-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
    </svg>
  );
}

/** H1.1: the banner's " · Spotlight" (board `.bn-c`), shown while this PC holds the spotlight. */
export function SpotlightBannerTag({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }) {
  const state = useSpotlight(campaignId);
  if (!pcHolds(state, characterId)) return null;
  return <span className="hud-spot-bn"> · Spotlight</span>;
}

/**
 * H1.1: the banner menu's hand-back button (GM only): "Give Moss the spotlight". Nothing for players, while loading, or
 * when this PC already holds it.
 */
export function SpotlightHandBack({ campaignId, characterId, name }: { campaignId: Id<"campaigns">; characterId: Id<"characters">; name: string }) {
  const state = useSpotlight(campaignId);
  const moves = useSpotlightMoves(campaignId);
  if (state === undefined || !state.canMove || pcHolds(state, characterId)) return null;
  return (
    <>
      <button type="button" className={hudButtonClass()} onClick={() => moves.handTo({ characterId, name })}>
        Give {name} the spotlight
      </button>
      {moves.error ? (
        <p role="alert" className="hud-spot-err">
          {moves.error}
        </p>
      ) : null}
    </>
  );
}

/**
 * The tokens the player's map draws besides PCs (`combatVision.playerView`'s `others`, the subscription the vision layer
 * already holds): an empty set without a map or a token of theirs on it, null while loading or when skipped.
 */
function useDrawnOthers(campaignId: Id<"campaigns">, on: boolean): ReadonlySet<string> | null {
  const view = useQuery(api.combatVision.playerView, on ? { campaignId } : "skip");
  if (view === undefined) return null;
  return new Set(view.state === "ok" ? view.others.map((t) => t._id) : []);
}

/**
 * The players' GM's-turn card (board Main 'GM's turn' `.gms`) and the reactions note (`.gmh`). User 2026-11-03: when
 * the GM spotlighted an adversary the party saw this scene and the map does not draw it now, the card names it
 * ("Jagged Knife Lieutenant has the spotlight", `gmTurnTitle`); a drawn one is lit on the map instead.
 */
export function GmTurnNotice({ campaignId, state }: { campaignId: Id<"campaigns">; state: SpotlightState }): ReactNode {
  const drawn = useDrawnOthers(campaignId, state.reactionsOnly && state.adversaryTokenId !== null);
  if (!state.reactionsOnly) return null;
  const reason = spotlightReasonLine(state);
  const title = gmTurnTitle(state, drawn);
  return (
    <>
      <div className="hud-spot-card" role="status" data-testid="hud-gm-turn">
        <span className="hud-spot-card-i">
          <SpotlightIcon />
        </span>
        <div>
          <b data-testid="hud-gm-turn-title">{title}</b>
          {reason ? <span>{reason}</span> : null}
        </div>
      </div>
      <p className="hud-spot-note">Reactions only until the spotlight comes back to you</p>
    </>
  );
}

/** The players' "The GM has the spotlight" card and reactions note (answer 1c). Nothing for the GM (H9.1: the disc). */
export const HudSpotlight: (props: HudPartProps) => ReactNode = ({ state }) => (state.role === "gm" ? null : <SpotlightPart campaignId={state.campaignId} />);

function SpotlightPart({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const state = useSpotlight(campaignId);
  if (state === undefined) {
    return (
      <p role="status" className="sr-only">
        Loading the spotlight…
      </p>
    );
  }
  if (state.canMove) return null;
  return <GmTurnNotice campaignId={campaignId} state={state} />;
}
