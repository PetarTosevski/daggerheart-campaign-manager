import type { OptimisticLocalStore } from "convex/browser";
import { Droplet, DropletOff, Heart, Skull, Sparkles, Star, type LucideIcon } from "lucide-react";

import { spotlight as spotlightEntries } from "@/lib/domain/sessions";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { JournalTally } from "../../../../convex/journalTally";

/** The six tiles in the design's order (two rows of three), each a `journalTally.tally` count. */
export type TallyKey = keyof Omit<JournalTally, "live" | "truncated">;

export const TALLY_TILES: readonly { key: TallyKey; label: string; Icon: LucideIcon }[] = [
  { key: "fearGained", label: "Fear gained", Icon: Droplet },
  { key: "fearSpent", label: "Fear spent", Icon: DropletOff },
  { key: "hopeSpent", label: "Hope spent", Icon: Star },
  { key: "hpMarked", label: "HP marked", Icon: Heart },
  { key: "adversariesDefeated", label: "Adversaries defeated", Icon: Skull },
  { key: "criticals", label: "Critical successes", Icon: Sparkles },
];

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
