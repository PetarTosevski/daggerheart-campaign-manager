import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { JournalTally } from "../../../convex/journalTally";
import { spotlight as spotlightEntries } from "../domain/sessions";

/**
 * The session tally and the spotlight bars, shared by the website and the phone (dcm-gdzi.46). The website pairs each
 * tile with an icon (src/components/journal/tally/model.ts).
 */

/** The six tiles in the design's order (two rows of three), each a `journalTally.tally` count. */
export type TallyKey = keyof Omit<JournalTally, "live" | "truncated" | "fearHidden">;

export const TALLY_TILES: readonly { key: TallyKey; label: string }[] = [
  { key: "fearGained", label: "Fear gained" },
  { key: "fearSpent", label: "Fear spent" },
  { key: "hopeSpent", label: "Hope spent" },
  { key: "hpMarked", label: "HP marked" },
  { key: "adversariesDefeated", label: "Adversaries defeated" },
  { key: "criticals", label: "Critical successes" },
];

/** The tiles a reader gets: all six, or without the two Fear tiles while the tally's `fearHidden` (a player, config R1). */
export function tallyTiles(fearHidden: boolean): typeof TALLY_TILES {
  return fearHidden ? TALLY_TILES.filter((t) => t.key !== "fearGained" && t.key !== "fearSpent") : TALLY_TILES;
}

/** A bar's width in percent, scaled to the highest count (the highest fills the track; all zero: empty bars). */
export function barPercent(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((Math.max(0, count) / max) * 100);
}

/**
 * Reset (`sessionPlay.resetSpotlight`), optimistic: every count of that session's cached Journal spotlight
 * (`journalTally.spotlight`) to 0, all due.
 */
export function resetPending(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; sessionId: string }) {
  const query = { campaignId: args.campaignId, sessionId: args.sessionId };
  const current = store.getQuery(api.journalTally.spotlight, query);
  if (current === undefined || current === null) return;
  const names = new Map(current.map((e) => [e.characterId, e.name]));
  const zeroed = spotlightEntries(
    current.map((e) => e.characterId),
    [],
  ).map((e) => ({ ...e, name: names.get(e.characterId) ?? "Unnamed character" }));
  store.setQuery(api.journalTally.spotlight, query, zeroed);
}
