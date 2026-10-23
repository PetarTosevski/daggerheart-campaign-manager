import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { PURGE_PAGE_BATCH, PURGE_ROW_BUDGET } from "../../convex/notesBin";
import { BIN_TTL_MS } from "../../convex/lib/validators/notes";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D11 N7: the bin (convex/notesBin.ts). Role table (function x role -> expected ConvexError code, D12 folds it into
// tests/convex/authz-matrix.test.ts), departed journals (Q12, D2), the lists a torn-out page leaves (Q11), the
// counters, and the purge cron (rule 8): 30-day cut-off, batches, self-rescheduling, idempotence.

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const P3 = "p3@example.com";
const OUTSIDER = "outsider@example.com";
const DAY = 24 * 60 * 60 * 1000;

type Who = "gm" | "p1" | "p2" | "p3" | "outsider";
type Role = Who | "anon";
type Ref = Id<"journalPages"> | { template: number };

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
  const client = (who: Role) => (who === "anon" ? t : as(who));
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Bin", idempotencyKey: key() });
  for (const who of ["p1", "p2", "p3"] as const) {
    const code = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
    await as(who).mutation(api.members.joinByCode, { code });
  }
  async function character(owner: Who, name: string) {
    const now = Date.now();
    return t.run((ctx) =>
      ctx.db.insert("characters", { campaignId, ownerId: ids[owner], createdBy: ids[owner], status: "active", sheet: { name }, createdAt: now, updatedAt: now }),
    );
  }
  const call = {
    bin: (who: Role) => client(who).query(api.notesBin.bin, { campaignId }),
    binPage: (who: Role, page: Ref) => client(who).mutation(api.notesBin.binPage, { campaignId, page }),
    restorePage: (who: Role, page: Ref) => client(who).mutation(api.notesBin.restorePage, { campaignId, page }),
    journal: (who: Who) => as(who).query(api.notes.journal, { campaignId }),
    entries: (who: Who, page: Ref) => as(who).query(api.notesEntries.entries, { campaignId, page }),
    add: (who: Who, page: Ref, text: string) => as(who).mutation(api.notesEntries.add, { campaignId, page, kind: "task", text }),
  };
  /** A page's visibility and recipients set directly: sharing is N6's. */
  async function share(pageId: Id<"journalPages">, visibility: Doc<"journalPages">["visibility"], recipients: Who[] = []) {
    await t.run(async (ctx) => {
      await ctx.db.patch("journalPages", pageId, { visibility });
      for (const who of recipients) await ctx.db.insert("journalPageRecipients", { campaignId, pageId, userId: ids[who], addedAt: Date.now() });
    });
  }
  /** Every journal's counters equal the sums over its pages that are not torn out. */
  async function expectCounters() {
    await t.run(async (ctx) => {
      for (const journal of await ctx.db.query("journals").collect()) {
        const pages = await ctx.db.query("journalPages").withIndex("by_journal_binned", (q) => q.eq("journalId", journal._id)).collect();
        const live = pages.filter((p) => p.binnedAt === undefined);
        expect({ pages: journal.pageCount, entries: journal.entryCount, open: journal.openCount }).toEqual({
          pages: live.length,
          entries: live.reduce((n, p) => n + p.entryCount, 0),
          open: live.reduce((n, p) => n + p.openCount, 0),
        });
      }
    });
  }
  const page = (pageId: Id<"journalPages">) => t.run((ctx) => ctx.db.get("journalPages", pageId));
  return { t, ids, as, campaignId, character, call, share, expectCounters, page };
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
 * The role table's fixture: P1 (character 'Ash') owns 'Session 1' with one open task, shared as 'chosen' with the GM
 * and P2 (both read it); P3 is not chosen (cannot read it). `binned` = the same page already torn out by P1.
 */
async function fixture(binned = false) {
  const s = await setup();
  await s.character("p1", "Ash");
  const { pageId } = await s.call.add("p1", { template: 0 }, "find the ferryman");
  await s.share(pageId, "chosen", ["gm", "p2"]);
  if (binned) await s.call.binPage("p1", pageId);
  return { s, pageId };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

const ROLE_TABLE: {
  fn: string;
  binned: boolean;
  run: (f: Fixture, who: Role) => Promise<unknown>;
  expected: Record<Role, string>;
}[] = [
  {
    fn: "binPage (P1's live page)",
    binned: false,
    run: (f, who) => f.s.call.binPage(who, f.pageId),
    expected: {
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      p1: "ok",
      gm: "NOTE_FORBIDDEN_ACTION",
      p2: "NOTE_FORBIDDEN_ACTION",
      p3: "NOTE_PAGE_NOT_FOUND",
    },
  },
  {
    fn: "restorePage (P1 tore it out)",
    binned: true,
    run: (f, who) => f.s.call.restorePage(who, f.pageId),
    expected: {
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      p1: "ok",
      gm: "NOTE_PAGE_NOT_FOUND",
      p2: "NOTE_PAGE_NOT_FOUND",
      p3: "NOTE_PAGE_NOT_FOUND",
    },
  },
  {
    fn: "bin",
    binned: true,
    run: (f, who) => f.s.call.bin(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "ok", p3: "ok" },
  },
];

describe("notesBin role table (owner P1, GM and P2 chosen readers, P3 not chosen, outsider, anonymous)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  for (const row of ROLE_TABLE) {
    it(`${row.fn}: ${Object.entries(row.expected).map(([r, c]) => `${r} ${c}`).join(", ")}`, async () => {
      const f = await fixture(row.binned);
      const actual: Record<string, unknown> = {};
      for (const who of Object.keys(row.expected) as Role[]) {
        if (row.expected[who] !== "ok") actual[who] = await codeOf(row.run(f, who));
      }
      for (const who of Object.keys(row.expected) as Role[]) {
        if (row.expected[who] === "ok") actual[who] = await codeOf(row.run(await fixture(row.binned), who));
      }
      expect(actual).toEqual(row.expected);
      await f.s.expectCounters();
    });
  }

  it("bin lists only what the caller tore out: P1 sees the page with 30 days, the others an empty list", async () => {
    const { s, pageId } = await fixture(true);
    const stored = await s.page(pageId);
    expect(await s.call.bin("p1")).toEqual([
      { _id: pageId, title: "Session 1", kind: "log", tape: stored!.tape, binnedAt: stored!.binnedAt, purgeAt: stored!.binnedAt! + BIN_TTL_MS, from: null },
    ]);
    for (const who of ["gm", "p2", "p3"] as const) expect(await s.call.bin(who)).toEqual([]);
  });

  it("restoring twice, or a page that was never torn out, answers NOTE_NOT_BINNED; tearing out twice NOTE_FORBIDDEN_ACTION", async () => {
    const { s, pageId } = await fixture(true);
    expect(await codeOf(s.call.binPage("p1", pageId))).toBe("NOTE_FORBIDDEN_ACTION");
    await s.call.restorePage("p1", pageId);
    expect(await codeOf(s.call.restorePage("p1", pageId))).toBe("NOTE_NOT_BINNED");
    expect(await codeOf(s.call.restorePage("gm", pageId))).toBe("NOTE_NOT_BINNED"); // readable, not torn out
    expect(await codeOf(s.call.restorePage("p1", { template: 1 }))).toBe("NOTE_NOT_BINNED");
    await s.expectCounters();
  });
});

describe("tearing out and restoring (Q11)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  it("the page leaves the owner's journal and every reader at once, the counters drop, and Restore brings it all back", async () => {
    const { s, pageId } = await fixture();
    const before = await s.call.journal("p1");
    expect(before.journal).toMatchObject({ pageCount: 4, entryCount: 1, openCount: 1 });
    expect(await codeOf(s.call.entries("p2", pageId))).toBe("ok");

    await s.call.binPage("p1", pageId);
    const after = await s.call.journal("p1");
    expect(after.journal).toMatchObject({ pageCount: 3, entryCount: 0, openCount: 0 });
    expect("pages" in after && after.pages.map((p) => p._id)).not.toContain(pageId);
    expect(await s.page(pageId)).toMatchObject({ binnedBy: s.ids.p1 });
    for (const who of ["gm", "p2"] as const) expect(await codeOf(s.call.entries(who, pageId))).toBe("NOTE_PAGE_NOT_FOUND");
    expect((await s.call.entries("p1", pageId)).entries.map((e) => e.text)).toEqual(["find the ferryman"]); // read only in the bin
    expect(await codeOf(s.call.add("p1", pageId, "late"))).toBe("NOTE_FORBIDDEN_ACTION");
    await s.expectCounters();

    await s.call.restorePage("p1", pageId);
    const restored = await s.call.journal("p1");
    expect(restored.journal).toMatchObject({ pageCount: 4, entryCount: 1, openCount: 1 });
    const back = await s.page(pageId);
    expect([back?.binnedAt, back?.binnedBy, back?.visibility]).toEqual([undefined, undefined, "chosen"]);
    for (const who of ["gm", "p2"] as const) expect(await codeOf(s.call.entries(who, pageId))).toBe("ok"); // sharing kept
    expect(await s.call.bin("p1")).toEqual([]);
    await s.expectCounters();
  });

  it("a default page torn out before the journal exists creates the journal first and returns the page id", async () => {
    const s = await setup();
    const pageId = await s.call.binPage("gm", { template: 2 });
    const journal = await s.call.journal("gm");
    expect(journal.journal).toMatchObject({ pageCount: 3 });
    expect((await s.call.bin("gm")).map((r) => [r._id, r.title])).toEqual([[pageId, "Loot & debts"]]);
    await s.expectCounters();
  });
});

describe("departed journals (Q12, D2)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  /** P1 (character 'Ash') has an 'everyone' page, a 'players' page and a 'private' page. */
  async function departedFixture() {
    const s = await setup();
    const ash = await s.character("p1", "Ash");
    const { pageId: everyone } = await s.call.add("p1", { template: 0 }, "the map is fake");
    const { pageId: players } = await s.call.add("p1", { template: 1 }, "don't tell the GM");
    const { pageId: secret } = await s.call.add("p1", { template: 2 }, "my real name");
    await s.share(everyone, "everyone");
    await s.share(players, "players");
    await s.share(secret, "private");
    return { s, ash, everyone, players, secret };
  }

  it("removed player: the GM tears out the 'everyone' page, gets NOT_FOUND for the 'private' one, and restores it", async () => {
    const { s, everyone, secret } = await departedFixture();
    // Present journal: the GM is a reader only.
    expect(await codeOf(s.call.binPage("gm", everyone))).toBe("NOTE_FORBIDDEN_ACTION");
    await s.as("gm").mutation(api.members.removePlayer, { campaignId: s.campaignId, userId: s.ids.p1 });

    expect(await codeOf(s.call.binPage("gm", secret))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await codeOf(s.call.binPage("p2", everyone))).toBe("NOTE_FORBIDDEN_ACTION");
    expect(await codeOf(s.call.binPage("p1", everyone))).toBe("NOT_FOUND");
    await s.call.binPage("gm", everyone);
    expect(await codeOf(s.call.entries("p2", everyone))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await s.call.bin("gm")).toMatchObject([{ _id: everyone, title: "Session 1", from: "Ash" }]);
    expect(await s.call.bin("p2")).toEqual([]);
    await s.expectCounters();

    await s.call.restorePage("gm", everyone);
    expect(await codeOf(s.call.entries("p2", everyone))).toBe("ok");
    expect(await s.call.bin("gm")).toEqual([]);
    await s.expectCounters();
  });

  it("dead character: the owner gets NOTE_JOURNAL_CLOSED; the GM tears out the 'players' page and loses it when the character returns", async () => {
    const { s, ash, players } = await departedFixture();
    await s.t.run((ctx) => ctx.db.patch("characters", ash, { status: "dead" }));
    expect(await codeOf(s.call.binPage("p1", players))).toBe("NOTE_JOURNAL_CLOSED");
    await s.call.binPage("gm", players);
    expect(await s.call.bin("gm")).toMatchObject([{ _id: players, from: "Ash" }]);
    // The journal is still departed (frozen, D2): the GM's tear-out stands and only the GM restores it.
    expect(await s.call.bin("p1")).toEqual([]);
    expect(await codeOf(s.call.restorePage("p1", players))).toBe("NOTE_NOT_BINNED");

    // Back to 'active': the journal is present again and its 'players' page hidden from the GM (D1), so the GM's
    // access ends ("while they still have access").
    await s.t.run((ctx) => ctx.db.patch("characters", ash, { status: "active" }));
    expect(await s.call.bin("gm")).toEqual([]);
    expect(await codeOf(s.call.restorePage("gm", players))).toBe("NOTE_PAGE_NOT_FOUND");
    // dcm-bxp.81: the owner of the present journal now finds it in their bin and restores it.
    expect(await s.call.bin("p1")).toMatchObject([{ _id: players, title: "People we met", from: null }]);
    await s.call.restorePage("p1", players);
    const back = await s.page(players);
    expect([back?.binnedAt, back?.binnedBy, back?.visibility]).toEqual([undefined, undefined, "players"]);
    const view = await s.call.journal("p1");
    expect("pages" in view ? view.pages.map((p) => p._id) : []).toContain(players);
    expect(await s.call.bin("p1")).toEqual([]);
    expect(await codeOf(s.call.entries("p2", players))).toBe("ok");
    await s.expectCounters();
  });

  it("removed player who rejoins: the owner restores the page the GM tore out (dcm-bxp.81); others still cannot", async () => {
    const { s, everyone } = await departedFixture();
    await s.as("gm").mutation(api.members.removePlayer, { campaignId: s.campaignId, userId: s.ids.p1 });
    await s.call.binPage("gm", everyone);
    await s.expectCounters();

    const code = await s.as("gm").mutation(api.members.rotateJoinCode, { campaignId: s.campaignId });
    await s.as("p1").mutation(api.members.joinByCode, { code });
    // Present again: the GM still reads an 'everyone' page, so the GM may restore it too; so may the owner.
    expect(await s.call.bin("p1")).toMatchObject([{ _id: everyone, from: null }]);
    expect(await s.call.bin("gm")).toMatchObject([{ _id: everyone, from: "Ash" }]);
    expect(await codeOf(s.call.restorePage("p2", everyone))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await codeOf(s.call.restorePage("p3", everyone))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await codeOf(s.call.restorePage("outsider", everyone))).toBe("NOT_FOUND");
    expect(await codeOf(s.call.restorePage("anon", everyone))).toBe("UNAUTHENTICATED");
    await s.call.restorePage("p1", everyone);
    expect(await s.call.bin("p1")).toEqual([]);
    expect(await s.call.bin("gm")).toEqual([]);
    expect(await codeOf(s.call.restorePage("gm", everyone))).toBe("NOTE_NOT_BINNED"); // back, readable, not torn out
    expect(await codeOf(s.call.entries("p2", everyone))).toBe("ok");
    await s.expectCounters();
  });
});

describe("purgeBinned (rule 8, CD17)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Inserts a torn-out page into the journal of `pageId` with `entries` entries and one recipient, binned `days` ago. */
  async function binnedPage(s: Setup, journalId: Id<"journals">, days: number, entries: number, title = `Old ${days}`) {
    return s.t.run(async (ctx) => {
      const now = Date.now();
      const pageId = await ctx.db.insert("journalPages", {
        campaignId: s.campaignId,
        journalId,
        ownerId: s.ids.gm,
        kind: "collection",
        title,
        tape: 0,
        visibility: "chosen",
        binnedAt: now - days * DAY,
        binnedBy: s.ids.gm,
        entryCount: entries,
        openCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (let i = 0; i < entries; i++) {
        await ctx.db.insert("journalEntries", {
          campaignId: s.campaignId,
          journalId,
          pageId,
          authorId: s.ids.gm,
          kind: "note",
          state: "open",
          star: false,
          text: `line ${i}`,
          order: i,
          open: false,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.insert("journalPageRecipients", { campaignId: s.campaignId, pageId, userId: s.ids.p1, addedAt: now });
      return pageId;
    });
  }

  async function gmJournal(s: Setup) {
    await s.call.add("gm", { template: 0 }, "keep me");
    return (await s.call.journal("gm")).journal!._id;
  }

  const rowsOf = (s: Setup, pageId: Id<"journalPages">) =>
    s.t.run(async (ctx) => ({
      page: await ctx.db.get("journalPages", pageId),
      entries: (await ctx.db.query("journalEntries").withIndex("by_page_order", (q) => q.eq("pageId", pageId)).collect()).length,
      recipients: (await ctx.db.query("journalPageRecipients").withIndex("by_page_user", (q) => q.eq("pageId", pageId)).collect()).length,
    }));

  it("removes a 31-day-old page with its entries and recipients, keeps a 29-day-old one and live pages; a second run changes nothing", async () => {
    const s = await setup();
    const journalId = await gmJournal(s);
    const old = await binnedPage(s, journalId, 31, 3);
    const young = await binnedPage(s, journalId, 29, 2);
    await s.t.mutation(internal.notesBin.purgeBinned, {});
    expect(await rowsOf(s, old)).toEqual({ page: null, entries: 0, recipients: 0 });
    expect(await rowsOf(s, young)).toMatchObject({ entries: 2, recipients: 1 });
    expect((await rowsOf(s, young)).page).not.toBeNull();
    const snapshot = await s.t.run(async (ctx) => ({
      pages: (await ctx.db.query("journalPages").collect()).length,
      entries: (await ctx.db.query("journalEntries").collect()).length,
      recipients: (await ctx.db.query("journalPageRecipients").collect()).length,
      scheduled: (await ctx.db.system.query("_scheduled_functions").collect()).length,
    }));
    expect(snapshot).toMatchObject({ pages: 5, entries: 3, recipients: 1, scheduled: 0 }); // 4 default pages + young
    await s.t.mutation(internal.notesBin.purgeBinned, {});
    expect(
      await s.t.run(async (ctx) => ({
        pages: (await ctx.db.query("journalPages").collect()).length,
        entries: (await ctx.db.query("journalEntries").collect()).length,
        recipients: (await ctx.db.query("journalPageRecipients").collect()).length,
        scheduled: (await ctx.db.system.query("_scheduled_functions").collect()).length,
      })),
    ).toEqual(snapshot);
    expect((await s.call.journal("gm")).journal).toMatchObject({ pageCount: 4, entryCount: 1 });
  });

  it("more pages than one batch and a page with more rows than the budget: each run is bounded and reschedules itself until done", async () => {
    vi.useFakeTimers();
    const s = await setup();
    const journalId = await gmJournal(s);
    const big = await binnedPage(s, journalId, 40, PURGE_ROW_BUDGET + 50, "Big");
    const many: Id<"journalPages">[] = [];
    for (let i = 0; i < PURGE_PAGE_BATCH + 5; i++) many.push(await binnedPage(s, journalId, 35 + (i % 3), 1));
    const young = await binnedPage(s, journalId, 1, 1);

    await s.t.mutation(internal.notesBin.purgeBinned, {});
    const first = await s.t.run(async (ctx) => ({
      binned: (await ctx.db.query("journalPages").withIndex("by_binned", (q) => q.gte("binnedAt", 0)).collect()).length,
      scheduled: (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.state.kind === "pending").map((f) => f.name),
    }));
    // One run deleted at most PURGE_ROW_BUDGET rows: the big page (the oldest) is not finished, nothing else went.
    expect(first.binned).toBe(PURGE_PAGE_BATCH + 5 + 2);
    expect((await rowsOf(s, big)).entries).toBe(50);
    expect(first.scheduled).toEqual(["notesBin:purgeBinned"]);

    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of [big, ...many]) expect(await rowsOf(s, id)).toEqual({ page: null, entries: 0, recipients: 0 });
    expect((await rowsOf(s, young)).page).not.toBeNull();
    const runs = await s.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((f) => f.state.kind));
    // Run 1: 400 rows of the big page. Run 2: its last 50 rows + the next 24 pages (a full batch, so it reschedules).
    // Run 3: the last 6 pages; fewer than a batch, so it stops.
    expect(runs).toEqual(["success", "success"]);
    expect((await s.call.journal("gm")).journal).toMatchObject({ pageCount: 4, entryCount: 1 });
  });
});
