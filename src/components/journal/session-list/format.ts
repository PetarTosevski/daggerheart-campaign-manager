import type { OptimisticLocalStore } from "convex/browser";

import { isSessionDate, NO_DATE } from "@/lib/domain/sessions";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";

/**
 * Display helpers of the Journal's session list and heading (JS; design reference/designs/journal/journal_views.jpg:
 * 'Sun 2 Nov', 'Session 6 · Sun 2 Nov · 19:10'). Dates read day then month for everyone, never the browser's locale
 * (dcm-z9rz.31, user 2026-11-05: "always '2 Nov'"); times are 24-hour 'HH:MM'.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The parts of a 'YYYY-MM-DD' session date as a UTC noon (so it never shifts by a day), or null when unparsable. */
function sessionDay(date: string): Date | null {
  if (!isSessionDate(date)) return null;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, 12));
}

/**
 * A session date as the Journal shows it: weekday, day and month, no year ('Sun 2 Nov'). Missing: 'No date set';
 * unparsable: as written.
 */
export function shortSessionDate(date: string | null | undefined): string {
  if (!date) return NO_DATE;
  const day = sessionDay(date);
  if (day === null) return date;
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

/** The full session date of a tooltip: 'Sun 2 Nov 2025'. Missing: 'No date set'; unparsable: as written. */
export function fullSessionDate(date: string | null | undefined): string {
  if (!date) return NO_DATE;
  const day = sessionDay(date);
  if (day === null) return date;
  return `${shortSessionDate(date)} ${day.getUTCFullYear()}`;
}

/** A moment's day and month in the viewer's time zone ('2 Nov'). */
export function dayMonth(at: number): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** The clock time a session started ('19:10', 24-hour), in the viewer's time zone; null when it never started. */
export function startTime(startedAt: number | null | undefined): string | null {
  if (startedAt === undefined || startedAt === null) return null;
  const d = new Date(startedAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

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
