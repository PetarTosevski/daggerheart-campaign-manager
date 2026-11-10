import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The optimistic updates of the Recap and After the session (JR), shared by the website and the phone
 * (dcm-gdzi.46). The words of After the session (`levelUpLine`, `milestoneLine`) are in ./sessions.ts.
 */

/** The text the server stores for a write: trimmed, empty clears it (as `cleanText`). */
export const storedText = (text: string) => text.trim() || undefined;

/** Patches the cached recap: the GM's `sessionWrap.get` and a player's `sessionRecords.list` row. */
export function patchRecap(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string, recap: string | undefined) {
  const wrap = store.getQuery(api.sessionWrap.get, { campaignId, sessionId });
  if (wrap) store.setQuery(api.sessionWrap.get, { campaignId, sessionId }, { ...wrap, recap });
  const list = store.getQuery(api.sessionRecords.list, { campaignId });
  if (list) store.setQuery(api.sessionRecords.list, { campaignId }, list.map((s) => (s._id === sessionId ? { ...s, recap } : s)));
}

/** Loot on the cached `sessionWrap.after`. */
export function patchLoot(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string, loot: string | null) {
  const after = store.getQuery(api.sessionWrap.after, { campaignId, sessionId });
  if (after) store.setQuery(api.sessionWrap.after, { campaignId, sessionId }, { ...after, loot });
}

/** Optimistic: the milestone shows as reached at once (the server's stamp replaces the time). */
export function stampMilestone(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string) {
  const after = store.getQuery(api.sessionWrap.after, { campaignId, sessionId });
  if (after && after.milestoneAt === null) store.setQuery(api.sessionWrap.after, { campaignId, sessionId }, { ...after, milestoneAt: Date.now() });
}
