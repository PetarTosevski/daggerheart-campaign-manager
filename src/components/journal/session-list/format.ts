import type { OptimisticLocalStore } from "convex/browser";

import { isSessionDate, NO_DATE } from "@/lib/domain/sessions";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";

/**
 * Display helpers of the Journal's session list and heading (JS; design reference/designs/journal/journal_views.jpg:
 * 'Sun 2 Nov', 'Session 6 · Sun 2 Nov · 19:10'). Dates use the runtime's locale, as everywhere else in the app.
 */

/**
 * A session date as the Journal shows it: weekday, day and month, no year ('Sun 2 Nov' in en-GB). Formatted in UTC
 * so it never shifts by a day with the viewer's time zone. Missing: 'No date set'; unparsable: as written.
 */
export function shortSessionDate(date: string | null | undefined, locale?: string): string {
  if (!date) return NO_DATE;
  if (!isSessionDate(date)) return date;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The clock time a session started ('19:10'), in the viewer's time zone; null when it never started. */
export function startTime(startedAt: number | null | undefined, locale?: string): string | null {
  if (startedAt === undefined || startedAt === null) return null;
  return new Date(startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** 'Session 6 · Sun 2 Nov · 19:10' (the time only when the caller can see when it started). */
export function headingLine(session: Pick<SessionListItem, "n" | "date" | "startedAt">, locale?: string): string {
  const time = startTime(session.startedAt, locale);
  return [`Session ${session.n}`, shortSessionDate(session.date, locale), ...(time ? [time] : [])].join(" · ");
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
