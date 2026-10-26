import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { decodeExplored } from "../../src/lib/domain/combat-map/vision";
import type { Id } from "../../convex/_generated/dataModel";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, errorData, key, setupWithCampaign, useAllowlist } from "./helpers";

// Map movement M2 (plan .omc/plans/map-movement.yaml): doors open and close (D7, D8). combatVision.doors lists the doors
// the caller may switch; combatVision.toggleDoor opens or closes one: the GM always, a player only on the live map and
// only a door one of their characters has seen (else COMBAT_OBJECT_NOT_FOUND, as if it were not there) and only from
// Melee (plan d12-bugs B4: a token within 1 square of the door, of a character who has seen it (dcm-bxp.130), else
// COMBAT_OUT_OF_REACH). A closed
// door blocks movement (combatTokens.move), a closed solid door blocks sight (playerView), an open one does neither.

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

const W = 30;
const H = 20;
/** Squares of the wall column x = 10, except the doorway at row 10, as `y * w + x`. */
const WALL = Array.from({ length: H }, (_, y) => y * W + 10).filter((s) => s !== 10 * W + 10);

/**
 * A live 30 x 20 map with a wall on column 10 and a doorway at (10, 10). The player's Ash stands at (5, 10) looking
 * east at the doorway; the GM's Bryn is in the top-left corner; a Goblin waits beyond the wall at (15, 10).
 */
async function withDoorway() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const list = await gm.query(api.combatTokens.list, { campaignId, mapId });
  const ashToken = list.find((tk) => tk.name === "Ash")!._id;
  const brynToken = list.find((tk) => tk.name === "Bryn")!._id;
  const place = (tokenId: Id<"combatTokens">, x: number, y: number, face = 0) => t.run((c) => c.db.patch("combatTokens", tokenId, { x, y, face }));
  await place(ashToken, 5, 10, 0);
  await place(brynToken, 1, 1, Math.PI);
  await gm.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: WALL, paint: "wall" });
  const { tokenId: goblin } = await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Goblin", hp: 3, side: "enemy", idempotencyKey: key() });
  await place(goblin, 15, 10, Math.PI);
  const addObject = (fields: { kind: "door" | "crate" | "pillar"; x: number; y: number; r?: number; rot?: number; sprite?: { builtin: string } }) =>
    t.run((c) => c.db.insert("combatMapObjects", { mapId, r: 1, rot: 0, ...fields }));
  const sees = async (c: Client = player) => {
    const v = await c.query(api.combatVision.playerView, { campaignId });
    if (v.state !== "ok") throw new Error(`expected a view, got ${v.state}`);
    return v.others.map((o) => o.name);
  };
  const doorIds = async (c: Client) => ((await c.query(api.combatVision.doors, { campaignId })) ?? { doors: [] }).doors.map((d) => d._id).sort();
  const objectRow = (id: Id<"combatMapObjects">) => t.run((c) => c.db.get("combatMapObjects", id));
  return { t, gm, player, campaignId, mapId, ashToken, brynToken, place, addObject, sees, doorIds, objectRow };
}

async function outsider(t: Setup["t"]) {
  const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
  return t.withIdentity({ subject: `${id}|session` });
}

describe("combat doors: access", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("toggleDoor and doors: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player who has seen it from Melee ok, GM ok", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    const door = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    // Ash next to the doorway, looking at the door (B4: a player switches only from Melee).
    await f.place(f.ashToken, 9, 10, 0);
    const out = await outsider(f.t);
    const calls = {
      toggleDoor: (c: Client) => c.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true }),
      doors: (c: Client) => c.query(api.combatVision.doors, { campaignId }),
    };
    const names = Object.keys(calls) as (keyof typeof calls)[];
    for (const name of names) expect([name, await code(calls[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(calls[name](out))]).toEqual([name, "NOT_FOUND"]);
    for (const name of names) expect([name, await code(calls[name](f.player))]).toEqual([name, "ok"]);
    for (const name of names) expect([name, await code(calls[name](f.gm))]).toEqual([name, "ok"]);
    expect((await f.objectRow(door))?.open).toBe(true);
  });

  it("a player who hasn't seen a door gets COMBAT_OBJECT_NOT_FOUND and never sees it listed; the GM switches and lists it", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    const seen = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    // North of Ash, outside the 70-degree cone looking east, and never explored.
    const unseen = await f.addObject({ kind: "door", x: 6.5, y: 4.5 });
    expect(await code(f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: true }))).toBe("COMBAT_OBJECT_NOT_FOUND");
    expect((await f.objectRow(unseen))?.open).toBeUndefined();
    expect(await f.doorIds(f.player)).toEqual([seen]);
    expect(await f.doorIds(f.gm)).toEqual([seen, unseen].sort());
    expect(await f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: true })).toEqual({ open: true });
    expect((await f.objectRow(unseen))?.open).toBe(true);
    // Closed is stored as an absent field; a repeat is a no-op.
    expect(await f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: false })).toEqual({ open: false });
    expect(await f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: false })).toEqual({ open: false });
    expect((await f.objectRow(unseen))?.open).toBeUndefined();
    // Explored counts as seen (the toggleLight rule): Ash turns north towards it, explores, turns away (west).
    await f.place(f.ashToken, 5, 10, -Math.PI / 2);
    const view = await f.player.query(api.combatVision.playerView, { campaignId });
    if (view.state !== "ok") throw new Error("no view");
    await f.player.mutation(api.combatVision.markExplored, { campaignId, mapId: f.mapId, characterId: view.characterId, bits: view.vision.seen });
    await f.place(f.ashToken, 5, 10, Math.PI);
    expect(await f.doorIds(f.player)).toContain(unseen);
    // Seen, but 5 squares away: out of reach (B4). Diagonally next to it, its back still turned: ok.
    expect(await code(f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: true }))).toBe("COMBAT_OUT_OF_REACH");
    await f.place(f.ashToken, 5, 5, Math.PI);
    expect(await code(f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: unseen, open: true }))).toBe("ok");
  });

  it("a player switches a door only from Melee (B4): adjacent, diagonal or overlapping; the GM from anywhere", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    const door = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    const toggle = (c: Client, open: boolean) => c.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open });
    const reachOf = async (c: Client) => ((await c.query(api.combatVision.doors, { campaignId }))?.doors ?? []).find((d) => d._id === door)?.reach;
    // Ash sees the door from (5, 10), 5 squares away; (8, 10) is 2 away: both out of reach, nothing changes.
    expect(await reachOf(f.player)).toBe(false);
    const refusal = await toggle(f.player, true).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(refusal)).toBe("COMBAT_OUT_OF_REACH");
    // The refusal carries no position (D6, B4): only the code.
    expect(Object.keys(errorData(refusal) as object).sort()).toEqual(["code"]);
    await f.place(f.ashToken, 8, 10, 0);
    expect(await code(toggle(f.player, true))).toBe("COMBAT_OUT_OF_REACH");
    expect((await f.objectRow(door))?.open).toBeUndefined();
    // Adjacent (9, 10): ok, and `doors` says so.
    await f.place(f.ashToken, 9, 10, 0);
    expect(await reachOf(f.player)).toBe(true);
    expect(await toggle(f.player, true)).toEqual({ open: true });
    // Diagonal (9, 9), facing the door: ok.
    await f.place(f.ashToken, 9, 9, Math.PI / 4);
    expect(await toggle(f.player, false)).toEqual({ open: false });
    // Overlapping: Ash in the open doorway.
    await toggle(f.player, true);
    await f.place(f.ashToken, 10, 10, 0);
    expect(await toggle(f.player, true)).toEqual({ open: true });
    // The GM is never limited: Bryn is in the far corner, and the GM has no token anywhere near.
    await f.place(f.ashToken, 5, 10, 0);
    expect(await reachOf(f.gm)).toBe(true);
    expect(await toggle(f.gm, false)).toEqual({ open: false });
  });

  it("the character next to the door must be one who has seen it (dcm-bxp.130): Ash's sight and Cole's reach don't add up", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    const door = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    // The player's second character, Cole, stands next to the door with his back to it and has explored nothing;
    // Ash sees the door from (5, 10), 5 squares away.
    // XC1: the GM allows extra characters for the running session, so the player may play two.
    await f.gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    await f.gm.mutation(api.sessions.allowExtraCharacters, { campaignId, allow: true, idempotencyKey: key() });
    const { characterId: cole } = await f.player.mutation(api.characters.create, { campaignId, draft: draft("Cole"), idempotencyKey: key() });
    const coleToken = await f.t.run(async (c) => {
      const { _id, _creationTime, ...fields } = (await c.db.get("combatTokens", f.ashToken))!;
      void _id;
      void _creationTime;
      return c.db.insert("combatTokens", { ...fields, ref: { kind: "pc", characterId: cole } });
    });
    await f.place(coleToken, 9, 10, Math.PI);
    const toggle = () => f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true });
    const reachOf = async () => ((await f.player.query(api.combatVision.doors, { campaignId }))?.doors ?? []).find((d) => d._id === door)?.reach;
    expect(await reachOf()).toBe(false);
    expect(await code(toggle())).toBe("COMBAT_OUT_OF_REACH");
    expect((await f.objectRow(door))?.open).toBeUndefined();
    // Cole turns round and sees the door himself: he may open it.
    await f.place(coleToken, 9, 10, 0);
    expect(await reachOf()).toBe(true);
    expect(await toggle()).toEqual({ open: true });
  });

  it("INVALID for a non-door (GM, and a player who has seen it); not-live maps and bad ids are refused", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    const crate = await f.addObject({ kind: "crate", x: 8.5, y: 10.5, r: 0.5 });
    await f.place(f.ashToken, 7, 10, 0);
    const hiddenCrate = await f.addObject({ kind: "crate", x: 3.5, y: 2.5, r: 0.5 });
    expect(await code(f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: crate, open: true }))).toBe("INVALID");
    expect(await code(f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: crate, open: true }))).toBe("INVALID");
    expect(await code(f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: hiddenCrate, open: true }))).toBe("COMBAT_OBJECT_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: "nope", open: true }))).toBe("COMBAT_OBJECT_NOT_FOUND");

    // A door on a map that is not live: the GM switches it, a player gets nothing.
    const { mapId: other } = await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    const offDoor = await f.t.run((c) => c.db.insert("combatMapObjects", { mapId: other, kind: "door", x: 3.5, y: 3.5, r: 1, rot: 0 }));
    expect(await code(f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: offDoor, open: true }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.player.query(api.combatVision.doors, { campaignId, mapId: other }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: offDoor, open: true }))).toBe("ok");
    expect((await f.gm.query(api.combatVision.doors, { campaignId, mapId: other }))?.doors).toMatchObject([{ _id: offDoor, open: true, solid: true }]);
  });
});

describe("combat doors: the layout (widened)", () => {
  useAllowlist();

  it("combatMaps.get / live carry `open` for an open door; an older row without the field still reads (closed)", async () => {
    const f = await withDoorway();
    const { campaignId, mapId } = f;
    const oldRow = await f.addObject({ kind: "pillar", x: 3.5, y: 3.5 });
    const door = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    const objectsOf = async (c: Client) => (await c.query(api.combatMaps.live, { campaignId }))!.objects;
    const gmObjects = async () => (await f.gm.query(api.combatMaps.get, { campaignId, mapId }))!.objects;
    expect((await gmObjects()).find((o) => o._id === oldRow)).not.toHaveProperty("open");
    expect((await gmObjects()).find((o) => o._id === door)).not.toHaveProperty("open");
    await f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true });
    expect((await gmObjects()).find((o) => o._id === door)).toMatchObject({ kind: "door", open: true });
    expect((await objectsOf(f.player)).find((o) => o._id === door)).toMatchObject({ open: true });
    // A row that stored `open: false` (not written by toggleDoor, but valid) reads as closed.
    await f.t.run((c) => c.db.patch("combatMapObjects", door, { open: false }));
    expect((await gmObjects()).find((o) => o._id === door)).not.toHaveProperty("open");
  });
});

describe("combat doors: sight and movement", () => {
  useAllowlist();

  it("a closed Classic door hides the goblin and stops Ash; the player opens it, sees and walks through, closes it again", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    expect(await f.sees()).toEqual(["Goblin"]);
    const door = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    expect(await f.sees()).toEqual([]);
    expect(await code(f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 12, y: 10 }))).toBe("MOVE_BLOCKED");
    expect((await f.player.query(api.combatVision.doors, { campaignId }))?.doors).toMatchObject([{ _id: door, open: false, solid: true, reach: false }]);

    // Ash walks up to the door (B4: Melee) and opens it.
    await f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 9, y: 10 });
    await f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true });
    expect(await f.sees()).toEqual(["Goblin"]);
    expect(await f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 12, y: 10 })).toMatchObject({ blocked: false });

    // Back through, then closed again: blocked once more. Walking west turned Ash away from the door, but switching it
    // stored the door as explored (dcm-bxp.121), so it is still Ash's to switch.
    await f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 9, y: 10 });
    await f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: false });
    expect(await code(f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 12, y: 10 }))).toBe("MOVE_BLOCKED");
    // The GM's move is never refused; it reports the closed door.
    expect(await f.gm.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 12, y: 10 })).toMatchObject({ blocked: true });
  });

  it("a wooden door sprite blocks sight while closed; a portcullis stays see-through but blocks movement until opened", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    await f.place(f.ashToken, 9, 10, 0);
    const wooden = await f.addObject({ kind: "crate", x: 10.5, y: 10.5, r: 0.5, sprite: { builtin: "dungeon/wooden-door-closed" } });
    expect(await f.sees()).toEqual([]);
    await f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: wooden, open: true });
    expect(await f.sees()).toEqual(["Goblin"]);
    await f.t.run((c) => c.db.delete("combatMapObjects", wooden));

    const gate = await f.addObject({ kind: "crate", x: 10.5, y: 10.5, r: 0.5, sprite: { builtin: "dungeon/portcullis-section" } });
    expect(await f.sees()).toEqual(["Goblin"]);
    expect((await f.player.query(api.combatVision.doors, { campaignId }))?.doors).toMatchObject([{ _id: gate, open: false, solid: false }]);
    expect(await code(f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 12, y: 10 }))).toBe("MOVE_BLOCKED");
    await f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: gate, open: true });
    expect(await code(f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 12, y: 10 }))).toBe("ok");
  });

  it("a door the player opened stays theirs to close after they walk through and turn their back on it (dcm-bxp.121)", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    const door = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    // Ash looks at the closed door from (8, 10); nothing is explored (no markExplored: the client's throttled sync never
    // got a write in while Ash faced the door).
    await f.place(f.ashToken, 9, 10, 0);
    expect(await f.doorIds(f.player)).toEqual([door]);
    await f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true });
    // Ash steps up to it (B4: Melee) and through the doorway to (11, 10), still facing east: the door is behind Ash,
    // outside the cone, and still within Melee.
    await f.player.mutation(api.combatTokens.move, { campaignId, tokenId: f.ashToken, x: 11, y: 10 });
    expect(await f.doorIds(f.player)).toEqual([door]);
    expect(await f.player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: false })).toEqual({ open: false });
    expect((await f.objectRow(door))?.open).toBeUndefined();
    // Only samples Ash saw were stored: the door's, not the far side of the wall Ash never looked at.
    const view = await f.player.query(api.combatVision.playerView, { campaignId });
    if (view.state !== "ok") throw new Error("no view");
    const row = await f.player.query(api.combatVision.explored, { campaignId, characterId: view.characterId });
    const mask = decodeExplored(row!.bits, row!.length);
    const sw = W * 2;
    expect(mask[21 * sw + 20] || mask[20 * sw + 21] || mask[21 * sw + 21] || mask[20 * sw + 20]).toBe(1);
    expect(mask.reduce((n, b) => n + b, 0)).toBeLessThanOrEqual(16);
  });

  it("the GM's preview follows the door too", async () => {
    const f = await withDoorway();
    const { campaignId } = f;
    const door = await f.addObject({ kind: "door", x: 10.5, y: 10.5 });
    const view = await f.player.query(api.combatVision.playerView, { campaignId });
    if (view.state !== "ok") throw new Error("no view");
    const preview = () => f.gm.query(api.combatVision.previewAs, { campaignId, characterId: view.characterId });
    expect((await preview()).state === "ok" && (await preview())).toMatchObject({ others: [] });
    await f.gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true });
    expect(await preview()).toMatchObject({ others: [{ name: "Goblin" }] });
  });
});
