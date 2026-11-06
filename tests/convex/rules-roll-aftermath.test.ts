/**
 * Plan rule-switches RA (docs/tasks/TASK-RULES-RA.md): what a PC's action roll sets off, per roll path, in Book and
 * Manual of two rule switches.
 *
 * - S1 `spotlightToGm` (CB p.100: "making moves until someone fails a roll or rolls with Fear"; CB p.149: "Rolls with
 *   Fear on an action roll. / Fails an action roll."). Book: the spotlight goes to the GM; Manual: a GM note
 *   "Ash rolled with Fear: take the spotlight?" / "Ash failed: take the spotlight?". On every PC action roll, in an
 *   encounter or not (RA2, user answer 2026-11-06).
 * - R3 `hopeFearFromRolls` (CB p.154: "Whenever a PC rolls with Fear, you gain a Fear"; CB p.90). Manual (user answer Q2 b,
 *   2026-11-05): neither the Hope nor the Fear rises by itself; the GM gets "Ash rolled with Fear: gain 1 Fear?". A
 *   critical keeps its Hope and Stress clear. Card and feature rolls follow it too (RA2, the run context's `hopeFear`).
 *
 * Notes are GM-only `rule` rows in the roll's group: undoing the roll takes them back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

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
const ABILITY = "deft-maneuvers";
const ONE_ENEMY = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };
/** A card with an Agility action roll against a fixed Difficulty 12. */
const CARD: CardEffect = {
  cardId: ABILITY,
  uses: [{ id: "hex", name: "Hex", activation: { kind: "action" }, roll: { kind: "trait", trait: "agility", difficulty: { kind: "fixed", value: 12 } }, targets: ONE_ENEMY, steps: [] }],
};
/** A feature attack with a trait roll against the target's Difficulty. */
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

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn (Hope Die first), then repeat. */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

type Modes = { spotlightToGm?: "book" | "manual"; hopeFearFromRolls?: "book" | "manual" };
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/** The world, a medium map with Ash's token at (5, 10), and (unless `encounter: false`) a running encounter. */
async function arena(modes: Modes = {}, options: { encounter?: boolean } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: modes });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const status = options.encounter === false ? ("draft" as const) : ("running" as const);
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status, pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, ...(status === "running" ? { startedAt: now } : {}) });
    return { ash, encounterId };
  });
  const enemy = (difficulty: number, x = 6, y = 10) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
    });
  const sheetOf = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (patch: Partial<CharacterSheet>, id: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch });
    });
  const fear = () => t.run(async (ctx) => (await ctx.db.query("campaignState").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).unique())?.fear ?? 0);
  const spotlight = () => t.run(async (ctx) => ctx.db.query("combatSpotlight").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).first());
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const roll = (values: number[], extra: { difficulty?: number; kind?: "action" | "reaction" } = {}) =>
    player.mutation(api.rolls.manualRoll, { characterId: w.characterA, values, roll: { ...agility, ...extra }, idempotencyKey: key() });
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, sheetOf, edit, fear, spotlight, rows, notes, roll, undo };
}

/** The spotlight row's who and why, or null. */
const held = (row: Doc<"combatSpotlight"> | null) => (row === null ? null : { holder: row.holder.kind, reason: row.reason, rollBy: row.rollBy });

describe("rolls.actionRoll / manualRoll", () => {
  it("S1 Book: a roll with Fear hands the spotlight to the GM, naming the roller; the row stays ungrouped", async () => {
    const a = await arena();
    const r = await a.roll([3, 8]);
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear", rollBy: a.w.characterA });
    expect(await a.notes()).toEqual([]);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))?.groupId).toBeUndefined();
  });

  it("S1 Book: a failure with Hope moves it (failedRoll); a success with Hope and a critical never do", async () => {
    const ok = await arena();
    await ok.roll([8, 3], { difficulty: 5 });
    await ok.roll([4, 4], { difficulty: 30 });
    expect(await ok.spotlight()).toBeNull();
    await ok.roll([5, 2], { difficulty: 15 });
    expect(held(await ok.spotlight())).toEqual({ holder: "gm", reason: "failedRoll", rollBy: ok.w.characterA });
  });

  it("S1: a reaction roll never moves it", async () => {
    const a = await arena();
    await a.roll([3, 8], { kind: "reaction" });
    expect(await a.spotlight()).toBeNull();
  });

  it("S1 outside an encounter (RA2, user answer 2026-11-06): Book moves it on every PC action roll", async () => {
    const calm = await arena({}, { encounter: false });
    await calm.roll([3, 8]);
    expect(held(await calm.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear", rollBy: calm.w.characterA });

    // No encounter at all: the spotlight row is the campaign's.
    const none = await arena({}, { encounter: false });
    await none.t.run((ctx) => ctx.db.delete("encounters", none.encounterId));
    await none.roll([5, 2], { difficulty: 15 });
    expect(held(await none.spotlight())).toEqual({ holder: "gm", reason: "failedRoll", rollBy: none.w.characterA });
  });

  it("S1 outside an encounter: Manual moves nothing and notes it in the roll's group; undo takes it back", async () => {
    const calm = await arena({ spotlightToGm: "manual" }, { encounter: false });
    await calm.t.run((ctx) => ctx.db.delete("encounters", calm.encounterId));
    const r = await calm.roll([3, 8]);
    expect(await calm.spotlight()).toBeNull();
    const row = (await calm.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect((await calm.notes()).map((x) => [x.ruleId, x.summary, x.groupId])).toEqual([["spotlightToGm", "Ash rolled with Fear: take the spotlight?", row.groupId]]);
    await calm.undo(r.entryId);
    expect((await calm.notes()).every((x) => x.undoneAt !== undefined)).toBe(true);
  });

  it("S1 Manual: nothing moves; the GM gets a note in the roll's group, players never see it; undo takes it back", async () => {
    const a = await arena({ spotlightToGm: "manual" });
    const r = await a.roll([3, 8]);
    expect(await a.spotlight()).toBeNull();
    const [note] = await a.notes();
    const row = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect(note).toMatchObject({ visibility: "gm", ruleId: "spotlightToGm", summary: "Ash rolled with Fear: take the spotlight?", groupId: row.groupId, undoable: true });
    expect(note!.characterId).toBeUndefined();
    expect(row.groupId).toBeTypeOf("string");
    const feed = await a.player.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 20, cursor: null } });
    expect(feed.page.some((x) => x.kind === "rule")).toBe(false);
    await a.undo(r.entryId);
    expect((await a.notes()).every((x) => x.undoneAt !== undefined)).toBe(true);

    await a.roll([5, 2], { difficulty: 15 });
    expect((await a.notes()).map((x) => x.summary)).toContain("Ash failed: take the spotlight?");
  });

  it("S1 Manual: no note while the GM already holds the spotlight", async () => {
    const a = await arena({ spotlightToGm: "manual" });
    await a.gm.mutation(api.combatSpotlight.gmTake, { campaignId: a.campaignId, idempotencyKey: key() });
    await a.roll([3, 8]);
    expect(await a.notes()).toEqual([]);
  });

  it("R3 Book: the Fear and Hope rise as before", async () => {
    const a = await arena();
    await a.edit({ hope: 2 });
    await a.roll([3, 8]);
    expect(await a.fear()).toBe(1);
    await a.roll([8, 3]);
    expect((await a.sheetOf()).hope).toBe(3);
  });

  it("R3 Manual: a roll with Fear gains no Fear and notes it; a roll with Hope gains no Hope; undo takes the note back", async () => {
    const a = await arena({ hopeFearFromRolls: "manual" });
    await a.edit({ hope: 2 });
    const r = await a.roll([3, 8]);
    expect(r).toMatchObject({ fearGained: 0 });
    expect(await a.fear()).toBe(0);
    const row = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect(row.fearDelta).toBeUndefined();
    const fearNote = (await a.notes()).find((x) => x.ruleId === "hopeFearFromRolls")!;
    expect(fearNote).toMatchObject({ visibility: "gm", summary: "Ash rolled with Fear: gain 1 Fear?", groupId: row.groupId });
    // S1 stays Book: the spotlight still moves.
    expect(held(await a.spotlight())?.holder).toBe("gm");

    const hope = await a.roll([8, 3]);
    expect((await a.sheetOf()).hope).toBe(2);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", hope.entryId)))?.hopeGained).toBe(false);
    expect((await a.notes()).filter((x) => x.ruleId === "hopeFearFromRolls")).toHaveLength(1);

    await a.undo(hope.entryId);
    await a.undo(r.entryId);
    expect((await a.notes()).every((x) => x.undoneAt !== undefined)).toBe(true);
  });

  it("R3 Manual: a critical keeps its own Hope and cleared Stress (R2, CB p.90)", async () => {
    const a = await arena({ hopeFearFromRolls: "manual" });
    await a.edit({ hope: 2, stress: 2 });
    await a.roll([6, 6]);
    expect(await a.sheetOf()).toMatchObject({ hope: 3, stress: 1 });
    expect(await a.notes()).toEqual([]);
  });
});

describe("rolls.tagTeamApply: once, with the chosen roll (CB p.97)", () => {
  async function tagTeam(modes: Modes) {
    const a = await arena(modes);
    await a.edit({ hope: 4 });
    const side = { trait: "agility" as const, modifier: 0 };
    dice(3, 8);
    const { rolls } = await a.player.mutation(api.rolls.tagTeam, { characterId: a.w.characterA, partnerId: a.w.characterB, initiator: side, partner: side, idempotencyKey: key() });
    const out = await a.player.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a.w.characterA, idempotencyKey: key() });
    return { a, rolls, out };
  }

  it("Book: the pair's roll with Fear gains 2 Fear and moves the spotlight once", async () => {
    const { a, out } = await tagTeam({});
    expect(out.outcome).toBe("successFear");
    expect(await a.fear()).toBe(2);
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear", rollBy: a.w.characterA });
    expect(await a.notes()).toEqual([]);
  });

  it("Manual: no Fear; one note per rule in the Tag Team's group; undo of the group takes them back", async () => {
    const { a, rolls } = await tagTeam({ spotlightToGm: "manual", hopeFearFromRolls: "manual" });
    expect(await a.fear()).toBe(0);
    expect(await a.spotlight()).toBeNull();
    const groupId = (await a.t.run((ctx) => ctx.db.get("actionLog", rolls[0]!.entryId)))!.groupId;
    expect((await a.notes()).map((x) => [x.summary, x.groupId])).toEqual([
      ["Ash and Bryn rolled with Fear: take the spotlight?", groupId],
      ["Ash and Bryn rolled with Fear: gain 2 Fear?", groupId],
    ]);
    await a.undo(rolls[0]!.entryId);
    expect((await a.notes()).every((x) => x.undoneAt !== undefined)).toBe(true);
    expect((await a.sheetOf()).hope).toBe(4);
  });
});

describe("combatActions.attack (weapon attacks)", () => {
  const attack = (a: Awaited<ReturnType<typeof arena>>, targetTokenIds: Id<"combatTokens">[]) =>
    a.player.mutation(api.combatActions.attack, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() } as never);

  it("S1 Book: a miss with Hope moves the spotlight (failedRoll); a hit with Hope does not", async () => {
    const a = await arena();
    const hard = await a.enemy(40);
    dice(8, 3);
    await attack(a, [hard]);
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "failedRoll", rollBy: a.w.characterA });

    const b = await arena();
    const easy = await b.enemy(1);
    dice(8, 3);
    await attack(b, [easy]);
    expect(await b.spotlight()).toBeNull();
  });

  it("R3 + S1 Manual: a hit with Fear gains no Fear; both notes join the attack's group", async () => {
    const a = await arena({ spotlightToGm: "manual", hopeFearFromRolls: "manual" });
    const easy = await a.enemy(1);
    dice(3, 8);
    const r = (await attack(a, [easy])) as { status: string; entryId: Id<"actionLog"> };
    expect(r.status).toBe("resolved");
    expect(await a.fear()).toBe(0);
    expect(await a.spotlight()).toBeNull();
    const groupId = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!.groupId;
    expect((await a.notes()).map((x) => [x.ruleId, x.summary, x.groupId])).toEqual([
      ["spotlightToGm", "Ash rolled with Fear: take the spotlight?", groupId],
      ["hopeFearFromRolls", "Ash rolled with Fear: gain 1 Fear?", groupId],
    ]);
  });
});

describe("combatCards.useCard and combatFeatures.useFeature (S1; R3 through the run context, RA2)", () => {
  async function caster(modes: Modes) {
    const a = await arena(modes);
    await a.edit({ classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", hope: 3, domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as Partial<CharacterSheet>);
    const bear = await a.enemy(1);
    return { a, bear };
  }

  it("a card's roll with Fear moves the spotlight (Book) or notes it in the use's group (Manual)", async () => {
    const book = await caster({});
    dice(3, 8);
    await book.a.player.mutation(api.combatCards.useCard, { campaignId: book.a.campaignId, characterId: book.a.w.characterA, mapId: book.a.mapId, cardId: ABILITY, spell: "hex", targetTokenIds: [book.bear], choices: [], idempotencyKey: key() });
    expect(held(await book.a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear", rollBy: book.a.w.characterA });

    const manual = await caster({ spotlightToGm: "manual" });
    dice(3, 8);
    const r = await manual.a.player.mutation(api.combatCards.useCard, { campaignId: manual.a.campaignId, characterId: manual.a.w.characterA, mapId: manual.a.mapId, cardId: ABILITY, spell: "hex", targetTokenIds: [manual.bear], choices: [], idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(r.status);
    expect(await manual.a.spotlight()).toBeNull();
    const groupId = (await manual.a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!.groupId;
    expect((await manual.a.notes()).map((x) => [x.summary, x.groupId])).toEqual([["Ash rolled with Fear: take the spotlight?", groupId]]);
  });

  it("a card's failure with Hope moves the spotlight (failedRoll)", async () => {
    const { a, bear } = await caster({});
    dice(5, 2);
    await a.player.mutation(api.combatCards.useCard, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, cardId: ABILITY, spell: "hex", targetTokenIds: [bear], choices: [], idempotencyKey: key() });
    expect(held(await a.spotlight())?.reason).toBe("failedRoll");
  });

  it("a feature's attack that misses moves the spotlight (Book) or notes it (Manual)", async () => {
    const book = await caster({});
    const far = await book.a.enemy(40, 8);
    dice(8, 3);
    await book.a.player.mutation(api.combatFeatures.useFeature, { campaignId: book.a.campaignId, characterId: book.a.w.characterA, mapId: book.a.mapId, featureId: BITE_ID, targetTokenIds: [far], choices: [], idempotencyKey: key() });
    expect(held(await book.a.spotlight())?.reason).toBe("failedRoll");

    const manual = await caster({ spotlightToGm: "manual" });
    const far2 = await manual.a.enemy(40, 8);
    dice(8, 3);
    await manual.a.player.mutation(api.combatFeatures.useFeature, { campaignId: manual.a.campaignId, characterId: manual.a.w.characterA, mapId: manual.a.mapId, featureId: BITE_ID, targetTokenIds: [far2], choices: [], idempotencyKey: key() });
    expect(await manual.a.spotlight()).toBeNull();
    expect((await manual.a.notes()).map((x) => x.summary)).toEqual(["Ash failed: take the spotlight?"]);
  });

  // RA2 (bead dcm-jh6d.67, user answer 2026-11-06): card and feature rolls follow R3 through the run context's `hopeFear`.
  type Caster = Awaited<ReturnType<typeof caster>>;
  const useCard = (c: Caster) =>
    c.a.player.mutation(api.combatCards.useCard, { campaignId: c.a.campaignId, characterId: c.a.w.characterA, mapId: c.a.mapId, cardId: ABILITY, spell: "hex", targetTokenIds: [c.bear], choices: [], idempotencyKey: key() });
  const useBite = (c: Caster) =>
    c.a.player.mutation(api.combatFeatures.useFeature, { campaignId: c.a.campaignId, characterId: c.a.w.characterA, mapId: c.a.mapId, featureId: BITE_ID, targetTokenIds: [c.bear], choices: [], idempotencyKey: key() });
  const uses = [
    ["card", useCard],
    ["feature", useBite],
  ] as const;

  for (const [what, use] of uses) {
    it(`R3 Book: a ${what}'s roll with Hope gains a Hope, a roll with Fear gives the GM a Fear`, async () => {
      const c = await caster({});
      dice(8, 3);
      await use(c);
      expect((await c.a.sheetOf()).hope).toBe(4);
      dice(3, 8);
      await use(c);
      expect(await c.a.fear()).toBe(1);
      expect((await c.a.notes()).filter((x) => x.ruleId === "hopeFearFromRolls")).toEqual([]);
    });

    it(`R3 Manual: a ${what}'s roll gains no Hope or Fear; the GM gets the note in the use's group; undo takes it back`, async () => {
      const c = await caster({ hopeFearFromRolls: "manual" });
      dice(8, 3);
      await use(c);
      expect((await c.a.sheetOf()).hope).toBe(3);
      dice(3, 8);
      const r = await use(c);
      if (r.status !== "resolved") throw new Error(r.status);
      expect(await c.a.fear()).toBe(0);
      const row = (await c.a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
      expect(row.fearDelta).toBeUndefined();
      expect((await c.a.notes()).filter((x) => x.ruleId === "hopeFearFromRolls").map((x) => [x.visibility, x.summary, x.groupId])).toEqual([["gm", "Ash rolled with Fear: gain 1 Fear?", row.groupId]]);
      // S1 stays Book: the spotlight still moves.
      expect(held(await c.a.spotlight())?.reason).toBe("rollWithFear");
      await c.a.undo(r.entryId);
      expect((await c.a.notes()).every((x) => x.undoneAt !== undefined)).toBe(true);
    });

    it(`R3 Manual: a ${what}'s critical keeps its Hope and clears a Stress (CB p.90); no note`, async () => {
      const c = await caster({ hopeFearFromRolls: "manual" });
      await c.a.edit({ stress: 2 });
      dice(6, 6);
      await use(c);
      expect(await c.a.sheetOf()).toMatchObject({ hope: 4, stress: 1 });
      expect(await c.a.fear()).toBe(0);
      expect(await c.a.notes()).toEqual([]);
    });
  }
});

describe("the movement's Cloaked roll (lib/combatMovement, DA18)", () => {
  /** Night; a Cloaked rogue with Finesse +1; a Difficulty-18 Bear 3 squares away sees (4, 10) in dim light. */
  async function dim(modes: Modes) {
    const a = await arena(modes);
    await a.t.run(async (ctx) => {
      await ctx.db.patch("combatMaps", a.mapId, { live: true });
      const time = await ctx.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", a.campaignId))
        .unique();
      if (time === null) await ctx.db.insert("campaignTime", { campaignId: a.campaignId, week: 1, cycle: "NIGHT", cycleDay: 3 });
      else await ctx.db.patch("campaignTime", time._id, { cycle: "NIGHT", cycleDay: 3 });
    });
    const s = await a.sheetOf();
    await a.edit({ classId: "rogue", conditions: ["cloaked"], traits: { ...s.traits, finesse: 1 }, hope: 2 } as Partial<CharacterSheet>);
    await a.enemy(18, 7, 10);
    const move = () => a.player.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.ash, x: 4, y: 10 });
    return { a, move };
  }

  it("Book: a failure with Fear gains Fear and hands the spotlight to the GM", async () => {
    const { a, move } = await dim({});
    dice(3, 8);
    await move();
    expect(await a.fear()).toBe(1);
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear", rollBy: a.w.characterA });
  });

  it("Manual: no Fear, no move; both notes in the move's roll group", async () => {
    const { a, move } = await dim({ spotlightToGm: "manual", hopeFearFromRolls: "manual" });
    dice(3, 8);
    await move();
    expect(await a.fear()).toBe(0);
    expect(await a.spotlight()).toBeNull();
    const roll = (await a.rows()).find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    expect((await a.notes()).map((x) => [x.ruleId, x.groupId])).toEqual([
      ["spotlightToGm", roll.groupId],
      ["hopeFearFromRolls", roll.groupId],
    ]);
  });
});
