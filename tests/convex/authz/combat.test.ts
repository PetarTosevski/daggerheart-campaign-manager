import { describe, expect, it } from "vitest";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorCode } from "../helpers";
import { runMatrix } from "./harness";
import area, { setup, sprites } from "./combat.entries";
import { allowWorldEmails, buildWorld, type World } from "./world";
import { freshKey } from "./synth";

runMatrix(area);

/**
 * The players' side of the combat map, for what a matrix outcome cannot state: a player sees only the live map, only
 * what their character's token sees, never an unseen door or light, never an adversary's stats and never the GM's
 * packs or sprite labels; the refusals past the access check carry their domain codes.
 */

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

/** A world with the combat area's setup (live map, the two PC tokens, a Goblin, a door and a campfire in view). */
async function combatWorld() {
  const w = await buildWorld();
  await setup(w);
  const campaignId = w.campaignId;
  const mapId = w.ids.mapId as Id<"combatMaps">;
  const tokens = await w.as("gm").query(api.combatTokens.list, { campaignId, mapId });
  const tokenA = tokens.find((t) => t.characterId === w.characterA)!._id;
  const goblin = w.ids.customTokenId as Id<"combatTokens">;
  const door = (await w.t.run((ctx) => ctx.db.query("combatMapObjects").collect())).find((o) => o.kind === "door")!._id;
  return { w, campaignId, mapId, tokenA, goblin, door };
}

async function insertObject(w: World, mapId: Id<"combatMaps">, fields: { kind: "door" | "campfire"; x: number; y: number }) {
  return w.t.run((ctx) => ctx.db.insert("combatMapObjects", { mapId, r: 0.5, rot: 0, ...fields }));
}

describe("authz matrix: combat, players' view", () => {
  allowWorldEmails();

  it("players read only the live map; the GM reads any", async () => {
    const { w, campaignId, mapId, tokenA } = await combatWorld();
    const gm = w.as("gm");
    const player = w.as("player");
    await w.t.run((ctx) => ctx.db.patch(mapId, { prompt: "GM scene notes" }));
    const { mapId: other } = await gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: freshKey() });

    const live = await player.query(api.combatMaps.live, { campaignId });
    expect(live?._id).toBe(mapId);
    expect(live?.prompt).toBeUndefined();
    expect((await gm.query(api.combatMaps.get, { campaignId, mapId }))?.prompt).toBe("GM scene notes");

    // The map that is not live: refused or empty for the player, readable for the GM.
    expect(await code(player.query(api.combatMapStyle.spriteSources, { campaignId, mapId: other }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId: other }))).toBe("ok");
    expect(await code(player.query(api.combatVision.doors, { campaignId, mapId: other }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(player.query(api.combatVision.explored, { campaignId, characterId: w.characterA, mapId: other }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(player.mutation(api.combatVision.markExplored, { campaignId, characterId: w.characterA, mapId: other, bits: "" }))).toBe(
      "COMBAT_MAP_NOT_FOUND",
    );
    expect(await player.query(api.combatTokens.party, { campaignId, mapId: other })).toEqual([]);

    // The GM shows the other map: the player's token stays on the old one, which they can no longer touch.
    await gm.mutation(api.combatMaps.setLive, { campaignId, mapId: other });
    expect(await player.query(api.combatVision.playerView, { campaignId })).toEqual({ state: "noCharacter", mapId: other });
    expect(await code(player.query(api.combatMapStyle.spriteSources, { campaignId, mapId }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(player.mutation(api.combatTokens.move, { campaignId, tokenId: tokenA, x: 6, y: 10 }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await player.query(api.combatTokens.party, { campaignId, mapId })).toEqual([]);
  });

  it("players see only what their token sees, never an adversary's stats, and act only for their own character", async () => {
    const { w, campaignId, mapId, tokenA, goblin, door } = await combatWorld();
    const gm = w.as("gm");
    const player = w.as("player");
    const otherPlayer = w.as("otherPlayer");
    const others = async () => {
      const view = await player.query(api.combatVision.playerView, { campaignId });
      if (view.state !== "ok") throw new Error(`expected a view, got ${view.state}`);
      expect(view.characterId).toBe(w.characterA);
      return view.others;
    };

    // The closed door stands between the player's token and the Goblin.
    expect((await others()).map((o) => o._id)).not.toContain(goblin);
    await gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: door, open: true });
    const seen = await others();
    expect(seen.map((o) => o._id)).toContain(goblin);
    // Name, size, side and facing only: no Hit Points, Stress or conditions (R4).
    for (const o of seen) expect(Object.keys(o).sort()).toEqual(expect.arrayContaining(["_id", "name", "side"]));
    for (const o of seen) for (const k of ["stats", "hp", "hpMax", "conditions", "revealedTo"]) expect(o).not.toHaveProperty(k);

    // party: PC tokens only; the GM's list has the Goblin with its numbers.
    const party = await player.query(api.combatTokens.party, { campaignId, mapId });
    expect(party.map((t) => t.kind)).toEqual(["pc", "pc"]);
    const goblinRow = (await gm.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t._id === goblin);
    expect(goblinRow?.stats?.hpMax).toBe(3);

    // The other player acts only for their own character.
    const viewB = await otherPlayer.query(api.combatVision.playerView, { campaignId });
    expect(viewB.state === "ok" && viewB.characterId).toBe(w.characterB);
    expect(await code(otherPlayer.query(api.combatVision.playerView, { campaignId, characterId: w.characterA }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(otherPlayer.query(api.combatVision.explored, { campaignId, characterId: w.characterA }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(otherPlayer.mutation(api.combatTokens.move, { campaignId, tokenId: tokenA, x: 6, y: 10 }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(otherPlayer.mutation(api.combatTokens.turn, { campaignId, tokenId: tokenA, angle: 1 }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(otherPlayer.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: tokenA, light: "torch" }))).toBe(
      "COMBAT_NOT_YOUR_TOKEN",
    );
    expect(await code(player.mutation(api.combatTokens.move, { campaignId, tokenId: goblin, x: 14, y: 10 }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(player.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: goblin, light: "torch" }))).toBe(
      "COMBAT_NOT_YOUR_TOKEN",
    );
  });

  it("players never get a door or light their characters have not seen", async () => {
    const { w, campaignId, mapId, door } = await combatWorld();
    const gm = w.as("gm");
    const player = w.as("player");
    // North of the player's token, outside its cone looking east, and never explored.
    const hiddenDoor = await insertObject(w, mapId, { kind: "door", x: 6.5, y: 4.5 });
    const hiddenFire = await insertObject(w, mapId, { kind: "campfire", x: 4.5, y: 4.5 });

    const doorIds = async (role: "player" | "gm") => ((await w.as(role).query(api.combatVision.doors, { campaignId })) ?? { doors: [] }).doors.map((d) => d._id);
    expect(await doorIds("player")).toEqual([door]);
    expect((await doorIds("gm")).sort()).toEqual([door, hiddenDoor].sort());

    expect(await code(player.mutation(api.combatVision.toggleDoor, { campaignId, objectId: hiddenDoor, open: true }))).toBe("COMBAT_OBJECT_NOT_FOUND");
    expect(await code(player.mutation(api.combatVision.toggleLight, { campaignId, objectId: hiddenFire, lit: false }))).toBe("COMBAT_LIGHT_NOT_SEEN");
    expect(await code(gm.mutation(api.combatVision.toggleDoor, { campaignId, objectId: hiddenDoor, open: true }))).toBe("ok");
    expect(await code(gm.mutation(api.combatVision.toggleLight, { campaignId, objectId: hiddenFire, lit: false }))).toBe("ok");
  });

  it("players get only the sprites the live map draws, without labels or packs; the GM gets the setting's pack", async () => {
    const { w, campaignId, mapId } = await combatWorld();
    await sprites(w);
    const gm = w.as("gm");
    const player = w.as("player");
    const placed = (await w.t.run((ctx) => ctx.db.query("spritePackSprites").collect())).find((s) => s.name === "Standing stone")!._id;
    await gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "forest" } });
    await gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite: { uploaded: placed }, x: 3, y: 3 });

    const mine = await player.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(mine.view).toBe("player");
    expect(mine.sprites.map((s) => s._id)).toEqual([placed]);
    expect(JSON.stringify(mine)).not.toMatch(/Standing stone|Cairn|Moors|packId/);

    const theirs = await gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(theirs.view).toBe("gm");
    expect(theirs.sprites.map((s) => "name" in s && s.name).sort()).toEqual(["Cairn", "Standing stone"]);
    expect(await code(player.query(api.spritePacks.packs, { campaignId }))).toBe("FORBIDDEN");
    expect(await code(player.query(api.combatMapStyle.settings, { campaignId }))).toBe("FORBIDDEN");
  });
});
