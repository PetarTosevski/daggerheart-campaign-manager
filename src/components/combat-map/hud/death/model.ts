import type { DeathMove } from "@/lib/domain/death/index";

/**
 * Pure helpers of the HUD's death move (plan combat-hud H4.3; Main 'Last Hit Point'). The moves, the request and the
 * result line are the party sheet's (`@/components/party/death/waiting`, HD4); this file only decides which HUD view
 * shows and finds the GM's outcome in the feed for the player. Unit tests: tests/unit/hud/death-feed.test.tsx.
 */

/** The three moves in the book's order (CB p.106). */
export const DEATH_MOVES = ["blazeOfGlory", "avoidDeath", "riskItAll"] as const satisfies readonly DeathMove[];

/**
 * Each move's line in the modal, in the core rulebook's words (CB p.106, "DEATH MOVE"), shortened only where the book
 * explains itself twice. The board's sample copy ("until … the scene ends") gives way to the book's ("… or the party
 * finishes a long rest"), as HANDOFF asks ("the death-move wording, which follows the core rules").
 */
export const DEATH_MOVE_RULES: Record<DeathMove, string> = {
  blazeOfGlory: "Take one action (at the GM’s discretion), which critically succeeds, then cross through the veil of death.",
  avoidDeath:
    "Drop unconscious: you can’t move or act, and you can’t be targeted by an attack, until an ally clears a Hit Point or the party finishes a long rest. Then roll your Hope Die: equal to or under your level, gain a scar.",
  riskItAll:
    "Roll your Duality Dice. Hope Die higher: stay on your feet and clear Hit Points or Stress equal to it. Fear Die higher: cross through the veil of death. A critical success: stay up and clear all Hit Points and Stress.",
};

/** What `deathMoves.state` says (the fields the HUD reads). */
export type DeathStateView = {
  awaitingMove: boolean;
  pending: { move: DeathMove } | null;
  request: { move: DeathMove; entryId: string } | null;
};

/**
 * Which HUD view the viewer's own character needs:
 * - `choose`: the last Hit Point is marked and no move waits ('Choose a death move');
 * - `wait`: the player's move waits for the GM ('Waiting for the GM to confirm', Take it back);
 * - `finish`: a confirmed Blaze of Glory, or Risk It All won with Hope, has its second step (the sheet's own modal);
 * - `none`: nothing to show.
 */
export type DeathPhase = "choose" | "wait" | "finish" | "none";

export function deathPhase(state: DeathStateView): DeathPhase {
  if (state.request !== null) return "wait";
  if (state.pending !== null) return "finish";
  if (state.awaitingMove) return "choose";
  return "none";
}

/** A feed row as `feed.list` gives it (the fields read here). */
export type FeedRowView = { _id: string; kind: string; summary: string; characterId?: string; undone: boolean };

/**
 * What became of a request the player watched, read from the feed (`feed.list`, newest first):
 * - `outcome`: the GM confirmed it: the newest live death row of the character above the request row (the move's own
 *   line, e.g. "… avoids death and drops unconscious. Hope Die 3 against level 1: no scar.");
 * - `back`: the request row is undone and nothing live came of it (the GM sent it back, or undid the confirmed move);
 * - `none`: still waiting, or the request row has left the page.
 */
export type RequestFate = { kind: "outcome"; text: string } | { kind: "back" } | { kind: "none" };

export function requestFate(rows: readonly FeedRowView[], requestEntryId: string, characterId: string): RequestFate {
  const at = rows.findIndex((r) => r._id === requestEntryId);
  if (at < 0) return { kind: "none" };
  const outcome = rows.slice(0, at).find((r) => r.kind === "death" && r.characterId === characterId && !r.undone);
  if (outcome) return { kind: "outcome", text: outcome.summary };
  return rows[at]!.undone ? { kind: "back" } : { kind: "none" };
}
