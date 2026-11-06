/**
 * Plan lanes-2, tracer E4 (docs/tasks/TASK-LN2-E4.md): walls, see-through darkness, holds and movement limits, damageable
 * and counted areas, areas ending on their caster's events, carried tokens, adversary pcMoves triggers and the public
 * area functions. Fixture entries stand in for the SRD data (wave 9 switches the entries over).
 *
 * Expected values come from the book:
 * - CB p.103 Defined Ranges: Melee 1 square, Very Close 3, Close 6, Far 12.
 * - CB p.336 (Veil of Night): "a temporary curtain of darkness between two points ... Only you can see through this
 *   darkness. You're considered Hidden to adversaries on the other side of the veil."
 * - CB p.337 (Eclipse): "complete darkness only you and your allies can see through".
 * - CB p.230 (Bramble Patch): "must succeed on a Finesse Roll or deal more than 20 damage to the Dryad with an attack to
 *   leave the area".
 * - CB p.216 (Red Ooze, Creeping Fire): "can only move within Very Close range as their normal movement".
 * - CB p.212 (Bladed Guard, Shield Wall): "A creature who tries to move within Very Close range of the Guard".
 * - CB p.339 (Wild Fortress): "damage thresholds 15/30 and lasts until it marks 3 Hit Points".
 * - CB p.339 (Forest Sprites): "small forest sprites who appear at points you choose".
 * - CB p.336 (Hush): "or you take Major damage" (an area ending on its caster's event).
 * - CB p.339 (Hurricane): "Targets can't move against the wind".
 * - CB p.45 (Wings of Light): "carry another willing creature".
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { activeAreasOnMap, endAreasOnCasterEvent, observerConditions, placeAreasFromPlan } from "../../convex/lib/combatAreas";
import { loadScene, preparedFor } from "../../convex/lib/combatVision";
import { lineOfSight } from "../../src/lib/domain/combat-actions/index";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { AreaSpec } from "../../src/lib/domain/card-effects/types";
import { areaHpMarked, carriedTo, moveBreaks, rangesCrossed, reduceRange, seesThrough, wall, wallBetween } from "../../src/lib/domain/feature-effects/areas";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

// ---------------------------------------------------------------- fixtures

const VEIL = "subclass:fixture:veil";
const ECLIPSE = "subclass:fixture:eclipse";
const BRAMBLE = "subclass:fixture:bramble";
const FORT = "subclass:fixture:fort";
const SPRITES = "subclass:fixture:sprites";
const HUSH = "subclass:fixture:hush";
const WIND = "subclass:fixture:wind";

const FIXTURE_AREAS: Record<string, Omit<AreaSpec, "mods"> & { mods?: AreaSpec["mods"] }> = {
  [VEIL]: { label: "Veil of Night", shape: "wall", centre: "point", radius: "melee", side: "all", duration: "scene", blocksSight: true, seeThrough: "owner", ownerPerObserver: "hidden" },
  [ECLIPSE]: { label: "Eclipse", centre: "point", radius: "melee", side: "all", duration: "scene", blocksSight: true, seeThrough: "ownerAndAllies" },
  [BRAMBLE]: { label: "Bramble Patch", centre: "point", radius: "veryClose", side: "enemies", duration: "scene", leave: { trait: "finesse", attack: true } },
  [FORT]: { label: "Wild Fortress", centre: "point", radius: "melee", side: "all", duration: "scene", damageable: { major: 15, severe: 30, hp: 3 } },
  [SPRITES]: { label: "Forest Sprite", centre: "point", radius: "melee", side: "allies", duration: "scene", count: { kind: "fixed", value: 3 } },
  [HUSH]: { label: "Hush", centre: "point", radius: "melee", side: "all", duration: "scene", endsOnCaster: ["majorDamage", "moves"] },
  [WIND]: { label: "Gale", centre: "point", radius: "close", side: "all", duration: "scene", mods: [{ kind: "moveLimit", maxRange: "melee" }] },
};

vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  const entry = (id: string) =>
    FIXTURE_AREAS[id] === undefined ? undefined : { featureId: id, uses: [{ id: "main", name: FIXTURE_AREAS[id]!.label, activation: { kind: "action" }, steps: [{ kind: "area", to: "self", area: FIXTURE_AREAS[id] }] }] };
  return { ...real, featureEffect: (id: string) => (entry(id) as ReturnType<typeof real.featureEffect>) ?? real.featureEffect(id) };
});

// ---------------------------------------------------------------- pure

describe("area rules (areas.ts, round 2)", () => {
  it("a forced move two ranges shorter: Far becomes Very Close, Very Close becomes nothing (Immovable Object, CB p.230)", () => {
    expect(reduceRange("far", 2)).toBe("veryClose");
    expect(reduceRange("veryClose", 2)).toBeNull();
  });

  it("a move limit: beyond Very Close, or against the wind (Creeping Fire, Hurricane)", () => {
    const at = { x: 10, y: 10, size: 1 };
    expect(moveBreaks({ maxRange: "veryClose", label: "Creeping Fire" }, at, { ...at, x: 13 })).toBeNull();
    expect(moveBreaks({ maxRange: "veryClose", label: "Creeping Fire" }, at, { ...at, x: 14 })).toContain("Creeping Fire");
    expect(moveBreaks({ direction: "east", label: "Hurricane" }, at, { ...at, x: 12 })).toBeNull();
    expect(moveBreaks({ direction: "east", label: "Hurricane" }, at, { ...at, x: 8 })).toContain("against the wind");
    expect(moveBreaks({ direction: "north-east", label: "Hurricane" }, at, { ...at, y: 12 })).toContain("against the wind");
  });

  it("a carried token takes the carrier's step and stays on the map", () => {
    expect(carriedTo({ x: 5, y: 5, size: 1 }, { x: 8, y: 4, size: 1 }, { x: 6, y: 5, size: 1 }, { w: 20, h: 20 })).toEqual({ x: 9, y: 4 });
    expect(carriedTo({ x: 5, y: 5, size: 1 }, { x: 19, y: 5, size: 1 }, { x: 6, y: 5, size: 1 }, { w: 20, h: 20 })).toEqual({ x: 19, y: 5 });
  });

  it("the ranges a move came into and went out of (Shield Wall: into Very Close)", () => {
    const guard = { x: 10, y: 10, size: 1 };
    expect(rangesCrossed({ x: 2, y: 10, size: 1 }, { x: 7, y: 10, size: 1 }, guard).into).toEqual(["close", "veryClose"]);
    expect(rangesCrossed({ x: 9, y: 10, size: 1 }, { x: 23, y: 10, size: 1 }, guard).outOf).toEqual(["far", "close", "veryClose", "melee"]);
  });

  it("damage on a damageable area: 1 below Major, 2 from Major, 3 from Severe (Wild Fortress 15/30)", () => {
    expect([areaHpMarked(0, 15, 30), areaHpMarked(14, 15, 30), areaHpMarked(15, 15, 30), areaHpMarked(30, 15, 30)]).toEqual([0, 1, 2, 3]);
  });

  it("see-through and walls between", () => {
    expect(seesThrough("owner", { isOwner: false, isParty: true })).toBe(false);
    expect(seesThrough("ownerAndAllies", { isOwner: false, isParty: true })).toBe(true);
    expect(seesThrough(undefined, { isOwner: true, isParty: true })).toBe(false);
    const w = wall([5, 0], [5, 9]);
    expect(wallBetween(w, { x: 2, y: 4, size: 1 }, { x: 8, y: 4, size: 1 })).toBe(true);
    expect(wallBetween(w, { x: 2, y: 4, size: 1 }, { x: 3, y: 4, size: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------- on the map

/** The world plus a live medium map: Ash (characterA) at (2, 10), Bryn (characterB) at (4, 10), an encounter running. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 4, y: 10, face: Math.PI });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, bryn, encounterId };
  });
  const enemy = (x: number, adversaryId: string, y = 10) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId },
        label: adversaryId,
        order: 0,
        summoned: false,
        stats: { difficulty: 10, major: 5, severe: 10, hpMax: 6, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { tokenId, instanceId };
    });
  /** Places the fixture's area as Ash's (or `characterId`'s) feature use, from the plan's area step. */
  const place = (sourceId: string, points: { x: number; y: number }[], characterId: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const map = (await ctx.db.get("combatMaps", mapId))!;
      const ownerToken = characterId === w.characterA ? await ctx.db.get("combatTokens", ids.ash) : null;
      const spec = FIXTURE_AREAS[sourceId]!;
      const steps = [{ kind: "area", area: { ...spec, mods: spec.mods ?? [] }, centreId: null, targetIds: [] }] as unknown as PlanStep[];
      const [point, ...rest] = points;
      return placeAreasFromPlan(ctx, { campaignId, map, characterId, sourceId, useId: "main", ownerToken, steps, tokenOf: () => null, ...(point ? { point } : {}), points: rest });
    });
  const move = (tokenId: Id<"combatTokens">, x: number, y: number, carry?: string[]) => (tokenId === ids.ash ? player : gm).mutation(api.combatTokens.move, { campaignId, tokenId, x, y, ...(carry ? { carry } : {}) });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const areas = () => t.run((ctx) => activeAreasOnMap(ctx, mapId));
  const token = (id: Id<"combatTokens">) => t.run(async (ctx) => (await ctx.db.get("combatTokens", id))!);
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, place, move, rows, areas, token };
}

describe("live areas, round 2 (combatAreas.ts, combatTokens.move, combatVision.ts)", () => {
  allowWorldEmails();

  it("a wall is stored between its two picked squares; without two it is INVALID", async () => {
    const a = await arena();
    await expect(a.place(VEIL, [{ x: 5, y: 8 }])).rejects.toThrow();
    await a.place(VEIL, [
      { x: 5, y: 8 },
      { x: 5, y: 12 },
    ]);
    expect(await a.areas()).toMatchObject([{ shape: "wall", wall: { a: [5, 8], b: [5, 12] }, blocksSight: true }]);
  });

  it("Veil of Night: only its owner sees through it; the owner is Hidden to adversaries across it", async () => {
    const a = await arena();
    const guard = await a.enemy(8, "bear");
    // Bryn moves to the far side first; Ash (2, 10) on the near side.
    await a.move(a.bryn, 9, 9);
    await a.place(VEIL, [
      { x: 5, y: 6 },
      { x: 5, y: 14 },
    ]);
    const sight = await a.t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", a.campaignId))!;
      const scene = await loadScene(ctx, campaign, (await ctx.db.get("combatMaps", a.mapId))!);
      const at = (id: Id<"combatTokens">) => scene.tokens.find((t) => t._id === id)!;
      const ash = at(a.ash);
      const bryn = at(a.bryn);
      return {
        ash: lineOfSight(preparedFor(scene, a.w.characterA), ash, at(guard.tokenId), scene.visionObjects).lineOfSight,
        bryn: lineOfSight(preparedFor(scene, a.w.characterB), bryn, ash, scene.visionObjects).lineOfSight,
        hidden: observerConditions(await activeAreasOnMap(ctx, a.mapId), scene.tokens, ash, at(guard.tokenId)),
      };
    });
    expect(sight.ash).toBe(true);
    expect(sight.bryn).toBe(false);
    expect(sight.hidden).toEqual([{ label: "Veil of Night", condition: "hidden" }]);
  });

  it("Eclipse: the owner's allies see through it too", async () => {
    const a = await arena();
    await a.place(ECLIPSE, [{ x: 6, y: 10 }]);
    await a.move(a.bryn, 6, 10);
    const sees = await a.t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", a.campaignId))!;
      const scene = await loadScene(ctx, campaign, (await ctx.db.get("combatMaps", a.mapId))!);
      const at = (id: Id<"combatTokens">) => scene.tokens.find((t) => t._id === id)!;
      return {
        plain: lineOfSight(scene.prepared, at(a.ash), at(a.bryn), scene.visionObjects).lineOfSight,
        bryn: lineOfSight(preparedFor(scene, a.w.characterB), at(a.bryn), at(a.ash), scene.visionObjects).lineOfSight,
      };
    });
    expect(sees).toEqual({ plain: false, bryn: true });
  });

  it("Bramble Patch: a player can't move a member out; the GM's drag goes through with a warning", async () => {
    const a = await arena();
    // Enemies-only members, owned by Bryn's player character: Ash is no member, so it is owned by someone else.
    await a.place(BRAMBLE, [{ x: 3, y: 10 }], a.w.characterB);
    // Owner's side is the party, so an enemy is a member; a PC isn't.
    expect(await a.move(a.ash, 3, 11)).not.toHaveProperty("warnings");
    const bear = await a.enemy(4, "bear", 11);
    const out = await a.move(bear.tokenId, 15, 11);
    expect(out.warnings).toEqual(["Bramble Patch: needs a Finesse Roll or an attack to leave Bramble Patch"]);
  });

  it("a member of a moveLimit area: a player's long move is MOVE_BLOCKED; a short one goes", async () => {
    const a = await arena();
    await a.place(WIND, [{ x: 2, y: 10 }]);
    await expect(a.move(a.ash, 8, 10)).rejects.toMatchObject({ data: { code: "MOVE_BLOCKED" } });
    expect(await a.move(a.ash, 3, 10)).toMatchObject({ x: 3, y: 10 });
  });

  it("Creeping Fire: the GM's long drag of the Red Ooze warns", async () => {
    const a = await arena();
    const ooze = await a.enemy(12, "red-ooze");
    expect((await a.move(ooze.tokenId, 20, 10)).warnings?.[0]).toContain("Creeping Fire");
    expect(await a.move(ooze.tokenId, 22, 10)).not.toHaveProperty("warnings");
  });

  it("Shield Wall: a PC moving within Very Close range of a Bladed Guard sets it off (GM feed row)", async () => {
    const a = await arena();
    const guard = await a.enemy(12, "bladed-guard");
    expect(await a.move(a.ash, 6, 10)).not.toHaveProperty("triggers");
    const out = await a.move(a.ash, 9, 10);
    expect(out.triggers).toEqual([{ instanceId: guard.instanceId, feature: "Shield Wall", useId: "main", stage: "did" }]);
    expect((await a.rows()).find((r) => r.summary.includes("Shield Wall"))).toMatchObject({ visibility: "gm", kind: "adversary" });
  });

  it("Forest Sprites: one area per picked square; using it again ends the old ones", async () => {
    const a = await arena();
    await a.place(SPRITES, [
      { x: 3, y: 8 },
      { x: 4, y: 8 },
      { x: 5, y: 8 },
    ]);
    expect(await a.areas()).toHaveLength(3);
    await a.place(SPRITES, [{ x: 6, y: 8 }]);
    expect((await a.areas()).map((r) => r.centre)).toEqual([{ kind: "square", x: 6, y: 8 }]);
  });

  it("Hush: the caster's event ends it; another event or caster doesn't", async () => {
    const a = await arena();
    await a.place(HUSH, [{ x: 3, y: 10 }]);
    expect(await a.t.run((ctx) => endAreasOnCasterEvent(ctx, a.campaignId, a.w.characterB, "majorDamage"))).toEqual([]);
    expect(await a.t.run((ctx) => endAreasOnCasterEvent(ctx, a.campaignId, a.w.characterA, "takeSevere"))).toEqual([]);
    expect(await a.t.run((ctx) => endAreasOnCasterEvent(ctx, a.campaignId, a.w.characterA, "majorDamage"))).toEqual(["Hush"]);
    await a.place(HUSH, [{ x: 3, y: 10 }]);
    await a.move(a.ash, 2, 11);
    expect(await a.areas()).toEqual([]);
  });

  it("Wings of Light: the carrier takes a willing creature along; one out of Melee range is refused", async () => {
    const a = await arena();
    await a.move(a.bryn, 3, 10);
    const out = await a.move(a.ash, 2, 5, [a.bryn]);
    expect(out.carried).toEqual([{ tokenId: a.bryn, x: 3, y: 5 }]);
    expect(await a.token(a.bryn)).toMatchObject({ x: 3, y: 5 });
    const bear = await a.enemy(20, "bear");
    await expect(a.move(a.ash, 2, 4, [bear.tokenId])).rejects.toMatchObject({ data: { code: "COMBAT_TARGET_INVALID" } });
  });

  it("public: list (players: live map), damage (GM) and remove (the caster's player)", async () => {
    const a = await arena();
    const [fort] = await a.place(FORT, [{ x: 3, y: 10 }]);
    const listed = await a.player.query(api.combatAreas.list, { campaignId: a.campaignId, mapId: a.mapId });
    expect(listed).toMatchObject([{ _id: fort, label: "Wild Fortress", damage: { hp: 0, hpMax: 3 } }]);
    await expect(a.player.mutation(api.combatAreas.damage, { campaignId: a.campaignId, areaId: fort!, amount: 20 })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(await a.gm.mutation(api.combatAreas.damage, { campaignId: a.campaignId, areaId: fort!, amount: 20 })).toEqual({ marked: 2, hp: 2, ended: false });
    expect(await a.gm.mutation(api.combatAreas.damage, { campaignId: a.campaignId, areaId: fort!, amount: 5 })).toEqual({ marked: 1, hp: 3, ended: true });
    expect(await a.areas()).toEqual([]);
    const [hush] = await a.place(HUSH, [{ x: 3, y: 10 }]);
    await a.player.mutation(api.combatAreas.remove, { campaignId: a.campaignId, areaId: hush! });
    expect(await a.areas()).toEqual([]);
  });
});
