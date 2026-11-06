import {
  JOURNAL_TABS,
  parseSessionView,
  parseTab,
  SESSION_VIEWS,
  type JournalTab,
  type SessionView,
} from "../../../../../src/components/journal/slots";

/**
 * The Journal's URL state, as on the website (src/components/journal/slots.ts, imported: it is type-only apart from
 * these pure helpers): `?tab=sessions|notes` (Sessions by default), `&s=<session id>`, `&sv=plan|log` (the GM's
 * default is Plan, players always get Log & recap), plus the Notes params `view` and `page`. The old /sessions and
 * /notes routes (and their detail routes) redirect here.
 *
 * Phone layout: no `s` shows the session list (the website's left column); a session opens as its own stacked screen.
 */
export { JOURNAL_TABS, parseSessionView, SESSION_VIEWS, type JournalTab, type SessionView };

export const JOURNAL_TAB_LABEL: Record<JournalTab, string> = { sessions: "Sessions", notes: "Notes" };

export function parseJournalTab(value: string | null | undefined): JournalTab {
  return parseTab(value);
}

/** The params a Journal link may carry besides the tab. */
export type JournalParams = { s?: string; sv?: SessionView; view?: string; page?: string };

/** `/campaign/<id>/journal?tab=…` plus any of `s`, `sv`, `view`, `page`. */
export function journalHref(campaignId: string, tab: JournalTab, params: JournalParams = {}): string {
  // React Native's URLSearchParams leaves `set` unimplemented, so the query is joined by hand.
  const parts = [`tab=${tab}`];
  for (const [name, value] of Object.entries(params)) if (value !== undefined) parts.push(`${name}=${encodeURIComponent(value)}`);
  return `/campaign/${campaignId}/journal?${parts.join("&")}`;
}
