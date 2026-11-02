import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The spotlight's display copy and optimistic updates (plan combat-hud H1.S; boards Main 'GM's turn', CmpTokens,
 * GMDesktop). Pure: the parts in `index.tsx` render what these return.
 */

export type SpotlightState = FunctionReturnType<typeof api.combatSpotlight.state>;

/** The card's line under "The GM has the spotlight": why it moved (CB p.100, p.149). */
export function spotlightReasonLine(state: Pick<SpotlightState, "reason" | "rollBy">): string {
  const who = state.rollBy?.name;
  switch (state.reason) {
    case "rollWithFear":
      return who ? `${who} rolled with Fear.` : "A roll came up with Fear.";
    case "failedRoll":
      return who ? `${who} failed a roll.` : "A roll failed.";
    case "adversary":
      return "An adversary is acting.";
    case "gmTook":
      return "The GM is making a move.";
    default:
      return "";
  }
}

/** Who holds it, for the GM's spotlight menu and screen readers. */
export function holderLine(state: Pick<SpotlightState, "holder" | "canMove">): string {
  const { holder } = state;
  if (holder === null) return "The players have the spotlight.";
  if (holder.kind === "pc") return `${holder.name} has the spotlight.`;
  return state.canMove ? "You have the spotlight." : "The GM has the spotlight.";
}

/** Whether a PC holds it (the banner's "Spotlight" tag). */
export function pcHolds(state: SpotlightState | undefined, characterId: Id<"characters">): boolean {
  return state?.holder?.kind === "pc" && state.holder.characterId === characterId;
}

/** Whether the GM holds it (the Fear banner's SPOTLIGHT tag, the players' GM's-turn card). */
export function gmHolds(state: SpotlightState | undefined): boolean {
  return state?.holder?.kind === "gm";
}

/** The state right after `combatSpotlight.gmTake` (the GM's optimistic update; `now` from the click). */
export function afterTake(state: SpotlightState, now: number): SpotlightState {
  if (state.holder?.kind === "gm") return state;
  return { ...state, holder: { kind: "gm" }, since: now, reason: "gmTook", rollBy: null, reactionsOnly: !state.canMove };
}

/** The state right after `combatSpotlight.handTo` (the GM's optimistic update). */
export function afterHandTo(state: SpotlightState, pc: { characterId: Id<"characters">; name: string }, now: number): SpotlightState {
  if (state.holder?.kind === "pc" && state.holder.characterId === pc.characterId) return state;
  return { ...state, holder: { kind: "pc", ...pc }, since: now, reason: "handedBack", rollBy: null, reactionsOnly: false };
}
