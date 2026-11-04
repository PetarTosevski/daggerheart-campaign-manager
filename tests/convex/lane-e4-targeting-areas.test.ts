/**
 * Plan lanes, tracer E4 (docs/tasks/TASK-LN-E4.md): targeting, range origins, live map areas and map positions. Fixture
 * entries stand in for the SRD data (wave 5 switches the entries over to the widened vocabulary).
 *
 * Expected values come from the book and the user's answers:
 * - CB p.103 Defined Ranges: Melee 1 square, Very Close 3, Close 6, Far 12.
 * - CB p.333-334 (Shared Clarity, Transcendent Union): "choose two willing creatures" (dcm-d7h: at least 2 targets).
 * - CB p.30 (Elemental Incarnation, Water): "all other adversaries within Very Close range" (dcm-ssf: not the trigger's).
 * - CB p.239 (Fearsome Presence): "PCs can't spend Hope to use features against the Zombie" (dcm-zos).
 * - CB p.328 (Chain Lightning): "within Close range of previous targets" (dcm-dgu: a chain measures from the earlier links).
 * - CB p.332 (Rune Circle): "who enter Melee range"; HF p.16 (Circle of Power): "lasts until ... you exit the circle".
 * - CB p.42 (Dark Cloud): "Anyone in this cloud can't see outside of it, and anyone outside of it can't see in."
 * - CB p.331 (Signature Move): "roll a d20 as your Hope Die. On a success, clear a Stress" (dcm-jx6: one rider whose
 *   success step waits for the host roll).
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { activeAreasOnMap, areaFactsFor, placeArea } from "../../convex/combatAreas";
import { buildRun, paysHope, rangeOrigin, riderUse, targetMin, type Creature } from "../../convex/lib/cardRunner";
import { parseChoices } from "../../convex/lib/cardChoices";
import { attackScene } from "../../convex/lib/combatActions";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { loadScene } from "../../convex/lib/combatVision";
import type { CardEffect, CardUse, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { lineOfSight } from "../../src/lib/domain/combat-actions/index";
import { areaExpires, blocksBetween, circle, inArea, memberSideFits, moveEvents, placementHolds, wall } from "../../src/lib/domain/feature-effects/areas";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

// ---------------------------------------------------------------- fixtures (no SRD entry uses these pieces yet)

const RUNE = "subclass:fixture:rune-circle";
const CIRCLE = "subclass:fixture:circle";

vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  const fixtures: Record<string, unknown> = {
    "subclass:fixture:rune-circle": {
      featureId: "subclass:fixture:rune-circle",
      uses: [
        {
          id: "main",
          name: "Rune Circle",
          activation: { kind: "action" },
          steps: [{ kind: "area", to: "self", area: { label: "Rune Circle", centre: "point", radius: "melee", side: "all", duration: "scene", placeWithin: "close", onEnter: [{ kind: "manual", to: "triggerSubject", text: "2d12+4 magic damage" }] } }],
        },
      ],
    },
    "subclass:fixture:circle": {
      featureId: "subclass:fixture:circle",
      uses: [{ id: "main", name: "Circle", activation: { kind: "action" }, steps: [{ kind: "area", to: "self", area: { label: "Circle", centre: "point", radius: "veryClose", side: "selfAndAllies", duration: "manual", endsOn: ["ownerLeavesArea"] } }] }],
    },
  };
  return { ...real, featureEffect: (id: string) => (fixtures[id] as ReturnType<typeof real.featureEffect>) ?? real.featureEffect(id) };
});

vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  // Hold the Line (CB p.342) written with the widened trigger.
  const hold = { cardId: "hold-the-line", uses: [{ id: "pull", name: "Hold the Line", activation: { kind: "reaction", trigger: { kind: "whenEnemyEntersRange", range: "veryClose" } }, steps: [] }] };
  return { ...real, cardEffect: (id: string) => (id === "hold-the-line" ? (hold as ReturnType<typeof real.cardEffect>) : real.cardEffect(id)) };
});

vi.mock("../../src/lib/srd/adversary-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/adversary-effects/index")>();
  // The fixture: a "zombie" stat block with Fearsome Presence written as the widened modifier.
  const zombie = [{ adversaryId: "fixture-zombie", feature: "Fearsome Presence", uses: [{ id: "main", name: "Fearsome Presence", activation: { kind: "passive" }, modifiers: [{ kind: "mod", mod: { kind: "flag", flag: "noHopeFeaturesAgainst" } }], steps: [] }] }];
  return { ...real, adversaryEffects: (id: string) => (id === "fixture-zombie" ? zombie : real.adversaryEffects(id)) as ReturnType<typeof real.adversaryEffects> };
});

const use = (u: Partial<CardUse> & Pick<CardUse, "steps">): CardUse => ({ id: "main", name: "Fixture", activation: { kind: "action" }, ...u }) as CardUse;
const effect = (u: CardUse): CardEffect => ({ cardId: "fixture", uses: [u] }) as CardEffect;

// ---------------------------------------------------------------- pure geometry

describe("area geometry (areas.ts)", () => {
  it("a footprint within the radius of the centre is inside (CB p.103: Very Close is 3 squares)", () => {
    const area = circle({ x: 10, y: 10 }, "veryClose");
    expect(inArea({ x: 13, y: 10 }, area)).toBe(true);
    expect(inArea({ x: 14, y: 10 }, area)).toBe(false);
    // A 2-square centre covers x 10-11: a 2-square token at x 12 is 1 square away (Melee), at x 13 two.
    expect(inArea({ x: 13, y: 10, size: 2 }, circle({ x: 10, y: 10, size: 2 }, "melee"))).toBe(false);
    expect(inArea({ x: 12, y: 10, size: 2 }, circle({ x: 10, y: 10, size: 2 }, "melee"))).toBe(true);
  });

  it("a move enters, leaves, passes through a circle and crosses a wall", () => {
    const area = circle({ x: 10, y: 10 }, "melee");
    expect(moveEvents({ x: 2, y: 10 }, { x: 9, y: 10 }, [area])).toEqual([{ index: 0, kind: "enter" }]);
    expect(moveEvents({ x: 10, y: 10 }, { x: 2, y: 10 }, [area])).toEqual([{ index: 0, kind: "leave" }]);
    expect(moveEvents({ x: 2, y: 10 }, { x: 18, y: 10 }, [area])).toEqual([{ index: 0, kind: "through" }]);
    expect(moveEvents({ x: 2, y: 2 }, { x: 4, y: 2 }, [area])).toEqual([]);
    const w = wall([5, 0], [5, 9]);
    expect(moveEvents({ x: 2, y: 4 }, { x: 8, y: 4 }, [w])).toEqual([{ index: 0, kind: "cross" }]);
    expect(moveEvents({ x: 2, y: 12 }, { x: 8, y: 12 }, [w])).toEqual([]);
  });

  it("members follow the area's side; the owner only with selfAndAllies / all, never with excludeOwner", () => {
    expect(memberSideFits({ side: "allies" }, "pc", "pc", false)).toBe(true);
    expect(memberSideFits({ side: "allies" }, "pc", "ally", false)).toBe(true);
    expect(memberSideFits({ side: "allies" }, "pc", "pc", true)).toBe(false);
    expect(memberSideFits({ side: "enemies" }, "pc", "enemy", false)).toBe(true);
    expect(memberSideFits({ side: "enemies" }, "pc", "neutral", false)).toBe(false);
    expect(memberSideFits({ side: "selfAndAllies" }, "pc", "pc", true)).toBe(true);
    expect(memberSideFits({ side: "all", excludeOwner: true }, "enemy", "enemy", true)).toBe(false);
  });

  it("placeWithin, sight between inside and outside, and the stored end", () => {
    expect(placementHolds({ placeWithin: "close" }, { x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
    expect(placementHolds({ placeWithin: "close" }, { x: 0, y: 0 }, { x: 7, y: 0 })).toBe(false);
    const cloud = circle({ x: 10, y: 10 }, "veryClose");
    expect(blocksBetween(cloud, { x: 11, y: 10 }, { x: 20, y: 10 })).toBe(true);
    expect(blocksBetween(cloud, { x: 11, y: 10 }, { x: 9, y: 10 })).toBe(false);
    expect([areaExpires("scene"), areaExpires("temporary"), areaExpires("longRest")]).toEqual(["scene", "manual", "longRest"]);
  });
});

// ---------------------------------------------------------------- pure runner helpers

describe("targeting helpers (cardRunner.ts)", () => {
  it("a TargetCount minimum (dcm-d7h) and a Hope cost anywhere in the use (dcm-zos)", () => {
    expect(targetMin({ side: "ally", range: "close", count: { kind: "upTo", n: { kind: "fixed", value: 2 }, min: 2 } })).toBe(2);
    expect(targetMin({ side: "ally", range: "close", count: { kind: "any", min: 2 } })).toBe(2);
    expect(targetMin({ side: "ally", range: "close", count: { kind: "one" } })).toBeUndefined();
    expect(paysHope(use({ costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }], steps: [] }))).toBe(true);
    expect(paysHope(use({ steps: [{ kind: "optional", id: "x", label: "x", costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }], steps: [] }] as CardUse["steps"] }))).toBe(true);
    expect(paysHope(use({ costs: [{ kind: "stress", amount: { kind: "fixed", value: 1 } }], steps: [] }))).toBe(false);
  });

  it("origin target / chain measures from the earlier creatures, not the actor (dcm-dgu)", () => {
    const token = (id: string, x: number) => ({ _id: id, x, y: 0, size: 1 }) as unknown as Doc<"combatTokens">;
    const creature = (id: string, x: number) => ({ kind: "pc", tokenId: id, token: token(id, x) }) as unknown as Creature;
    const scene = { attacker: token("actor", 0) } as unknown as Parameters<typeof rangeOrigin>[0];
    const spec: TargetSpec = { side: "enemy", range: "close", count: { kind: "any" }, origin: "chain" };
    // 20 squares from the actor (Very Far) but 5 from the first link (Close).
    expect(rangeOrigin(scene, spec, "close", [creature("a", 15)], creature("b", 20))).toEqual({ inRange: true, band: "close" });
    expect(rangeOrigin(scene, { ...spec, origin: undefined }, "close", [creature("a", 15)], creature("b", 20))?.inRange).toBe(false);
    expect(rangeOrigin(scene, { ...spec, origin: "target" }, "close", [creature("a", 15)], creature("b", 20))?.inRange).toBe(true);
  });

  it("one rider: the d20 before the roll, the Stress clear only on a success of that roll (dcm-jx6)", () => {
    const rider = use({
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
      limit: { per: "rest" },
      steps: [
        { kind: "modifyRoll", to: "self", change: { kind: "hopeDie", sides: 20 } },
        { kind: "clear", to: "self", track: "stress", amount: { kind: "fixed", value: 1 }, when: ["success"] },
      ] as CardUse["steps"],
    });
    expect(riderUse(rider, "pre", true, null).steps.map((s) => s.kind)).toEqual(["modifyRoll"]);
    const hit = { success: true, critical: false, withHope: true, withFear: false };
    expect(riderUse(rider, "post", true, hit).steps).toEqual([{ kind: "clear", to: "self", track: "stress", amount: { kind: "fixed", value: 1 } }]);
    expect(riderUse(rider, "post", true, { ...hit, success: false }).steps).toEqual([]);
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
  const enemy = (x: number, adversaryId = "bear") =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId },
        label: adversaryId === "bear" ? "Bear" : "Zombie",
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
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y: 10, face: Math.PI });
    });
  const place = (sourceId: string, label: string, x: number, y: number, extra: { blocksSight?: boolean; radius?: "melee" | "veryClose" | "close"; characterId?: Id<"characters"> } = {}) =>
    t.run(async (ctx) => {
      const map = (await ctx.db.get("combatMaps", mapId))!;
      const owner = await ctx.db.get("combatTokens", ids.ash);
      const spec = { label, centre: "point" as const, radius: extra.radius ?? "melee", side: "all" as const, duration: "scene" as const, placeWithin: "close" as const, ...(extra.blocksSight ? { blocksSight: true } : {}) };
      return placeArea(ctx, { campaignId, map, characterId: extra.characterId ?? w.characterA, sourceId, useId: "main", spec, centre: { kind: "square", x, y }, ownerToken: owner });
    });
  const move = (tokenId: Id<"combatTokens">, x: number, y: number) => (tokenId === ids.ash ? player : gm).mutation(api.combatTokens.move, { campaignId, tokenId, x, y });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const areas = () => t.run((ctx) => activeAreasOnMap(ctx, mapId));
  /** buildRun with the real scene for Ash's fixture use. */
  const build = (u: CardUse, targetTokenIds: string[], choices = parseChoices([])) =>
    t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      const character = (await ctx.db.get("characters", w.characterA))!;
      const scene = await attackScene(ctx, campaign, character, mapId);
      const sheet = readSheet(character.sheet);
      const built = await buildRun(ctx, { campaign, character, sheet: { ...sheet, hope: 6 }, scene, pick: { effect: effect(u), use: u, name: "Fixture", limitKey: "fixture" }, targetTokenIds, choices, roll: {}, gmFear: 0, lastRollWithHope: false });
      return { facts: built.context.actor.facts ?? null, targets: built.targets.map((c) => c.tokenId as string), outOfRange: built.outOfRange };
    });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, place, move, rows, areas, build };
}

describe("live areas on the map (combatAreas.ts, combatTokens.move)", () => {
  allowWorldEmails();

  it("placing checks placeWithin and replaces the caster's old area of the same feature", async () => {
    const a = await arena();
    await expect(a.place(RUNE, "Rune Circle", 20, 10)).rejects.toThrow();
    await a.place(RUNE, "Rune Circle", 6, 10);
    await a.place(RUNE, "Rune Circle", 7, 10);
    const live = await a.areas();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ label: "Rune Circle", centre: { kind: "square", x: 7, y: 10 }, radius: "melee", expires: "scene", status: "active" });
  });

  it("a token entering an onEnter area gets a public feed row; one that stays clear gets none (Rune Circle)", async () => {
    const a = await arena();
    await a.place(RUNE, "Rune Circle", 8, 10);
    const out = await a.move(a.bryn, 7, 10);
    expect(out.areas).toEqual([{ label: "Rune Circle", event: "enter", ended: false }]);
    expect((await a.rows()).find((r) => r.summary === "Bryn enters Rune Circle")).toMatchObject({ visibility: "public", kind: "combat" });
    const clear = await a.move(a.bryn, 7, 2);
    expect(clear.areas).toBeUndefined();
  });

  it("the caster leaving an ownerLeavesArea circle ends it (Circle of Power)", async () => {
    const a = await arena();
    await a.place(CIRCLE, "Circle", 2, 10, { radius: "veryClose" });
    expect(await a.move(a.ash, 4, 10)).not.toHaveProperty("areas");
    const out = await a.move(a.ash, 12, 10);
    expect(out.areas).toEqual([{ label: "Circle", event: "leave", ended: true }]);
    expect(await a.areas()).toEqual([]);
  });

  it("an enemy moving within Very Close of a Hold the Line holder is named in the feed (dcm-bpr)", async () => {
    const a = await arena();
    await a.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", a.w.characterA))!.sheet);
      await saveSheet(ctx, a.w.characterA, { ...s, domainCards: { ...s.domainCards, owned: [...s.domainCards.owned, "hold-the-line"], loadout: [...s.domainCards.loadout, "hold-the-line"] } });
    });
    const bear = await a.enemy(12);
    await a.move(bear, 8, 10);
    expect((await a.rows()).some((r) => r.summary.includes("Hold the Line"))).toBe(false);
    await a.move(bear, 5, 10);
    expect((await a.rows()).filter((r) => r.summary === "Bear moves within range of Ash: Hold the Line")).toHaveLength(1);
  });

  it("the actor's areas reach the runner's facts at the roll (inArea)", async () => {
    const a = await arena();
    await a.place(CIRCLE, "Circle", 3, 10, { radius: "veryClose" });
    const { facts } = await a.build(use({ steps: [] }), []);
    expect(facts?.areas).toEqual([{ featureId: CIRCLE, own: true }]);
    const facts2 = await a.t.run(async (ctx) => {
      const tokens = await ctx.db.query("combatTokens").collect();
      const far = { ...tokens.find((t) => t._id === a.ash)!, x: 20 };
      return areaFactsFor(await activeAreasOnMap(ctx, a.mapId), tokens, far, a.w.characterA);
    });
    expect(facts2).toEqual([]);
  });

  it("a sight-blocking area blocks the line between inside and outside (Dark Cloud)", async () => {
    const a = await arena();
    const sees = () =>
      a.t.run(async (ctx) => {
        const campaign = (await ctx.db.get("campaigns", a.campaignId))!;
        const scene = await loadScene(ctx, campaign, (await ctx.db.get("combatMaps", a.mapId))!);
        const at = (id: Id<"combatTokens">) => scene.tokens.find((t) => t._id === id)!;
        return lineOfSight(scene.prepared, at(a.ash), at(a.bryn), scene.visionObjects).lineOfSight;
      });
    expect(await sees()).toBe(true);
    await a.place("subclass:nightwalker:dark-cloud", "Dark Cloud", 6, 10, { blocksSight: true, radius: "melee" });
    // Ash (2, 10) outside, Bryn moved into the cloud at (6, 10).
    await a.move(a.bryn, 6, 10);
    expect(await sees()).toBe(false);
  });
});

describe("target rules in buildRun (cardRunner.ts)", () => {
  allowWorldEmails();

  it("refuses fewer targets than the count's minimum (dcm-d7h)", async () => {
    const a = await arena();
    const u = use({ targets: { side: "ally", range: "close", count: { kind: "upTo", n: { kind: "fixed", value: 2 }, min: 2 }, willing: true }, steps: [] });
    await expect(a.build(u, [a.bryn])).rejects.toThrow(/at least 2/);
  });

  it("leaves the trigger's creature out of 'all other' targets (dcm-ssf)", async () => {
    const a = await arena();
    const e1 = await a.enemy(5);
    const e2 = await a.enemy(6);
    const u = use({ targets: { side: "enemy", range: "veryClose", count: { kind: "any" }, excludeSubject: true }, steps: [] });
    const subject = parseChoices([{ id: "triggerSubject", value: e1 }]);
    await expect(a.build(u, [e1, e2], subject)).rejects.toThrow(/set this off/);
    expect((await a.build(u, [e2], subject)).targets).toEqual([e2]);
  });

  it("refuses a Hope-cost use against an adversary with noHopeFeaturesAgainst; a Stress cost goes through (dcm-zos)", async () => {
    const a = await arena();
    const zombie = await a.enemy(5, "fixture-zombie");
    const target: TargetSpec = { side: "enemy", range: "close", count: { kind: "one" } };
    await expect(a.build(use({ targets: target, costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }], steps: [] }), [zombie])).rejects.toThrow(/can't spend Hope/);
    expect((await a.build(use({ targets: target, costs: [{ kind: "stress", amount: { kind: "fixed", value: 1 } }], steps: [] }), [zombie])).targets).toEqual([zombie]);
  });

  it("a chain origin measures each next target from the earlier ones (dcm-dgu)", async () => {
    const a = await arena();
    const near = await a.enemy(7);
    const far = await a.enemy(12);
    const spec: TargetSpec = { side: "enemy", range: "close", count: { kind: "any" } };
    // 10 squares from Ash: outside Close from the actor, 5 from the first link.
    expect((await a.build(use({ targets: spec, steps: [] }), [near, far])).outOfRange.map((o) => o.tokenId)).toEqual([far]);
    expect((await a.build(use({ targets: { ...spec, origin: "chain" }, steps: [] }), [near, far])).outOfRange).toEqual([]);
  });
});
