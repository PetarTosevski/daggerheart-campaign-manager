import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
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

/** A campaign with a GM, two players who each own a character, an outsider and an anonymous caller. */
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
  return { gm, p1, out, anon: t, campaignId, a, b, sheetOf, change };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const effect = (id: string, until: Effect["until"]): Effect => ({ id, source: "Test", text: until, until, mods: {} });

describe("scenes", () => {
  useAllowlist(EMAILS);

  it("end (CB 107) clears every PC's scene effects and keeps session ones; undo restores them", async () => {
    const { gm, campaignId, a, b, sheetOf, change } = await setup();
    await change(a, (s) => ({ ...s, effects: [effect("s1", "scene"), effect("x1", "session")] }));
    await change(b, (s) => ({ ...s, effects: [effect("s2", "scene"), effect("s3", "scene"), effect("m1", "manual")] }));

    const result = await gm.mutation(api.scenes.end, { campaignId, idempotencyKey: key() });

    expect(result.ended).toBe(3);
    expect((await sheetOf(a)).effects.map((e) => e.id)).toEqual(["x1"]);
    expect((await sheetOf(b)).effects.map((e) => e.id)).toEqual(["m1"]);

    await gm.mutation(api.actionLog.undo, { entryId: result.entryId!, idempotencyKey: key() });
    expect((await sheetOf(a)).effects.map((e) => e.id)).toEqual(["s1", "x1"]);
    expect((await sheetOf(b)).effects.map((e) => e.id)).toEqual(["s2", "s3", "m1"]);
  });

  it("end with no scene effects writes nothing; a replay returns the same result", async () => {
    const { gm, campaignId, a, change } = await setup();
    await change(a, (s) => ({ ...s, effects: [effect("s1", "scene")] }));
    const k = key();
    const first = await gm.mutation(api.scenes.end, { campaignId, idempotencyKey: k });
    expect(first.ended).toBe(1);
    expect(await gm.mutation(api.scenes.end, { campaignId, idempotencyKey: k })).toEqual(first);
    expect(await gm.mutation(api.scenes.end, { campaignId, idempotencyKey: key() })).toEqual({ ended: 0, entryId: null });
  });

  it("session end still clears scene effects", async () => {
    const { gm, campaignId, a, sheetOf, change } = await setup();
    await change(a, (s) => ({ ...s, effects: [effect("s1", "scene")] }));
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect((await sheetOf(a)).effects).toEqual([]);
  });

  it("authorizes: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok", async () => {
    const { gm, p1, out, anon, campaignId } = await setup();
    expect(await codeOf(anon.mutation(api.scenes.end, { campaignId, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(out.mutation(api.scenes.end, { campaignId, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect(await codeOf(p1.mutation(api.scenes.end, { campaignId, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await codeOf(gm.mutation(api.scenes.end, { campaignId, idempotencyKey: key() }))).toBe("ok");
  });
});
