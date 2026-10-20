import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

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

/** A Witherwild campaign with a GM, two players who each own a character, an outsider and an anonymous caller. */
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
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const change = (id: Id<"characters">, f: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, f(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const setFear = (value: number) => gm.mutation(api.fear.set, { campaignId, value, idempotencyKey: key() });
  return { t, gm, p1, out, anon: t, campaignId, a, b, sheetOf, change, fear, setFear };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("sessions", () => {
  useAllowlist(EMAILS);

  it("end converts every PC's Wither tokens to GM Fear, capped at 12, and reports the Fear lost", async () => {
    const { gm, campaignId, a, b, sheetOf, change, fear, setFear } = await setup();
    await setFear(9);
    await change(a, (s) => ({ ...s, wither: 2 }));
    await change(b, (s) => ({ ...s, wither: 3 }));

    const result = await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });

    expect(result).toMatchObject({ tokens: 5, fearGained: 3, fearLost: 2, journeyEnds: [] });
    expect(await fear()).toBe(12);
    expect((await sheetOf(a)).wither).toBe(0);
    expect((await sheetOf(b)).wither).toBe(0);
  });

  it("keeps Wither on the sheets when the GM unticks the conversion, or by default under the witherPersists house rule", async () => {
    const { gm, campaignId, a, b, sheetOf, change, fear, setFear } = await setup();
    await setFear(4);
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    await change(a, (s) => ({ ...s, wither: 2 }));
    await change(b, (s) => ({ ...s, wither: 1 }));
    const kept = await gm.mutation(api.sessions.end, { campaignId, convertWither: false, idempotencyKey: key() });
    expect(kept).toMatchObject({ tokens: 0, fearGained: 0, witherKept: 3 });
    expect(await fear()).toBe(4);
    expect([(await sheetOf(a)).wither, (await sheetOf(b)).wither]).toEqual([2, 1]);

    // The house rule makes "keep" the default; an explicit convertWither: true still converts.
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "witherPersists", enabled: true });
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() })).toMatchObject({ tokens: 0, witherKept: 3 });
    expect((await sheetOf(a)).wither).toBe(2);
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(await gm.mutation(api.sessions.end, { campaignId, convertWither: true, idempotencyKey: key() })).toMatchObject({ tokens: 3, fearGained: 3 });
    expect(await fear()).toBe(7);
    expect((await sheetOf(a)).wither).toBe(0);
  });

  it("end is idempotent: a replay returns the same result and a second End changes nothing", async () => {
    const { gm, campaignId, a, change, fear } = await setup();
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    await change(a, (s) => ({ ...s, wither: 2 }));
    const k = key();
    const first = await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: k });
    expect(await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: k })).toEqual(first);
    expect(await fear()).toBe(2);

    const again = await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect(again).toMatchObject({ tokens: 0, fearGained: 0, fearLost: 0, entryId: null });
    expect(await fear()).toBe(2);
    expect(await gm.query(api.sessions.current, { campaignId })).toEqual({ startedAt: null, extraCharacters: false });
  });

  it("undoing the End restores the tokens and the Fear", async () => {
    const { gm, campaignId, a, b, sheetOf, change, fear, setFear } = await setup();
    await setFear(4);
    await change(a, (s) => ({ ...s, wither: 1 }));
    await change(b, (s) => ({ ...s, wither: 2 }));
    const { entryId } = await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect(await fear()).toBe(7);

    await gm.mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey: key() });

    expect(await fear()).toBe(4);
    expect((await sheetOf(a)).wither).toBe(1);
    expect((await sheetOf(b)).wither).toBe(2);
  });

  it("end clears session effects and lists characters whose journey ends", async () => {
    const { gm, campaignId, a, b, sheetOf, change } = await setup();
    await change(a, (s) => ({ ...s, effects: [{ id: "e1", source: "Test", text: "until session", until: "session", mods: {} }] }));
    await change(b, (s) => ({ ...s, journeyEnds: true }));
    const result = await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect((await sheetOf(a)).effects).toEqual([]);
    expect(result.journeyEnds).toEqual([{ characterId: b, name: "Bryn" }]);
  });

  it("M5: over 49 characters, start and end are INVALID instead of silently skipping some", async () => {
    const { t, gm, campaignId, a } = await setup();
    await t.run(async (ctx) => {
      const c = (await ctx.db.get("characters", a))!;
      for (let i = 0; i < 48; i++) {
        await ctx.db.insert("characters", { campaignId: c.campaignId, ownerId: c.ownerId, createdBy: c.createdBy, status: "active", sheet: c.sheet, createdAt: 0, updatedAt: 0 });
      }
    });
    expect(await codeOf(gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() }))).toBe("INVALID");
    expect(await codeOf(gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() }))).toBe("INVALID");
  });

  it("start stamps the session once; current is readable by members", async () => {
    const { gm, p1, campaignId } = await setup();
    expect(await p1.query(api.sessions.current, { campaignId })).toEqual({ startedAt: null, extraCharacters: false });
    const first = await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(first.alreadyStarted).toBe(false);
    const second = await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(second).toEqual({ startedAt: first.startedAt, alreadyStarted: true });
    // D10 S3: `current` also names the live session (new optional fields, E7).
    expect(await p1.query(api.sessions.current, { campaignId })).toEqual({ startedAt: first.startedAt, extraCharacters: false, sessionId: first.sessionId, n: 1 });
  });

  it("authorizes: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async () => {
    const { gm, p1, out, anon, campaignId } = await setup();
    for (const fn of [api.sessions.start, api.sessions.end]) {
      expect(await codeOf(anon.mutation(fn, { campaignId, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(out.mutation(fn, { campaignId, idempotencyKey: key() }))).toBe("NOT_FOUND");
      expect(await codeOf(p1.mutation(fn, { campaignId, idempotencyKey: key() }))).toBe("FORBIDDEN");
      expect(await codeOf(gm.mutation(fn, { campaignId, idempotencyKey: key() }))).toBe("ok");
    }
    expect(await codeOf(anon.query(api.sessions.current, { campaignId }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(out.query(api.sessions.current, { campaignId }))).toBe("NOT_FOUND");
    expect(await codeOf(p1.query(api.sessions.current, { campaignId }))).toBe("ok");
    expect(await codeOf(gm.query(api.sessions.current, { campaignId }))).toBe("ok");
    const allow = (who: typeof gm) => codeOf(who.mutation(api.sessions.allowExtraCharacters, { campaignId, allow: true, idempotencyKey: key() }));
    expect(await allow(anon)).toBe("UNAUTHENTICATED");
    expect(await allow(out)).toBe("NOT_FOUND");
    expect(await allow(p1)).toBe("FORBIDDEN");
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(await allow(p1)).toBe("FORBIDDEN");
    expect(await allow(gm)).toBe("ok");
  });

  it("XC1: extra characters are allowed only while a session runs; End clears it and a new start doesn't inherit it", async () => {
    const { gm, p1, campaignId } = await setup();
    const allow = (value: boolean) => gm.mutation(api.sessions.allowExtraCharacters, { campaignId, allow: value, idempotencyKey: key() });
    expect(await codeOf(allow(true))).toBe("INVALID");
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    await allow(true);
    expect((await p1.query(api.sessions.current, { campaignId })).extraCharacters).toBe(true);
    await allow(false);
    expect((await p1.query(api.sessions.current, { campaignId })).extraCharacters).toBe(false);
    await allow(true);
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect(await p1.query(api.sessions.current, { campaignId })).toEqual({ startedAt: null, extraCharacters: false });
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect((await p1.query(api.sessions.current, { campaignId })).extraCharacters).toBe(false);
  });
});

describe("sessions per session (D10 S3)", () => {
  useAllowlist(EMAILS);

  type Env = Awaited<ReturnType<typeof setup>>;
  const create = (env: Env) => env.gm.mutation(api.sessionRecords.create, { campaignId: env.campaignId, idempotencyKey: key() });
  const startOf = (env: Env, sessionId?: string) => env.gm.mutation(api.sessions.start, { campaignId: env.campaignId, ...(sessionId ? { sessionId } : {}), idempotencyKey: key() });
  const endOf = (env: Env) => env.gm.mutation(api.sessions.end, { campaignId: env.campaignId, idempotencyKey: key() });
  const row = (env: Env, id: Id<"sessions">) => env.t.run(async (ctx) => (await ctx.db.get("sessions", id))!);
  const state = (env: Env) => env.t.run((ctx) => campaignFearState(ctx, env.campaignId));
  const logOf = (env: Env, id: Id<"sessions">) =>
    env.t.run(async (ctx) =>
      (
        await ctx.db
          .query("sessionLog")
          .withIndex("by_session_at", (q) => q.eq("sessionId", id))
          .collect()
      ).map((r) => ({ text: r.text, auto: r.auto })),
    );
  const seraph = (s: CharacterSheet): CharacterSheet => ({
    ...s,
    classId: "seraph",
    subclassId: "divine-wielder",
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
  });

  it("start with a sessionId puts that session live, stamps campaignState and the log; current names it", async () => {
    const env = await setup();
    const { sessionId } = await create(env);
    await create(env);
    const result = await startOf(env, sessionId);
    expect(result).toMatchObject({ alreadyStarted: false, sessionId, n: 1, notes: [], reminders: [] });
    expect(await row(env, sessionId)).toMatchObject({ status: "live", startedAt: result.startedAt });
    expect(await state(env)).toMatchObject({ sessionStartedAt: result.startedAt, liveSessionId: sessionId });
    expect(await env.p1.query(api.sessions.current, { campaignId: env.campaignId })).toEqual({ startedAt: result.startedAt, extraCharacters: false, sessionId, n: 1 });
    expect(await logOf(env, sessionId)).toEqual([{ text: "Session started.", auto: true }]);
    // The live session again: a no-op (E1).
    expect(await startOf(env, sessionId)).toEqual({ startedAt: result.startedAt, alreadyStarted: true });
    expect(await startOf(env)).toEqual({ startedAt: result.startedAt, alreadyStarted: true });
    expect(await logOf(env, sessionId)).toHaveLength(1);
  });

  it("B8: start without a sessionId takes the newest planned session, or creates one", async () => {
    const env = await setup();
    const first = await startOf(env);
    expect(first).toMatchObject({ alreadyStarted: false, n: 1 });
    await endOf(env);
    const two = await create(env);
    const three = await create(env);
    await env.gm.mutation(api.sessionRecords.setPlayed, { campaignId: env.campaignId, sessionId: three.sessionId, played: true });
    expect(await startOf(env)).toMatchObject({ sessionId: two.sessionId, n: 2 });
  });

  it("B6: starting another session ends the live one first with every end effect", async () => {
    const env = await setup();
    const one = await create(env);
    const two = await create(env);
    await startOf(env, one.sessionId);
    await env.change(env.a, (s) => ({ ...s, wither: 2 }));
    const result = await startOf(env, two.sessionId);
    expect(result.ended).toMatchObject({ sessionId: one.sessionId, n: 1, tokens: 2, fearGained: 2 });
    const ended = await row(env, one.sessionId);
    expect(ended.status).toBe("played");
    expect(ended.endedAt).toBeLessThanOrEqual(result.startedAt);
    expect(await row(env, two.sessionId)).toMatchObject({ status: "live", startedAt: result.startedAt });
    expect(await state(env)).toMatchObject({ liveSessionId: two.sessionId, sessionStartedAt: result.startedAt });
    expect((await env.sheetOf(env.a)).wither).toBe(0);
    expect(await env.fear()).toBe(2);
    expect(await logOf(env, one.sessionId)).toEqual([
      { text: "Session started.", auto: true },
      { text: "Session ended. 2 Wither tokens → +2 Fear.", auto: true },
    ]);
  });

  it("B10, K3: Seraphs' Prayer Dice go into the start line; the end line lists the unspent dice lost", async () => {
    const env = await setup();
    await env.change(env.a, seraph);
    const { sessionId } = await create(env);
    const started = await startOf(env, sessionId);
    const dice = (await env.sheetOf(env.a)).heldDice.filter((d) => d.kind === "prayer");
    expect(dice).toHaveLength(2);
    const values = dice.map((d) => d.value).join(", ");
    expect(started.notes).toEqual([`Ash rolled Prayer Dice: ${values}`]);
    await env.change(env.b, (s) => ({ ...s, wither: 1 }));
    await env.setFear(11);
    const ended = await endOf(env);
    expect(ended).toMatchObject({ sessionId, n: 1, lostDice: ["Ash lost 2 unspent dice"], tokens: 1, fearGained: 1 });
    expect(await logOf(env, sessionId)).toEqual([
      { text: `Session started. Ash rolled Prayer Dice: ${values}.`, auto: true },
      { text: "Session ended. Ash lost 2 unspent dice; 1 Wither token → +1 Fear.", auto: true },
    ]);
  });

  it("B7: a played session starts again, its start effects run again, and the tally adds the new window", async () => {
    const env = await setup();
    await env.change(env.a, seraph);
    const { sessionId } = await create(env);
    await startOf(env, sessionId);
    const adjust = (direction: "increase" | "decrease") => env.gm.mutation(api.fear.adjust, { campaignId: env.campaignId, direction, idempotencyKey: key() });
    await adjust("increase");
    await adjust("increase");
    await adjust("decrease");
    await endOf(env);
    expect((await row(env, sessionId)).tally).toEqual({ fearGained: 2, fearSpent: 1, shortRests: 0, longRests: 0 });
    expect((await env.sheetOf(env.a)).heldDice).toEqual([]);

    const again = await startOf(env, sessionId);
    expect(again).toMatchObject({ alreadyStarted: false, sessionId, n: 1 });
    expect((await env.sheetOf(env.a)).heldDice.filter((d) => d.kind === "prayer")).toHaveLength(2);
    expect(await row(env, sessionId)).toMatchObject({ status: "live", startedAt: again.startedAt });
    await adjust("increase");
    // A finished long rest and an interrupted short one in the window: only the finished one counts.
    await env.t.run(async (ctx) => {
      const by = (await ctx.db.query("users").first())!._id;
      await ctx.db.insert("rests", { campaignId: env.campaignId, kind: "long", status: "finished", startedBy: by, startedAt: Date.now(), finishedAt: Date.now() });
      await ctx.db.insert("rests", { campaignId: env.campaignId, kind: "short", status: "interrupted", startedBy: by, startedAt: Date.now() });
    });
    await endOf(env);
    expect((await row(env, sessionId)).tally).toEqual({ fearGained: 3, fearSpent: 1, shortRests: 0, longRests: 1 });
    expect(await row(env, sessionId)).toMatchObject({ status: "played" });
  });

  it("Q7, E6: undoing a Start or End group restores sheets and Fear and leaves the session's status and times", async () => {
    const env = await setup();
    await env.change(env.a, seraph);
    const { sessionId } = await create(env);
    const started = await startOf(env, sessionId);
    const startEntry = await env.t.run(async (ctx) =>
      (
        await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_at", (q) => q.eq("campaignId", env.campaignId))
          .collect()
      ).find((r) => r.summary === "Session started")!,
    );
    await env.gm.mutation(api.actionLog.undo, { entryId: startEntry._id, idempotencyKey: key() });
    expect((await env.sheetOf(env.a)).heldDice).toEqual([]);
    expect(await row(env, sessionId)).toMatchObject({ status: "live", startedAt: started.startedAt });

    await env.setFear(3);
    await env.change(env.b, (s) => ({ ...s, wither: 2 }));
    const ended = await endOf(env);
    const played = await row(env, sessionId);
    await env.gm.mutation(api.actionLog.undo, { entryId: ended.entryId!, idempotencyKey: key() });
    expect(await env.fear()).toBe(3);
    expect((await env.sheetOf(env.b)).wither).toBe(2);
    expect(await row(env, sessionId)).toMatchObject({ status: "played", startedAt: played.startedAt, endedAt: played.endedAt });
  });

  it("E2, E3: end clears the live marker and XC1; with no live session it still clears session effects", async () => {
    const env = await setup();
    const { sessionId } = await create(env);
    await startOf(env, sessionId);
    await env.gm.mutation(api.sessions.allowExtraCharacters, { campaignId: env.campaignId, allow: true, idempotencyKey: key() });
    await endOf(env);
    const s = await state(env);
    expect(s.sessionStartedAt).toBeUndefined();
    expect(s.liveSessionId).toBeUndefined();
    expect(s.extraCharactersSession).toBeUndefined();
    await env.change(env.a, (sheet) => ({ ...sheet, effects: [{ id: "e1", source: "Test", text: "until session", until: "session", mods: {} }] }));
    const again = await endOf(env);
    expect(again.entryId).not.toBeNull();
    expect(again.sessionId).toBeUndefined();
    expect((await env.sheetOf(env.a)).effects).toEqual([]);
  });

  it("Q8, Q6: the reports remind of Luckbringer, Slayer Dice and Know the Tide; Horizon gets the Doom Track tier", async () => {
    const env = await setup();
    await env.change(env.a, (s) => ({ ...s, ancestry: { kind: "single", id: "halfling" }, communityId: "seaborne" }));
    await env.change(env.b, (s) => ({ ...s, subclassId: "call-of-the-slayer" }));
    const started = await startOf(env);
    expect(started.reminders).toEqual(["Luckbringer (Ash): everyone in the party gains a Hope."]);
    const ended = await endOf(env);
    expect(ended.reminders).toEqual(["Know the Tide (Ash): clear all unspent tokens.", "Slayer Dice (Bryn): clear unspent Slayer Dice and gain a Hope per die cleared."]);
    expect(ended.doomTier).toBeUndefined();

    const { campaignId } = await env.gm.mutation(api.campaigns.create, { frameId: "journey-to-horizon", name: "Horizon", idempotencyKey: key() });
    await env.gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(await env.gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() })).toMatchObject({ doomTier: 1, n: 1 });
  });

  it("a full session log gets no stamp, and start and end still run", async () => {
    const env = await setup();
    const { sessionId } = await create(env);
    await env.t.run(async (ctx) => {
      const by = (await ctx.db.query("users").first())!._id;
      for (let i = 0; i < 500; i++) await ctx.db.insert("sessionLog", { campaignId: env.campaignId, sessionId, at: i, text: `line ${i}`, by, auto: false });
    });
    await startOf(env, sessionId);
    await endOf(env);
    expect(await logOf(env, sessionId)).toHaveLength(500);
    expect(await row(env, sessionId)).toMatchObject({ status: "played" });
  });

  it("start with a sessionId: SESSION_NOT_FOUND for a bad or foreign id; anonymous, outsider, player refused", async () => {
    const env = await setup();
    const { sessionId } = await create(env);
    const { campaignId: other } = await env.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const foreign = (await env.gm.mutation(api.sessionRecords.create, { campaignId: other, idempotencyKey: key() })).sessionId;
    expect(await codeOf(startOf(env, "nope"))).toBe("SESSION_NOT_FOUND");
    expect(await codeOf(startOf(env, foreign))).toBe("SESSION_NOT_FOUND");
    const args = { campaignId: env.campaignId, sessionId };
    expect(await codeOf(env.anon.mutation(api.sessions.start, { ...args, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(env.out.mutation(api.sessions.start, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect(await codeOf(env.p1.mutation(api.sessions.start, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await codeOf(env.gm.mutation(api.sessions.start, { ...args, idempotencyKey: key() }))).toBe("ok");
    expect(await row(env, sessionId)).toMatchObject({ status: "live" });
  });
});
