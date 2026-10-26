import { v, type Infer } from "convex/values";

/**
 * The Lorekeeper's caps, unions and stored shapes (D13, CD19), shared by the tables in `convex/tables/lorekeeper.ts`,
 * the D13 functions and the client (types via `Infer<>`). Framework-free: only `convex/values`.
 */

/** Hard caps. Every D13 writer enforces the ones that apply; the UI shows the same numbers. */
export const LOREKEEPER_LIMITS = {
  /** A question, in characters (QUESTION_INVALID past it). */
  question: 1000,
  /** A stored answer's prose, in characters (the stream is cut there). */
  answer: 6000,
  /** A conversation's title: its first question, cut. */
  conversationTitle: 80,
  rulingTitle: 80,
  rulingText: 600,
  /** One quote's cited text, cut (analysis 5.2). */
  quote: 300,
  /** A section path such as "Core Mechanics → Duality Dice". */
  section: 200,
  /** A web result's snippet. */
  snippet: 300,
  /** A web result's title. */
  webTitle: 200,
  /** One chunk of book text (L1's chunker). */
  chunk: 4000,
  /** Quotes shown per answer, as on the board. */
  quotes: 3,
  /** Web results per answer. */
  webResults: 3,
  /** Messages per conversation; past it the oldest question/answer pair goes (analysis 2). */
  messagesPerConversation: 200,
  /** Pinned rulings per campaign (LOREKEEPER_RULING_LIMIT). */
  rulingsPerCampaign: 50,
} as const;

/** A book's key: "core", "hopeFear", "frame:<frameId>" or "houseRules" (the Notes pseudo-book, Q7). */
export const BOOK_KEY_CORE = "core";
export const BOOK_KEY_HOPE_FEAR = "hopeFear";
export const BOOK_KEY_HOUSE_RULES = "houseRules";
export function frameBookKey(frameId: string): string {
  return `frame:${frameId}`;
}

/** The chunking format `lorekeeperBooks.schemaVersion` records (L1's chunker); a different one means re-ingest. */
export const CHUNK_SCHEMA_VERSION = 1;

export const messageRoleValidator = v.union(v.literal("question"), v.literal("answer"));
export type MessageRole = Infer<typeof messageRoleValidator>;

/**
 * An answer's life: pending (asked, no text yet) → streaming → done | error | stopped. Question rows are stored
 * as done. At most one pending/streaming answer per user per campaign (LOREKEEPER_BUSY).
 */
export const messageStatusValidator = v.union(
  v.literal("pending"),
  v.literal("streaming"),
  v.literal("done"),
  v.literal("error"),
  v.literal("stopped"),
);
export type MessageStatus = Infer<typeof messageStatusValidator>;
export const IN_FLIGHT_STATUSES = ["pending", "streaming"] as const satisfies readonly MessageStatus[];

/**
 * Where an in-flight answer is (L11, widened 2026-10-22; absent on older rows = 'books'): searching the books (the
 * first pass; a 'rules' answer streams under it), checking again with the stronger model, searching the internet, or
 * done (the run ended). Uncertain passes are never shown while they run: the card shows the phase instead.
 */
export const answerPhaseValidator = v.union(v.literal("books"), v.literal("retry"), v.literal("web"), v.literal("done"));
export type AnswerPhase = Infer<typeof answerPhaseValidator>;

/** The answer's verdict pill: ✓ From the rules, ? Rules unclear, ✕ Not in your books. */
export const verdictValidator = v.union(v.literal("rules"), v.literal("unclear"), v.literal("none"));
export type Verdict = Infer<typeof verdictValidator>;

/** Q3: a conversation is readable by the whole campaign unless its asker made it private. */
export const conversationVisibilityValidator = v.union(v.literal("campaign"), v.literal("private"));
export type ConversationVisibility = Infer<typeof conversationVisibilityValidator>;

/** Why an answer ended as `error` (codes of src/lib/errors/lorekeeper.ts); the card shows only generic text. */
export const failureCodeValidator = v.union(
  v.literal("LOREKEEPER_FAILED"),
  v.literal("LOREKEEPER_REFUSED"),
  v.literal("LOREKEEPER_TIMEOUT"),
  v.literal("LOREKEEPER_UNAVAILABLE"),
);
export type FailureCode = Infer<typeof failureCodeValidator>;

/** A quote under an answer: a cited passage of a book (with its printed page) or of a pinned table ruling. */
export const quoteValidator = v.union(
  v.object({
    kind: v.literal("book"),
    /** At most LOREKEEPER_LIMITS.quote characters. */
    text: v.string(),
    bookId: v.id("lorekeeperBooks"),
    /** The printed page. */
    page: v.number(),
    section: v.string(),
  }),
  v.object({
    kind: v.literal("ruling"),
    text: v.string(),
    /** Absent when the ruling was unpinned after the answer. */
    rulingId: v.optional(v.id("lorekeeperRulings")),
    title: v.string(),
  }),
);
export type Quote = Infer<typeof quoteValidator>;

/** One unofficial internet result (L8), plain text only; `url` is shown with its site and rel=noopener nofollow. */
export const webResultValidator = v.object({
  title: v.string(),
  site: v.string(),
  url: v.string(),
  snippet: v.string(),
});
export type WebResult = Infer<typeof webResultValidator>;

/**
 * The structured parts of an answer, typed (so no schemaVersion, rule 7): the verdict once its line has streamed,
 * up to 3 quotes, the suggested GM call (unclear answers) and the internet block (L8).
 */
export const partsValidator = v.object({
  verdict: verdictValidator,
  quotes: v.array(quoteValidator),
  call: v.optional(v.string()),
  web: v.optional(v.array(webResultValidator)),
});
export type AnswerParts = Infer<typeof partsValidator>;

/** Token usage of an answer, summed over every pass (Sonnet, the Opus retry, the web pass), and its cost. */
export const usageValidator = v.object({
  input: v.number(),
  output: v.number(),
  cacheRead: v.number(),
  cacheWrite: v.number(),
  webSearches: v.number(),
  /** US dollars × 1,000,000. */
  costMicros: v.number(),
});
export type AnswerUsage = Infer<typeof usageValidator>;

/**
 * The worst-case cost `caps.reserve` booked for an answer, with the counter periods it went to, so the final patch
 * (or the stale-run sweep) can `caps.settle` the same counters.
 */
export const reservationValidator = v.object({
  micros: v.number(),
  /** UTC day "YYYY-MM-DD" of the per-user counter. */
  day: v.string(),
  /** UTC month "YYYY-MM" of the campaign and deployment counters. */
  month: v.string(),
});
export type Reservation = Infer<typeof reservationValidator>;

/** Which counter a `lorekeeperUsage` row is (Q9). */
export const usageKindValidator = v.union(v.literal("user"), v.literal("campaign"), v.literal("deployment"));
export type UsageKind = Infer<typeof usageKindValidator>;

/** How an Ask-the-GM request ended (Q8). */
export const askResolutionValidator = v.union(v.literal("pinned"), v.literal("dismissed"));
export type AskResolution = Infer<typeof askResolutionValidator>;
