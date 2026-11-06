/**
 * Rule switches ODR (docs/tasks/TASK-RULES-ODR.md): the optional rule Defined Ranges (CB p.103), on by default.
 *
 * CB p.103, "Optional Rule: Defined Ranges": "If your table would rather operate with more precise range rules, you can
 * use a 1-inch grid battle map during combat ... Melee: 1 square • Very Close: 3 squares • Close: 6 squares • Far: 12
 * squares • Very Far: 13+ squares • Out of Range: Off the battlemap". Without it (same page): "these ranges aren't
 * intended to be precisely measured during play. The suggested estimates are a quick guide for the GM".
 *
 * - On (default): today's checks (an out-of-range target waits for the GM or is refused by the table setting).
 * - Off: no attack, card, feature or rider range check refuses or opens a GM request (the `outOfRange` table setting
 *   has nothing to act on); the target hints mark every target in range; door / light reach and the pure range check
 *   always pass.
 *
 * Fixtures are injected as in out-of-range-refuse.test.ts: a card attack within Far range and a feature attack within
 * Far range.
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { rangeCheck } from "../../src/lib/domain/combat-actions/distance";
import { anyInMelee, inMelee } from "../../src/lib/domain/combat-map/reach";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, handingBack, key } from "./helpers";

const injected = vi.hoisted(() => ({ cards: new Map<string, unknown>(), features: new Map<string, unknown>() }));

vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  return { ...real, cardEffect: (id: string) => (injected.cards.get(id) as CardEffect | undefined) ?? real.cardEffect(id) };
});
vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.features.get(id) as FeatureEffect | undefined) ?? real.featureEffect(id) };
});

const n = (value: number) => ({ kind: "fixed" as const, value });
const ONE_ENEMY = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };
const ABILITY = "deft-maneuvers";
const CARD: CardEffect = {
  cardId: ABILITY,
  uses: [
    {
      id: "strike",
      name: "Strike",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: ONE_ENEMY,
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
  ],
};
const BITE_ID = "subclass:call-of-the-brave:battle-ritual";
const BITE: FeatureEffect = {
  featureId: BITE_ID,
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [
    {
      id: "main",
      name: "Bite",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: ONE_ENEMY,
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
  ],
};
injected.cards.set(CARD.cardId, CARD);
injected.features.set(BITE.featureId, BITE);

/** Hold Them Off (CB p.38): "use that same roll against two additional adversaries within range of the attack." */
const holdThemOff = (tokenIds: Id<"combatTokens">[]) => [{ source: "feature" as const, id: "hope:ranger", choices: [{ id: "picked", value: tokenIds }] }];

/**
 * The world plus a live map: Ash (characterA) at (5, 10) with a Melee weapon, a running encounter. `enemy` adds a bear
 * token; x = 25 is Very Far. `definedRanges` false switches the rule off (between sessions, as the setter requires).
 */
async function arena(opts: { definedRanges?: boolean; outOfRange?: "ask" | "refuse" } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  if (opts.outOfRange === "refuse") await gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "outOfRange", value: "refuse" } });
  if (opts.definedRanges === false) await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "definedRanges", value: false } });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const encounterId = await t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    return ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
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
      return { instanceId, tokenId };
    });
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch });
    });
  const requests = () => t.run(async (ctx) => (await ctx.db.query("combatRequests").collect()).length);
  const attack = (c: Client, targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key(), ...extra });
  const card = (c: Client, targetTokenIds: Id<"combatTokens">[]) =>
    c.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell: "strike", targetTokenIds, choices: [], idempotencyKey: key() });
  const feature = (c: Client, targetTokenIds: Id<"combatTokens">[]) =>
    c.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId: BITE_ID, targetTokenIds, choices: [], idempotencyKey: key() } as never) as Promise<{ status: string }>;
  await edit({ classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", hope: 5, domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as Partial<CharacterSheet>);
  return { w, t, campaignId, mapId, gm, player: handingBack(w.as("player"), gm, w.campaignId), enemy, edit, requests, attack, card, feature };
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("rule switches ODR: Defined Ranges (CB p.103)", () => {
  allowWorldEmails();

  it("is on by default: a player's out-of-range attack still waits for the GM", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 25, 10);
    expect(await a.attack(a.player, [far.tokenId])).toMatchObject({ status: "pending", outOfRange: [{ tokenId: far.tokenId, band: "veryFar" }] });
  });

  it("off: a player's attack on a Very Far target resolves; no GM request opens", async () => {
    const a = await arena({ definedRanges: false });
    const far = await a.enemy("Far", 25, 10);
    expect((await a.attack(a.player, [far.tokenId])).status).toBe("resolved");
    expect(await a.requests()).toBe(0);
  });

  it("off: the GM's attack for the PC resolves too (no sanction for range)", async () => {
    const a = await arena({ definedRanges: false });
    const far = await a.enemy("Far", 25, 10);
    expect((await a.attack(a.gm, [far.tokenId])).status).toBe("resolved");
  });

  it("off: the table's Refuse setting has nothing to act on (attack, card and feature resolve)", async () => {
    const a = await arena({ definedRanges: false, outOfRange: "refuse" });
    const far = await a.enemy("Far", 25, 10);
    expect(await code(a.attack(a.player, [far.tokenId]))).toBe("ok");
    expect((await a.card(a.player, [far.tokenId])).status).toBe("resolved");
    expect((await a.feature(a.player, [far.tokenId])).status).toBe("resolved");
    expect(await a.requests()).toBe(0);
  });

  it("on with Refuse: the same card is refused (the switch is what changes it)", async () => {
    const a = await arena({ outOfRange: "refuse" });
    const far = await a.enemy("Far", 25, 10);
    expect(await code(a.card(a.player, [far.tokenId]))).toBe("COMBAT_TARGET_OUT_OF_RANGE");
  });

  it("off: a card and a feature on a Very Far target resolve with Ask (no pending)", async () => {
    const a = await arena({ definedRanges: false });
    const far = await a.enemy("Far", 25, 10);
    expect((await a.card(a.player, [far.tokenId])).status).toBe("resolved");
    expect((await a.feature(a.player, [far.tokenId])).status).toBe("resolved");
    expect(await a.requests()).toBe(0);
  });

  it("off: Hold Them Off's Very Far extra target neither waits for the GM nor is refused", async () => {
    const a = await arena({ definedRanges: false });
    await a.edit({ classId: "ranger", subclassId: "wayfinder", hope: 5 } as Partial<CharacterSheet>);
    const one = await a.enemy("One", 6, 10);
    const far = await a.enemy("Far", 25, 10);
    const r = await a.attack(a.player, [one.tokenId], { riders: holdThemOff([far.tokenId]) });
    if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
    expect(await a.requests()).toBe(0);
    // Hold Them Off waits for a success (CB p.38); on a hit the far bear is a target.
    if (r.targets[0]!.hit) expect(r.targets.map((x) => x.tokenId)).toEqual([one.tokenId, far.tokenId]);
  });

  it("off: the target hints mark every target in range (on: the Very Far one is out)", async () => {
    for (const definedRanges of [true, false]) {
      const a = await arena({ definedRanges });
      const far = await a.enemy("Far", 25, 10);
      const hints = await a.player.query(api.combatActionsReads.targets, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId });
      const hint = hints.find((h) => h.tokenId === far.tokenId);
      expect(hint).toBeDefined();
      expect(hint!.inRange).toBe(!definedRanges);
    }
  });

  it("pure: rangeCheck and door / light reach pass everything with the rule off, and measure as before with it on", () => {
    expect(rangeCheck({ x: 0, y: 0 }, { x: 30, y: 0 }, "melee")).toEqual({ distance: 30, band: "veryFar", inRange: false });
    expect(rangeCheck({ x: 0, y: 0 }, { x: 30, y: 0 }, "melee", false)).toEqual({ distance: 30, band: "veryFar", inRange: true });
    const door = { kind: "door", x: 8.5, y: 10.5, r: 1 };
    expect(inMelee({ x: 2, y: 10 }, door)).toBe(false);
    expect(inMelee({ x: 2, y: 10 }, door, false)).toBe(true);
    expect(anyInMelee([{ x: 2, y: 10 }], door)).toBe(false);
    expect(anyInMelee([{ x: 2, y: 10 }], door, false)).toBe(true);
    expect(anyInMelee([], door, false)).toBe(false);
  });
});
