/**
 * Errors of the Notes board (D11: journals, pages, entries, sharing, the bin; plan `.omc/plans/d11-notes.yaml`).
 * Contract: see `actionLog.ts`; add this domain's codes here only. Every D11 tracer throws only these codes (plus the
 * common ones: UNAUTHENTICATED, NOT_FOUND, FORBIDDEN, INVALID); a code missing here means stop and ask the
 * orchestrator. There is no PIN, so there is no PIN code (A1).
 */
export const noteMessages = {
  /** A page the caller may not read, a deleted or torn-out one (except for its owner), or one of another campaign. */
  NOTE_PAGE_NOT_FOUND: "That page isn't there anymore.",
  /** An entry id that is not on a page the caller can read. */
  NOTE_ENTRY_NOT_FOUND: "That entry isn't there anymore.",
  /** MAX_PAGES per journal, torn-out pages included (Q10). */
  NOTE_PAGE_LIMIT: "This journal already has 200 pages (torn-out pages count too). Remove one first.",
  /** MAX_PAGE_ENTRIES per page (Q10). */
  NOTE_PAGE_FULL: "This page already has 300 entries. Start a new page.",
  /** MAX_JOURNAL_ENTRIES per journal (Q10). */
  NOTE_JOURNAL_FULL: "This journal already has 5000 entries. Remove some first.",
  /** Migrate with no open task on the page (B6). */
  NOTE_NOTHING_TO_MIGRATE: "There are no open tasks to migrate.",
  /** A visibility the owner may not set (the GM: 'gm' or 'players', Q4). */
  NOTE_VISIBILITY_INVALID: "That sharing option isn't available for this page.",
  /** A recipient who is not a member of the campaign, is the owner, or a page that is not 'chosen' (A5, Q4, D4). */
  NOTE_RECIPIENT_INVALID: "That person can't be chosen for this page.",
  /** A readable page or entry the caller may not change (the action table, analysis 3.2; Q3, D5). */
  NOTE_FORBIDDEN_ACTION: "Only the page's owner (or the entry's author) can do that.",
  /** A write on the journal of a departed character or player (D2). */
  NOTE_JOURNAL_CLOSED: "This journal is closed: its character has left the story.",
  /** A session that is not in the campaign, or a planned one linked by a player (Q5, D6). */
  NOTE_SESSION_INVALID: "That session can't be linked to this page.",
  /** More than MAX_MENTIONS tokens, or a token for a Codex entry the author cannot see (D7). */
  NOTE_MENTION_INVALID: "One of the links points to an entry you can't see.",
  /** Restoring a page that is not in the bin, or one the caller did not tear out (Q11). */
  NOTE_NOT_BINNED: "That page isn't in the bin.",
} as const satisfies Record<string, string>;
