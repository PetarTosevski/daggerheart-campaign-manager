import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { AreaExpires } from "../../convex/lib/validators/combatMaps";
import { featureKey } from "../../src/lib/domain/feature-effects/ids";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Plan drawer-answers DA4 (SD8 follow-up; Q7 (a)): the session end also ends the scene. CB p.107, End of the Scene:
// "Sometimes certain effects, bonuses, or conditions state that they last until the end of the scene." So `sessions.end`
// ends the scene's sheet state (`expire(sheet, "session")`) and closes the campaign's live map areas that last until
// the scene or the session.

const EMAILS = "gm@example.com,p1@example.com";

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
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1] = [as(ids.gm), as(ids.p1)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const change = (id: Id<"characters">, f: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, f(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const area = (expires: AreaExpires) =>
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
  const statuses = (areaIds: Id<"combatAreas">[]) =>
    t.run(async (ctx) => Promise.all(areaIds.map(async (id) => (await ctx.db.get("combatAreas", id))?.status)));
  return { gm, campaignId, a, sheetOf, change, area, statuses };
}

describe("session end ends the scene (DA4)", () => {
  useAllowlist(EMAILS);

  it("closes the scene's and the session's live areas; rest, long-rest and manual ones stay", async () => {
    const { gm, campaignId, area, statuses } = await setup();
    const ids = [await area("scene"), await area("session"), await area("rest"), await area("longRest"), await area("manual")];
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });

    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });

    expect(await statuses(ids)).toEqual(["ended", "ended", "active", "active", "active"]);
  });

  it("closes them with no live session too, and a second End closes nothing new", async () => {
    const { gm, campaignId, area, statuses } = await setup();
    const first = [await area("scene"), await area("session")];
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect(await statuses(first)).toEqual(["ended", "ended"]);

    const manual = await area("manual");
    const again = await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect(again.entryId).toBeNull();
    expect(await statuses([...first, manual])).toEqual(["ended", "ended", "active"]);
  });

  it("ends the scene's sheet state: a once-per-scene limit, the Unstoppable Die, the stance and Walk Between Worlds tokens", async () => {
    const { gm, campaignId, a, sheetOf, change } = await setup();
    const walk = featureKey("subclass:hedge:walk-between-worlds");
    await change(a, (s) => ({
      ...s,
      classState: { ...s.classState, unstoppable: { value: 2, max: 4 }, martial: { known: ["quick"], active: "quick", focus: 2 } },
      featureUses: [{ key: "feat:once-per-scene", until: "scene" }],
      cardTokens: [{ cardId: walk, count: 3 }],
    }));
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });

    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });

    const ash = await sheetOf(a);
    expect(ash.featureUses.map((u) => u.key)).toEqual([]);
    expect(ash.classState.unstoppable).toBeUndefined();
    expect(ash.classState.martial).toEqual({ known: ["quick"], focus: 2 });
    // HF p.16, Walk Between Worlds: "When the last token is removed or at the end of the scene, you return".
    expect(ash.cardTokens?.find((c) => c.cardId === walk)).toBeUndefined();
  });
});
