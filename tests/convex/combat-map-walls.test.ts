import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_WALL_POINTS, MAX_WALL_RUNS, wallSquares } from "../../convex/lib/combatMapWalls";
import { loadScene } from "../../convex/lib/combatVision";
import { lineOfSight } from "../../src/lib/domain/combat-actions/index";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, setupWithCampaign } from "./helpers";

// Drawn walls on the server (plan .omc/plans/map-editor.yaml, tracer ME4; docs/tasks/TASK-ME4.md): the GM's edits
// (combatMapWalls.add / update / moveVertex / split / remove / setRevealed) and their caps, what players receive
// (an unrevealed secret door is a plain wall), movement, vision and attack sight reading the walls, toggleDoor on a
// door in a wall (D7/D8 reach rule), and walls going with their map and their campaign.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];
type Point = [number, number];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0]!.id,
    ancestry: { kind: "single" as const, id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
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

/**
 * A live 30 x 20 map without painted walls. The player's Ash stands at (5, 10) looking east; the GM's Bryn is in the
 * top-left corner; a Goblin waits at (15, 10), in Ash's view until a wall goes up between them.
 */
async function withMap() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const list = await gm.query(api.combatTokensReads.list, { campaignId, mapId });
  const ashToken = list.find((tk) => tk.name === "Ash")!._id;
  const brynToken = list.find((tk) => tk.name === "Bryn")!._id;
  const place = (tokenId: Id<"combatTokens">, x: number, y: number, face = 0) => t.run((c) => c.db.patch("combatTokens", tokenId, { x, y, face }));
  await place(ashToken, 5, 10, 0);
  await place(brynToken, 1, 1, Math.PI);
  const { tokenId: goblin } = await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Goblin", hp: 3, side: "enemy", idempotencyKey: key() });
  await place(goblin, 15, 10, Math.PI);
  type Kind = "wall" | "door" | "window" | "secret" | "low" | "oneway";
  const addWall = async (kind: Kind, points: Point[], extra: { side?: "left" | "right"; style?: "stone" | "wood" | "cave" | "hedge" } = {}) =>
    (await gm.mutation(api.combatMapWalls.add, { campaignId, mapId, kind, points, ...extra })).wallId;
  /** The column x = 10 walled from top to bottom, with a `kind` run on (10, 10)-(10, 11) in front of Ash's row. */
  const wallWith = async (kind: Kind) => {
    await addWall("wall", [[10, 0], [10, 10]]);
    const middle = await addWall(kind, [[10, 10], [10, 11]]);
    await addWall("wall", [[10, 11], [10, 20]]);
    return middle;
  };
  const sees = async () => {
    const v = await player.query(api.combatVision.playerView, { campaignId });
    if (v.state !== "ok") throw new Error(`expected a view, got ${v.state}`);
    return v.others.map((o) => o.name);
  };
  const moveAsh = (x: number, y: number) => player.mutation(api.combatTokens.move, { campaignId, tokenId: ashToken, x, y });
  const walls = (c: Client) => c.query(api.combatMapWalls.list, { campaignId });
  const wallRow = (id: Id<"combatMapWalls">) => t.run((c) => c.db.get("combatMapWalls", id));
  const wallCount = (id: Id<"combatMaps"> = mapId) => t.run(async (c) => (await c.db.query("combatMapWalls").withIndex("by_map", (q) => q.eq("mapId", id)).collect()).length);
  return { t, gm, player, campaignId, mapId, ashToken, goblin, place, addWall, wallWith, sees, moveAsh, walls, wallRow, wallCount };
}

describe("combat map walls: GM edits", () => {
  it("adds, lists, updates, moves a vertex, splits and removes runs; points are clamped onto the map", async () => {
    const f = await withMap();
    const { gm, campaignId } = f;
    const id = await f.addWall("oneway", [[2, 2], [8, 2], [40, -3]], { side: "right", style: "wood" });
    expect(await f.wallRow(id)).toMatchObject({ kind: "oneway", points: [[2, 2], [8, 2], [30, 0]], side: "right", style: "wood" });
    expect((await f.walls(gm))?.walls).toEqual([{ _id: id, kind: "oneway", points: [[2, 2], [8, 2], [30, 0]], side: "right", style: "wood" }]);

    // A new kind keeps only what it uses: the one-way side goes; style null is the default style.
    await gm.mutation(api.combatMapWalls.update, { campaignId, wallId: id, kind: "low", style: null });
    expect(await f.wallRow(id)).not.toHaveProperty("side");
    expect(await f.wallRow(id)).not.toHaveProperty("style");
    expect(await code(gm.mutation(api.combatMapWalls.update, { campaignId, wallId: id }))).toBe("INVALID");

    await gm.mutation(api.combatMapWalls.moveVertex, { campaignId, wallId: id, index: 1, x: 8.5, y: 99 });
    expect((await f.wallRow(id))?.points).toEqual([[2, 2], [8.5, 20], [30, 0]]);
    expect(await code(gm.mutation(api.combatMapWalls.moveVertex, { campaignId, wallId: id, index: 3, x: 1, y: 1 }))).toBe("INVALID");
    expect(await code(gm.mutation(api.combatMapWalls.moveVertex, { campaignId, wallId: id, index: 0, x: Number.NaN, y: 1 }))).toBe("INVALID");

    // Split at an inner point: the first part keeps the id, the second copies the kind.
    const { first, second } = await gm.mutation(api.combatMapWalls.split, { campaignId, wallId: id, index: 1 });
    expect(first).toBe(id);
    expect((await f.wallRow(first))?.points).toEqual([[2, 2], [8.5, 20]]);
    expect(await f.wallRow(second)).toMatchObject({ kind: "low", points: [[8.5, 20], [30, 0]] });
    expect(await code(gm.mutation(api.combatMapWalls.split, { campaignId, wallId: first, index: 1 }))).toBe("INVALID");

    // Split inside a segment with a new point (how the editor inserts a door into a wall).
    const door = await gm.mutation(api.combatMapWalls.split, { campaignId, wallId: first, index: 0, at: { x: 5, y: 11 } });
    expect((await f.wallRow(door.first))?.points).toEqual([[2, 2], [5, 11]]);
    expect((await f.wallRow(door.second))?.points).toEqual([[5, 11], [8.5, 20]]);
    // A split point on the run's end would leave a part with no segment.
    expect(await code(gm.mutation(api.combatMapWalls.split, { campaignId, wallId: first, index: 0, at: { x: 2, y: 2 } }))).toBe("INVALID");

    await gm.mutation(api.combatMapWalls.remove, { campaignId, wallId: second });
    expect(await f.wallRow(second)).toBeNull();
    expect(await code(gm.mutation(api.combatMapWalls.remove, { campaignId, wallId: second }))).toBe("COMBAT_WALL_NOT_FOUND");
    expect(await code(gm.mutation(api.combatMapWalls.remove, { campaignId, wallId: "nope" }))).toBe("COMBAT_WALL_NOT_FOUND");
    expect((await f.walls(gm))?.walls.map((w) => w._id)).toEqual([door.first, door.second]);
  });

  it("refuses more than 400 runs per map and points outside 2..64 (COMBAT_WALL_LIMIT, INVALID)", async () => {
    const f = await withMap();
    const { gm, campaignId, mapId } = f;
    expect(MAX_WALL_RUNS).toBe(400);
    expect(MAX_WALL_POINTS).toBe(64);
    const line = (i: number): Point[] => [[i % 30, 0], [i % 30, 1]];
    expect(await code(f.addWall("wall", [[1, 1]]))).toBe("INVALID");
    expect(await code(f.addWall("wall", [[1, 1], [1, 1]]))).toBe("INVALID");
    expect(await code(f.addWall("wall", Array.from({ length: 65 }, (_, i): Point => [i % 30, Math.floor(i / 30)])))).toBe("INVALID");
    expect(await code(gm.mutation(api.combatMapWalls.add, { campaignId, mapId, kind: "wall", points: [[1, 1, 1], [2, 2]] }))).toBe("INVALID");
    const longest = await f.addWall("wall", Array.from({ length: 64 }, (_, i): Point => [i % 30, Math.floor(i / 30)]));
    await f.t.run(async (c) => {
      for (let i = 1; i < MAX_WALL_RUNS; i++) await c.db.insert("combatMapWalls", { mapId, kind: "wall", points: line(i) });
    });
    expect(await f.wallCount()).toBe(400);
    expect(await code(f.addWall("wall", [[1, 1], [2, 2]]))).toBe("COMBAT_WALL_LIMIT");
    expect(await code(gm.mutation(api.combatMapWalls.split, { campaignId, wallId: longest, index: 5 }))).toBe("COMBAT_WALL_LIMIT");
    await gm.mutation(api.combatMapWalls.remove, { campaignId, wallId: longest });
    expect(await code(f.addWall("wall", [[1, 1], [2, 2]]))).toBe("ok");
  });

  it("keeps every wall inside its campaign", async () => {
    const f = await withMap();
    const { gm, campaignId } = f;
    const { campaignId: otherCampaign } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const { mapId: otherMap } = await gm.mutation(api.combatMaps.create, { campaignId: otherCampaign, size: "small", idempotencyKey: key() });
    const { wallId } = await gm.mutation(api.combatMapWalls.add, { campaignId: otherCampaign, mapId: otherMap, kind: "door", points: [[1, 1], [2, 1]] });
    expect(await code(gm.mutation(api.combatMapWalls.add, { campaignId, mapId: otherMap, kind: "wall", points: [[1, 1], [2, 1]] }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(gm.query(api.combatMapWalls.list, { campaignId, mapId: otherMap }))).toBe("COMBAT_MAP_NOT_FOUND");
    for (const call of [
      gm.mutation(api.combatMapWalls.update, { campaignId, wallId, kind: "wall" }),
      gm.mutation(api.combatMapWalls.moveVertex, { campaignId, wallId, index: 0, x: 3, y: 3 }),
      gm.mutation(api.combatMapWalls.split, { campaignId, wallId, index: 0, at: { x: 1.5, y: 1 } }),
      gm.mutation(api.combatMapWalls.remove, { campaignId, wallId }),
      gm.mutation(api.combatMapWalls.setRevealed, { campaignId, wallId, revealed: true }),
    ]) {
      expect(await code(call)).toBe("COMBAT_WALL_NOT_FOUND");
    }
    expect(await code(gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: wallId, open: true }))).toBe("COMBAT_OBJECT_NOT_FOUND");
    expect(await f.wallRow(wallId)).toMatchObject({ kind: "door", points: [[1, 1], [2, 1]] });
  });

  it("reveals and hides only secret doors; hiding one forgets that it was open", async () => {
    const f = await withMap();
    const { gm, campaignId } = f;
    const plain = await f.addWall("door", [[3, 3], [4, 3]]);
    const secret = await f.addWall("secret", [[5, 3], [6, 3]]);
    expect(await code(gm.mutation(api.combatMapWalls.setRevealed, { campaignId, wallId: plain, revealed: true }))).toBe("INVALID");
    await gm.mutation(api.combatMapWalls.setRevealed, { campaignId, wallId: secret, revealed: true });
    await gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: secret, open: true });
    expect(await f.wallRow(secret)).toMatchObject({ revealed: true, open: true });
    await gm.mutation(api.combatMapWalls.setRevealed, { campaignId, wallId: secret, revealed: false });
    const row = await f.wallRow(secret);
    expect(row).not.toHaveProperty("revealed");
    expect(row).not.toHaveProperty("open");
    // The kind changing away from secret drops `revealed` too.
    await gm.mutation(api.combatMapWalls.setRevealed, { campaignId, wallId: secret, revealed: true });
    await gm.mutation(api.combatMapWalls.update, { campaignId, wallId: secret, kind: "door" });
    expect(await f.wallRow(secret)).not.toHaveProperty("revealed");
  });
});

describe("combat map walls: what players receive", () => {
  it("a player's map query returns an unrevealed secret door as a plain wall; the GM gets it as stored", async () => {
    const f = await withMap();
    const { gm, player, campaignId, mapId } = f;
    const secret = await f.addWall("secret", [[10, 10], [10, 11]], { style: "stone" });
    await f.t.run((c) => c.db.patch("combatMapWalls", secret, { open: true }));

    expect(await f.walls(player)).toEqual({ mapId, walls: [{ _id: secret, kind: "wall", points: [[10, 10], [10, 11]], style: "stone" }] });
    expect(await f.walls(gm)).toEqual({ mapId, walls: [{ _id: secret, kind: "secret", points: [[10, 10], [10, 11]], open: true, style: "stone" }] });

    await gm.mutation(api.combatMapWalls.setRevealed, { campaignId, wallId: secret, revealed: true });
    expect((await f.walls(player))?.walls).toEqual([{ _id: secret, kind: "secret", points: [[10, 10], [10, 11]], revealed: true, style: "stone" }]);
  });

  it("players read only the live map's walls; the GM reads any map's", async () => {
    const f = await withMap();
    const { gm, player, campaignId } = f;
    const { mapId: other } = await gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    await gm.mutation(api.combatMapWalls.add, { campaignId, mapId: other, kind: "wall", points: [[1, 1], [2, 1]] });
    expect(await code(player.query(api.combatMapWalls.list, { campaignId, mapId: other }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect((await gm.query(api.combatMapWalls.list, { campaignId, mapId: other }))?.walls).toHaveLength(1);
    expect(await f.walls(player)).toEqual({ mapId: f.mapId, walls: [] });
  });
});

describe("combat map walls: movement, vision and attack sight", () => {
  it("a wall blocks sight and movement, a window only movement; without the run both pass", async () => {
    const f = await withMap();
    const { gm, campaignId } = f;
    expect(await f.sees()).toEqual(["Goblin"]);
    const wall = await f.wallWith("wall");
    expect(await f.sees()).toEqual([]);
    expect(await code(f.moveAsh(12, 10))).toBe("MOVE_BLOCKED");

    await gm.mutation(api.combatMapWalls.update, { campaignId, wallId: wall, kind: "window" });
    expect(await f.sees()).toEqual(["Goblin"]);
    expect(await code(f.moveAsh(12, 10))).toBe("MOVE_BLOCKED");

    await gm.mutation(api.combatMapWalls.remove, { campaignId, wallId: wall });
    expect(await f.moveAsh(12, 10)).toMatchObject({ blocked: false });
  });

  it("a one-way wall passes sight from its open side only and blocks movement both ways", async () => {
    const f = await withMap();
    const { gm, campaignId } = f;
    // Drawn southwards: its open side is east (TASK-ME1), away from Ash.
    const run = await f.addWall("oneway", [[10, 0], [10, 20]]);
    expect(await f.sees()).toEqual([]);
    await gm.mutation(api.combatMapWalls.update, { campaignId, wallId: run, side: "right" });
    expect(await f.sees()).toEqual(["Goblin"]);
    expect(await code(f.moveAsh(12, 10))).toBe("MOVE_BLOCKED");
  });

  it("a low wall makes the step across it difficult and puts a target behind it in cover (attack sight)", async () => {
    const f = await withMap();
    const { campaignId } = f;
    await f.wallWith("low");
    // The low wall at (10, 10)-(10, 11) stands between Ash and the Goblin; the walls above and below it block.
    expect(await f.sees()).toEqual(["Goblin"]);
    const sight = () =>
      f.t.run(async (c) => {
        const campaign = (await c.db.get("campaigns", campaignId))!;
        const map = (await c.db.get("combatMaps", f.mapId))!;
        const scene = await loadScene(c, campaign, map);
        const ash = (await c.db.get("combatTokens", f.ashToken))!;
        const goblin = (await c.db.get("combatTokens", f.goblin))!;
        return lineOfSight(scene.prepared, ash, goblin, scene.visionObjects);
      });
    expect(await sight()).toEqual({ lineOfSight: true, cover: true });
    expect(await f.moveAsh(11, 10)).toMatchObject({ blocked: false, difficult: true });
  });

  it("a closed wall door hides and stops; the player opens it from Melee, never when unseen or out of reach", async () => {
    const f = await withMap();
    const { gm, player, campaignId } = f;
    const door = await f.wallWith("door");
    // North of Ash, outside the cone looking east, and never explored.
    const unseen = await f.addWall("door", [[6, 3], [7, 3]]);
    expect(await f.sees()).toEqual([]);
    expect(await code(f.moveAsh(12, 10))).toBe("MOVE_BLOCKED");

    const listed = await player.query(api.combatVision.doors, { campaignId });
    expect(listed?.wallDoors).toEqual([{ _id: door, points: [[10, 10], [10, 11]], open: false, reach: false }]);
    expect((await gm.query(api.combatVision.doors, { campaignId }))?.wallDoors?.map((d) => d._id)).toEqual([door, unseen]);

    expect(await code(player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: true }))).toBe("COMBAT_OBJECT_NOT_FOUND");
    expect(await code(player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true }))).toBe("COMBAT_OUT_OF_REACH");
    // A wall run the player sees is no door.
    const wallRun = (await f.walls(gm))!.walls[0]!._id;
    await f.place(f.ashToken, 9, 5, 0);
    expect(await code(player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: wallRun, open: true }))).toBe("INVALID");

    await f.place(f.ashToken, 9, 10, 0);
    expect((await player.query(api.combatVision.doors, { campaignId }))?.wallDoors).toEqual([{ _id: door, points: [[10, 10], [10, 11]], open: false, reach: true }]);
    expect(await player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true })).toEqual({ open: true });
    expect((await f.wallRow(door))?.open).toBe(true);
    expect(await f.sees()).toEqual(["Goblin"]);
    expect(await f.moveAsh(12, 10)).toMatchObject({ blocked: false });

    // Through and turned away: switching it stored the door as explored, so it is still Ash's to close (dcm-bxp.121).
    await f.place(f.ashToken, 11, 10, 0);
    expect(await player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: false })).toEqual({ open: false });
    expect(await f.wallRow(door)).not.toHaveProperty("open");
    // The GM switches any door, seen or not, from anywhere.
    expect(await gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: true })).toEqual({ open: true });
  });

  it("an unrevealed secret door is a wall to players (never listed, refused as a wall); revealed, it opens as a door", async () => {
    const f = await withMap();
    const { gm, player, campaignId } = f;
    const secret = await f.wallWith("secret");
    await f.place(f.ashToken, 9, 10, 0);
    expect(await f.sees()).toEqual([]);
    expect((await player.query(api.combatVision.doors, { campaignId }))?.wallDoors).toEqual([]);
    expect((await gm.query(api.combatVision.doors, { campaignId }))?.wallDoors).toEqual([]);
    expect(await code(player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: secret, open: true }))).toBe("INVALID");
    expect(await code(gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: secret, open: true }))).toBe("INVALID");
    expect(await code(f.moveAsh(12, 10))).toBe("MOVE_BLOCKED");

    await gm.mutation(api.combatMapWalls.setRevealed, { campaignId, wallId: secret, revealed: true });
    expect((await player.query(api.combatVision.doors, { campaignId }))?.wallDoors).toEqual([{ _id: secret, points: [[10, 10], [10, 11]], open: false, reach: true }]);
    expect(await f.sees()).toEqual([]);
    await player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: secret, open: true });
    expect(await f.sees()).toEqual(["Goblin"]);
    expect(await f.moveAsh(12, 10)).toMatchObject({ blocked: false });
  });

  it("a wall door's reach covers the squares on both sides of it, not the squares past its ends", () => {
    expect(wallSquares([[10, 10], [10, 11]], 30, 20).sort((a, b) => a.x - b.x)).toEqual([{ x: 9, y: 10 }, { x: 10, y: 10 }]);
    // A diagonal run from corner to corner touches only the squares it passes through.
    expect(wallSquares([[2, 2], [4, 4]], 30, 20).sort((a, b) => a.x - b.x)).toEqual([{ x: 2, y: 2 }, { x: 3, y: 3 }]);
  });
});

describe("combat map walls: deleting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deleting a map deletes its walls, in scheduled batches past one transaction's budget", async () => {
    vi.useFakeTimers();
    const f = await withMap();
    const { gm, campaignId, mapId } = f;
    // 1000 objects (a corrupt map past the cap) fill the first batch, so the walls go in the continuation.
    await f.t.run(async (c) => {
      for (let i = 0; i < 1000; i++) await c.db.insert("combatMapObjects", { mapId, kind: "tree", x: i % 30, y: 3, r: 1, rot: 0 });
      for (let i = 0; i < 50; i++) await c.db.insert("combatMapWalls", { mapId, kind: "wall", points: [[i % 30, 0], [i % 30, 1]] });
    });
    await gm.mutation(api.combatMaps.remove, { campaignId, mapId });
    expect(await f.wallCount()).toBe(50);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.wallCount()).toBe(0);
  });

  it("purging a campaign deletes its maps' walls, in batches, and leaves other campaigns' walls", async () => {
    vi.useFakeTimers();
    const f = await withMap();
    const { gm, campaignId, mapId } = f;
    const { campaignId: keptCampaign } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Kept", idempotencyKey: key() });
    const { mapId: keptMap } = await gm.mutation(api.combatMaps.create, { campaignId: keptCampaign, size: "small", idempotencyKey: key() });
    await gm.mutation(api.combatMapWalls.add, { campaignId: keptCampaign, mapId: keptMap, kind: "wall", points: [[1, 1], [2, 1]] });
    await f.t.run(async (c) => {
      for (let i = 0; i < MAX_WALL_RUNS; i++) await c.db.insert("combatMapWalls", { mapId, kind: "door", points: [[i % 30, 0], [i % 30, 1]] });
      for (let i = 0; i < 300; i++) await c.db.insert("combatMapObjects", { mapId, kind: "tree", x: i % 30, y: 3, r: 1, rot: 0 });
      await c.db.patch("campaigns", campaignId, { deletedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    });
    await f.t.mutation(internal.cleanup.purgeCampaign, { campaignId });
    // One batch (500 rows) cannot hold the 300 objects, the tokens and the 400 walls.
    expect(await f.wallCount()).toBeGreaterThan(0);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.wallCount()).toBe(0);
    expect(await f.wallCount(keptMap)).toBe(1);
  });
});
