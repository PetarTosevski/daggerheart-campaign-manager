import { v, type Infer } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import { campaignQuery } from "./lib/functions";
import { currentJournal } from "./lib/notes";
import { loadSession } from "./lib/sessions";
import { entryKindValidator, entryStateValidator, MAX_PAGES } from "./lib/validators/notes";
import { MAX_THREADS } from "./notesThreads";

/**
 * Journal 'Threads raised' (plan `.omc/plans/journal.yaml` JD6, user Q1 / Q2): the open threads (an open task or an
 * unresolved Fear, the entry's `open` flag kept by N3) on the caller's OWN current journal's pages that are linked to
 * the session. Per viewer, like '🧵 Open threads' (`notesThreads.threads`): the journal is chosen by `ctx.user`
 * (`currentJournal`, CF3), so a player never reads a GM page or another player's page, and the caller always reads
 * every line of their own page (A4). Torn-out pages are left out.
 *
 * | Function | Kind          | Args      | Reads (at the caps)                                                    | Errors            |
 * |----------|---------------|-----------|------------------------------------------------------------------------|-------------------|
 * | `raised` | campaignQuery | sessionId | session, role, journals, pages (<= MAX_PAGES), open entries (<= 500)   | SESSION_NOT_FOUND |
 *
 * Anonymous UNAUTHENTICATED, outsider NOT_FOUND (the wrapper, `need: "view"`), a user with grants only and no campaign
 * role NOT_FOUND (`notesRole`). A session id that is not this campaign's is SESSION_NOT_FOUND; so is a planned session
 * for anyone short of `owner` (`ctx.permission` from permissionFor; players never see planned sessions, D10 Q4), with
 * the same code so nothing leaks. Without a journal the list is empty.
 */

export const raisedThreadValidator = v.object({
  entryId: v.id("journalEntries"),
  pageId: v.id("journalPages"),
  pageTitle: v.string(),
  kind: entryKindValidator,
  /** The bullet glyph needs it (an open task vs an unresolved Fear). */
  state: entryStateValidator,
  /** Plain text with D7 mention tokens (EntryText renders them). */
  text: v.string(),
});
export type RaisedThread = Infer<typeof raisedThreadValidator>;

/**
 * The open threads on the caller's pages linked to the session, in page order (created), then entry order. Bounded:
 * the journal's pages that are not torn out (MAX_PAGES) and its open entries by `by_journal_open` (MAX_THREADS, the
 * same cap as the Notes threads view), kept when their page is one of the linked ones.
 */
export const raised = campaignQuery({
  need: "view",
  enough: "owner",
  args: { sessionId: v.string() },
  returns: v.array(raisedThreadValidator),
  handler: async (ctx, { sessionId }): Promise<RaisedThread[]> => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    if (ctx.permission !== "owner" && session.status === "planned") throw appError("SESSION_NOT_FOUND");
    const { journal } = await currentJournal(ctx);
    if (journal === null) return [];

    const pages = await ctx.db
      .query("journalPages")
      .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id).eq("binnedAt", undefined))
      .take(MAX_PAGES);
    const linked = new Map<Id<"journalPages">, Doc<"journalPages">>();
    for (const page of pages) if (page.sessionId === session._id && page.openCount > 0) linked.set(page._id, page);
    if (linked.size === 0) return [];

    const open = await ctx.db
      .query("journalEntries")
      .withIndex("by_journal_open", (q) => q.eq("journalId", journal._id).eq("open", true))
      .take(MAX_THREADS);
    const rows: { row: RaisedThread; pageCreated: number; order: number }[] = [];
    for (const entry of open) {
      const page = linked.get(entry.pageId);
      if (page === undefined) continue;
      rows.push({
        row: { entryId: entry._id, pageId: page._id, pageTitle: page.title, kind: entry.kind, state: entry.state, text: entry.text },
        pageCreated: page._creationTime,
        order: entry.order,
      });
    }
    rows.sort((a, b) => a.pageCreated - b.pageCreated || a.order - b.order);
    return rows.map(({ row }) => row);
  },
});
