import { v, type Infer } from "convex/values";

import { getPublishedFrame } from "../src/lib/frames/index";
import { appError } from "../src/lib/errors/app-error";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { campaignQuery, gmMutation } from "./lib/functions";
import { campaignBook, campaignBooks } from "./lib/lorekeeper/retrieve";
import {
  BOOK_KEY_CORE,
  BOOK_KEY_HOPE_FEAR,
  BOOK_KEY_HOUSE_RULES,
  CHUNK_SCHEMA_VERSION,
  LOREKEEPER_LIMITS,
} from "./lib/validators/lorekeeper";

/**
 * The Lorekeeper's rules source (D13 L2, plan `.omc/plans/d13-lorekeeper.yaml`, Q1, Q5, Q6, Q7): the library a
 * campaign sees, the GM's per-campaign book switches, the 'Open in the book' page text, and the internal ingest the
 * local script `pnpm lorekeeper:ingest` (scripts/lorekeeper-ingest.mjs) calls through `npx convex run` with the
 * deployment's admin rights. No public function writes books or chunks, and none returns a book whole: `pageText`
 * returns one page of a book the campaign has switched on.
 *
 * | Function       | Kind              | Args                 | Errors                                       |
 * |----------------|-------------------|----------------------|----------------------------------------------|
 * | `list`         | campaignQuery view| -                    | -                                            |
 * | `setEnabled`   | gmMutation        | bookId, enabled      | LOREKEEPER_BOOK_NOT_FOUND                    |
 * | `pageText`     | campaignQuery view| bookId, page         | LOREKEEPER_BOOK_NOT_FOUND (absent, off, empty)|
 * | `ingestBook`   | internalMutation  | bookKey, meta, pages | INVALID (unknown key)                        |
 * | `clearChunks`  | internalMutation  | bookId               | LOREKEEPER_BOOK_NOT_FOUND                    |
 * | `ingestChunks` | internalMutation  | bookId, chunks ≤ 100 | INVALID, LOREKEEPER_BOOK_NOT_FOUND           |
 *
 * Common: anonymous UNAUTHENTICATED, outsider NOT_FOUND, a player calling `setEnabled` FORBIDDEN (the wrappers).
 */

/** Chunks per `ingestChunks` call (plan L2). */
export const INGEST_BATCH = 100;
/** Old chunks deleted per `clearChunks` call. */
export const CLEAR_BATCH = 500;
/** One printed page holds a handful of chunks; this bounds `pageText`. */
const PAGE_CHUNKS = 20;

/** The board's library rows (analysis 1.2); `title`, `subtitle` and `cover` default from these. */
const BOOK_DEFAULTS: Record<string, { title: string; subtitle: string; cover: string }> = {
  [BOOK_KEY_CORE]: { title: "Daggerheart Core Rulebook", subtitle: "Rules, classes, adversaries", cover: "core" },
  [BOOK_KEY_HOPE_FEAR]: { title: "Hope & Fear", subtitle: "Assassin, Brawler, Warlock, Witch", cover: "hopeFear" },
  [BOOK_KEY_HOUSE_RULES]: { title: "House rules (notes)", subtitle: "Your Notes tab", cover: "houseRules" },
};

/** The defaults for a book key, or null when the key is not one the library knows. */
export function bookDefaults(key: string): { title: string; subtitle: string; cover: string } | null {
  const known = BOOK_DEFAULTS[key];
  if (known) return known;
  if (!key.startsWith("frame:")) return null;
  const frame = getPublishedFrame(key.slice("frame:".length));
  return frame ? { title: frame.name, subtitle: "Campaign frame", cover: "frame" } : null;
}

// ---------------------------------------------------------------- public: the library

const libraryBookValidator = v.object({
  bookId: v.id("lorekeeperBooks"),
  key: v.string(),
  title: v.string(),
  subtitle: v.string(),
  /** The cover token: `lk-cover-<cover>` in lorekeeper.css. */
  cover: v.string(),
  /** Printed pages indexed. */
  pages: v.number(),
  chunkCount: v.number(),
  /** This campaign's switch: the board's green 'Indexed' / red 'Off' pill. */
  enabled: v.boolean(),
});
export type LibraryBook = Infer<typeof libraryBookValidator>;

const libraryValidator = v.object({
  books: v.array(libraryBookValidator),
  /** The chat header's '<N> books indexed': books switched on for this campaign. */
  indexedCount: v.number(),
});
export type Library = Infer<typeof libraryValidator>;

/** The campaign's library: every book it shows with its switch, never any chunk text. Members (view). */
export const list = campaignQuery({
  need: "view",
  args: {},
  returns: libraryValidator,
  handler: async (ctx): Promise<Library> => {
    const books = (await campaignBooks(ctx, ctx.campaign)).map(
      ({ book, enabled }): LibraryBook => ({
        bookId: book._id,
        key: book.key,
        title: book.title,
        subtitle: book.subtitle,
        cover: book.cover,
        pages: book.pages,
        chunkCount: book.chunkCount,
        enabled,
      }),
    );
    return { books, indexedCount: books.filter((book) => book.enabled).length };
  },
});

/** The GM switches one book on or off for this campaign (an intent: one field). */
export const setEnabled = gmMutation({
  args: { bookId: v.id("lorekeeperBooks"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { bookId, enabled }) => {
    const found = await campaignBook(ctx, ctx.campaign, bookId);
    if (found === null) throw appError("LOREKEEPER_BOOK_NOT_FOUND");
    const row = await ctx.db
      .query("lorekeeperLibrary")
      .withIndex("by_campaign_book", (q) => q.eq("campaignId", ctx.campaign._id).eq("bookId", bookId))
      .first();
    const updatedAt = Date.now();
    if (row === null) {
      await ctx.db.insert("lorekeeperLibrary", { campaignId: ctx.campaign._id, bookId, enabled, updatedAt });
    } else if (row.enabled !== enabled) {
      await ctx.db.patch("lorekeeperLibrary", row._id, { enabled, updatedAt });
    }
    return null;
  },
});

const pageTextValidator = v.object({
  bookId: v.id("lorekeeperBooks"),
  bookTitle: v.string(),
  page: v.number(),
  /** The page's chunks in book order. */
  sections: v.array(v.object({ section: v.string(), text: v.string() })),
});
export type PageText = Infer<typeof pageTextValidator>;

/**
 * 'Open in the book' (Q5): the indexed text of one printed page of a book this campaign has switched on. Members
 * (view). A book that is absent, off or has nothing on that page is LOREKEEPER_BOOK_NOT_FOUND.
 */
export const pageText = campaignQuery({
  need: "view",
  args: { bookId: v.id("lorekeeperBooks"), page: v.number() },
  returns: pageTextValidator,
  handler: async (ctx, { bookId, page }): Promise<PageText> => {
    const found = await campaignBook(ctx, ctx.campaign, bookId);
    if (found === null || !found.enabled) throw appError("LOREKEEPER_BOOK_NOT_FOUND");
    const chunks = await ctx.db
      .query("lorekeeperChunks")
      .withIndex("by_book_page", (q) => q.eq("bookId", bookId).eq("page", page))
      .take(PAGE_CHUNKS);
    if (chunks.length === 0) throw appError("LOREKEEPER_BOOK_NOT_FOUND");
    return {
      bookId,
      bookTitle: found.book.title,
      page,
      sections: chunks.sort((a, b) => a.ord - b.ord).map(({ section, text }) => ({ section, text })),
    };
  },
});

// ---------------------------------------------------------------- internal: the ingest (scripts/lorekeeper-ingest.mjs)

/** Inserts the house-rules pseudo-book (Q7) when missing, so its switch shows in every library. */
async function ensureHouseRules(ctx: MutationCtx, now: number): Promise<void> {
  const existing = await ctx.db
    .query("lorekeeperBooks")
    .withIndex("by_key", (q) => q.eq("key", BOOK_KEY_HOUSE_RULES))
    .first();
  if (existing !== null) return;
  const meta = BOOK_DEFAULTS[BOOK_KEY_HOUSE_RULES]!;
  await ctx.db.insert("lorekeeperBooks", {
    key: BOOK_KEY_HOUSE_RULES,
    ...meta,
    pages: 0,
    chunkCount: 0,
    ingestedAt: now,
    schemaVersion: CHUNK_SCHEMA_VERSION,
  });
}

/**
 * Makes sure the house-rules pseudo-book (key `houseRules`, no chunks) exists, so the GM can switch house rules on per
 * campaign (L4 reads that switch). Idempotent. `ingestBook` does the same on every ingest; the script calls this for
 * `pnpm lorekeeper:ingest houseRules`.
 */
export const ensureHouseRulesBook = internalMutation({
  args: {},
  returns: v.object({ bookId: v.id("lorekeeperBooks") }),
  handler: async (ctx) => {
    await ensureHouseRules(ctx, Date.now());
    const book = await ctx.db
      .query("lorekeeperBooks")
      .withIndex("by_key", (q) => q.eq("key", BOOK_KEY_HOUSE_RULES))
      .first();
    return { bookId: book!._id };
  },
});

/**
 * Registers (or re-registers) a book before its chunks are sent: inserts or updates the `lorekeeperBooks` row with
 * its title, subtitle, cover and printed page count, and resets `chunkCount` to 0 (the following `clearChunks` and
 * `ingestChunks` calls replace the old chunks). Also makes sure the house-rules pseudo-book exists. Idempotent.
 */
export const ingestBook = internalMutation({
  args: {
    bookKey: v.string(),
    title: v.optional(v.string()),
    subtitle: v.optional(v.string()),
    cover: v.optional(v.string()),
    pages: v.number(),
  },
  returns: v.object({ bookId: v.id("lorekeeperBooks") }),
  handler: async (ctx, { bookKey, title, subtitle, cover, pages }) => {
    const defaults = bookDefaults(bookKey);
    if (defaults === null) throw appError("INVALID", `Unknown book key "${bookKey}".`);
    const now = Date.now();
    await ensureHouseRules(ctx, now);
    const fields = {
      key: bookKey,
      title: (title?.trim() || defaults.title).slice(0, 120),
      subtitle: (subtitle?.trim() || defaults.subtitle).slice(0, 120),
      cover: (cover?.trim() || defaults.cover).slice(0, 40),
      pages: Math.max(0, Math.floor(pages)),
      chunkCount: 0,
      ingestedAt: now,
      schemaVersion: CHUNK_SCHEMA_VERSION,
    };
    const existing = await ctx.db
      .query("lorekeeperBooks")
      .withIndex("by_key", (q) => q.eq("key", bookKey))
      .first();
    if (existing !== null) {
      await ctx.db.patch("lorekeeperBooks", existing._id, fields);
      return { bookId: existing._id };
    }
    return { bookId: await ctx.db.insert("lorekeeperBooks", fields) };
  },
});

async function loadBook(ctx: MutationCtx, bookId: Id<"lorekeeperBooks">) {
  const book = await ctx.db.get("lorekeeperBooks", bookId);
  if (book === null) throw appError("LOREKEEPER_BOOK_NOT_FOUND");
  return book;
}

/** Deletes up to `CLEAR_BATCH` of a book's chunks; the script repeats it until `done`. */
export const clearChunks = internalMutation({
  args: { bookId: v.id("lorekeeperBooks") },
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx, { bookId }) => {
    await loadBook(ctx, bookId);
    const rows = await ctx.db
      .query("lorekeeperChunks")
      .withIndex("by_book_page", (q) => q.eq("bookId", bookId))
      .take(CLEAR_BATCH);
    for (const row of rows) await ctx.db.delete("lorekeeperChunks", row._id);
    return { deleted: rows.length, done: rows.length < CLEAR_BATCH };
  },
});

const chunkInputValidator = v.object({
  page: v.number(),
  section: v.string(),
  text: v.string(),
  ord: v.number(),
});

/** Inserts one batch (at most `INGEST_BATCH`) of a book's chunks and adds them to its `chunkCount`. */
export const ingestChunks = internalMutation({
  args: { bookId: v.id("lorekeeperBooks"), chunks: v.array(chunkInputValidator) },
  returns: v.object({ inserted: v.number(), chunkCount: v.number() }),
  handler: async (ctx, { bookId, chunks }) => {
    if (chunks.length > INGEST_BATCH) throw appError("INVALID", `At most ${INGEST_BATCH} chunks per call.`);
    const book = await loadBook(ctx, bookId);
    for (const chunk of chunks) {
      if (chunk.text.length === 0 || chunk.text.length > LOREKEEPER_LIMITS.chunk) {
        throw appError("INVALID", `A chunk holds 1 to ${LOREKEEPER_LIMITS.chunk} characters.`);
      }
      if (!Number.isInteger(chunk.page) || !Number.isInteger(chunk.ord)) throw appError("INVALID", "Pages and ords are integers.");
    }
    for (const chunk of chunks) {
      await ctx.db.insert("lorekeeperChunks", {
        bookId,
        page: chunk.page,
        section: chunk.section.slice(0, LOREKEEPER_LIMITS.section),
        text: chunk.text,
        ord: chunk.ord,
      });
    }
    const chunkCount = book.chunkCount + chunks.length;
    await ctx.db.patch("lorekeeperBooks", bookId, { chunkCount });
    return { inserted: chunks.length, chunkCount };
  },
});
