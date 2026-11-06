/**
 * Plan rule-switches RFC (docs/tasks/TASK-RULES-RFC.md, bead dcm-jh6d.70): card and feature uses on the Combat Map follow
 * the campaign's damage, sight, condition and defeat modes. Book is today's behaviour; Manual stops applying the rule and
 * posts a GM-only `rule` note in the use's group (feature uses here; card uses post D2 / D8 through combatCards).
 *
 * - D2 `resistance` (CB p.99 "they halve damage of that type"): Manual takes the damage in full.
 * - D4 `stressOverflow` (CB p.92 "you must instead mark 1 Hit Point"): Manual drops the extra Stress.
 * - Massive Damage (CB p.91, optional): on, twice the Severe threshold marks 4 HP.
 * - D8 `adversaryDefeated` (CB p.208): Manual leaves an adversary at its last HP up.
 * - M1 `lineOfSight` (CB p.104): Manual refuses no unseen target.
 * - C1 `conditionDice` (CB p.102; user 2026-11-06: card attack rolls get the dice like weapons): Book adds the advantage /
 *   disadvantage die, Manual notes it.
 *
 * Dice: the server's CSPRNG is stubbed (`dice`): Hope 10, Fear 3 (a success with Hope, never a critical), then an edge
 * d6 (4) when the roll has one, then the d8 damage (8); every value stays within its die.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CardEffect, CardUse } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

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
const STRIKE: CardUse = {
  id: "strike",
  name: "Strike",
  activation: { kind: "action" as const },
  roll: { kind: "trait" as const, trait: "agility" as const, difficulty: { kind: "target" as const }, attack: true },
  targets: ONE_ENEMY,
  steps: [{ kind: "damage" as const, to: "targets" as const, when: ["hit" as const], roll: { kind: "dice" as const, dice: { count: n(1), sides: 8 } }, type: "physical" }],
};
const DRAIN: CardUse = { id: "drain", name: "Drain", activation: { kind: "action" as const }, targets: ONE_ENEMY, steps: [{ kind: "markStress" as const, to: "targets" as const, amount: n(2) }] };

const ABILITY = "deft-maneuvers";
/** A card attack (Agility against the target's Difficulty, 1d8 physical) and a card that makes the target mark 2 Stress. */
const CARD: CardEffect = { cardId: ABILITY, uses: [STRIKE, DRAIN] };
const FEATURE_ID = "subclass:call-of-the-brave:battle-ritual";
/** The same two uses as a subclass feature (convex/lib/featureRunner.ts posts every Manual note). */
const FEATURE: FeatureEffect = { featureId: FEATURE_ID, source: "subclass", owner: "call-of-the-brave", card: "foundation", uses: [STRIKE, DRAIN] };
injected.cards.set(CARD.cardId, CARD);
injected.features.set(FEATURE.featureId, FEATURE);

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());
// The first use loads the whole card and feature runner; on a loaded host that takes longer than the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

/** D2's note for the damage the target took in full (the d8's 8 plus the sheet's damage bonus, if any). */
function expectResistNote(summary: string | undefined) {
  const m = /^Bandit resists: halve\? \((\d+) taken in full; halved: (\d+)\)$/.exec(summary ?? "");
  expect(m).not.toBeNull();
  const full = Number(m![1]);
  expect(full).toBeGreaterThanOrEqual(8);
  expect(Number(m![2])).toBe(Math.ceil(full / 2));
}

/** The server's dice show `values` in turn, then repeat (a value never above its die: callers pick them so). */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/** Every die of a roll stays within its sides. */
function diceInRange(roll: { dice: readonly { sides: number; value: number }[] } | null | undefined) {
  for (const d of roll?.dice ?? []) {
    expect(d.value).toBeGreaterThanOrEqual(1);
    expect(d.value).toBeLessThanOrEqual(d.sides);
  }
}

type Modes = Partial<{
  conditionDice: "book" | "manual";
  lineOfSight: "book" | "manual";
  resistance: "book" | "manual";
  stressOverflow: "book" | "manual";
  adversaryDefeated: "book" | "manual";
  massiveDamage: boolean;
}>;
type Stats = { difficulty: number; major: number | null; severe: number | null; hpMax: number; stressMax: number };
const SOFT: Stats = { difficulty: 1, major: 100, severe: 200, hpMax: 5, stressMax: 2 };

/** The world, a live map with Ash at (5, 10) looking east, a running encounter, the campaign's modes; Ash holds the card and the feature. */
async function arena(modes: Modes = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const encounterId = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: modes });
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as CharacterSheet);
    return ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number, stats: Partial<Stats> = {}, extra: { conditions?: ("vulnerable" | "hidden")[]; resistance?: { physical: "none" | "resistant" | "immune"; magic: "none" | "resistant" | "immune" } } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { ...SOFT, ...stats },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: extra.conditions ?? [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
        ...(extra.resistance ? { resistance: extra.resistance } : {}),
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  /** The notes of these rules (R3 / S1 notes of the roll are not this tracer's). */
  const notes = async () => (await rows()).filter((r) => r.kind === "rule" && ["resistance", "stressOverflow", "adversaryDefeated", "lineOfSight", "conditionDice"].includes(r.ruleId ?? ""));
  const groupOf = async (entryId: Id<"actionLog">) => (await t.run((ctx) => ctx.db.get("actionLog", entryId)))!.groupId;
  const card = async (spell: "strike" | "drain", targetTokenIds: Id<"combatTokens">[]) => {
    const r = await player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell, targetTokenIds, choices: [], idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(`expected a resolved card use, got ${r.status}`);
    return r;
  };
  const feature = async (useId: "strike" | "drain", targetTokenIds: Id<"combatTokens">[]) => {
    const r = await player.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId: FEATURE_ID, useId, targetTokenIds, choices: [], idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(`expected a resolved feature use, got ${r.status}`);
    return r;
  };
  const cardCode = (targetTokenIds: Id<"combatTokens">[]) =>
    code(player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell: "strike", targetTokenIds, choices: [], idempotencyKey: key() }));
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, enemy, instance, rows, notes, groupOf, card, feature, cardCode, undo };
}

describe("D2 resistance on card and feature damage (CB p.99)", () => {
  const RESISTANT = { resistance: { physical: "resistant" as const, magic: "none" as const } };
  const STATS = { major: 6, severe: 100, hpMax: 10 };

  it("Book halves the card's damage (Minor, 1 HP) with no note", async () => {
    dice(10, 3, 8);
    const a = await arena();
    const b = await a.enemy("Bandit", 6, 10, STATS, RESISTANT);
    const r = await a.card("strike", [b.tokenId]);
    diceInRange(r.roll);
    expect(r.damage[0]!.total).toBe(8);
    expect((await a.instance(b.instanceId)).hp).toBe(1);
    expect(await a.notes()).toEqual([]);
  });

  it("Manual: the card's damage is taken in full (Major, 2 HP); the GM gets the note in the use's group", async () => {
    dice(10, 3, 8);
    const a = await arena({ resistance: "manual" });
    const b = await a.enemy("Bandit", 6, 10, STATS, RESISTANT);
    const r = await a.card("strike", [b.tokenId]);
    diceInRange(r.roll);
    expect((await a.instance(b.instanceId)).hp).toBe(2);
    const notes = await a.notes();
    expect(notes.map((x) => [x.ruleId, x.visibility, x.groupId])).toEqual([["resistance", "gm", await a.groupOf(r.entryId)]]);
    expectResistNote(notes[0]!.summary);
  });

  it("Manual on a feature: full damage and the note in the use's group; undo takes it back", async () => {
    dice(10, 3, 8);
    const a = await arena({ resistance: "manual" });
    const b = await a.enemy("Bandit", 6, 10, STATS, RESISTANT);
    const r = await a.feature("strike", [b.tokenId]);
    diceInRange(r.roll);
    expect((await a.instance(b.instanceId)).hp).toBe(2);
    const notes = await a.notes();
    expect(notes.map((x) => [x.ruleId, x.groupId])).toEqual([["resistance", await a.groupOf(r.entryId)]]);
    expectResistNote(notes[0]!.summary);
    await a.undo(r.entryId);
    expect((await a.notes()).every((x) => x.undoneAt !== undefined)).toBe(true);
    expect((await a.instance(b.instanceId)).hp).toBe(0);
  });
});

describe("Massive Damage on a card (CB p.91, optional)", () => {
  it("off: 8+ against Severe 2 marks 3 HP; on: twice the Severe threshold marks 4", async () => {
    dice(10, 3, 8);
    const off = await arena();
    const o = await off.enemy("Bandit", 6, 10, { major: 1, severe: 2, hpMax: 10 });
    diceInRange((await off.card("strike", [o.tokenId])).roll);
    expect((await off.instance(o.instanceId)).hp).toBe(3);

    const on = await arena({ massiveDamage: true });
    const m = await on.enemy("Bandit", 6, 10, { major: 1, severe: 2, hpMax: 10 });
    diceInRange((await on.card("strike", [m.tokenId])).roll);
    expect((await on.instance(m.instanceId)).hp).toBe(4);
  });
});

describe("D4 Stress overflow on card and feature marks (CB p.92)", () => {
  it("Book: 2 Stress on a 1-slot track marks the slot and 1 HP; no note", async () => {
    dice(10, 3, 8);
    const a = await arena();
    const b = await a.enemy("Bandit", 6, 10, { stressMax: 1 });
    await a.card("drain", [b.tokenId]);
    expect(await a.instance(b.instanceId)).toMatchObject({ stress: 1, hp: 0 + 1 });
    expect(await a.notes()).toEqual([]);
  });

  it("Manual on a card: the extra Stress is dropped and no HP is marked", async () => {
    dice(10, 3, 8);
    const a = await arena({ stressOverflow: "manual" });
    const b = await a.enemy("Bandit", 6, 10, { stressMax: 1 });
    await a.card("drain", [b.tokenId]);
    expect(await a.instance(b.instanceId)).toMatchObject({ stress: 1, hp: 0 });
  });

  it("Manual on a feature: no HP; the GM gets 'Stress full, mark 1 HP?' in the use's group", async () => {
    dice(10, 3, 8);
    const a = await arena({ stressOverflow: "manual" });
    const b = await a.enemy("Bandit", 6, 10, { stressMax: 1 });
    const r = await a.feature("drain", [b.tokenId]);
    expect(await a.instance(b.instanceId)).toMatchObject({ stress: 1, hp: 0 });
    expect((await a.notes()).map((x) => [x.ruleId, x.summary, x.groupId])).toEqual([["stressOverflow", "Bandit: Stress full, mark 1 HP?", await a.groupOf(r.entryId)]]);
  });
});

describe("D8 defeat at the last HP in feature uses (CB p.208)", () => {
  it("Book: the feature's hit on the last HP defeats", async () => {
    dice(10, 3, 8);
    const a = await arena();
    const b = await a.enemy("Bandit", 6, 10, { hpMax: 1 });
    const r = await a.feature("strike", [b.tokenId]);
    expect(r.targets).toEqual([{ tokenId: b.tokenId, hit: true, defeated: true }]);
    expect((await a.instance(b.instanceId)).defeated).toBe(true);
  });

  it("Manual: it stays up and the GM is told in the use's group", async () => {
    dice(10, 3, 8);
    const a = await arena({ adversaryDefeated: "manual" });
    const b = await a.enemy("Bandit", 6, 10, { hpMax: 1 });
    const r = await a.feature("strike", [b.tokenId]);
    diceInRange(r.roll);
    expect(r.targets).toEqual([{ tokenId: b.tokenId, hit: true, defeated: false }]);
    expect(await a.instance(b.instanceId)).toMatchObject({ hp: 1, defeated: false });
    expect((await a.notes()).map((x) => [x.ruleId, x.summary, x.groupId])).toEqual([["adversaryDefeated", "Bandit marked its last HP: defeated?", await a.groupOf(r.entryId)]]);
  });
});

describe("M1 line of sight on cards and features (CB p.104)", () => {
  it("Book: a card on a target behind Ash (not seen) is refused with nothing written", async () => {
    const a = await arena();
    const lurker = await a.enemy("Lurker", 4, 10);
    expect(await a.cardCode([lurker.tokenId])).toBe("COMBAT_NO_LINE_OF_SIGHT");
    expect(await a.rows()).toEqual([]);
  });

  it("Manual: the card goes through and hits; an unseen token that isn't an enemy still answers COMBAT_NO_LINE_OF_SIGHT", async () => {
    dice(10, 3, 8);
    const a = await arena({ lineOfSight: "manual" });
    const lurker = await a.enemy("Lurker", 4, 10);
    const r = await a.card("strike", [lurker.tokenId]);
    diceInRange(r.roll);
    expect(r.targets).toEqual([{ tokenId: lurker.tokenId, hit: true, defeated: false }]);
    expect(r.roll?.dice.some((d) => d.role === "disadvantage")).toBe(false);
    const { tokenId: crate } = await a.gm.mutation(api.combatTokens.addCustom, { campaignId: a.campaignId, mapId: a.mapId, name: "Crate", hp: 3, side: "enemy", idempotencyKey: key() });
    await a.t.run((ctx) => ctx.db.patch("combatTokens", crate, { x: 4, y: 11 }));
    expect(await a.cardCode([crate])).toBe("COMBAT_NO_LINE_OF_SIGHT");
  });

  it("Manual on a feature: the GM gets 'No line of sight to the Lurker' in the use's group", async () => {
    dice(10, 3, 8);
    const a = await arena({ lineOfSight: "manual" });
    const lurker = await a.enemy("Lurker", 4, 10);
    const r = await a.feature("strike", [lurker.tokenId]);
    diceInRange(r.roll);
    expect((await a.notes()).map((x) => [x.ruleId, x.summary, x.groupId])).toEqual([["lineOfSight", "No line of sight to the Lurker", await a.groupOf(r.entryId)]]);
  });

  it("Book on a feature: refused", async () => {
    const a = await arena();
    const lurker = await a.enemy("Lurker", 4, 10);
    expect(await code(a.feature("strike", [lurker.tokenId]))).toBe("COMBAT_NO_LINE_OF_SIGHT");
  });
});

describe("C1 condition dice on card attack rolls (CB p.102; user 2026-11-06: like weapons)", () => {
  it("Book: a Vulnerable target gives the card's roll an advantage die, a Hidden one a disadvantage die; no note", async () => {
    dice(10, 3, 4, 8);
    const a = await arena();
    const soft = await a.enemy("Bandit", 6, 10, {}, { conditions: ["vulnerable"] });
    const r = await a.card("strike", [soft.tokenId]);
    diceInRange(r.roll);
    expect(r.roll?.dice.some((d) => d.role === "advantage")).toBe(true);
    expect(r.roll?.dice.some((d) => d.role === "disadvantage")).toBe(false);
    const shade = await a.enemy("Shade", 6, 11, {}, { conditions: ["hidden"] });
    const h = await a.card("strike", [shade.tokenId]);
    diceInRange(h.roll);
    expect(h.roll?.dice.some((d) => d.role === "disadvantage")).toBe(true);
    expect(await a.notes()).toEqual([]);
  });

  it("Book: a card that makes no attack roll (the Stress mark) gets no die", async () => {
    dice(10, 3, 8);
    const a = await arena();
    const soft = await a.enemy("Bandit", 6, 10, {}, { conditions: ["vulnerable"] });
    const r = await a.card("drain", [soft.tokenId]);
    expect(r.roll).toBeNull();
  });

  it("Manual: no die on the card's roll", async () => {
    dice(10, 3, 4, 8);
    const a = await arena({ conditionDice: "manual" });
    const soft = await a.enemy("Bandit", 6, 10, {}, { conditions: ["vulnerable", "hidden"] });
    const r = await a.card("strike", [soft.tokenId]);
    diceInRange(r.roll);
    expect(r.roll?.dice.some((d) => d.role === "advantage" || d.role === "disadvantage")).toBe(false);
  });

  it("Book on a feature attack: the advantage die too; Manual: no die and the GM's notes in the use's group", async () => {
    dice(10, 3, 4, 8);
    const book = await arena();
    const b = await book.enemy("Bandit", 6, 10, {}, { conditions: ["vulnerable"] });
    const rb = await book.feature("strike", [b.tokenId]);
    diceInRange(rb.roll);
    expect(rb.roll?.dice.some((d) => d.role === "advantage")).toBe(true);

    const manual = await arena({ conditionDice: "manual" });
    const m = await manual.enemy("Bandit", 6, 10, {}, { conditions: ["vulnerable", "hidden"] });
    const r = await manual.feature("strike", [m.tokenId]);
    diceInRange(r.roll);
    expect(r.roll?.dice.some((d) => d.role === "advantage" || d.role === "disadvantage")).toBe(false);
    const groupId = await manual.groupOf(r.entryId);
    expect((await manual.notes()).map((x) => [x.ruleId, x.summary, x.groupId])).toEqual([
      ["conditionDice", "Bandit is Vulnerable: add advantage?", groupId],
      ["conditionDice", "Bandit is Hidden: disadvantage?", groupId],
    ]);
    const feed = await manual.player.query(api.feed.list, { campaignId: manual.campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(feed.page.some((x) => x.kind === "rule")).toBe(false);
  });
});
