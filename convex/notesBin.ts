import { v, type Infer } from "convex/values";

import { binCutoff } from "../src/lib/domain/notes/limits";
import { appError } from "../src/lib/errors/app-error";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { readSheet } from "./lib/characterSheet";
import { campaignMutation, campaignQuery } from "./lib/functions";
import { internalMutation } from "./_generated/server";
import { assertAction, bumpJournal, deletePageRows, notesRole, pageAccess, resolvePage, type NotesCtx } from "./lib/notes";
import { pageReadCache } from "./lib/permissions";
import { BIN_TTL_MS, MAX_PAGES, pageKindValidator, pageRefValidator, type PageVisibility } from "./lib/validators/notes";

/**
 * The bin (D11 N7, plan `.omc/plans/d11-notes.yaml`; Q11, Q12, D2; board B8). Tearing out a page sets `binnedAt` /
 * `binnedBy` and takes it out of its journal's counters, so it leaves every list (each list reads `binnedAt` =
 * undefined through its index) and every reader but its owner and the GM who tore it out (permissionFor). Whoever tore
 * it out restores it within 30 days (or its owner, once its journal is present again, dcm-bxp.81) ('Undo' for 10 seconds, then 'Torn-out pages'); afterwards the daily cron
 * `purge torn-out journal pages` deletes it with its entries and recipients (rule 8, CD17). Access goes only through
 * `pageAccess` (canBin / canRestore, analysis 3.2).
 *
 * | Function       | Kind              | Who                                                     | Errors                                   |
 * |----------------|-------------------|---------------------------------------------------------|------------------------------------------|
 * | `bin`          | campaignQuery     | any member: the pages they tore out that they can still restore | NOT_FOUND (grant only)          |
 * | `binPage`      | campaignMutation  | owner of a present journal; the GM for a non-private page of a departed journal | NOTE_PAGE_NOT_FOUND, NOTE_FORBIDDEN_ACTION, NOTE_JOURNAL_CLOSED |
 * | `restorePage`  | campaignMutation  | whoever tore it out, while they can still read it; the owner of a present journal | NOTE_PAGE_NOT_FOUND, NOTE_NOT_BINNED     |
 * | `purgeBinned`  | internalMutation  | the cron                                                | -                                        |
 *
 * Common to the public ones: anonymous UNAUTHENTICATED, outsider NOT_FOUND (the wrapper, `need: "view"`).
 */

// ---------------------------------------------------------------- shapes

/** One row of 'Torn-out pages'. The client shows 'N days left' from `purgeAt` (CF10: no clock in a query). */
export const binRowValidator = v.object({
  _id: v.id("journalPages"),
  title: v.string(),
  kind: pageKindValidator,
  tape: v.number(),
  binnedAt: v.number(),
  /** `binnedAt` + 30 days: the purge may delete it from then on. */
  purgeAt: v.number(),
  /** Whose journal it came from, for a page the caller does not own (the GM's tear-out of a departed page, Q12). */
  from: v.union(v.string(), v.null()),
});
export type BinRow = Infer<typeof binRowValidator>;

/** Rows `bin` returns at most (a journal holds at most MAX_PAGES pages, the bin included). */
const BIN_LIST_MAX = MAX_PAGES;
/** Visibilities a page the GM tears out of a departed journal can have (never 'private', D2). */
const SHAREABLE: PageVisibility[] = ["gm", "players", "everyone", "chosen"];

/** Pages per purge run, and rows (entries + recipients) it deletes at most before it reschedules itself. */
export const PURGE_PAGE_BATCH = 25;
export const PURGE_ROW_BUDGET = 400;

// ---------------------------------------------------------------- helpers

/** The name of a journal for 'from <name>': its character's (Q8), else its owner's account name, else 'a player'. */
async function journalName(ctx: NotesCtx, journal: Doc<"journals">): Promise<string> {
  if (journal.characterId !== undefined) {
    const character = await ctx.db.get("characters", journal.characterId);
    if (character !== null) {
      try {
        return readSheet(character.sheet).name;
      } catch {
        // A sheet that does not read: its stored name when it has one (as notesEntries' author labels do).
        const raw: unknown = character.sheet;
        const stored = typeof raw === "object" && raw !== null ? (raw as { name?: unknown }).name : undefined;
        if (typeof stored === "string" && stored !== "") return stored;
      }
    }
  }
  const owner = await ctx.db.get("users", journal.userId);
  return owner?.name ?? "a player";
}

/** Whether `error` is a ConvexError with this code. */
function isCode(error: unknown, code: string): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  return typeof data === "object" && data !== null && (data as { code?: unknown }).code === code;
}

// ---------------------------------------------------------------- query

/**
 * 'Torn-out pages': the pages the caller may restore (canRestore), newest first. Candidates are the torn-out pages
 * of the caller's own journals (`by_journal_binned`; whoever tore them out, dcm-bxp.81) and the campaign's torn-out shareable pages
 * they tore out (`by_campaign_visibility_binned`, the departed pages they tore out, Q12); each passes `pageAccess`,
 * so a page the binner can no longer read (a departed player rejoined) drops out. Bounded by BIN_LIST_MAX.
 */
export const bin = campaignQuery({
  need: "view",
  args: {},
  returns: v.array(binRowValidator),
  handler: async (ctx): Promise<BinRow[]> => {
    await notesRole(ctx); // a user with grants only has no journal and no bin: NOT_FOUND
    const candidates = new Map<Id<"journalPages">, Doc<"journalPages">>();
    const journals = await ctx.db
      .query("journals")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", ctx.user._id))
      .take(100);
    for (const journal of journals) {
      const pages = await ctx.db
        .query("journalPages")
        .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id).gte("binnedAt", 0))
        .take(BIN_LIST_MAX);
      // Any tear-out of the caller's own pages: canRestore below lets the owner restore one the GM tore out once the
      // journal is present again (dcm-bxp.81), and drops it while the journal is still departed.
      for (const page of pages) candidates.set(page._id, page);
    }
    // Pages of other journals the caller tore out (only the GM can, D2; pageAccess below decides, not a role check).
    for (const visibility of SHAREABLE) {
      const pages = await ctx.db
        .query("journalPages")
        .withIndex("by_campaign_visibility_binned", (q) =>
          q.eq("campaignId", ctx.campaign._id).eq("visibility", visibility).gte("binnedAt", 0),
        )
        .take(BIN_LIST_MAX);
      for (const page of pages) if (page.binnedBy === ctx.user._id) candidates.set(page._id, page);
    }

    const rows: BinRow[] = [];
    const names = new Map<Id<"journals">, string>();
    // One read of the caller's role and of each journal and its departure for the whole list (PF10).
    const cache = pageReadCache(ctx.user, ctx.campaign);
    for (const page of candidates.values()) {
      let access;
      try {
        access = await pageAccess(ctx, page, cache);
      } catch (error) {
        if (isCode(error, "NOTE_PAGE_NOT_FOUND")) continue;
        throw error;
      }
      if (!access.canRestore || page.binnedAt === undefined) continue;
      let from: string | null = null;
      if (!access.isOwner) {
        from = names.get(access.journal._id) ?? (await journalName(ctx, access.journal));
        names.set(access.journal._id, from);
      }
      rows.push({
        _id: page._id,
        title: page.title,
        kind: page.kind,
        tape: page.tape,
        binnedAt: page.binnedAt,
        purgeAt: page.binnedAt + BIN_TTL_MS,
        from,
      });
    }
    return rows.sort((a, b) => b.binnedAt - a.binnedAt).slice(0, BIN_LIST_MAX);
  },
});

// ---------------------------------------------------------------- writes

/**
 * 'Tear out page' (Q11; Q12, D2): moves the page to the bin. The owner of a present journal, or the GM for a
 * non-private page of a departed journal (canBin). Sets `binnedAt` / `binnedBy` and takes the page's pages / entries /
 * open threads out of its journal's counters; recipients stay (a restore brings the sharing back). A template ref
 * creates the caller's journal first (CL6). Returns the page id (for 'Undo').
 */
export const binPage = campaignMutation({
  need: "view",
  args: { page: pageRefValidator },
  returns: v.id("journalPages"),
  handler: async (ctx, { page: ref }) => {
    const access = await resolvePage(ctx, ref);
    assertAction(access, "bin");
    const { page } = access;
    const now = Date.now();
    await ctx.db.patch("journalPages", page._id, { binnedAt: now, binnedBy: ctx.user._id, updatedAt: now });
    await bumpJournal(ctx, page.journalId, { pages: -1, entries: -page.entryCount, open: -page.openCount });
    return page._id;
  },
});

/**
 * 'Undo' / 'Restore' (Q11): puts a torn-out page back where it was, with its entries and sharing. Whoever tore it out,
 * while they can still read it, or the page's owner once its journal is present (dcm-bxp.81) (canRestore); a page
 * that is not torn out, or that someone else tore out (the owner of a still-departed journal), answers NOTE_NOT_BINNED. NOTE_PAGE_LIMIT is not checked again: the bin already counts toward MAX_PAGES (Q10).
 */
export const restorePage = campaignMutation({
  need: "view",
  args: { page: pageRefValidator },
  returns: v.null(),
  handler: async (ctx, { page: ref }) => {
    if (typeof ref !== "string") throw appError("NOTE_NOT_BINNED");
    const access = await pageAccess(ctx, ref);
    assertAction(access, "restore");
    const { page } = access;
    await ctx.db.patch("journalPages", page._id, { binnedAt: undefined, binnedBy: undefined, updatedAt: Date.now() });
    await bumpJournal(ctx, page.journalId, { pages: 1, entries: page.entryCount, open: page.openCount });
    return null;
  },
});

// ---------------------------------------------------------------- the purge (rule 8, CD17)

/**
 * The cron `purge torn-out journal pages`: deletes pages torn out more than 30 days ago (`by_binned`, binnedAt before
 * N1 `binCutoff`) with their entries and recipients, at most PURGE_PAGE_BATCH pages and PURGE_ROW_BUDGET rows per run,
 * and reschedules itself while work remains. A purged page is already out of its journal's counters. Idempotent: a run
 * with nothing due changes nothing.
 */
export const purgeBinned = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = binCutoff(Date.now());
    const due = await ctx.db
      .query("journalPages")
      .withIndex("by_binned", (q) => q.gte("binnedAt", 0).lt("binnedAt", cutoff))
      .take(PURGE_PAGE_BATCH);
    let budget = PURGE_ROW_BUDGET;
    let more = due.length === PURGE_PAGE_BATCH;
    for (const page of due) {
      if (budget <= 0) {
        more = true;
        break;
      }
      const { deleted, done } = await deletePageRows(ctx, page._id, budget);
      budget -= deleted;
      if (!done) {
        more = true;
        break;
      }
      await ctx.db.delete("journalPages", page._id);
    }
    if (more) await ctx.scheduler.runAfter(0, internal.notesBin.purgeBinned, {});
    return null;
  },
});
