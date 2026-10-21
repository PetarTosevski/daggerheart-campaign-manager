import { v, type Infer } from "convex/values";

import { journalWho } from "../src/lib/domain/notes/authors";
import { newPageTape, newPageTitle, nextTape, sessionLogTitle } from "../src/lib/domain/notes/defaults";
import { isValidTitle, normalizeTitle } from "../src/lib/domain/notes/limits";
import { appError } from "../src/lib/errors/app-error";
import { CLASSES } from "../src/lib/srd/classes";
import type { Doc, Id } from "./_generated/dataModel";
import { readSheet } from "./lib/characterSheet";
import { campaignMutation, campaignQuery } from "./lib/functions";
import {
  assertAction,
  currentJournal,
  defaultSessionId,
  ensureJournal,
  insertPage,
  resolvePage,
  type NotesCtx,
  type NotesMutationCtx,
} from "./lib/notes";
import { sessionStatusValidator } from "./lib/validators/sessions";
import {
  defaultVisibility,
  journalTemplate,
  MAX_PAGES,
  pageKindValidator,
  pageRefValidator,
  pageVisibilityValidator,
} from "./lib/validators/notes";

/**
 * Own journal and pages (D11 N2, plan `.omc/plans/d11-notes.yaml`; board rules B1, B2, B3, B7; Q5, Q8, Q12, D3, D6).
 * The caller's current journal (D3) with its hero name (Q8) and its pages; new pages (session logs linked to a real D10
 * session, Q5), rename, tape and session link. Every write goes through `resolvePage` / `ensureJournal`, so the first
 * write creates the journal with its default pages (CL6); page writes are the owner's (Q3), refused on a departed
 * journal (D2) by `assertAction`. Everyone in the campaign passes the wrapper (`need: "view"`); page access is decided
 * only by `pageAccess` (permissionFor, CF2).
 *
 * | Function     | Kind              | Args                          | Errors                                                  |
 * |--------------|-------------------|-------------------------------|---------------------------------------------------------|
 * | `journal`    | campaignQuery     | -                             | NOT_FOUND (grant only)                                  |
 * | `createPage` | campaignMutation  | kind, sessionId?              | NOTE_SESSION_INVALID, NOTE_PAGE_LIMIT                   |
 * | `renamePage` | campaignMutation  | page ref, title               | NOTE_PAGE_NOT_FOUND, NOTE_FORBIDDEN_ACTION, NOTE_JOURNAL_CLOSED, INVALID |
 * | `cycleTape`  | campaignMutation  | page ref                      | NOTE_PAGE_NOT_FOUND, NOTE_FORBIDDEN_ACTION, NOTE_JOURNAL_CLOSED |
 * | `setSession` | campaignMutation  | page ref, sessionId or null   | as cycleTape, plus NOTE_SESSION_INVALID                 |
 */

// ---------------------------------------------------------------- shapes

/** The linked D10 session as the page meta shows it (D6: its date, live). */
const sessionInfoValidator = v.object({
  n: v.number(),
  title: v.optional(v.string()),
  date: v.optional(v.string()),
  status: sessionStatusValidator,
});

/** One own page in the index (B2) and the page header (B3). `template` = its default-page index (CL6 refs). */
export const journalPageItemValidator = v.object({
  _id: v.id("journalPages"),
  template: v.optional(v.number()),
  kind: pageKindValidator,
  title: v.string(),
  tape: v.number(),
  visibility: pageVisibilityValidator,
  /** Q5: present when the linked session exists and the caller can see it (players: live / played). */
  sessionId: v.optional(v.id("sessions")),
  session: v.optional(sessionInfoValidator),
  createdAt: v.number(),
  entryCount: v.number(),
  openCount: v.number(),
});
export type JournalPageItem = Infer<typeof journalPageItemValidator>;

/** A default page before the journal exists: what the first write will create (B7), with its session link (D6). */
export const journalTemplateItemValidator = v.object({
  template: v.number(),
  kind: pageKindValidator,
  title: v.string(),
  tape: v.number(),
  visibility: pageVisibilityValidator,
  sessionId: v.optional(v.id("sessions")),
  session: v.optional(sessionInfoValidator),
});
export type JournalTemplateItem = Infer<typeof journalTemplateItemValidator>;

const who = { isGm: v.boolean(), whoName: v.string(), whoSub: v.string() };

export const journalViewValidator = v.union(
  v.object({
    ...who,
    journal: v.object({
      _id: v.id("journals"),
      pageCount: v.number(),
      entryCount: v.number(),
      openCount: v.number(),
    }),
    pages: v.array(journalPageItemValidator),
  }),
  v.object({ ...who, journal: v.null(), templates: v.array(journalTemplateItemValidator) }),
);
export type JournalView = Infer<typeof journalViewValidator>;

// ---------------------------------------------------------------- helpers

/** The hero's name and sub line (Q8): the journal's character name and class, else the account name / 'Player'. */
function whoOf(ctx: NotesCtx, isGm: boolean, character: Doc<"characters"> | null) {
  let characterName: string | undefined;
  let className: string | undefined;
  if (character !== null) {
    try {
      const sheet = readSheet(character.sheet);
      characterName = sheet.name;
      className = CLASSES.find((c) => c.id === sheet.classId)?.name;
    } catch (error) {
      // A sheet that does not read (CHARACTER_CORRUPT) falls back to the account name; anything else is a bug.
      if ((error as { data?: { code?: unknown } }).data?.code !== "CHARACTER_CORRUPT") throw error;
    }
  }
  return journalWho({ isGm, characterName, accountName: ctx.user.name, className });
}

function sessionInfo(session: Doc<"sessions">): Infer<typeof sessionInfoValidator> {
  return {
    n: session.n,
    ...(session.title !== undefined ? { title: session.title } : {}),
    ...(session.date !== undefined ? { date: session.date } : {}),
    status: session.status,
  };
}

/** A session the caller may see: in the campaign; any for the GM, live / played for a player (D10 Q4). */
function canSeeSession(ctx: NotesCtx, isGm: boolean, session: Doc<"sessions"> | null): session is Doc<"sessions"> {
  return session !== null && session.campaignId === ctx.campaign._id && (isGm || session.status !== "planned");
}

/** A session id from the client: one the caller may link (Q5, D6), else NOTE_SESSION_INVALID. */
async function linkableSession(ctx: NotesCtx, isGm: boolean, raw: string): Promise<Doc<"sessions">> {
  const id = ctx.db.normalizeId("sessions", raw);
  const session = id === null ? null : await ctx.db.get("sessions", id);
  if (!canSeeSession(ctx, isGm, session)) throw appError("NOTE_SESSION_INVALID");
  return session;
}

/** A journal's pages that are not torn out, in created order (bounded by MAX_PAGES). */
async function listedPages(ctx: NotesCtx, journalId: Id<"journals">): Promise<Doc<"journalPages">[]> {
  return ctx.db
    .query("journalPages")
    .withIndex("by_journal_binned", (q) => q.eq("journalId", journalId).eq("binnedAt", undefined))
    .take(MAX_PAGES);
}

// ---------------------------------------------------------------- query

/**
 * The caller's current journal (D3): hero name and sub line (Q8), counters (B1) and its pages that are not torn out,
 * in created order (B2), each with its linked session when the caller can see it (Q5, D6). Before the first write:
 * `{ journal: null, templates }`, the default pages the first write will create (B7), 'Session 1' with the session it
 * will link (D6).
 */
export const journal = campaignQuery({
  need: "view",
  args: {},
  returns: journalViewValidator,
  handler: async (ctx): Promise<JournalView> => {
    const current = await currentJournal(ctx);
    const isGm = current.role === "gm";
    const heading = { isGm, ...whoOf(ctx, isGm, current.character) };

    if (current.journal === null) {
      const sessionId = await defaultSessionId(ctx, isGm);
      const session = sessionId === undefined ? null : await ctx.db.get("sessions", sessionId);
      return {
        ...heading,
        journal: null,
        templates: journalTemplate(isGm).map((page, template) => ({
          template,
          kind: page.kind,
          title: page.title,
          tape: page.tape,
          visibility: defaultVisibility(isGm),
          ...(page.kind === "log" && session !== null ? { sessionId: session._id, session: sessionInfo(session) } : {}),
        })),
      };
    }

    const journal = current.journal;
    // Every page, torn-out ones too, to number the default pages as `templatePageId` does (the first ones created).
    const all = await ctx.db
      .query("journalPages")
      .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id))
      .take(MAX_PAGES);
    all.sort((a, b) => a._creationTime - b._creationTime);
    const templateCount = journalTemplate(isGm).length;
    const templateOf = new Map(all.slice(0, templateCount).map((page, i) => [page._id, i]));
    const pages = all.filter((page) => page.binnedAt === undefined);

    const sessions = new Map<Id<"sessions">, Doc<"sessions"> | null>();
    for (const page of pages) {
      if (page.sessionId !== undefined && !sessions.has(page.sessionId)) {
        sessions.set(page.sessionId, await ctx.db.get("sessions", page.sessionId));
      }
    }

    return {
      ...heading,
      journal: { _id: journal._id, pageCount: journal.pageCount, entryCount: journal.entryCount, openCount: journal.openCount },
      pages: pages.map((page) => {
        const session = page.sessionId === undefined ? null : (sessions.get(page.sessionId) ?? null);
        const template = templateOf.get(page._id);
        return {
          _id: page._id,
          ...(template !== undefined ? { template } : {}),
          kind: page.kind,
          title: page.title,
          tape: page.tape,
          visibility: page.visibility,
          ...(canSeeSession(ctx, isGm, session) ? { sessionId: session._id, session: sessionInfo(session) } : {}),
          createdAt: page.createdAt,
          entryCount: page.entryCount,
          openCount: page.openCount,
        };
      }),
    };
  },
});

// ---------------------------------------------------------------- writes

/**
 * '＋' in a group (B2, B7): a new page in the caller's current journal (created with its default pages when it does
 * not exist yet). A session log may link a session the caller can see (Q5, D6) and is then titled after it
 * ('Session N' / 'Session N: <title>'); otherwise the board's title ('Session <n>', 'New collection', 'Future log <n>').
 * Tape = page count mod 6, the owner's default visibility (A4). NOTE_SESSION_INVALID for a session the caller cannot
 * link or a session on a page that is not a log; NOTE_PAGE_LIMIT at MAX_PAGES (bin included). Returns the page id.
 */
export const createPage = campaignMutation({
  need: "view",
  args: { kind: pageKindValidator, sessionId: v.optional(v.string()) },
  returns: v.id("journalPages"),
  handler: async (ctx, { kind, sessionId }) => {
    const { journal, role } = await ensureJournal(ctx);
    const isGm = role === "gm";
    if (sessionId !== undefined && kind !== "log") throw appError("NOTE_SESSION_INVALID");
    const session = sessionId === undefined ? null : await linkableSession(ctx, isGm, sessionId);
    const pages = await listedPages(ctx, journal._id);
    return insertPage(ctx, journal, {
      kind,
      title: session !== null ? sessionLogTitle(session) : newPageTitle(kind, pages),
      tape: newPageTape(pages),
      visibility: defaultVisibility(isGm),
      ...(session !== null ? { sessionId: session._id } : {}),
    });
  },
});

/** An own page the caller may edit (title, tape, session link): the owner of a present journal (Q3, D2). */
async function editablePage(ctx: NotesMutationCtx, ref: Infer<typeof pageRefValidator>) {
  const access = await resolvePage(ctx, ref);
  assertAction(access, "editPage");
  return access;
}

/** The page title (B3): 1-80 characters after trimming, else INVALID. Owner only. */
export const renamePage = campaignMutation({
  need: "view",
  args: { page: pageRefValidator, title: v.string() },
  returns: v.null(),
  handler: async (ctx, { page, title }) => {
    const access = await editablePage(ctx, page);
    if (!isValidTitle(title)) throw appError("INVALID", "A page title has 1 to 80 characters.");
    await ctx.db.patch("journalPages", access.page._id, { title: normalizeTitle(title), updatedAt: Date.now() });
    return null;
  },
});

/** '🎀 Tape' (B3): the next of the six washi tapes. Owner only. */
export const cycleTape = campaignMutation({
  need: "view",
  args: { page: pageRefValidator },
  returns: v.null(),
  handler: async (ctx, { page }) => {
    const access = await editablePage(ctx, page);
    await ctx.db.patch("journalPages", access.page._id, { tape: nextTape(access.page.tape), updatedAt: Date.now() });
    return null;
  },
});

/**
 * A session log's linked session (Q5, D6), or null to unlink it. The title stays as it is (D6: set at creation,
 * editable). NOTE_SESSION_INVALID for a page that is not a log or a session the caller cannot link. Owner only.
 */
export const setSession = campaignMutation({
  need: "view",
  args: { page: pageRefValidator, sessionId: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { page, sessionId }) => {
    const access = await editablePage(ctx, page);
    if (access.page.kind !== "log") throw appError("NOTE_SESSION_INVALID");
    const session = sessionId === null ? null : await linkableSession(ctx, access.isGm, sessionId);
    await ctx.db.patch("journalPages", access.page._id, { sessionId: session?._id, updatedAt: Date.now() });
    return null;
  },
});
