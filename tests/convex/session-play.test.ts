import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_LOG_ENTRIES } from "../../convex/lib/validators/sessions";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S5: the Play stage's writes the Journal still uses (B4): reset the spotlight, add and remove log lines. GM-only
// (K10, Q4). The old reads (spotlight, tally, log) and bumpSpotlight were removed (JF3); the Journal's reads are
// tested in journal-spotlight.test.ts, journal-tally.test.ts and journal-log.test.ts.

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

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

/** A campaign with a GM, two players who each own a character (Ash, Bryn), the GM's own Cora, an outsider. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, out] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Play", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const ash = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const bryn = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  const cora = (await gm.mutation(api.characters.create, { campaignId, draft: draft("Cora"), idempotencyKey: key() })).characterId;
  const create = async () => (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
  const sessionId = await create();
  return { t, gm, p1, out, anon: t, ids, campaignId, ash, bryn, cora, sessionId, create };
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

/** Spotlight rows for the session (counted by the spotlight moves, convex/lib/spotlight.ts; seeded here directly). */
const seedSpotlight = (env: Env, sessionId: Id<"sessions">, characterId: Id<"characters">, count: number) =>
  env.t.run((ctx) => ctx.db.insert("sessionSpotlights", { campaignId: env.campaignId, sessionId, characterId, count }));

/** The session's log, newest first, as the rows read it (the Journal reads it through convex/journalLog.ts). */
const logOf = (env: Env, sessionId: Id<"sessions">) =>
  env.t.run((ctx) =>
    ctx.db
      .query("sessionLog")
      .withIndex("by_session_at", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .collect(),
  );

describe("session play: spotlight", () => {
  useAllowlist(EMAILS);

  it("resetSpotlight deletes only this session's rows", async () => {
    const env = await setup();
    const other = await env.create();
    for (const sessionId of [env.sessionId, other]) await seedSpotlight(env, sessionId, env.ash, 2);
    await env.gm.mutation(api.sessionPlay.resetSpotlight, { campaignId: env.campaignId, sessionId: env.sessionId });
    const rows = await env.t.run((ctx) => ctx.db.query("sessionSpotlights").collect());
    expect(rows.map((r) => r.sessionId)).toEqual([other]);
    expect(await failure(env.gm.mutation(api.sessionPlay.resetSpotlight, { campaignId: env.campaignId, sessionId: "nope" }))).toBe("SESSION_NOT_FOUND");
  });
});

describe("session play: log", () => {
  useAllowlist(EMAILS);

  it("addLog trims and stamps; log lists newest first with the automatic lines; removeLog deletes one", async () => {
    const env = await setup();
    const args = { campaignId: env.campaignId, sessionId: env.sessionId };
    await env.t.run((ctx) =>
      ctx.db.insert("sessionLog", { campaignId: env.campaignId, sessionId: env.sessionId, at: 1, text: "Session started.", by: env.ids.gm, auto: true }),
    );
    const first = await env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "  Ash bargained with the ferryman.  ", idempotencyKey: key() });
    const second = await env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "Bryn found the key.", idempotencyKey: key() });
    const listed = await logOf(env, env.sessionId);
    expect(listed.map((l) => [l.text, l.auto])).toEqual([
      ["Bryn found the key.", false],
      ["Ash bargained with the ferryman.", false],
      ["Session started.", true],
    ]);
    expect(listed[0]!._id).toBe(second.logId);
    expect(listed[1]!.at).toBeGreaterThan(1);
    const row = await env.t.run((ctx) => ctx.db.get("sessionLog", first.logId));
    expect(row).toMatchObject({ by: env.ids.gm, auto: false, campaignId: env.campaignId });
    await env.gm.mutation(api.sessionPlay.removeLog, { ...args, logId: first.logId });
    expect((await logOf(env, env.sessionId)).map((l) => l.text)).toEqual(["Bryn found the key.", "Session started."]);
    expect(await failure(env.gm.mutation(api.sessionPlay.removeLog, { ...args, logId: first.logId }))).toBe("SESSION_LOG_NOT_FOUND");
    expect(await failure(env.gm.mutation(api.sessionPlay.removeLog, { ...args, logId: "nope" }))).toBe("SESSION_LOG_NOT_FOUND");
    // The automatic Start/End lines stay.
    const autoId = listed[2]!._id;
    expect(await failure(env.gm.mutation(api.sessionPlay.removeLog, { ...args, logId: autoId }))).toBe("INVALID");
    // A line of another session is not this session's.
    const other = await env.create();
    expect(await failure(env.gm.mutation(api.sessionPlay.removeLog, { campaignId: env.campaignId, sessionId: other, logId: second.logId }))).toBe(
      "SESSION_LOG_NOT_FOUND",
    );
  });

  it("addLog is retry-safe, refuses empty or over-long text with INVALID and a full log with SESSION_LOG_LIMIT", async () => {
    const env = await setup();
    const args = { campaignId: env.campaignId, sessionId: env.sessionId };
    const idempotencyKey = key();
    const once = await env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "Once", idempotencyKey });
    expect(await env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "Once", idempotencyKey })).toEqual(once);
    expect(await logOf(env, env.sessionId)).toHaveLength(1);
    expect(await failure(env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "   ", idempotencyKey: key() }))).toBe("INVALID");
    expect(await failure(env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "x".repeat(301), idempotencyKey: key() }))).toBe("INVALID");
    await env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "x".repeat(300), idempotencyKey: key() });
    await env.t.run(async (ctx) => {
      for (let i = 2; i < MAX_LOG_ENTRIES; i++) {
        await ctx.db.insert("sessionLog", { campaignId: env.campaignId, sessionId: env.sessionId, at: i, text: `line ${i}`, by: env.ids.gm, auto: false });
      }
    });
    expect(await failure(env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "One more", idempotencyKey: key() }))).toBe("SESSION_LOG_LIMIT");
    expect(await logOf(env, env.sessionId)).toHaveLength(MAX_LOG_ENTRIES);
    expect(await failure(env.gm.mutation(api.sessionPlay.addLog, { ...args, sessionId: "nope", text: "Hi", idempotencyKey: key() }))).toBe("SESSION_NOT_FOUND");
  });
});

describe("session play: access (anonymous, outsider, player, GM)", () => {
  useAllowlist(EMAILS);

  it("every function is GM-only: UNAUTHENTICATED, NOT_FOUND, FORBIDDEN, then success", async () => {
    const env = await setup();
    const logId = (await env.gm.mutation(api.sessionPlay.addLog, { campaignId: env.campaignId, sessionId: env.sessionId, text: "Seed", idempotencyKey: key() }))
      .logId;
    const base = { campaignId: env.campaignId, sessionId: env.sessionId };
    type Caller = typeof env.gm | typeof env.anon;
    const calls: [string, (c: Caller) => Promise<unknown>][] = [
      ["resetSpotlight", (c) => c.mutation(api.sessionPlay.resetSpotlight, base)],
      ["addLog", (c) => c.mutation(api.sessionPlay.addLog, { ...base, text: "Hi", idempotencyKey: key() })],
      ["removeLog", (c) => c.mutation(api.sessionPlay.removeLog, { ...base, logId })],
    ];
    for (const [name, call] of calls) {
      expect([name, await failure(call(env.anon))]).toEqual([name, "UNAUTHENTICATED"]);
      expect([name, await failure(call(env.out))]).toEqual([name, "NOT_FOUND"]);
      expect([name, await failure(call(env.p1))]).toEqual([name, "FORBIDDEN"]);
      await call(env.gm);
    }
  });
});
