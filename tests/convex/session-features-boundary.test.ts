// Session features at the session boundaries (plan session-features F1): sessions.start gives the Luckbringer Hope and
// rolls the moon dice, sessions.end clears Slayer Dice, Tide tokens and the moon die. Roles per the plan's rules:
// anonymous UNAUTHENTICATED, outsider NOT_FOUND, player (owner of the feature holder or not) FORBIDDEN, GM ok; a refused
// call changes no sheet.
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
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

/** A Hope & Fear campaign: p1 owns Ash (Halfling, Seaborne), p2 owns Bryn (Call of the Slayer); an outsider; anonymous. */
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
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const change = (id: Id<"characters">, f: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, f(readSheet((await ctx.db.get("characters", id))!.sheet))));
  await change(a, (s) => ({ ...s, ancestry: { kind: "single", id: "halfling" }, communityId: "seaborne", hope: 2, sessionFeatures: { tideTokens: 1 } }));
  await change(b, (s) => ({ ...s, subclassId: "call-of-the-slayer", hope: 2, sessionFeatures: { slayerDice: 1 } }));
  return { t, gm, p1, p2, out, anon: t, campaignId, a, b, sheetOf, change };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("session features at the session boundaries (F1)", () => {
  useAllowlist(EMAILS);

  it("start: anonymous UNAUTHENTICATED, outsider NOT_FOUND, players (holder's owner or not) FORBIDDEN without a change; GM gives the Hope", async () => {
    const { gm, p1, p2, out, anon, campaignId, a, b, sheetOf } = await setup();
    for (const who of [anon, out, p1, p2]) {
      const expected = who === anon ? "UNAUTHENTICATED" : who === out ? "NOT_FOUND" : "FORBIDDEN";
      expect(await codeOf(who.mutation(api.sessions.start, { campaignId, idempotencyKey: key() }))).toBe(expected);
    }
    expect([(await sheetOf(a)).hope, (await sheetOf(b)).hope]).toEqual([2, 2]);

    const k = key();
    const started = await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: k });
    expect(started.features).toEqual(["Luckbringer (Ash): everyone gains 1 Hope"]);
    expect([(await sheetOf(a)).hope, (await sheetOf(b)).hope]).toEqual([3, 3]);
    // A replay of the same key returns the same result and gives nothing twice (E1, ctx.once).
    expect(await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: k })).toEqual(started);
    expect((await sheetOf(a)).hope).toBe(3);
  });

  it("end: anonymous UNAUTHENTICATED, outsider NOT_FOUND, players FORBIDDEN without a change; GM clears the dice and tokens", async () => {
    const { gm, p1, p2, out, anon, campaignId, a, b, sheetOf } = await setup();
    for (const who of [anon, out, p1, p2]) {
      const expected = who === anon ? "UNAUTHENTICATED" : who === out ? "NOT_FOUND" : "FORBIDDEN";
      expect(await codeOf(who.mutation(api.sessions.end, { campaignId, idempotencyKey: key() }))).toBe(expected);
    }
    expect((await sheetOf(a)).sessionFeatures).toEqual({ tideTokens: 1 });
    expect((await sheetOf(b)).sessionFeatures).toEqual({ slayerDice: 1 });

    const ended = await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect(ended.features).toEqual(["Ash cleared 1 Tide token", "Bryn cleared 1 Slayer Die: +1 Hope"]);
    expect((await sheetOf(a)).sessionFeatures).toBeUndefined();
    expect((await sheetOf(b)).sessionFeatures).toBeUndefined();
    expect((await sheetOf(b)).hope).toBe(3);
    // Nothing left to clear: a second End is a no-op (E1).
    expect(await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() })).toMatchObject({ entryId: null });
  });

  it("B6: a Start that ends the live session first reports that End's features and then its own", async () => {
    const { gm, campaignId, a, b, sheetOf, change } = await setup();
    const one = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
    const two = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
    await gm.mutation(api.sessions.start, { campaignId, sessionId: one.sessionId, idempotencyKey: key() });
    await change(b, (s) => ({ ...s, hope: 2, sessionFeatures: { slayerDice: 2 } }));
    const started = await gm.mutation(api.sessions.start, { campaignId, sessionId: two.sessionId, idempotencyKey: key() });
    expect(started.ended?.features).toEqual(["Ash cleared 1 Tide token", "Bryn cleared 2 Slayer Dice: +2 Hope"]);
    expect(started.features).toEqual(["Luckbringer (Ash): everyone gains 1 Hope"]);
    expect((await sheetOf(b)).hope).toBe(5);
    expect((await sheetOf(a)).sessionFeatures).toBeUndefined();
  });

  it("K7, U6: a Moon Witch below mastery or with Hope & Fear off rolls no moon die; at mastery one die in 1..6 with its note", async () => {
    const { gm, campaignId, a, sheetOf, change } = await setup();
    await change(a, (s) => ({ ...s, ancestry: { kind: "single", id: "human" }, classId: "witch", subclassId: "moon", subclassRank: "foundation", sessionFeatures: undefined }));
    expect((await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() })).features).toEqual([]);
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });

    await change(a, (s) => ({ ...s, subclassRank: "mastery" }));
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
    expect((await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() })).features).toEqual([]);
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });

    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
    const started = await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    const die = (await sheetOf(a)).sessionFeatures?.moonDie;
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(6);
    expect(started.features).toHaveLength(1);
    expect(started.features?.[0]).toMatch(new RegExp(`^Ash's moon die: ${die} \\((New|Waxing|Full|Waning): `));
  });
});
