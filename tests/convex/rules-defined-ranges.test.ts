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
 *
 * ODR2 (docs/tasks/TASK-RULES-ODR2.md; user 2026-11-06): with the rule off, automatic effects that pick creatures by
 * range don't apply and the GM gets one GM-only note asking who is in range ("all targets within Close range" with
 * none named, Hold the Line's pull); the server's remaining square counts (Blink Beast's duplicate, carried creatures)
 * stop counting.
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { placeDuplicate } from "../../convex/combatTokens";
import { pcRollAdversaryUses, rangeGatedUses } from "../../convex/lib/adversaryActions";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { autoPicked, autoPickRange, sneakAttackApplies, sneakAttackAsk } from "../../convex/lib/combatActions";
import { targetLabel } from "../../src/components/combat-map/drawer/use/model";
import { chainRows } from "../../src/components/combat-map/hud/pick-area/chain";
import { bandsFrom, conflictRows, forcedRows } from "../../src/components/combat-map/hud/pick-attack/model";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects/index";
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
    {
      // ODR2: "all targets within Close range" with none named (CB p.104).
      id: "burst",
      name: "Burst",
      activation: { kind: "action" },
      targets: { side: "enemy", range: "close", count: { kind: "all" } },
      steps: [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "vulnerable" }, duration: "manual" }],
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
  if (opts.outOfRange === "refuse") await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "outOfRange", value: "refuse" } });
  if (opts.definedRanges === false) await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "definedRanges", value: false } });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const encounterId = await t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    return ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number, adversaryId = "bear") =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
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
  const player = handingBack(w.as("player"), gm, w.campaignId);
  const useCard = (c: Client, cardId: string, spell: string | undefined, targetTokenIds: Id<"combatTokens">[] = []) =>
    c.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId, ...(spell !== undefined ? { spell } : {}), targetTokenIds, choices: [], idempotencyKey: key() } as never) as Promise<{ status: string; targets?: { tokenId: string }[] }>;
  const notes = () => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((r) => r.kind === "rule" && r.ruleId === "definedRanges").map((r) => ({ summary: r.summary, visibility: r.visibility })));
  const conditionsOf = (instanceId: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", instanceId))!.conditions);
  const tokenAt = (tokenId: Id<"combatTokens">) => t.run(async (ctx) => (await ctx.db.get("combatTokens", tokenId))!);
  const ash = await t.run(async (ctx) => (await ctx.db.query("combatTokens").collect()).find((x) => x.ref.kind === "pc")!._id);
  return { w, t, campaignId, mapId, gm, player, enemy, edit, requests, attack, card, feature, useCard, notes, conditionsOf, tokenAt, ash };
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

  it("ODR2 on: 'all targets within Close range' with none named takes the bears in Close range, no note", async () => {
    const a = await arena();
    const near = await a.enemy("Near", 8, 10);
    await a.enemy("Far", 25, 10);
    const r = await a.useCard(a.player, ABILITY, "burst");
    expect(r.status).toBe("resolved");
    expect(await a.conditionsOf(near.instanceId)).toContain("vulnerable");
    expect(await a.notes()).toEqual([]);
  });

  it("ODR2 off: the automatic pick doesn't apply; one GM-only note (named after the card) asks who is within Close range", async () => {
    const a = await arena({ definedRanges: false });
    const near = await a.enemy("Near", 8, 10);
    const r = await a.useCard(a.player, ABILITY, "burst");
    expect(r.status).toBe("resolved");
    expect(await a.conditionsOf(near.instanceId)).not.toContain("vulnerable");
    expect(await a.notes()).toEqual([{ summary: "Deft Maneuvers: who is within Close range?", visibility: "gm" }]);
    // Named by the player, the target is affected (nobody counts squares).
    await a.useCard(a.player, ABILITY, "burst", [near.tokenId]);
    expect(await a.conditionsOf(near.instanceId)).toContain("vulnerable");
  });

  it("ODR2 off: Hold the Line doesn't pull an adversary that moves in; the GM is asked instead", async () => {
    for (const definedRanges of [true, false]) {
      const a = await arena({ definedRanges });
      const bear = await a.enemy("Bear", 14, 10);
      await a.edit({ domainCards: { owned: ["hold-the-line"], loadout: ["hold-the-line"] }, hope: 4 } as Partial<CharacterSheet>);
      expect((await a.useCard(a.player, "hold-the-line", undefined)).status).toBe("resolved");
      await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: bear.tokenId, x: 7, y: 10 });
      if (definedRanges) {
        expect(await a.conditionsOf(bear.instanceId)).toContain("restrained");
        expect(await a.notes()).toEqual([]);
      } else {
        expect(await a.conditionsOf(bear.instanceId)).not.toContain("restrained");
        expect(await a.tokenAt(bear.tokenId)).toMatchObject({ x: 7, y: 10 });
        const [note] = await a.notes();
        expect(note).toMatchObject({ visibility: "gm" });
        expect(note!.summary).toMatch(/^Hold the Line.*: did Bear move within Very Close range of /);
      }
    }
  });

  it("ODR2 off: Blink Beast's duplicate may appear past Close range (on: refused)", async () => {
    for (const definedRanges of [true, false]) {
      const a = await arena({ definedRanges });
      const beast = await a.enemy("Beast", 6, 10);
      const original = await a.tokenAt(beast.tokenId);
      const out = await code(a.t.run((ctx) => placeDuplicate(ctx, { original, x: 25, y: 10 })));
      expect(out).toBe(definedRanges ? "COMBAT_TARGET_INVALID" : "ok");
    }
  });

  it("ODR2 off: the GM carries a creature that stands beyond Melee (on: refused)", async () => {
    for (const definedRanges of [true, false]) {
      const a = await arena({ definedRanges });
      const bear = await a.enemy("Bear", 12, 10);
      const out = await code(a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.ash, x: 6, y: 10, carry: [bear.tokenId] }));
      expect(out).toBe(definedRanges ? "COMBAT_TARGET_INVALID" : "ok");
    }
  });
});

/**
 * ODR3 (docs/tasks/TASK-RULES-ODR3.md; user 2026-11-06 on dcm-bxp.134): the last range spots. With the rule off an
 * adversary's range-gated trigger (Ill Omen, HF p.95: "When a PC within Close range makes an action roll") neither runs
 * nor is offered and the GM is asked; Sneak Attack's "an ally is within Melee range of your target" (CB p.42) is the
 * player's tick plus a GM question; an automatic "all ... within" pick (Elemental Incarnation, CB p.30) names no one; the
 * client rows and labels show no band.
 */
describe("rule switches ODR3: the last Defined Ranges spots", () => {
  allowWorldEmails();

  const illOmenRoll = { kind: "action" as const, hope: 5, fear: 7, total: 12, withHope: false, critical: false };

  it("on: Ill Omen runs on a PC's action roll; off: it doesn't, and one GM-only note in the roll's group asks who is in range", async () => {
    for (const definedRanges of [true, false]) {
      const a = await arena({ definedRanges });
      await a.enemy("Owl Witch", 7, 10, "owl-witch");
      const campaign = (await a.t.run((ctx) => ctx.db.get("campaigns", a.campaignId)))!;
      const out = await a.t.run((ctx) => pcRollAdversaryUses(ctx, campaign, { characterId: a.w.characterA, roll: illOmenRoll as never, groupId: "g-odr3", actorId: a.w.users.player }));
      if (definedRanges) {
        expect(out.lines.some((l) => l.includes("Ill Omen"))).toBe(true);
        expect(out.rangeAsks).toBeUndefined();
        expect(await a.notes()).toEqual([]);
      } else {
        expect(out.lines).toEqual([]);
        expect(out.bonuses).toEqual([]);
        expect(out.rangeAsks).toEqual(["Ill Omen (Owl Witch): who is within Close range?"]);
        expect(await a.notes()).toEqual([{ summary: "Ill Omen (Owl Witch): who is within Close range?", visibility: "gm" }]);
        const note = (await a.t.run((ctx) => ctx.db.query("actionLog").collect())).find((r) => r.kind === "rule")!;
        expect([note.groupId, note.undoable]).toEqual(["g-odr3", true]);
      }
    }
  });

  it("off: a weapon attack near an Owl Witch posts the Ill Omen question in the attack's group", async () => {
    const a = await arena({ definedRanges: false });
    const bear = await a.enemy("Bear", 6, 10);
    await a.enemy("Owl Witch", 8, 10, "owl-witch");
    const r = await a.attack(a.player, [bear.tokenId]);
    if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
    const rows = await a.t.run((ctx) => ctx.db.query("actionLog").collect());
    const note = rows.find((x) => x.kind === "rule" && x.ruleId === "definedRanges" && x.summary.startsWith("Ill Omen"));
    expect(note).toMatchObject({ visibility: "gm", groupId: rows.find((x) => x._id === r.entryId)!.groupId });
  });

  it("off: Sneak Attack is the player's tick; without it the GM is asked (on: the map decides, no question)", async () => {
    const a = await arena({ definedRanges: false });
    await a.edit({ classId: "rogue", subclassId: "nightwalker" } as Partial<CharacterSheet>);
    const bear = await a.enemy("Bear", 6, 10);
    const plain = await a.attack(a.player, [bear.tokenId]);
    if (plain.status !== "resolved") throw new Error(`expected resolved, got ${plain.status}`);
    expect(plain.riders ?? []).not.toContain("Sneak Attack");
    expect((await a.notes()).map((n) => n.summary)).toContain(sneakAttackAsk("Ash", ["Bear"]));
    const ticked = await a.attack(a.player, [bear.tokenId], { damageOptions: ["sneakAttack"] });
    if (ticked.status !== "resolved") throw new Error(`expected resolved, got ${ticked.status}`);
    expect(ticked.riders).toContain("Sneak Attack");
    expect((await a.notes()).filter((n) => n.summary.startsWith("Sneak Attack"))).toHaveLength(1);
  });

  it("pure: rangeGatedUses keeps the ungated uses and asks for the gated ones only while off", () => {
    const illOmen = adversaryEffects("owl-witch").find((e) => e.feature === "Ill Omen")!;
    const uses = [{ effect: illOmen, use: illOmen.uses[0]!, mode: "auto" as const }];
    expect(rangeGatedUses(uses, true, "Owl Witch")).toEqual({ uses, asks: [] });
    expect(rangeGatedUses(uses, false, "Owl Witch")).toEqual({ uses: [], asks: ["Ill Omen (Owl Witch): who is within Close range?"] });
  });

  it("pure: autoPicked names no one off (Elemental Incarnation's 'all other adversaries within Very Close'); Sneak Attack's map half is unknown", async () => {
    const spec = { side: "enemy" as const, range: "veryClose" as const, count: { kind: "all" as const }, excludeSubject: true };
    const scene = { definedRanges: false, scene: { tokens: [] }, viewer: { index: 0 } } as never;
    expect(await autoPicked({ scene, host: { weaponRange: "melee" } } as never, spec, undefined)).toEqual([]);
    expect(autoPickRange({ weaponRange: "melee" }, spec)).toBe("veryClose");
    expect(autoPickRange({ weaponRange: "far" }, { ...spec, range: "weapon" })).toBe("far");
    expect(autoPickRange({ weaponRange: null }, { ...spec, range: "unlimited" })).toBeNull();
    expect(autoPickRange({ weaponRange: null }, { ...spec, count: { kind: "one" } })).toBeNull();
    const sheet = { conditions: [] } as unknown as CharacterSheet;
    expect(sneakAttackApplies(sheet, scene, [])).toBeNull();
    expect(sneakAttackApplies({ conditions: ["cloaked"] } as unknown as CharacterSheet, scene, [])).toBe(true);
  });

  it("client: no band in chain rows, the Charge label, the attack picker's PC rows, forced rows and Minion bands while off", () => {
    const creatures = [
      { tokenId: "a" as Id<"combatTokens">, name: "Imp", side: "enemy" as const, at: { x: 0, y: 0 } },
      { tokenId: "b" as Id<"combatTokens">, name: "Bat", side: "enemy" as const, at: { x: 9, y: 0 } },
    ];
    expect(chainRows(["b"], creatures, ["a"])[0]!.band).toBe("far");
    expect(chainRows(["b"], creatures, ["a"], false)[0]!.band).toBeNull();
    expect(targetLabel({ name: "Bear", band: "far" })).toBe("Bear (Far)");
    expect(targetLabel({ name: "Bear" })).toBe("Bear");
    const view = { tokenId: "me" as Id<"combatTokens">, pcs: [{ _id: "me" as Id<"combatTokens">, x: 0, y: 0, size: 1, name: "Ash" }, { _id: "p" as Id<"combatTokens">, x: 20, y: 0, size: 1, name: "Bryn" }], others: [] };
    expect(bandsFrom(view).get("p")!.band).toBe("veryFar");
    expect(bandsFrom(view, false).get("p")!.band).toBeNull();
    const hint = { tokenId: "p" as Id<"combatTokens">, band: "veryFar" as const, inRange: false, lineOfSight: true, cover: false };
    expect(conflictRows(bandsFrom(view), [hint]).map((r) => [r.reach, r.band])).toEqual([["out", "veryFar"]]);
    expect(conflictRows(bandsFrom(view, false), [hint], "book", false).map((r) => [r.reach, r.band])).toEqual([["in", null]]);
    const forced = { requestId: "q", instanceLabel: "Gob", feature: "Beguile", targets: [{ tokenId: "p" as Id<"combatTokens">, name: "Bryn" }] } as never;
    expect(forcedRows(forced, bandsFrom(view, false))[0]!.band).toBeNull();
  });
});
