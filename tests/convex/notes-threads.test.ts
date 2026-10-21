import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { EXPORT_PAGES } from "../../convex/notesThreads";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D11 N4: open threads, search and the export (convex/notesThreads.ts). Role table (function x role -> expected
// ConvexError code, D12 folds it into tests/convex/authz-matrix.test.ts) and the rule that all three cover the
// caller's own current journal only (Q9, Q13): never a shared page, a page the caller can read, another journal's
// page or a torn-out page.

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const P3 = "p3@example.com";
const OUTSIDER = "outsider@example.com";

type Who = "gm" | "p1" | "p2" | "p3" | "outsider";
type Role = Who | "anon";
type PageRef = Id<"journalPages"> | { template: number };

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
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Notes", idempotencyKey: key() });
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
    threads: (who: Role) => client(who).query(api.notesThreads.threads, { campaignId }),
    search: (who: Role, text: string) => client(who).query(api.notesThreads.search, { campaignId, text }),
    exportPage: (who: Role, cursor: string | null = null) => client(who).query(api.notesThreads.exportPage, { campaignId, cursor }),
    add: (who: Who, page: PageRef, text: string, kind: Doc<"journalEntries">["kind"] = "task") =>
      as(who).mutation(api.notesEntries.add, { campaignId, page, kind, text }),
    cycle: (who: Who, entryId: Id<"journalEntries">) => as(who).mutation(api.notesEntries.cycle, { campaignId, entryId }),
  };
  async function share(pageId: Id<"journalPages">, visibility: Doc<"journalPages">["visibility"]) {
    await t.run((ctx) => ctx.db.patch("journalPages", pageId, { visibility }));
  }
  /** Every page of the caller's export, following the cursor. */
  async function exportAll(who: Who) {
    const pages: { id: string; title: string }[] = [];
    const entries: { pageId: string; text: string; addedBy?: string }[] = [];
    let cursor: string | null = null;
    let calls = 0;
    do {
      const chunk: Awaited<ReturnType<typeof call.exportPage>> = await call.exportPage(who, cursor);
      pages.push(...chunk.pages);
      entries.push(...chunk.entries);
      cursor = chunk.continueCursor;
      calls += 1;
    } while (cursor !== null && calls < 50);
    return { pages, entries, calls };
  }
  return { t, ids, as, campaignId, character, call, share, exportAll };
}

/**
 * P1 (character 'Ash') owns 'Session 1' (template 0, visibility 'gm') with an open task, a done task and the GM's
 * added open task, and 'People we met' (template 1) with an unresolved Fear. The GM owns 'Session 1' shared with
 * everyone, holding the GM's open task and P1's added open task (that one is in the GM's journal). P2 (character
 * 'Bryn') owns 'Session 1' with a task that also says 'ferryman'.
 */
async function fixture() {
  const s = await setup();
  await s.character("p1", "Ash");
  await s.character("p2", "Bryn");
  const { pageId: p1Log, entryId: p1Task } = await s.call.add("p1", { template: 0 }, "find the ferryman");
  const { entryId: p1Done } = await s.call.add("p1", p1Log, "pay the toll");
  await s.call.cycle("p1", p1Done);
  const { entryId: gmAdded } = await s.call.add("gm", p1Log, "the ferryman lies");
  const { pageId: p1People, entryId: p1Fear } = await s.call.add("p1", { template: 1 }, "ambush at the bridge", "fear");
  const { pageId: gmLog, entryId: gmTask } = await s.call.add("gm", { template: 0 }, "ferryman owes the GM");
  await s.share(gmLog, "everyone");
  const { entryId: p1OnGm } = await s.call.add("p1", gmLog, "ask the ferryman about the GM");
  const { pageId: p2Log, entryId: p2Task } = await s.call.add("p2", { template: 0 }, "follow the ferryman");
  return { s, p1Log, p1People, p1Task, p1Done, gmAdded, p1Fear, gmLog, gmTask, p1OnGm, p2Log, p2Task };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return errorCode(error);
  }
}

/** function x role -> expected code ('ok' = allowed; each answer holds the caller's own journal only, see below). */
const ROLE_TABLE: { fn: string; run: (f: Fixture, who: Role) => Promise<unknown>; expected: Record<Role, string> }[] = [
  {
    fn: "threads",
    run: (f, who) => f.s.call.threads(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", p2: "ok", p3: "ok", gm: "ok" },
  },
  {
    fn: "search",
    run: (f, who) => f.s.call.search(who, "ferryman"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", p2: "ok", p3: "ok", gm: "ok" },
  },
  {
    fn: "exportPage",
    run: (f, who) => f.s.call.exportPage(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", p2: "ok", p3: "ok", gm: "ok" },
  },
];

describe("notesThreads role table", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  for (const row of ROLE_TABLE) {
    it(`${row.fn}: anonymous, outsider, owner player, other player, player without a journal, GM`, async () => {
      const f = await fixture();
      const actual: Record<string, unknown> = {};
      for (const who of Object.keys(row.expected) as Role[]) actual[who] = await codeOf(row.run(f, who));
      expect(actual).toEqual(row.expected);
    });
  }
});

describe("notesThreads: own journal only (Q9, Q13)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  it("threads: open tasks and unresolved Fears of own pages, added entries included (D5), never another journal's", async () => {
    const f = await fixture();
    const p1 = await f.s.call.threads("p1");
    expect(p1.map((r) => r._id)).toEqual([f.p1Task, f.gmAdded, f.p1Fear]);
    expect(p1.map((r) => r.pageTitle)).toEqual(["Session 1", "Session 1", "People we met"]);
    expect(p1.find((r) => r._id === f.gmAdded)).toMatchObject({ added: true, authorLabel: "GM" });
    expect(p1.find((r) => r._id === f.p1Task)).toMatchObject({ added: false, authorLabel: "" });

    // The GM reads P1's page ('gm') but its threads are the GM's journal: the GM's task and P1's added one.
    const gm = await f.s.call.threads("gm");
    expect(gm.map((r) => r._id)).toEqual([f.gmTask, f.p1OnGm]);
    expect(gm.find((r) => r._id === f.p1OnGm)).toMatchObject({ added: true, authorLabel: "Ash" });

    // P2 reads the GM's 'everyone' page; its threads hold only its own task.
    expect((await f.s.call.threads("p2")).map((r) => r._id)).toEqual([f.p2Task]);
    // No journal yet: nothing.
    expect(await f.s.call.threads("p3")).toEqual([]);
  });

  it("threads: a completed task leaves the list; a torn-out page's entries are dropped", async () => {
    const f = await fixture();
    await f.s.call.cycle("p1", f.p1Task);
    expect((await f.s.call.threads("p1")).map((r) => r._id)).toEqual([f.gmAdded, f.p1Fear]);
    await f.s.t.run((ctx) => ctx.db.patch("journalPages", f.p1People, { binnedAt: Date.now(), binnedBy: f.s.ids.p1 }));
    expect((await f.s.call.threads("p1")).map((r) => r._id)).toEqual([f.gmAdded]);
  });

  it("search: own pages by title or entry text, never a page the caller can read in another journal", async () => {
    const f = await fixture();
    expect(await f.s.call.search("p1", "ferryman")).toEqual([f.p1Log]);
    expect(await f.s.call.search("p1", "FERRYMAN")).toEqual([f.p1Log]);
    expect(await f.s.call.search("p1", "people")).toEqual([f.p1People]);
    expect(await f.s.call.search("p1", "ambush")).toEqual([f.p1People]);
    expect(await f.s.call.search("gm", "ferryman")).toEqual([f.gmLog]);
    expect(await f.s.call.search("p2", "ferryman")).toEqual([f.p2Log]);
    expect(await f.s.call.search("p3", "ferryman")).toEqual([]);
    expect(await f.s.call.search("p1", "nothing like this")).toEqual([]);
  });

  it("search: a torn-out page is not found; mention ids do not match (N1 matches)", async () => {
    const f = await fixture();
    await f.s.t.run(async (ctx) => {
      const journal = (await ctx.db.get("journalPages", f.p1People))!.journalId;
      await ctx.db.insert("journalEntries", {
        campaignId: f.s.campaignId,
        journalId: journal,
        pageId: f.p1People,
        authorId: f.s.ids.p1,
        kind: "note",
        state: "open",
        star: false,
        text: "met @[Marlow](zzmentionid) at the inn",
        order: 99,
        open: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    // The deployed index splits '@[Marlow](zzmentionid)' into words and finds 'zzmentionid'; N1 `matches` reads the
    // token as 'Marlow' and drops the hit. (convex-test's index does not split on punctuation, so the name half of
    // this rule is covered by the N1 unit tests and the e2e search, not here.)
    expect(await f.s.call.search("p1", "zzmentionid")).toEqual([]);
    await f.s.t.run((ctx) => ctx.db.patch("journalPages", f.p1People, { binnedAt: Date.now(), binnedBy: f.s.ids.p1 }));
    expect(await f.s.call.search("p1", "ambush")).toEqual([]);
  });

  it("search: blank or longer than 80 characters is INVALID", async () => {
    const f = await fixture();
    expect(await codeOf(f.s.call.search("p1", "   "))).toBe("INVALID");
    expect(await codeOf(f.s.call.search("p1", "x".repeat(81)))).toBe("INVALID");
    expect(await codeOf(f.s.call.search("p1", "x".repeat(80)))).toBe("ok");
  });

  it("exportPage: own pages with their entries and added-entry authors, paginated, never another journal's page", async () => {
    const f = await fixture();
    // 4 default pages + 8 new ones = 12 pages > EXPORT_PAGES (10): two calls.
    for (let i = 0; i < 8; i++) await f.s.as("p1").mutation(api.notes.createPage, { campaignId: f.s.campaignId, kind: "collection" });
    const p1 = await f.s.exportAll("p1");
    expect(EXPORT_PAGES).toBe(10);
    expect(p1.calls).toBe(2);
    expect(p1.pages).toHaveLength(12);
    expect(new Set(p1.pages.map((p) => p.id)).size).toBe(12);
    expect(p1.pages.map((p) => p.id)).not.toContain(f.gmLog);
    expect(p1.entries.map((e) => e.text).sort()).toEqual(["ambush at the bridge", "find the ferryman", "pay the toll", "the ferryman lies"]);
    expect(p1.entries.find((e) => e.text === "the ferryman lies")?.addedBy).toBe("GM");
    expect(p1.entries.find((e) => e.text === "find the ferryman")?.addedBy).toBeUndefined();
    // P1's line on the GM's page is the GM's export, labelled with P1's character.
    const gm = await f.s.exportAll("gm");
    expect(gm.pages.map((p) => p.id)).not.toContain(f.p1Log);
    expect(gm.entries.map((e) => e.text).sort()).toEqual(["ask the ferryman about the GM", "ferryman owes the GM"]);
    expect(gm.entries.find((e) => e.text === "ask the ferryman about the GM")?.addedBy).toBe("Ash");
    // P2 exports its own pages only; P3 (no journal) nothing.
    expect((await f.s.exportAll("p2")).entries.map((e) => e.text)).toEqual(["follow the ferryman"]);
    expect(await f.s.call.exportPage("p3")).toEqual({ pages: [], entries: [], continueCursor: null });
  });

  it("exportPage: a torn-out page is left out", async () => {
    const f = await fixture();
    await f.s.t.run((ctx) => ctx.db.patch("journalPages", f.p1People, { binnedAt: Date.now(), binnedBy: f.s.ids.p1 }));
    const p1 = await f.s.exportAll("p1");
    expect(p1.pages.map((p) => p.id)).not.toContain(f.p1People);
    expect(p1.entries.map((e) => e.text)).not.toContain("ambush at the bridge");
  });
});
