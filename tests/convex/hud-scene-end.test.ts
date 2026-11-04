import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { AreaExpires } from "../../convex/lib/validators/combatMaps";
import { featureKey } from "../../src/lib/domain/feature-effects/ids";
import { stanceById } from "../../src/lib/srd/stances";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

// H5.3 (plan combat-hud): `combatHud.sceneEndPreview` names what the GM's End scene would end (GMDesktop 'End scene').
// It mirrors `combatScenes.endScene` (CB p.107, End of the Scene): what it lists is what End then removes.

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
  const b = (await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  const change = (id: Id<"characters">, f: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, f(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const area = (label: string, expires: AreaExpires, status: "active" | "ended" = "active") =>
    t.run((ctx) =>
      ctx.db.insert("combatAreas", {
        campaignId,
        mapId,
        featureId: "subclass:moon:moonbeam",
        characterId: a,
        label,
        shape: "circle",
        centre: { kind: "square", x: 1, y: 1 },
        radius: "close",
        blocksSight: false,
        expires,
        status,
        createdAt: 0,
      }),
    );
  const preview = () => gm.query(api.combatHud.sceneEndPreview, { campaignId });
  return { t, gm, p1, campaignId, a, b, change, sheetOf, area, preview };
}

const effect = (id: string, source: string, until: CharacterSheet["effects"][number]["until"]) => ({ id, source, text: `${source}.`, until });

describe("combatHud.sceneEndPreview (H5.3)", () => {
  it("names nothing when nothing lasts until the scene", async () => {
    const { preview } = await setup();
    expect(await preview()).toEqual({ effects: [], limits: 0, areas: [] });
  });

  it("names the scene effects, the Unstoppable Die, the stance and Walk Between Worlds across the party, and the scene's live areas", async () => {
    const { a, b, change, area, preview } = await setup();
    const walk = featureKey("subclass:hedge:walk-between-worlds");
    const stance = "quick";
    await change(a, (s) => ({
      ...s,
      effects: [effect("e1", "Wall Walk", "scene"), effect("e2", "No Mercy", "rest"), effect("e3", "Shield Aura", "session")],
      featureUses: [{ key: "feat:once-per-scene", until: "scene" }, { key: "feat:rest", until: "rest" }],
      classState: { ...s.classState, unstoppable: { value: 2, max: 4 }, martial: { known: [stance], active: stance, focus: 2 } },
      cardTokens: [{ cardId: walk, count: 2 }],
    }));
    // The same effect on two PCs is named once.
    await change(b, (s) => ({ ...s, effects: [effect("e1", "Wall Walk", "scene"), effect("e4", "Bolster", "hit")] }));
    await area("Dark Cloud", "scene");
    await area("Dark Cloud", "scene");
    await area("Moonbeam", "session");
    await area("Old Smoke", "scene", "ended");

    const got = await preview();

    expect(got.effects).toEqual(["Wall Walk", "Unstoppable", stanceById(stance)!.name, "Walk Between Worlds"]);
    expect(got.limits).toBe(1);
    expect(got.areas).toEqual(["Dark Cloud"]);
  });

  it("lists exactly what End scene then ends, and nothing after it", async () => {
    const { gm, campaignId, a, change, sheetOf, area, preview } = await setup();
    await change(a, (s) => ({ ...s, effects: [effect("e1", "Wall Walk", "scene"), effect("e2", "No Mercy", "rest")] }));
    await area("Dark Cloud", "scene");
    const before = await preview();
    expect(before).toEqual({ effects: ["Wall Walk"], limits: 0, areas: ["Dark Cloud"] });

    const result = await gm.mutation(api.combatScenes.end, { campaignId, idempotencyKey: key() });

    expect(result.areas).toBe(before.areas.length);
    expect((await sheetOf(a)).effects.map((e) => e.source)).toEqual(["No Mercy"]);
    expect(await preview()).toEqual({ effects: [], limits: 0, areas: [] });
  });

  it("is the GM's: a player is refused", async () => {
    const { p1, campaignId } = await setup();
    const error = await p1.query(api.combatHud.sceneEndPreview, { campaignId }).catch((e: unknown) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });
});
