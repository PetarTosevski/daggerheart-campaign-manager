import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Journal JD6: 'Threads raised' (convex/journalThreads.ts raised, user Q1 / Q2): the open threads on the caller's own
// pages linked to the session. Per viewer: never a GM page for a player, never another player's page, never a shared
// page, never a torn-out page; a bad or (for a player) planned session is SESSION_NOT_FOUND.

const GM = "gm@example.com";
const P1 = "p1@example.com";
const P2 = "p2@example.com";
const P3 = "p3@example.com";
const OUTSIDER = "outsider@example.com";

type Who = "gm" | "p1" | "p2" | "p3" | "outsider";
type Role = Who | "anon";

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
    p1: await ctx.db.insert("users", { email: P1, emailVerificationTime: 1 }),
    p2: await ctx.db.insert("users", { email: P2, emailVerificationTime: 1 }),
    p3: await ctx.db.insert("users", { email: P3, emailVerificationTime: 1 }),
    outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
  }));
  const as = (who: Who) => t.withIdentity({ subject: `${ids[who]}|s` });
  const client = (who: Role) => (who === "anon" ? t : as(who));
  const { campaignId } = await as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Threads", idempotencyKey: key() });
  for (const who of ["p1", "p2", "p3"] as const) {
    const code = await as("gm").mutation(api.members.rotateJoinCode, { campaignId });
    await as(who).mutation(api.members.joinByCode, { code });
  }
  const now = Date.now();
  for (const [who, name] of [["p1", "Ash"], ["p2", "Bryn"]] as const) {
    await t.run((ctx) =>
      ctx.db.insert("characters", { campaignId, ownerId: ids[who], createdBy: ids[who], status: "active", sheet: { name }, createdAt: now, updatedAt: now }),
    );
  }
  async function session(played: boolean) {
    const { sessionId } = await as("gm").mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
    if (played) await as("gm").mutation(api.sessionRecords.setPlayed, { campaignId, sessionId, played: true });
    return sessionId;
  }
  const call = {
    raised: (who: Role, sessionId: string) => client(who).query(api.journalThreads.raised, { campaignId, sessionId }),
    page: (who: Who, sessionId?: Id<"sessions">) => as(who).mutation(api.notes.createPage, { campaignId, kind: "log", sessionId }),
    add: async (who: Who, page: Id<"journalPages">, text: string, kind: Doc<"journalEntries">["kind"] = "task") =>
      (await as(who).mutation(api.notesEntries.add, { campaignId, page, kind, text })).entryId,
    cycle: (who: Who, entryId: Id<"journalEntries">) => as(who).mutation(api.notesEntries.cycle, { campaignId, entryId }),
  };
  const patchPage = (pageId: Id<"journalPages">, patch: Partial<Doc<"journalPages">>) => t.run((ctx) => ctx.db.patch("journalPages", pageId, patch));
  return { t, ids, as, campaignId, session, call, patchPage };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return errorCode(error);
  }
}

describe("journalThreads.raised", () => {
  useAllowlist(`${GM},${P1},${P2},${P3},${OUTSIDER}`);

  it("role table: anonymous, outsider, players (with and without a journal) and the GM", async () => {
    const s = await setup();
    const sessionId = await s.session(true);
    const actual: Record<string, unknown> = {};
    for (const who of ["anon", "outsider", "p1", "p2", "p3", "gm"] as const) actual[who] = await codeOf(s.call.raised(who, sessionId));
    expect(actual).toEqual({ anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", p1: "ok", p2: "ok", p3: "ok", gm: "ok" });
  });

  it("lists the open tasks and unresolved Fears on the caller's own pages linked to the session, in page then entry order", async () => {
    const s = await setup();
    const one = await s.session(true);
    const two = await s.session(true);
    const first = await s.call.page("p1", one);
    const task = await s.call.add("p1", first, "find the ferryman");
    const done = await s.call.add("p1", first, "pay the toll");
    await s.call.cycle("p1", done);
    const note = await s.call.add("p1", first, "the river is high", "note");
    const fear = await s.call.add("p1", first, "ambush at the bridge", "fear");
    const second = await s.call.page("p1", one);
    const later = await s.call.add("p1", second, "ask about the GM");
    const other = await s.call.page("p1", two);
    await s.call.add("p1", other, "another session's task");
    const unlinked = await s.call.page("p1");
    await s.patchPage(unlinked, { sessionId: undefined });
    await s.call.add("p1", unlinked, "an unlinked task");

    const rows = await s.call.raised("p1", one);
    expect(rows.map((r) => r.entryId)).toEqual([task, fear, later]);
    expect(rows.map((r) => r.entryId)).not.toContain(done);
    expect(rows.map((r) => r.entryId)).not.toContain(note);
    const pages = await s.t.run((ctx) => Promise.all([ctx.db.get(first), ctx.db.get(second)]));
    expect(rows[0]).toEqual({ entryId: task, pageId: first, pageTitle: pages[0]!.title, kind: "task", state: "open", text: "find the ferryman" });
    expect(rows[1]).toMatchObject({ entryId: fear, kind: "fear", pageId: first });
    expect(rows[2]).toMatchObject({ entryId: later, pageId: second, pageTitle: pages[1]!.title });
    expect((await s.call.raised("p1", two)).map((r) => r.text)).toEqual(["another session's task"]);
  });

  it("per viewer: never another player's page, a GM page or a page shared with the caller", async () => {
    const s = await setup();
    const sessionId = await s.session(true);
    const p1Page = await s.call.page("p1", sessionId);
    await s.as("p1").mutation(api.notesSharing.setVisibility, { campaignId: s.campaignId, page: p1Page, visibility: "everyone" });
    await s.call.add("p1", p1Page, "p1's thread");
    const gmPage = await s.call.page("gm", sessionId);
    await s.as("gm").mutation(api.notesSharing.setVisibility, { campaignId: s.campaignId, page: gmPage, visibility: "everyone" });
    await s.call.add("gm", gmPage, "the GM's thread");
    // P2 adds a line to P1's shared page: it is P1's thread (their own page), not P2's.
    await s.call.add("p2", p1Page, "p2 added this");
    const p2Page = await s.call.page("p2", sessionId);
    await s.call.add("p2", p2Page, "p2's own thread");

    expect((await s.call.raised("p1", sessionId)).map((r) => r.text)).toEqual(["p1's thread", "p2 added this"]);
    expect((await s.call.raised("p2", sessionId)).map((r) => r.text)).toEqual(["p2's own thread"]);
    expect((await s.call.raised("gm", sessionId)).map((r) => r.text)).toEqual(["the GM's thread"]);
    expect(await s.call.raised("p3", sessionId)).toEqual([]);
  });

  it("leaves out torn-out pages and resolved threads", async () => {
    const s = await setup();
    const sessionId = await s.session(true);
    const page = await s.call.page("p1", sessionId);
    const task = await s.call.add("p1", page, "find the ferryman");
    expect(await s.call.raised("p1", sessionId)).toHaveLength(1);
    await s.call.cycle("p1", task);
    expect(await s.call.raised("p1", sessionId)).toEqual([]);
    const binned = await s.call.page("p1", sessionId);
    await s.call.add("p1", binned, "a torn-out thread");
    await s.as("p1").mutation(api.notesBin.binPage, { campaignId: s.campaignId, page: binned });
    expect(await s.call.raised("p1", sessionId)).toEqual([]);
  });

  it("SESSION_NOT_FOUND for a bad id, another campaign's session, and a planned session for a player", async () => {
    const s = await setup();
    const planned = await s.session(false);
    expect(await codeOf(s.call.raised("p1", "not-an-id"))).toBe("SESSION_NOT_FOUND");
    expect(await codeOf(s.call.raised("gm", s.campaignId))).toBe("SESSION_NOT_FOUND");
    const { campaignId: otherCampaign } = await s.as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const { sessionId: foreign } = await s.as("gm").mutation(api.sessionRecords.create, { campaignId: otherCampaign, idempotencyKey: key() });
    expect(await codeOf(s.call.raised("gm", foreign))).toBe("SESSION_NOT_FOUND");
    expect(await codeOf(s.call.raised("p1", planned))).toBe("SESSION_NOT_FOUND");
    // The GM reads their own pages on a planned session.
    const gmPage = await s.call.page("gm", planned);
    await s.call.add("gm", gmPage, "prep the ambush");
    expect((await s.call.raised("gm", planned)).map((r) => r.text)).toEqual(["prep the ambush"]);
  });
});
