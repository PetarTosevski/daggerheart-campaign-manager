import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { JournalView } from "../../convex/notes";
import { MAX_PAGES } from "../../convex/lib/validators/notes";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D11 N2: own journal and pages (convex/notes.ts). The role table (function x role -> expected code) is written so D12
// can fold it into tests/convex/authz-matrix.test.ts; every assertion reads ConvexError.data.code.

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

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

type Who = "anon" | "outsider" | "owner" | "player" | "gm";

/** A campaign with a GM, two players (p1 owns Ash the Warrior), an outsider and an anonymous caller. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", name: "Gwen" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com", name: "Pia" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com", name: "Pete" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, out] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Notes", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const ash = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const callers: Record<Who, typeof gm | typeof t> = { anon: t, outsider: out, owner: p1, player: p2, gm };

  async function session(n: number, status: Doc<"sessions">["status"], extra: Partial<Doc<"sessions">> = {}) {
    return t.run((ctx) => ctx.db.insert("sessions", { campaignId, n, status, createdAt: Date.now(), updatedAt: Date.now(), ...extra }));
  }
  async function page(id: Id<"journalPages">) {
    return t.run((ctx) => ctx.db.get("journalPages", id));
  }
  async function journal(caller: typeof gm): Promise<JournalView> {
    return caller.query(api.notes.journal, { campaignId });
  }
  /** p1's first own page (Session 1), creating the journal with a write. */
  async function ownerPage() {
    const created = await p1.mutation(api.notes.createPage, { campaignId, kind: "collection" });
    const view = await journal(p1);
    if (view.journal === null) throw new Error("p1 has no journal after a write");
    return { first: view.pages[0]!._id, created, view };
  }
  return { t, ids, gm, p1, p2, out, campaignId, ash, callers, session, page, journal, ownerPage };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return errorCode(error);
  }
}

describe("notes.journal: the current journal (D3, Q8, B1, B2, B7)", () => {
  useAllowlist(EMAILS);

  it("before the first write: no journal, the templates with Session 1 linked to the live session (D6)", async () => {
    const s = await setup();
    const live = await s.session(2, "live", { title: "The Ford", date: "2026-10-24" });
    const gmView = await s.journal(s.gm);
    expect(gmView).toMatchObject({ journal: null, isGm: true, whoName: "Game Master", whoSub: "GM journal · private to the GM" });
    if (gmView.journal !== null) throw new Error("unexpected journal");
    expect(gmView.templates.map((p) => [p.template, p.kind, p.title, p.tape, p.visibility, p.sessionId ?? null])).toEqual([
      [0, "log", "Session 1", 0, "private", live],
      [1, "collection", "Rumors & hooks", 1, "private", null],
      [2, "collection", "Loot & debts", 2, "private", null],
      [3, "future", "Future log", 3, "private", null],
    ]);
    expect(gmView.templates[0]!.session).toEqual({ n: 2, title: "The Ford", date: "2026-10-24", status: "live" });

    const p1View = await s.journal(s.p1);
    expect(p1View).toMatchObject({ journal: null, isGm: false, whoName: "Ash", whoSub: "Player journal · Warrior" });
    if (p1View.journal !== null) throw new Error("unexpected journal");
    expect(p1View.templates.map((p) => [p.title, p.visibility])).toEqual([
      ["Session 1", "gm"],
      ["People we met", "gm"],
      ["Clues & secrets", "gm"],
      ["My goals", "gm"],
    ]);
    // A player without a character: the account name and 'Player' (Q8).
    expect(await s.journal(s.p2)).toMatchObject({ whoName: "Pete", whoSub: "Player journal · Player" });
  });

  it("after a write: counters, own pages in created order with their template index, binned pages left out", async () => {
    const s = await setup();
    const { created, view } = await s.ownerPage();
    if (view.journal === null) throw new Error("no journal");
    expect(view.journal).toMatchObject({ pageCount: 5, entryCount: 0, openCount: 0 });
    expect(view.pages.map((p) => [p.title, p.template ?? null, p.tape])).toEqual([
      ["Session 1", 0, 2],
      ["People we met", 1, 1],
      ["Clues & secrets", 2, 4],
      ["My goals", 3, 0],
      ["New collection", null, 4],
    ]);
    expect(view.pages[4]!._id).toBe(created);
    // A torn-out default page leaves the list but keeps the others' template numbers.
    await s.t.run((ctx) => ctx.db.patch("journalPages", view.pages[1]!._id, { binnedAt: Date.now(), binnedBy: s.ids.p1 }));
    const after = await s.journal(s.p1);
    if (after.journal === null) throw new Error("no journal");
    expect(after.pages.map((p) => [p.title, p.template ?? null])).toEqual([
      ["Session 1", 0],
      ["Clues & secrets", 2],
      ["My goals", 3],
      ["New collection", null],
    ]);
    // The GM's journal is separate.
    expect((await s.journal(s.gm)).journal).toBeNull();
  });

  it("a linked session shows for the GM always, for a player only while live or played; a deleted one unlinks", async () => {
    const s = await setup();
    const played = await s.session(1, "played", { date: "2026-10-01" });
    const id = await s.p1.mutation(api.notes.createPage, { campaignId: s.campaignId, kind: "log", sessionId: played });
    const linked = async () => {
      const v = await s.journal(s.p1);
      return v.journal === null ? null : v.pages.find((p) => p._id === id);
    };
    expect(await linked()).toMatchObject({ title: "Session 1", sessionId: played, session: { n: 1, date: "2026-10-01", status: "played" } });
    await s.t.run((ctx) => ctx.db.patch("sessions", played, { status: "planned" }));
    expect((await linked())?.session).toBeUndefined();
    await s.t.run((ctx) => ctx.db.delete("sessions", played));
    expect((await linked())?.sessionId).toBeUndefined();
  });
});

describe("notes writes (B3, B7, Q5, D6)", () => {
  useAllowlist(EMAILS);

  it("createPage: board titles and tapes, session log titled after its session, default visibility", async () => {
    const s = await setup();
    const live = await s.session(2, "live", { title: "The Ford", date: "2026-10-24" });
    const c = s.campaignId;
    const log = await s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "log", sessionId: live });
    const future = await s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "future" });
    const plain = await s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "log" });
    expect(await s.page(log)).toMatchObject({ title: "Session 2: The Ford", sessionId: live, tape: 4, visibility: "private", kind: "log" });
    expect(await s.page(future)).toMatchObject({ title: "Future log 2", tape: 5 });
    expect(await s.page(plain)).toMatchObject({ title: "Session 3", tape: 0 });
    // The first write created the journal: Session 1 is linked to the live session (D6).
    const view = await s.journal(s.gm);
    if (view.journal === null) throw new Error("no journal");
    expect(view.pages[0]).toMatchObject({ title: "Session 1", sessionId: live });
    expect(view.journal.pageCount).toBe(7);
    // A player's new page: 'gm' visibility (A4).
    const own = await s.p1.mutation(api.notes.createPage, { campaignId: c, kind: "collection" });
    expect(await s.page(own)).toMatchObject({ visibility: "gm", title: "New collection" });
  });

  it("createPage refuses sessions the caller cannot link, and the page limit", async () => {
    const s = await setup();
    const c = s.campaignId;
    const planned = await s.session(3, "planned");
    const { campaignId: otherCampaign } = await s.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const other = await s.t.run((ctx) => ctx.db.insert("sessions", { campaignId: otherCampaign, n: 1, status: "live", createdAt: 1, updatedAt: 1 }));
    expect(await codeOf(s.p1.mutation(api.notes.createPage, { campaignId: c, kind: "log", sessionId: planned }))).toBe("NOTE_SESSION_INVALID");
    expect(await codeOf(s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "log", sessionId: other }))).toBe("NOTE_SESSION_INVALID");
    expect(await codeOf(s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "log", sessionId: "nonsense" }))).toBe("NOTE_SESSION_INVALID");
    expect(await codeOf(s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "collection", sessionId: planned }))).toBe("NOTE_SESSION_INVALID");
    // The GM may link a planned session.
    expect(await codeOf(s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "log", sessionId: planned }))).toBe("ok");

    const view = await s.journal(s.gm);
    if (view.journal === null) throw new Error("no journal");
    const journalId = view.journal._id;
    await s.t.run(async (ctx) => {
      const journal = (await ctx.db.get("journals", journalId))!;
      // Torn-out pages count toward the limit too (Q10).
      for (let i = journal.pageCount; i < MAX_PAGES - 1; i++) {
        await ctx.db.insert("journalPages", {
          campaignId: c,
          journalId,
          ownerId: s.ids.gm,
          kind: "collection",
          title: `P${i}`,
          tape: 0,
          visibility: "private",
          binnedAt: 1,
          binnedBy: s.ids.gm,
          entryCount: 0,
          openCount: 0,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    expect(await codeOf(s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "collection" }))).toBe("ok");
    expect(await codeOf(s.gm.mutation(api.notes.createPage, { campaignId: c, kind: "collection" }))).toBe("NOTE_PAGE_LIMIT");
  });

  it("renamePage, cycleTape and setSession by the owner; a template ref creates the journal first (CL6)", async () => {
    const s = await setup();
    const c = s.campaignId;
    await s.p1.mutation(api.notes.renamePage, { campaignId: c, page: { template: 1 }, title: "  Folk of the Ford  " });
    const view = await s.journal(s.p1);
    if (view.journal === null) throw new Error("the template write did not create the journal");
    const people = view.pages[1]!;
    expect(people.title).toBe("Folk of the Ford");
    await s.p1.mutation(api.notes.cycleTape, { campaignId: c, page: people._id });
    expect((await s.page(people._id))!.tape).toBe(2);
    await s.p1.mutation(api.notes.cycleTape, { campaignId: c, page: { template: 3 } });
    expect((await s.page(view.pages[3]!._id))!.tape).toBe(1);

    expect(await codeOf(s.p1.mutation(api.notes.renamePage, { campaignId: c, page: people._id, title: "   " }))).toBe("INVALID");
    expect(await codeOf(s.p1.mutation(api.notes.renamePage, { campaignId: c, page: people._id, title: "x".repeat(81) }))).toBe("INVALID");
    expect(await codeOf(s.p1.mutation(api.notes.renamePage, { campaignId: c, page: people._id, title: "x".repeat(80) }))).toBe("ok");
    expect(await codeOf(s.p1.mutation(api.notes.renamePage, { campaignId: c, page: { template: 9 }, title: "Nine" }))).toBe("NOTE_PAGE_NOT_FOUND");

    const played = await s.session(1, "played");
    const planned = await s.session(2, "planned");
    const log = view.pages[0]!._id;
    await s.p1.mutation(api.notes.setSession, { campaignId: c, page: log, sessionId: played });
    expect((await s.page(log))!.sessionId).toBe(played);
    expect((await s.page(log))!.title).toBe("Session 1"); // D6: the title stays.
    expect(await codeOf(s.p1.mutation(api.notes.setSession, { campaignId: c, page: log, sessionId: planned }))).toBe("NOTE_SESSION_INVALID");
    expect(await codeOf(s.p1.mutation(api.notes.setSession, { campaignId: c, page: people._id, sessionId: played }))).toBe("NOTE_SESSION_INVALID");
    await s.p1.mutation(api.notes.setSession, { campaignId: c, page: log, sessionId: null });
    expect((await s.page(log))!.sessionId).toBeUndefined();
  });

  it("a player whose character died gets a new journal for the next character; the old one is closed (Q12, D2)", async () => {
    const s = await setup();
    const c = s.campaignId;
    const { first } = await s.ownerPage();
    const before = await s.journal(s.p1);
    await s.gm.mutation(api.characters.setStatus, { characterId: s.ash, status: "dead" });
    // The dead character's journal is not current any more: no journal until the next character.
    expect(await s.journal(s.p1)).toMatchObject({ journal: null, whoName: "Pia" });
    const bryn = (await s.p1.mutation(api.characters.create, { campaignId: c, draft: draft("Bryn", "bard"), idempotencyKey: key() })).characterId;
    expect(await s.journal(s.p1)).toMatchObject({ journal: null, whoName: "Bryn", whoSub: "Player journal · Bard" });
    await s.p1.mutation(api.notes.createPage, { campaignId: c, kind: "future" });
    const after = await s.journal(s.p1);
    if (after.journal === null || before.journal === null) throw new Error("no journal");
    expect(after.journal._id).not.toBe(before.journal._id);
    const journalRow = await s.t.run((ctx) => ctx.db.get("journals", after.journal!._id));
    expect(journalRow!.characterId).toBe(bryn);
    expect(after.pages.map((p) => p.title)).toEqual(["Session 1", "People we met", "Clues & secrets", "My goals", "Future log 1"]);
    // Writes on the departed journal's pages: NOTE_JOURNAL_CLOSED, for the owner and for the GM who now reads them.
    expect(await codeOf(s.p1.mutation(api.notes.renamePage, { campaignId: c, page: first, title: "Again" }))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.gm.mutation(api.notes.cycleTape, { campaignId: c, page: first }))).toBe("NOTE_JOURNAL_CLOSED");
  });
});

describe("notes role table (function x role -> code; D12 folds it into the authz matrix)", () => {
  useAllowlist(EMAILS);

  // owner = p1 (the page's owner), player = p2, gm = the campaign GM. p1's page has the default 'gm' visibility: the GM
  // reads it (owner-only edit -> NOTE_FORBIDDEN_ACTION), p2 does not (-> NOTE_PAGE_NOT_FOUND, as for a missing page).
  const TABLE: Record<string, Record<Who, string>> = {
    journal: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", owner: "ok", player: "ok", gm: "ok" },
    createPage: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", owner: "ok", player: "ok", gm: "ok" },
    renamePage: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", owner: "ok", player: "NOTE_PAGE_NOT_FOUND", gm: "NOTE_FORBIDDEN_ACTION" },
    cycleTape: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", owner: "ok", player: "NOTE_PAGE_NOT_FOUND", gm: "NOTE_FORBIDDEN_ACTION" },
    setSession: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", owner: "ok", player: "NOTE_PAGE_NOT_FOUND", gm: "NOTE_FORBIDDEN_ACTION" },
  };
  const ROLES: Who[] = ["anon", "outsider", "owner", "player", "gm"];

  for (const [fn, row] of Object.entries(TABLE)) {
    it(`${fn}: ${ROLES.map((r) => `${r} ${row[r]}`).join(", ")}`, async () => {
      const s = await setup();
      const c = s.campaignId;
      const { first } = await s.ownerPage();
      const played = await s.session(1, "played");
      for (const role of ROLES) {
        const caller = s.callers[role] as typeof s.gm;
        const call = {
          journal: () => caller.query(api.notes.journal, { campaignId: c }),
          createPage: () => caller.mutation(api.notes.createPage, { campaignId: c, kind: "collection" }),
          renamePage: () => caller.mutation(api.notes.renamePage, { campaignId: c, page: first, title: `By ${role}` }),
          cycleTape: () => caller.mutation(api.notes.cycleTape, { campaignId: c, page: first }),
          setSession: () => caller.mutation(api.notes.setSession, { campaignId: c, page: first, sessionId: played }),
        }[fn]!;
        expect([role, await codeOf(call())]).toEqual([role, row[role]]);
      }
    });
  }

  it("a page shared with everyone is readable by the other player, who still may not edit it (Q3)", async () => {
    const s = await setup();
    const { first } = await s.ownerPage();
    await s.t.run((ctx) => ctx.db.patch("journalPages", first, { visibility: "everyone" }));
    expect(await codeOf(s.p2.mutation(api.notes.renamePage, { campaignId: s.campaignId, page: first, title: "Mine" }))).toBe("NOTE_FORBIDDEN_ACTION");
    // Hidden from everyone: the GM now gets NOTE_PAGE_NOT_FOUND too.
    await s.t.run((ctx) => ctx.db.patch("journalPages", first, { visibility: "private" }));
    expect(await codeOf(s.gm.mutation(api.notes.cycleTape, { campaignId: s.campaignId, page: first }))).toBe("NOTE_PAGE_NOT_FOUND");
    // A chosen player reads a 'chosen' page and may not edit it.
    await s.t.run(async (ctx) => {
      await ctx.db.patch("journalPages", first, { visibility: "chosen" });
      await ctx.db.insert("journalPageRecipients", { campaignId: s.campaignId, pageId: first, userId: s.ids.p2, addedAt: 1 });
    });
    expect(await codeOf(s.p2.mutation(api.notes.cycleTape, { campaignId: s.campaignId, page: first }))).toBe("NOTE_FORBIDDEN_ACTION");
    expect(await codeOf(s.gm.mutation(api.notes.cycleTape, { campaignId: s.campaignId, page: first }))).toBe("NOTE_PAGE_NOT_FOUND");
  });
});
