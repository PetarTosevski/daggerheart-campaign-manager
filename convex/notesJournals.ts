import { v, type Infer } from "convex/values";

import { journalTitle, journalWho, pastJournalTitle } from "../src/lib/domain/notes/authors";
import { effectiveReaders, visibilityLabel } from "../src/lib/domain/notes/visibility";
import { appError } from "../src/lib/errors/app-error";
import { CLASSES } from "../src/lib/srd/classes";
import type { Doc, Id } from "./_generated/dataModel";
import { readSheet } from "./lib/characterSheet";
import { campaignQuery } from "./lib/functions";
import { notesRole, pageAccess, type NotesCtx, type PageAccess } from "./lib/notes";
import { cachedDeparted, pageReadCache, permissionFor, type PageReadCache } from "./lib/permissions";
import { MAX_PAGES, pageKindValidator } from "./lib/validators/notes";

/**
 * Other people's journals (D11 N8, plan `.omc/plans/d11-notes.yaml`; Q2, Q3, Q8, Q12, D1, D2). The GM opens any
 * current player's journal and reads every page not hidden from the GM (Q2); every member finds the journals of departed
 * characters under Past journals (Q12), whose pages read as 'everyone' except Private ones (permissionFor, D1); the GM
 * tears those out through N7's `notesBin.binPage` (D2). Departure is computed at read time (`departed`, D1), so a rejoin
 * or a status set back to 'active' moves a journal back without a write. Every page passes `permissionFor` (resource
 * `journalPage`, CF2), and the journal view's action flags come from `pageAccess` (convex/lib/notes.ts); nothing here
 * decides visibility a second time.
 *
 * | Function         | Kind          | Args      | Who                                                       | Errors           |
 * |------------------|---------------|-----------|-----------------------------------------------------------|------------------|
 * | `playerJournals` | campaignQuery | -         | the GM: present player journals; a player: []             | NOT_FOUND (grant only) |
 * | `pastJournals`   | campaignQuery | -         | every member: departed journals with a page they can read | NOT_FOUND (grant only) |
 * | `journalView`    | campaignQuery | journalId | the GM: any journal; a player: own and departed journals  | NOT_FOUND (unknown, other campaign, another's present journal for a player, grant only) |
 *
 * Common to all: anonymous UNAUTHENTICATED, outsider and removed players NOT_FOUND (the wrapper, `need: "view"`).
 */

/** A campaign's journals are one or two per member; this bounds the read. */
const JOURNALS_TAKE = 200;

// ---------------------------------------------------------------- shapes

/** One row of 'Players’ journals' (GM only, Q2). */
export const playerJournalRowValidator = v.object({
  journalId: v.id("journals"),
  /** The character's name (Q8), else the account name, else 'Player'. */
  name: v.string(),
  /** 'Player journal · <class>' (Q8). */
  sub: v.string(),
  /** Pages the GM can read (not torn out). */
  pageCount: v.number(),
});
export type PlayerJournalRow = Infer<typeof playerJournalRowValidator>;

/** One row of 'Past journals' (Q12). */
export const pastJournalRowValidator = v.object({
  journalId: v.id("journals"),
  /** '<character>’s journal' (account name for an unattached journal). */
  name: v.string(),
  /** Pages the caller can read (not torn out). */
  pageCount: v.number(),
});
export type PastJournalRow = Infer<typeof pastJournalRowValidator>;

/** One page of the journal view, with what the caller may do (analysis 3.2). */
export const journalViewPageValidator = v.object({
  _id: v.id("journalPages"),
  title: v.string(),
  kind: pageKindValidator,
  tape: v.number(),
  createdAt: v.number(),
  /**
   * The linked D10 session when the caller can see it (D6, D10 Q4: any for the GM, live / played for a player), so the
   * page meta shows its date live, as the own page does (dcm-bxp.110). Absent for an unlinked page.
   */
  session: v.optional(v.object({ n: v.number(), date: v.optional(v.string()) })),
  entryCount: v.number(),
  openCount: v.number(),
  /** Who reads it now (Q14 labels, after the departed rule). */
  chip: v.string(),
  /** Add an entry (Q3): a reader of a present journal. */
  canAdd: v.boolean(),
  /** Tear out (D2): the GM on a non-private page of a departed journal; the owner on a present one. */
  canBin: v.boolean(),
});
export type JournalViewPage = Infer<typeof journalViewPageValidator>;

export const journalViewValidator = v.object({
  journalId: v.id("journals"),
  /** '<character>’s Journal' (Q8); 'Game Master’s Journal' for the GM's. */
  title: v.string(),
  /** The owner's name (character, account or 'Player'). */
  ownerName: v.string(),
  ownerIsGm: v.boolean(),
  /** The caller owns the journal. */
  own: v.boolean(),
  /** D1: a past journal (frozen, D2). */
  departed: v.boolean(),
  pages: v.array(journalViewPageValidator),
});
export type JournalViewData = Infer<typeof journalViewValidator>;

// ---------------------------------------------------------------- helpers

type Owner = { isGm: boolean; characterName: string | null; className: string | null; accountName: string | null };

/** The journal's owner as Q8 names them: the journal's character (name, class), else the account name. */
async function ownerOf(ctx: NotesCtx, journal: Doc<"journals">): Promise<Owner> {
  const isGm = journal.userId === ctx.campaign.ownerId;
  let characterName: string | null = null;
  let className: string | null = null;
  if (!isGm && journal.characterId !== undefined) {
    const character = await ctx.db.get("characters", journal.characterId);
    if (character !== null) {
      try {
        const sheet = readSheet(character.sheet);
        characterName = sheet.name;
        className = CLASSES.find((c) => c.id === sheet.classId)?.name ?? null;
      } catch (error) {
        // A sheet that does not read: its stored name when it has one (as N6 / N7 name journals); anything else is a bug.
        if ((error as { data?: { code?: unknown } }).data?.code !== "CHARACTER_CORRUPT") throw error;
        const raw: unknown = character.sheet;
        const stored = typeof raw === "object" && raw !== null ? (raw as { name?: unknown }).name : undefined;
        characterName = typeof stored === "string" ? stored : null;
      }
    }
  }
  const user = await ctx.db.get("users", journal.userId);
  const accountName = user?.name?.trim() || user?.email?.split("@")[0] || null;
  return { isGm, characterName, className, accountName };
}

/** The campaign's journals (bounded). */
function campaignJournals(ctx: NotesCtx): Promise<Doc<"journals">[]> {
  return ctx.db
    .query("journals")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id))
    .take(JOURNALS_TAKE);
}

/** A journal's pages that are not torn out, in created order (at most MAX_PAGES). */
async function livePages(ctx: NotesCtx, journalId: Id<"journals">): Promise<Doc<"journalPages">[]> {
  const pages = await ctx.db
    .query("journalPages")
    .withIndex("by_journal_binned", (q) => q.eq("journalId", journalId).eq("binnedAt", undefined))
    .take(MAX_PAGES);
  return pages.sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime);
}

/**
 * How many of a journal's live pages the caller reads (permissionFor per page, CF2). The list's `cache` reads the
 * caller's role and the journal's departure once, not once per page (PF10).
 */
async function readableCount(ctx: NotesCtx, journal: Doc<"journals">, cache: PageReadCache): Promise<number> {
  let count = 0;
  for (const page of await livePages(ctx, journal._id)) {
    if ((await permissionFor(ctx, ctx.user, { type: "journalPage", campaign: ctx.campaign, journal, page, cache })) !== null) count += 1;
  }
  return count;
}

/**
 * A page's linked session as `{ session: { n, date } }` when the caller may see it (D10 Q4: any for the GM, live / played
 * for a player; the same rule as `notes.journal`), else `{}` (dcm-bxp.110). `sessions` reads each session once per view.
 */
async function linkedSession(
  ctx: NotesCtx,
  isGm: boolean,
  page: Doc<"journalPages">,
  sessions: Map<Id<"sessions">, Doc<"sessions"> | null>,
): Promise<{ session?: { n: number; date?: string } }> {
  if (page.sessionId === undefined) return {};
  if (!sessions.has(page.sessionId)) sessions.set(page.sessionId, await ctx.db.get("sessions", page.sessionId));
  const session = sessions.get(page.sessionId) ?? null;
  if (session === null || session.campaignId !== ctx.campaign._id || (!isGm && session.status === "planned")) return {};
  return { session: { n: session.n, ...(session.date !== undefined ? { date: session.date } : {}) } };
}

function isCode(error: unknown, code: string): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  return typeof data === "object" && data !== null && (data as { code?: unknown }).code === code;
}

// ---------------------------------------------------------------- queries

/**
 * 'Players’ journals' (Q2): for the GM, every present player journal (D1: not departed), named after its character
 * (Q8), with the number of pages the GM can read; sorted by name. A player gets an empty list (they open other players'
 * pages through the Shared tabs).
 */
export const playerJournals = campaignQuery({
  need: "view",
  args: {},
  returns: v.array(playerJournalRowValidator),
  handler: async (ctx): Promise<PlayerJournalRow[]> => {
    if ((await notesRole(ctx)) !== "gm") return [];
    const cache = pageReadCache(ctx.user, ctx.campaign);
    const rows: PlayerJournalRow[] = [];
    for (const journal of await campaignJournals(ctx)) {
      if (journal.userId === ctx.campaign.ownerId || (await cachedDeparted(ctx, ctx.campaign, journal, cache))) continue;
      const owner = await ownerOf(ctx, journal);
      const { whoName, whoSub } = journalWho(owner);
      rows.push({ journalId: journal._id, name: whoName, sub: whoSub, pageCount: await readableCount(ctx, journal, cache) });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.journalId.localeCompare(b.journalId));
  },
});

/**
 * 'Past journals' (Q12): every departed journal (D1: the player left or was removed, or the character died, retired,
 * was deleted or changed hands), named '<character>’s journal', with the number of its pages the caller can read
 * (Private pages only for their owner); a journal with no page the caller can read is left out (dcm-bxp.108); sorted
 * by name. For every member.
 */
export const pastJournals = campaignQuery({
  need: "view",
  args: {},
  returns: v.array(pastJournalRowValidator),
  handler: async (ctx): Promise<PastJournalRow[]> => {
    await notesRole(ctx); // grant-only users have no notes: NOT_FOUND
    const cache = pageReadCache(ctx.user, ctx.campaign);
    const rows: PastJournalRow[] = [];
    for (const journal of await campaignJournals(ctx)) {
      if (journal.userId === ctx.campaign.ownerId || !(await cachedDeparted(ctx, ctx.campaign, journal, cache))) continue;
      // dcm-bxp.108: a departed journal with no page the caller can read is not listed.
      const pageCount = await readableCount(ctx, journal, cache);
      if (pageCount === 0) continue;
      const owner = await ownerOf(ctx, journal);
      rows.push({ journalId: journal._id, name: pastJournalTitle(owner), pageCount });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.journalId.localeCompare(b.journalId));
  },
});

/**
 * One journal, read through the caller's eyes (Q2, Q3, Q12): its live pages the caller can read (`pageAccess`, so
 * Private pages of a departed journal never and pages hidden from the GM never for the GM), with the chip label and
 * the caller's add / tear-out flags (D2: no adds on a departed journal; the GM tears out its non-private pages) and the
 * linked session the caller can see (dcm-bxp.110). An
 * unknown id, a malformed one, another campaign's journal, or for a player another person's present journal
 * (dcm-bxp.109) is NOT_FOUND.
 */
export const journalView = campaignQuery({
  need: "view",
  args: { journalId: v.string() },
  returns: journalViewValidator,
  handler: async (ctx, args): Promise<JournalViewData> => {
    const role = await notesRole(ctx);
    const id = ctx.db.normalizeId("journals", args.journalId);
    const journal = id === null ? null : await ctx.db.get("journals", id);
    if (journal === null || journal.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
    // One read of the caller's role and the journal's departure for all its pages (PF10).
    const cache = pageReadCache(ctx.user, ctx.campaign);
    cache.journals.set(journal._id, Promise.resolve(journal));
    const isDeparted = await cachedDeparted(ctx, ctx.campaign, journal, cache);
    // dcm-bxp.109: only the GM opens another person's present journal; a player opens their own and past journals,
    // and reads other players' shared pages in the Shared tabs.
    const own = journal.userId === ctx.user._id;
    if (role !== "gm" && !own && !isDeparted) throw appError("NOT_FOUND");
    const owner = await ownerOf(ctx, journal);
    const pages: JournalViewPage[] = [];
    const sessions = new Map<Id<"sessions">, Doc<"sessions"> | null>();
    for (const page of await livePages(ctx, journal._id)) {
      let access: PageAccess;
      try {
        access = await pageAccess(ctx, page, cache);
      } catch (error) {
        if (isCode(error, "NOTE_PAGE_NOT_FOUND")) continue;
        throw error;
      }
      pages.push({
        _id: page._id,
        title: page.title,
        kind: page.kind,
        tape: page.tape,
        createdAt: page.createdAt,
        ...(await linkedSession(ctx, role === "gm", page, sessions)),
        entryCount: page.entryCount,
        openCount: page.openCount,
        chip: visibilityLabel(effectiveReaders(page.visibility, { ownerIsGm: owner.isGm, departed: isDeparted }).visibility, owner.isGm),
        canAdd: access.canAdd,
        canBin: access.canBin,
      });
    }
    const { whoName } = journalWho(owner);
    return {
      journalId: journal._id,
      title: journalTitle(whoName),
      ownerName: whoName,
      ownerIsGm: owner.isGm,
      own,
      departed: isDeparted,
      pages,
    };
  },
});
