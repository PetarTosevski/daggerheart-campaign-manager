// Fixed day-month dates and 24-hour times, the same on the website and the phone (framework-free: no React, no `@/`
// paths, so apps/mobile imports it too).
//
// Dates read day then month for everyone, never the runtime's locale (dcm-z9rz.31, user 2026-11-05: "always '2 Nov'");
// times are 24-hour 'HH:MM'. Design reference: designs/journal/journal_views.jpg ('Sun 2 Nov', 'Session 6 · Sun 2 Nov
// · 19:10').
//
// ```ts
// shortSessionDate("2025-11-02"); // "Sun 2 Nov"
// fullSessionDate("2025-11-02");  // "Sun 2 Nov 2025"
// dayMonth(Date.now());           // "6 Nov" (viewer's time zone)
// startTime(at);                  // "19:10" (viewer's time zone), null when never started
// ```

import { isSessionDate, NO_DATE } from "./domain/sessions/status";

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

/** A moment's clock time in the viewer's time zone ('19:10', 24-hour). */
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The clock time a session started ('19:10', 24-hour), in the viewer's time zone; null when it never started. */
export function startTime(startedAt: number | null | undefined): string | null {
  if (startedAt === undefined || startedAt === null) return null;
  return clockTime(startedAt);
}
