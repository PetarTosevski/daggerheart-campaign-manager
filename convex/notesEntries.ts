import { v, type Infer } from "convex/values";

import { authorLabel, isAddedEntry } from "../src/lib/domain/notes/authors";
import { nextState } from "../src/lib/domain/notes/bullets";
import { newPageTape } from "../src/lib/domain/notes/defaults";
import { isValidEntryText } from "../src/lib/domain/notes/limits";
import { mentionIds, withinMentionLimit } from "../src/lib/domain/notes/mentions";
import { migrationTarget, openTasks, planMigration } from "../src/lib/domain/notes/migrate";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import { readSheet } from "./lib/characterSheet";
import { storedEntry } from "./lib/codex";
import { campaignMutation, campaignQuery } from "./lib/functions";
import {
  assertAction,
  bumpCounts,
  currentJournal,
  entryAccess,
  findPage,
  insertPage,
  notesRole,
  resolvePage,
  type NotesCtx,
  type NotesMutationCtx,
  type PageAccess,
} from "./lib/notes";
import { atLeast, permissionFor } from "./lib/permissions";
import {
  defaultVisibility,
  entryKindValidator,
  entryStateValidator,
  isOpenThread,
  journalTemplate,
  MAX_JOURNAL_ENTRIES,
  MAX_PAGE_ENTRIES,
  MAX_PAGES,
  pageKindValidator,
  pageRefValidator,
} from "./lib/validators/notes";

/**
 * Entries of a journal page (D11 N3, plan `.omc/plans/d11-notes.yaml`; board rules B4, B6; Q3, Q7, D2, D5, D7). The
 * page owner writes and manages entries; anyone who can read the page adds entries, shown in the added colour with
 * ' - <author>' (Q3). Every access decision goes through `pageAccess` / `entryAccess` / `assertAction`
 * (convex/lib/notes.ts, permissionFor on the 'journalPage' resource, CF2); the caller is `ctx.user` (CF3, CF4). Each
 * write is one intent (page ref + one field, entry id + one field, CL3); the server computes next states with the N1
 * domain and keeps the page and journal counters in the same mutation. Hope / Fear entries are labels only (Q7): nothing
 * here reads or writes party Hope or GM Fear.
 *
 * | Function      | Who (journal not departed, D2)                                                  | Errors                         |
 * |---------------|---------------------------------------------------------------------------------|--------------------------------|
 * | `entries`     | any reader of the page                                                          | NOTE_PAGE_NOT_FOUND            |
 * | `add`         | any reader (Q3)                                                                 | NOTE_PAGE_FULL / _JOURNAL_FULL, NOTE_MENTION_INVALID, INVALID |
 * | `setText`     | the entry's author (D5)                                                         | NOTE_FORBIDDEN_ACTION          |
 * | `cycle`       | the page owner or the entry's author (D5)                                       | NOTE_FORBIDDEN_ACTION          |
 * | `toggleStar`  | the page owner (D5)                                                             | NOTE_FORBIDDEN_ACTION          |
 * | `moveUp`      | the page owner (D5)                                                             | NOTE_FORBIDDEN_ACTION          |
 * | `remove`      | the entry's author or the page owner (Q3)                                       | NOTE_FORBIDDEN_ACTION          |
 * | `migrateOpen` | the page owner (B6)                                                             | NOTE_NOTHING_TO_MIGRATE        |
 *
 * Common to all: anonymous UNAUTHENTICATED, outsider NOT_FOUND (the wrapper), a page the caller cannot read
 * NOTE_PAGE_NOT_FOUND / an entry on one NOTE_ENTRY_NOT_FOUND, a departed journal NOTE_JOURNAL_CLOSED.
 */

// ---------------------------------------------------------------- shapes

/** One row of `entries`: the entry, its author label (Q3), whether it was added by a reader, and the caller's flags. */
export const entryRowValidator = v.object({
  _id: v.id("journalEntries"),
  kind: entryKindValidator,
  state: entryStateValidator,
  star: v.boolean(),
  /** Plain text with D7 mention tokens; the mentions slot renders them for the viewer. */
  text: v.string(),
  order: v.number(),
  /** An open thread (B5). */
  open: v.boolean(),
  /** The author is not the page owner: shown in the added colour, ending ' - <authorLabel>' (Q3). */
  added: v.boolean(),
  /** 'GM', the author's character name, their account name, or 'Player' (N1 authorLabel). */
  authorLabel: v.string(),
  canEdit: v.boolean(),
  canCycle: v.boolean(),
  canDelete: v.boolean(),
  canStar: v.boolean(),
  canMove: v.boolean(),
});
export type EntryRow = Infer<typeof entryRowValidator>;

/** `entries`: the page's kind, the caller's page flags and its entries in order. */
export const pageEntriesValidator = v.object({
  kind: pageKindValidator,
  /** The caller may add an entry (Q3, D2). */
  canAdd: v.boolean(),
  /** The caller may migrate, star and move (the owner of a present journal). */
  canArrange: v.boolean(),
  /** The page Migrate would copy to (B6); null for a new page. Only for the owner, else null. */
  migrateTarget: v.union(v.object({ title: v.string() }), v.null()),
  entries: v.array(entryRowValidator),
});
export type PageEntries = Infer<typeof pageEntriesValidator>;

// ---------------------------------------------------------------- helpers

/**
 * The character's name from its sheet. A sheet that does not read gives its stored `name` string when it has one (as
 * the party list's placeholder does, convex/characters.ts), else null (the label falls back, Q3).
 */
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

/** Author labels for the distinct authors of a page's entries (a handful): 'GM', character, account name (Q3). */
async function authorLabels(ctx: NotesCtx, rows: readonly Doc<"journalEntries">[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.authorId}|${row.authorCharacterId ?? ""}`;
    if (labels.has(key)) continue;
    const isGm = row.authorId === ctx.campaign.ownerId;
    const character = isGm || row.authorCharacterId === undefined ? null : await ctx.db.get("characters", row.authorCharacterId);
    const user = isGm ? null : await ctx.db.get("users", row.authorId);
    labels.set(key, authorLabel({ isGm, characterName: characterName(character), accountName: user?.name ?? null }));
  }
  return labels;
}

/** The page's entries in order (B4), at most MAX_PAGE_ENTRIES. */
function pageRows(ctx: NotesCtx, pageId: Id<"journalPages">) {
  return ctx.db
    .query("journalEntries")
    .withIndex("by_page_order", (q) => q.eq("pageId", pageId))
    .take(MAX_PAGE_ENTRIES);
}

/** The journal's pages that are not torn out (the index's pages), at most MAX_PAGES. */
function livePages(ctx: NotesCtx, journalId: Id<"journals">) {
  return ctx.db
    .query("journalPages")
    .withIndex("by_journal_binned", (q) => q.eq("journalId", journalId).eq("binnedAt", undefined))
    .take(MAX_PAGES);
}

const asMigratable = (p: Doc<"journalPages">) => ({ ...p, id: p._id });

/**
 * Checks an entry's text (1-500 characters, INVALID) and its mention tokens (D7): at most MAX_MENTIONS, each a Codex
 * entry of this campaign the caller can see (the GM: any; a player: one the party knows), else NOTE_MENTION_INVALID.
 * Returns the trimmed text.
 */
async function checkedText(ctx: NotesCtx, raw: string): Promise<string> {
  const text = raw.trim();
  if (!isValidEntryText(text)) throw appError("INVALID", "Write 1 to 500 characters.");
  if (!withinMentionLimit(text)) throw appError("NOTE_MENTION_INVALID");
  for (const id of mentionIds(text)) {
    const entryId = ctx.db.normalizeId("codexEntries", id);
    const entry = entryId === null ? null : await ctx.db.get("codexEntries", entryId);
    if (entry === null || entry.campaignId !== ctx.campaign._id) throw appError("NOTE_MENTION_INVALID");
    const permission = await permissionFor(ctx, ctx.user, { type: "codexEntry", campaign: ctx.campaign, entry }, "edit");
    if (atLeast(permission, "edit")) continue;
    if (permission === null || !visibleToPlayers(entry)) throw appError("NOTE_MENTION_INVALID");
  }
  return text;
}

/** A Codex entry the party knows (what `codex.list` shows players). An unreadable entry counts as unknown. */
function visibleToPlayers(entry: Doc<"codexEntries">): boolean {
  try {
    return storedEntry(entry.data).summary.known;
  } catch {
    return false;
  }
}

/** NOTE_PAGE_FULL / NOTE_JOURNAL_FULL before adding `n` entries (Q10), from the counters (CD14). */
async function assertRoom(ctx: NotesCtx, page: Doc<"journalPages">, n: number): Promise<void> {
  if (page.entryCount + n > MAX_PAGE_ENTRIES) throw appError("NOTE_PAGE_FULL");
  const journal = await ctx.db.get("journals", page.journalId);
  if (journal !== null && journal.entryCount + n > MAX_JOURNAL_ENTRIES) throw appError("NOTE_JOURNAL_FULL");
}

/** The order after the page's last entry. */
async function nextOrder(ctx: NotesCtx, pageId: Id<"journalPages">): Promise<number> {
  const last = await ctx.db
    .query("journalEntries")
    .withIndex("by_page_order", (q) => q.eq("pageId", pageId))
    .order("desc")
    .first();
  return last === null ? 0 : last.order + 1;
}

/** Re-reads the page (its counters may have moved earlier in this mutation). */
async function freshPage(ctx: NotesMutationCtx, pageId: Id<"journalPages">): Promise<Doc<"journalPages">> {
  const page = await ctx.db.get("journalPages", pageId);
  if (page === null) throw appError("NOTE_PAGE_NOT_FOUND");
  return page;
}

// ---------------------------------------------------------------- query

/**
 * A readable page's entries in order with their author labels and the caller's per-entry and per-page flags (Q3,
 * D5). A template ref before the caller's journal exists answers an empty page they may write on (CL6). A page the
 * caller cannot read: NOTE_PAGE_NOT_FOUND.
 */
export const entries = campaignQuery({
  need: "view",
  args: { page: pageRefValidator },
  returns: pageEntriesValidator,
  handler: async (ctx, { page: ref }): Promise<PageEntries> => {
    const access = await findPage(ctx, ref);
    if (access === null) {
      const role = await notesRole(ctx);
      const template = typeof ref === "string" ? undefined : journalTemplate(role === "gm")[ref.template];
      if (template === undefined) throw appError("NOTE_PAGE_NOT_FOUND");
      return { kind: template.kind, canAdd: true, canArrange: true, migrateTarget: null, entries: [] };
    }
    const rows = await pageRows(ctx, access.page._id);
    const labels = await authorLabels(ctx, rows);
    let migrateTarget: { title: string } | null = null;
    if (access.canEditPage && openTasks(rows).length > 0) {
      const target = migrationTarget(asMigratable(access.page), (await livePages(ctx, access.journal._id)).map(asMigratable));
      migrateTarget = target === null ? null : { title: target.title };
    }
    return {
      kind: access.page.kind,
      canAdd: access.canAdd,
      canArrange: access.canEditPage,
      migrateTarget,
      entries: rows.map((row) => ({
        _id: row._id,
        kind: row.kind,
        state: row.state,
        star: row.star,
        text: row.text,
        order: row.order,
        open: row.open,
        added: isAddedEntry(row, access.page),
        authorLabel: labels.get(`${row.authorId}|${row.authorCharacterId ?? ""}`) ?? "Player",
        canEdit: access.canEditEntry(row),
        canCycle: access.canCycle(row),
        canDelete: access.canDeleteEntry(row),
        canStar: access.canEditPage,
        canMove: access.canEditPage,
      })),
    };
  },
});

// ---------------------------------------------------------------- writes

/**
 * Adds an entry at the end of a page (B4). Any reader may add (Q3); the author is `ctx.user` and, for a player, their
 * current journal's character (so the label reads their character's name). Quick keys are parsed by the client (N1
 * parseQuickKey); the kind arrives here. A template ref creates the caller's journal first (CL6).
 */
export const add = campaignMutation({
  need: "view",
  args: { page: pageRefValidator, kind: entryKindValidator, text: v.string() },
  returns: v.object({ entryId: v.id("journalEntries"), pageId: v.id("journalPages") }),
  handler: async (ctx, { page: ref, kind, text: raw }) => {
    const access = await resolvePage(ctx, ref);
    assertAction(access, "add");
    const text = await checkedText(ctx, raw);
    await assertRoom(ctx, access.page, 1);
    const { character } = await currentJournal(ctx);
    const now = Date.now();
    const state = "open" as const;
    const open = isOpenThread({ kind, state });
    const entryId = await ctx.db.insert("journalEntries", {
      campaignId: ctx.campaign._id,
      journalId: access.journal._id,
      pageId: access.page._id,
      authorId: ctx.user._id,
      ...(access.isGm || character === null ? {} : { authorCharacterId: character._id }),
      kind,
      state,
      star: false,
      text,
      order: await nextOrder(ctx, access.page._id),
      open,
      createdAt: now,
      updatedAt: now,
    });
    await bumpCounts(ctx, access.page, { entries: 1, open: open ? 1 : 0 });
    return { entryId, pageId: access.page._id };
  },
});

/** The entry's author edits its text (D5); the page owner cannot edit an added entry (Q3). */
export const setText = campaignMutation({
  need: "view",
  args: { entryId: v.id("journalEntries"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { entryId, text: raw }) => {
    const { entry, access } = await entryAccess(ctx, entryId);
    assertAction(access, "editEntry", entry);
    const text = await checkedText(ctx, raw);
    if (text !== entry.text) await ctx.db.patch("journalEntries", entry._id, { text, updatedAt: Date.now() });
    return null;
  },
});

/** One click on the bullet (B4): the page owner or the author advances the state with N1 nextState (D5). */
export const cycle = campaignMutation({
  need: "view",
  args: { entryId: v.id("journalEntries") },
  returns: v.object({ state: entryStateValidator }),
  handler: async (ctx, { entryId }) => {
    const { entry, access } = await entryAccess(ctx, entryId);
    assertAction(access, "cycle", entry);
    const state = nextState(entry.kind, entry.state);
    const open = isOpenThread({ kind: entry.kind, state });
    await ctx.db.patch("journalEntries", entry._id, { state, open, updatedAt: Date.now() });
    if (open !== entry.open) await bumpCounts(ctx, access.page, { open: open ? 1 : -1 });
    return { state };
  },
});

/** ★ priority on or off: the page owner only (D5). */
export const toggleStar = campaignMutation({
  need: "view",
  args: { entryId: v.id("journalEntries") },
  returns: v.object({ star: v.boolean() }),
  handler: async (ctx, { entryId }) => {
    const { entry, access } = await entryAccess(ctx, entryId);
    assertAction(access, "editPage");
    const star = !entry.star;
    await ctx.db.patch("journalEntries", entry._id, { star, updatedAt: Date.now() });
    return { star };
  },
});

/** ↑ swaps the entry with the one above it: the page owner only (D5). The first entry stays put. */
export const moveUp = campaignMutation({
  need: "view",
  args: { entryId: v.id("journalEntries") },
  returns: v.null(),
  handler: async (ctx, { entryId }) => {
    const { entry, access } = await entryAccess(ctx, entryId);
    assertAction(access, "editPage");
    const above = await ctx.db
      .query("journalEntries")
      .withIndex("by_page_order", (q) => q.eq("pageId", entry.pageId).lt("order", entry.order))
      .order("desc")
      .first();
    if (above === null) return null;
    const now = Date.now();
    await ctx.db.patch("journalEntries", entry._id, { order: above.order, updatedAt: now });
    await ctx.db.patch("journalEntries", above._id, { order: entry.order, updatedAt: now });
    return null;
  },
});

/** × deletes the entry (no confirm, B4): its author or the page owner (Q3). */
export const remove = campaignMutation({
  need: "view",
  args: { entryId: v.id("journalEntries") },
  returns: v.null(),
  handler: async (ctx, { entryId }) => {
    const { entry, access } = await entryAccess(ctx, entryId);
    assertAction(access, "deleteEntry", entry);
    await ctx.db.delete("journalEntries", entry._id);
    await bumpCounts(ctx, access.page, { entries: -1, open: entry.open ? -1 : 0 });
    return null;
  },
});

/**
 * '➜ Migrate open tasks' (B6): the page owner copies the page's open tasks to the first later page of the same kind,
 * or to a new page (default visibility, no session link, D6), as new open entries that keep their author and star
 * (D5), and marks the originals migrated. Returns the target page, which the client opens.
 */
export const migrateOpen = campaignMutation({
  need: "view",
  args: { page: pageRefValidator },
  returns: v.object({ pageId: v.id("journalPages"), created: v.boolean() }),
  handler: async (ctx, { page: ref }) => {
    const access: PageAccess = await resolvePage(ctx, ref);
    assertAction(access, "editPage");
    const source = access.page;
    const rows = await pageRows(ctx, source._id);
    const pages = (await livePages(ctx, access.journal._id)).map(asMigratable);
    const plan = planMigration(asMigratable(source), pages, rows);
    if (plan === null) throw appError("NOTE_NOTHING_TO_MIGRATE");

    let targetId: Id<"journalPages">;
    if (plan.target !== null) {
      targetId = plan.target._id;
    } else {
      const journal = await ctx.db.get("journals", access.journal._id);
      if (journal === null) throw appError("NOTE_PAGE_NOT_FOUND");
      targetId = await insertPage(ctx, journal, {
        kind: plan.newPage!.kind,
        title: plan.newPage!.title,
        tape: newPageTape(pages),
        visibility: defaultVisibility(access.isGm),
      });
    }
    const target = await freshPage(ctx, targetId);
    await assertRoom(ctx, target, plan.copies.length);

    const now = Date.now();
    let order = await nextOrder(ctx, targetId);
    for (const copy of plan.copies) {
      await ctx.db.insert("journalEntries", {
        campaignId: ctx.campaign._id,
        journalId: target.journalId,
        pageId: targetId,
        authorId: copy.authorId,
        ...(copy.authorCharacterId === undefined ? {} : { authorCharacterId: copy.authorCharacterId }),
        kind: copy.kind,
        state: "open",
        star: copy.star,
        text: copy.text,
        order: order++,
        open: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const original of plan.migrate) {
      await ctx.db.patch("journalEntries", original._id, { state: "migrated", open: false, updatedAt: now });
    }
    const n = plan.copies.length;
    await bumpCounts(ctx, target, { entries: n, open: n });
    await bumpCounts(ctx, await freshPage(ctx, source._id), { open: -n });
    return { pageId: targetId, created: plan.target === null };
  },
});
