/**
 * Plan lanes-2 wave 10, tracer E4.4 (docs/tasks/TASK-LN4-E4.md).
 *
 * Expected values come from the book and the user's answers:
 * - HF p.16 (Circle of Power): "This spell lasts until the last token is removed or you exit the circle." (dcm-ii4)
 * - CB p.103 Defined Ranges: Very Close is 3 squares.
 * - Sprite packs Q1 answer (dcm-bxp.84): the GM can set any sprite to none / faint glow / torch / campfire.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { activeAreasOnMap, areaTokenKey, endAreasOwnerLeft, forcedMove, placeArea } from "../../convex/combatAreas";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { objectTraits } from "../../convex/lib/spriteSources";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { buildWorld } from "./authz/world";
import { errorCode, key, setupWithCampaign } from "./helpers";

/** The real Circle of Power entry (src/lib/srd/feature-effects/seraph-witch.ts): `endsOn: ["tokensGone", "ownerLeavesArea"]`. */
const CIRCLE = "subclass:hedge:circle-of-power";

async function refused(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return errorCode(e);
  }
  return "ok";
}

// ---------------------------------------------------------------- dcm-ii4: an area ends on its tokens and on its caster leaving

/** A live map with Ash (characterA) at (10, 10) and Bryn (characterB) at (14, 10); Ash's Circle of Power around (10, 10). */
async function circleArena(tokens = 2) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const base = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [], face: 0 };
    const ash = await ctx.db.insert("combatTokens", { ...base, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 10, y: 10 });
    const bryn = await ctx.db.insert("combatTokens", { ...base, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 14, y: 10 });
    return { ash, bryn };
  });
  const setTokens = (count: number) =>
    t.run(async (ctx) => {
      const sheet = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      const others = (sheet.cardTokens ?? []).filter((x) => x.cardId !== areaTokenKey(CIRCLE));
      await saveSheet(ctx, w.characterA, { ...sheet, cardTokens: count > 0 ? [...others, { cardId: areaTokenKey(CIRCLE), count }] : others });
    });
  await setTokens(tokens);
  const areaId = await t.run(async (ctx) => {
    const map = (await ctx.db.get("combatMaps", mapId))!;
    const spec = { label: "Circle of Power", centre: "point" as const, radius: "veryClose" as const, side: "selfAndAllies" as const, duration: "manual" as const, endsOn: ["tokensGone", "ownerLeavesArea"] as const };
    return placeArea(ctx, { campaignId, map, characterId: w.characterA, sourceId: CIRCLE, useId: "main", spec: { ...spec, endsOn: [...spec.endsOn] }, centre: { kind: "square", x: 10, y: 10 }, ownerToken: await ctx.db.get("combatTokens", ids.ash) });
  });
  const live = () => t.run(async (ctx) => (await activeAreasOnMap(ctx, mapId)).map((a) => a.label));
  const row = () => t.run((ctx) => ctx.db.get("combatAreas", areaId));
  const listed = async () => (await gm.query(api.combatAreas.list, { campaignId, mapId })).map((a) => a.label);
  const feed = () => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).map((r) => r.summary));
  return { w, t, campaignId, mapId, gm, player, ...ids, setTokens, live, row, listed, feed, areaId };
}

describe("dcm-ii4: Circle of Power ends with its last token (HF p.16)", () => {
  it("the area is live while the caster holds tokens and gone from every reader at 0, whichever path spent them", async () => {
    const a = await circleArena(2);
    expect(await a.live()).toEqual(["Circle of Power"]);
    await a.setTokens(1);
    expect(await a.listed()).toEqual(["Circle of Power"]);
    // The last token removed outside the caster's own use (an ally's roll, an evaded attack, a hand edit): not live.
    await a.setTokens(0);
    expect(await a.live()).toEqual([]);
    expect(await a.listed()).toEqual([]);
  });

  it("giving the tokens back (undo of the spend) brings the circle back; redrawing it ends the spent copy", async () => {
    const a = await circleArena(1);
    await a.setTokens(0);
    expect(await a.live()).toEqual([]);
    await a.setTokens(1);
    expect(await a.live()).toEqual(["Circle of Power"]);
    // The use again: the old row (spent or not) ends before the new one goes down, so only one circle is ever live.
    await a.setTokens(0);
    await a.t.run(async (ctx) => {
      const map = (await ctx.db.get("combatMaps", a.mapId))!;
      await placeArea(ctx, { campaignId: a.campaignId, map, characterId: a.w.characterA, sourceId: CIRCLE, useId: "main", spec: { label: "Circle of Power", centre: "point", radius: "veryClose", side: "selfAndAllies", duration: "manual", endsOn: ["tokensGone", "ownerLeavesArea"] }, centre: { kind: "square", x: 11, y: 10 }, ownerToken: null });
    });
    expect((await a.row())?.status).toBe("ended");
    await a.setTokens(3);
    expect(await a.live()).toEqual(["Circle of Power"]);
  });

  it("the token key is the card id for a card and feat:<id> for a feature", () => {
    expect(areaTokenKey(CIRCLE)).toBe(`feat:${CIRCLE}`);
    expect(areaTokenKey("invisibility")).toBe("invisibility");
  });
});

describe("dcm-ii4: Circle of Power ends when its caster exits it (HF p.16)", () => {
  it("the caster's own step out ends it (areasAfterMove, kept)", async () => {
    const a = await circleArena();
    expect((await a.player.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.ash, x: 12, y: 10 })).areas).toBeUndefined();
    expect(await a.live()).toEqual(["Circle of Power"]);
    const out = await a.player.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.ash, x: 20, y: 10 });
    expect(out.areas).toEqual([{ label: "Circle of Power", event: "leave", ended: true }]);
    expect(await a.live()).toEqual([]);
  });

  it("an ally moving out does not end it", async () => {
    const a = await circleArena();
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.bryn, x: 25, y: 10 });
    expect(await a.live()).toEqual(["Circle of Power"]);
  });

  it("a caster carried out by an ally ends it", async () => {
    const a = await circleArena();
    // Bryn steps next to Ash (Melee), then carries her out (Wings of Light, CB p.45).
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.bryn, x: 11, y: 10 });
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.bryn, x: 21, y: 10, carry: [a.ash] });
    expect(await a.live()).toEqual([]);
    expect(await a.feed()).toContain("Circle of Power ends: its caster left it");
  });

  it("a forced move of the caster out of the circle ends it; one that stays inside does not", async () => {
    const a = await circleArena();
    const gmId = a.w.users.gm;
    const push = (x: number) =>
      a.t.run(async (ctx) => {
        const map = (await ctx.db.get("combatMaps", a.mapId))!;
        return forcedMove(ctx, { campaignId: a.campaignId, map, tokenId: a.ash, to: { x, y: 10 }, label: "Knockback", actorId: gmId });
      });
    await push(12);
    expect(await a.live()).toEqual(["Circle of Power"]);
    await push(22);
    expect(await a.live()).toEqual([]);
  });

  it("taking the caster's token off the map ends it; another token's removal does not", async () => {
    const a = await circleArena();
    await a.gm.mutation(api.combatTokens.remove, { campaignId: a.campaignId, tokenId: a.bryn });
    expect(await a.live()).toEqual(["Circle of Power"]);
    await a.gm.mutation(api.combatTokens.remove, { campaignId: a.campaignId, tokenId: a.ash });
    expect(await a.live()).toEqual([]);
  });

  it("clearing the map's tokens ends it", async () => {
    const a = await circleArena();
    await a.gm.mutation(api.combatTokens.clear, { campaignId: a.campaignId, mapId: a.mapId });
    expect(await a.live()).toEqual([]);
  });

  it("the reconcile leaves a circle whose caster still stands in it", async () => {
    const a = await circleArena();
    const ended = await a.t.run((ctx) => endAreasOwnerLeft(ctx, { campaignId: a.campaignId, mapId: a.mapId, actorId: a.w.users.gm }));
    expect(ended).toEqual([]);
    expect(await a.live()).toEqual(["Circle of Power"]);
  });
});

// ---------------------------------------------------------------- dcm-bxp.84 + dcm-klr8: per-object light override

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0]!.id,
    ancestry: { kind: "single" as const, id: ANCESTRIES.find((x) => x.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((x) => x.slot === "primary" && x.tier === 1 && x.source === "core" && x.category === "physical" && !x.classId)!.id,
    armorId: ARMOR.find((x) => x.source === "core" && x.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

const POOL = "cave/underground-pool"; // light none, Classic rock
const CANDLES = "dungeon/candle-cluster"; // faint glow, Classic crystal

/** A live medium Sprites map with the player's "Ash" at (5, 10) looking east, a Goblin at (12, 10), at night. */
async function lightScene() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const ashToken = (await gm.query(api.combatTokens.list, { campaignId, mapId })).find((tk) => tk.name === "Ash")!._id;
  await t.run((c) => c.db.patch("combatTokens", ashToken, { x: 5, y: 10, face: 0 }));
  await t.run(async (c) => {
    const row = await c.db
      .query("campaignTime")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    if (row === null) await c.db.insert("campaignTime", { campaignId, week: 1, cycle: "NIGHT", cycleDay: 3 });
    else await c.db.patch("campaignTime", row._id, { cycle: "NIGHT", cycleDay: 3 });
  });
  const { tokenId: goblin } = await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Goblin", hp: 3, side: "enemy", idempotencyKey: key() });
  await t.run((c) => c.db.patch("combatTokens", goblin, { x: 12, y: 10 }));
  const object = (o: { kind: "rock" | "crystal" | "campfire"; sprite?: { builtin: string } }) =>
    t.run((c) => c.db.insert("combatMapObjects", { mapId, kind: o.kind, x: 12, y: 10.5, r: 0.5, rot: 0, ...(o.sprite ? { sprite: o.sprite } : {}) }));
  const names = async () => {
    const v = await player.query(api.combatVision.playerView, { campaignId });
    if (v.state !== "ok") throw new Error(`expected a view, got ${v.state}`);
    return v.others.map((x) => x.name).sort();
  };
  const setLight = (objectId: Id<"combatMapObjects">, light: "none" | "faintglow" | "torch" | "campfire" | "default", as = gm) => as.mutation(api.combatVision.setObjectLight, { campaignId, objectId, light });
  const stored = (objectId: Id<"combatMapObjects">) => t.run(async (c) => (await c.db.get("combatMapObjects", objectId))?.light ?? null);
  return { ...ctx, player, mapId, object, names, setLight, stored };
}

describe("dcm-bxp.84: the GM sets a sprite object's light (none / faint glow / torch / campfire)", () => {
  it("a dark sprite set to torch lights the Goblin at night; default takes it back", async () => {
    const f = await lightScene();
    const pool = await f.object({ kind: "rock", sprite: { builtin: POOL } });
    expect(await f.names()).toEqual([]);
    await f.setLight(pool, "torch");
    expect(await f.stored(pool)).toBe("torch");
    expect(await f.names()).toEqual(["Goblin"]);
    await f.setLight(pool, "default");
    expect(await f.stored(pool)).toBeNull();
    expect(await f.names()).toEqual([]);
  });

  it("a glowing sprite set to none lights nothing", async () => {
    const f = await lightScene();
    const candles = await f.object({ kind: "crystal", sprite: { builtin: CANDLES } });
    expect(await f.names()).toEqual(["Goblin"]);
    await f.setLight(candles, "none");
    expect(await f.names()).toEqual([]);
  });

  it("the layout carries the override to the painter, and the light switch follows it", async () => {
    const f = await lightScene();
    const pool = await f.object({ kind: "rock", sprite: { builtin: POOL } });
    // A dark sprite is no light: the switch refuses it ...
    expect(await refused(f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: pool, lit: false }))).toBe("INVALID");
    await f.setLight(pool, "campfire");
    const layout = await f.gm.query(api.combatMaps.get, { campaignId: f.campaignId, mapId: f.mapId });
    expect(layout?.objects.find((o) => o._id === pool)?.light).toBe("campfire");
    // ... until it is one; switched off, it lights nothing.
    expect(await refused(f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: pool, lit: false }))).toBe("ok");
    expect(await f.names()).toEqual([]);
  });

  it("a Classic object takes no light setting (INVALID), but default always succeeds; players are FORBIDDEN", async () => {
    const f = await lightScene();
    const fire = await f.object({ kind: "campfire" });
    expect(await refused(f.setLight(fire, "none"))).toBe("INVALID");
    expect(await refused(f.setLight(fire, "default"))).toBe("ok");
    const pool = await f.object({ kind: "rock", sprite: { builtin: POOL } });
    expect(await refused(f.setLight(pool, "torch", f.player))).toBe("FORBIDDEN");
    expect(await f.stored(pool)).toBeNull();
  });

  it("objectTraits applies the override only to a sprite object", () => {
    const uploaded = new Map();
    expect(objectTraits({ sprite: { builtin: POOL } }, uploaded)?.light).toBe("none");
    expect(objectTraits({ sprite: { builtin: POOL }, light: "torch" }, uploaded)?.light).toBe("torch");
    expect(objectTraits({ light: "torch" }, uploaded)).toBeNull();
  });
});
