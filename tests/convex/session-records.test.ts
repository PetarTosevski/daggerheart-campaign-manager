import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_SESSIONS } from "../../convex/lib/validators/sessions";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S2: session records (B1, Q4, Q10). The GM creates, titles, dates, marks played and deletes sessions; everyone
// in the campaign reads the list, players only live and played sessions with their recap.

const EMAILS = "gm@example.com,p1@example.com,out@example.com";

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Records", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const create = async () => (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
  return { t, gm, p1, out, ids, campaignId, create };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("expected the call to fail");
}

const row = (env: Env, id: Id<"sessions">) => env.t.run((ctx) => ctx.db.get("sessions", id));

describe("session records", () => {
  useAllowlist(EMAILS);

  it("create numbers sessions highest + 1, planned; gaps after a delete are kept; the key makes a retry a no-op", async () => {
    const env = await setup();
    const idempotencyKey = key();
    const first = await env.gm.mutation(api.sessionRecords.create, { campaignId: env.campaignId, idempotencyKey });
    expect(first.n).toBe(1);
    expect(await env.gm.mutation(api.sessionRecords.create, { campaignId: env.campaignId, idempotencyKey })).toEqual(first);
    const second = await env.create();
    await env.create();
    // Deleting session 2 keeps the gap: the list is 3, 1 and the next session is 4 (highest + 1).
    await env.gm.mutation(api.sessionRecords.remove, { campaignId: env.campaignId, sessionId: second });
    const fourth = await env.gm.mutation(api.sessionRecords.create, { campaignId: env.campaignId, idempotencyKey: key() });
    expect(fourth.n).toBe(4);
    const listed = await env.gm.query(api.sessionRecords.list, { campaignId: env.campaignId });
    expect(listed.map((s) => [s.n, s.status])).toEqual([
      [4, "planned"],
      [3, "planned"],
      [1, "planned"],
    ]);
  });

  it(`create refuses past ${MAX_SESSIONS} sessions with SESSION_LIMIT`, async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      for (let n = 1; n <= MAX_SESSIONS; n++) {
        await ctx.db.insert("sessions", { campaignId: env.campaignId, n, status: "played", createdAt: 0, updatedAt: 0 });
      }
    });
    expect(await failure(env.gm.mutation(api.sessionRecords.create, { campaignId: env.campaignId, idempotencyKey: key() }))).toBe("SESSION_LIMIT");
  });

  it("setTitle trims, clears with an empty title and refuses more than 120 characters", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const set = (title: string) => env.gm.mutation(api.sessionRecords.setTitle, { campaignId: env.campaignId, sessionId, title });
    await set("  The Bridge at Dawn  ");
    expect((await row(env, sessionId))!.title).toBe("The Bridge at Dawn");
    expect(await failure(set("x".repeat(121)))).toBe("INVALID");
    await set("   ");
    expect((await row(env, sessionId))!.title).toBeUndefined();
  });

  it("setDate takes 'YYYY-MM-DD' or a clear, and refuses anything else with INVALID", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const set = (date: string | null) => env.gm.mutation(api.sessionRecords.setDate, { campaignId: env.campaignId, sessionId, date });
    await set("2026-10-24");
    expect((await row(env, sessionId))!.date).toBe("2026-10-24");
    for (const bad of ["2026-02-30", "24.10.2026", "2026-10-24T18:00", "soon"]) expect(await failure(set(bad))).toBe("INVALID");
    expect((await row(env, sessionId))!.date).toBe("2026-10-24");
    await set(null);
    expect((await row(env, sessionId))!.date).toBeUndefined();
    await set("2026-11-01");
    await set("");
    expect((await row(env, sessionId))!.date).toBeUndefined();
  });

  it("setPlayed flips planned <-> played without start or end effects; the live session refuses with SESSION_LIVE", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const before = await env.t.run(async (ctx) => ({
      state: await ctx.db
        .query("campaignState")
        .withIndex("by_campaign", (q) => q.eq("campaignId", env.campaignId))
        .unique(),
      log: (await ctx.db.query("actionLog").collect()).length,
    }));
    const set = (played: boolean) => env.gm.mutation(api.sessionRecords.setPlayed, { campaignId: env.campaignId, sessionId, played });
    await set(true);
    expect((await row(env, sessionId))!.status).toBe("played");
    await set(true);
    expect((await row(env, sessionId))!.status).toBe("played");
    await set(false);
    const after = await row(env, sessionId);
    expect(after!.status).toBe("planned");
    expect(after!.startedAt).toBeUndefined();
    expect(after!.endedAt).toBeUndefined();
    const now = await env.t.run(async (ctx) => ({
      state: await ctx.db
        .query("campaignState")
        .withIndex("by_campaign", (q) => q.eq("campaignId", env.campaignId))
        .unique(),
      log: (await ctx.db.query("actionLog").collect()).length,
    }));
    expect(now).toEqual(before);

    await env.t.run((ctx) => ctx.db.patch("sessions", sessionId, { status: "live", startedAt: Date.now() }));
    expect(await failure(set(true))).toBe("SESSION_LIVE");
    expect(await failure(set(false))).toBe("SESSION_LIVE");
    expect((await row(env, sessionId))!.status).toBe("live");
  });

  it("remove deletes the session with its prep, log and spotlight rows, keeps a linked encounter, refuses a live one", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const other = await env.create();
    const seeded = await env.t.run(async (ctx) => {
      const now = Date.now();
      const encounterId = await ctx.db.insert("encounters", { campaignId: env.campaignId, name: "Session 1 encounter", status: "draft", pcs: 4, adjustments: [], gmTurn: 0, createdAt: now, updatedAt: now });
      const characterId = await ctx.db.insert("characters", { campaignId: env.campaignId, ownerId: env.ids.gm, createdBy: env.ids.gm, status: "active", sheet: {}, createdAt: now, updatedAt: now });
      for (const id of [sessionId, other]) {
        await ctx.db.insert("sessionPrep", { campaignId: env.campaignId, sessionId: id, scenes: [], encounterId, updatedAt: 0 });
        await ctx.db.insert("sessionLog", { campaignId: env.campaignId, sessionId: id, at: 1, text: "Hello", by: env.ids.gm, auto: false });
        await ctx.db.insert("sessionSpotlights", { campaignId: env.campaignId, sessionId: id, characterId, count: 2 });
      }
      return { encounterId };
    });
    await env.gm.mutation(api.sessionRecords.remove, { campaignId: env.campaignId, sessionId });
    const left = await env.t.run(async (ctx) => ({
      session: await ctx.db.get("sessions", sessionId),
      prep: (await ctx.db.query("sessionPrep").collect()).map((r) => r.sessionId),
      log: (await ctx.db.query("sessionLog").collect()).map((r) => r.sessionId),
      spotlights: (await ctx.db.query("sessionSpotlights").collect()).map((r) => r.sessionId),
      encounter: await ctx.db.get("encounters", seeded.encounterId),
    }));
    expect(left.session).toBeNull();
    expect(left.prep).toEqual([other]);
    expect(left.log).toEqual([other]);
    expect(left.spotlights).toEqual([other]);
    expect(left.encounter).not.toBeNull();
    expect(await failure(env.gm.mutation(api.sessionRecords.remove, { campaignId: env.campaignId, sessionId }))).toBe("SESSION_NOT_FOUND");

    await env.t.run((ctx) => ctx.db.patch("sessions", other, { status: "live", startedAt: Date.now() }));
    expect(await failure(env.gm.mutation(api.sessionRecords.remove, { campaignId: env.campaignId, sessionId: other }))).toBe("SESSION_LIVE");
    expect(await row(env, other)).not.toBeNull();
  });

  it("list: the GM gets every session with times; a player only live and played ones with their recap (Q4)", async () => {
    const env = await setup();
    const [planned, played, live] = [await env.create(), await env.create(), await env.create()];
    await env.t.run(async (ctx) => {
      await ctx.db.patch("sessions", planned, { title: "Secret prep", recap: "never shown", date: "2026-11-01" });
      await ctx.db.patch("sessions", played, { status: "played", title: "The Bridge", recap: "We crossed.", startedAt: 10, endedAt: 20 });
      await ctx.db.patch("sessions", live, { status: "live", startedAt: 30 });
    });
    const gm = await env.gm.query(api.sessionRecords.list, { campaignId: env.campaignId });
    expect(gm).toEqual([
      { _id: live, n: 3, status: "live", startedAt: 30 },
      { _id: played, n: 2, title: "The Bridge", status: "played", startedAt: 10, endedAt: 20 },
      { _id: planned, n: 1, title: "Secret prep", date: "2026-11-01", status: "planned" },
    ]);
    const player = await env.p1.query(api.sessionRecords.list, { campaignId: env.campaignId });
    expect(player).toEqual([
      { _id: live, n: 3, status: "live" },
      { _id: played, n: 2, title: "The Bridge", status: "played", recap: "We crossed." },
    ]);
  });

  it("a session id from another campaign or a malformed one is SESSION_NOT_FOUND", async () => {
    const env = await setup();
    const { campaignId: otherCampaign } = await env.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const foreign = (await env.gm.mutation(api.sessionRecords.create, { campaignId: otherCampaign, idempotencyKey: key() })).sessionId;
    for (const sessionId of [foreign, "not-an-id"]) {
      expect(await failure(env.gm.mutation(api.sessionRecords.setTitle, { campaignId: env.campaignId, sessionId, title: "x" }))).toBe("SESSION_NOT_FOUND");
      expect(await failure(env.gm.mutation(api.sessionRecords.setDate, { campaignId: env.campaignId, sessionId, date: null }))).toBe("SESSION_NOT_FOUND");
      expect(await failure(env.gm.mutation(api.sessionRecords.setPlayed, { campaignId: env.campaignId, sessionId, played: true }))).toBe("SESSION_NOT_FOUND");
      expect(await failure(env.gm.mutation(api.sessionRecords.remove, { campaignId: env.campaignId, sessionId }))).toBe("SESSION_NOT_FOUND");
    }
    expect((await row(env, foreign))!.status).toBe("planned");
  });

  describe("authorization: anonymous, outsider, player, GM", () => {
    it("list: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player and GM read", async () => {
      const env = await setup();
      await env.create();
      const args = { campaignId: env.campaignId };
      expect(await failure(env.t.query(api.sessionRecords.list, args))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.query(api.sessionRecords.list, args))).toBe("NOT_FOUND");
      expect(await env.p1.query(api.sessionRecords.list, args)).toEqual([]);
      expect(await env.gm.query(api.sessionRecords.list, args)).toHaveLength(1);
    });

    it("create: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM creates", async () => {
      const env = await setup();
      const args = () => ({ campaignId: env.campaignId, idempotencyKey: key() });
      expect(await failure(env.t.mutation(api.sessionRecords.create, args()))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.mutation(api.sessionRecords.create, args()))).toBe("NOT_FOUND");
      expect(await failure(env.p1.mutation(api.sessionRecords.create, args()))).toBe("FORBIDDEN");
      expect((await env.gm.mutation(api.sessionRecords.create, args())).n).toBe(1);
    });

    const writes = [
      ["setTitle", (sessionId: string) => ({ sessionId, title: "Title" })],
      ["setDate", (sessionId: string) => ({ sessionId, date: "2026-10-24" })],
      ["setPlayed", (sessionId: string) => ({ sessionId, played: true })],
      ["remove", (sessionId: string) => ({ sessionId })],
    ] as const;

    for (const [name, extra] of writes) {
      it(`${name}: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM may`, async () => {
        const env = await setup();
        const sessionId = await env.create();
        const fn = api.sessionRecords[name] as typeof api.sessionRecords.setTitle;
        const args = { campaignId: env.campaignId, ...extra(sessionId) } as never;
        expect(await failure(env.t.mutation(fn, args))).toBe("UNAUTHENTICATED");
        expect(await failure(env.out.mutation(fn, args))).toBe("NOT_FOUND");
        expect(await failure(env.p1.mutation(fn, args))).toBe("FORBIDDEN");
        expect(await env.gm.mutation(fn, args)).toBeNull();
      });
    }
  });
});
