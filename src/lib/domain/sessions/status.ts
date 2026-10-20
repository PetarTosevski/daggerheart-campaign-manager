// Session status, list order and dates (D10 S1, board rule B1). Pure module: bundled into Convex and used by the UI.
//
// B1: "A session has a number (highest + 1 on create ...), a title, a date (calendar date only, 'No date set'), and a
// status Planned / Live / Played. ... The list column shows the newest first: 'SESSION n', status chip, title or
// 'Untitled session', formatted date."
//
// ```ts
// statusLabel("live");                                   // "Live"
// newestFirst([{ n: 1 }, { n: 3 }, { n: 2 }]);           // [{ n: 3 }, { n: 2 }, { n: 1 }]
// formatSessionDate("2026-10-24", { locale: "en-GB" });  // "Sat, 24 Oct 2026"
// formatSessionDate(undefined);                          // "No date set"
// ```

/** The stored status of a session (`sessions.status`, S0). */
export type SessionStatus = "planned" | "live" | "played";

export const SESSION_STATUSES: readonly SessionStatus[] = ["planned", "live", "played"];

const STATUS_LABEL: Record<SessionStatus, string> = { planned: "Planned", live: "Live", played: "Played" };

/** The status chip's text: Planned / Live / Played. */
export function statusLabel(status: SessionStatus): string {
  return STATUS_LABEL[status];
}

/** "Untitled session" for a missing or blank title, else the title as written. */
export function sessionTitle(title: string | null | undefined): string {
  return title && title.trim() ? title : "Untitled session";
}

/** The list column's order: highest session number first. Returns a new array. */
export function newestFirst<T extends { n: number }>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => b.n - a.n);
}

/** The text a session with no date shows. */
export const NO_DATE = "No date set";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written 'YYYY-MM-DD' (the stored form of `sessions.date`). */
export function isSessionDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * A session date for display. The board's list and header use weekday, day, month and year
 * (`{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }`); the dashboard's 'Next session' line drops
 * the weekday (`weekday: false`). The date is formatted in UTC so it never shifts by a day with the viewer's time zone.
 * `locale` undefined = the runtime's locale, as on the board. An unparsable value is returned as written (the board's
 * fallback); a missing one is 'No date set'.
 */
export function formatSessionDate(
  date: string | null | undefined,
  options: { locale?: string; weekday?: boolean } = {},
): string {
  if (!date) return NO_DATE;
  if (!isSessionDate(date)) return date;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleDateString(options.locale, {
    ...(options.weekday === false ? {} : { weekday: "short" as const }),
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
