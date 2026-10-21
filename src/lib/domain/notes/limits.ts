// Caps and timings of the Notes journal (Q10, Q11, D7). Pure module.
//
// Q10: "MAX_PAGES 200 per journal (bin included), MAX_PAGE_ENTRIES 300, MAX_JOURNAL_ENTRIES 5000, TITLE_MAX 80,
// TEXT_MAX 500 characters." D7: "at most 10 [mentions] per entry". Q11: "a 10-second Undo and moves it to a bin for 30
// days".

export const NOTE_LIMITS = {
  /** Pages per journal, binned pages included. */
  MAX_PAGES: 200,
  /** Entries per page. */
  MAX_PAGE_ENTRIES: 300,
  /** Entries per journal. */
  MAX_JOURNAL_ENTRIES: 5000,
  /** Page title length (characters, after trimming). */
  TITLE_MAX: 80,
  /** Entry text length (characters, mention tokens included). */
  TEXT_MAX: 500,
  /** Mention tokens per entry. */
  MAX_MENTIONS: 10,
} as const;

/** Days a torn-out page stays in the bin before the purge cron deletes it. */
export const BIN_DAYS = 30;
/** How long the 'Page torn out · Undo' toast stays (milliseconds). */
export const UNDO_MS = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The purge cut-off: a page binned before this instant has been in the bin longer than BIN_DAYS. */
export function binCutoff(now: number): number {
  return now - BIN_DAYS * DAY_MS;
}

/** Whole days until a page binned at `binnedAt` is purged, rounded up, never below 0. */
export function binDaysLeft(binnedAt: number, now: number): number {
  return Math.max(0, Math.ceil((binnedAt + BIN_DAYS * DAY_MS - now) / DAY_MS));
}

/** The bin list's 'N days left' ('1 day left'). */
export function daysLeftLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

/** A page title as stored: trimmed. */
export function normalizeTitle(title: string): string {
  return title.trim();
}

/** True for a title of 1-TITLE_MAX characters after trimming. */
export function isValidTitle(title: string): boolean {
  const t = normalizeTitle(title);
  return t.length >= 1 && t.length <= NOTE_LIMITS.TITLE_MAX;
}

/** True for entry text of 1-TEXT_MAX characters after trimming (mention tokens count as written). */
export function isValidEntryText(text: string): boolean {
  const t = text.trim();
  return t.length >= 1 && t.length <= NOTE_LIMITS.TEXT_MAX;
}

/** Cuts a generated title to TITLE_MAX characters, keeping `suffix` whole (e.g. ' (cont.)'). */
export function clampTitle(base: string, suffix = ""): string {
  const room = NOTE_LIMITS.TITLE_MAX - suffix.length;
  const head = base.length > room ? base.slice(0, room).trimEnd() : base;
  return head + suffix;
}
