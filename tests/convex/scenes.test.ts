import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { featureKey } from "../../src/lib/domain/feature-effects/ids";
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
  return { t, gm, p1, out, anon: t, campaignId, a, b, sheetOf, change };
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

  it("end runs combatScenes' endScene (DA4): feature limits, the Unstoppable Die, the stance and Walk Between Worlds tokens end; scene areas close", async () => {
    const { t, gm, campaignId, a, b, sheetOf, change } = await setup();
    const walk = featureKey("subclass:hedge:walk-between-worlds");
    // Ash's only scene state is a once-per-scene limit and the Unstoppable Die (CB p.36); Bryn's a stance (HF p.12) and
    // Walk Between Worlds tokens (HF p.16: "When the last token is removed or at the end of the scene, you return").
    await change(a, (s) => ({
      ...s,
      classState: { ...s.classState, unstoppable: { value: 2, max: 4 } },
      featureUses: [{ key: "feat:once-per-scene", until: "scene" }, { key: "feat:once-per-rest", until: "rest" }],
    }));
    await change(b, (s) => ({
      ...s,
      classState: { ...s.classState, martial: { known: ["quick"], active: "quick", focus: 2 } },
      cardTokens: [{ cardId: walk, count: 2 }],
    }));
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    const area = (expires: "scene" | "session" | "manual") =>
      t.run((ctx) =>
        ctx.db.insert("combatAreas", {
          campaignId,
          mapId,
          featureId: "subclass:moon:moonbeam",
          characterId: a,
          label: "Moonbeam",
          shape: "circle",
          centre: { kind: "square", x: 1, y: 1 },
          radius: "close",
          blocksSight: false,
          expires,
          status: "active",
          createdAt: 0,
        }),
      );
    const ids = [await area("scene"), await area("session"), await area("manual")];

    const result = await gm.mutation(api.scenes.end, { campaignId, idempotencyKey: key() });

    expect(result.ended).toBe(4);
    const ash = await sheetOf(a);
    expect(ash.featureUses.map((u) => u.key)).toEqual(["feat:once-per-rest"]);
    expect(ash.classState.unstoppable).toBeUndefined();
    const bryn = await sheetOf(b);
    expect(bryn.classState.martial).toEqual({ known: ["quick"], focus: 2 });
    expect(bryn.cardTokens?.find((c) => c.cardId === walk)).toBeUndefined();
    expect(await t.run(async (ctx) => Promise.all(ids.map(async (id) => (await ctx.db.get("combatAreas", id))?.status)))).toEqual(["ended", "active", "active"]);

    // One undoable group, as before: undoing the campaign row restores both sheets.
    await gm.mutation(api.actionLog.undo, { entryId: result.entryId!, idempotencyKey: key() });
    expect((await sheetOf(a)).classState.unstoppable).toEqual({ value: 2, max: 4 });
    expect((await sheetOf(b)).cardTokens).toEqual([{ cardId: walk, count: 2 }]);
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
