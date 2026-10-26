// Header line, index counts, page meta, empty lines, search matching and fixed copy (D11 N1; board rules B1, B2, B3,
// B5, B9; D6). Pure module.
//
// B1: "'<whoName>’s Journal', sub '<whoSub> · <N> pages · <M> entries', '🧵 Open threads · N'".
// B2: "page button = tape tab, title, count ('N open' / entry count / nothing); 'Nothing here yet.' / 'No matches.'".
// B3: "meta '<session log | collection | future log> · <date>'; ... 'Tear out page' -> 'Click again to tear out'; empty
// lines per kind".
// B5: "tape 'Open threads', 'Every unfinished task and every looming Fear, from all pages.', '<page title> →', 'Nothing
// dangling. Suspicious…'".
// B9: "case-insensitive substring over titles and entry text; matching rows highlighted."
// D6: "the meta shows the linked session's date live ('No date set')".
//
// ```ts
// headerLine({ pageCount: 4, entryCount: 12 });                       // "4 pages · 12 entries"
// pageCountLabel({ openCount: 2, entryCount: 5 });                   // "2 open"
// pageMeta({ kind: "log", createdAt }, { date: "2026-10-24" }, { locale: "en-GB" });   // "session log · 24 Oct 2026"
// matches("Met the Baron", "baron");                                  // true
// ```

import { formatSessionDate, NO_DATE } from "../sessions/status";
import { PAGE_KIND_LABEL } from "./defaults";
import { toPlainText } from "./mentions";
import type { PageKind } from "./types";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** '<N> pages · <M> entries' (singular for 1). Counts exclude binned pages (the journal counters). */
export function headerLine(counts: { pageCount: number; entryCount: number }): string {
  return `${plural(counts.pageCount, "page", "pages")} · ${plural(counts.entryCount, "entry", "entries")}`;
}

/** The hero sub line: '<whoSub> · <N> pages · <M> entries' (B1). */
export function subLine(whoSub: string, counts: { pageCount: number; entryCount: number }): string {
  return `${whoSub} · ${headerLine(counts)}`;
}

/** The hero button: '🧵 Open threads · N' (B1). */
export function threadsButtonLabel(openCount: number): string {
  return `🧵 Open threads · ${openCount}`;
}

/** The index button's count: 'N open' when the page has open threads, else its entry count, else '' (B2). */
export function pageCountLabel(page: { openCount: number; entryCount: number }): string {
  if (page.openCount > 0) return `${page.openCount} open`;
  return page.entryCount > 0 ? String(page.entryCount) : "";
}

export type DateOptions = { locale?: string; timeZone?: string };

/** A creation instant as the board's meta shows it: day, short month, year (board l.317). */
export function formatPageDate(at: number, options: DateOptions = {}): string {
  return new Date(at).toLocaleDateString(options.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
}

/**
 * The page meta: '<kind word> · <date>'. A log page linked to a session shows the session's date ('No date set' when it
 * has none, D6); `session` is null / undefined for an unlinked page (or a session the viewer cannot see), which shows the
 * page's creation date.
 */
export function pageMeta(
  page: { kind: PageKind; createdAt: number },
  session?: { date?: string | null } | null,
  options: DateOptions = {},
): string {
  const date = session
    ? session.date
      ? formatSessionDate(session.date, { locale: options.locale, weekday: false })
      : NO_DATE
    : formatPageDate(page.createdAt, options);
  return `${PAGE_KIND_LABEL[page.kind]} · ${date}`;
}

const EMPTY_LINE: Record<PageKind, string> = {
  log: "A fresh page. What happened at the table?",
  future: "Plans, festivals, deadlines, things coming due…",
  collection: "Start the collection…",
};

/** The line an empty page shows, by kind (board l.333). */
export function emptyLine(kind: PageKind): string {
  return EMPTY_LINE[kind];
}

/** An index group's empty text: 'No matches.' while searching, else 'Nothing here yet.' (B2). */
export function groupEmptyText(searching: boolean): string {
  return searching ? "No matches." : "Nothing here yet.";
}

/** The search query as matched: trimmed, lower case. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Case-insensitive substring match of `query` in `text`, mentions read as their names (B9). A blank query matches
 * nothing (no highlight).
 */
export function matches(text: string, query: string): boolean {
  const q = normalizeQuery(query);
  return q.length > 0 && toPlainText(text).toLowerCase().includes(q);
}

/** A page stays in the index: a blank query keeps every page, else its title or one of its entries matches (B9). */
export function pageMatches(page: { title: string }, entries: readonly { text: string }[], query: string): boolean {
  if (!normalizeQuery(query)) return true;
  return matches(page.title, query) || entries.some((e) => matches(e.text, query));
}

/** The tear-out button: 'Tear out page', then 'Click again to tear out' (B3). */
export function tearLabel(pending: boolean): string {
  return pending ? "Click again to tear out" : "Tear out page";
}

/** The Open threads view's copy (B5). */
export const THREADS_COPY = {
  title: "Open threads",
  intro: "Every unfinished task and every looming Fear, from all pages.",
  empty: "Nothing dangling. Suspicious…",
} as const;

/** A thread row's link to its page: '<page title> →' (B5). */
export function threadPageLink(title: string): string {
  return `${title} →`;
}
