import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PageVisibility } from "../../convex/lib/validators/notes";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D11 N8: other people's journals (convex/notesJournals.ts). The role table (function x role -> expected ConvexError
// code, D12 folds it into tests/convex/authz-matrix.test.ts), what the GM reads in a player's journal (Q2, D4), and
// the departure cycle (Q12, D1, D2): members.removePlayer, characters.setStatus 'dead' / 'retired' (and not 'away'),
// then joinByCode / 'active' bringing the previous visibility back; the GM tears out a past journal's page.

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const OUTSIDER = "outsider@example.com";

type Who = "gm" | "p1" | "p2" | "outsider";
type Role = Who | "anon";

function draft(name: string, classId = "warrior") {
  const cls = getClass(classId)!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass(classId)[0]!.id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

/**
 * A campaign with the GM, P1 (Ash the Warrior) and P2 (Bram the Bard). P1's journal has one page per visibility, each
 * titled after it: 'gm', 'private', 'players', 'everyone', 'chosen gm' (GM and P2 ticked) and 'chosen p2' (P2 only,
 * D4). P2's journal has its four default pages ('gm').
 */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
    p1: await ctx.db.insert("users", { email: P1, emailVerificationTime: 1, name: "Petra" }),
    p2: await ctx.db.insert("users", { email: P2, emailVerificationTime: 1, name: "Quinn" }),
    outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
  }));
  const as = (who: Who) => t.withIdentity({ subject: `${ids[who]}|s` });
  const client = (who: Role) => (who === "anon" ? t : as(who));
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Journals", idempotencyKey: key() });
  async function join(who: "p1" | "p2") {
    const code = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
    await as(who).mutation(api.members.joinByCode, { code });
  }
  await join("p1");
  await join("p2");
  const ash = (await as("p1").mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const bram = (await as("p2").mutation(api.characters.create, { campaignId, draft: draft("Bram", "bard"), idempotencyKey: key() })).characterId;

  const pages: Record<string, Id<"journalPages">> = {};
  async function titled(index: number | null, title: string, visibility: PageVisibility, recipients: Who[] = []) {
    const pageId =
      index === null
        ? await as("p1").mutation(api.notes.createPage, { campaignId, kind: "collection" })
        : (await as("p1").mutation(api.notesEntries.add, { campaignId, page: { template: index }, kind: "note", text: `on ${title}` })).pageId;
    await as("p1").mutation(api.notes.renamePage, { campaignId, page: pageId, title });
    await as("p1").mutation(api.notesSharing.setVisibility, { campaignId, page: pageId, visibility });
    for (const who of recipients) await as("p1").mutation(api.notesSharing.addRecipient, { campaignId, page: pageId, userId: ids[who] });
    pages[title] = pageId;
  }
  await titled(0, "gm", "gm");
  await titled(1, "private", "private");
  await titled(2, "players", "players");
  await titled(3, "everyone", "everyone");
  await titled(null, "chosen gm", "chosen", ["gm", "p2"]);
  await titled(null, "chosen p2", "chosen", ["p2"]);
  await as("p2").mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "task", text: "buy rope" });
  const gmPage = (await as("gm").mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "note", text: "prep" })).pageId;

  const journalOf = async (who: "p1" | "p2") => {
    const view = await as(who).query(api.notes.journal, { campaignId });
    if (view.journal === null) throw new Error("no journal");
    return view.journal._id;
  };
  const p1Journal = await journalOf("p1");
  const p2Journal = await journalOf("p2");
  const gmJournal = await t.run(async (ctx) => (await ctx.db.get("journalPages", gmPage))!.journalId);

  const call = {
    playerJournals: (who: Role) => client(who).query(api.notesJournals.playerJournals, { campaignId }),
    pastJournals: (who: Role) => client(who).query(api.notesJournals.pastJournals, { campaignId }),
    journalView: (who: Role, journalId: string = p1Journal) => client(who).query(api.notesJournals.journalView, { campaignId, journalId }),
  };
  /** The page titles of P1's journal the caller reads in the journal view. */
  const titles = async (who: Who) => (await call.journalView(who)).pages.map((p) => p.title);
  const setStatus = (status: "active" | "dead" | "retired" | "away") =>
    as("gm").mutation(api.characters.setStatus, { characterId: ash, status });
  const remove = () => as("gm").mutation(api.members.removePlayer, { campaignId, userId: ids.p1 });
  const rejoin = () => join("p1");
  const add = (who: Who, pageId: Id<"journalPages">) =>
    as(who).mutation(api.notesEntries.add, { campaignId, page: pageId, kind: "note", text: "late" });
  return { t, ids, as, campaignId, ash, bram, pages, p1Journal, p2Journal, gmJournal, call, titles, setStatus, remove, rejoin, add };
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

/** Page titles readable by every member after P1 departs: everything but 'private' (Q12). */
const PAST_TITLES = ["gm", "players", "everyone", "chosen gm", "chosen p2"];
const ALL_TITLES = ["gm", "private", "players", "everyone", "chosen gm", "chosen p2"];
/** What the GM reads in P1's present journal (Q2, D4): 'gm', 'everyone' and the chosen page that ticks the GM. */
const GM_TITLES = ["gm", "everyone", "chosen gm"];
/** What P2 reads in P1's present journal. */
const P2_TITLES = ["players", "everyone", "chosen gm", "chosen p2"];

// ---------------------------------------------------------------- role table

type Scenario = "present" | "removed" | "dead";

const ROLE_TABLE: {
  fn: string;
  scenario: Scenario;
  run: (s: Setup, who: Role) => Promise<unknown>;
  expected: Record<Role, string>;
}[] = [
  {
    fn: "playerJournals",
    scenario: "present",
    run: (s, who) => s.call.playerJournals(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "ok" },
  },
  {
    fn: "pastJournals",
    scenario: "present",
    run: (s, who) => s.call.pastJournals(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "ok" },
  },
  {
    // dcm-bxp.109: only the GM opens another person's present journal by URL.
    fn: "journalView (P1's journal)",
    scenario: "present",
    run: (s, who) => s.call.journalView(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "NOT_FOUND" },
  },
  {
    fn: "journalView (P2's journal)",
    scenario: "present",
    run: (s, who) => s.call.journalView(who, s.p2Journal),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "NOT_FOUND", gm: "ok", p2: "ok" },
  },
  {
    fn: "journalView (the GM's journal)",
    scenario: "present",
    run: (s, who) => s.call.journalView(who, s.gmJournal),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "NOT_FOUND", gm: "ok", p2: "NOT_FOUND" },
  },
  {
    fn: "playerJournals, P1 removed (departed owner)",
    scenario: "removed",
    run: (s, who) => s.call.playerJournals(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "NOT_FOUND", gm: "ok", p2: "ok" },
  },
  {
    fn: "pastJournals, P1 removed (departed owner)",
    scenario: "removed",
    run: (s, who) => s.call.pastJournals(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "NOT_FOUND", gm: "ok", p2: "ok" },
  },
  {
    fn: "journalView, P1 removed (departed owner)",
    scenario: "removed",
    run: (s, who) => s.call.journalView(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "NOT_FOUND", gm: "ok", p2: "ok" },
  },
  {
    fn: "journalView, Ash dead (departed owner still a member)",
    scenario: "dead",
    run: (s, who) => s.call.journalView(who),
    expected: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", gm: "ok", p2: "ok" },
  },
];

describe("notesJournals role table (anonymous, outsider, owner P1, GM, other player P2, departed owner)", () => {
  useAllowlist(`${GM},${P1},${P2},${OUTSIDER}`);

  for (const row of ROLE_TABLE) {
    it(`${row.fn}: ${Object.entries(row.expected).map(([r, c]) => `${r} ${c}`).join(", ")}`, async () => {
      const s = await setup();
      if (row.scenario === "removed") await s.remove();
      if (row.scenario === "dead") await s.setStatus("dead");
      const actual: Record<string, unknown> = {};
      for (const who of Object.keys(row.expected) as Role[]) actual[who] = await codeOf(row.run(s, who));
      expect(actual).toEqual(row.expected);
    });
  }

  it("journalView: an unknown, malformed or other campaign's journal is NOT_FOUND", async () => {
    const s = await setup();
    const other = await s.as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    await s.as("gm").mutation(api.notesEntries.add, { campaignId: other.campaignId, page: { template: 0 }, kind: "note", text: "elsewhere" });
    const otherJournal = (await s.as("gm").query(api.notes.journal, { campaignId: other.campaignId })).journal!._id;
    const deleted = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("journals", {
        campaignId: s.campaignId,
        userId: s.ids.p2,
        pageCount: 0,
        entryCount: 0,
        openCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete("journals", id);
      return id;
    });
    for (const journalId of [otherJournal, deleted, "not-an-id", s.pages["gm"]!]) {
      expect(await codeOf(s.call.journalView("gm", journalId))).toBe("NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------- present journals (Q2)

describe("players' journals (Q2, D4)", () => {
  useAllowlist(`${GM},${P1},${P2},${OUTSIDER}`);

  it("the GM lists every present player journal by character with the pages the GM reads; players get []", async () => {
    const s = await setup();
    expect(await s.call.playerJournals("gm")).toEqual([
      { journalId: s.p1Journal, name: "Ash", sub: "Player journal · Warrior", pageCount: GM_TITLES.length },
      { journalId: s.p2Journal, name: "Bram", sub: "Player journal · Bard", pageCount: 4 },
    ]);
    expect(await s.call.playerJournals("p1")).toEqual([]);
    expect(await s.call.playerJournals("p2")).toEqual([]);
    expect(await s.call.pastJournals("gm")).toEqual([]);
  });

  it("the GM sees 'gm', 'everyone' and ticked-'chosen' pages, never 'private', 'players' or unticked 'chosen'; adds where it reads", async () => {
    const s = await setup();
    const gmView = await s.call.journalView("gm");
    expect(gmView).toMatchObject({ title: "Ash’s Journal", ownerName: "Ash", ownerIsGm: false, own: false, departed: false });
    expect(gmView.pages.map((p) => [p.title, p.canAdd, p.canBin])).toEqual(GM_TITLES.map((t) => [t, true, false]));
    expect(gmView.pages.find((p) => p.title === "gm")?.chip).toBe("Private · GM can read");
    // dcm-bxp.109: P2 reads P1's shared pages in the Shared tabs only, never through P1's journal.
    expect(await codeOf(s.titles("p2"))).toBe("NOT_FOUND");
    const shared = await s.as("p2").query(api.notesSharing.shared, { campaignId: s.campaignId, tab: "players" });
    expect(shared.filter((r) => r.ownerName === "Ash").map((r) => r.title).sort()).toEqual([...P2_TITLES].sort());
    const own = await s.call.journalView("p1");
    expect(own.pages.map((p) => [p.title, p.canAdd, p.canBin])).toEqual(ALL_TITLES.map((t) => [t, true, true]));
    expect(own.own).toBe(true);
    // Reading means adding (Q3); the GM's entry lands on the player's page.
    expect(await codeOf(s.add("gm", s.pages["gm"]!))).toBe("ok");
    expect(await codeOf(s.add("gm", s.pages["players"]!))).toBe("NOTE_PAGE_NOT_FOUND");
  });
});

// ---------------------------------------------------------------- departure and return (Q12, D1, D2)

/** Checks the departed state: Past journals for everyone, private for nobody but its owner, frozen. */
async function expectDeparted(s: Setup, ownerIsMember: boolean) {
  for (const who of ["gm", "p2"] as const) {
    expect(await s.call.pastJournals(who)).toEqual([{ journalId: s.p1Journal, name: "Ash’s journal", pageCount: PAST_TITLES.length }]);
    const view = await s.call.journalView(who);
    expect(view.departed).toBe(true);
    expect(view.pages.map((p) => p.title)).toEqual(PAST_TITLES);
    expect(view.pages.every((p) => !p.canAdd && p.chip === "Everyone")).toBe(true);
    expect(view.pages.every((p) => p.canBin === (who === "gm"))).toBe(true);
  }
  expect((await s.call.playerJournals("gm")).map((r) => r.name)).toEqual(["Bram"]);
  if (ownerIsMember) {
    expect(await s.call.pastJournals("p1")).toEqual([{ journalId: s.p1Journal, name: "Ash’s journal", pageCount: ALL_TITLES.length }]);
    expect(await s.titles("p1")).toEqual(ALL_TITLES);
    expect(await codeOf(s.add("p1", s.pages["private"]!))).toBe("NOTE_JOURNAL_CLOSED");
  } else {
    expect(await codeOf(s.call.pastJournals("p1"))).toBe("NOT_FOUND");
  }
  for (const who of ["gm", "p2"] as const) expect(await codeOf(s.add(who, s.pages["everyone"]!))).toBe("NOTE_JOURNAL_CLOSED");
}

/** Checks the present state again: nothing in Past journals and the previous visibility for each reader. */
async function expectPresent(s: Setup) {
  for (const who of ["gm", "p1", "p2"] as const) expect(await s.call.pastJournals(who)).toEqual([]);
  expect(await s.titles("gm")).toEqual(GM_TITLES);
  expect(await codeOf(s.titles("p2"))).toBe("NOT_FOUND");
  expect(await s.titles("p1")).toEqual(ALL_TITLES);
  expect((await s.call.playerJournals("gm")).map((r) => [r.name, r.pageCount])).toEqual([
    ["Ash", GM_TITLES.length],
    ["Bram", 4],
  ]);
}

describe("departure and return (Q12, D1, D2)", () => {
  useAllowlist(`${GM},${P1},${P2},${OUTSIDER}`);

  it("members.removePlayer: the journal moves to Past journals for everyone; joinByCode brings the old visibility back", async () => {
    const s = await setup();
    await s.remove();
    await expectDeparted(s, false);
    await s.rejoin();
    await expectPresent(s);
  });

  it("characters.setStatus 'dead': past journal; back to 'active': present again", async () => {
    const s = await setup();
    await s.setStatus("dead");
    await expectDeparted(s, true);
    await s.setStatus("active");
    await expectPresent(s);
  });

  it("characters.setStatus 'retired': past journal; back to 'active': present again", async () => {
    const s = await setup();
    await s.setStatus("retired");
    await expectDeparted(s, true);
    await s.setStatus("active");
    await expectPresent(s);
  });

  it("'away' is not a departure", async () => {
    const s = await setup();
    await s.setStatus("away");
    await expectPresent(s);
  });

  it("the GM tears out a past journal's page (never its private one); after the return the rest keeps its visibility", async () => {
    const s = await setup();
    await s.setStatus("retired");
    expect(await codeOf(s.as("gm").mutation(api.notesBin.binPage, { campaignId: s.campaignId, page: s.pages["private"]! }))).toBe(
      "NOTE_PAGE_NOT_FOUND",
    );
    expect(await codeOf(s.as("p2").mutation(api.notesBin.binPage, { campaignId: s.campaignId, page: s.pages["players"]! }))).toBe(
      "NOTE_FORBIDDEN_ACTION",
    );
    await s.as("gm").mutation(api.notesBin.binPage, { campaignId: s.campaignId, page: s.pages["players"]! });
    const after = PAST_TITLES.filter((t) => t !== "players");
    for (const who of ["gm", "p2"] as const) {
      expect(await s.titles(who)).toEqual(after);
      expect(await s.call.pastJournals(who)).toEqual([{ journalId: s.p1Journal, name: "Ash’s journal", pageCount: after.length }]);
    }
    for (const who of ["gm", "p1", "p2"] as const) expect(await codeOf(s.add(who, s.pages["gm"]!))).toBe("NOTE_JOURNAL_CLOSED");

    await s.setStatus("active");
    expect(await s.titles("gm")).toEqual(GM_TITLES);
    expect(await codeOf(s.titles("p2"))).toBe("NOT_FOUND");
    expect(await s.titles("p1")).toEqual(ALL_TITLES.filter((t) => t !== "players"));
    expect(await s.call.pastJournals("gm")).toEqual([]);
  });

  it("a journal is named after its character, or the account name when unattached", async () => {
    const s = await setup();
    // An unattached journal of a player without a character, who then leaves.
    const p3 = await s.t.run((ctx) => ctx.db.insert("users", { email: "p3@example.com", emailVerificationTime: 1, name: "Rhea" }));
    await s.t.run(async (ctx) => {
      const journalId = await ctx.db.insert("journals", {
        campaignId: s.campaignId,
        userId: p3,
        pageCount: 1,
        entryCount: 0,
        openCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("journalPages", {
        campaignId: s.campaignId,
        journalId,
        ownerId: p3,
        kind: "log",
        title: "Session 1",
        tape: 0,
        visibility: "gm",
        entryCount: 0,
        openCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect((await s.call.pastJournals("gm")).map((r) => [r.name, r.pageCount])).toEqual([["Rhea’s journal", 1]]);
  });

  it("dcm-bxp.108: a past journal with no page the caller can read (torn out, or only Private left) is not listed", async () => {
    const s = await setup();
    await s.setStatus("dead");
    // An unattached journal with no page at all, of a player who left: never listed.
    const p3 = await s.t.run((ctx) => ctx.db.insert("users", { email: "p3@example.com", emailVerificationTime: 1, name: "Rhea" }));
    await s.t.run((ctx) =>
      ctx.db.insert("journals", { campaignId: s.campaignId, userId: p3, pageCount: 0, entryCount: 0, openCount: 0, createdAt: 1, updatedAt: 1 }),
    );
    for (const title of PAST_TITLES.slice(1)) {
      await s.as("gm").mutation(api.notesBin.binPage, { campaignId: s.campaignId, page: s.pages[title]! });
    }
    for (const who of ["gm", "p2"] as const) {
      expect(await s.call.pastJournals(who)).toEqual([{ journalId: s.p1Journal, name: "Ash’s journal", pageCount: 1 }]);
    }
    await s.as("gm").mutation(api.notesBin.binPage, { campaignId: s.campaignId, page: s.pages["gm"]! });
    // Only the Private page is left: nobody but its owner reads it, so only the owner still finds the journal.
    for (const who of ["gm", "p2"] as const) expect(await s.call.pastJournals(who)).toEqual([]);
    expect(await s.call.pastJournals("p1")).toEqual([{ journalId: s.p1Journal, name: "Ash’s journal", pageCount: 1 }]);
    // The view still opens for those who reach a departed journal; it simply has no page for them.
    expect((await s.call.journalView("p2")).pages).toEqual([]);
  });
});

// ---------------------------------------------------------------- linked sessions (dcm-bxp.110, D6, D10 Q4)

describe("journalView: the linked session's number and date", () => {
  useAllowlist(`${GM},${P1},${P2},${OUTSIDER}`);

  /** Links P1's pages: 'gm' to a played session with a date, 'everyone' to a played one without, 'players' to a planned one. */
  async function linked() {
    const s = await setup();
    const now = Date.now();
    await s.t.run(async (ctx) => {
      const played = await ctx.db.insert("sessions", { campaignId: s.campaignId, n: 3, date: "2026-10-24", status: "played", createdAt: now, updatedAt: now });
      const undated = await ctx.db.insert("sessions", { campaignId: s.campaignId, n: 4, status: "played", createdAt: now, updatedAt: now });
      const planned = await ctx.db.insert("sessions", { campaignId: s.campaignId, n: 5, date: "2026-11-07", status: "planned", createdAt: now, updatedAt: now });
      await ctx.db.patch("journalPages", s.pages["gm"]!, { sessionId: played });
      await ctx.db.patch("journalPages", s.pages["everyone"]!, { sessionId: undated });
      await ctx.db.patch("journalPages", s.pages["players"]!, { sessionId: planned });
    });
    return s;
  }
  const sessionsOf = async (s: Setup, who: Who) =>
    Object.fromEntries((await s.call.journalView(who)).pages.map((p) => [p.title, p.session ?? null]));

  it("the GM sees each linked session (planned too); an unlinked page has none", async () => {
    const s = await linked();
    expect(await sessionsOf(s, "gm")).toEqual({ gm: { n: 3, date: "2026-10-24" }, everyone: { n: 4 }, "chosen gm": null });
  });

  it("a player sees live / played sessions only (D10 Q4), in their own and in a past journal", async () => {
    const s = await linked();
    expect(await sessionsOf(s, "p1")).toEqual({
      gm: { n: 3, date: "2026-10-24" },
      private: null,
      players: null,
      everyone: { n: 4 },
      "chosen gm": null,
      "chosen p2": null,
    });
    await s.remove();
    expect(await sessionsOf(s, "p2")).toEqual({ gm: { n: 3, date: "2026-10-24" }, players: null, everyone: { n: 4 }, "chosen gm": null, "chosen p2": null });
    // The GM still sees the planned one in the past journal.
    expect((await sessionsOf(s, "gm"))["players"]).toEqual({ n: 5, date: "2026-11-07" });
  });

  it("a deleted session is not shown", async () => {
    const s = await linked();
    await s.t.run(async (ctx) => {
      const page = await ctx.db.get("journalPages", s.pages["gm"]!);
      await ctx.db.delete("sessions", page!.sessionId!);
    });
    expect((await sessionsOf(s, "gm"))["gm"]).toBeNull();
  });
});
