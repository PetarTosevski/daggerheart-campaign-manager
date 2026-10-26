import { v, type Infer } from "convex/values";

import { authorLabel } from "../src/lib/domain/notes/authors";
import { NOTE_LIMITS } from "../src/lib/domain/notes/limits";
import { matches, normalizeQuery } from "../src/lib/domain/notes/summary";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import { readSheet } from "./lib/characterSheet";
import { campaignQuery } from "./lib/functions";
import { currentJournal, type NotesCtx } from "./lib/notes";
import { entryKindValidator, entryStateValidator, MAX_PAGE_ENTRIES, MAX_PAGES, pageKindValidator } from "./lib/validators/notes";

/**
 * Open threads, search and 'Download my journal' (D11 N4, plan `.omc/plans/d11-notes.yaml`; board rules B1, B5, B9;
 * Q9, Q13, D5). All three read the caller's CURRENT journal only (`currentJournal`, D3, chosen by `ctx.user`, CF3):
 * never a page shared with the caller, a page of another journal the caller can read, or a torn-out page (Q13, Q9).
 * The caller owns every page they read here (A4: the owner always sees their page), so no per-page `permissionFor`
 * call is needed; a page id never comes from the client.
 *
 * | Function     | Kind          | Args                 | Reads (journal at the caps)                                  | Errors   |
 * |--------------|---------------|----------------------|--------------------------------------------------------------|----------|
 * | `threads`    | campaignQuery | -                    | pages (<= 200), open entries by_journal_open (<= 500), authors | -        |
 * | `search`     | campaignQuery | text (1-80)          | pages (<= 200), search_text hits filtered by journalId (<= 200)| INVALID  |
 * | `exportPage` | campaignQuery | cursor (null first)  | EXPORT_PAGES pages and their entries (<= 300 each), authors  | -        |
 *
 * Common: anonymous UNAUTHENTICATED, outsider NOT_FOUND (the wrapper, `need: "view"`), a user with grants only and no
 * campaign role NOT_FOUND (`notesRole`). Before the first write (no journal) every list is empty.
 */

/** At most this many open entries in the threads view (plan N4: take 500). */
export const MAX_THREADS = 500;
/** At most this many search hits from the entry search index (plan N4: take 200). */
export const MAX_SEARCH_HITS = 200;
/** Pages per `exportPage` call: 10 pages x 300 entries x 500 characters stays far below the read limits. */
export const EXPORT_PAGES = 10;

// ---------------------------------------------------------------- shapes

/** One open thread (B5): an open task or an unresolved Fear on an own page, added entries included (D5). */
export const threadRowValidator = v.object({
  _id: v.id("journalEntries"),
  pageId: v.id("journalPages"),
  pageTitle: v.string(),
  kind: entryKindValidator,
  state: entryStateValidator,
  star: v.boolean(),
  /** Plain text with D7 mention tokens (the mentions slot renders them). */
  text: v.string(),
  /** Written by someone other than the page owner (Q3): added colour and ' - <authorLabel>'. */
  added: v.boolean(),
  authorLabel: v.string(),
});
export type ThreadRow = Infer<typeof threadRowValidator>;

/** One own page for the Markdown file (N1 `ExportPage`). */
export const exportPageItemValidator = v.object({
  id: v.id("journalPages"),
  kind: pageKindValidator,
  title: v.string(),
  createdAt: v.number(),
  /** The linked session's date when the caller can see the session (Q5, D6). */
  session: v.optional(v.object({ date: v.optional(v.string()) })),
});

/** One entry for the Markdown file (N1 `ExportEntry`). */
export const exportEntryValidator = v.object({
  pageId: v.id("journalPages"),
  kind: entryKindValidator,
  state: entryStateValidator,
  star: v.boolean(),
  text: v.string(),
  order: v.number(),
  /** The author label of an added entry (Q3); absent for the owner's own lines. */
  addedBy: v.optional(v.string()),
});

export const exportChunkValidator = v.object({
  pages: v.array(exportPageItemValidator),
  entries: v.array(exportEntryValidator),
  /** Pass it back for the next chunk; null when this was the last one. */
  continueCursor: v.union(v.string(), v.null()),
});
export type ExportChunk = Infer<typeof exportChunkValidator>;

// ---------------------------------------------------------------- helpers

/** The caller's current journal (D3), or null before their first write. */
async function ownJournal(ctx: NotesCtx): Promise<{ journal: Doc<"journals"> | null; isGm: boolean }> {
  const current = await currentJournal(ctx);
  return { journal: current.journal, isGm: current.role === "gm" };
}

/** The journal's pages that are not torn out, by id (bounded by MAX_PAGES). */
async function livePages(ctx: NotesCtx, journalId: Id<"journals">): Promise<Map<Id<"journalPages">, Doc<"journalPages">>> {
  const pages = await ctx.db
    .query("journalPages")
    .withIndex("by_journal_binned", (q) => q.eq("journalId", journalId).eq("binnedAt", undefined))
    .take(MAX_PAGES);
  return new Map(pages.map((page) => [page._id, page]));
}

/** The character's name from its sheet; a sheet that does not read gives its stored `name`, else null. */
function characterName(character: Doc<"characters"> | null): string | null {
  if (character === null) return null;
  try {
    return readSheet(character.sheet).name;
  } catch {
    const raw: unknown = character.sheet;
    const stored = typeof raw === "object" && raw !== null ? (raw as { name?: unknown }).name : undefined;
    return typeof stored === "string" ? stored : null;
  }
}

/**
 * Labels the added entries (author is not the page owner, Q3) as N3 does: 'GM', the author's character name, their
 * account name, 'Player'. One read per distinct author (a handful). Own lines get ''.
 */
function authorLabeller(ctx: NotesCtx) {
  const cache = new Map<string, string>();
  return async (entry: Doc<"journalEntries">, page: Doc<"journalPages">): Promise<string> => {
    if (entry.authorId === page.ownerId) return "";
    const key = `${entry.authorId}|${entry.authorCharacterId ?? ""}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const isGm = entry.authorId === ctx.campaign.ownerId;
    const character = isGm || entry.authorCharacterId === undefined ? null : await ctx.db.get("characters", entry.authorCharacterId);
    const user = isGm ? null : await ctx.db.get("users", entry.authorId);
    const label = authorLabel({ isGm, characterName: characterName(character), accountName: user?.name ?? null });
    cache.set(key, label);
    return label;
  };
}

// ---------------------------------------------------------------- queries

/**
 * '🧵 Open threads' (B5, Q13): the current journal's open entries (`open` is kept by N3 with N1 isOpenThread: an open
 * task or an unresolved Fear), added entries on own pages included (D5), each with its page's title. Entries on
 * torn-out pages are dropped. In page order (created), then entry order.
 */
export const threads = campaignQuery({
  need: "view",
  args: {},
  returns: v.array(threadRowValidator),
  handler: async (ctx): Promise<ThreadRow[]> => {
    const { journal } = await ownJournal(ctx);
    if (journal === null) return [];
    const pages = await livePages(ctx, journal._id);
    const open = await ctx.db
      .query("journalEntries")
      .withIndex("by_journal_open", (q) => q.eq("journalId", journal._id).eq("open", true))
      .take(MAX_THREADS);
    const label = authorLabeller(ctx);
    const rows: { row: ThreadRow; pageCreated: number; order: number }[] = [];
    for (const entry of open) {
      const page = pages.get(entry.pageId);
      if (page === undefined) continue;
      rows.push({
        row: {
          _id: entry._id,
          pageId: page._id,
          pageTitle: page.title,
          kind: entry.kind,
          state: entry.state,
          star: entry.star,
          text: entry.text,
          added: entry.authorId !== page.ownerId,
          authorLabel: await label(entry, page),
        },
        pageCreated: page._creationTime,
        order: entry.order,
      });
    }
    rows.sort((a, b) => a.pageCreated - b.pageCreated || a.order - b.order);
    return rows.map(({ row }) => row);
  },
});

/**
 * 'Search the journal' (B9, Q13): the current journal's pages (not torn out) whose title matches, or that hold an
 * entry the entry search index finds within this journal (take 200) and N1 `matches` confirms (the index sees the raw
 * text with mention ids; `matches` reads mentions as names and is a case-insensitive substring test). Returns page
 * ids in created order. Text of 1-80 characters after trimming, else INVALID.
 */
export const search = campaignQuery({
  need: "view",
  args: { text: v.string() },
  returns: v.array(v.id("journalPages")),
  handler: async (ctx, { text }): Promise<Id<"journalPages">[]> => {
    const query = normalizeQuery(text);
    if (query.length < 1 || query.length > NOTE_LIMITS.TITLE_MAX) throw appError("INVALID", "Search with 1 to 80 characters.");
    const { journal } = await ownJournal(ctx);
    if (journal === null) return [];
    const pages = await livePages(ctx, journal._id);
    const hits = new Set<Id<"journalPages">>();
    for (const page of pages.values()) if (matches(page.title, query)) hits.add(page._id);
    const found = await ctx.db
      .query("journalEntries")
      .withSearchIndex("search_text", (q) => q.search("text", query).eq("journalId", journal._id))
      .take(MAX_SEARCH_HITS);
    for (const entry of found) if (pages.has(entry.pageId) && matches(entry.text, query)) hits.add(entry.pageId);
    return [...pages.values()].filter((page) => hits.has(page._id)).map((page) => page._id);
  },
});

/**
 * 'Download my journal' (Q9): one chunk of the caller's own pages that are not torn out, EXPORT_PAGES at a time in
 * created order, with their entries (each page's, at most MAX_PAGE_ENTRIES) and the linked session's date when the
 * caller can see it. The client calls it from the button's click handler until `continueCursor` is null and builds
 * one Markdown file with N1 `journalToMarkdown`. Never another person's page (Q9).
 */
export const exportPage = campaignQuery({
  need: "view",
  args: { cursor: v.union(v.string(), v.null()) },
  returns: exportChunkValidator,
  handler: async (ctx, { cursor }): Promise<ExportChunk> => {
    const { journal, isGm } = await ownJournal(ctx);
    if (journal === null) return { pages: [], entries: [], continueCursor: null };
    const result = await ctx.db
      .query("journalPages")
      .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id).eq("binnedAt", undefined))
      .paginate({ cursor, numItems: EXPORT_PAGES });
    const label = authorLabeller(ctx);
    const pages: ExportChunk["pages"] = [];
    const entries: ExportChunk["entries"] = [];
    for (const page of result.page) {
      const session = page.sessionId === undefined ? null : await ctx.db.get("sessions", page.sessionId);
      const visible = session !== null && session.campaignId === ctx.campaign._id && (isGm || session.status !== "planned");
      pages.push({
        id: page._id,
        kind: page.kind,
        title: page.title,
        createdAt: page.createdAt,
        ...(visible ? { session: session.date !== undefined ? { date: session.date } : {} } : {}),
      });
      const rows = await ctx.db
        .query("journalEntries")
        .withIndex("by_page_order", (q) => q.eq("pageId", page._id))
        .take(MAX_PAGE_ENTRIES);
      for (const entry of rows) {
        const addedBy = await label(entry, page);
        entries.push({
          pageId: page._id,
          kind: entry.kind,
          state: entry.state,
          star: entry.star,
          text: entry.text,
          order: entry.order,
          ...(addedBy !== "" ? { addedBy } : {}),
        });
      }
    }
    return { pages, entries, continueCursor: result.isDone ? null : result.continueCursor };
  },
});
