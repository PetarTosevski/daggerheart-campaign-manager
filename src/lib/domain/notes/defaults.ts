// Default pages, new page titles and tapes, session-log titles, the index groups (D11 N1; board rule B7; Q5, D6).
// Pure module.
//
// B7: "New pages (l.285): 'New collection', 'Future log <n>', session logs per D6; tape = page count mod 6. Default pages:
// GM 'Session 1', 'Rumors & hooks', 'Loot & debts', 'Future log'; player 'Session 1', 'People we met', 'Clues & secrets',
// 'My goals' (tapes l.223-224)."
// D6: "title set at creation ('Session N', plus ': <session title>' when there is one), editable".
//
// Page counts here are over the pages the caller passes; pass the journal's non-binned pages (what the index shows).
//
// ```ts
// newPageTitle("future", pages);                           // "Future log 2" (one future page already)
// sessionLogTitle({ n: 3, title: "The Ford" });            // "Session 3: The Ford"
// newPageTape(pages);                                      // pages.length % 6
// ```

import { clampTitle } from "./limits";
import type { PageKind } from "./types";

/** The six washi tapes (CSS backgrounds, board l.211), indexed by `journalPages.tape` (0-5). */
export const TAPES: readonly string[] = [
  "repeating-linear-gradient(45deg, #e8c27a 0 10px, #dcb064 10px 20px)",
  "repeating-linear-gradient(-45deg, #9fc7a8 0 9px, #8ab995 9px 18px)",
  "repeating-linear-gradient(90deg, #e9a9a0 0 8px, #f1bdb5 8px 16px)",
  "radial-gradient(circle at 6px 6px, #fff6 2px, transparent 2.5px) 0 0 / 14px 14px, #a9c3e6",
  "repeating-linear-gradient(45deg, #c9a8ff 0 10px, #b894f0 10px 20px)",
  "repeating-linear-gradient(0deg, #f0e0a8 0 6px, #e6d290 6px 12px)",
];
export const TAPE_COUNT = TAPES.length;
/** The violet tape of the Open threads view (board l.111). */
export const THREADS_TAPE = 4;

/** The CSS background of a tape index (any integer wraps into 0-5). */
export function tapeBackground(tape: number): string {
  return TAPES[((tape % TAPE_COUNT) + TAPE_COUNT) % TAPE_COUNT]!;
}

/** '🎀 Tape': the next tape, wrapping 5 -> 0. */
export function nextTape(tape: number): number {
  return (((tape + 1) % TAPE_COUNT) + TAPE_COUNT) % TAPE_COUNT;
}

/** A new page's tape: the number of pages mod 6 (board l.285). */
export function newPageTape(pages: readonly unknown[]): number {
  return pages.length % TAPE_COUNT;
}

export type PageTemplate = { kind: PageKind; title: string; tape: number };

/** The GM journal's default pages (board l.223). */
export const GM_DEFAULT_PAGES: readonly PageTemplate[] = [
  { kind: "log", title: "Session 1", tape: 0 },
  { kind: "collection", title: "Rumors & hooks", tape: 1 },
  { kind: "collection", title: "Loot & debts", tape: 2 },
  { kind: "future", title: "Future log", tape: 3 },
];

/** A player journal's default pages (board l.224). */
export const PLAYER_DEFAULT_PAGES: readonly PageTemplate[] = [
  { kind: "log", title: "Session 1", tape: 2 },
  { kind: "collection", title: "People we met", tape: 1 },
  { kind: "collection", title: "Clues & secrets", tape: 4 },
  { kind: "collection", title: "My goals", tape: 0 },
];

/**
 * The default pages of a new journal, in order; a template ref `{ template: i }` names `defaultPages(isGm)[i]`. They
 * get the owner's default visibility (visibility.ts defaultVisibility). The 'Session 1' page's session link is the
 * server's choice (D6).
 */
export function defaultPages(isGm: boolean): readonly PageTemplate[] {
  return isGm ? GM_DEFAULT_PAGES : PLAYER_DEFAULT_PAGES;
}

/**
 * A new page's title without a session link: 'Session <log pages + 1>', 'New collection' or 'Future log <future pages +
 * 1>' (board l.285). A log page linked to a session uses sessionLogTitle instead (Q5).
 */
export function newPageTitle(kind: PageKind, pages: readonly { kind: PageKind }[]): string {
  if (kind === "collection") return "New collection";
  const n = pages.filter((p) => p.kind === kind).length + 1;
  return kind === "log" ? `Session ${n}` : `Future log ${n}`;
}

/** A session log page's title from its D10 session: 'Session N', or 'Session N: <title>' (D6), at most TITLE_MAX. */
export function sessionLogTitle(session: { n: number; title?: string | null }): string {
  const title = session.title?.trim();
  return clampTitle(title ? `Session ${session.n}: ${title}` : `Session ${session.n}`);
}

/** The meta line's kind word (board l.317). */
export const PAGE_KIND_LABEL: Record<PageKind, string> = {
  log: "session log",
  collection: "collection",
  future: "future log",
};

/** The index column's groups, with their '＋' labels (board l.282). */
export const PAGE_GROUPS: readonly { kind: PageKind; label: string; addLabel: string }[] = [
  { kind: "log", label: "Session logs", addLabel: "New session log" },
  { kind: "collection", label: "Collections", addLabel: "New collection" },
  { kind: "future", label: "Future log", addLabel: "New future page" },
];
