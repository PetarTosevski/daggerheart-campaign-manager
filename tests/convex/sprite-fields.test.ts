import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_TEXTURE_PALETTE } from "../../convex/lib/validators/spritePacks";
import { CELL_LAYERS, TEXTURE_CODES } from "../../convex/lib/validators/combatMaps";
import { decodeCells } from "../../src/components/combat-map/map-view/cells";
import { errorMessage, mergeMessages } from "../../src/lib/convex-errors";
import { spritePackMessages } from "../../src/lib/errors/spritePacks";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";
import { ConvexError } from "convex/values";

// Sprite packs P0 (plan .omc/plans/sprite-packs.yaml): the widened map, area, object and cell fields and the
// spritePacks / spritePackSprites tables are read back by every existing map read (get, list, live, playerView,
// previewAs), copied by duplicate (E8) and leave D9 rows reading exactly as before (E3, E4). P0 adds no public
// function; the access rows below re-check the existing reads on rows that carry the new fields.

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

type SpriteLight = "none" | "faintglow" | "torch" | "campfire";

/**
 * A campaign with a player ("Ash" on the live map), a GM pack with uploaded sprites, and the live map carrying
 * every new field: style, setting (the pack), settingPicked, texturePalette, an area texture, object sprites
 * (built-in and uploaded) and a "texture" cell tile.
 */
async function withSpriteMap() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });

  const sprite = (packId: Id<"spritePacks">, name: string, light: SpriteLight, order: number) =>
    t.run(async (c) => {
      const gmId = (await c.db.query("users").first())!._id;
      const storageId = await c.storage.store(new Blob([new Uint8Array(8)], { type: "image/webp" }));
      const fileId = await c.db.insert("files", { storageId, campaignId, uploadedBy: gmId, kind: "sprite", refId: "pending", createdAt: 1 });
      const id = await c.db.insert("spritePackSprites", {
        campaignId,
        packId,
        fileId,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        category: "object",
        w: 1,
        h: 1,
        sight: "cover",
        light,
        height: "low",
        footprint: "circle",
        classicKind: "crystal",
        px: { w: 160, h: 160 },
        order,
        createdAt: 1,
      });
      await c.db.patch("files", fileId, { refId: id });
      return id;
    });
  const packId = await t.run(async (c) => {
    const gmId = (await c.db.query("users").first())!._id;
    return c.db.insert("spritePacks", { campaignId, name: "Glowing things", extends: "forest", createdBy: gmId, createdAt: 1, updatedAt: 1 });
  });
  const glow = await sprite(packId, "Glow crystal", "faintglow", 0);
  const dark = await sprite(packId, "Dark crystal", "none", 1);
  const moss: Id<"spritePackSprites"> = await sprite(packId, "Moss texture", "none", 2);

  const ids = await t.run(async (c) => {
    await c.db.patch("combatMaps", mapId, {
      style: "sprites",
      setting: { pack: packId },
      settingPicked: true,
      texturePalette: [{ builtin: "forest/moss" }, { uploaded: moss }],
      areas: [{ terrain: "grass", shape: "rect", x: 2, y: 2, w: 4, h: 3, texture: { builtin: "forest/moss" } }],
      prompt: "A glade of crystals",
    });
    const oak = await c.db.insert("combatMapObjects", { mapId, kind: "tree", x: 10, y: 10, r: 1, rot: 0, sprite: { builtin: "forest/oak-tree" } });
    const glowObject = await c.db.insert("combatMapObjects", { mapId, kind: "crystal", x: 12, y: 12, r: 0.5, rot: 0, sprite: { uploaded: glow } });
    const darkFire = await c.db.insert("combatMapObjects", { mapId, kind: "campfire", x: 14, y: 12, r: 0.5, rot: 0, sprite: { uploaded: dark } });
    const plainFire = await c.db.insert("combatMapObjects", { mapId, kind: "campfire", x: 16, y: 12, r: 0.5, rot: 0 });
    // Row 0: "A" (texture 0) at x 0..2, "B" (texture 1) at x 3; the matching terrain tile paints grass there.
    const w = 30;
    await c.db.insert("combatMapCells", { mapId, layer: "texture", tile: 0, cells: `${TEXTURE_CODES[0]!.repeat(3)}${TEXTURE_CODES[1]}`.padEnd(8 * w, ".") });
    await c.db.insert("combatMapCells", { mapId, layer: "terrain", tile: 0, cells: "aaaa".padEnd(8 * w, ".") });
    return { oak, glowObject, darkFire, plainFire };
  });
  return { ...ctx, player, ash, mapId, packId, glow, dark, moss, ...ids };
}

/** A third account outside the campaign. */
async function outsider(t: Setup["t"]) {
  const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
  return t.withIdentity({ subject: `${id}|session` });
}

describe("sprite fields: schema widening", () => {
  it("adds the texture layer last and keeps the palette within the cell codes", () => {
    expect(CELL_LAYERS).toEqual(["terrain", "block", "fog", "texture"]);
    expect(TEXTURE_CODES).toHaveLength(MAX_TEXTURE_PALETTE);
    expect(new Set(TEXTURE_CODES).size).toBe(MAX_TEXTURE_PALETTE);
    // Uppercase: never a terrain (a..n), block (#), fog (r, h) or unpainted (.) code.
    expect(/^[A-Z]+$/.test(TEXTURE_CODES)).toBe(true);
  });

  it("decodeCells ignores texture tiles (no fog, terrain or blockers from them)", () => {
    const decoded = decodeCells([{ layer: "texture", tile: 0, cells: "ABrh#a" }], 6, 2);
    expect(decoded).toEqual({ paint: {}, block: new Set(), fog: {} });
  });
});

describe("sprite fields: reads", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("GM get returns every new field; cells keep the D9 layers and texture tiles come in textureCells", async () => {
    const f = await withSpriteMap();
    const map = (await f.gm.query(api.combatMaps.get, { campaignId: f.campaignId, mapId: f.mapId }))!;
    expect(map.style).toBe("sprites");
    expect(map.setting).toEqual({ pack: f.packId });
    expect(map.settingPicked).toBe(true);
    expect(map.texturePalette).toEqual([{ builtin: "forest/moss" }, { uploaded: f.moss }]);
    expect(map.areas[0]!.texture).toEqual({ builtin: "forest/moss" });
    const byId = new Map(map.objects.map((o) => [o._id, o]));
    expect(byId.get(f.oak)!.sprite).toEqual({ builtin: "forest/oak-tree" });
    expect(byId.get(f.glowObject)!.sprite).toEqual({ uploaded: f.glow });
    expect(byId.get(f.plainFire)!.sprite).toBeUndefined();
    expect(map.cells.map((c) => c.layer)).toEqual(["terrain"]);
    expect(map.textureCells).toHaveLength(1);
    expect(map.textureCells![0]!.cells.slice(0, 4)).toBe("AAAB");
    expect(map.prompt).toBe("A glade of crystals");
  });

  it("list returns style and setting for the thumbnail", async () => {
    const f = await withSpriteMap();
    const [row] = await f.gm.query(api.combatMaps.list, { campaignId: f.campaignId });
    expect(row!.style).toBe("sprites");
    expect(row!.setting).toEqual({ pack: f.packId });
  });

  it("players get the live map's style, setting, palette, refs and texture tiles, but not settingPicked or the prompt (D10)", async () => {
    const f = await withSpriteMap();
    const map = (await f.player.query(api.combatMaps.live, { campaignId: f.campaignId }))!;
    expect(map._id).toBe(f.mapId);
    expect(map.style).toBe("sprites");
    expect(map.setting).toEqual({ pack: f.packId });
    expect(map.texturePalette).toHaveLength(2);
    expect(map.textureCells).toHaveLength(1);
    expect(map.objects.some((o) => o.sprite !== undefined)).toBe(true);
    expect("settingPicked" in map).toBe(false);
    expect("prompt" in map).toBe(false);
  });

  it("the vision reads (playerView, previewAs) run on a map with sprite fields and texture cells", async () => {
    const f = await withSpriteMap();
    const view = await f.player.query(api.combatVision.playerView, { campaignId: f.campaignId });
    expect(view.state).toBe("ok");
    const preview = await f.gm.query(api.combatVision.previewAs, { campaignId: f.campaignId, characterId: f.ash });
    expect(preview.state).toBe("ok");
  });

  it("a D9 row without any new field reads exactly as before (E3, E4)", async () => {
    const f = await setupWithCampaign();
    // A D9 map is Classic: since dcm-bxp.135 a GM who never chose gets Sprites, so pick Classic first.
    await f.gm.mutation(api.settings.update, { defaultMapStyle: "classic" });
    const { mapId } = await f.gm.mutation(api.combatMaps.create, { campaignId: f.campaignId, size: "small", idempotencyKey: key() });
    await f.t.run((c) => c.db.insert("combatMapObjects", { mapId, kind: "campfire", x: 3, y: 3, r: 1, rot: 0 }));
    const map = (await f.gm.query(api.combatMaps.get, { campaignId: f.campaignId, mapId }))!;
    for (const field of ["style", "setting", "settingPicked", "texturePalette", "textureCells"]) expect(field in map).toBe(false);
    expect("sprite" in map.objects[0]!).toBe(false);
    const [row] = await f.gm.query(api.combatMaps.list, { campaignId: f.campaignId });
    expect("style" in row! || "setting" in row!).toBe(false);
  });

  it("keeps the reads' access unchanged on sprite maps: anonymous, outsider, player, GM", async () => {
    const f = await withSpriteMap();
    const out = await outsider(f.t);
    const anon = f.t as unknown as Client;
    const reads = {
      get: (c: Client) => c.query(api.combatMaps.get, { campaignId: f.campaignId, mapId: f.mapId }),
      list: (c: Client) => c.query(api.combatMaps.list, { campaignId: f.campaignId }),
      live: (c: Client) => c.query(api.combatMaps.live, { campaignId: f.campaignId }),
      duplicate: (c: Client) => c.mutation(api.combatMaps.duplicate, { campaignId: f.campaignId, mapId: f.mapId, idempotencyKey: key() }),
    };
    const expected = {
      get: ["UNAUTHENTICATED", "NOT_FOUND", "FORBIDDEN", "ok"],
      list: ["UNAUTHENTICATED", "NOT_FOUND", "FORBIDDEN", "ok"],
      live: ["UNAUTHENTICATED", "NOT_FOUND", "ok", "ok"],
      duplicate: ["UNAUTHENTICATED", "NOT_FOUND", "FORBIDDEN", "ok"],
    };
    for (const [name, call] of Object.entries(reads)) {
      const got = [await code(call(anon)), await code(call(out)), await code(call(f.player)), await code(call(f.gm))];
      expect([name, got]).toEqual([name, expected[name as keyof typeof expected]]);
    }
  });
});

describe("sprite fields: duplicate (E8)", () => {
  useAllowlist();

  it("copies style, setting, settingPicked, palette, area textures, object sprites and texture cells", async () => {
    const f = await withSpriteMap();
    const { mapId: copyId } = await f.gm.mutation(api.combatMaps.duplicate, { campaignId: f.campaignId, mapId: f.mapId, idempotencyKey: key() });
    const original = (await f.gm.query(api.combatMaps.get, { campaignId: f.campaignId, mapId: f.mapId }))!;
    const copy = (await f.gm.query(api.combatMaps.get, { campaignId: f.campaignId, mapId: copyId }))!;
    expect(copy.style).toBe(original.style);
    expect(copy.setting).toEqual(original.setting);
    expect(copy.settingPicked).toBe(original.settingPicked);
    expect(copy.texturePalette).toEqual(original.texturePalette);
    expect(copy.areas).toEqual(original.areas);
    const sprites = (m: typeof copy) => m.objects.map((o) => o.sprite ?? null).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(sprites(copy)).toEqual(sprites(original));
    expect(copy.textureCells).toEqual(original.textureCells);
    expect(copy.cells).toEqual(original.cells);
  });
});

describe("sprite fields: map lights from sprite traits (Q1, givesLight)", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("switches an uploaded faint-glow sprite, refuses a light kind whose sprite gives none, keeps Classic lights", async () => {
    const f = await withSpriteMap();
    const toggle = (c: Client, objectId: string, lit: boolean) => c.mutation(api.combatVision.toggleLight, { campaignId: f.campaignId, objectId, lit });
    // "crystal" is no Classic light, but its sprite glows faintly (Q1 = b): a switchable map light.
    expect(await toggle(f.gm, f.glowObject, false)).toEqual({ lit: false });
    // A campfire kind whose sprite gives no light is not one (the trait wins, D2).
    expect(await code(toggle(f.gm, f.darkFire, false))).toBe("INVALID");
    // Classic lights unchanged (E4); the oak (a tree, built-in sprite) is no light.
    expect(await toggle(f.gm, f.plainFire, false)).toEqual({ lit: false });
    expect(await code(toggle(f.gm, f.oak, false))).toBe("INVALID");
    expect(await code(toggle(f.t as unknown as Client, f.glowObject, true))).toBe("UNAUTHENTICATED");
    expect(await code(toggle(await outsider(f.t), f.glowObject, true))).toBe("NOT_FOUND");
  });

  it("falls back to the Classic kind when the uploaded sprite is deleted (D9)", async () => {
    const f = await withSpriteMap();
    await f.t.run((c) => c.db.delete("spritePackSprites", f.dark));
    expect(await f.gm.mutation(api.combatVision.toggleLight, { campaignId: f.campaignId, objectId: f.darkFire, lit: false })).toEqual({ lit: false });
  });
});

describe("sprite-pack error codes", () => {
  it("defines every code the plan needs, joined into the client's messages without clashes", () => {
    const codes = Object.keys(spritePackMessages).sort();
    expect(codes).toEqual(
      ["SPRITE_LIMIT", "SPRITE_NOT_FOUND", "SPRITE_PACK_LIMIT", "SPRITE_PACK_NOT_FOUND", "SPRITE_PALETTE_FULL", "SPRITE_SETTING_UNKNOWN", "SPRITE_UNKNOWN"].sort(),
    );
    expect(() => mergeMessages(spritePackMessages)).not.toThrow();
    for (const c of codes) expect(errorMessage(new ConvexError({ code: c }))).toBe(spritePackMessages[c as keyof typeof spritePackMessages]);
  });
});
