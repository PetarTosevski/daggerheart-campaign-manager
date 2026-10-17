import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

type Frame = "witherwild" | "motherboard" | "beast-feast" | "castle-high";

async function setup(frameId: Frame, sheet: { classId?: string; subclassId?: string; level?: number } = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    outsider: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, outsider] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.outsider)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const characterId: Id<"characters"> = await t.run((ctx) =>
    ctx.db.insert("characters", {
      campaignId,
      ownerId: ids.p1,
      createdBy: ids.p1,
      status: "active",
      sheet: {
        level: sheet.level ?? 1,
        classId: sheet.classId ?? "warrior",
        subclassId: sheet.subclassId ?? "call-of-the-brave",
        traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      },
      createdAt: 0,
      updatedAt: 0,
    }),
  );
  return { t, gm, p1, p2, outsider, campaignId, characterId };
}

const fail = async (p: Promise<unknown>) => errorCode(await p.then(() => null, (e: unknown) => e));

describe("character extras", () => {
  useAllowlist("gm@example.com,p1@example.com,p2@example.com,out@example.com");

  it("returns only the extras that apply", async () => {
    const { p2, outsider, characterId } = await setup("motherboard", { classId: "druid", subclassId: "warden-of-renewal" });
    const view = await p2.query(api.characterExtras.get, { characterId });
    expect(view.canEdit).toBe(false);
    expect(view.beastform).toEqual({ formId: null });
    expect(view.motherboard?.quantum).toBe(5);
    expect(view.companion).toBeNull();
    expect(view.beastFeast).toBeNull();
    expect(view.cookbook).toBeNull();
    expect(await fail(outsider.query(api.characterExtras.get, { characterId }))).toBe("NOT_FOUND");
  });

  it("owner and GM edit; other players and wrong frames/classes are refused", async () => {
    const { gm, p1, p2, characterId } = await setup("castle-high");
    const skyshard = { name: "Old broom", description: "Hums in the rain." };
    await p1.mutation(api.characterExtras.saveSkyshard, { characterId, skyshard, idempotencyKey: key() });
    await gm.mutation(api.characterExtras.saveSkyshard, { characterId, skyshard: { ...skyshard, name: "Broom" }, idempotencyKey: key() });
    expect(await fail(p2.mutation(api.characterExtras.saveSkyshard, { characterId, skyshard, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect((await p2.query(api.characterExtras.get, { characterId })).castleHigh?.skyshard.name).toBe("Broom");
    expect(
      await fail(p1.mutation(api.characterExtras.setBeastform, { characterId, state: { formId: "agile-scout" }, idempotencyKey: key() })),
    ).toBe("MECHANIC_DISABLED");
    expect(await fail(p1.mutation(api.characterExtras.gatherScrap, { characterId, shards: 1, metals: 0, components: 0, idempotencyKey: key() }))).toBe(
      "MECHANIC_DISABLED",
    );
  });

  it("Druid beastform respects the tier", async () => {
    const { p1, characterId } = await setup("witherwild", { classId: "druid", subclassId: "warden-of-renewal" });
    await p1.mutation(api.characterExtras.setBeastform, { characterId, state: { formId: "agile-scout" }, idempotencyKey: key() });
    expect(
      await fail(p1.mutation(api.characterExtras.setBeastform, { characterId, state: { formId: "armored-sentry" }, idempotencyKey: key() })),
    ).toBe("EXTRA_RULE");
    expect((await p1.query(api.characterExtras.get, { characterId })).beastform).toEqual({ formId: "agile-scout" });
  });

  it("Beastbound companion validates training", async () => {
    const { p1, characterId } = await setup("witherwild", { classId: "ranger", subclassId: "beastbound", level: 2 });
    const state = {
      name: "Mirra",
      kind: "Wolf",
      experiences: [{ name: "Scout", value: 2 }, { name: "Loyal", value: 2 }],
      attack: { name: "Bite", damageType: "phy" },
      stress: 1,
      training: { aware: 1 },
      vicious: [],
      bonusTraining: 0,
      gifts: "",
      inventory: "",
    };
    await p1.mutation(api.characterExtras.saveCompanion, { characterId, state, idempotencyKey: key() });
    expect(
      await fail(p1.mutation(api.characterExtras.saveCompanion, { characterId, state: { ...state, training: { aware: 2 } }, idempotencyKey: key() })),
    ).toBe("EXTRA_RULE");
    expect(await fail(p1.mutation(api.characterExtras.saveCompanion, { characterId, state: { ...state, name: 5 }, idempotencyKey: key() }))).toBe("INVALID");
    expect((await p1.query(api.characterExtras.get, { characterId })).companion?.name).toBe("Mirra");
  });

  it("Motherboard: gather is rolled on the server and idempotent; trade, craft, install", async () => {
    const { p1, characterId } = await setup("motherboard");
    const idempotencyKey = key();
    const first = await p1.mutation(api.characterExtras.gatherScrap, { characterId, shards: 2, metals: 1, components: 1, idempotencyKey });
    const replay = await p1.mutation(api.characterExtras.gatherScrap, { characterId, shards: 2, metals: 1, components: 1, idempotencyKey });
    expect(first).toHaveLength(4);
    expect(replay).toEqual(first);
    const view = await p1.query(api.characterExtras.get, { characterId });
    expect(Object.values(view.motherboard!.scrap).reduce((a, b) => a + b, 0)).toBe(4);

    await p1.mutation(api.characterExtras.correctWallet, {
      characterId,
      correction: { quantum: 0, scrap: { Gear: 3, Lens: 2, Aluminum: 4, Capacitor: 1 } },
      idempotencyKey: key(),
    });
    await p1.mutation(api.characterExtras.craftAugment, { characterId, augmentId: "force", idempotencyKey: key() });
    await p1.mutation(api.characterExtras.installAugments, { characterId, augmentIds: ["force"], idempotencyKey: key() });
    expect(await fail(p1.mutation(api.characterExtras.craftAugment, { characterId, augmentId: "sear", idempotencyKey: key() }))).toBe("EXTRA_RULE");
    await p1.mutation(api.characterExtras.addRelic, { characterId, name: "Steelhorn", idempotencyKey: key() });
    const relicId = (await p1.query(api.characterExtras.get, { characterId })).motherboard!.relics[0].id;
    expect(await p1.mutation(api.characterExtras.sellRelic, { characterId, relicId, idempotencyKey: key() })).toEqual({ quantum: 20 });
    expect(await p1.mutation(api.characterExtras.tradeScrap, { characterId, name: "Silver", quantity: 2, direction: "buy", idempotencyKey: key() })).toEqual({
      quantum: 8,
    });
    const mb = (await p1.query(api.characterExtras.get, { characterId })).motherboard!;
    expect(mb.installed).toEqual(["force"]);
    expect(mb.scrap.Silver).toBeGreaterThanOrEqual(2);
  });

  it("Beast Feast: ingredients within capacity; players add to the shared cookbook", async () => {
    const { gm, p1, p2, campaignId, characterId } = await setup("beast-feast");
    const ingredient = { name: "Rileroot", flavors: [{ flavor: "bitter", strength: 1 }] };
    await p1.mutation(api.characterExtras.addIngredient, { characterId, ingredient, idempotencyKey: key() });
    await p1.mutation(api.characterExtras.addIngredient, { characterId, ingredient, idempotencyKey: key() });
    expect(await fail(p1.mutation(api.characterExtras.addIngredient, { characterId, ingredient, idempotencyKey: key() }))).toBe("EXTRA_RULE");

    const entry = { name: "Root stew", description: "Bitter.", ingredients: ["Rileroot"], profile: { bitter: 2 }, mealRating: 4 };
    await p2.mutation(api.characterExtras.addCookbookEntry, { campaignId, entry, idempotencyKey: key() });
    const view = await gm.query(api.characterExtras.get, { characterId });
    expect(view.ingredientCapacity).toBe(2);
    expect(view.beastFeast?.ingredients).toHaveLength(2);
    expect(view.cookbook).toHaveLength(1);
    expect(view.cookbook![0].canRemove).toBe(true);
    expect((await p1.query(api.characterExtras.get, { characterId })).cookbook![0].canRemove).toBe(false);
    const entryId = view.cookbook![0].id;
    expect(await fail(p1.mutation(api.characterExtras.removeCookbookEntry, { campaignId, entryId, idempotencyKey: key() }))).toBe("FORBIDDEN");
    await gm.mutation(api.characterExtras.removeCookbookEntry, { campaignId, entryId, idempotencyKey: key() });
    expect((await p1.query(api.characterExtras.get, { characterId })).cookbook).toEqual([]);
  });
});
