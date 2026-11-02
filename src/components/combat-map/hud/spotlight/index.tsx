"use client";

import "./spotlight.css";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { hudButtonClass } from "../ui";
import { afterHandTo, afterTake, gmHolds, holderLine, pcHolds, spotlightReasonLine, type SpotlightState } from "./model";

/**
 * The spotlight in the HUD (plan combat-hud H1.S, user answer 1c; boards Main 'GM's turn', CmpTokens, GMDesktop). One
 * subscription (`combatSpotlight.state`, deduplicated by Convex across the parts) feeds:
 *
 * - `HudSpotlight` (the shell's pop region): for a player while the GM holds it, the "The GM has the spotlight" card
 *   (board `.gms`) and the note "Reactions only until the spotlight comes back to you" (`.gmh`); for the GM, the
 *   spotlight menu (`SpotlightMenu`) under the Fear banner until H1.2 hosts it in the Fear banner itself.
 * - `SpotlightBannerTag` (H1.1's banner class line, board `.bn-c` " · Spotlight"): the PC who holds it.
 * - `FearSpotlightTag` (H1.2's Fear banner, board `.fb-spot` SPOTLIGHT): the GM holds it.
 * - `SpotlightHandBack` (H1.1's banner menu, GM only): "Give <name> the spotlight".
 * - `SpotlightMenu` (the GM): Take the spotlight / hand it to a PC on the map.
 *
 * Each of these calls `useQuery`, so it must sit under a `PartBoundary` (the shell gives every region part one, CL1).
 * Until beads dcm-bxp.99.32.4 / .5 wire the engine, only the GM moves the spotlight and nothing is refused.
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
    take: () => {
      setError(null);
      take
        .withOptimisticUpdate((store, args) => {
          const current = store.getQuery(api.combatSpotlight.state, { campaignId: args.campaignId });
          if (current !== undefined) store.setQuery(api.combatSpotlight.state, { campaignId: args.campaignId }, afterTake(current, Date.now()));
        })({ campaignId, idempotencyKey: crypto.randomUUID() })
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

/** H1.2: the Fear banner's SPOTLIGHT pill (board `.fb-spot`), shown while the GM holds the spotlight. */
export function FearSpotlightTag({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const state = useSpotlight(campaignId);
  if (!gmHolds(state)) return null;
  return <span className="hud-spot-fb">Spotlight</span>;
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
 * The GM's spotlight menu (H1.2 may host it in the Fear banner): who holds it, Take the spotlight, and one button per
 * PC on the map to hand it to (`combatHud.party`, the banners' subscription). Nothing for players.
 */
export function SpotlightMenu({ campaignId, mapId }: { campaignId: Id<"campaigns">; mapId?: Id<"combatMaps"> }) {
  const state = useSpotlight(campaignId);
  const party = useQuery(api.combatHud.party, state?.canMove ? { campaignId, mapId } : "skip");
  const moves = useSpotlightMoves(campaignId);
  if (state === undefined) {
    return (
      <p role="status" className="hud-spot-line">
        Loading the spotlight…
      </p>
    );
  }
  if (!state.canMove) return null;
  const gm = gmHolds(state);
  const reason = gm ? spotlightReasonLine(state) : "";
  const pcs = (party ?? []).filter((pc) => !pcHolds(state, pc.characterId));
  return (
    <div className="hud-spot-menu" data-testid="hud-spotlight-menu">
      <p className="hud-spot-line" aria-live="polite">
        <b>{holderLine(state)}</b>
        {reason ? ` ${reason}` : null}
      </p>
      {gm ? null : (
        <button type="button" className={hudButtonClass("primary")} onClick={moves.take}>
          Take the spotlight
        </button>
      )}
      {pcs.length > 0 ? (
        <div className="hud-spot-pcs" role="group" aria-label={gm ? "Hand the spotlight back to" : "Give the spotlight to"}>
          {pcs.map((pc) => (
            <button
              key={pc.characterId}
              type="button"
              className={hudButtonClass()}
              aria-label={`Hand the spotlight to ${pc.name}`}
              onClick={() => moves.handTo({ characterId: pc.characterId, name: pc.name })}
            >
              {pc.name}
            </button>
          ))}
        </div>
      ) : party === undefined ? (
        <p role="status" className="hud-spot-line">
          Loading the party…
        </p>
      ) : null}
      {moves.error ? (
        <p role="alert" className="hud-spot-err">
          {moves.error}
        </p>
      ) : null}
    </div>
  );
}

/** The players' GM's-turn card (board Main 'GM's turn' `.gms`) and the reactions note (`.gmh`). */
export function GmTurnNotice({ state }: { state: SpotlightState }): ReactNode {
  if (!state.reactionsOnly) return null;
  const reason = spotlightReasonLine(state);
  return (
    <>
      <div className="hud-spot-card" role="status" data-testid="hud-gm-turn">
        <span className="hud-spot-card-i">
          <SpotlightIcon />
        </span>
        <div>
          <b>The GM has the spotlight</b>
          {reason ? <span>{reason}</span> : null}
        </div>
      </div>
      <p className="hud-spot-note">Reactions only until the spotlight comes back to you</p>
    </>
  );
}

/** Who holds the spotlight: the banner tag, the Fear banner's SPOTLIGHT, "The GM has the spotlight" and the GM's hand-back (answer 1c). */
export const HudSpotlight: (props: HudPartProps) => ReactNode = ({ state }) => <SpotlightPart campaignId={state.campaignId} mapId={state.map?._id} />;

function SpotlightPart({ campaignId, mapId }: { campaignId: Id<"campaigns">; mapId?: Id<"combatMaps"> }) {
  const state = useSpotlight(campaignId);
  if (state === undefined) {
    return (
      <p role="status" className="sr-only">
        Loading the spotlight…
      </p>
    );
  }
  if (state.canMove) {
    return (
      <section className="hud-spot-gm" aria-label="Spotlight">
        <h2 className="hud-spot-h">Spotlight</h2>
        <SpotlightMenu campaignId={campaignId} mapId={mapId} />
      </section>
    );
  }
  return <GmTurnNotice state={state} />;
}
