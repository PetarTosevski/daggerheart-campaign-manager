/**
 * Plan finish-in-progress FP1 (bead dcm-bxp.134.3; docs/tasks/TASK-FP1.md): a path feature's server move (Rampaging Fury,
 * CB p.210: "The Ogre can move within Close range and deal damage to all targets in their path"; the GM picks the
 * destination, `useFeature` with `destination`) runs what a GM's drag of the token runs (`combatTokens.move`), and undoing
 * the use puts the token back.
 *
 * - Hidden (CB p.102): "After an adversary moves to where they would see you … you are no longer Hidden."
 * - Cloaked (CB p.42): "while Cloaked you remain unseen if you are stationary when an adversary moves to where they would
 *   normally see you": the move ends nothing.
 * - Areas: a token entering an `onEnter` area gets the area's feed row (fixture Rune Circle, as lane-e4's test).
 * - Hold the Line (CB p.342: "If an adversary moves within Very Close range"): the enemy-move trigger. A `pcMoves` feature
 *   (Shield Wall) is set off by a PC's move only, so an adversary's path move cannot set one off.
 *
 * FP5 (user 2026-11-10): Q3, the path feature moves first (with the reactions), then rolls: Trample (the Construct, "Mark a
 * Stress to make an attack against all targets in the Construct's path when they move") at a Hidden PC the Construct now
 * sees is rolled without Hidden's disadvantage. Q2, the reactions join the use's undo group: one undo of the use puts the
 * token back, brings Hidden back and takes the area and Hold the Line rows with it.
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { placeArea } from "../../convex/lib/combatAreas";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

const RUNE = "subclass:fixture:rune-circle";

vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  const rune = {
    featureId: "subclass:fixture:rune-circle",
    uses: [
      {
        id: "main",
        name: "Rune Circle",
        activation: { kind: "action" },
        steps: [{ kind: "area", to: "self", area: { label: "Rune Circle", centre: "point", radius: "melee", side: "all", duration: "scene", placeWithin: "close", onEnter: [{ kind: "manual", to: "triggerSubject", text: "2d12+4 magic damage" }] } }],
      },
    ],
  };
  return { ...real, featureEffect: (id: string) => (id === "subclass:fixture:rune-circle" ? (rune as unknown as ReturnType<typeof real.featureEffect>) : real.featureEffect(id)) };
});

vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  // Hold the Line (CB p.342) written with the widened trigger (as lane-e4's test).
  const hold = { cardId: "hold-the-line", uses: [{ id: "pull", name: "Hold the Line", activation: { kind: "reaction", trigger: { kind: "whenEnemyEntersRange", range: "veryClose" } }, steps: [] }] };
  return { ...real, cardEffect: (id: string) => (id === "hold-the-line" ? (hold as ReturnType<typeof real.cardEffect>) : real.cardEffect(id)) };
});

allowWorldEmails();

const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };

/**
 * A running encounter on a live medium map (30 x 20) in daylight: the Ogre at (10, 10), Bryn (characterB) at (12, 10) in
 * its path, Ash (characterA) at `ash` with `conditions`.
 */
async function arena(opts: { ash?: { x: number; y: number }; bryn?: { x: number; y: number }; conditions?: string[]; cards?: string[]; adversaryId?: string } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const ash = opts.ash ?? { x: 20, y: 10 };
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const time = await ctx.db
      .query("campaignTime")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    if (time === null) await ctx.db.insert("campaignTime", { campaignId, week: 1, cycle: "DAY", cycleDay: 3 });
    else await ctx.db.patch("campaignTime", time._id, { cycle: "DAY", cycleDay: 3 });
    for (const id of [w.characterA, w.characterB]) {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      const cards = id === w.characterA ? (opts.cards ?? []) : [];
      await saveSheet(ctx, id, {
        ...s,
        hp: 0,
        stress: 0,
        effects: [EASY],
        conditions: (id === w.characterA ? (opts.conditions ?? []) : []) as CharacterSheet["conditions"],
        domainCards: { ...s.domainCards, owned: [...s.domainCards.owned, ...cards], loadout: [...s.domainCards.loadout, ...cards] },
      });
    }
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Cave", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const ogre = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: opts.adversaryId ?? "cave-ogre" },
      label: "Ogre",
      order: 0,
      summoned: false,
      stats: { difficulty: 13, major: 8, severe: 15, hpMax: 8, stressMax: 3 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    const ogreToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: ogre }, side: "enemy", x: 10, y: 10, face: 0 });
    const ashToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: ash.x, y: ash.y, face: Math.PI });
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: opts.bryn?.x ?? 12, y: opts.bryn?.y ?? 10, face: Math.PI });
    const s = await campaignFearState(ctx, campaignId);
    await ctx.db.patch(s._id, { fear: 5 });
    return { ogre, ogreToken, ashToken };
  });
  /** Rampaging Fury at Bryn (named, so the line's fill doesn't matter) with the Ogre moving to (x, y). */
  const fury = (x: number, y: number) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: ids.ogre, feature: "Rampaging Fury", targets: [w.characterB], destination: { x, y }, idempotencyKey: key(), spendFear: 12 });
  /** FP5: Trample (the Construct's path attack) at Ash (on the path in these tests), the token moving to (x, y). */
  const trample = (x: number, y: number) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: ids.ogre, feature: "Trample", targets: [w.characterA], destination: { x, y }, idempotencyKey: key(), spendFear: 12 });
  const ogreAt = () => t.run(async (ctx) => (await ctx.db.get("combatTokens", ids.ogreToken))!);
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const serverMoves = () => t.run(async (ctx) => (await ctx.db.query("combatRequests").collect()).filter((r) => r.kind === "serverMove"));
  const rune = (x: number, y: number) =>
    t.run(async (ctx) => {
      const map = (await ctx.db.get("combatMaps", mapId))!;
      const owner = await ctx.db.get("combatTokens", ids.ashToken);
      const spec = { label: "Rune Circle", centre: "point" as const, radius: "melee" as const, side: "all" as const, duration: "scene" as const, placeWithin: "close" as const };
      return placeArea(ctx, { campaignId, map, characterId: w.characterA, sourceId: RUNE, useId: "main", spec, centre: { kind: "square", x, y }, ownerToken: owner });
    });
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, ...ids, fury, trample, ogreAt, sheet, rows, serverMoves, rune, undo };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

describe("FP1: a path feature's move runs the drag's reactions", () => {
  it("entering an onEnter area gets the area's feed row, and the GM row names it", async () => {
    const a = await arena({ ash: { x: 18, y: 10 } });
    await a.rune(14, 10);
    resolved(await a.fury(13, 10));
    expect(await a.ogreAt()).toMatchObject({ x: 13, y: 10 });
    const all = await a.rows();
    expect(all.find((r) => r.summary === "Ogre enters Rune Circle")).toMatchObject({ visibility: "public", kind: "combat" });
    expect(all.some((r) => r.kind === "adversary" && r.visibility === "gm" && r.summary.includes("Ogre entered Rune Circle"))).toBe(true);
  });

  it("Hidden ends for a PC the Ogre now sees in clear light (CB p.102)", async () => {
    const a = await arena({ conditions: ["hidden"] });
    resolved(await a.fury(14, 10));
    expect((await a.sheet()).conditions).not.toContain("hidden");
    const name = (await a.sheet()).name;
    expect((await a.rows()).find((r) => r.summary === `Ogre moves to where it sees ${name}: no longer Hidden`)).toMatchObject({ visibility: "public", undoable: true });
  });

  it("a Cloaked PC stays unseen when the adversary moves (CB p.42): Cloaked does not end", async () => {
    const a = await arena({ conditions: ["cloaked"] });
    resolved(await a.fury(14, 10));
    expect((await a.sheet()).conditions).toEqual(["cloaked"]);
    expect((await a.rows()).some((r) => r.summary.includes("no longer"))).toBe(false);
  });

  it("moving within Very Close range of a Hold the Line holder names the card in the feed (the enemy-move trigger)", async () => {
    const a = await arena({ ash: { x: 18, y: 10 }, cards: ["hold-the-line"] });
    resolved(await a.fury(15, 10));
    const name = (await a.sheet()).name;
    expect((await a.rows()).filter((r) => r.summary === `Ogre moves within range of ${name}: Hold the Line`)).toHaveLength(1);
  });

  it("a move that ends out of every reaction's reach writes no reaction row", async () => {
    const a = await arena({ ash: { x: 25, y: 2 }, cards: ["hold-the-line"] });
    resolved(await a.fury(14, 10));
    expect((await a.rows()).some((r) => r.summary.includes("Hold the Line") || r.summary.includes("Rune Circle"))).toBe(false);
  });
});

describe("FP1: undoing the use moves the token back", () => {
  it("the move joins the use's group: undo puts the Ogre back on its square and facing and closes the serverMove row", async () => {
    const a = await arena();
    const before = await a.ogreAt();
    const r = resolved(await a.fury(14, 10));
    expect(await a.ogreAt()).toMatchObject({ x: 14, y: 10 });
    const [open] = await a.serverMoves();
    expect(open).toMatchObject({ status: "open", payload: { kind: "serverMove", tokenId: a.ogreToken, from: { x: 10, y: 10, face: before.face }, to: { x: 14, y: 10 } } });
    const entry = await a.t.run(async (ctx) => (await ctx.db.get("actionLog", r.entryId))!);
    expect(open!.payload.kind === "serverMove" ? open!.payload.groupId : null).toBe(entry.groupId);
    await a.undo(r.entryId);
    expect(await a.ogreAt()).toMatchObject({ x: 10, y: 10, face: before.face });
    expect((await a.serverMoves()).map((m) => m.status)).toEqual(["declined"]);
  });

  it("the Ogre's next path move supersedes the older one: undoing the newer use goes back to where the older left it", async () => {
    const a = await arena();
    resolved(await a.fury(14, 10));
    await a.t.run((ctx) => ctx.db.patch("encounterAdversaries", a.ogre, { stress: 0 }));
    const second = resolved(await a.fury(16, 10));
    expect((await a.serverMoves()).map((m) => m.status)).toEqual(["resolved", "open"]);
    await a.undo(second.entryId);
    expect(await a.ogreAt()).toMatchObject({ x: 14, y: 10 });
  });

  it("a refused destination moves nothing and opens no serverMove row (COMBAT_TARGET_INVALID)", async () => {
    const a = await arena();
    let code: unknown = "ok";
    try {
      await a.fury(25, 10);
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).toBe("COMBAT_TARGET_INVALID");
    expect(await a.ogreAt()).toMatchObject({ x: 10, y: 10 });
    expect(await a.serverMoves()).toEqual([]);
  });
});

describe("FP5: the path feature moves before it rolls (Q3)", () => {
  it("Trample at a Hidden PC on its path: Hidden ends on the move, and the attack is rolled without its disadvantage", async () => {
    const a = await arena({ adversaryId: "construct", ash: { x: 12, y: 10 }, bryn: { x: 25, y: 2 }, conditions: ["hidden"] });
    const r = resolved(await a.trample(14, 10));
    expect(r.targets.map((o) => o.characterId)).toEqual([a.w.characterA]);
    expect((await a.sheet()).conditions).not.toContain("hidden");
    // One d20: no disadvantage left on the roll (Hidden would have rolled two and kept the lower).
    expect(r.roll?.dice).toHaveLength(1);
    const name = (await a.sheet()).name;
    const all = await a.rows();
    const unhide = all.find((r) => r.summary === `Ogre moves to where it sees ${name}: no longer Hidden`);
    const entry = all.find((row) => row._id === r.entryId)!;
    expect(unhide).toMatchObject({ undoable: true, groupId: entry.groupId });
    // The unhide row comes before the roll's rows.
    expect(unhide!.at).toBeLessThanOrEqual(entry.at);
  });

  it("C1 Manual: no 'attacked while Hidden' note once the move ended Hidden", async () => {
    const a = await arena({ adversaryId: "construct", ash: { x: 12, y: 10 }, bryn: { x: 25, y: 2 }, conditions: ["hidden"] });
    await a.t.run((ctx) => ctx.db.patch("campaigns", a.campaignId, { ruleModes: { conditionDice: "manual" } as never }));
    resolved(await a.trample(14, 10));
    expect((await a.rows()).some((r) => r.kind === "rule" && r.ruleId === "conditionDice")).toBe(false);
  });
});

describe("FP5: the move's reactions join the use's undo group (Q2)", () => {
  it("one undo of the use restores Hidden and the token", async () => {
    const a = await arena({ adversaryId: "construct", ash: { x: 12, y: 10 }, bryn: { x: 25, y: 2 }, conditions: ["hidden"] });
    const before = await a.ogreAt();
    const r = resolved(await a.trample(14, 10));
    expect((await a.sheet()).conditions).not.toContain("hidden");
    await a.undo(r.entryId);
    expect((await a.sheet()).conditions).toContain("hidden");
    expect(await a.ogreAt()).toMatchObject({ x: 10, y: 10, face: before.face });
  });

  it("the area and Hold the Line rows sit in the use's group and go with its undo", async () => {
    const a = await arena({ ash: { x: 18, y: 10 }, conditions: ["hidden"], cards: ["hold-the-line"] });
    await a.rune(14, 10);
    const r = resolved(await a.fury(15, 10));
    const name = (await a.sheet()).name;
    const all = await a.rows();
    const group = all.find((row) => row._id === r.entryId)!.groupId;
    const reactions = all.filter((row) => row.summary === "Ogre enters Rune Circle" || row.summary === "Ogre moves through Rune Circle" || row.summary === `Ogre moves within range of ${name}: Hold the Line` || row.summary === `Ogre moves to where it sees ${name}: no longer Hidden`);
    expect(reactions.length).toBeGreaterThanOrEqual(3);
    expect(reactions.every((row) => row.groupId === group && row.undoable)).toBe(true);
    await a.undo(r.entryId);
    const after = await a.rows();
    expect(after.filter((row) => row.groupId === group).every((row) => row.undoneAt !== undefined)).toBe(true);
    expect((await a.sheet()).conditions).toContain("hidden");
    expect(await a.ogreAt()).toMatchObject({ x: 10, y: 10 });
  });

  it("a GM drag keeps its own groups: its reaction rows are not undoable with anything else", async () => {
    const a = await arena({ ash: { x: 18, y: 10 }, cards: ["hold-the-line"] });
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.ogreToken, x: 15, y: 10 });
    const name = (await a.sheet()).name;
    expect((await a.rows()).find((r) => r.summary === `Ogre moves within range of ${name}: Hold the Line`)).toMatchObject({ undoable: false });
  });
});
