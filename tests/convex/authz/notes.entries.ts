import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area, Outcome, Role, World } from "./harness";

/**
 * Authz matrix: notes (notes, notesBin, notesEntries, notesJournals, notesSharing, notesThreads; bead dcm-bxp.100).
 * Filled by tracer H13 (.omc/plans/d12-hardening.yaml).
 *
 * All 27 functions are campaign wrappers with `need: "view"`: the wrapper refuses anon (UNAUTHENTICATED) and the
 * outsider (NOT_FOUND); past it, page access is decided by `pageAccess` (permissionFor on the `journalPage` resource,
 * convex/lib/notes.ts), which answers NOTE_* codes rather than the generic ones:
 *
 * - a page the caller cannot read: NOTE_PAGE_NOT_FOUND (an entry on one: NOTE_ENTRY_NOT_FOUND);
 * - a reader trying an owner's or author's action: NOTE_FORBIDDEN_ACTION;
 * - a torn-out page someone else tore out: NOTE_PAGE_NOT_FOUND (they cannot read it any more).
 *
 * Every world gets one page in playerA's journal: a session log shared with `players` (the other players read it, the
 * GM does not: the GM is not the owner of player pages and reads only what the visibility lets them), holding one open
 * task by playerA. So the rows are: player = the owner acting on their own journal (ok); otherPlayer and grantee =
 * readers (reads and `add` ok, owner/author actions NOTE_FORBIDDEN_ACTION); gm = not a reader (NOTE_PAGE_NOT_FOUND /
 * NOTE_ENTRY_NOT_FOUND). The grantee is a member with an `edit` grant on the campaign; journal pages take no grants,
 * so the grantee gets exactly what the other player gets. The sharing entries put the page on `chosen` with playerB
 * ticked; restorePage tears it out first.
 *
 * The full visibility table (gm / private / players / everyone / chosen, departed journals, the bin) stays in the
 * notes feature tests (tests/convex/notes-*.test.ts); these entries are the role-level rows.
 */

/** NOTE_* refusals. `Outcome` names only the generic codes; the harness compares any other outcome to the code verbatim. */
type NoteCode = "NOTE_PAGE_NOT_FOUND" | "NOTE_ENTRY_NOT_FOUND" | "NOTE_FORBIDDEN_ACTION";
const note = (code: NoteCode) => code as Outcome;

/** The owner's own reads: every member reads their own journal (the class defaults plus the other roles). */
const OWN_JOURNAL: Partial<Record<Role, Outcome>> = { otherPlayer: "ok", grantee: "ok" };
/** Reads of playerA's `players` page: the other players read it, the GM does not. */
const PAGE_READ: Partial<Record<Role, Outcome>> = { otherPlayer: "ok", grantee: "ok", gm: note("NOTE_PAGE_NOT_FOUND") };
/** Owner-only page actions on playerA's page (title, tape, session, visibility, recipients, tear out, migrate). */
const PAGE_OWNER: Partial<Record<Role, Outcome>> = {
  otherPlayer: note("NOTE_FORBIDDEN_ACTION"),
  grantee: note("NOTE_FORBIDDEN_ACTION"),
  gm: note("NOTE_PAGE_NOT_FOUND"),
};
/** Owner/author actions on playerA's entry on that page. */
const ENTRY_OWNER: Partial<Record<Role, Outcome>> = {
  otherPlayer: note("NOTE_FORBIDDEN_ACTION"),
  grantee: note("NOTE_FORBIDDEN_ACTION"),
  gm: note("NOTE_ENTRY_NOT_FOUND"),
};

const pageOf = (w: World) => w.ids.pageId as Id<"journalPages">;

/** The `chosen` page with playerB ticked (the sharing writes): playerB reads it, the GM and the grantee do not. */
async function chosenPage(w: World) {
  const player = w.as("player");
  await player.mutation(api.notesSharing.setVisibility, { campaignId: w.campaignId, page: pageOf(w), visibility: "chosen" });
  await player.mutation(api.notesSharing.addRecipient, { campaignId: w.campaignId, page: pageOf(w), userId: w.users.otherPlayer });
}

const CHOSEN_OWNER: Partial<Record<Role, Outcome>> = {
  otherPlayer: note("NOTE_FORBIDDEN_ACTION"),
  grantee: note("NOTE_PAGE_NOT_FOUND"),
  gm: note("NOTE_PAGE_NOT_FOUND"),
};

const area: Area = {
  area: "notes",
  // setSession's `sessionId` is a session id or null: null unlinks (the matrix world has no session).
  nameHints: { sessionId: () => null },
  setup: async (w) => {
    const player = w.as("player");
    const campaignId = w.campaignId;
    // The first write creates playerA's journal with its default pages, then the new session log.
    const pageId = await player.mutation(api.notes.createPage, { campaignId, kind: "log" });
    await player.mutation(api.notesSharing.setVisibility, { campaignId, page: pageId, visibility: "players" });
    const { entryId } = await player.mutation(api.notesEntries.add, { campaignId, page: pageId, kind: "task", text: "Find the key" });
    const journalId = await w.t.run(async (ctx) => (await ctx.db.get(pageId))!.journalId);
    w.set("pageId", pageId);
    w.use("journalPages", pageId);
    w.use("journalEntries", entryId);
    w.use("journals", journalId);
  },
  entries: [
    // notes: own journal and pages.
    { fn: api.notes.journal, access: "view", expect: OWN_JOURNAL },
    { fn: api.notes.createPage, access: "view", expect: OWN_JOURNAL },
    { fn: api.notes.renamePage, access: "view", args: () => ({ title: "Renamed" }), expect: PAGE_OWNER },
    { fn: api.notes.cycleTape, access: "view", expect: PAGE_OWNER },
    { fn: api.notes.setSession, access: "view", expect: PAGE_OWNER },

    // notesBin: only whoever tore a page out sees it in their bin and restores it.
    { fn: api.notesBin.bin, access: "view", expect: OWN_JOURNAL },
    { fn: api.notesBin.binPage, access: "view", expect: PAGE_OWNER },
    {
      fn: api.notesBin.restorePage,
      access: "view",
      setup: async (w) => void (await w.as("player").mutation(api.notesBin.binPage, { campaignId: w.campaignId, page: pageOf(w) })),
      expect: { otherPlayer: note("NOTE_PAGE_NOT_FOUND"), grantee: note("NOTE_PAGE_NOT_FOUND"), gm: note("NOTE_PAGE_NOT_FOUND") },
      note: "a torn-out page: only the one who tore it out reads it",
    },

    // notesEntries: readers read and add (Q3); the author or the page owner manage entries (D5).
    { fn: api.notesEntries.entries, access: "view", expect: PAGE_READ },
    { fn: api.notesEntries.add, access: "view", args: () => ({ kind: "note", text: "Seen it" }), expect: PAGE_READ },
    { fn: api.notesEntries.setText, access: "view", args: () => ({ text: "Find the silver key" }), expect: ENTRY_OWNER },
    { fn: api.notesEntries.cycle, access: "view", expect: ENTRY_OWNER },
    { fn: api.notesEntries.toggleStar, access: "view", expect: ENTRY_OWNER },
    { fn: api.notesEntries.moveUp, access: "view", expect: ENTRY_OWNER },
    { fn: api.notesEntries.remove, access: "view", expect: ENTRY_OWNER },
    { fn: api.notesEntries.migrateOpen, access: "view", expect: PAGE_OWNER },

    // notesJournals: the GM lists present player journals (a player gets []); journalView shows readable pages only.
    { fn: api.notesJournals.playerJournals, access: "view", expect: { player: "empty", otherPlayer: "empty" } },
    { fn: api.notesJournals.pastJournals, access: "view", expect: OWN_JOURNAL },
    { fn: api.notesJournals.journalView, access: "view", expect: { otherPlayer: "ok", grantee: "ok" }, note: "the GM gets the journal without the `players` page" },

    // notesSharing: the owner shares; a reader may not see or change the recipients.
    { fn: api.notesSharing.setVisibility, access: "view", args: () => ({ visibility: "everyone" }), expect: PAGE_OWNER },
    { fn: api.notesSharing.addRecipient, access: "view", setup: chosenPage, args: (w) => ({ userId: w.users.otherPlayer }), expect: CHOSEN_OWNER },
    { fn: api.notesSharing.removeRecipient, access: "view", setup: chosenPage, args: (w) => ({ userId: w.users.otherPlayer }), expect: CHOSEN_OWNER },
    { fn: api.notesSharing.recipients, access: "view", expect: { otherPlayer: note("NOTE_FORBIDDEN_ACTION"), grantee: note("NOTE_FORBIDDEN_ACTION"), gm: note("NOTE_PAGE_NOT_FOUND") } },
    { fn: api.notesSharing.shared, access: "view", expect: OWN_JOURNAL },

    // notesThreads: the caller's own journal only.
    { fn: api.notesThreads.threads, access: "view", expect: OWN_JOURNAL },
    { fn: api.notesThreads.search, access: "view", args: () => ({ text: "key" }), expect: OWN_JOURNAL },
    { fn: api.notesThreads.exportPage, access: "view", expect: OWN_JOURNAL },
  ],
  pending: [],
};

export default area;
