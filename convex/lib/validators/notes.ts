import { v, type Infer } from "convex/values";

import { defaultPages } from "../../../src/lib/domain/notes/defaults";
import { BIN_DAYS, NOTE_LIMITS } from "../../../src/lib/domain/notes/limits";
import { ENTRY_KINDS, ENTRY_STATES, PAGE_KINDS, VISIBILITIES } from "../../../src/lib/domain/notes/types";

/**
 * Validators, caps and constants of the Notes board (D11, plan `.omc/plans/d11-notes.yaml`). N0 defines every stored
 * shape once here; the tables (convex/tables/notes.ts) and the later tracers' `args` / `returns` reuse these. The value
 * lists, caps, default pages, mention tokens and the open-thread rule come from N1's pure domain
 * (src/lib/domain/notes), so server and client share one definition. Typed fields only: no blob, no `schemaVersion`
 * (rule 7 applies only to untyped JSON). Widen only.
 */

// ---------------------------------------------------------------- caps (Q10)

export const { MAX_PAGES, MAX_PAGE_ENTRIES, MAX_JOURNAL_ENTRIES, TITLE_MAX, TEXT_MAX, MAX_MENTIONS } = NOTE_LIMITS;
export { TAPE_COUNT } from "../../../src/lib/domain/notes/defaults";
/** A torn-out page stays in the bin this long, then the bin cron (N7) purges it (Q11). */
export const BIN_TTL_MS = BIN_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- values

export { ENTRY_KINDS, ENTRY_STATES, PAGE_KINDS } from "../../../src/lib/domain/notes/types";
export type { EntryKind, EntryState, PageKind } from "../../../src/lib/domain/notes/types";

/** B2: the three page groups. */
export const pageKindValidator = v.union(...PAGE_KINDS.map((k) => v.literal(k)));
/** B4: the six bullet kinds. Hope / Fear are labels only (Q7). */
export const entryKindValidator = v.union(...ENTRY_KINDS.map((k) => v.literal(k)));
/** B4: a task cycles through all five; every other kind is `open` or `done` (shown as resolved). */
export const entryStateValidator = v.union(...ENTRY_STATES.map((s) => v.literal(s)));

/**
 * Who besides the owner reads a page (A3, A4, A5, Q4, D4): N1's VISIBILITIES. A player's page: `gm` (default, the GM
 * reads it), `private` (nobody), `players` (the other players, not the GM), `everyone`, `chosen` (the recipients in
 * `journalPageRecipients`; the GM only when ticked). A GM's page: `private` (default), `everyone`, `chosen`.
 * Departure (D1) turns every value but `private` into "every member" (Q12); `permissionFor` decides it with N1's
 * `canReadPage`.
 */
export const PAGE_VISIBILITIES = VISIBILITIES;
export type PageVisibility = (typeof VISIBILITIES)[number];
export const pageVisibilityValidator = v.union(...VISIBILITIES.map((s) => v.literal(s)));
export { allowedVisibilities, defaultVisibility, GM_VISIBILITIES, PLAYER_VISIBILITIES } from "../../../src/lib/domain/notes/visibility";

/**
 * A page reference from the client (CL6): a page id, or `{ template: i }` for the i-th default page of the caller's
 * journal before it exists. The first write with a template ref creates the journal and its default pages
 * (`resolvePage` in convex/lib/notes.ts); a query with one answers as for an empty page.
 */
export const pageRefValidator = v.union(v.id("journalPages"), v.object({ template: v.number() }));
export type PageRef = Infer<typeof pageRefValidator>;

// ---------------------------------------------------------------- mention tokens (D7, Q6)

/**
 * An @mention in an entry's text: `@[<name when written>](<codexEntryId>)`, at most MAX_MENTIONS per entry. N1 owns the
 * format: `MENTION_TOKEN_RE` (global; name in group 1, id in group 2), `formatToken(name, id)`, `mentionIds(text)`,
 * `countMentions(text)`. N3 validates each id server-side.
 */
export { countMentions, formatToken, MENTION_TOKEN_RE, mentionIds } from "../../../src/lib/domain/notes/mentions";

// ---------------------------------------------------------------- default pages (B7)

/** The default pages a new journal gets, in order; `{ template: i }` names the i-th (N1 `defaultPages`). */
export function journalTemplate(isGm: boolean) {
  return defaultPages(isGm);
}

/** B5: `journalEntries.open` is N1's `isOpenThread` (an open task, or a Fear not resolved). */
export { isOpenThread } from "../../../src/lib/domain/notes/bullets";

// ---------------------------------------------------------------- stored shapes

/**
 * One journal per (campaign, person, character) (Q12, D3): the GM's journal has no `characterId`; a player's journal
 * belongs to a character, or is unattached until the player's first character takes it. Counters cover the pages
 * that are not torn out (`pageCount`, `entryCount`, `openCount` = open threads, B5).
 */
export const journalFields = {
  campaignId: v.id("campaigns"),
  userId: v.id("users"),
  characterId: v.optional(v.id("characters")),
  pageCount: v.number(),
  entryCount: v.number(),
  openCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const journalValidator = v.object(journalFields);

/** A page (B3). `ownerId` = the journal's `userId`. `binnedAt` / `binnedBy` while torn out (Q11). */
export const journalPageFields = {
  campaignId: v.id("campaigns"),
  journalId: v.id("journals"),
  ownerId: v.id("users"),
  kind: pageKindValidator,
  title: v.string(),
  tape: v.number(),
  visibility: pageVisibilityValidator,
  /** Q5: the D10 session a session log is linked to; absent when unlinked (or the session was deleted, D6). */
  sessionId: v.optional(v.id("sessions")),
  binnedAt: v.optional(v.number()),
  binnedBy: v.optional(v.id("users")),
  entryCount: v.number(),
  openCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const journalPageValidator = v.object(journalPageFields);

/** A chosen reader of a `chosen` page (A5, Q4): one row per (page, user), only while the page is `chosen`. */
export const journalPageRecipientFields = {
  campaignId: v.id("campaigns"),
  pageId: v.id("journalPages"),
  userId: v.id("users"),
  addedAt: v.number(),
};

/**
 * An entry (B4). `authorId` is whoever wrote it: the page owner, or a reader who added it (Q3, shown in the added
 * colour with ' - <author>'); `authorCharacterId` names the author's character at the time. `open` = an open thread
 * (an open task or an unresolved Fear, B5), kept in step with kind and state for `by_journal_open`.
 */
export const journalEntryFields = {
  campaignId: v.id("campaigns"),
  journalId: v.id("journals"),
  pageId: v.id("journalPages"),
  authorId: v.id("users"),
  authorCharacterId: v.optional(v.id("characters")),
  kind: entryKindValidator,
  state: entryStateValidator,
  star: v.boolean(),
  /** Plain text with D7 mention tokens. */
  text: v.string(),
  order: v.number(),
  open: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

