import type { AtLimitMode } from "@/lib/admin/config";
import { adminMessages } from "@/lib/errors/admin";
import { lorekeeperMessages } from "@/lib/errors/lorekeeper";

/**
 * App admin, Lorekeeper tab (config AU3): the board's words (reference/designs/config/Admin.dc.html, `.s-lore`), the
 * N10 re-label of the GM switch, and the small pure helpers the tab and its tests share.
 */

export const BUDGET = {
  title: "Budget",
  spend: "Spend this month",
  questions: "Questions this month",
  limit: "Monthly spend limit",
  limitHint: "Resets on the 1st.",
  atLimit: "When the limit is reached",
  email: "Email me at 80%",
} as const;

/** The segmented choice, in the board's order (Q20 a). */
export const AT_LIMIT_OPTIONS: readonly { mode: AtLimitMode; label: string }[] = [
  { mode: "pause", label: "Pause the Lorekeeper" },
  { mode: "gmOnly", label: "GMs only" },
  { mode: "short", label: "Shorter answers" },
];

export const PER_PERSON = {
  title: "Limits per person",
  questions: "Questions per day",
  questionsHint: "For each player and GM. You have no limit.",
  searches: "Internet searches per day",
  searchesHint: "Only campaigns that allow internet search use these.",
  // N10: the board's "Let GMs raise limits for their own table · Up to the app limits above." re-labelled.
  requests: "Let GMs ask for higher limits",
  requestsHint: "You approve each request.",
} as const;

export const REQUESTS = {
  title: "Requests",
  hint: "GMs asking for higher limits for their campaign.",
  none: "No requests waiting.",
  approve: "Approve",
  decline: "Decline",
  more: "Show more",
  deletedCampaign: "A deleted campaign",
  someGm: "A GM",
} as const;

export const USE = {
  title: "Use by campaign",
  hint: "Questions this month.",
  none: "No questions yet this month.",
  truncated: "Only the campaigns that spent the most are shown.",
  deleted: "Deleted",
  limits: "Limits",
  limitsHint: "This campaign’s own numbers. Empty means the app’s number.",
  booksHint: "Empty means no limit.",
  save: "Save",
} as const;

export const LIBRARY = {
  title: "Book library",
  hint: "Shared by every campaign. GMs choose which ones their Lorekeeper searches.",
  replace: "Replace",
  upload: "Upload a book",
  uploadHint: "PDF · Up to 20 MB and 300 pages",
  allUploaded: "Every book has a file. Use Replace to change one.",
  book: "Book",
  bookTitle: "Title",
  bookTitleHint: "Empty keeps the current title.",
  firstPage: "Printed page number of the PDF’s first page",
  file: "PDF file",
  send: "Upload",
  cancel: "Cancel",
  uploading: "Uploading",
  starting: "Starting to read the PDF…",
  reading: "Reading the PDF…",
  notRead: "No text yet",
} as const;

/** The four numbers a campaign can carry (AD12), with their labels. */
export const LIMIT_FIELDS = ["dailyQuestions", "dailyWebSearches", "bookCount", "bookPages"] as const;
export type LimitField = (typeof LIMIT_FIELDS)[number];
export const LIMIT_LABEL: Record<LimitField, string> = {
  dailyQuestions: "Questions per day",
  dailyWebSearches: "Internet searches per day",
  bookCount: "Books",
  bookPages: "Book pages",
};

/** convex/adminLorekeeper.ts MAX_MONTHLY_USD / MAX_DAILY_COUNT and lorekeeperLimitRequests.MAX_SET (INVALID past these). */
export const MAX_USD = 100_000;
export const MAX_COUNT = 10_000;
/** A click on the monthly limit's stepper moves it this many dollars. */
export const USD_STEP = 5;

/** "$8.40". */
export function usd(micros: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(micros / 1_000_000);
}

/** "$150" or "$12.50" (a limit in dollars). */
export function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** The current UTC month, "YYYY-MM" (the Lorekeeper's counters use UTC months). */
export function utcMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** The share of the meter, 0..100. */
export function meterPercent(value: number, max: number): number {
  if (max <= 0) return value > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/** A stepper's next value, kept inside 0..max. */
export function stepped(value: number, delta: number, max: number): number {
  return Math.min(max, Math.max(0, value + delta));
}

/** A typed whole number in 0..max, or null when the text isn't one. */
export function wholeNumber(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= max ? value : null;
}

/** "29 Oct". */
export function shortDate(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The text for a result code an upload or ingest returned. */
export function codeText(code: string): string {
  const messages: Record<string, string> = { ...adminMessages, ...lorekeeperMessages };
  return messages[code] ?? "Something went wrong.";
}

/** A book row's hint: "412 pages · indexed", or "No text yet" before its first read. */
export function bookHint(book: { pages: number; chunkCount: number }): string {
  if (book.chunkCount === 0) return LIBRARY.notRead;
  return `${book.pages} ${book.pages === 1 ? "page" : "pages"} · indexed`;
}
