/**
 * Plan rule-switches RM: C2 Hidden / Cloaked end on the map (CB p.102), M2 Walls and doors stop tokens (the app's own
 * rule, not in the books; CB p.104), M3 Darkness Book / Manual (CB p.104). Book keeps today's behaviour; Manual stops
 * applying the rule and posts a GM-only `rule` note in the action's group (docs/tasks/TASK-RULES-RM.md).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { openCloakPrompt } from "../../convex/lib/cloakPrompts";
import { hiddenLabel, uncloakAfterAttack } from "../../convex/lib/combatMovement";
import { dimLightBadge, DIM_PHASE_BADGE } from "../../src/lib/domain/combat-map/light";
import { moveVerdict, wallsNote } from "../../src/lib/domain/combat-map/movement";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

type Modes = { hiddenEnds?: "book" | "manual"; wallsBlock?: "book" | "manual" };

const NIGHT = { cycle: "NIGHT" as const, cycleDay: 3 };
const DAY = { cycle: "DAY" as const, cycleDay: 3 };

/** A medium map's squares of column x (30 x 20). */
const column = (x: number) => Array.from({ length: 20 }, (_, y) => y * 30 + x);

/** The server's dice show `values` in turn (Hope Die first), then repeat. */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

/** The world plus a live medium map: Ash (the player's rogue) at (2, 10) with `conditions`, an encounter running. */
async function arena(modes: Modes, conditions: ("cloaked" | "hidden")[] = ["cloaked"]) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: modes });
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, classId: "rogue", conditions });
    return { ash, encounterId };
  });
  const enemy = (x: number, y: number, difficulty = 10) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty, major: 5, severe: 10, hpMax: 6, stressMax: 2 },
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
  const setTime = (time: { cycle: "DAY" | "NIGHT"; cycleDay: number }) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      if (row === null) await ctx.db.insert("campaignTime", { campaignId, week: 1, ...time });
      else await ctx.db.patch("campaignTime", row._id, time);
    });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch });
    });
  const move = (x: number, y: number, as = player) => as.mutation(api.combatTokens.move, { campaignId, tokenId: ids.ash, x, y });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const requests = () => t.run((ctx) => ctx.db.query("combatRequests").collect());
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, setTime, sheet, edit, move, rows, notes, requests };
}

// ---------------------------------------------------------------- pure

describe("pure: moveVerdict (M2), dimLightBadge and lightRule (M3), hiddenLabel (C2)", () => {
  it("M2 app rule refuses a player's blocked move and flags the GM's; Manual refuses and flags nothing", () => {
    const wall = { blocked: true, difficult: false };
    const both = { blocked: true, difficult: true };
    expect(moveVerdict(wall, false)).toEqual({ refused: true, blocked: true, difficult: false, crossed: null });
    expect(moveVerdict(both, true, "book")).toEqual({ refused: false, blocked: true, difficult: true, crossed: null });
    expect(moveVerdict(wall, false, "manual")).toEqual({ refused: false, blocked: false, difficult: false, crossed: "wall" });
    expect(moveVerdict({ blocked: false, difficult: true }, false, "manual").crossed).toBe("difficult");
    expect(moveVerdict(both, false, "manual").crossed).toBe("both");
    expect(moveVerdict(both, true, "manual").crossed).toBeNull();
    expect(moveVerdict({ blocked: false, difficult: false }, false, "manual").crossed).toBeNull();
    expect(wallsNote("Mira", "wall")).toBe("Mira moved through a wall or closed door: move the token back?");
  });

  it("M3 Book shows the dim-light badge, Manual none; the variants keep it until OE", () => {
    expect(dimLightBadge("dim")).toBe(DIM_PHASE_BADGE);
    expect(dimLightBadge("dim", "book")).toBe(DIM_PHASE_BADGE);
    expect(dimLightBadge("dim", "manual")).toBeNull();
    expect(dimLightBadge("dim", "difficulty")).toBe(DIM_PHASE_BADGE);
    expect(dimLightBadge("day")).toBeNull();
    expect(dimLightBadge("night", "book")).toBeNull();
  });

  it("C2 hiddenLabel names the bare Hidden and Cloaked", () => {
    expect(hiddenLabel({ conditions: ["hidden"], effects: [] })).toBe("Hidden");
    expect(hiddenLabel({ conditions: ["cloaked", "hidden"], effects: [] })).toBe("Hidden and Cloaked");
    expect(hiddenLabel({ conditions: ["vulnerable"], effects: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------- C2 on a move

describe("C2 Hidden / Cloaked end on a move (CB p.102)", () => {
  it("Book: Cloaked ends in clear sight, no note", async () => {
    const a = await arena({});
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect((await a.sheet()).conditions).not.toContain("cloaked");
    expect(await a.notes()).toHaveLength(0);
  });

  it("Manual: Cloaked stays in clear sight; one GM note naming the enemy, undone with the move's group", async () => {
    const a = await arena({ hiddenEnds: "manual" });
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect((await a.sheet()).conditions).toContain("cloaked");
    const notes = await a.notes();
    expect(notes.map((n) => [n.ruleId, n.visibility, n.summary])).toEqual([["hiddenEnds", "gm", `${(await a.sheet()).name} moved into Bear's sight: remove Cloaked?`]]);
    expect(notes[0]!.groupId).toBeDefined();
    expect(notes[0]!.characterId).toBeUndefined();
    // Players never receive it.
    const feed = await a.player.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(JSON.stringify(feed.page)).not.toContain("remove Cloaked?");
    const gmFeed = await a.gm.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(JSON.stringify(gmFeed.page)).toContain("remove Cloaked?");
  });

  it("Manual: a Hidden PC's move into sight is noted too; nothing changes", async () => {
    const a = await arena({ hiddenEnds: "manual" }, ["hidden"]);
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect((await a.sheet()).conditions).toEqual(["hidden"]);
    expect((await a.notes()).map((n) => n.summary)).toEqual([`${(await a.sheet()).name} moved into Bear's sight: remove Hidden?`]);
  });

  it("Book: a Hidden PC who moves into an enemy's clear sight is no longer Hidden (user 2026-11-06, CB p.102)", async () => {
    const a = await arena({}, ["hidden"]);
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect((await a.sheet()).conditions).not.toContain("hidden");
    expect(await a.notes()).toHaveLength(0);
  });

  it("Manual: no note when no enemy sees the PC (a wall between)", async () => {
    const a = await arena({ hiddenEnds: "manual" });
    await a.setTime(DAY);
    await a.gm.mutation(api.combatMapEdit.paintCells, { campaignId: a.campaignId, mapId: a.mapId, squares: column(10), paint: "wall" });
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect(await a.notes()).toHaveLength(0);
  });

  it("Manual: in dim light no Finesse roll, no Difficulty request; the note says dim light", async () => {
    const a = await arena({ hiddenEnds: "manual" });
    await a.setTime(NIGHT);
    await a.enemy(7, 10, 18);
    dice(3, 8);
    await a.move(4, 10);
    expect((await a.sheet()).conditions).toContain("cloaked");
    expect((await a.rows()).some((r) => r.kind === "roll")).toBe(false);
    expect(await a.requests()).toHaveLength(0);
    expect((await a.notes()).map((n) => n.summary)).toEqual([`${(await a.sheet()).name} moved into Bear's sight in dim light: remove Cloaked?`]);
  });

  it("Book: in dim light the Finesse roll is made (unchanged)", async () => {
    const a = await arena({});
    await a.setTime(NIGHT);
    await a.enemy(7, 10, 18);
    dice(3, 8);
    await a.move(4, 10);
    expect((await a.rows()).some((r) => r.kind === "roll" && r.summary.includes("Finesse"))).toBe(true);
    expect(await a.notes()).toHaveLength(0);
  });

  it("Manual: an unconscious rogue still drops Cloaked (not C2)", async () => {
    const a = await arena({ hiddenEnds: "manual" });
    await a.edit({ conditions: ["cloaked", "unconscious"] });
    await a.move(4, 10, a.gm);
    expect((await a.sheet()).conditions).not.toContain("cloaked");
  });
});

// ---------------------------------------------------------------- C2 on an attack and a non-attack use

describe("C2 on an attack outside the attack path and on a non-attack use", () => {
  it("uncloakAfterAttack: Book ends Cloaked; Manual keeps it and notes it in the group", async () => {
    const book = await arena({});
    const ended = await book.t.run(async (ctx) => uncloakAfterAttack(ctx, (await ctx.db.get("campaigns", book.campaignId))!, book.w.characterA, (await ctx.db.query("users").first())!._id, "Charge"));
    expect(ended).toBe(true);
    expect((await book.sheet()).conditions).not.toContain("cloaked");

    const manual = await arena({ hiddenEnds: "manual" }, ["cloaked", "hidden"]);
    const kept = await manual.t.run(async (ctx) =>
      uncloakAfterAttack(ctx, (await ctx.db.get("campaigns", manual.campaignId))!, manual.w.characterA, (await ctx.db.query("users").first())!._id, "Charge", { groupId: "g-charge" }),
    );
    expect(kept).toBe(false);
    expect((await manual.sheet()).conditions).toEqual(["cloaked", "hidden"]);
    expect((await manual.notes()).map((n) => [n.summary, n.groupId])).toEqual([[`${(await manual.sheet()).name} attacks with Charge: remove Hidden and Cloaked?`, "g-charge"]]);
  });

  async function prompt(modes: Modes) {
    const a = await arena(modes);
    const foe = await a.enemy(6, 10);
    const id = await a.t.run(async (ctx) =>
      openCloakPrompt(ctx, {
        campaign: (await ctx.db.get("campaigns", a.campaignId))!,
        characterId: a.w.characterA,
        tokenId: a.ash,
        mapId: a.mapId,
        encounterId: a.encounterId,
        label: "Words of Discord",
        groupId: "g-use",
        targetTokenIds: [foe as Id<"combatTokens">],
        createdBy: (await ctx.db.query("users").first())!._id,
      }),
    );
    return { a, id };
  }

  it("openCloakPrompt: Book opens the GM's prompt", async () => {
    const { a, id } = await prompt({});
    expect(id).not.toBeNull();
    expect((await a.requests()).map((r) => r.kind)).toEqual(["cloakPrompt"]);
    expect(await a.notes()).toHaveLength(0);
  });

  it("openCloakPrompt: Manual opens nothing; a note in the use's group", async () => {
    const { a, id } = await prompt({ hiddenEnds: "manual" });
    expect(id).toBeNull();
    expect(await a.requests()).toHaveLength(0);
    expect((await a.notes()).map((n) => [n.ruleId, n.groupId, n.summary])).toEqual([["hiddenEnds", "g-use", `${(await a.sheet()).name} used Words of Discord on an enemy while Cloaked: remove Cloaked?`]]);
  });
});

// ---------------------------------------------------------------- M2

describe("M2 Walls and doors stop tokens (app rule, not in the books)", () => {
  it("App rule: a player's move through a wall is MOVE_BLOCKED; the GM's goes through flagged", async () => {
    const a = await arena({}, []);
    await a.gm.mutation(api.combatMapEdit.paintCells, { campaignId: a.campaignId, mapId: a.mapId, squares: column(4), paint: "wall" });
    expect(errorCode(await a.move(6, 10).catch((e: unknown) => e))).toBe("MOVE_BLOCKED");
    expect(await a.move(6, 10, a.gm)).toMatchObject({ x: 6, blocked: true });
    expect(await a.notes()).toHaveLength(0);
  });

  it("Manual: a player's token passes the wall unflagged; the GM gets a note", async () => {
    const a = await arena({ wallsBlock: "manual" }, []);
    await a.gm.mutation(api.combatMapEdit.paintCells, { campaignId: a.campaignId, mapId: a.mapId, squares: column(4), paint: "wall" });
    expect(await a.move(6, 10)).toMatchObject({ x: 6, y: 10, blocked: false, difficult: false });
    const name = (await a.sheet()).name;
    const notes = await a.notes();
    expect(notes.map((n) => [n.ruleId, n.visibility, n.summary])).toEqual([["wallsBlock", "gm", `${name} moved through a wall or closed door: move the token back?`]]);
    // Undo of the note takes nothing else (the move itself is not in the log).
    await a.gm.mutation(api.actionLog.undo, { entryId: notes[0]!._id, idempotencyKey: key() });
  });

  it("Manual: difficult terrain is not flagged, a note asks for the movement roll; the GM's drag posts nothing", async () => {
    const a = await arena({ wallsBlock: "manual" }, []);
    await a.gm.mutation(api.combatMapEdit.paintCells, { campaignId: a.campaignId, mapId: a.mapId, squares: column(4), paint: "water" });
    expect(await a.move(6, 10)).toMatchObject({ difficult: false });
    expect((await a.notes()).map((n) => n.summary)).toEqual([`${(await a.sheet()).name} crossed difficult terrain: a movement roll?`]);
    await a.move(2, 10, a.gm);
    expect(await a.notes()).toHaveLength(1);
  });
});
