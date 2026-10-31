/**
 * Lane M (plan lanes, wave 5): the campaign's time of day (dcm-bxp.54), Witherwild dim days (dcm-p40), a pack setting's
 * `extends` (dcm-bxp.86) and a Maps card thumbnail's painted cells (dcm-bxp.97).
 *
 * Expected values come from the user's answers:
 * - dcm-bxp.54 (2026-10-21, 2026-10-30): every campaign has a Day / Dim / Night time of day; the GM sets it (dashboard and
 *   map header, one shared value), players see it read-only; in the Witherwild the campaign-time phase drives it
 *   (`lightOf(phase)`), no separate override. Maps follow it: night, dim bands and lights apply in every frame.
 * - dcm-p40 (2026-10-30): dim = the last day of a day cycle and the first of a night cycle, and the last day of a night
 *   cycle and the first of a day cycle; other days bright, other nights dark.
 * - R9 (light.ts): at night a token without a light sees clearly only in Melee and dimly to Very Close (3 squares).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { campaignLight, loadScene } from "../../convex/lib/combatVision";
import { enemySight } from "../../convex/lib/combatMovement";
import { CELL_UNPAINTED, TERRAIN_CODES } from "../../src/components/combat-map/map-view/cells";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => errorCode(e),
  );

/** A live medium map with characterA's PC token at (2, 10) facing east and a custom enemy 18 squares east. */
async function arena(w: World) {
  const { t, campaignId } = w;
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    const pc = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    const enemy = await ctx.db.insert("combatTokens", {
      ...token,
      ref: { kind: "custom", name: "Goblin", hp: 0, hpMax: 3, stress: 0, stressMax: 0, conditions: [] },
      side: "enemy",
      x: 20,
      y: 10,
      face: Math.PI,
    });
    return { pc, enemy };
  });
  return { mapId, ...ids };
}

const sees = async (w: World) => {
  const view = await w.as("player").query(api.combatVision.playerView, { campaignId: w.campaignId });
  if (view.state !== "ok") throw new Error(`expected a view, got ${view.state}`);
  return { light: view.light, phase: view.phase, others: view.others.map((o) => o.name) };
};

describe("campaign time of day outside the Witherwild (dcm-bxp.54)", () => {
  it("starts at day; the GM sets it, players read it and may not set it", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { campaignId } = w;
    expect(await w.as("gm").query(api.campaigns.timeOfDay, { campaignId })).toEqual({ phase: null, light: "day", canSet: true });
    expect(await w.as("player").query(api.campaigns.timeOfDay, { campaignId })).toEqual({ phase: null, light: "day", canSet: false });

    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId, timeOfDay: "night" });
    expect(await w.as("player").query(api.campaigns.timeOfDay, { campaignId })).toEqual({ phase: null, light: "night", canSet: false });
    expect(await code(w.as("player").mutation(api.campaigns.setTimeOfDay, { campaignId, timeOfDay: "day" }))).toBe("FORBIDDEN");
    expect(await w.t.run(async (ctx) => (await ctx.db.get("campaigns", campaignId))?.timeOfDay)).toBe("night");

    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId, timeOfDay: "dim" });
    expect((await w.as("player").query(api.campaigns.timeOfDay, { campaignId })).light).toBe("dim");
  });

  it("the map follows it: at night an enemy past Very Close is hidden, by day and in dim light it shows", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    await arena(w);
    expect(await sees(w)).toEqual({ light: "day", phase: null, others: ["Goblin"] });
    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "night" });
    expect(await sees(w)).toEqual({ light: "night", phase: null, others: [] });
    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "dim" });
    expect(await sees(w)).toEqual({ light: "dim", phase: null, others: ["Goblin"] });
  });

  it("the scene carries the light for every engine caller (combatMovement's enemy sight follows it)", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { mapId, pc, enemy } = await arena(w);
    const sight = () =>
      w.t.run(async (ctx) => {
        const campaign = (await ctx.db.get("campaigns", w.campaignId))!;
        const scene = await loadScene(ctx, campaign, (await ctx.db.get("combatMaps", mapId))!);
        return { phase: scene.phase, phaseName: scene.phaseName, light: scene.light, sight: enemySight(scene, (await ctx.db.get("combatTokens", enemy))!, (await ctx.db.get("combatTokens", pc))!) };
      });
    expect(await sight()).toEqual({ phase: "day", phaseName: null, light: "day", sight: "clear" });
    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "dim" });
    expect(await sight()).toEqual({ phase: "dim", phaseName: null, light: "dim", sight: "dim" });
    await w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "night" });
    expect(await sight()).toEqual({ phase: "night", phaseName: null, light: "night", sight: "none" });
  });
});

describe("Witherwild: the campaign time phase drives the light (dcm-bxp.54, dcm-p40)", () => {
  const atDay = async (w: World, cycle: "DAY" | "NIGHT", cycleDay: number) => {
    await w.t.run(async (ctx) => {
      const row = await ctx.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", w.campaignId))
        .unique();
      if (row) await ctx.db.patch("campaignTime", row._id, { cycle, cycleDay });
      else throw new Error("no campaign time row");
    });
    return w.as("player").query(api.campaigns.timeOfDay, { campaignId: w.campaignId });
  };

  it("the setter is refused; nobody may set it there", async () => {
    const w = await buildWorld();
    expect(await code(w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId: w.campaignId, timeOfDay: "night" }))).toBe("INVALID");
    expect((await w.as("gm").query(api.campaigns.timeOfDay, { campaignId: w.campaignId })).canSet).toBe(false);
  });

  it("dim on the boundary days of both cycles, bright other days, dark other nights", async () => {
    const w = await buildWorld();
    // A new campaign starts at week 1, DAY day 1 (Dawn): a boundary day.
    const start = await w.as("player").query(api.campaigns.timeOfDay, { campaignId: w.campaignId });
    expect(start).toEqual({ phase: "Dawn", light: "dim", canSet: false });
    await w.as("gm").mutation(api.campaignTime.setDay, { campaignId: w.campaignId, cycleDay: 2, idempotencyKey: key() });
    const expected: [cycle: "DAY" | "NIGHT", day: number, phase: string, light: string][] = [
      ["DAY", 1, "Dawn", "dim"],
      ["DAY", 2, "Sunrise", "day"],
      ["DAY", 4, "High Noon", "day"],
      ["DAY", 6, "Sunset", "day"],
      ["DAY", 7, "Nautical Twilight", "dim"],
      ["NIGHT", 1, "Nightfall", "dim"],
      ["NIGHT", 2, "Moonrise", "night"],
      ["NIGHT", 4, "Midnight", "night"],
      ["NIGHT", 6, "Small Hours", "night"],
      ["NIGHT", 7, "Nautical Dawn", "dim"],
    ];
    for (const [cycle, day, phase, light] of expected) {
      expect(await atDay(w, cycle, day), `${cycle} ${day}`).toEqual({ phase, light, canSet: false });
    }
  });

  it("a stored time of day is ignored there (the phase decides)", async () => {
    const w = await buildWorld();
    await w.t.run(async (ctx) => {
      await ctx.db.patch("campaigns", w.campaignId, { timeOfDay: "night" });
    });
    const light = await w.t.run(async (ctx) => campaignLight(ctx, (await ctx.db.get("campaigns", w.campaignId))!));
    expect(light).toEqual({ phase: "Dawn", light: "dim" });
  });
});

describe("sprite sources and thumbnails (dcm-bxp.86, dcm-bxp.97)", () => {
  it("spriteSources returns the pack's extends for a pack setting, null otherwise", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { campaignId, t } = w;
    const { mapId } = await arena(w);
    const gmId = w.users.gm;
    const [forestPack, ownPack] = await t.run(async (ctx) => [
      await ctx.db.insert("spritePacks", { campaignId, name: "Forest extras", extends: "forest", createdBy: gmId, createdAt: 1, updatedAt: 1 }),
      await ctx.db.insert("spritePacks", { campaignId, name: "Own", createdBy: gmId, createdAt: 1, updatedAt: 1 }),
    ]);
    const sources = async (role: "gm" | "player") => (await w.as(role).query(api.combatMapStyle.spriteSources, { campaignId, mapId })).extends;

    await w.as("gm").mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "cave" } });
    expect(await sources("gm")).toBeNull();
    await t.run(async (ctx) => ctx.db.patch("combatMaps", mapId, { setting: { pack: forestPack as Id<"spritePacks"> } }));
    expect(await sources("gm")).toBe("forest");
    expect(await sources("player")).toBe("forest");
    await t.run(async (ctx) => ctx.db.patch("combatMaps", mapId, { setting: { pack: ownPack as Id<"spritePacks"> } }));
    expect(await sources("gm")).toBeNull();
  });

  it("thumbnail returns the map's painted terrain and texture tiles (GM), null for another campaign's map", async () => {
    const w = await buildWorld({ frameId: "beast-feast" });
    const { campaignId, t } = w;
    const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    const map = (await t.run(async (ctx) => ctx.db.get("combatMaps", mapId)))!;
    const terrainCells = [...CELL_UNPAINTED.repeat(map.w * 8)].map((c, i) => (i === 0 ? TERRAIN_CODES[0]! : i === 2 * map.w + 3 ? TERRAIN_CODES[1]! : c)).join("");
    await t.run(async (ctx) => {
      await ctx.db.patch("combatMaps", mapId, { style: "sprites", texturePalette: [{ builtin: "cave/floor" }] });
      await ctx.db.insert("combatMapCells", { mapId, layer: "terrain", tile: 0, cells: terrainCells });
      await ctx.db.insert("combatMapCells", { mapId, layer: "texture", tile: 0, cells: "A" + ".".repeat(map.w * 8 - 1) });
      await ctx.db.insert("combatMapCells", { mapId, layer: "fog", tile: 0, cells: ".".repeat(map.w * 8) });
    });
    const thumb = await w.as("gm").query(api.combatMapStyle.thumbnail, { campaignId, mapId });
    expect(thumb?.tiles.map((x) => x.layer).sort()).toEqual(["terrain", "texture"]);
    expect(thumb?.tiles.find((x) => x.layer === "terrain")?.cells).toBe(terrainCells);
    expect(thumb?.texturePalette).toEqual([{ builtin: "cave/floor" }]);
    expect(thumb?.extends).toBeNull();

    // Another campaign's map (in this world's database): null, as for a deleted map.
    const foreign = await t.run(async (ctx) => {
      const { _id: cid, _creationTime: ct, ...campaign } = (await ctx.db.get("campaigns", campaignId))!;
      void cid;
      void ct;
      const otherCampaign = await ctx.db.insert("campaigns", { ...campaign, name: "Other", nameKey: "other" });
      const { _id, _creationTime, ...rest } = map;
      void _id;
      void _creationTime;
      return ctx.db.insert("combatMaps", { ...rest, campaignId: otherCampaign, live: false });
    });
    expect(await w.as("gm").query(api.combatMapStyle.thumbnail, { campaignId, mapId: foreign })).toBeNull();
    expect(await w.as("gm").query(api.combatMapStyle.thumbnail, { campaignId, mapId: "not-an-id" })).toBeNull();
  });
});
