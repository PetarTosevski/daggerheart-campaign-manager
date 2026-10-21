import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BLOCK_CODE, CELL_TILE_ROWS, CELL_UNPAINTED, codeOfTerrain, indexInTile, tileOf } from "../../src/components/combat-map/map-view/cells";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, errorData, key, setupWithCampaign, useAllowlist } from "./helpers";

// Map movement M0 (plan .omc/plans/map-movement.yaml; D1-D4, D6): combatTokens.move refuses a player's move whose
// path crosses or ends on a blocking square (MOVE_BLOCKED, no position); the GM's move goes through and returns
// blocked: true; both return difficult. Blockers: painted wall terrain (areas and cells), Classic blocking kinds,
// sprites whose catalog `move` blocks, closed doors and uploaded sprites by the D1 default.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

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

/** A live medium (30 x 20) grass map; the player's "Ash" stands at (5, 10), the GM's "Bryn" at (5, 14). */
async function withMap() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const tokens = await gm.query(api.combatTokens.list, { campaignId, mapId });
  const ash = tokens.find((tk) => tk.name === "Ash")!._id;
  const bryn = tokens.find((tk) => tk.name === "Bryn")!._id;
  const place = (tokenId: Id<"combatTokens">, x: number, y: number, size = 1) =>
    t.run((c) => c.db.patch("combatTokens", tokenId, { x, y, size }));
  await place(ash, 5, 10);
  await place(bryn, 5, 14);
  const move = (c: Client, tokenId: Id<"combatTokens">, x: number, y: number) => c.mutation(api.combatTokens.move, { campaignId, tokenId, x, y });
  const at = (tokenId: Id<"combatTokens">) => t.run(async (c) => (await c.db.get("combatTokens", tokenId))!);
  const object = (o: {
    kind: string;
    x: number;
    y: number;
    r?: number;
    rot?: number;
    sprite?: { builtin: string } | { uploaded: Id<"spritePackSprites"> };
  }) =>
    t.run((c) =>
      c.db.insert("combatMapObjects", {
        mapId,
        kind: o.kind as "pillar",
        x: o.x,
        y: o.y,
        r: o.r ?? 1,
        rot: o.rot ?? 0,
        ...(o.sprite === undefined ? {} : { sprite: o.sprite }),
      }),
    );
  /** Paints one square's terrain cell (the "terrain" layer tile). */
  const paint = (x: number, y: number, terrain: "wall" | "water") =>
    t.run(async (c) => {
      const w = 30;
      const cells = CELL_UNPAINTED.repeat(CELL_TILE_ROWS * w).split("");
      cells[indexInTile(x, y, w)] = codeOfTerrain(terrain);
      await c.db.insert("combatMapCells", { mapId, layer: "terrain", tile: tileOf(y), cells: cells.join("") });
    });
  /** Paints one square of the GM's sight blockers (the "block" layer tile). */
  const paintBlocker = (x: number, y: number) =>
    t.run(async (c) => {
      const w = 30;
      const cells = CELL_UNPAINTED.repeat(CELL_TILE_ROWS * w).split("");
      cells[indexInTile(x, y, w)] = BLOCK_CODE;
      await c.db.insert("combatMapCells", { mapId, layer: "block", tile: tileOf(y), cells: cells.join("") });
    });
  const gmId = await t.run(async (c) => (await c.db.query("users").first())!._id);
  const uploaded = (sight: "block" | "cover" | "none", height: "flat" | "low" | "tall") =>
    t.run(async (c) => {
      const packId = await c.db.insert("spritePacks", { campaignId, name: "Mine", createdBy: gmId, createdAt: 1, updatedAt: 1 });
      const storageId = await c.storage.store(new Blob([new Uint8Array(8)], { type: "image/webp" }));
      const fileId = await c.db.insert("files", { storageId, campaignId, uploadedBy: gmId, kind: "sprite", refId: "pending", createdAt: 1 });
      const id = await c.db.insert("spritePackSprites", {
        campaignId,
        packId,
        fileId,
        name: "Standing stone",
        slug: "standing-stone",
        category: "object",
        w: 1,
        h: 1,
        sight,
        light: "none",
        height,
        footprint: "rect",
        classicKind: "crate",
        px: { w: 160, h: 160 },
        order: 0,
        createdAt: 1,
      });
      await c.db.patch("files", fileId, { refId: id });
      return id;
    });
  return { ...ctx, player, mapId, ash, bryn, place, move, at, object, paint, paintBlocker, uploaded };
}

/** A third account outside the campaign. */
async function outsider(t: Setup["t"]) {
  const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
  return t.withIdentity({ subject: `${id}|session` });
}

describe("combatTokens.move: roles (D3)", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("anonymous, outsider, player on own and on another token, GM: codes and the widened return", async () => {
    const f = await withMap();
    await f.object({ kind: "pillar", x: 10.5, y: 10.5 });
    const out = await outsider(f.t);

    expect(await code(f.move(f.t as unknown as Client, f.ash, 15, 10))).toBe("UNAUTHENTICATED");
    expect(await code(f.move(out, f.ash, 15, 10))).toBe("NOT_FOUND");
    expect(await code(f.move(f.player, f.bryn, 5, 15))).toBe("COMBAT_NOT_YOUR_TOKEN");

    // The player's own token: through the pillar is refused and the token stays; around it is fine.
    expect(await code(f.move(f.player, f.ash, 15, 10))).toBe("MOVE_BLOCKED");
    expect(await f.at(f.ash)).toMatchObject({ x: 5, y: 10 });
    expect(await f.move(f.player, f.ash, 8, 13)).toEqual({ x: 8, y: 13, face: expect.any(Number), blocked: false, difficult: false });

    // The GM moves any token through anything and is told it crossed (here: ended on) a blocker.
    expect(await f.move(f.gm, f.bryn, 5, 15)).toMatchObject({ x: 5, y: 15, blocked: false, difficult: false });
    expect(await f.move(f.gm, f.ash, 10, 10)).toMatchObject({ x: 10, y: 10, blocked: true, difficult: false });
    expect(await f.at(f.ash)).toMatchObject({ x: 10, y: 10 });
  });

  it("MOVE_BLOCKED carries no position (D6)", async () => {
    const f = await withMap();
    await f.object({ kind: "boulder", x: 8.5, y: 10.5 });
    const error = await f.move(f.player, f.ash, 12, 10).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorData(error)).toEqual({ code: "MOVE_BLOCKED" });
  });

  it("a move to the square the token stands on is never blocked", async () => {
    const f = await withMap();
    await f.paint(5, 10, "wall");
    expect(await f.move(f.player, f.ash, 5, 10)).toMatchObject({ blocked: false, difficult: false });
    // Standing on a wall, the token may still step off it.
    expect(await f.move(f.player, f.ash, 4, 10)).toMatchObject({ x: 4, blocked: false });
  });
});

describe("combatTokens.move: what blocks and what is difficult (D1, D2)", () => {
  useAllowlist();

  it("painted wall terrain blocks, from a cell and from an area", async () => {
    const f = await withMap();
    await f.paint(8, 10, "wall");
    expect(await code(f.move(f.player, f.ash, 12, 10))).toBe("MOVE_BLOCKED");
    await f.t.run((c) => c.db.patch("combatMaps", f.mapId, { areas: [{ terrain: "void", shape: "rect", x: 3, y: 12, w: 5, h: 1 }] }));
    expect(await code(f.move(f.player, f.ash, 5, 15))).toBe("MOVE_BLOCKED");
    expect(await f.move(f.player, f.ash, 5, 11)).toMatchObject({ blocked: false });
  });

  it("the GM's painted sight blockers block movement", async () => {
    const f = await withMap();
    await f.paintBlocker(8, 10);
    expect(await code(f.move(f.player, f.ash, 12, 10))).toBe("MOVE_BLOCKED");
    expect(await f.move(f.player, f.ash, 12, 13)).toMatchObject({ blocked: false });
  });

  it("a ship's deck (a Classic hull's outline) over deep water is neither blocked nor difficult; its masts block", async () => {
    const f = await withMap();
    await f.t.run(async (c) => {
      await c.db.patch("combatMaps", f.mapId, { base: "deep" });
      await c.db.insert("combatMapObjects", { mapId: f.mapId, kind: "hull", x: 10, y: 10, r: 1, rot: 0, points: [[3, 7], [18, 7], [20, 10], [18, 13], [3, 13]] });
    });
    await f.object({ kind: "mast", x: 12.5, y: 8.5 });
    expect(await f.move(f.player, f.ash, 15, 10)).toMatchObject({ x: 15, blocked: false, difficult: false });
    expect(await code(f.move(f.player, f.ash, 11, 7))).toBe("MOVE_BLOCKED");
    // Over the side: deep water.
    expect(await f.move(f.player, f.ash, 15, 16)).toMatchObject({ y: 16, difficult: true });
  });

  it("water is difficult, never blocking; Classic rubble is difficult", async () => {
    const f = await withMap();
    await f.paint(7, 10, "water");
    expect(await f.move(f.player, f.ash, 9, 10)).toMatchObject({ x: 9, blocked: false, difficult: true });
    await f.object({ kind: "rubble", x: 9.5, y: 12.5 });
    expect(await f.move(f.player, f.ash, 9, 14)).toMatchObject({ y: 14, difficult: true });
    expect(await f.move(f.player, f.ash, 12, 14)).toMatchObject({ difficult: false });
  });

  it("a cottage sprite blocks; the garden plot is difficult; a fence blocks and a closed gate blocks too", async () => {
    const f = await withMap();
    await f.object({ kind: "pillar", x: 10.5, y: 10.5, r: 1.5, sprite: { builtin: "town-street-and-market/thatched-cottage" } });
    expect(await code(f.move(f.player, f.ash, 15, 10))).toBe("MOVE_BLOCKED");
    await f.object({ kind: "rubble", x: 10.5, y: 15.5, r: 1.5, sprite: { builtin: "town-street-and-market/vegetable-garden-plot" } });
    await f.place(f.ash, 5, 15);
    expect(await f.move(f.player, f.ash, 15, 15)).toMatchObject({ x: 15, blocked: false, difficult: true });
    // A fence (3 x 1) and its gate (3 x 1, a door: closed until M2 adds the switch) across column 20.
    await f.object({ kind: "log", x: 20.5, y: 5.5, rot: Math.PI / 2, sprite: { builtin: "town-street-and-market/wooden-fence-section" } });
    await f.object({ kind: "log", x: 20.5, y: 8.5, rot: Math.PI / 2, sprite: { builtin: "town-street-and-market/wooden-fence-gate" } });
    await f.place(f.ash, 18, 5);
    expect(await code(f.move(f.player, f.ash, 22, 5))).toBe("MOVE_BLOCKED");
    await f.place(f.ash, 18, 8);
    expect(await code(f.move(f.player, f.ash, 22, 8))).toBe("MOVE_BLOCKED");
    // Past the fence's end (row 11) is open.
    await f.place(f.ash, 18, 11);
    expect(await f.move(f.player, f.ash, 22, 11)).toMatchObject({ blocked: false });
  });

  it("an uploaded sprite follows the D1 default from its labels: blocks sight and tall blocks, cover does not", async () => {
    const f = await withMap();
    const stone = await f.uploaded("block", "tall");
    const crate = await f.uploaded("cover", "low");
    await f.object({ kind: "crate", x: 8.5, y: 10.5, sprite: { uploaded: stone } });
    await f.object({ kind: "crate", x: 8.5, y: 12.5, sprite: { uploaded: crate } });
    expect(await code(f.move(f.player, f.ash, 12, 10))).toBe("MOVE_BLOCKED");
    await f.place(f.ash, 5, 12);
    expect(await f.move(f.player, f.ash, 12, 12)).toMatchObject({ blocked: false, difficult: false });
  });

  it("an uploaded image map ignores terrain; its objects still block", async () => {
    const f = await withMap();
    await f.t.run((c) => c.db.patch("combatMaps", f.mapId, { source: "image", base: "wall" }));
    expect(await f.move(f.player, f.ash, 12, 10)).toMatchObject({ blocked: false });
    await f.object({ kind: "statue", x: 14.5, y: 10.5 });
    expect(await code(f.move(f.player, f.ash, 16, 10))).toBe("MOVE_BLOCKED");
  });
});
