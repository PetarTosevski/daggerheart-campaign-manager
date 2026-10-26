import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

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

/** A campaign in `frameId` with a GM, a player who owns a character, an outsider and an anonymous caller. */
async function setup(frameId: "witherwild" | "beast-feast" = "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const setTokens = (id: Id<"characters">, wither: number) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), wither }));
  return { t, ids, gm, p1, out, anon: t, campaignId, a, sheetOf, setTokens };
}

/** Makes the next Fear Die (d12) rolls show `values` (convex/lib/dice.ts draws one Uint32 per roll). */
function fearDie(...values: number[]) {
  const original = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1 && values.length > 0) {
      array[0] = values.shift()! - 1;
      return array;
    }
    return original(array as never) as T;
  });
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("Wither tokens", () => {
  useAllowlist(EMAILS);
  afterEach(() => vi.restoreAllMocks());

  it("is MECHANIC_DISABLED outside Witherwild", async () => {
    const { gm, campaignId, a } = await setup("beast-feast");
    expect(await codeOf(gm.mutation(api.wither.gain, { campaignId, characterId: a, idempotencyKey: key() }))).toBe("MECHANIC_DISABLED");
    expect(await codeOf(gm.mutation(api.wither.adjust, { campaignId, characterId: a, delta: 1, idempotencyKey: key() }))).toBe("MECHANIC_DISABLED");
    expect(await codeOf(gm.mutation(api.characters.applyDamage, { characterId: a, damage: 999, useArmorSlot: false, withered: true, idempotencyKey: key() }))).toBe("MECHANIC_DISABLED");
  });

  it("Severe damage from a Withered source adds a token and rolls the Fear Die publicly", async () => {
    const { t, gm, a, sheetOf } = await setup();
    fearDie(12);
    const result = await gm.mutation(api.characters.applyDamage, { characterId: a, damage: 999, useArmorSlot: false, withered: true, idempotencyKey: key() });
    expect(result.severity).toBe("severe");
    expect(result.wither).toMatchObject({ tokens: 1, fearDie: 12, scarred: false, journeyEnds: false });
    expect((await sheetOf(a)).wither).toBe(1);
    const row = await t.run((ctx) => ctx.db.get("actionLog", result.wither!.entryId));
    expect(row).toMatchObject({ kind: "wither", visibility: "public", characterId: a, undoable: true });
    expect(row?.roll?.dice).toEqual([{ sides: 12, value: 12, role: "fear" }]);
  });

  it("Minor damage from a Withered source adds no token", async () => {
    const { gm, a, sheetOf } = await setup();
    const result = await gm.mutation(api.characters.applyDamage, { characterId: a, damage: 1, useArmorSlot: false, withered: true, idempotencyKey: key() });
    expect(result.severity).toBe("minor");
    expect(result.wither).toBeUndefined();
    expect((await sheetOf(a)).wither).toBe(0);
  });

  it("Severe damage without a Withered source adds no token", async () => {
    const { gm, a, sheetOf } = await setup();
    const result = await gm.mutation(api.characters.applyDamage, { characterId: a, damage: 999, useArmorSlot: false, idempotencyKey: key() });
    expect(result.wither).toBeUndefined();
    expect((await sheetOf(a)).wither).toBe(0);
  });

  it("a Fear Die at or below the tokens gives a scar and clears them; undo takes back only the Wither", async () => {
    const { p1, a, sheetOf, setTokens } = await setup();
    await setTokens(a, 2);
    const hpBefore = (await sheetOf(a)).hp;
    fearDie(3);
    const result = await p1.mutation(api.characters.applyDamage, { characterId: a, damage: 999, useArmorSlot: false, withered: true, idempotencyKey: key() });
    expect(result.wither).toMatchObject({ tokens: 3, fearDie: 3, scarred: true });
    const after = await sheetOf(a);
    expect(after).toMatchObject({ wither: 0, scars: 1 });
    expect(after.hp).toBe(hpBefore + 3);

    await p1.mutation(api.actionLog.undo, { entryId: result.wither!.entryId, idempotencyKey: key() });
    expect(await sheetOf(a)).toMatchObject({ wither: 2, scars: 0, hp: hpBefore + 3 });
  });

  it("gain and adjust: GM only, logged and undoable", async () => {
    const { t, gm, p1, out, anon, campaignId, a, sheetOf } = await setup();
    const gainAs = (who: typeof gm) => codeOf(who.mutation(api.wither.gain, { campaignId, characterId: a, idempotencyKey: key() }));
    const adjustAs = (who: typeof gm, delta: number) => codeOf(who.mutation(api.wither.adjust, { campaignId, characterId: a, delta, idempotencyKey: key() }));
    expect(await gainAs(anon)).toBe("UNAUTHENTICATED");
    expect(await gainAs(out)).toBe("NOT_FOUND");
    expect(await gainAs(p1)).toBe("FORBIDDEN");
    expect(await adjustAs(anon, 1)).toBe("UNAUTHENTICATED");
    expect(await adjustAs(out, 1)).toBe("NOT_FOUND");
    expect(await adjustAs(p1, 1)).toBe("FORBIDDEN");
    expect(await adjustAs(gm, 0)).toBe("WITHER_RULE");

    fearDie(12);
    expect(await gainAs(gm)).toBe("ok");
    expect((await sheetOf(a)).wither).toBe(1);
    expect(await gm.mutation(api.wither.adjust, { campaignId, characterId: a, delta: 3, idempotencyKey: key() })).toEqual({ tokens: 4 });

    const rows = await t.run((ctx) => ctx.db.query("actionLog").withIndex("by_character_at", (q) => q.eq("characterId", a)).order("desc").take(5));
    expect(rows.map((r) => r.kind)).toEqual(["wither", "wither"]);
    await gm.mutation(api.actionLog.undo, { entryId: rows[0]._id, idempotencyKey: key() });
    expect((await sheetOf(a)).wither).toBe(1);
  });

  it("refuses a character of another campaign", async () => {
    const { gm, a } = await setup();
    const { campaignId: other } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await codeOf(gm.mutation(api.wither.gain, { campaignId: other, characterId: a, idempotencyKey: key() }))).toBe("NOT_FOUND");
  });
});
