import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D11 N6: sharing (convex/notesSharing.ts). Role tables (function x role -> expected ConvexError code; D12 folds them
// into tests/convex/authz-matrix.test.ts) and the read matrix: every visibility x owner (GM or player) x viewer (owner,
// GM, chosen player, player not chosen, outsider, anonymous), on present and departed journals (D1, Q12), checked both
// on `notesEntries.entries` (the page itself) and on the Shared tabs. Expected values are written out by hand from the
// plan's visibility table, never computed with N1's canReadPage.

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const P3 = "p3@example.com";
const OUTSIDER = "outsider@example.com";

type Who = "gm" | "p1" | "p2" | "p3" | "outsider";
type Viewer = Who | "anon";
type Visibility = Doc<"journalPages">["visibility"];
type PageRef = Id<"journalPages"> | { template: number };

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1, name: "Gwen" }),
    p1: await ctx.db.insert("users", { email: P1, emailVerificationTime: 1, name: "Petra" }),
    p2: await ctx.db.insert("users", { email: P2, emailVerificationTime: 1, name: "Quinn" }),
    p3: await ctx.db.insert("users", { email: P3, emailVerificationTime: 1, name: "Rae" }),
    outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
  }));
  const as = (who: Who) => t.withIdentity({ subject: `${ids[who]}|s` });
  const client = (who: Viewer) => (who === "anon" ? t : as(who));
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Notes", idempotencyKey: key() });
  async function join(who: Who) {
    const code = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
    await as(who).mutation(api.members.joinByCode, { code });
  }
  for (const who of ["p1", "p2", "p3"] as const) await join(who);
  async function character(owner: Who, name: string) {
    const now = Date.now();
    return t.run((ctx) =>
      ctx.db.insert("characters", { campaignId, ownerId: ids[owner], createdBy: ids[owner], status: "active", sheet: { name }, createdAt: now, updatedAt: now }),
    );
  }
  const characters = { p1: await character("p1", "Ash"), p2: await character("p2", "Bram"), p3: await character("p3", "Cole") };
  const call = {
    createPage: (who: Who) => as(who).mutation(api.notes.createPage, { campaignId, kind: "collection" }),
    setVisibility: (who: Viewer, page: PageRef, visibility: Visibility) =>
      client(who).mutation(api.notesSharing.setVisibility, { campaignId, page, visibility }),
    addRecipient: (who: Viewer, page: PageRef, userId: string) => client(who).mutation(api.notesSharing.addRecipient, { campaignId, page, userId }),
    removeRecipient: (who: Viewer, page: PageRef, userId: string) =>
      client(who).mutation(api.notesSharing.removeRecipient, { campaignId, page, userId }),
    recipients: (who: Viewer, page: PageRef) => client(who).query(api.notesSharing.recipients, { campaignId, page }),
    shared: (who: Viewer, tab: "players" | "gm") => client(who).query(api.notesSharing.shared, { campaignId, tab }),
    entries: (who: Viewer, page: PageRef) => client(who).query(api.notesEntries.entries, { campaignId, page }),
    add: (who: Viewer, page: PageRef, text: string) => client(who).mutation(api.notesEntries.add, { campaignId, page, kind: "note", text }),
  };
  /** A new page of `owner` with the visibility and recipients set through the N6 functions. */
  async function sharedPage(owner: Who, visibility: Visibility, recipients: Who[] = []) {
    const pageId = await call.createPage(owner);
    await call.setVisibility(owner, pageId, visibility);
    for (const who of recipients) await call.addRecipient(owner, pageId, ids[who]);
    return pageId;
  }
  async function recipientRows(pageId: Id<"journalPages">) {
    return t.run((ctx) =>
      ctx.db
        .query("journalPageRecipients")
        .withIndex("by_page_user", (q) => q.eq("pageId", pageId))
        .collect(),
    );
  }
  return { t, ids, as, campaignId, join, characters, call, sharedPage, recipientRows };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return errorCode(error);
  }
}

const NF = "NOTE_PAGE_NOT_FOUND";
const VIEWERS: Viewer[] = ["p1", "gm", "p2", "p3", "outsider", "anon"];

/** Who reads a page, by hand from the plan's visibility table. p2 is the chosen player, p3 the one not chosen. */
type ReadCase = { name: string; owner: "gm" | "p1"; visibility: Visibility; recipients?: Who[]; read: Record<Viewer, unknown> };

const present = (gm: unknown, p1: unknown, p2: unknown, p3: unknown): Record<Viewer, unknown> => ({
  gm,
  p1,
  p2,
  p3,
  outsider: "NOT_FOUND",
  anon: "UNAUTHENTICATED",
});

const PRESENT_CASES: ReadCase[] = [
  // A player's page (A3, A4, Q4, D4): owner p1.
  { name: "player 'gm' (default): the GM only", owner: "p1", visibility: "gm", read: present("ok", "ok", NF, NF) },
  { name: "player 'private': nobody", owner: "p1", visibility: "private", read: present(NF, "ok", NF, NF) },
  { name: "player 'players': the other players, not the GM", owner: "p1", visibility: "players", read: present(NF, "ok", "ok", "ok") },
  { name: "player 'everyone': every member", owner: "p1", visibility: "everyone", read: present("ok", "ok", "ok", "ok") },
  { name: "player 'chosen' [p2]: p2, not the GM (D4)", owner: "p1", visibility: "chosen", recipients: ["p2"], read: present(NF, "ok", "ok", NF) },
  { name: "player 'chosen' [p2, GM]: p2 and the ticked GM (D4)", owner: "p1", visibility: "chosen", recipients: ["p2", "gm"], read: present("ok", "ok", "ok", NF) },
  { name: "player 'chosen' [nobody]: nobody", owner: "p1", visibility: "chosen", read: present(NF, "ok", NF, NF) },
  // The GM's page (A4, A5).
  { name: "GM 'private' (default): nobody", owner: "gm", visibility: "private", read: present("ok", NF, NF, NF) },
  { name: "GM 'everyone': every player", owner: "gm", visibility: "everyone", read: present("ok", "ok", "ok", "ok") },
  { name: "GM 'chosen' [p2]: p2 only", owner: "gm", visibility: "chosen", recipients: ["p2"], read: present("ok", NF, "ok", NF) },
  { name: "GM 'chosen' [p1, p2]: p1 and p2", owner: "gm", visibility: "chosen", recipients: ["p1", "p2"], read: present("ok", "ok", "ok", NF) },
];

/** The tab a page is listed in, and whether `viewer` sees it there (readable, not their own; the GM sees own shared). */
async function listed(s: Setup, viewer: Viewer, pageId: Id<"journalPages">, owner: "gm" | "p1"): Promise<boolean | string> {
  const tab = owner === "gm" ? "gm" : "players";
  const result = await codeOf(s.call.shared(viewer, tab));
  if (result !== "ok") return result as string;
  const rows = await s.call.shared(viewer, tab);
  return rows.some((r) => r.pageId === pageId);
}

describe("notesSharing read matrix: visibility x owner x viewer, journal present", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  it("every case reads exactly as the table says, on the page and in the Shared tabs", async () => {
    const s = await setup();
    const pages: { c: ReadCase; pageId: Id<"journalPages"> }[] = [];
    for (const c of PRESENT_CASES) pages.push({ c, pageId: await s.sharedPage(c.owner, c.visibility, c.recipients ?? []) });

    for (const { c, pageId } of pages) {
      const actual: Record<string, unknown> = {};
      for (const viewer of VIEWERS) actual[viewer] = await codeOf(s.call.entries(viewer, pageId));
      expect({ case: c.name, read: actual }).toEqual({ case: c.name, read: c.read });

      // The Shared tab lists the page for exactly the readers who do not own it; the GM also sees their own shared page.
      const list: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const viewer of VIEWERS) {
        list[viewer] = await listed(s, viewer, pageId, c.owner);
        const reads = c.read[viewer] === "ok";
        if (viewer === "outsider") expected[viewer] = "NOT_FOUND";
        else if (viewer === "anon") expected[viewer] = "UNAUTHENTICATED";
        else if (viewer === c.owner) expected[viewer] = c.owner === "gm" && c.visibility !== "private";
        else expected[viewer] = reads;
      }
      expect({ case: c.name, listed: list }).toEqual({ case: c.name, listed: expected });
    }
  });

  it("a reader who can read adds an entry; one who cannot gets NOTE_PAGE_NOT_FOUND (Q3)", async () => {
    const s = await setup();
    const gmChosen = await s.sharedPage("gm", "chosen", ["p2"]);
    expect(await codeOf(s.call.add("p2", gmChosen, "I was here"))).toBe("ok");
    expect(await codeOf(s.call.add("p3", gmChosen, "me too"))).toBe(NF);
    expect((await s.call.entries("p2", gmChosen)).entries.map((e) => [e.text, e.added, e.authorLabel])).toEqual([["I was here", true, "Bram"]]);
  });
});

describe("notesSharing read matrix: departed journals (D1, Q12)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  /** p1's pages, one per visibility (chosen ticks p2 only). */
  async function playerPages(s: Setup) {
    const out: Partial<Record<Visibility, Id<"journalPages">>> = {};
    for (const v of ["gm", "private", "players", "everyone", "chosen"] as const) out[v] = await s.sharedPage("p1", v, v === "chosen" ? ["p2"] : []);
    return out as Record<Visibility, Id<"journalPages">>;
  }

  async function readTable(s: Setup, pages: Record<Visibility, Id<"journalPages">>) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [v, pageId] of Object.entries(pages)) {
      out[v] = {};
      for (const viewer of VIEWERS) out[v][viewer] = await codeOf(s.call.entries(viewer, pageId));
    }
    return out;
  }

  async function playersTab(s: Setup, viewer: Who, pages: Record<Visibility, Id<"journalPages">>) {
    const rows = await s.call.shared(viewer, "players");
    const ids = new Set(rows.map((r) => r.pageId));
    return Object.entries(pages)
      .filter(([, id]) => ids.has(id))
      .map(([v]) => v)
      .sort();
  }

  const all = (owner: unknown): Record<Viewer, unknown> => present("ok", owner, "ok", "ok");
  const ownerOnly = (owner: unknown): Record<Viewer, unknown> => present(NF, owner, NF, NF);

  it("a dead character: every page but Private reads for every member; nothing is in Shared; a status back to active restores", async () => {
    const s = await setup();
    const pages = await playerPages(s);
    await s.t.run((ctx) => ctx.db.patch("characters", s.characters.p1, { status: "dead" }));
    expect(await readTable(s, pages)).toEqual({
      gm: all("ok"),
      private: ownerOnly("ok"),
      players: all("ok"),
      everyone: all("ok"),
      chosen: all("ok"),
    });
    // Departed pages are under Past journals (N8), not in the Shared tabs.
    for (const viewer of ["gm", "p2", "p3"] as const) expect(await playersTab(s, viewer, pages)).toEqual([]);
    // Frozen (D2): the owner may not change the sharing.
    expect(await codeOf(s.call.setVisibility("p1", pages.gm, "everyone"))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.call.addRecipient("p1", pages.chosen, s.ids.p3))).toBe("NOTE_JOURNAL_CLOSED");

    await s.t.run((ctx) => ctx.db.patch("characters", s.characters.p1, { status: "active" }));
    expect(await readTable(s, pages)).toEqual(PRESENT_TABLE);
  });

  it("a retired character departs too; 'away' does not", async () => {
    const s = await setup();
    const pages = await playerPages(s);
    await s.t.run((ctx) => ctx.db.patch("characters", s.characters.p1, { status: "away" }));
    expect(await readTable(s, pages)).toEqual(PRESENT_TABLE);
    await s.t.run((ctx) => ctx.db.patch("characters", s.characters.p1, { status: "retired" }));
    expect((await readTable(s, pages)).gm).toEqual(all("ok"));
    expect((await readTable(s, pages)).private).toEqual(ownerOnly("ok"));
  });

  it("the player leaves: the GM and players read every page but Private, the former owner reads nothing; a rejoin restores", async () => {
    const s = await setup();
    const pages = await playerPages(s);
    await s.as("p1").mutation(api.members.leave, { campaignId: s.campaignId });
    expect(await readTable(s, pages)).toEqual({
      gm: all("NOT_FOUND"),
      private: ownerOnly("NOT_FOUND"),
      players: all("NOT_FOUND"),
      everyone: all("NOT_FOUND"),
      chosen: all("NOT_FOUND"),
    });
    for (const viewer of ["gm", "p2", "p3"] as const) expect(await playersTab(s, viewer, pages)).toEqual([]);

    await s.join("p1");
    expect(await readTable(s, pages)).toEqual(PRESENT_TABLE);
    expect(await playersTab(s, "gm", pages)).toEqual(["everyone", "gm"]);
    expect(await playersTab(s, "p2", pages)).toEqual(["chosen", "everyone", "players"]);
    expect(await playersTab(s, "p3", pages)).toEqual(["everyone", "players"]);
  });

  it("the GM removes the player: same as leaving", async () => {
    const s = await setup();
    const pages = await playerPages(s);
    await s.as("gm").mutation(api.members.removePlayer, { campaignId: s.campaignId, userId: s.ids.p1 });
    expect((await readTable(s, pages)).players).toEqual(all("NOT_FOUND"));
    expect((await readTable(s, pages)).private).toEqual(ownerOnly("NOT_FOUND"));
  });
});

/** p1's five pages on a present journal (chosen ticks p2). */
const PRESENT_TABLE: Record<string, Record<Viewer, unknown>> = {
  gm: present("ok", "ok", NF, NF),
  private: present(NF, "ok", NF, NF),
  players: present(NF, "ok", "ok", "ok"),
  everyone: present("ok", "ok", "ok", "ok"),
  chosen: present(NF, "ok", "ok", NF),
};

// ---------------------------------------------------------------- role table of the functions

type Fixture = { s: Setup; playerPage: Id<"journalPages">; gmPage: Id<"journalPages"> };

/** p1's page 'chosen' for p2; the GM's page 'chosen' for p2. */
async function fixture(): Promise<Fixture> {
  const s = await setup();
  return { s, playerPage: await s.sharedPage("p1", "chosen", ["p2"]), gmPage: await s.sharedPage("gm", "chosen", ["p2"]) };
}

const ROLE_TABLE: { fn: string; run: (f: Fixture, who: Viewer) => Promise<unknown>; expected: Record<Viewer, unknown> }[] = [
  {
    fn: "setVisibility (player page)",
    run: (f, who) => f.s.call.setVisibility(who, f.playerPage, "everyone"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "setVisibility (GM page)",
    run: (f, who) => f.s.call.setVisibility(who, f.gmPage, "everyone"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", gm: "ok", p1: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "addRecipient (player page, p3)",
    run: (f, who) => f.s.call.addRecipient(who, f.playerPage, f.s.ids.p3),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "addRecipient (GM page, p3)",
    run: (f, who) => f.s.call.addRecipient(who, f.gmPage, f.s.ids.p3),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", gm: "ok", p1: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "removeRecipient (player page, p2)",
    run: (f, who) => f.s.call.removeRecipient(who, f.playerPage, f.s.ids.p2),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "removeRecipient (GM page, p2)",
    run: (f, who) => f.s.call.removeRecipient(who, f.gmPage, f.s.ids.p2),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", gm: "ok", p1: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "recipients (player page)",
    run: (f, who) => f.s.call.recipients(who, f.playerPage),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "recipients (GM page)",
    run: (f, who) => f.s.call.recipients(who, f.gmPage),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", gm: "ok", p1: NF, p2: "NOTE_FORBIDDEN_ACTION", p3: NF },
  },
  {
    fn: "shared ('players')",
    run: (f, who) => f.s.call.shared(who, "players"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", gm: "ok", p1: "ok", p2: "ok", p3: "ok" },
  },
  {
    fn: "shared ('gm')",
    run: (f, who) => f.s.call.shared(who, "gm"),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", gm: "ok", p1: "ok", p2: "ok", p3: "ok" },
  },
];

describe("notesSharing role table (owner, GM, chosen player p2, player p3 not chosen, outsider, anonymous)", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  for (const row of ROLE_TABLE) {
    it(`${row.fn}: ${Object.entries(row.expected)
      .map(([r, c]) => `${r} ${String(c)}`)
      .join(", ")}`, async () => {
      const f = await fixture();
      const actual: Record<string, unknown> = {};
      // Denied roles first (they change nothing), then each allowed one on a fresh fixture.
      for (const who of Object.keys(row.expected) as Viewer[]) if (row.expected[who] !== "ok") actual[who] = await codeOf(row.run(f, who));
      for (const who of Object.keys(row.expected) as Viewer[]) if (row.expected[who] === "ok") actual[who] = await codeOf(row.run(await fixture(), who));
      expect(actual).toEqual(row.expected);
    });
  }

  it("a grant-only user (no campaign role) gets NOT_FOUND from the Shared tabs", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.insert("grants", {
        resourceType: "campaign",
        resourceId: s.campaignId,
        principalKind: "user",
        principalId: s.ids.outsider,
        permission: "view",
        createdBy: s.ids.gm,
        createdAt: Date.now(),
      }),
    );
    expect(await codeOf(s.call.shared("outsider", "players"))).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------- behaviour

describe("notesSharing behaviour", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  it("the GM may not set 'gm' or 'players' (NOTE_VISIBILITY_INVALID); a player may set all five", async () => {
    const s = await setup();
    const gmPage = await s.call.createPage("gm");
    expect(await codeOf(s.call.setVisibility("gm", gmPage, "players"))).toBe("NOTE_VISIBILITY_INVALID");
    expect(await codeOf(s.call.setVisibility("gm", gmPage, "gm"))).toBe("NOTE_VISIBILITY_INVALID");
    for (const v of ["private", "everyone", "chosen"] as const) expect(await codeOf(s.call.setVisibility("gm", gmPage, v))).toBe("ok");
    const playerPage = await s.call.createPage("p1");
    for (const v of ["private", "players", "everyone", "chosen", "gm"] as const) expect(await codeOf(s.call.setVisibility("p1", playerPage, v))).toBe("ok");
  });

  it("a template ref creates the journal with its default pages and shares the default page", async () => {
    const s = await setup();
    await s.call.setVisibility("p1", { template: 1 }, "everyone");
    const journal = await s.as("p1").query(api.notes.journal, { campaignId: s.campaignId });
    if (journal.journal === null) throw new Error("journal missing");
    expect(journal.pages.map((p) => [p.title, p.visibility])).toEqual([
      ["Session 1", "gm"],
      ["People we met", "everyone"],
      ["Clues & secrets", "gm"],
      ["My goals", "gm"],
    ]);
    expect((await s.call.shared("p2", "players")).map((r) => [r.title, r.ownerName, r.chip])).toEqual([["People we met", "Ash", "Everyone"]]);
  });

  it("recipients: one row per (page, user); adding twice is a no-op; only members other than the owner (D4)", async () => {
    const s = await setup();
    const page = await s.sharedPage("p1", "chosen");
    await s.call.addRecipient("p1", page, s.ids.p2);
    await s.call.addRecipient("p1", page, s.ids.p2);
    expect((await s.recipientRows(page)).map((r) => r.userId)).toEqual([s.ids.p2]);
    // The GM may be ticked on a player's page (D4); the owner, an outsider, a malformed id may not.
    expect(await codeOf(s.call.addRecipient("p1", page, s.ids.gm))).toBe("ok");
    expect(await codeOf(s.call.addRecipient("p1", page, s.ids.p1))).toBe("NOTE_RECIPIENT_INVALID");
    expect(await codeOf(s.call.addRecipient("p1", page, s.ids.outsider))).toBe("NOTE_RECIPIENT_INVALID");
    expect(await codeOf(s.call.addRecipient("p1", page, "not-an-id"))).toBe("NOTE_RECIPIENT_INVALID");
    // The GM's page: players only, never the GM.
    const gmPage = await s.sharedPage("gm", "chosen");
    expect(await codeOf(s.call.addRecipient("gm", gmPage, s.ids.gm))).toBe("NOTE_RECIPIENT_INVALID");
    expect(await codeOf(s.call.addRecipient("gm", gmPage, s.ids.outsider))).toBe("NOTE_RECIPIENT_INVALID");
    // A pending invitee is not a member yet.
    await s.as("gm").mutation(api.members.invite, { campaignId: s.campaignId, email: OUTSIDER });
    expect(await codeOf(s.call.addRecipient("gm", gmPage, s.ids.outsider))).toBe("NOTE_RECIPIENT_INVALID");
    // Recipients only on a 'chosen' page.
    const open = await s.sharedPage("p1", "everyone");
    expect(await codeOf(s.call.addRecipient("p1", open, s.ids.p2))).toBe("NOTE_RECIPIENT_INVALID");
    expect(await codeOf(s.call.removeRecipient("p1", open, s.ids.p2))).toBe("NOTE_RECIPIENT_INVALID");
    // Removing someone not ticked is a no-op.
    expect(await codeOf(s.call.removeRecipient("p1", page, s.ids.p3))).toBe("ok");
  });

  it("a GM page shared with A only: A lists and reads it, B neither; removing A hides it at once; 'everyone' shows it to B", async () => {
    const s = await setup();
    const page = await s.sharedPage("gm", "chosen", ["p1"]);
    const titles = async (who: Who) => (await s.call.shared(who, "gm")).map((r) => r.pageId);
    expect(await titles("p1")).toEqual([page]);
    expect(await codeOf(s.call.entries("p1", page))).toBe("ok");
    expect(await titles("p2")).toEqual([]);
    expect(await codeOf(s.call.entries("p2", page))).toBe(NF);

    await s.call.removeRecipient("gm", page, s.ids.p1);
    expect(await titles("p1")).toEqual([]);
    expect(await codeOf(s.call.entries("p1", page))).toBe(NF);

    await s.call.setVisibility("gm", page, "everyone");
    expect(await titles("p2")).toEqual([page]);
    expect(await codeOf(s.call.entries("p2", page))).toBe("ok");
  });

  it("leaving 'chosen' deletes the recipient rows; choosing again starts with nobody", async () => {
    const s = await setup();
    const page = await s.sharedPage("p1", "chosen", ["p2", "gm"]);
    expect(await s.recipientRows(page)).toHaveLength(2);
    await s.call.setVisibility("p1", page, "players");
    expect(await s.recipientRows(page)).toEqual([]);
    await s.call.setVisibility("p1", page, "chosen");
    expect(await codeOf(s.call.entries("p2", page))).toBe(NF);
    expect(await codeOf(s.call.entries("gm", page))).toBe(NF);
    expect((await s.call.recipients("p1", page)).every((r) => !r.chosen)).toBe(true);
  });

  it("a player's chosen page is hidden from the GM until the player ticks the GM (D4)", async () => {
    const s = await setup();
    const page = await s.sharedPage("p1", "chosen", ["p2"]);
    const gmList = async () => (await s.call.shared("gm", "players")).some((r) => r.pageId === page);
    expect(await gmList()).toBe(false);
    expect(await codeOf(s.call.entries("gm", page))).toBe(NF);
    await s.call.addRecipient("p1", page, s.ids.gm);
    expect(await gmList()).toBe(true);
    expect(await codeOf(s.call.entries("gm", page))).toBe("ok");
    expect(await codeOf(s.call.add("gm", page, "noted"))).toBe("ok");
  });

  it("recipients lists the eligible members with a chosen flag: the GM's page the players, a player's page the GM first", async () => {
    const s = await setup();
    const gmPage = await s.sharedPage("gm", "chosen", ["p2"]);
    expect((await s.call.recipients("gm", gmPage)).map((r) => [r.name, r.isGm, r.chosen])).toEqual([
      ["Ash", false, false],
      ["Bram", false, true],
      ["Cole", false, false],
    ]);
    const playerPage = await s.sharedPage("p1", "chosen", ["gm"]);
    expect((await s.call.recipients("p1", playerPage)).map((r) => [r.name, r.isGm, r.chosen])).toEqual([
      ["GM", true, true],
      ["Bram", false, false],
      ["Cole", false, false],
    ]);
    // Before the journal exists: a template ref answers with nobody chosen.
    expect((await s.call.recipients("p3", { template: 0 })).map((r) => r.name)).toEqual(["GM", "Ash", "Bram"]);
  });

  it("'Shared by GM' for the GM lists their own shared pages with who reads them; rows carry owner and chip", async () => {
    const s = await setup();
    await s.sharedPage("gm", "private");
    const everyone = await s.sharedPage("gm", "everyone");
    const chosen = await s.sharedPage("gm", "chosen", ["p1", "p3"]);
    const rows = await s.call.shared("gm", "gm");
    expect(rows.map((r) => [r.pageId, r.own, r.ownerName, r.chip])).toEqual([
      [everyone, true, "Game Master", "Everyone"],
      [chosen, true, "Game Master", "Chosen players · Ash, Cole"],
    ]);
    expect((await s.call.shared("p1", "gm")).map((r) => [r.pageId, r.own, r.chip])).toEqual([
      [everyone, false, "Everyone"],
      [chosen, false, "Chosen players"],
    ]);
  });

  it("'Shared by players' leaves out own pages, torn-out pages and the GM's pages, and groups by owner", async () => {
    const s = await setup();
    const p1Page = await s.sharedPage("p1", "everyone");
    const p2Page = await s.sharedPage("p2", "players");
    await s.sharedPage("gm", "everyone");
    const p2Rows = await s.call.shared("p2", "players");
    expect(p2Rows.map((r) => r.pageId)).toEqual([p1Page]);
    const p3Rows = await s.call.shared("p3", "players");
    expect(p3Rows.map((r) => [r.ownerName, r.pageId])).toEqual([
      ["Ash", p1Page],
      ["Bram", p2Page],
    ]);
    await s.t.run((ctx) => ctx.db.patch("journalPages", p1Page, { binnedAt: Date.now(), binnedBy: s.ids.p1 }));
    expect((await s.call.shared("p3", "players")).map((r) => r.pageId)).toEqual([p2Page]);
  });
});
