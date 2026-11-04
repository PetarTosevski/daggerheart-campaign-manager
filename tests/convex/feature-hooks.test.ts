import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { featureKey } from "../../src/lib/domain/feature-effects/ids";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet, Effect, FeatureUse } from "../../src/lib/validation/characters";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Plan sheet-drawer SD8 (Q7, dcm-bxp.117): a scene ends with the running encounter, the GM's End scene or the session;
// feature tokens follow their rest and long-rest texts. CB p.107, End of the Scene: "Sometimes certain effects, bonuses,
// or conditions state that they last until the end of the scene. … A battle scene usually ends when one side has fled,
// surrendered, or been entirely defeated."

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

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
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const change = (id: Id<"characters">, f: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, f(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const rest = async (kind: "short" | "long") => {
    const { restId } = await gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
    await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  };
  return { t, gm, p1, campaignId, a, b, sheetOf, change, rest };
}

const effect = (id: string, until: Effect["until"]): Effect => ({ id, source: "Test", text: until, until, mods: {} });
const use = (k: string, until: FeatureUse["until"]): FeatureUse => ({ key: k, until });
const TOXIC = featureKey("subclass:poisoners-guild:toxic-concoctions");
const TALISMAN = featureKey("subclass:hedge:enchanted-talisman");
const WALK = featureKey("subclass:hedge:walk-between-worlds");
const tokensOf = (s: CharacterSheet, k: string) => s.cardTokens?.find((c) => c.cardId === k)?.count;

/** Ash: a Guardian with the Unstoppable Die out, a once-per-scene limit and a scene effect. Bryn: a Martial Artist mid-stance. */
async function sceneState(env: Awaited<ReturnType<typeof setup>>) {
  await env.change(env.a, (s) => ({
    ...s,
    classId: "guardian",
    subclassId: "stalwart",
    classState: { ...s.classState, unstoppable: { value: 2, max: 4 } },
    effects: [effect("s1", "scene"), effect("x1", "session")],
    featureUses: [use("feat:once-per-scene", "scene"), use("feat:once-per-rest", "rest")],
  }));
  await env.change(env.b, (s) => ({
    ...s,
    classId: "warrior",
    classState: { ...s.classState, martial: { known: ["quick", "reliable"], active: "quick", focus: 3 } },
    cardTokens: [{ cardId: WALK, count: 2 }],
  }));
}

/** Inserts a live area cast by Ash on a fresh map (SD-A writes them through the feature runner). */
async function areaMaker(env: Awaited<ReturnType<typeof setup>>) {
  const { mapId } = await env.gm.mutation(api.combatMaps.create, { campaignId: env.campaignId, size: "medium", idempotencyKey: key() });
  return (expires: "scene" | "rest" | "longRest" | "manual") =>
    env.t.run((ctx) =>
      ctx.db.insert("combatAreas", {
        campaignId: env.campaignId,
        mapId,
        featureId: "subclass:moon:moonbeam",
        characterId: env.a,
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
}

async function expectSceneEnded(env: Awaited<ReturnType<typeof setup>>) {
  const ash = await env.sheetOf(env.a);
  expect(ash.effects.map((e) => e.id)).toEqual(["x1"]);
  expect(ash.featureUses.map((u) => u.key)).toEqual(["feat:once-per-rest"]);
  expect(ash.classState.unstoppable).toBeUndefined();
  const bryn = await env.sheetOf(env.b);
  // HF p.12: "you drop out of your active stance at the end of the scene"; Focus and known stances stay.
  expect(bryn.classState.martial).toEqual({ known: ["quick", "reliable"], focus: 3 });
  // HF p.16, Walk Between Worlds: "When the last token is removed or at the end of the scene, you return".
  expect(tokensOf(bryn, WALK)).toBeUndefined();
}

describe("scene end (SD8, Q7)", () => {
  useAllowlist(EMAILS);

  it("combatScenes.end ends every PC's scene state in one undoable group; undo restores it", async () => {
    const env = await setup();
    await sceneState(env);
    const result = await env.gm.mutation(api.combatScenes.end, { campaignId: env.campaignId, idempotencyKey: key() });
    // Ash: the effect, the limit and the Unstoppable Die; Bryn: the stance and the Walk Between Worlds tokens.
    expect(result.ended).toBe(5);
    expect(result.entryId).not.toBeNull();
    await expectSceneEnded(env);

    await env.gm.mutation(api.actionLog.undo, { entryId: result.entryId!, idempotencyKey: key() });
    const ash = await env.sheetOf(env.a);
    expect(ash.effects.map((e) => e.id)).toEqual(["s1", "x1"]);
    expect(ash.classState.unstoppable).toEqual({ value: 2, max: 4 });
    expect((await env.sheetOf(env.b)).classState.martial?.active).toBe("quick");
  });

  it("a replay returns the same result; a scene with nothing in it writes nothing", async () => {
    const env = await setup();
    await sceneState(env);
    const k = key();
    const first = await env.gm.mutation(api.combatScenes.end, { campaignId: env.campaignId, idempotencyKey: k });
    expect(await env.gm.mutation(api.combatScenes.end, { campaignId: env.campaignId, idempotencyKey: k })).toEqual(first);
    expect(await env.gm.mutation(api.combatScenes.end, { campaignId: env.campaignId, idempotencyKey: key() })).toEqual({ ended: 0, areas: 0, entryId: null });
  });

  it("closes the live map areas that last until the scene and keeps the others", async () => {
    const env = await setup();
    const area = await areaMaker(env);
    const scene = await area("scene");
    const manual = await area("manual");
    const result = await env.gm.mutation(api.combatScenes.end, { campaignId: env.campaignId, idempotencyKey: key() });
    expect(result.areas).toBe(1);
    expect(await env.t.run(async (ctx) => [(await ctx.db.get("combatAreas", scene))?.status, (await ctx.db.get("combatAreas", manual))?.status])).toEqual([
      "ended",
      "active",
    ]);
  });

  it("a rest closes the caster's areas that last until a rest; a long-rest area waits for a long rest", async () => {
    const env = await setup();
    const area = await areaMaker(env);
    const rest = await area("rest");
    const long = await area("longRest");
    const status = () => env.t.run(async (ctx) => [(await ctx.db.get("combatAreas", rest))?.status, (await ctx.db.get("combatAreas", long))?.status]);
    await env.rest("short");
    expect(await status()).toEqual(["ended", "active"]);
    await env.rest("long");
    expect(await status()).toEqual(["ended", "ended"]);
  });

  it("ending the running encounter ends the scene too", async () => {
    const env = await setup();
    await sceneState(env);
    const { encounterId } = await env.gm.mutation(api.encounters.create, { campaignId: env.campaignId, name: "Ambush", idempotencyKey: key() });
    await env.gm.mutation(api.encounters.addAdversary, { campaignId: env.campaignId, encounterId, source: { kind: "srd", adversaryId: "bear" }, count: 1, summoned: false, idempotencyKey: key() });
    await env.gm.mutation(api.encounters.start, { campaignId: env.campaignId, encounterId });
    await env.gm.mutation(api.encounters.end, { campaignId: env.campaignId, encounterId });
    await expectSceneEnded(env);
  });

  it("session end ends the scene too", async () => {
    const env = await setup();
    await sceneState(env);
    await env.gm.mutation(api.sessions.end, { campaignId: env.campaignId, idempotencyKey: key() });
    const ash = await env.sheetOf(env.a);
    expect(ash.featureUses.map((u) => u.key)).toEqual(["feat:once-per-rest"]);
    expect(ash.classState.unstoppable).toBeUndefined();
    expect((await env.sheetOf(env.b)).classState.martial).toEqual({ known: ["quick", "reliable"], focus: 3 });
  });

  it("rests leave scene limits and the active stance alone (Q3)", async () => {
    const env = await setup();
    await sceneState(env);
    await env.rest("long");
    const ash = await env.sheetOf(env.a);
    expect(ash.featureUses.map((u) => u.key)).toEqual(["feat:once-per-scene"]);
    expect((await env.sheetOf(env.b)).classState.martial?.active).toBe("quick");
  });
});

describe("feature tokens at a rest (SD8)", () => {
  useAllowlist(EMAILS);

  it("Toxic Concoctions: unspent tokens clear on a long rest only (HF p.9: \"Clear all unspent tokens when you take a long rest\")", async () => {
    const env = await setup();
    await env.change(env.a, (s) => ({ ...s, classId: "assassin", subclassId: "poisoners-guild", cardTokens: [{ cardId: TOXIC, count: 4 }] }));
    await env.rest("short");
    expect(tokensOf(await env.sheetOf(env.a), TOXIC)).toBe(4);
    await env.rest("long");
    expect(tokensOf(await env.sheetOf(env.a), TOXIC) ?? 0).toBe(0);
  });

  it("Enchanted Talisman: tokens clear on any rest (HF p.16: \"Clear all tokens from this card when you take a rest\")", async () => {
    const env = await setup();
    await env.change(env.a, (s) => ({ ...s, classId: "witch", subclassId: "hedge", cardTokens: [{ cardId: TALISMAN, count: 3 }] }));
    await env.rest("short");
    expect(tokensOf(await env.sheetOf(env.a), TALISMAN) ?? 0).toBe(0);
  });

  it("a character without the feature keeps its token entry (only held features run their timing)", async () => {
    const env = await setup();
    await env.change(env.a, (s) => ({ ...s, cardTokens: [{ cardId: TOXIC, count: 2 }] }));
    await env.rest("long");
    expect(tokensOf(await env.sheetOf(env.a), TOXIC)).toBe(2);
  });
});
