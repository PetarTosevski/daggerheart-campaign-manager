import { v, type Infer } from "convex/values";

import { authorLabel } from "../src/lib/domain/notes/authors";
import { isAllowedVisibility, visibilityLabel } from "../src/lib/domain/notes/visibility";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import { readSheet } from "./lib/characterSheet";
import { campaignMutation, campaignQuery } from "./lib/functions";
import { departed } from "./lib/journalState";
import { assertAction, findPage, notesRole, resolvePage, type NotesCtx, type NotesMutationCtx } from "./lib/notes";
import { permissionFor } from "./lib/permissions";
import { MAX_PAGES, pageKindValidator, pageRefValidator, pageVisibilityValidator } from "./lib/validators/notes";

/**
 * Sharing of journal pages (D11 N6, plan `.omc/plans/d11-notes.yaml`; A2-A5, Q1, Q2, Q4, Q12, Q14, D1, D4). The owner
 * sets each page's visibility (one field per write) and, for 'chosen', its recipients one at a time in the
 * `journalPageRecipients` table (never an array on the page, A5). The Shared tabs list exactly the pages
 * `permissionFor` lets the caller read: every row is checked with it (resource `journalPage`, CF2), which applies N1's
 * `canReadPage`; nothing here decides visibility a second time. Writes go through `resolvePage` + `assertAction`
 * ('editPage': the owner of a present journal, D2).
 *
 * | Function          | Kind             | Args                  | Who                         | Errors                                            |
 * |-------------------|------------------|-----------------------|-----------------------------|---------------------------------------------------|
 * | `setVisibility`   | campaignMutation | page ref, visibility  | page owner, journal present | NOTE_PAGE_NOT_FOUND, NOTE_FORBIDDEN_ACTION, NOTE_JOURNAL_CLOSED, NOTE_VISIBILITY_INVALID |
 * | `addRecipient`    | campaignMutation | page ref, userId      | as setVisibility            | as setVisibility, NOTE_RECIPIENT_INVALID          |
 * | `removeRecipient` | campaignMutation | page ref, userId      | as setVisibility            | as setVisibility, NOTE_RECIPIENT_INVALID          |
 * | `recipients`      | campaignQuery    | page ref              | page owner                  | NOTE_PAGE_NOT_FOUND, NOTE_FORBIDDEN_ACTION        |
 * | `shared`          | campaignQuery    | tab 'players' / 'gm'  | every member                | NOT_FOUND (grant only)                            |
 *
 * Common to all: anonymous UNAUTHENTICATED, outsider NOT_FOUND (the wrapper, `need: "view"`).
 */

/** Bounded reads per source of the Shared lists. */
const SHARED_TAKE = 200;
/** A campaign's members and recipient rows per page are a handful; this bounds the reads. */
const MEMBERS_TAKE = 200;

// ---------------------------------------------------------------- shapes

/** One eligible recipient in the sharing dialog (A5, Q4, D4). */
export const recipientRowValidator = v.object({
  userId: v.id("users"),
  /** 'GM' for the GM; a player's character name, else their account name. */
  name: v.string(),
  isGm: v.boolean(),
  chosen: v.boolean(),
});
export type RecipientRow = Infer<typeof recipientRowValidator>;

export const recipientsValidator = v.array(recipientRowValidator);

/** One row of a Shared tab. */
export const sharedRowValidator = v.object({
  pageId: v.id("journalPages"),
  title: v.string(),
  kind: pageKindValidator,
  tape: v.number(),
  createdAt: v.number(),
  /** 'Game Master' for the GM's pages; the journal's character name, else the account name, for a player's. */
  ownerName: v.string(),
  ownerIsGm: v.boolean(),
  /** The caller owns the page (only the GM's own shared pages, in the 'gm' tab). */
  own: v.boolean(),
  visibility: pageVisibilityValidator,
  /** The sharing chip's label (Q14); for the GM's own chosen pages with the recipient names. */
  chip: v.string(),
});
export type SharedRow = Infer<typeof sharedRowValidator>;

export const sharedTabValidator = v.union(v.literal("players"), v.literal("gm"));
export type SharedTab = Infer<typeof sharedTabValidator>;

// ---------------------------------------------------------------- helpers

/** A character's name from its sheet, else its stored `name` string, else null. */
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

function accountName(user: Doc<"users"> | null): string | null {
  return user?.name?.trim() || user?.email?.split("@")[0] || null;
}

/** The campaign's player rows (a handful). */
async function memberRows(ctx: NotesCtx): Promise<Doc<"campaignMembers">[]> {
  return ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id))
    .take(MEMBERS_TAKE);
}

/** Each player's name: their newest live character's name in the campaign, else their account name. */
async function playerNames(ctx: NotesCtx, userIds: readonly Id<"users">[]): Promise<Map<Id<"users">, string>> {
  const characters = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", ctx.campaign._id))
    .take(MEMBERS_TAKE);
  const live = characters
    .filter((c) => c.status !== "dead" && c.status !== "retired")
    .sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime);
  const byOwner = new Map<Id<"users">, Doc<"characters">>();
  for (const c of live) byOwner.set(c.ownerId, c);
  const names = new Map<Id<"users">, string>();
  for (const userId of userIds) {
    const character = byOwner.get(userId) ?? null;
    const label = authorLabel({ isGm: false, characterName: characterName(character), accountName: accountName(await ctx.db.get("users", userId)) });
    names.set(userId, label);
  }
  return names;
}

/**
 * Whether `userId` may be ticked on a page owned by `ownerId` (A5, Q4, D4): a member of the campaign other than the
 * owner. For the GM's page: a player (a `campaignMembers` row). For a player's page: another player or the GM.
 * Pending invitees are not members yet.
 */
async function eligible(ctx: NotesCtx, ownerId: Id<"users">, userId: Id<"users">): Promise<boolean> {
  if (userId === ownerId) return false;
  if (userId === ctx.campaign.ownerId) return true;
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", userId))
    .unique();
  return member !== null;
}

/** A page's recipient rows (at most the campaign's members). */
function recipientRows(ctx: NotesCtx, pageId: Id<"journalPages">) {
  return ctx.db
    .query("journalPageRecipients")
    .withIndex("by_page_user", (q) => q.eq("pageId", pageId))
    .take(MEMBERS_TAKE);
}

/** A page the caller may change the sharing of: the owner of a present journal (Q3, D2). */
async function ownPage(ctx: NotesMutationCtx, ref: Infer<typeof pageRefValidator>) {
  const access = await resolvePage(ctx, ref);
  assertAction(access, "editPage");
  return access;
}

/** A user id from the client, or NOTE_RECIPIENT_INVALID. */
function userIdOf(ctx: NotesCtx, raw: string): Id<"users"> {
  const id = ctx.db.normalizeId("users", raw);
  if (id === null) throw appError("NOTE_RECIPIENT_INVALID");
  return id;
}

// ---------------------------------------------------------------- writes

/**
 * The page's visibility (A3, A4, A5, Q4): a player any of N1's PLAYER_VISIBILITIES, the GM private / everyone / chosen,
 * else NOTE_VISIBILITY_INVALID. Leaving 'chosen' deletes the page's recipient rows in the same mutation (rows exist only
 * while the page is 'chosen'). Owner only, journal present.
 */
export const setVisibility = campaignMutation({
  need: "view",
  args: { page: pageRefValidator, visibility: pageVisibilityValidator },
  returns: v.null(),
  handler: async (ctx, { page, visibility }) => {
    const access = await ownPage(ctx, page);
    // The caller owns the page, so the owner is the GM exactly when the caller is.
    if (!isAllowedVisibility(access.isGm, visibility)) throw appError("NOTE_VISIBILITY_INVALID");
    if (access.page.visibility === visibility) return null;
    if (access.page.visibility === "chosen") {
      for (const row of await recipientRows(ctx, access.page._id)) await ctx.db.delete("journalPageRecipients", row._id);
    }
    await ctx.db.patch("journalPages", access.page._id, { visibility, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Ticks a member as a reader of a 'chosen' page (A5, Q4): one row per (page, user), adding twice is a no-op. The user
 * must be a member other than the owner: a player for the GM's page, another player or the GM for a player's (D4);
 * anyone else, or a page that is not 'chosen', is NOTE_RECIPIENT_INVALID. Owner only, journal present.
 */
export const addRecipient = campaignMutation({
  need: "view",
  args: { page: pageRefValidator, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await ownPage(ctx, args.page);
    if (access.page.visibility !== "chosen") throw appError("NOTE_RECIPIENT_INVALID");
    const userId = userIdOf(ctx, args.userId);
    if (!(await eligible(ctx, access.page.ownerId, userId))) throw appError("NOTE_RECIPIENT_INVALID");
    const existing = await ctx.db
      .query("journalPageRecipients")
      .withIndex("by_page_user", (q) => q.eq("pageId", access.page._id).eq("userId", userId))
      .unique();
    if (existing !== null) return null;
    await ctx.db.insert("journalPageRecipients", { campaignId: ctx.campaign._id, pageId: access.page._id, userId, addedAt: Date.now() });
    return null;
  },
});

/**
 * Unticks a reader of a 'chosen' page (A5, Q4); a user who is not ticked is a no-op. A page that is not 'chosen' or a
 * malformed id is NOTE_RECIPIENT_INVALID. Anyone ticked may be removed, also a member who has since left (so a rejoin
 * cannot bring back a reader the owner wanted gone). Owner only, journal present.
 */
export const removeRecipient = campaignMutation({
  need: "view",
  args: { page: pageRefValidator, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await ownPage(ctx, args.page);
    if (access.page.visibility !== "chosen") throw appError("NOTE_RECIPIENT_INVALID");
    const userId = userIdOf(ctx, args.userId);
    const existing = await ctx.db
      .query("journalPageRecipients")
      .withIndex("by_page_user", (q) => q.eq("pageId", access.page._id).eq("userId", userId))
      .unique();
    if (existing !== null) await ctx.db.delete("journalPageRecipients", existing._id);
    return null;
  },
});

// ---------------------------------------------------------------- queries

/**
 * The members the owner may tick for a page (A5, Q4, D4) with a `chosen` flag: for the GM's page the players, for a
 * player's page the GM first, then the other players. Owner only (a reader gets NOTE_FORBIDDEN_ACTION). A template
 * ref before the journal exists answers with nobody chosen.
 */
export const recipients = campaignQuery({
  need: "view",
  args: { page: pageRefValidator },
  returns: recipientsValidator,
  handler: async (ctx, { page }): Promise<RecipientRow[]> => {
    const access = await findPage(ctx, page);
    if (access !== null && !access.isOwner) throw appError("NOTE_FORBIDDEN_ACTION");
    const role = access === null ? await notesRole(ctx) : access.isGm ? "gm" : "player";
    const chosen = new Set<string>();
    if (access !== null && access.page.visibility === "chosen") {
      for (const row of await recipientRows(ctx, access.page._id)) chosen.add(row.userId);
    }
    const players = (await memberRows(ctx)).map((m) => m.userId).filter((id) => id !== ctx.user._id);
    const names = await playerNames(ctx, players);
    const rows: RecipientRow[] = [];
    if (role !== "gm") rows.push({ userId: ctx.campaign.ownerId, name: "GM", isGm: true, chosen: chosen.has(ctx.campaign.ownerId) });
    for (const userId of players) rows.push({ userId, name: names.get(userId) ?? "Player", isGm: false, chosen: chosen.has(userId) });
    return rows;
  },
});

/**
 * A Shared tab (A2, Q2, Q4): exactly the pages `permissionFor` lets the caller read, not torn out, of journals that are
 * present (departed journals' pages are under Past journals, N8).
 *
 * - 'players': other players' pages with 'everyone', 'players' (for a player) or 'gm' (for the GM) visibility, plus
 *   'chosen' pages that tick the caller; ordered by owner, so the GM sees them grouped by player (Q2).
 * - 'gm': the GM's pages with 'everyone', plus 'chosen' pages that tick the caller. The GM gets their own shared pages
 *   ('everyone' and 'chosen'), each chosen one's chip naming its recipients.
 */
export const shared = campaignQuery({
  need: "view",
  args: { tab: sharedTabValidator },
  returns: v.array(sharedRowValidator),
  handler: async (ctx, { tab }): Promise<SharedRow[]> => {
    const role = await notesRole(ctx);
    const isGm = role === "gm";
    const gmId = ctx.campaign.ownerId;

    const candidates = new Map<Id<"journalPages">, Doc<"journalPages">>();
    const add = (page: Doc<"journalPages"> | null) => {
      if (page !== null && page.binnedAt === undefined) candidates.set(page._id, page);
    };
    // Pages that tick the caller (rows exist only while a page is 'chosen').
    const ticked = await ctx.db
      .query("journalPageRecipients")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", ctx.user._id))
      .take(SHARED_TAKE);
    for (const row of ticked) add(await ctx.db.get("journalPages", row.pageId));

    if (tab === "players") {
      for (const visibility of isGm ? (["gm", "everyone"] as const) : (["players", "everyone"] as const)) {
        const pages = await ctx.db
          .query("journalPages")
          .withIndex("by_campaign_visibility_binned", (q) =>
            q.eq("campaignId", ctx.campaign._id).eq("visibility", visibility).eq("binnedAt", undefined),
          )
          .take(SHARED_TAKE);
        for (const page of pages) add(page);
      }
    } else {
      // The GM's journal pages (at most MAX_PAGES), so players' shared pages never crowd them out of a bounded read.
      const gmJournals = await ctx.db
        .query("journals")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", gmId))
        .take(10);
      for (const journal of gmJournals) {
        const pages = await ctx.db
          .query("journalPages")
          .withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id).eq("binnedAt", undefined))
          .take(MAX_PAGES);
        for (const page of pages) if (page.visibility === "everyone" || page.visibility === "chosen") add(page);
      }
    }

    const journals = new Map<Id<"journals">, { journal: Doc<"journals">; departed: boolean; ownerName: string } | null>();
    async function journalInfo(id: Id<"journals">) {
      if (!journals.has(id)) {
        const journal = await ctx.db.get("journals", id);
        if (journal === null) journals.set(id, null);
        else {
          const ownerIsGm = journal.userId === gmId;
          const character = ownerIsGm || journal.characterId === undefined ? null : await ctx.db.get("characters", journal.characterId);
          const ownerName = ownerIsGm
            ? "Game Master"
            : authorLabel({ isGm: false, characterName: characterName(character), accountName: accountName(await ctx.db.get("users", journal.userId)) });
          journals.set(id, { journal, departed: await departed(ctx, ctx.campaign, journal), ownerName });
        }
      }
      return journals.get(id) ?? null;
    }

    const rows: SharedRow[] = [];
    for (const page of candidates.values()) {
      const ownerIsGm = page.ownerId === gmId;
      if (tab === "players" ? ownerIsGm : !ownerIsGm) continue;
      const own = page.ownerId === ctx.user._id;
      // Own pages are in the caller's journal; only the GM's 'gm' tab lists them (with their readers).
      if (own && tab === "players") continue;
      const info = await journalInfo(page.journalId);
      if (info === null || info.departed) continue;
      const permission = await permissionFor(ctx, ctx.user, { type: "journalPage", campaign: ctx.campaign, journal: info.journal, page });
      if (permission === null) continue;
      let chip = visibilityLabel(page.visibility, ownerIsGm);
      if (own && page.visibility === "chosen") {
        const names = await playerNames(ctx, (await recipientRows(ctx, page._id)).map((r) => r.userId));
        chip = names.size > 0 ? `${chip} · ${[...names.values()].join(", ")}` : `${chip} · nobody yet`;
      }
      rows.push({
        pageId: page._id,
        title: page.title,
        kind: page.kind,
        tape: page.tape,
        createdAt: page.createdAt,
        ownerName: info.ownerName,
        ownerIsGm,
        own,
        visibility: page.visibility,
        chip,
      });
    }
    rows.sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.createdAt - b.createdAt);
    return rows;
  },
});
