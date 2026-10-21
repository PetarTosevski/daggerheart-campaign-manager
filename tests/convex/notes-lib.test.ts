import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { departed } from "../../convex/lib/journalState";
import {
  assertAction,
  bumpCounts,
  currentJournal,
  defaultSessionId,
  deletePageRows,
  ensureJournal,
  entryAccess,
  findPage,
  insertPage,
  pageAccess,
  resolvePage,
  type NotesMutationCtx,
} from "../../convex/lib/notes";
import { upsertGrant } from "../../convex/lib/permissions";
import { MAX_PAGES } from "../../convex/lib/validators/notes";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D11 N0: the Notes helpers (convex/lib/notes.ts, convex/lib/journalState.ts). N0 adds no public function, so these
// run the helpers inside t.run with the ctx a campaign wrapper would build ({ user, campaign }).

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const OUTSIDER = "outsider@example.com";

type Who = "gm" | "p1" | "p2" | "outsider";

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
    p1: await ctx.db.insert("users", { email: P1, emailVerificationTime: 1 }),
    p2: await ctx.db.insert("users", { email: P2, emailVerificationTime: 1 }),
    outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const gm = as(ids.gm);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Notes", idempotencyKey: key() });
  const join = async (id: Id<"users">) => {
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await as(id).mutation(api.members.joinByCode, { code });
  };
  await join(ids.p1);
  await join(ids.p2);

  /**
   * Runs `fn` with the ctx a campaign wrapper gives `who`. t.run returns only serialisable values, so a result's
   * function fields (PageAccess's entry checks) are dropped: call those inside `fn`.
   */
  function run<T>(who: Who, fn: (ctx: NotesMutationCtx) => Promise<T>): Promise<T> {
    return t.run(async (ctx: MutationCtx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      const user = (await ctx.db.get("users", ids[who]))!;
      const result = await fn({ ...ctx, user, campaign });
      if (result === null || typeof result !== "object" || Array.isArray(result)) return result;
      return Object.fromEntries(Object.entries(result).filter(([, value]) => typeof value !== "function")) as T;
    });
  }
  async function character(owner: Who, status: Doc<"characters">["status"] = "active", createdAt = Date.now()) {
    return t.run((ctx) => ctx.db.insert("characters", { campaignId, ownerId: ids[owner], createdBy: ids[owner], status, sheet: {}, createdAt, updatedAt: createdAt }));
  }
  async function pages(journalId: Id<"journals">) {
    return t.run((ctx) => ctx.db.query("journalPages").withIndex("by_journal_binned", (q) => q.eq("journalId", journalId)).collect());
  }
  return { t, ids, gm, as, campaignId, run, character, pages, join };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return errorCode(error);
  }
}

describe("journals: current journal, creation and attachment (D3, B7)", () => {
  useAllowlist(`${GM},${P1},${P2},${OUTSIDER}`);

  it("the GM's first write creates the GM journal with its four private default pages, Session 1 linked to the live session", async () => {
    const s = await setup();
    const sessionId = await s.t.run((ctx) =>
      ctx.db.insert("sessions", { campaignId: s.campaignId, n: 2, status: "live", createdAt: Date.now(), updatedAt: Date.now() }),
    );
    expect(await s.run("gm", async (ctx) => (await currentJournal(ctx)).journal)).toBeNull();
    const { journal, created, role, defaultPageIds } = await s.run("gm", (ctx) => ensureJournal(ctx));
    expect({ created, role, characterId: journal.characterId, pageCount: journal.pageCount }).toEqual({ created: true, role: "gm", characterId: undefined, pageCount: 4 });
    const rows = await s.pages(journal._id);
    expect(rows.map((p) => [p.kind, p.title, p.tape, p.visibility, p.sessionId ?? null])).toEqual([
      ["log", "Session 1", 0, "private", sessionId],
      ["collection", "Rumors & hooks", 1, "private", null],
      ["collection", "Loot & debts", 2, "private", null],
      ["future", "Future log", 3, "private", null],
    ]);
    expect(rows.map((p) => p._id)).toEqual(defaultPageIds);
    // A second call finds it.
    expect((await s.run("gm", (ctx) => ensureJournal(ctx))).created).toBe(false);
    expect((await s.run("gm", (ctx) => currentJournal(ctx))).journal?._id).toBe(journal._id);
  });

  it("a player gets the player template with 'gm' visibility; without a live session Session 1 links to the newest played one", async () => {
    const s = await setup();
    const played = await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("sessions", { campaignId: s.campaignId, n: 1, status: "played", createdAt: now, updatedAt: now });
      const two = await ctx.db.insert("sessions", { campaignId: s.campaignId, n: 2, status: "played", createdAt: now, updatedAt: now });
      await ctx.db.insert("sessions", { campaignId: s.campaignId, n: 3, status: "planned", createdAt: now, updatedAt: now });
      return two;
    });
    const characterId = await s.character("p1");
    const { journal } = await s.run("p1", (ctx) => ensureJournal(ctx));
    expect(journal.characterId).toBe(characterId);
    const rows = await s.pages(journal._id);
    expect(rows.map((p) => [p.title, p.tape, p.visibility, p.ownerId])).toEqual([
      ["Session 1", 2, "gm", s.ids.p1],
      ["People we met", 1, "gm", s.ids.p1],
      ["Clues & secrets", 4, "gm", s.ids.p1],
      ["My goals", 0, "gm", s.ids.p1],
    ]);
    expect(rows[0]!.sessionId).toBe(played);
    // The GM's default would be the planned Session 3 (any session); a player sees played ones only.
    expect(await s.run("gm", (ctx) => defaultSessionId(ctx, true))).not.toBe(played);
  });

  it("an account journal attaches to the player's first character on the next write", async () => {
    const s = await setup();
    const { journal } = await s.run("p1", (ctx) => ensureJournal(ctx));
    expect(journal.characterId).toBeUndefined();
    const characterId = await s.character("p1");
    const current = await s.run("p1", (ctx) => currentJournal(ctx));
    expect({ id: current.journal?._id, attach: current.attach, character: current.character?._id }).toEqual({ id: journal._id, attach: characterId, character: characterId });
    const again = await s.run("p1", (ctx) => ensureJournal(ctx));
    expect({ id: again.journal._id, characterId: again.journal.characterId, created: again.created }).toEqual({ id: journal._id, characterId, created: false });
    expect((await s.t.run((ctx) => ctx.db.get("journals", journal._id)))!.characterId).toBe(characterId);
  });

  it("after the first character dies, the next character gets a new journal; the old one is departed", async () => {
    const s = await setup();
    const first = await s.character("p1", "active", 1000);
    const { journal: old } = await s.run("p1", (ctx) => ensureJournal(ctx));
    expect(old.characterId).toBe(first);
    await s.t.run((ctx) => ctx.db.patch("characters", first, { status: "dead" }));
    expect((await s.run("p1", (ctx) => currentJournal(ctx))).journal).toBeNull();
    const second = await s.character("p1", "active", 2000);
    const { journal: fresh, created } = await s.run("p1", (ctx) => ensureJournal(ctx));
    expect({ created, characterId: fresh.characterId }).toEqual({ created: true, characterId: second });
    expect(fresh._id).not.toBe(old._id);
    expect(await s.run("gm", async (ctx) => departed(ctx, ctx.campaign, (await ctx.db.get("journals", old._id))!))).toBe(true);
    expect(await s.run("gm", async (ctx) => departed(ctx, ctx.campaign, (await ctx.db.get("journals", fresh._id))!))).toBe(false);
  });

  it("the active character's journal is current over a newer benched one", async () => {
    const s = await setup();
    const active = await s.character("p1", "active", 1000);
    const { journal: activeJournal } = await s.run("p1", (ctx) => ensureJournal(ctx));
    const benched = await s.character("p1", "away", 2000);
    await s.t.run((ctx) =>
      ctx.db.insert("journals", { campaignId: s.campaignId, userId: s.ids.p1, characterId: benched, pageCount: 0, entryCount: 0, openCount: 0, createdAt: 2000, updatedAt: 2000 }),
    );
    const current = await s.run("p1", (ctx) => currentJournal(ctx));
    expect({ id: current.journal?._id, character: current.character?._id }).toEqual({ id: activeJournal._id, character: active });
    // 'away' is no departure.
    await s.t.run((ctx) => ctx.db.patch("characters", active, { status: "away" }));
    expect((await s.run("p1", (ctx) => currentJournal(ctx))).character?._id).toBe(benched);
  });

  it("someone who reaches the campaign only through a grant has no journal: NOT_FOUND", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "campaign", resourceId: s.campaignId, principalKind: "user", principalId: s.ids.outsider, permission: "owner", createdBy: s.ids.gm }),
    );
    expect(await codeOf(s.run("outsider", (ctx) => currentJournal(ctx)))).toBe("NOT_FOUND");
    expect(await codeOf(s.run("outsider", (ctx) => ensureJournal(ctx)))).toBe("NOT_FOUND");
  });

  it("departed() reads at most three documents for a member's journal and none for the GM's", async () => {
    const s = await setup();
    await s.character("p1");
    const { journal } = await s.run("p1", (ctx) => ensureJournal(ctx));
    const { journal: gmJournal } = await s.run("gm", (ctx) => ensureJournal(ctx));
    const reads = (journalId: Id<"journals">) =>
      s.run("p2", async (ctx) => {
        const row = (await ctx.db.get("journals", journalId))!;
        let count = 0;
        const db = new Proxy(ctx.db, {
          get(target, prop) {
            const value: unknown = Reflect.get(target, prop);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              if (prop === "get" || prop === "query") count++;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          },
        });
        const result = await departed({ ...ctx, db }, ctx.campaign, row);
        return { result, count };
      });
    expect(await reads(journal._id)).toEqual({ result: false, count: 2 });
    expect(await reads(gmJournal._id)).toEqual({ result: false, count: 0 });
    await s.gm.mutation(api.members.removePlayer, { campaignId: s.campaignId, userId: s.ids.p1 });
    expect(await reads(journal._id)).toEqual({ result: true, count: 3 });
  });
});

describe("pages: refs, access and the action table (analysis 3.2)", () => {
  useAllowlist(`${GM},${P1},${P2},${OUTSIDER}`);

  /** p1 has a character and a journal; returns its four default pages by title. */
  async function withPlayerJournal() {
    const s = await setup();
    const characterId = await s.character("p1");
    const { journal, defaultPageIds } = await s.run("p1", (ctx) => ensureJournal(ctx));
    const [log, people, clues, goals] = defaultPageIds as [Id<"journalPages">, Id<"journalPages">, Id<"journalPages">, Id<"journalPages">];
    const entry = (pageId: Id<"journalPages">, author: Who, kind: Doc<"journalEntries">["kind"] = "task") =>
      s.t.run((ctx) =>
        ctx.db.insert("journalEntries", {
          campaignId: s.campaignId,
          journalId: journal._id,
          pageId,
          authorId: s.ids[author],
          kind,
          state: "open",
          star: false,
          text: "x",
          order: 0,
          open: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    const setVisibility = (pageId: Id<"journalPages">, visibility: Doc<"journalPages">["visibility"]) =>
      s.t.run((ctx) => ctx.db.patch("journalPages", pageId, { visibility }));
    return { ...s, characterId, journal, log, people, clues, goals, entry, setVisibility };
  }

  it("a template ref before the journal exists is null in a query and creates the journal in a mutation", async () => {
    const s = await setup();
    expect(await s.run("p1", (ctx) => findPage(ctx, { template: 1 }))).toBeNull();
    const access = await s.run("p1", (ctx) => resolvePage(ctx, { template: 1 }));
    expect({ title: access.page.title, owner: access.isOwner, edit: access.canEditPage }).toEqual({ title: "People we met", owner: true, edit: true });
    // Later refs to the same template find the same page, even after a rename.
    await s.t.run((ctx) => ctx.db.patch("journalPages", access.page._id, { title: "Faces" }));
    expect((await s.run("p1", (ctx) => resolvePage(ctx, { template: 1 }))).page._id).toBe(access.page._id);
    expect((await s.run("p1", (ctx) => findPage(ctx, { template: 1 })))?.page._id).toBe(access.page._id);
    expect(await codeOf(s.run("p1", (ctx) => resolvePage(ctx, { template: 9 })))).toBe("NOTE_PAGE_NOT_FOUND");
    expect(await codeOf(s.run("p1", (ctx) => findPage(ctx, { template: -1 })))).toBe("NOTE_PAGE_NOT_FOUND");
  });

  it("the owner may do everything on a present page; the GM reading a 'gm' page may only add", async () => {
    const s = await withPlayerJournal();
    const own = await s.run("p1", (ctx) => pageAccess(ctx, s.log));
    expect({ p: own.permission, e: own.canEditPage, a: own.canAdd, b: own.canBin, r: own.canRestore }).toEqual({ p: "owner", e: true, a: true, b: true, r: false });
    const gm = await s.run("gm", (ctx) => pageAccess(ctx, s.log));
    expect({ p: gm.permission, gm: gm.isGm, e: gm.canEditPage, a: gm.canAdd, b: gm.canBin }).toEqual({ p: "view", gm: true, e: false, a: true, b: false });
    expect(await codeOf(s.run("gm", async (ctx) => assertAction(await pageAccess(ctx, s.log), "editPage")))).toBe("NOTE_FORBIDDEN_ACTION");
    expect(await codeOf(s.run("gm", async (ctx) => assertAction(await pageAccess(ctx, s.log), "add")))).toBe("ok");
    // The other player cannot read a 'gm' page at all.
    expect(await codeOf(s.run("p2", (ctx) => pageAccess(ctx, s.log)))).toBe("NOTE_PAGE_NOT_FOUND");
  });

  it("entry actions follow the author and the owner (Q3, D5)", async () => {
    const s = await withPlayerJournal();
    const byGm = await s.entry(s.log, "gm");
    const byOwner = await s.entry(s.log, "p1");
    const flags = (who: Who, entryId: Id<"journalEntries">) =>
      s.run(who, async (ctx) => {
        const { entry, access } = await entryAccess(ctx, entryId);
        return [access.canEditEntry(entry), access.canCycle(entry), access.canDeleteEntry(entry)];
      });
    // The GM's added entry: the GM edits, cycles and deletes it; the owner cycles and deletes it but cannot edit it.
    expect(await flags("gm", byGm)).toEqual([true, true, true]);
    expect(await flags("p1", byGm)).toEqual([false, true, true]);
    // The owner's entry: the GM, a reader, may do none of it.
    expect(await flags("gm", byOwner)).toEqual([false, false, false]);
    expect(await flags("p1", byOwner)).toEqual([true, true, true]);
    expect(await codeOf(s.run("p1", async (ctx) => { const { entry, access } = await entryAccess(ctx, byGm); assertAction(access, "editEntry", entry); }))).toBe("NOTE_FORBIDDEN_ACTION");
    // An entry on a page the caller cannot read does not exist for them.
    expect(await codeOf(s.run("p2", (ctx) => entryAccess(ctx, byOwner)))).toBe("NOTE_ENTRY_NOT_FOUND");
  });

  it("a departed journal is frozen (D2): writes answer NOTE_JOURNAL_CLOSED, the GM may tear out non-private pages only", async () => {
    const s = await withPlayerJournal();
    await s.setVisibility(s.people, "players");
    await s.setVisibility(s.goals, "private");
    await s.t.run((ctx) => ctx.db.patch("characters", s.characterId, { status: "retired" }));
    const gm = await s.run("gm", (ctx) => pageAccess(ctx, s.people));
    expect({ d: gm.departed, a: gm.canAdd, b: gm.canBin }).toEqual({ d: true, a: false, b: true });
    expect(await codeOf(s.run("gm", async (ctx) => assertAction(await pageAccess(ctx, s.people), "add")))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.run("gm", async (ctx) => assertAction(await pageAccess(ctx, s.people), "bin")))).toBe("ok");
    expect(await codeOf(s.run("gm", (ctx) => pageAccess(ctx, s.goals)))).toBe("NOTE_PAGE_NOT_FOUND");
    // The owner still reads the page but cannot write or tear it out; another player reads but may not tear it out.
    const owner = await s.run("p1", (ctx) => pageAccess(ctx, s.people));
    expect({ p: owner.permission, e: owner.canEditPage, b: owner.canBin }).toEqual({ p: "owner", e: false, b: false });
    expect(await codeOf(s.run("p1", async (ctx) => assertAction(await pageAccess(ctx, s.people), "bin")))).toBe("NOTE_JOURNAL_CLOSED");
    expect(await codeOf(s.run("p2", async (ctx) => assertAction(await pageAccess(ctx, s.people), "bin")))).toBe("NOTE_FORBIDDEN_ACTION");
  });

  it("a torn-out page: only its binner restores it; any other write is refused; NOTE_NOT_BINNED otherwise", async () => {
    const s = await withPlayerJournal();
    expect(await codeOf(s.run("p1", async (ctx) => assertAction(await pageAccess(ctx, s.clues), "restore")))).toBe("NOTE_NOT_BINNED");
    await s.t.run((ctx) => ctx.db.patch("journalPages", s.clues, { binnedAt: Date.now(), binnedBy: s.ids.p1 }));
    const owner = await s.run("p1", (ctx) => pageAccess(ctx, s.clues));
    expect({ b: owner.binned, r: owner.canRestore, a: owner.canAdd, e: owner.canEditPage }).toEqual({ b: true, r: true, a: false, e: false });
    expect(await codeOf(s.run("p1", async (ctx) => assertAction(await pageAccess(ctx, s.clues), "add")))).toBe("NOTE_FORBIDDEN_ACTION");
    expect(await codeOf(s.run("gm", (ctx) => pageAccess(ctx, s.clues)))).toBe("NOTE_PAGE_NOT_FOUND");
  });

  it("insertPage counts torn-out pages toward MAX_PAGES (NOTE_PAGE_LIMIT) and bumps the page counter", async () => {
    const s = await withPlayerJournal();
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 4; i < MAX_PAGES; i++) {
        await ctx.db.insert("journalPages", {
          campaignId: s.campaignId,
          journalId: s.journal._id,
          ownerId: s.ids.p1,
          kind: "collection",
          title: `P${i}`,
          tape: 0,
          visibility: "gm",
          binnedAt: now,
          binnedBy: s.ids.p1,
          entryCount: 0,
          openCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const add = () => s.run("p1", async (ctx) => insertPage(ctx, (await ctx.db.get("journals", s.journal._id))!, { kind: "future", title: "Later", tape: 1, visibility: "gm" }));
    expect(await codeOf(add())).toBe("NOTE_PAGE_LIMIT");
    await s.t.run(async (ctx) => {
      const one = await ctx.db.query("journalPages").withIndex("by_journal_binned", (q) => q.eq("journalId", s.journal._id).gte("binnedAt", 0)).first();
      await ctx.db.delete("journalPages", one!._id);
    });
    expect(await codeOf(add())).toBe("ok");
    expect((await s.t.run((ctx) => ctx.db.get("journals", s.journal._id)))!.pageCount).toBe(5);
  });

  it("bumpCounts moves page and journal counters together, but not the journal's for a torn-out page", async () => {
    const s = await withPlayerJournal();
    await s.run("p1", async (ctx) => bumpCounts(ctx, (await ctx.db.get("journalPages", s.log))!, { entries: 2, open: 1 }));
    await s.t.run((ctx) => ctx.db.patch("journalPages", s.goals, { binnedAt: Date.now(), binnedBy: s.ids.p1 }));
    await s.run("p1", async (ctx) => bumpCounts(ctx, (await ctx.db.get("journalPages", s.goals))!, { entries: 3 }));
    const [journal, log, goals] = await s.t.run(async (ctx) => [
      (await ctx.db.get("journals", s.journal._id))!,
      (await ctx.db.get("journalPages", s.log))!,
      (await ctx.db.get("journalPages", s.goals))!,
    ] as const);
    expect([journal.entryCount, journal.openCount, log.entryCount, log.openCount, goals.entryCount]).toEqual([2, 1, 2, 1, 3]);
  });

  it("deletePageRows deletes a page's entries and recipients in bounded steps", async () => {
    const s = await withPlayerJournal();
    for (let i = 0; i < 5; i++) await s.entry(s.people, "p1");
    await s.entry(s.log, "p1");
    await s.t.run((ctx) => ctx.db.insert("journalPageRecipients", { campaignId: s.campaignId, pageId: s.people, userId: s.ids.p2, addedAt: Date.now() }));
    expect(await s.run("p1", (ctx) => deletePageRows(ctx, s.people, 4))).toEqual({ deleted: 4, done: false });
    expect(await s.run("p1", (ctx) => deletePageRows(ctx, s.people, 4))).toEqual({ deleted: 2, done: true });
    const left = await s.t.run(async (ctx) => ({
      people: (await ctx.db.query("journalEntries").withIndex("by_page_order", (q) => q.eq("pageId", s.people)).collect()).length,
      log: (await ctx.db.query("journalEntries").withIndex("by_page_order", (q) => q.eq("pageId", s.log)).collect()).length,
      recipients: (await ctx.db.query("journalPageRecipients").withIndex("by_page_user", (q) => q.eq("pageId", s.people)).collect()).length,
    }));
    expect(left).toEqual({ people: 0, log: 1, recipients: 0 });
  });

  it("a page of another campaign is NOTE_PAGE_NOT_FOUND even for its owner", async () => {
    const s = await withPlayerJournal();
    const { campaignId: other } = await s.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const result = await s.t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", other))!;
      const user = (await ctx.db.get("users", s.ids.gm))!;
      return codeOf(pageAccess({ ...ctx, user, campaign }, s.log));
    });
    expect(result).toBe("NOTE_PAGE_NOT_FOUND");
  });
});
