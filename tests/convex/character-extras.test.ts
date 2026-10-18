import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
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
      attack: { name: "Bite", damageType: "phy" as const },
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
    expect(await fail(p1.mutation(api.characterExtras.saveCompanion, { characterId, state: { ...state, stress: 99 }, idempotencyKey: key() }))).toBe("INVALID");
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
    const ingredient = { name: "Rileroot", flavors: [{ flavor: "bitter" as const, strength: 1 }] };
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

  it("an edit grant on a character lets that user edit its extras", async () => {
    const { t, gm, p2, characterId } = await setup("castle-high");
    const skyshard = { name: "Lantern", description: "" };
    expect(await fail(p2.mutation(api.characterExtras.saveSkyshard, { characterId, skyshard, idempotencyKey: key() }))).toBe("FORBIDDEN");
    await t.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      const id = (email: string) => users.find((u) => u.email === email)!._id;
      await ctx.db.insert("grants", {
        resourceType: "character",
        resourceId: characterId,
        principalKind: "user",
        principalId: id("p2@example.com"),
        permission: "edit",
        createdBy: id("gm@example.com"),
        createdAt: 0,
      });
    });
    expect((await p2.query(api.characterExtras.get, { characterId })).canEdit).toBe(true);
    await p2.mutation(api.characterExtras.saveSkyshard, { characterId, skyshard, idempotencyKey: key() });
    expect((await gm.query(api.characterExtras.get, { characterId })).castleHigh?.skyshard.name).toBe("Lantern");
  });

  it("stores one typed row per character and extra; characters.remove deletes them", async () => {
    const { t, gm, p1, characterId } = await setup("castle-high", { classId: "druid", subclassId: "warden-of-renewal" });
    await p1.mutation(api.characterExtras.saveSkyshard, { characterId, skyshard: { name: "Broom", description: "" }, idempotencyKey: key() });
    await p1.mutation(api.characterExtras.saveSkyshard, { characterId, skyshard: { name: "Mop", description: "" }, idempotencyKey: key() });
    await p1.mutation(api.characterExtras.setBeastform, { characterId, state: { formId: "agile-scout" }, idempotencyKey: key() });
    const rows = () =>
      t.run((ctx) =>
        ctx.db
          .query("characterExtras")
          .withIndex("by_character_extra", (q) => q.eq("characterId", characterId))
          .collect(),
      );
    expect((await rows()).map((r) => [r.extra, r.schemaVersion, r.data])).toEqual([
      ["beastform", 1, { formId: "agile-scout" }],
      ["castleHigh", 1, { skyshard: { name: "Mop", description: "" } }],
    ]);
    await gm.mutation(api.characters.remove, { characterId });
    expect(await rows()).toEqual([]);
  });

  it("a stored row that fails its schema reads as TRACKER_CORRUPT", async () => {
    const { t, p1, campaignId, characterId } = await setup("castle-high");
    const skyshard = { name: "x".repeat(81), description: "" };
    await t.run((ctx) => ctx.db.insert("characterExtras", { campaignId, characterId, extra: "castleHigh", schemaVersion: 1, data: { skyshard }, updatedAt: 0 }));
    expect(await fail(p1.query(api.characterExtras.get, { characterId }))).toBe("TRACKER_CORRUPT");
  });
});

describe("migrations/characterExtras:moveFromTrackers", () => {
  useAllowlist("gm@example.com,p1@example.com,p2@example.com,out@example.com");
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves every character:<id>:* row into characterExtras and deletes it; the cookbook and other trackers stay", async () => {
    const { t, p1, campaignId, characterId } = await setup("beast-feast", { classId: "druid", subclassId: "warden-of-renewal" });
    const ingredients = { ingredients: [{ id: "i1", name: "Rileroot", flavors: [{ flavor: "bitter", strength: 1 }] }] };
    const goneId = await t.run(async (ctx) => {
      const { _id, _creationTime, ...character } = (await ctx.db.get("characters", characterId))!;
      void _id;
      void _creationTime;
      const gone = await ctx.db.insert("characters", character);
      await ctx.db.delete("characters", gone);
      const row = (key: string, data: object) => ctx.db.insert("frameTrackers", { campaignId, key, data, updatedAt: 7 });
      await row(`character:${characterId}:beastFeast`, ingredients);
      await row(`character:${characterId}:beastform`, { formId: "agile-scout" });
      await row(`character:${gone}:beastform`, { formId: "agile-scout" });
      await row(`character:${characterId}:castleHigh`, { skyshard: 5 });
      await row("beastFeast.cookbook", { entries: [] });
      await row("colossus", { phase: "x" });
      return gone;
    });
    // Until the migration runs, reads fall back to the old rows.
    const before = await p1.query(api.characterExtras.get, { characterId });
    expect(before.beastFeast).toEqual(ingredients);
    expect(before.beastform).toEqual({ formId: "agile-scout" });

    await t.mutation(internal.migrations.characterExtras.moveFromTrackers, { batchSize: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const extras = await t.run((ctx) => ctx.db.query("characterExtras").collect());
    expect(extras.map((r) => [r.characterId, r.extra, r.schemaVersion, r.data, r.updatedAt])).toEqual([
      [characterId, "beastFeast", 1, ingredients, 7],
      [characterId, "beastform", 1, { formId: "agile-scout" }, 7],
    ]);
    const keys = async () => (await t.run((ctx) => ctx.db.query("frameTrackers").collect())).map((r) => r.key).sort();
    // The deleted character's row is gone; the row that fails its schema stays for a manual repair.
    const left = ["beastFeast.cookbook", `character:${characterId}:castleHigh`, "colossus"];
    expect(await keys()).toEqual(left);
    expect(left).not.toContain(`character:${goneId}:beastform`);
    expect(await p1.query(api.characterExtras.get, { characterId })).toEqual(before);

    // An old row left behind loses to the table's row; a rerun is idempotent.
    await p1.mutation(api.characterExtras.setBeastform, { characterId, state: { formId: null }, idempotencyKey: key() });
    await t.run((ctx) => ctx.db.insert("frameTrackers", { campaignId, key: `character:${characterId}:beastform`, data: { formId: "agile-scout" }, updatedAt: 8 }));
    await t.mutation(internal.migrations.characterExtras.moveFromTrackers, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await p1.query(api.characterExtras.get, { characterId })).beastform).toEqual({ formId: null });
    expect(await keys()).toEqual(left);
    expect(await t.run(async (ctx) => (await ctx.db.query("characterExtras").collect()).length)).toBe(2);
  });
});
