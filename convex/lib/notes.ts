import { entryActions, pageActions } from "../../src/lib/domain/notes/actions";
import { newPageTape, sessionLogTitle } from "../../src/lib/domain/notes/defaults";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { departed } from "./journalState";
import { cachedDeparted, cachedJournal, cachedRole, campaignRole, permissionFor, type PageReadCache, type Role } from "./permissions";
import {
  defaultVisibility,
  journalTemplate,
  MAX_PAGES,
  type PageKind,
  type PageRef,
  type PageVisibility,
} from "./validators/notes";

/**
 * The Notes helpers every D11 function goes through (N0, plan `.omc/plans/d11-notes.yaml`). Page access is decided
 * only here, by `pageAccess`, which asks `permissionFor` (resource `journalPage`, CF2) and adds departure (D1) and the
 * action table of `.omc/autopilot/d11-analysis.md` 3.2. Handlers pass the wrapper's ctx (`campaignQuery` /
 * `campaignMutation` with `need: "view"`); the caller is always `ctx.user` (CF3, CF4).
 *
 * | Helper            | Does                                                                                       |
 * |-------------------|--------------------------------------------------------------------------------------------|
 * | `notesRole`       | The caller's campaign role ('gm' / 'player'); a user with grants only gets NOT_FOUND       |
 * | `currentJournal`  | The caller's current journal (D3) or null before the first write, with its character       |
 * | `ensureJournal`   | The current journal, creating it with its default pages (B7) or attaching it (D3)          |
 * | `defaultSessionId`| The live session, else the newest one the caller can see (D6)                              |
 * | `pageAccess`      | A page the caller can read + permission, departed, binned and the action flags             |
 * | `assertAction`    | Throws the right code when an action flag is false                                         |
 * | `entryAccess`     | An entry on a readable page, with its page's access                                        |
 * | `findPage`        | A page ref in a query: access, or null for a template ref before the journal exists        |
 * | `resolvePage`     | A page ref in a mutation: creates the journal for a template ref                           |
 * | `insertPage`      | A new page (NOTE_PAGE_LIMIT, bin included)                                                 |
 * | `addSessionPages` | A 'Session N' page linked to a session that goes live, in every present journal (.111)    |
 * | `deletePageRows`  | Deletes up to n of a page's entries and recipients                                         |
 * | `bumpCounts` / `bumpJournal` | Keeps the page and journal counters in step                                     |
 */

/** The wrapper ctx the helpers need. */
export type NotesCtx = QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> };
export type NotesMutationCtx = MutationCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> };

// ---------------------------------------------------------------- role and current journal

/**
 * The caller's role in the campaign (`campaignRole`, the role half of `permissionFor`). Journals belong to the GM and
 * the players; someone who reaches the campaign only through a grant has no journal and reads no page: NOT_FOUND.
 */
export async function notesRole(ctx: NotesCtx): Promise<Role> {
  const role = await campaignRole(ctx, ctx.user, ctx.campaign);
  if (role === null) throw appError("NOT_FOUND");
  return role;
}

/** Characters a player's journal list considers: theirs, in this campaign, not dead or retired (D1). */
async function liveCharacters(ctx: NotesCtx): Promise<Doc<"characters">[]> {
  // A user's characters across campaigns are a handful; the campaign filter runs on that bounded result.
  const mine = await ctx.db
    .query("characters")
    .withIndex("by_owner", (q) => q.eq("ownerId", ctx.user._id))
    .take(200);
  return mine
    .filter((c) => c.campaignId === ctx.campaign._id && c.status !== "dead" && c.status !== "retired")
    .sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime);
}

export type CurrentJournal = {
  role: Role;
  /** Null before the caller's first write in this campaign's notes (the client shows the templates). */
  journal: Doc<"journals"> | null;
  /** The character the journal belongs to or will belong to (header name and class, Q8); null for the GM or none. */
  character: Doc<"characters"> | null;
  /** D3: the character id the next write stores on the journal (an unattached or not yet created one), else null. */
  attach: Id<"characters"> | null;
};

/**
 * The caller's current journal (D3). The GM: their account journal. A player: the journal of their active character
 * (the newest active one), else of their newest character that is not departed; when that character has no journal
 * yet, the unattached journal (which belongs to the earliest live character without a journal), else none (the first
 * write creates one for that character, or an unattached one when the player has no character). A dead or retired
 * character's journal is never current: it is a past journal (N8). Reads: the role, the user's characters (bounded)
 * and the user's journals in the campaign (bounded).
 */
export async function currentJournal(ctx: NotesCtx): Promise<CurrentJournal> {
  const role = await notesRole(ctx);
  const journals = await ctx.db
    .query("journals")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", ctx.user._id))
    .take(100);
  if (role === "gm") return { role, journal: journals[0] ?? null, character: null, attach: null };

  const characters = await liveCharacters(ctx);
  const byCharacter = new Map<Id<"characters">, Doc<"journals">>();
  for (const journal of journals) if (journal.characterId !== undefined) byCharacter.set(journal.characterId, journal);
  const active = characters.filter((c) => c.status === "active");
  const target = active[active.length - 1] ?? characters[characters.length - 1] ?? null;
  const own = target && byCharacter.get(target._id);
  if (target && own) return { role, journal: own, character: target, attach: null };

  const unattached = journals.find((j) => j.characterId === undefined) ?? null;
  if (unattached) {
    const attachTo = characters.find((c) => !byCharacter.has(c._id)) ?? null;
    return { role, journal: unattached, character: attachTo, attach: attachTo?._id ?? null };
  }
  return { role, journal: null, character: target, attach: target?._id ?? null };
}

/**
 * The live session, else the newest session the caller can see: any for the GM, a played one for a player (D10 Q4).
 * N2's session picker preselects it; the default 'Session 1' page links to it (D6).
 */
export async function defaultSessionId(ctx: NotesCtx, isGm: boolean): Promise<Id<"sessions"> | undefined> {
  const live = await ctx.db
    .query("sessions")
    .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", ctx.campaign._id).eq("status", "live"))
    .first();
  if (live) return live._id;
  const newest = isGm
    ? await ctx.db
        .query("sessions")
        .withIndex("by_campaign_n", (q) => q.eq("campaignId", ctx.campaign._id))
        .order("desc")
        .first()
    : await ctx.db
        .query("sessions")
        .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", ctx.campaign._id).eq("status", "played"))
        .order("desc")
        .first();
  return newest?._id;
}

/**
 * The caller's current journal for a write: attaches an unattached one to its character (D3), or creates the journal
 * with its default pages (B7, from `journalTemplate`): the GM's template with 'private', a player's with 'gm' (A4);
 * 'Session 1' links to `defaultSessionId` (D6). `defaultPageIds` lists the default pages when it created them.
 */
export async function ensureJournal(
  ctx: NotesMutationCtx,
): Promise<{ journal: Doc<"journals">; role: Role; created: boolean; defaultPageIds: Id<"journalPages">[] }> {
  const current = await currentJournal(ctx);
  const { role } = current;
  if (current.journal) {
    if (current.attach !== null && current.journal.characterId === undefined) {
      await ctx.db.patch("journals", current.journal._id, { characterId: current.attach, updatedAt: Date.now() });
      return { journal: { ...current.journal, characterId: current.attach }, role, created: false, defaultPageIds: [] };
    }
    return { journal: current.journal, role, created: false, defaultPageIds: [] };
  }
  const isGm = role === "gm";
  const now = Date.now();
  const template = journalTemplate(isGm);
  const journalId = await ctx.db.insert("journals", {
    campaignId: ctx.campaign._id,
    userId: ctx.user._id,
    ...(current.attach !== null ? { characterId: current.attach } : {}),
    pageCount: template.length,
    entryCount: 0,
    openCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const sessionId = await defaultSessionId(ctx, isGm);
  const defaultPageIds: Id<"journalPages">[] = [];
  for (const page of template) {
    defaultPageIds.push(
      await ctx.db.insert("journalPages", {
        campaignId: ctx.campaign._id,
        journalId,
        ownerId: ctx.user._id,
        kind: page.kind,
        title: page.title,
        tape: page.tape,
        visibility: defaultVisibility(isGm),
        ...(page.kind === "log" && sessionId !== undefined ? { sessionId } : {}),
        entryCount: 0,
        openCount: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  const journal = await ctx.db.get("journals", journalId);
  if (journal === null) throw new Error("A journal inserted in this mutation is missing.");
  return { journal, role, created: true, defaultPageIds };
}

// ---------------------------------------------------------------- page access and the action table

/** The actions of the analysis 3.2 table, each checked by `assertAction`. */
export type PageAction = "editPage" | "add" | "editEntry" | "cycle" | "deleteEntry" | "bin" | "restore";

/** What the caller may do with a page they can read. Entry flags take the entry (its author decides, Q3, D5). */
export type PageAccess = {
  page: Doc<"journalPages">;
  journal: Doc<"journals">;
  /** `owner` for the page owner, `view` for any other reader (permissionFor). */
  permission: "owner" | "view";
  isOwner: boolean;
  /** The caller is the campaign's GM. */
  isGm: boolean;
  /** D1, computed now. A departed journal is frozen (D2). */
  departed: boolean;
  /** Torn out (Q11): only its owner, or the GM who tore it out, gets here. */
  binned: boolean;
  /** Title, tape, visibility, recipients, session link, migrate, star, order: the owner of a present journal. */
  canEditPage: boolean;
  /** Add an entry: any reader of a page that is present and not torn out (Q3, D2). */
  canAdd: boolean;
  /** Tear out: the owner of a present journal; the GM for a non-private page of a departed journal (Q12, D2). */
  canBin: boolean;
  /**
   * Restore from the bin: whoever tore it out, while they can still reach it (Q11); also the page's owner, on a present
   * journal, for a page someone else tore out (the GM's tear-out of a departed page after a rejoin, dcm-bxp.81).
   */
  canRestore: boolean;
  /** Edit an entry's text: its author (D5). */
  canEditEntry: (entry: Pick<Doc<"journalEntries">, "authorId">) => boolean;
  /** Cycle a bullet: the page owner or the entry's author (D5). */
  canCycle: (entry: Pick<Doc<"journalEntries">, "authorId">) => boolean;
  /** Delete an entry: its author or the page owner (Q3). */
  canDeleteEntry: (entry: Pick<Doc<"journalEntries">, "authorId">) => boolean;
};

/**
 * A page the caller can read, with what they may do (analysis 3.2). A missing page, one of another campaign, or one
 * `permissionFor` refuses answers NOTE_PAGE_NOT_FOUND, the same for all three (a page you cannot read does not exist).
 *
 * A list query that checks many pages passes the page documents it already read and one `pageReadCache` (PF10), so
 * the journal, the caller's role and the departure are read once per list, not once per page. Mutations pass an id
 * and no cache.
 */
export async function pageAccess(ctx: NotesCtx, pageRef: Id<"journalPages"> | Doc<"journalPages">, cache?: PageReadCache): Promise<PageAccess> {
  const page = typeof pageRef === "string" ? await ctx.db.get("journalPages", pageRef) : pageRef;
  if (page === null || page.campaignId !== ctx.campaign._id) throw appError("NOTE_PAGE_NOT_FOUND");
  const journal = await cachedJournal(ctx, page.journalId, cache);
  if (journal === null) throw appError("NOTE_PAGE_NOT_FOUND");
  const permission = await permissionFor(ctx, ctx.user, { type: "journalPage", campaign: ctx.campaign, journal, page, cache });
  if (permission === null) throw appError("NOTE_PAGE_NOT_FOUND");
  const isOwner = permission === "owner";
  const role = await cachedRole(ctx, ctx.user, ctx.campaign, cache);
  const isGm = role === "gm";
  const isDeparted = await cachedDeparted(ctx, ctx.campaign, journal, cache);
  const binned = page.binnedAt !== undefined;
  // permissionFor answered, so the caller reads the page by the visibility table (for a torn-out page: the owner, or
  // the binner who would still read it, N1 canRestore). N1's action table decides the rest.
  const flags = pageActions({
    isOwner,
    canRead: true,
    departed: isDeparted,
    viewerIsGm: isGm,
    visibility: page.visibility,
    binned,
    isBinner: page.binnedBy === ctx.user._id,
  });
  const entryFlags = (entry: Pick<Doc<"journalEntries">, "authorId">) =>
    entryActions({ isOwner, isAuthor: entry.authorId === ctx.user._id, canRead: !binned, departed: isDeparted });
  return {
    page,
    journal,
    permission: isOwner ? "owner" : "view",
    isOwner,
    isGm,
    departed: isDeparted,
    binned,
    canEditPage: flags.canEditPage,
    canAdd: flags.canAdd,
    canBin: flags.canBin,
    // dcm-bxp.81: after a rejoin (or the character going back to 'active') the GM who tore a departed page out can no
    // longer read it, so its owner restores it. Not while the journal is still departed: it stays frozen (D2) and the
    // GM's tear-out stands, restorable by the GM.
    canRestore: flags.canRestore || (binned && isOwner && !isDeparted),
    canEditEntry: (entry) => entryFlags(entry).canEditEntry,
    canCycle: (entry) => entryFlags(entry).canCycle,
    canDeleteEntry: (entry) => entryFlags(entry).canDeleteEntry,
  };
}

/** Whether the action is allowed (entry actions need the entry). */
export function can(access: PageAccess, action: PageAction, entry?: Pick<Doc<"journalEntries">, "authorId">): boolean {
  switch (action) {
    case "editPage":
      return access.canEditPage;
    case "add":
      return access.canAdd;
    case "bin":
      return access.canBin;
    case "restore":
      return access.canRestore;
    case "editEntry":
      return entry !== undefined && access.canEditEntry(entry);
    case "cycle":
      return entry !== undefined && access.canCycle(entry);
    case "deleteEntry":
      return entry !== undefined && access.canDeleteEntry(entry);
  }
}

/**
 * Throws unless the action is allowed: NOTE_NOT_BINNED for a restore the caller cannot make, NOTE_JOURNAL_CLOSED for
 * a write on a departed journal (D2; the GM's tear-out of a departed page is the one write it allows), otherwise
 * NOTE_FORBIDDEN_ACTION (a reader trying an owner's or author's action, or a write on a torn-out page).
 */
export function assertAction(access: PageAccess, action: PageAction, entry?: Pick<Doc<"journalEntries">, "authorId">): void {
  if (can(access, action, entry)) return;
  if (action === "restore") throw appError("NOTE_NOT_BINNED");
  if (access.departed && !access.binned && (action !== "bin" || access.isOwner)) throw appError("NOTE_JOURNAL_CLOSED");
  throw appError("NOTE_FORBIDDEN_ACTION");
}

/** An entry on a page the caller can read, with that page's access; anything else is NOTE_ENTRY_NOT_FOUND. */
export async function entryAccess(
  ctx: NotesCtx,
  entryId: Id<"journalEntries">,
): Promise<{ entry: Doc<"journalEntries">; access: PageAccess }> {
  const entry = await ctx.db.get("journalEntries", entryId);
  if (entry === null || entry.campaignId !== ctx.campaign._id) throw appError("NOTE_ENTRY_NOT_FOUND");
  try {
    return { entry, access: await pageAccess(ctx, entry.pageId) };
  } catch (error) {
    if (isCode(error, "NOTE_PAGE_NOT_FOUND")) throw appError("NOTE_ENTRY_NOT_FOUND");
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  return typeof data === "object" && data !== null && (data as { code?: unknown }).code === code;
}

// ---------------------------------------------------------------- page refs (CL6)

/**
 * The i-th default page of a journal: the i-th page it got, by creation (the default pages are inserted with the
 * journal, before any other). NOTE_PAGE_NOT_FOUND for an index past the template.
 */
async function templatePageId(ctx: NotesCtx, journal: Doc<"journals">, index: number, isGm: boolean): Promise<Id<"journalPages">> {
  if (!Number.isInteger(index) || index < 0 || index >= journalTemplate(isGm).length) throw appError("NOTE_PAGE_NOT_FOUND");
  const pages = await ctx.db
    .query("journalPages")
    .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id))
    .take(MAX_PAGES);
  const page = pages.sort((a, b) => a._creationTime - b._creationTime)[index];
  if (page === undefined) throw appError("NOTE_PAGE_NOT_FOUND");
  return page._id;
}

/**
 * A page ref in a query: the page's access, or null for a template ref while the caller has no journal yet (answer
 * as for an empty default page). A template ref names a default page of the caller's current journal.
 */
export async function findPage(ctx: NotesCtx, ref: PageRef): Promise<PageAccess | null> {
  if (typeof ref === "string") return pageAccess(ctx, ref);
  const { journal, role } = await currentJournal(ctx);
  if (journal === null) return null;
  return pageAccess(ctx, await templatePageId(ctx, journal, ref.template, role === "gm"));
}

/** A page ref in a mutation: a template ref creates (or attaches) the caller's journal first (CL6, D3). */
export async function resolvePage(ctx: NotesMutationCtx, ref: PageRef): Promise<PageAccess> {
  if (typeof ref === "string") return pageAccess(ctx, ref);
  const { journal, role, defaultPageIds } = await ensureJournal(ctx);
  const created = defaultPageIds[ref.template];
  if (created !== undefined && Number.isInteger(ref.template)) return pageAccess(ctx, created);
  return pageAccess(ctx, await templatePageId(ctx, journal, ref.template, role === "gm"));
}

// ---------------------------------------------------------------- writes

/**
 * Inserts a page into a journal: NOTE_PAGE_LIMIT once it holds MAX_PAGES, torn-out pages included (Q10). Counts with
 * the journal's counter plus a bounded range of its torn-out pages. Bumps `pageCount`.
 */
export async function insertPage(
  ctx: MutationCtx,
  journal: Doc<"journals">,
  fields: { kind: PageKind; title: string; tape: number; visibility: PageVisibility; sessionId?: Id<"sessions"> },
): Promise<Id<"journalPages">> {
  const binned = await ctx.db
    .query("journalPages")
    .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id).gte("binnedAt", 0))
    .take(MAX_PAGES);
  if (journal.pageCount + binned.length >= MAX_PAGES) throw appError("NOTE_PAGE_LIMIT");
  const now = Date.now();
  const id = await ctx.db.insert("journalPages", {
    campaignId: journal.campaignId,
    journalId: journal._id,
    ownerId: journal.userId,
    ...fields,
    entryCount: 0,
    openCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await bumpJournal(ctx, journal._id, { pages: 1 });
  return id;
}

/**
 * dcm-bxp.111 (user answer: every session gets its own 'Session N' page): when a session goes live (`sessions.start`),
 * every journal of the campaign gets a log page 'Session N[: title]' (`sessionLogTitle`) linked to that session, with
 * its owner's default visibility and the next tape. Idempotent: a journal that already has a page linked to the session
 * (torn out included, so a restart never brings a torn-out page back) gets none. Skipped: departed journals (frozen,
 * D2) and full ones (MAX_PAGES, torn-out pages included, Q10). Journals created later get theirs from
 * `ensureJournal` ('Session 1' linked to the live session, D6). Returns how many pages it added.
 */
export async function addSessionPages(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  session: Pick<Doc<"sessions">, "_id" | "n" | "title">,
): Promise<number> {
  const journals = await ctx.db
    .query("journals")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id))
    .take(200);
  let added = 0;
  for (const journal of journals) {
    if (await departed(ctx, campaign, journal)) continue;
    const pages = await ctx.db
      .query("journalPages")
      .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id))
      .take(MAX_PAGES);
    if (pages.length >= MAX_PAGES || pages.some((p) => p.sessionId === session._id)) continue;
    const live = pages.filter((p) => p.binnedAt === undefined);
    await insertPage(ctx, journal, {
      kind: "log",
      title: sessionLogTitle(session),
      tape: newPageTape(live),
      visibility: defaultVisibility(journal.userId === campaign.ownerId),
      sessionId: session._id,
    });
    added += 1;
  }
  return added;
}

/** Adds to a journal's counters (they cover pages that are not torn out). */
export async function bumpJournal(
  ctx: MutationCtx,
  journalId: Id<"journals">,
  delta: { pages?: number; entries?: number; open?: number },
): Promise<void> {
  const journal = await ctx.db.get("journals", journalId);
  if (journal === null) return;
  await ctx.db.patch("journals", journalId, {
    pageCount: Math.max(0, journal.pageCount + (delta.pages ?? 0)),
    entryCount: Math.max(0, journal.entryCount + (delta.entries ?? 0)),
    openCount: Math.max(0, journal.openCount + (delta.open ?? 0)),
    updatedAt: Date.now(),
  });
}

/**
 * Adds to a page's entry and open-thread counters, and to its journal's while the page is not torn out. Call it in
 * the same mutation as the entry write, with the page as read in that mutation.
 */
export async function bumpCounts(ctx: MutationCtx, page: Doc<"journalPages">, delta: { entries?: number; open?: number }): Promise<void> {
  await ctx.db.patch("journalPages", page._id, {
    entryCount: Math.max(0, page.entryCount + (delta.entries ?? 0)),
    openCount: Math.max(0, page.openCount + (delta.open ?? 0)),
    updatedAt: Date.now(),
  });
  if (page.binnedAt === undefined) await bumpJournal(ctx, page.journalId, delta);
}

/**
 * Deletes up to `limit` of a page's rows: its entries, then its recipients. Returns how many it deleted and whether
 * none are left (then the caller may delete the page). Counters are the caller's business (a purged or torn-out page
 * is already out of its journal's counters).
 */
export async function deletePageRows(
  ctx: MutationCtx,
  pageId: Id<"journalPages">,
  limit: number,
): Promise<{ deleted: number; done: boolean }> {
  let deleted = 0;
  const entries = await ctx.db
    .query("journalEntries")
    .withIndex("by_page_order", (q) => q.eq("pageId", pageId))
    .take(limit);
  for (const entry of entries) await ctx.db.delete("journalEntries", entry._id);
  deleted += entries.length;
  if (deleted >= limit) return { deleted, done: false };
  const recipients = await ctx.db
    .query("journalPageRecipients")
    .withIndex("by_page_user", (q) => q.eq("pageId", pageId))
    .take(limit - deleted);
  for (const row of recipients) await ctx.db.delete("journalPageRecipients", row._id);
  deleted += recipients.length;
  return { deleted, done: deleted < limit };
}
