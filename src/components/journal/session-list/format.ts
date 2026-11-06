import type { OptimisticLocalStore } from "convex/browser";

import { shortSessionDate, startTime } from "@/lib/dates";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";

/**
 * Display helpers of the Journal's session list and heading. The fixed day-month dates and 24-hour times live in
 * `src/lib/dates.ts` (shared with the phone) and are re-exported here.
 */
export { dayMonth, fullSessionDate, shortSessionDate, startTime } from "@/lib/dates";

/** 'Session 6 · Sun 2 Nov · 19:10' (the time only when the caller can see when it started). */
export function headingLine(session: Pick<SessionListItem, "n" | "date" | "startedAt">): string {
  const time = startTime(session.startedAt);
  return [`Session ${session.n}`, shortSessionDate(session.date), ...(time ? [time] : [])].join(" · ");
}

/** The number '+ Plan session N' names: the highest session number + 1 (B1: numbers are never reused). */
export function nextSessionNumber(sessions: readonly Pick<SessionListItem, "n">[]): number {
  return sessions.reduce((max, s) => Math.max(max, s.n), 0) + 1;
}

/** Hours at the table as the panel shows them: whole hours, rounded. */
export function wholeHours(hours: number): number {
  return Math.max(0, Math.round(hours));
}

/** Patches one session of the cached `sessionRecords.list` (the heading's optimistic updates). */
export function patchListed(
  store: OptimisticLocalStore,
  campaignId: Id<"campaigns">,
  sessionId: string,
  patch: Partial<SessionListItem>,
) {
  const current = store.getQuery(api.sessionRecords.list, { campaignId });
  if (current === undefined) return;
  store.setQuery(
    api.sessionRecords.list,
    { campaignId },
    current.map((s) => (s._id === sessionId ? { ...s, ...patch } : s)),
  );
}
