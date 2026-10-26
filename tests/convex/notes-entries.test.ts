import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatToken } from "../../convex/lib/validators/notes";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D11 N3: entries (convex/notesEntries.ts). Role table (function x role -> expected ConvexError code, D12 folds it into
// tests/convex/authz-matrix.test.ts) and the behaviour: added entries and their labels (Q3), the action table (D5),
// departure (D2), mentions (D7), caps (Q10), migration (B6), counters, and Hope / Fear as labels only (Q7).

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const P3 = "p3@example.com";
const OUTSIDER = "outsider@example.com";

type Who = "gm" | "p1" | "p2" | "p3" | "outsider";

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
    p1: await ctx.db.insert("users", { email: P1, emailVerificationTime: 1, name: "Petra" }),
    p2: await ctx.db.insert("users", { email: P2, emailVerificationTime: 1, name: "Quinn" }),
    p3: await ctx.db.insert("users", { email: P3, emailVerificationTime: 1 }),
    outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
  }));
  const as = (who: Who) => t.withIdentity({ subject: `${ids[who]}|s` });
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Notes", idempotencyKey: key() });
  for (const who of ["p1", "p2", "p3"] as const) {
    const code = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
    await as(who).mutation(api.members.joinByCode, { code });
  }
  async function character(owner: Who, name: string, status: Doc<"characters">["status"] = "active") {
    const now = Date.now();
    return t.run((ctx) =>
      ctx.db.insert("characters", { campaignId, ownerId: ids[owner], createdBy: ids[owner], status, sheet: { name }, createdAt: now, updatedAt: now }),
    );
  }
  const call = {
    entries: (who: Who | "anon", page: Id<"journalPages"> | { template: number }) => client(who).query(api.notesEntries.entries, { campaignId, page }),
    add: (who: Who | "anon", page: Id<"journalPages"> | { template: number }, text: string, kind: Doc<"journalEntries">["kind"] = "task") =>
      client(who).mutation(api.notesEntries.add, { campaignId, page, kind, text }),
    setText: (who: Who | "anon", entryId: Id<"journalEntries">, text: string) => client(who).mutation(api.notesEntries.setText, { campaignId, entryId, text }),
    cycle: (who: Who | "anon", entryId: Id<"journalEntries">) => client(who).mutation(api.notesEntries.cycle, { campaignId, entryId }),
    toggleStar: (who: Who | "anon", entryId: Id<"journalEntries">) => client(who).mutation(api.notesEntries.toggleStar, { campaignId, entryId }),
    moveUp: (who: Who | "anon", entryId: Id<"journalEntries">) => client(who).mutation(api.notesEntries.moveUp, { campaignId, entryId }),
    remove: (who: Who | "anon", entryId: Id<"journalEntries">) => client(who).mutation(api.notesEntries.remove, { campaignId, entryId }),
    migrateOpen: (who: Who | "anon", page: Id<"journalPages"> | { template: number }) =>
      client(who).mutation(api.notesEntries.migrateOpen, { campaignId, page }),
  };
  function client(who: Who | "anon") {
    return who === "anon" ? t : as(who);
  }
  /** A page's stored fields (visibility, recipients) set directly: sharing is N6's. */
  async function share(pageId: Id<"journalPages">, visibility: Doc<"journalPages">["visibility"], recipients: Who[] = []) {
    await t.run(async (ctx) => {
      await ctx.db.patch("journalPages", pageId, { visibility });
      for (const who of recipients) await ctx.db.insert("journalPageRecipients", { campaignId, pageId, userId: ids[who], addedAt: Date.now() });
    });
  }
  /** Every page of the campaign has counters equal to its rows, and every journal the sum over its live pages. */
  async function expectCounters() {
    await t.run(async (ctx) => {
      const journals = await ctx.db.query("journals").collect();
      for (const journal of journals) {
        const pages = await ctx.db.query("journalPages").withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id)).collect();
        let entries = 0;
        let open = 0;
        for (const page of pages) {
          const rows = await ctx.db.query("journalEntries").withIndex("by_page_order", (q) => q.eq("pageId", page._id)).collect();
          expect({ page: page.title, entries: page.entryCount, open: page.openCount }).toEqual({
            page: page.title,
            entries: rows.length,
            open: rows.filter((r) => r.open).length,
          });
          if (page.binnedAt === undefined) {
            entries += rows.length;
            open += rows.filter((r) => r.open).length;
          }
        }
        expect({ pages: journal.pageCount, entries: journal.entryCount, open: journal.openCount }).toEqual({
          pages: pages.filter((p) => p.binnedAt === undefined).length,
          entries,
          open,
        });
      }
    });
  }
  return { t, ids, as, campaignId, character, call, share, expectCounters };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return errorCode(error);
  }
}

/**
 * The fixture of the role table: P1 (character 'Ash') owns 'Session 1' with visibility 'gm' (the default: the GM reads
 * it, the other players do not). It holds P1's open task `own` and the GM's added task `gmAdded`.
 */
async function pageFixture() {
  const s = await setup();
  await s.character("p1", "Ash");
  const { entryId: own, pageId } = await s.call.add("p1", { template: 0 }, "find the ferryman");
  const { entryId: gmAdded } = await s.call.add("gm", pageId, "the ferryman lies");
  return { s, pageId, own, gmAdded };
}

type Fixture = Awaited<ReturnType<typeof pageFixture>>;
type Role = Who | "anon";

/** function x role -> expected code ('ok' = allowed). P2 cannot read P1's 'gm' page; P3 is like P2. */
const ROLE_TABLE: { fn: string; run: (f: Fixture, who: Role) => Promise<unknown>; expected: Record<Role, string> }[] = [
  {
    fn: "entries",
    run: (f, who) => f.s.call.entries(who, f.pageId),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "NOTE_PAGE_NOT_FOUND", p3: "NOTE_PAGE_NOT_FOUND" },
  },
  {
    fn: "add",
    run: (f, who) => f.s.call.add(who, f.pageId, "a new line"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "NOTE_PAGE_NOT_FOUND", p3: "NOTE_PAGE_NOT_FOUND" },
  },
  {
    fn: "setText (owner's entry)",
    run: (f, who) => f.s.call.setText(who, f.own, "changed"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "NOTE_FORBIDDEN_ACTION", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "setText (GM's added entry)",
    run: (f, who) => f.s.call.setText(who, f.gmAdded, "changed"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "NOTE_FORBIDDEN_ACTION", gm: "ok", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "cycle (owner's entry)",
    run: (f, who) => f.s.call.cycle(who, f.own),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "NOTE_FORBIDDEN_ACTION", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "cycle (GM's added entry)",
    run: (f, who) => f.s.call.cycle(who, f.gmAdded),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "toggleStar",
    run: (f, who) => f.s.call.toggleStar(who, f.gmAdded),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "NOTE_FORBIDDEN_ACTION", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "moveUp",
    run: (f, who) => f.s.call.moveUp(who, f.gmAdded),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "NOTE_FORBIDDEN_ACTION", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "remove (owner's entry)",
    run: (f, who) => f.s.call.remove(who, f.own),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "NOTE_FORBIDDEN_ACTION", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "remove (GM's added entry)",
    run: (f, who) => f.s.call.remove(who, f.gmAdded),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "NOTE_ENTRY_NOT_FOUND", p3: "NOTE_ENTRY_NOT_FOUND" },
  },
  {
    fn: "migrateOpen",
    run: (f, who) => f.s.call.migrateOpen(who, f.pageId),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "NOTE_FORBIDDEN_ACTION", p2: "NOTE_PAGE_NOT_FOUND", p3: "NOTE_PAGE_NOT_FOUND" },
  },
];

describe("notesEntries role table (owner player P1, GM reader, players who cannot read, outsider, anonymous)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  for (const row of ROLE_TABLE) {
    it(`${row.fn}: ${Object.entries(row.expected).map(([r, c]) => `${r} ${c}`).join(", ")}`, async () => {
      const f = await pageFixture();
      const actual: Record<string, unknown> = {};
      // Denied roles first (they change nothing), then the allowed ones, each on a fresh fixture.
      for (const who of Object.keys(row.expected) as Role[]) {
        if (row.expected[who] !== "ok") actual[who] = await codeOf(row.run(f, who));
      }
      for (const who of Object.keys(row.expected) as Role[]) {
        if (row.expected[who] === "ok") actual[who] = await codeOf(row.run(await pageFixture(), who));
      }
      expect(actual).toEqual(row.expected);
      await f.s.expectCounters();
    });
  }

  it("a chosen player reads and adds to a 'chosen' page; a player not chosen gets NOTE_PAGE_NOT_FOUND; the GM (not ticked) too (D4)", async () => {
    const { s, pageId } = await pageFixture();
    await s.character("p2", "Bryn");
    await s.share(pageId, "chosen", ["p2"]);
    expect(await codeOf(s.call.entries("p2", pageId))).toBe("ok");
    const { entryId } = await s.call.add("p2", pageId, "I saw the lantern");
    const view = await s.call.entries("p1", pageId);
    expect(view.entries.find((e) => e._id === entryId)).toMatchObject({ added: true, authorLabel: "Bryn", canEdit: false, canDelete: true, canCycle: true });
    expect(await codeOf(s.call.add("p3", pageId, "me too"))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await codeOf(s.call.entries("p3", pageId))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await codeOf(s.call.add("gm", pageId, "and me"))).toBe("NOTE_PAGE_NOT_FOUND");
    await s.expectCounters();
  });
});

describe("added entries (Q3, D5)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  it("the GM adds to a player's 'gm' page: added, labelled 'GM' for the owner and the GM, with the GM's flags", async () => {
    const { s, pageId, own, gmAdded } = await pageFixture();
    const forOwner = await s.call.entries("p1", pageId);
    expect(forOwner.entries.map((e) => [e.text, e.added, e.authorLabel])).toEqual([
      ["find the ferryman", false, "Ash"],
      ["the ferryman lies", true, "GM"],
    ]);
    expect(forOwner).toMatchObject({ kind: "log", canAdd: true, canArrange: true, migrateTarget: null });
    expect(forOwner.entries.find((e) => e._id === gmAdded)).toMatchObject({ canEdit: false, canCycle: true, canDelete: true, canStar: true, canMove: true });
    const forGm = await s.call.entries("gm", pageId);
    expect(forGm).toMatchObject({ canAdd: true, canArrange: false, migrateTarget: null });
    expect(forGm.entries.find((e) => e._id === gmAdded)).toMatchObject({ added: true, authorLabel: "GM", canEdit: true, canCycle: true, canDelete: true, canStar: false });
    expect(forGm.entries.find((e) => e._id === own)).toMatchObject({ canEdit: false, canCycle: false, canDelete: false, canStar: false, canMove: false });
  });

  it("a player adds to a GM page shared with everyone: added, ending with their character's name (account name without one)", async () => {
    const s = await setup();
    await s.character("p1", "Ash");
    const { pageId } = await s.call.add("gm", { template: 1 }, "rumour: the mill burned");
    expect(await codeOf(s.call.entries("p1", pageId))).toBe("NOTE_PAGE_NOT_FOUND"); // 'private' by default (A4)
    await s.share(pageId, "everyone");
    await s.call.add("p1", pageId, "the miller fled north", "note");
    await s.call.add("p3", pageId, "I heard it too", "note");
    for (const who of ["gm", "p1", "p2"] as const) {
      const view = await s.call.entries(who, pageId);
      expect(view.entries.map((e) => [e.added, e.authorLabel])).toEqual([
        [false, "GM"],
        [true, "Ash"],
        [true, "Player"],
      ]);
    }
    await s.expectCounters();
  });

  it("the author edits and deletes their added entry; the owner deletes it but cannot edit it; a reader cannot star or move", async () => {
    const { s, pageId, own, gmAdded } = await pageFixture();
    await s.call.setText("gm", gmAdded, "  the ferryman lies twice  ");
    expect((await s.call.entries("p1", pageId)).entries.find((e) => e._id === gmAdded)?.text).toBe("the ferryman lies twice");
    expect(await codeOf(s.call.setText("p1", gmAdded, "no"))).toBe("NOTE_FORBIDDEN_ACTION");
    expect(await codeOf(s.call.toggleStar("gm", own))).toBe("NOTE_FORBIDDEN_ACTION");
    expect(await codeOf(s.call.moveUp("gm", gmAdded))).toBe("NOTE_FORBIDDEN_ACTION");
    expect(await codeOf(s.call.migrateOpen("gm", pageId))).toBe("NOTE_FORBIDDEN_ACTION");
    await s.call.remove("gm", gmAdded);
    const { entryId: again } = await s.call.add("gm", pageId, "one more");
    await s.call.remove("p1", again);
    expect((await s.call.entries("p1", pageId)).entries.map((e) => e._id)).toEqual([own]);
    await s.expectCounters();
  });

  it("any write on a departed journal answers NOTE_JOURNAL_CLOSED: the player removed, or their character dead (D2)", async () => {
    const { s, pageId, own, gmAdded } = await pageFixture();
    const ash = await s.t.run(async (ctx) => (await ctx.db.query("characters").collect())[0]!._id);
    await s.t.run((ctx) => ctx.db.patch("characters", ash, { status: "dead" }));
    expect(await codeOf(s.call.add("p1", pageId, "from beyond"))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.add("gm", pageId, "rest well"))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.add("p2", pageId, "goodbye"))).toBe("NOTE_JOURNAL_CLOSED"); // readable by everyone now (Q12)
    expect(await codeOf(s.call.cycle("p1", own))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.setText("gm", gmAdded, "x"))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.remove("gm", gmAdded))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.toggleStar("p1", own))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.migrateOpen("p1", pageId))).toBe("NOTE_JOURNAL_CLOSED");
    const forP2 = await s.call.entries("p2", pageId);
    expect(forP2).toMatchObject({ canAdd: false, canArrange: false });
    expect(forP2.entries.every((e) => !e.canEdit && !e.canCycle && !e.canDelete)).toBe(true);

    await s.t.run((ctx) => ctx.db.patch("characters", ash, { status: "active" }));
    await s.as("gm").mutation(api.members.removePlayer, { campaignId: s.campaignId, userId: s.ids.p1 });
    expect(await codeOf(s.call.add("gm", pageId, "gone"))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.add("p1", pageId, "me?"))).toBe("NOT_FOUND");
  });
});

describe("entries: states, star, order, text, mentions and caps (B4, D7, Q10)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  it("a template ref before the journal exists answers an empty page; the first add creates the journal (CL6)", async () => {
    const s = await setup();
    expect(await s.call.entries("p1", { template: 1 })).toEqual({ kind: "collection", canAdd: true, canArrange: true, migrateTarget: null, entries: [] });
    expect(await codeOf(s.call.entries("p1", { template: 9 }))).toBe("NOTE_PAGE_NOT_FOUND");
    const { pageId } = await s.call.add("p1", { template: 1 }, "Old Mag, the ferrywoman", "note");
    const page = await s.t.run((ctx) => ctx.db.get("journalPages", pageId));
    expect(page).toMatchObject({ title: "People we met", visibility: "gm", entryCount: 1, openCount: 0 });
    expect((await s.call.entries("p1", { template: 1 })).entries).toHaveLength(1);
    await s.expectCounters();
  });

  it("a task cycles open -> done -> migrated -> scheduled -> struck -> open; others open <-> done; open threads follow (B4, B5)", async () => {
    const { s, own } = await pageFixture();
    const states = [];
    for (let i = 0; i < 5; i++) {
      states.push((await s.call.cycle("p1", own)).state);
      await s.expectCounters();
    }
    expect(states).toEqual(["done", "migrated", "scheduled", "struck", "open"]);
    const { entryId: fear } = await s.call.add("p1", { template: 0 }, "the wither spreads", "fear");
    const { entryId: idea } = await s.call.add("p1", { template: 0 }, "ask the river spirit", "idea");
    expect((await s.call.cycle("p1", fear)).state).toBe("done");
    expect((await s.call.cycle("p1", idea)).state).toBe("done");
    expect((await s.call.cycle("p1", idea)).state).toBe("open");
    await s.expectCounters();
  });

  it("star toggles, ↑ swaps with the entry above (the first stays), text is trimmed and 1-500 characters", async () => {
    const { s, pageId, own, gmAdded } = await pageFixture();
    expect((await s.call.toggleStar("p1", own)).star).toBe(true);
    expect((await s.call.toggleStar("p1", own)).star).toBe(false);
    await s.call.moveUp("p1", gmAdded);
    expect((await s.call.entries("p1", pageId)).entries.map((e) => e._id)).toEqual([gmAdded, own]);
    await s.call.moveUp("p1", gmAdded);
    expect((await s.call.entries("p1", pageId)).entries.map((e) => e._id)).toEqual([gmAdded, own]);
    expect(await codeOf(s.call.add("p1", pageId, "   "))).toBe("INVALID");
    expect(await codeOf(s.call.add("p1", pageId, "x".repeat(501)))).toBe("INVALID");
    expect(await codeOf(s.call.add("p1", pageId, "x".repeat(500)))).toBe("ok");
    expect(await codeOf(s.call.setText("p1", own, ""))).toBe("INVALID");
  });

  it("mentions: a known Codex entry for a player, any for the GM; secret, foreign, malformed or more than 10 answer NOTE_MENTION_INVALID (D7)", async () => {
    const { s, pageId } = await pageFixture();
    const gm = s.as("gm");
    const { entryId: secret } = await gm.mutation(api.codex.create, { campaignId: s.campaignId, kind: "character", idempotencyKey: key() });
    const { entryId: known } = await gm.mutation(api.codex.create, { campaignId: s.campaignId, kind: "character", idempotencyKey: key() });
    await gm.mutation(api.codex.update, { entryId: known, patch: { name: "Old Mag", known: true } });
    const other = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const { entryId: foreign } = await gm.mutation(api.codex.create, { campaignId: other.campaignId, kind: "character", idempotencyKey: key() });

    expect(await codeOf(s.call.add("p1", pageId, `met ${formatToken("Old Mag", known)}`))).toBe("ok");
    expect(await codeOf(s.call.add("p1", pageId, `met ${formatToken("Someone", secret)}`))).toBe("NOTE_MENTION_INVALID");
    expect(await codeOf(s.call.add("gm", pageId, `met ${formatToken("Someone", secret)}`))).toBe("ok");
    expect(await codeOf(s.call.add("gm", pageId, `met ${formatToken("Far", foreign)}`))).toBe("NOTE_MENTION_INVALID");
    expect(await codeOf(s.call.add("p1", pageId, `met ${formatToken("Nobody", "not-an-id")}`))).toBe("NOTE_MENTION_INVALID");
    const eleven = Array.from({ length: 11 }, (_, i) => formatToken(`Mag ${i}`, known)).join(" ");
    expect(await codeOf(s.call.add("p1", pageId, eleven))).toBe("NOTE_MENTION_INVALID");
    const ten = Array.from({ length: 10 }, (_, i) => formatToken(`Mag ${i}`, known)).join(" ");
    expect(await codeOf(s.call.add("p1", pageId, ten))).toBe("ok");
    const { entryId } = await s.call.add("p1", pageId, "plain");
    expect(await codeOf(s.call.setText("p1", entryId, `with ${formatToken("Someone", secret)}`))).toBe("NOTE_MENTION_INVALID");
  });

  it("caps: NOTE_PAGE_FULL at 300 entries on a page, NOTE_JOURNAL_FULL at 5000 in a journal (Q10)", async () => {
    const { s, pageId } = await pageFixture();
    await s.t.run((ctx) => ctx.db.patch("journalPages", pageId, { entryCount: 300 }));
    expect(await codeOf(s.call.add("p1", pageId, "one too many"))).toBe("NOTE_PAGE_FULL");
    await s.t.run(async (ctx) => {
      await ctx.db.patch("journalPages", pageId, { entryCount: 2 });
      const page = await ctx.db.get("journalPages", pageId);
      await ctx.db.patch("journals", page!.journalId, { entryCount: 5000 });
    });
    expect(await codeOf(s.call.add("gm", pageId, "one too many"))).toBe("NOTE_JOURNAL_FULL");
  });

  it("Hope and Fear entries are labels only: adding and cycling them changes no Fear and no character (Q7)", async () => {
    const { s, pageId } = await pageFixture();
    const before = await s.t.run(async (ctx) => ({ campaign: await ctx.db.get("campaigns", s.campaignId), characters: await ctx.db.query("characters").collect() }));
    const { entryId: hope } = await s.call.add("p1", pageId, "the ferryman owes us", "hope");
    const { entryId: fear } = await s.call.add("gm", pageId, "ambush at the ford", "fear");
    await s.call.cycle("p1", hope);
    await s.call.cycle("gm", fear);
    const after = await s.t.run(async (ctx) => ({ campaign: await ctx.db.get("campaigns", s.campaignId), characters: await ctx.db.query("characters").collect() }));
    expect(after).toEqual(before);
    await s.expectCounters();
  });
});

describe("migrateOpen (B6, D5, D6)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  async function withTasks(s: Setup) {
    const { pageId } = await s.call.add("gm", { template: 0 }, "pay the ferryman");
    await s.call.add("gm", pageId, "a note", "note");
    const { entryId: done } = await s.call.add("gm", pageId, "already done");
    await s.call.cycle("gm", done);
    await s.call.toggleStar("gm", (await s.call.add("gm", pageId, "find the map")).entryId);
    return pageId;
  }

  it("to a new page: 'Session 2', default visibility, no session link; copies are open, keep author and star; originals migrated", async () => {
    const s = await setup();
    await s.character("p1", "Ash");
    const pageId = await withTasks(s);
    await s.share(pageId, "everyone");
    await s.call.add("p1", pageId, "bring rope");
    expect((await s.call.entries("gm", pageId)).migrateTarget).toBeNull();
    const { pageId: target, created } = await s.call.migrateOpen("gm", pageId);
    expect(created).toBe(true);
    const page = await s.t.run((ctx) => ctx.db.get("journalPages", target));
    expect(page).toMatchObject({ kind: "log", title: "Session 2", visibility: "private", tape: 4 });
    expect(page?.sessionId).toBeUndefined();
    const copies = await s.call.entries("gm", target);
    expect(copies.entries.map((e) => [e.text, e.state, e.star, e.added, e.authorLabel])).toEqual([
      ["pay the ferryman", "open", false, false, "GM"],
      ["find the map", "open", true, false, "GM"],
      ["bring rope", "open", false, true, "Ash"],
    ]);
    const source = await s.call.entries("gm", pageId);
    expect(source.entries.map((e) => [e.text, e.state])).toEqual([
      ["pay the ferryman", "migrated"],
      ["a note", "open"],
      ["already done", "done"],
      ["find the map", "migrated"],
      ["bring rope", "migrated"],
    ]);
    expect(await codeOf(s.call.migrateOpen("gm", pageId))).toBe("NOTE_NOTHING_TO_MIGRATE");
    await s.expectCounters();
  });

  it("to the first later page of the same kind; the query names it for the tooltip", async () => {
    const s = await setup();
    const rumors = (await s.call.add("gm", { template: 1 }, "the mill burned")).pageId;
    const loot = (await s.call.add("gm", { template: 2 }, "owe Mag 3 gold", "note")).pageId;
    // The default pages share one createdAt (as on the board), so none is "later": make Loot & debts later.
    expect((await s.call.entries("gm", rumors)).migrateTarget).toBeNull();
    await s.t.run(async (ctx) => {
      const page = await ctx.db.get("journalPages", rumors);
      await ctx.db.patch("journalPages", loot, { createdAt: page!.createdAt + 1 });
    });
    expect((await s.call.entries("gm", rumors)).migrateTarget).toEqual({ title: "Loot & debts" });
    const { pageId, created } = await s.call.migrateOpen("gm", rumors);
    expect({ pageId, created }).toEqual({ pageId: loot, created: false });
    expect((await s.call.entries("gm", loot)).entries.map((e) => e.text)).toEqual(["owe Mag 3 gold", "the mill burned"]);
    await s.expectCounters();
  });
});
