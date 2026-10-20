// Header line, next and last session, dashboard texts (D10 S1, board rules B1 and B9). Pure module.
//
// B1: "Header line: 'N sessions · M played · Next: <date of the first planned session that has one>'."
// B9: "Dashboard: hero line 'Session N' (the live one, else the last played, else 'No sessions yet') and 'Next session
// <date>' / 'Next session not scheduled'; the 'Last Session' card shows the last played session's recap, else 'Session N
// was played, but no recap was written. Add one in the session's Wrap-up.', else 'No sessions played yet. Write a recap
// in a session's Wrap-up stage and it will appear here.'"
//
// "First planned" and "last played" follow the board's array order, which is creation order = session number:
// the planned session with a date and the LOWEST number, the played session with the HIGHEST number.
//
// ```ts
// const s = [{ n: 1, status: "played", recap: "We won." }, { n: 2, status: "planned", date: "2026-10-24" }];
// headerLine(s, { locale: "en-GB" });     // "2 sessions · 1 played · Next: Sat, 24 Oct 2026"
// dashboardNumber(s);                     // "Session 1"
// nextSessionLine(s, { locale: "en-GB" }); // "Next session 24 Oct 2026"
// lastSessionText(s);                     // "We won."
// ```

import { formatSessionDate, type SessionStatus } from "./status";

/** The fields of a session row (S0's `sessions` document) these functions read. */
export type SessionSummaryInput = {
  n: number;
  status: SessionStatus;
  /** 'YYYY-MM-DD'. */
  date?: string | null;
  recap?: string | null;
};

type DateOptions = { locale?: string };

/** The live session (at most one per campaign, B6); the highest number if the data ever holds two. */
export function liveSession<T extends SessionSummaryInput>(sessions: readonly T[]): T | null {
  return pick(sessions, (s) => s.status === "live", "highest");
}

/** The played session with the highest number. */
export function lastPlayedSession<T extends SessionSummaryInput>(sessions: readonly T[]): T | null {
  return pick(sessions, (s) => s.status === "played", "highest");
}

/** The planned session with a date and the lowest number (the board's `find` over creation order). */
export function nextPlannedSession<T extends SessionSummaryInput>(sessions: readonly T[]): T | null {
  return pick(sessions, (s) => s.status === "planned" && !!s.date, "lowest");
}

/** 'N sessions · M played' plus ' · Next: <date>' when a planned session has a date (B1). */
export function headerLine(sessions: readonly SessionSummaryInput[], options: DateOptions = {}): string {
  const played = sessions.filter((s) => s.status === "played").length;
  const next = nextPlannedSession(sessions);
  return (
    `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} · ${played} played` +
    (next ? ` · Next: ${formatSessionDate(next.date, { locale: options.locale })}` : "")
  );
}

/** The hero line's 'Session N': the live session, else the last played one, else 'No sessions yet' (B9). */
export function dashboardNumber(sessions: readonly SessionSummaryInput[]): string {
  const s = liveSession(sessions) ?? lastPlayedSession(sessions);
  return s ? `Session ${s.n}` : "No sessions yet";
}

/** 'Next session <date>' (day, month, year; no weekday, as on the dashboard board) or 'Next session not scheduled'. */
export function nextSessionLine(sessions: readonly SessionSummaryInput[], options: DateOptions = {}): string {
  const next = nextPlannedSession(sessions);
  return next
    ? `Next session ${formatSessionDate(next.date, { locale: options.locale, weekday: false })}`
    : "Next session not scheduled";
}

/** The 'Last Session' card's text: the last played session's recap, else the board's two fallbacks (B9). */
export function lastSessionText(sessions: readonly SessionSummaryInput[]): string {
  const last = lastPlayedSession(sessions);
  if (!last) return "No sessions played yet. Write a recap in a session's Wrap-up stage and it will appear here.";
  if (last.recap && last.recap.trim()) return last.recap;
  return `Session ${last.n} was played, but no recap was written. Add one in the session's Wrap-up.`;
}

function pick<T extends SessionSummaryInput>(
  sessions: readonly T[],
  test: (s: T) => boolean,
  which: "highest" | "lowest",
): T | null {
  let best: T | null = null;
  for (const s of sessions) {
    if (!test(s)) continue;
    if (best === null || (which === "highest" ? s.n > best.n : s.n < best.n)) best = s;
  }
  return best;
}
