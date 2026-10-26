import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { SESSION_TEXT_MAX } from "../../convex/lib/validators/sessions";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S6: Wrap-up (B5, B9, Q4, Q5). The GM writes the recap (sessions), loot and threads (sessionPrep, GM-only) and
// calls the milestone (the roster's 'Party levels up', one way); every member reads the dashboard's session summary.

const EMAILS = "gm@example.com,p1@example.com,out@example.com";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
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

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Wrap", idempotencyKey: key() });
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

const wrap = (env: Env, sessionId: string) => env.gm.query(api.sessionWrap.get, { campaignId: env.campaignId, sessionId });
const prepRows = (env: Env, sessionId: Id<"sessions">) =>
  env.t.run((ctx) => ctx.db.query("sessionPrep").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect());

describe("session wrap-up", () => {
  useAllowlist(EMAILS);

  it("get starts empty; setRecap trims, clears with an empty text and refuses more than 6000 characters", async () => {
    const env = await setup();
    const sessionId = await env.create();
    expect(await wrap(env, sessionId)).toEqual({ sessionId, n: 1 });
    const set = (recap: string) => env.gm.mutation(api.sessionWrap.setRecap, { campaignId: env.campaignId, sessionId, recap });
    await set("  The party crossed the river at dawn.  ");
    expect((await wrap(env, sessionId))!.recap).toBe("The party crossed the river at dawn.");
    expect(await failure(set("x".repeat(SESSION_TEXT_MAX.recap + 1)))).toBe("INVALID");
    await set("y".repeat(SESSION_TEXT_MAX.recap));
    await set("   ");
    expect((await wrap(env, sessionId))!.recap).toBeUndefined();
    // The recap writes no prep row.
    expect(await prepRows(env, sessionId)).toEqual([]);
  });

  it("setLoot and setThreads create the prep row on the first write, then patch it; caps 2000 / 4000; empty clears", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const loot = (text: string) => env.gm.mutation(api.sessionWrap.setLoot, { campaignId: env.campaignId, sessionId, loot: text });
    const threads = (text: string) => env.gm.mutation(api.sessionWrap.setThreads, { campaignId: env.campaignId, sessionId, threads: text });
    // Clearing an absent field creates nothing.
    await loot("");
    expect(await prepRows(env, sessionId)).toEqual([]);
    await loot(" A bag of gold, the Wither Lantern ");
    let rows = await prepRows(env, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ campaignId: env.campaignId, sessionId, scenes: [], loot: "A bag of gold, the Wither Lantern" });
    await threads("The Blight countdown ticked to 3.");
    rows = await prepRows(env, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ loot: "A bag of gold, the Wither Lantern", threads: "The Blight countdown ticked to 3." });
    expect(await wrap(env, sessionId)).toEqual({
      sessionId,
      n: 1,
      loot: "A bag of gold, the Wither Lantern",
      threads: "The Blight countdown ticked to 3.",
    });
    expect(await failure(loot("x".repeat(SESSION_TEXT_MAX.loot + 1)))).toBe("INVALID");
    expect(await failure(threads("x".repeat(SESSION_TEXT_MAX.threads + 1)))).toBe("INVALID");
    await threads("x".repeat(SESSION_TEXT_MAX.threads));
    await loot("");
    expect((await wrap(env, sessionId))!.loot).toBeUndefined();
    // A prep row S4 created (scenes, hooks) keeps its fields.
    const other = await env.create();
    await env.t.run((ctx) =>
      ctx.db.insert("sessionPrep", { campaignId: env.campaignId, sessionId: other, scenes: [{ id: "a", type: "combat", text: "Ambush" }], hooks: "Hook", updatedAt: 0 }),
    );
    await env.gm.mutation(api.sessionWrap.setLoot, { campaignId: env.campaignId, sessionId: other, loot: "Gold" });
    expect((await prepRows(env, other))[0]).toMatchObject({ scenes: [{ id: "a", type: "combat", text: "Ambush" }], hooks: "Hook", loot: "Gold" });
  });

  it("callMilestone flags every active character below level 10, stamps milestoneAt, and a second call is a no-op", async () => {
    const env = await setup();
    const make = async (name: string) =>
      (await env.gm.mutation(api.characters.create, { campaignId: env.campaignId, draft: draft(name), idempotencyKey: key() })).characterId;
    const ash = await make("Ash");
    const bryn = await make("Bryn");
    const cael = await make("Cael");
    await env.t.run(async (ctx) => {
      await ctx.db.patch("characters", bryn, { status: "away", away: { reason: "infirmary" } });
      const sheet = readSheet((await ctx.db.get("characters", cael))!.sheet);
      await saveSheet(ctx, cael, { ...sheet, level: 10 });
    });
    const sessionId = await env.create();
    const idempotencyKey = key();
    const call = (k = key()) => env.gm.mutation(api.sessionWrap.callMilestone, { campaignId: env.campaignId, sessionId, idempotencyKey: k });
    const first = await call(idempotencyKey);
    expect(first).toMatchObject({ flagged: 1, called: true });
    expect((await wrap(env, sessionId))!.milestoneAt).toBe(first.milestoneAt);
    // The retry with the same key returns the same result.
    expect(await call(idempotencyKey)).toEqual(first);
    const pending = await env.t.run(async (ctx) => ({
      ash: readSheet((await ctx.db.get("characters", ash))!.sheet).levelUpPending,
      bryn: readSheet((await ctx.db.get("characters", bryn))!.sheet).levelUpPending,
      cael: readSheet((await ctx.db.get("characters", cael))!.sheet).levelUpPending,
    }));
    expect(pending).toEqual({ ash: true, bryn: false, cael: false });
    const logRows = async () =>
      env.t.run(async (ctx) =>
        (await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", env.campaignId)).collect()).filter((r) => r.kind === "levelUp"),
      );
    expect(await logRows()).toHaveLength(1);
    // A new call on the same session changes nothing (no unflag, no second log row, the stamp stays).
    await env.t.run(async (ctx) => {
      const sheet = readSheet((await ctx.db.get("characters", ash))!.sheet);
      await saveSheet(ctx, ash, { ...sheet, levelUpPending: false });
    });
    expect(await call()).toEqual({ flagged: 0, called: false, milestoneAt: first.milestoneAt });
    expect(await logRows()).toHaveLength(1);
    expect(await env.t.run(async (ctx) => readSheet((await ctx.db.get("characters", ash))!.sheet).levelUpPending)).toBe(false);
    // Another session may call its own milestone.
    const next = await env.create();
    expect(await env.gm.mutation(api.sessionWrap.callMilestone, { campaignId: env.campaignId, sessionId: next, idempotencyKey: key() })).toMatchObject({
      flagged: 1,
      called: true,
    });
  });

  it("dashboard: number, next date, live session and last recap with the board's fallbacks; no planned titles", async () => {
    const env = await setup();
    const read = () => env.p1.query(api.sessionWrap.dashboard, { campaignId: env.campaignId });
    expect(await read()).toEqual({
      dashboardNumber: "No sessions yet",
      nextSessionLine: "Next session not scheduled",
      nextDate: null,
      live: null,
      lastPlayed: null,
      lastSessionText: "No sessions played yet. Write a recap in a session's Wrap-up stage and it will appear here.",
    });
    const s1 = await env.create();
    const s2 = await env.create();
    const s3 = await env.create();
    await env.gm.mutation(api.sessionRecords.setTitle, { campaignId: env.campaignId, sessionId: s3, title: "Secret plans" });
    await env.gm.mutation(api.sessionRecords.setDate, { campaignId: env.campaignId, sessionId: s3, date: "2026-10-31" });
    await env.gm.mutation(api.sessionRecords.setDate, { campaignId: env.campaignId, sessionId: s2, date: "2026-10-24" });
    await env.gm.mutation(api.sessionRecords.setPlayed, { campaignId: env.campaignId, sessionId: s1, played: true });
    let d = await read();
    expect(d).toMatchObject({
      dashboardNumber: "Session 1",
      nextSessionLine: "Next session Oct 24, 2026",
      nextDate: "2026-10-24",
      live: null,
      lastPlayed: { sessionId: s1, n: 1, recap: null },
      lastSessionText: "Session 1 was played, but no recap was written. Add one in the session's Wrap-up.",
    });
    expect(JSON.stringify(d)).not.toContain("Secret plans");
    await env.gm.mutation(api.sessionWrap.setRecap, { campaignId: env.campaignId, sessionId: s1, recap: "They met the Warden." });
    // A planned session's recap never reaches the dashboard.
    await env.gm.mutation(api.sessionWrap.setRecap, { campaignId: env.campaignId, sessionId: s2, recap: "Draft for later" });
    d = await read();
    expect(d.lastSessionText).toBe("They met the Warden.");
    expect(d.lastPlayed).toEqual({ sessionId: s1, n: 1, recap: "They met the Warden." });
    expect(JSON.stringify(d)).not.toContain("Draft for later");
    // A live session wins the hero number; its date is not 'Next'.
    await env.t.run((ctx) => ctx.db.patch("sessions", s2, { status: "live", startedAt: Date.now() }));
    d = await read();
    expect(d).toMatchObject({ dashboardNumber: "Session 2", live: { sessionId: s2, n: 2 }, nextDate: "2026-10-31", nextSessionLine: "Next session Oct 31, 2026" });
    expect(await env.gm.query(api.sessionWrap.dashboard, { campaignId: env.campaignId })).toEqual(d);
  });

  it("get returns null and every write refuses a foreign or malformed session id with SESSION_NOT_FOUND", async () => {
    const env = await setup();
    const { campaignId: otherCampaign } = await env.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const foreign = (await env.gm.mutation(api.sessionRecords.create, { campaignId: otherCampaign, idempotencyKey: key() })).sessionId;
    const campaignId = env.campaignId;
    for (const sessionId of [foreign, "not-an-id"]) {
      expect(await env.gm.query(api.sessionWrap.get, { campaignId, sessionId })).toBeNull();
      expect(await failure(env.gm.mutation(api.sessionWrap.setRecap, { campaignId, sessionId, recap: "x" }))).toBe("SESSION_NOT_FOUND");
      expect(await failure(env.gm.mutation(api.sessionWrap.setLoot, { campaignId, sessionId, loot: "x" }))).toBe("SESSION_NOT_FOUND");
      expect(await failure(env.gm.mutation(api.sessionWrap.setThreads, { campaignId, sessionId, threads: "x" }))).toBe("SESSION_NOT_FOUND");
      expect(await failure(env.gm.mutation(api.sessionWrap.callMilestone, { campaignId, sessionId, idempotencyKey: key() }))).toBe("SESSION_NOT_FOUND");
    }
    expect(await env.t.run((ctx) => ctx.db.get("sessions", foreign))).toMatchObject({ status: "planned" });
  });

  describe("authorization: anonymous, outsider, player, GM", () => {
    it("get: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN (loot and threads are GM-only), GM reads", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const args = { campaignId: env.campaignId, sessionId };
      expect(await failure(env.t.query(api.sessionWrap.get, args))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.query(api.sessionWrap.get, args))).toBe("NOT_FOUND");
      expect(await failure(env.p1.query(api.sessionWrap.get, args))).toBe("FORBIDDEN");
      expect(await env.gm.query(api.sessionWrap.get, args)).toEqual({ sessionId, n: 1 });
    });

    it("dashboard: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player and GM read", async () => {
      const env = await setup();
      const args = { campaignId: env.campaignId };
      expect(await failure(env.t.query(api.sessionWrap.dashboard, args))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.query(api.sessionWrap.dashboard, args))).toBe("NOT_FOUND");
      expect((await env.p1.query(api.sessionWrap.dashboard, args)).dashboardNumber).toBe("No sessions yet");
      expect((await env.gm.query(api.sessionWrap.dashboard, args)).dashboardNumber).toBe("No sessions yet");
    });

    const writes = [
      ["setRecap", (sessionId: string) => ({ sessionId, recap: "Recap" })],
      ["setLoot", (sessionId: string) => ({ sessionId, loot: "Loot" })],
      ["setThreads", (sessionId: string) => ({ sessionId, threads: "Threads" })],
    ] as const;

    for (const [name, extra] of writes) {
      it(`${name}: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM may`, async () => {
        const env = await setup();
        const sessionId = await env.create();
        const fn = api.sessionWrap[name] as typeof api.sessionWrap.setRecap;
        const args = { campaignId: env.campaignId, ...extra(sessionId) } as never;
        expect(await failure(env.t.mutation(fn, args))).toBe("UNAUTHENTICATED");
        expect(await failure(env.out.mutation(fn, args))).toBe("NOT_FOUND");
        expect(await failure(env.p1.mutation(fn, args))).toBe("FORBIDDEN");
        expect(await env.gm.mutation(fn, args)).toBeNull();
      });
    }

    it("callMilestone: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM calls it", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const args = () => ({ campaignId: env.campaignId, sessionId, idempotencyKey: key() });
      expect(await failure(env.t.mutation(api.sessionWrap.callMilestone, args()))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.mutation(api.sessionWrap.callMilestone, args()))).toBe("NOT_FOUND");
      expect(await failure(env.p1.mutation(api.sessionWrap.callMilestone, args()))).toBe("FORBIDDEN");
      expect(await env.gm.mutation(api.sessionWrap.callMilestone, args())).toMatchObject({ flagged: 0, called: true });
    });
  });
});
