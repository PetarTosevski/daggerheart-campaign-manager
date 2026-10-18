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
    expect(await gm.query(api.sessions.current, { campaignId })).toEqual({ startedAt: null });
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

  it("start stamps the session once; current is readable by members", async () => {
    const { gm, p1, campaignId } = await setup();
    expect(await p1.query(api.sessions.current, { campaignId })).toEqual({ startedAt: null });
    const first = await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(first.alreadyStarted).toBe(false);
    const second = await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(second).toEqual({ startedAt: first.startedAt, alreadyStarted: true });
    expect(await p1.query(api.sessions.current, { campaignId })).toEqual({ startedAt: first.startedAt });
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
  });
});
