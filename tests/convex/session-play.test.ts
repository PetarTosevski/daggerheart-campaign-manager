import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_LOG_ENTRIES } from "../../convex/lib/validators/sessions";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S5: the Play stage (B4, K7, Q3, Q12). Spotlight counts per active character, the read-only tally counted from
// the Fear history and finished rests, and the session log. GM-only (K10, Q4).

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

/** Makes the session live since `startedAt` (S3 owns start; these tests only need the row's state). */
const goLive = (env: Env, sessionId: Id<"sessions">, startedAt: number, tally?: { fearGained: number; fearSpent: number; shortRests: number; longRests: number }) =>
  env.t.run((ctx) => ctx.db.patch("sessions", sessionId, { status: "live", startedAt, ...(tally ? { tally } : {}) }));

/** A timestamp later than every row written so far (rows are stamped with Date.now()), waiting for the clock to tick. */
function nextMillisecond(): number {
  const now = Date.now();
  while (Date.now() <= now) {
    // spin for at most a millisecond
  }
  return Date.now();
}

const setFear = (env: Env, value: number) => env.gm.mutation(api.fear.set, { campaignId: env.campaignId, value, idempotencyKey: key() });

describe("session play: spotlight", () => {
  useAllowlist(EMAILS);

  it("lists the active characters with their counts; the least-spotlit are due (Q12, K7)", async () => {
    const env = await setup();
    const args = { campaignId: env.campaignId, sessionId: env.sessionId };
    // Nobody tapped: every active character is due.
    expect(await env.gm.query(api.sessionPlay.spotlight, args)).toEqual([
      { characterId: env.ash, name: "Ash", count: 0, due: true },
      { characterId: env.bryn, name: "Bryn", count: 0, due: true },
      { characterId: env.cora, name: "Cora", count: 0, due: true },
    ]);
    await env.gm.mutation(api.sessionPlay.bumpSpotlight, { ...args, characterId: env.ash, idempotencyKey: key() });
    await env.gm.mutation(api.sessionPlay.bumpSpotlight, { ...args, characterId: env.ash, idempotencyKey: key() });
    expect(await env.gm.mutation(api.sessionPlay.bumpSpotlight, { ...args, characterId: env.bryn, idempotencyKey: key() })).toEqual({ count: 1 });
    expect((await env.gm.query(api.sessionPlay.spotlight, args)).map((e) => [e.name, e.count, e.due])).toEqual([
      ["Ash", 2, false],
      ["Bryn", 1, false],
      ["Cora", 0, true],
    ]);
    // A dead or away character leaves the list (Q12: active only); its row stays and comes back with it.
    await env.t.run((ctx) => ctx.db.patch("characters", env.cora, { status: "dead" }));
    expect((await env.gm.query(api.sessionPlay.spotlight, args)).map((e) => [e.name, e.count, e.due])).toEqual([
      ["Ash", 2, false],
      ["Bryn", 1, true],
    ]);
  });

  it("bumpSpotlight is retry-safe and counts per session", async () => {
    const env = await setup();
    const other = await env.create();
    const idempotencyKey = key();
    const bump = { campaignId: env.campaignId, sessionId: env.sessionId, characterId: env.ash, idempotencyKey };
    expect(await env.gm.mutation(api.sessionPlay.bumpSpotlight, bump)).toEqual({ count: 1 });
    expect(await env.gm.mutation(api.sessionPlay.bumpSpotlight, bump)).toEqual({ count: 1 });
    await env.gm.mutation(api.sessionPlay.bumpSpotlight, { ...bump, sessionId: other, idempotencyKey: key() });
    const count = async (sessionId: Id<"sessions">) =>
      (await env.gm.query(api.sessionPlay.spotlight, { campaignId: env.campaignId, sessionId })).find((e) => e.characterId === env.ash)!.count;
    expect(await count(env.sessionId)).toBe(1);
    expect(await count(other)).toBe(1);
  });

  it("bumpSpotlight refuses an inactive, foreign or malformed character with NOT_FOUND, a foreign session with SESSION_NOT_FOUND", async () => {
    const env = await setup();
    // A second campaign of the same GM, with its own character and session.
    const { campaignId: elsewhere } = await env.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Elsewhere", idempotencyKey: key() });
    const foreign = (await env.gm.mutation(api.characters.create, { campaignId: elsewhere, draft: draft("Dara"), idempotencyKey: key() })).characterId;
    const foreignSession = (await env.gm.mutation(api.sessionRecords.create, { campaignId: elsewhere, idempotencyKey: key() })).sessionId;
    const bump = (characterId: string, sessionId: string = env.sessionId) =>
      failure(env.gm.mutation(api.sessionPlay.bumpSpotlight, { campaignId: env.campaignId, sessionId, characterId, idempotencyKey: key() }));
    await env.t.run((ctx) => ctx.db.patch("characters", env.bryn, { status: "retired" }));
    expect(await bump(env.bryn)).toBe("NOT_FOUND");
    expect(await bump("not-an-id")).toBe("NOT_FOUND");
    expect(await bump(foreign)).toBe("NOT_FOUND");
    expect(await bump(env.ash, foreignSession)).toBe("SESSION_NOT_FOUND");
    expect(await bump(env.ash, "nope")).toBe("SESSION_NOT_FOUND");
  });

  it("resetSpotlight deletes only this session's rows", async () => {
    const env = await setup();
    const other = await env.create();
    for (const sessionId of [env.sessionId, other]) {
      await env.gm.mutation(api.sessionPlay.bumpSpotlight, { campaignId: env.campaignId, sessionId, characterId: env.ash, idempotencyKey: key() });
    }
    await env.gm.mutation(api.sessionPlay.resetSpotlight, { campaignId: env.campaignId, sessionId: env.sessionId });
    const rows = await env.t.run((ctx) => ctx.db.query("sessionSpotlights").collect());
    expect(rows.map((r) => r.sessionId)).toEqual([other]);
    expect((await env.gm.query(api.sessionPlay.spotlight, { campaignId: env.campaignId, sessionId: env.sessionId })).every((e) => e.count === 0 && e.due)).toBe(true);
  });
});

describe("session play: tally (Q3)", () => {
  useAllowlist(EMAILS);

  it("a planned session has no tally; a played one shows its stored counts", async () => {
    const env = await setup();
    const args = { campaignId: env.campaignId, sessionId: env.sessionId };
    await setFear(env, 4);
    expect(await env.gm.query(api.sessionPlay.tally, args)).toEqual({ tally: null, live: false, truncated: false });
    const stored = { fearGained: 3, fearSpent: 1, shortRests: 2, longRests: 0 };
    await env.t.run((ctx) => ctx.db.patch("sessions", env.sessionId, { status: "played", startedAt: 1, endedAt: 2, tally: stored }));
    expect(await env.gm.query(api.sessionPlay.tally, args)).toEqual({ tally: stored, live: false, truncated: false });
  });

  it("while live, counts Fear gained / spent and finished rests since the start, plus the stored counts (B7)", async () => {
    const env = await setup();
    const args = { campaignId: env.campaignId, sessionId: env.sessionId };
    await setFear(env, 5); // before the window: not counted
    const startedAt = nextMillisecond();
    await goLive(env, env.sessionId, startedAt);
    expect(await env.gm.query(api.sessionPlay.tally, args)).toEqual({
      tally: { fearGained: 0, fearSpent: 0, shortRests: 0, longRests: 0 },
      live: true,
      truncated: false,
    });
    await setFear(env, 7); // gained 2
    await setFear(env, 4); // spent 3
    await env.gm.mutation(api.fear.adjust, { campaignId: env.campaignId, direction: "increase", idempotencyKey: key() }); // gained 1
    await env.t.run(async (ctx) => {
      const base = { campaignId: env.campaignId, startedBy: env.ids.gm, startedAt: Date.now() };
      await ctx.db.insert("rests", { ...base, kind: "short", status: "finished", finishedAt: Date.now() });
      await ctx.db.insert("rests", { ...base, kind: "long", status: "finished", finishedAt: Date.now() });
      await ctx.db.insert("rests", { ...base, kind: "short", status: "interrupted" });
      await ctx.db.insert("rests", { ...base, kind: "short", status: "open" });
      await ctx.db.insert("rests", { ...base, startedAt: startedAt - 10_000, kind: "long", status: "finished" });
    });
    expect(await env.gm.query(api.sessionPlay.tally, args)).toEqual({
      tally: { fearGained: 3, fearSpent: 3, shortRests: 1, longRests: 1 },
      live: true,
      truncated: false,
    });
    // A restarted session (B7): the stored counts of earlier windows are added.
    await env.t.run((ctx) => ctx.db.patch("sessions", env.sessionId, { tally: { fearGained: 10, fearSpent: 0, shortRests: 1, longRests: 0 } }));
    expect((await env.gm.query(api.sessionPlay.tally, args)).tally).toEqual({ fearGained: 13, fearSpent: 3, shortRests: 2, longRests: 1 });
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
    const listed = await env.gm.query(api.sessionPlay.log, args);
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
    expect((await env.gm.query(api.sessionPlay.log, args)).map((l) => l.text)).toEqual(["Bryn found the key.", "Session started."]);
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
    expect(await env.gm.query(api.sessionPlay.log, args)).toHaveLength(1);
    expect(await failure(env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "   ", idempotencyKey: key() }))).toBe("INVALID");
    expect(await failure(env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "x".repeat(301), idempotencyKey: key() }))).toBe("INVALID");
    await env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "x".repeat(300), idempotencyKey: key() });
    await env.t.run(async (ctx) => {
      for (let i = 2; i < MAX_LOG_ENTRIES; i++) {
        await ctx.db.insert("sessionLog", { campaignId: env.campaignId, sessionId: env.sessionId, at: i, text: `line ${i}`, by: env.ids.gm, auto: false });
      }
    });
    expect(await failure(env.gm.mutation(api.sessionPlay.addLog, { ...args, text: "One more", idempotencyKey: key() }))).toBe("SESSION_LOG_LIMIT");
    expect(await env.gm.query(api.sessionPlay.log, args)).toHaveLength(MAX_LOG_ENTRIES);
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
      ["spotlight", (c) => c.query(api.sessionPlay.spotlight, base)],
      ["tally", (c) => c.query(api.sessionPlay.tally, base)],
      ["log", (c) => c.query(api.sessionPlay.log, base)],
      ["bumpSpotlight", (c) => c.mutation(api.sessionPlay.bumpSpotlight, { ...base, characterId: env.ash, idempotencyKey: key() })],
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
