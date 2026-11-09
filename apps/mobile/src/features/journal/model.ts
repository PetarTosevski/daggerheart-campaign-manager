import { shortSessionDate } from "../../../../../src/lib/dates";
import type { SessionListItem } from "../../../../../convex/sessionRecords";

/**
 * The phone Journal's own words. Everything else comes from the website's framework-free Journal helpers in
 * src/lib/journal (sessions, log, tally, plan, recap; dcm-gdzi.46) and src/lib/dates.ts.
 */

/** The spoken name of a list row: 'Session 7: The chapel, Sun 9 Nov, Planned'. */
export function rowLabel(session: SessionListItem, title: string): string {
  const status = session.status === "live" ? ", Live" : session.status === "planned" ? ", Planned" : "";
  return `Session ${session.n}: ${title}, ${shortSessionDate(session.date)}${status}`;
}
