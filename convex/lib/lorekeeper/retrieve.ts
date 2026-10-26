import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { BOOK_KEY_CORE, BOOK_KEY_HOPE_FEAR, BOOK_KEY_HOUSE_RULES, frameBookKey } from "../validators/lorekeeper";

/**
 * Retrieval over the campaign's enabled books (Q1, analysis 3a): the search index `search_text` per enabled book, the
 * top `MAX_HITS` chunks plus their same-page neighbours, at most `MAX_CHARS` (about 8k tokens), deduplicated.
 * Also the library helpers L2's `lorekeeperLibrary.ts` (and L4, for the house-rules switch) share: which books a
 * campaign sees and which are on.
 */

/** A chunk sent to the model as one cited document titled '<bookTitle> · p.<page> · <section>'. */
export type RetrievedChunk = {
  chunkId: Id<"lorekeeperChunks">;
  bookId: Id<"lorekeeperBooks">;
  bookKey: string;
  bookTitle: string;
  /** The printed page. */
  page: number;
  section: string;
  text: string;
};

/** The chunks for `question` in `campaign`'s enabled books, best first. */
export type Retrieve = (ctx: QueryCtx, campaign: Doc<"campaigns">, question: string) => Promise<RetrievedChunk[]>;

/** Books per deployment are few (core, Hope & Fear, a frame book per frame, house rules): one bounded read. */
export const MAX_BOOKS = 50;
/** Search hits kept overall (the analysis's "top 10"). */
export const MAX_HITS = 10;
/** Search hits read per book before merging. */
const HITS_PER_BOOK = 10;
/** Same-page neighbours read per hit. */
const NEIGHBOURS_PER_PAGE = 8;
/** About 8k tokens at about 4 characters per token. */
export const MAX_CHARS = 32_000;
/** Convex full-text search uses at most 16 terms; the rest of a long question is dropped. */
export const MAX_TERMS = 16;

/** Words that carry no rule meaning; dropping them leaves room for the 16 terms that do. */
const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could do does did for from had has have how i if in into is it its me my " +
    "of on or our should so than that the their them then there these they this those to us was we were what when " +
    "where which while who why will with would you your"
  ).split(" "),
);

// ---------------------------------------------------------------- the campaign's library

/** One book as a campaign sees it. */
export type CampaignBook = { book: Doc<"lorekeeperBooks">; enabled: boolean };

/** The board's order: core, Hope & Fear, the frame book, house rules, then anything else by title. */
function bookRank(key: string): number {
  if (key === BOOK_KEY_CORE) return 0;
  if (key === BOOK_KEY_HOPE_FEAR) return 1;
  if (key.startsWith("frame:")) return 2;
  if (key === BOOK_KEY_HOUSE_RULES) return 3;
  return 4;
}

/** Whether a campaign shows `key` at all: every book except other frames' frame books. */
export function bookVisibleTo(campaign: Doc<"campaigns">, key: string): boolean {
  return !key.startsWith("frame:") || key === frameBookKey(campaign.frameId);
}

/** The switch without a lorekeeperLibrary row: on for core, Hope & Fear and the campaign's frame; off otherwise (Q7). */
export function enabledByDefault(campaign: Doc<"campaigns">, key: string): boolean {
  return key === BOOK_KEY_CORE || key === BOOK_KEY_HOPE_FEAR || key === frameBookKey(campaign.frameId);
}

/** Every book `campaign` shows, in the board's order, with this campaign's switch. */
export async function campaignBooks(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<CampaignBook[]> {
  const books = await ctx.db.query("lorekeeperBooks").take(MAX_BOOKS);
  const switches = await ctx.db
    .query("lorekeeperLibrary")
    .withIndex("by_campaign_book", (q) => q.eq("campaignId", campaign._id))
    .take(MAX_BOOKS);
  const enabledById = new Map(switches.map((row) => [row.bookId, row.enabled]));
  return books
    .filter((book) => bookVisibleTo(campaign, book.key))
    .map((book) => ({ book, enabled: enabledById.get(book._id) ?? enabledByDefault(campaign, book.key) }))
    .sort((a, b) => bookRank(a.book.key) - bookRank(b.book.key) || a.book.title.localeCompare(b.book.title));
}

/** One book of `campaign`'s library by id, or null when it is not there or not shown to this campaign. */
export async function campaignBook(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  bookId: Id<"lorekeeperBooks">,
): Promise<CampaignBook | null> {
  const book = await ctx.db.get("lorekeeperBooks", bookId);
  if (book === null || !bookVisibleTo(campaign, book.key)) return null;
  const row = await ctx.db
    .query("lorekeeperLibrary")
    .withIndex("by_campaign_book", (q) => q.eq("campaignId", campaign._id).eq("bookId", bookId))
    .first();
  return { book, enabled: row?.enabled ?? enabledByDefault(campaign, book.key) };
}

/** Whether the book with `key` is on for `campaign` (L4: the house-rules switch). False when the book is absent. */
export async function bookKeyEnabled(ctx: QueryCtx, campaign: Doc<"campaigns">, key: string): Promise<boolean> {
  const book = await ctx.db
    .query("lorekeeperBooks")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (book === null) return false;
  return (await campaignBook(ctx, campaign, book._id))?.enabled ?? false;
}

// ---------------------------------------------------------------- the search

/** The search terms of a question: lower-case words without stopwords, deduplicated, at most `MAX_TERMS`. */
export function searchTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
  const terms: string[] = [];
  for (const raw of words) {
    const word = raw.replace(/['’].*$/u, "");
    if (word.length < 2 || STOPWORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** How many of the terms a chunk contains: the tie-break that merges per-book result lists. */
function termHits(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((n, term) => (lower.includes(term) ? n + 1 : n), 0);
}

type Hit = { chunk: Doc<"lorekeeperChunks">; book: Doc<"lorekeeperBooks">; rank: number; score: number };

function toRetrieved(chunk: Doc<"lorekeeperChunks">, book: Doc<"lorekeeperBooks">): RetrievedChunk {
  return {
    chunkId: chunk._id,
    bookId: book._id,
    bookKey: book.key,
    bookTitle: book.title,
    page: chunk.page,
    section: chunk.section,
    text: chunk.text,
  };
}

/**
 * The chunks for `question` in `campaign`'s enabled books, best first: per enabled book (with chunks) the search
 * index's top `HITS_PER_BOOK`, merged by how many terms a chunk holds and then by its rank in its book; the top
 * `MAX_HITS`; then the other chunks of those pages; at most `MAX_CHARS` of text. A chunk whose text is already in the
 * list (a frame book cut from the core book) is left out.
 */
export const retrieve: Retrieve = async (ctx, campaign, question) => {
  const terms = searchTerms(question);
  if (terms.length === 0) return [];
  const query = terms.join(" ");
  const books = (await campaignBooks(ctx, campaign))
    .filter(({ book, enabled }) => enabled && book.chunkCount > 0)
    .map(({ book }) => book);

  const hits: Hit[] = [];
  for (const book of books) {
    const found = await ctx.db
      .query("lorekeeperChunks")
      .withSearchIndex("search_text", (q) => q.search("text", query).eq("bookId", book._id))
      .take(HITS_PER_BOOK);
    found.forEach((chunk, rank) => hits.push({ chunk, book, rank, score: termHits(chunk.text, terms) }));
  }
  hits.sort((a, b) => b.score - a.score || a.rank - b.rank || bookRank(a.book.key) - bookRank(b.book.key));

  const out: RetrievedChunk[] = [];
  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();
  let chars = 0;
  const add = (chunk: Doc<"lorekeeperChunks">, book: Doc<"lorekeeperBooks">): void => {
    if (seenIds.has(chunk._id) || seenTexts.has(chunk.text)) return;
    if (chars + chunk.text.length > MAX_CHARS) return;
    seenIds.add(chunk._id);
    seenTexts.add(chunk.text);
    chars += chunk.text.length;
    out.push(toRetrieved(chunk, book));
  };

  const top: Hit[] = [];
  for (const hit of hits) {
    if (top.length === MAX_HITS) break;
    if (seenTexts.has(hit.chunk.text)) continue;
    const before = out.length;
    add(hit.chunk, hit.book);
    if (out.length > before) top.push(hit);
  }
  for (const hit of top) {
    const neighbours = await ctx.db
      .query("lorekeeperChunks")
      .withIndex("by_book_page", (q) => q.eq("bookId", hit.book._id).eq("page", hit.chunk.page))
      .take(NEIGHBOURS_PER_PAGE);
    for (const chunk of neighbours.sort((a, b) => a.ord - b.ord)) add(chunk, hit.book);
  }
  return out;
};
