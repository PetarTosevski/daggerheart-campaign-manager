import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { TEXTURE_CODES, type SpriteRef } from "../../convex/lib/validators/combatMaps";
import { MAX_TEXTURE_PALETTE } from "../../convex/lib/validators/spritePacks";
import {
  builtinPlacement,
  paintLayoutCells,
  paintLayoutTextures,
  paletteSlot,
  textureCode,
  usedTextureCodes,
} from "../../src/components/combat-map/editor/edit-model";
import { searchPalette, spritePalette } from "../../src/components/combat-map/editor/sprite-palette";
import { codeOfTerrain, decodeCells } from "../../src/components/combat-map/map-view/cells";
import { CATALOG_ENTRIES } from "../../src/lib/sprite-packs/catalog/index";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// Sprite packs P9 (plan .omc/plans/sprite-packs.yaml): hand editing in the Sprites style. `addObject` places a
// sprite (built-in key or this campaign's uploaded sprite; the Classic kind comes from the catalog or the row, D1,
// D2), `paintCells` paints a texture (palette slot, texture layer + terrain class on the terrain layer), erasing
// clears both, and a sprite light is switchable by its traits (Q1). Every function stays GM-only (anonymous
// UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN). C5's own tests (combat-map-edit.test.ts) are unchanged
// (E4). TE2's authz matrix does not exist yet; D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

const OAK = { builtin: "forest/oak-tree" } as const;
const BUSH = { builtin: "forest/bush" } as const;
const MOSS = { builtin: "forest/moss" } as const;
const CANDELABRA = { builtin: "castle-interior/candelabra" } as const;

/** Labels of an uploaded object sprite, as P8's upload screen sends them. */
const OBJECT_LABELS = {
  name: "Standing stone",
  category: "object",
  w: 1,
  h: 2,
  sight: "block",
  light: "none",
  height: "tall",
  footprint: "circle",
  classicKind: "pillar",
  px: { w: 160, h: 320 },
} as const;
const TEXTURE_LABELS = { ...OBJECT_LABELS, name: "Heather", category: "texture", w: 4, h: 4, sight: "none", height: "flat", footprint: "rect", classicKind: "rubble", terrain: "swamp", px: { w: 512, h: 512 } } as const;

async function withMap() {
  const ctx = await setupWithCampaign();
  const { t, gm, campaignId } = ctx;
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  const get = async () => (await gm.query(api.combatMaps.get, { campaignId, mapId }))!;
  const tiles = (layer: "terrain" | "texture") =>
    t.run((c) => c.db.query("combatMapCells").withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId).eq("layer", layer)).collect());
  const store = () =>
    t.run(async (c) => {
      const id = await c.storage.store(new Blob([new Uint8Array(64)], { type: "image/webp" }));
      await (c.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType: "image/webp" });
      return id;
    });
  /** Uploads one sprite into a new pack of `campaign` (default: this one). */
  const upload = async (labels: Record<string, unknown>, campaign: Id<"campaigns"> = campaignId) => {
    const { packId } = await gm.mutation(api.spritePacks.createPack, { campaignId: campaign, name: `Pack ${key()}`, extends: "forest", idempotencyKey: key() });
    const result = await gm.mutation(api.spritePacks.attachSprite, { campaignId: campaign, packId, storageId: await store(), ...labels } as never);
    if (!result.ok) throw new Error(result.message);
    return result.spriteId;
  };
  const texture = (squares: number[], ref: SpriteRef) =>
    gm.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares, paint: { layer: "texture", texture: ref } });
  const addSprite = async (sprite: SpriteRef, x: number, y: number) => (await gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite, x, y })).objectId;
  const object = (id: Id<"combatMapObjects">) => t.run((c) => c.db.get("combatMapObjects", id));
  const player = async () => {
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    return ctx.other;
  };
  return { ...ctx, mapId, get, tiles, upload, texture, addSprite, object, player };
}

describe("Sprites editing: access", () => {
  useAllowlist();

  it("keeps sprite placing, texture painting and sprite light switches from anonymous callers, outsiders and players", async () => {
    const f = await withMap();
    const { campaignId, mapId } = f;
    const candle = await f.addSprite(CANDELABRA, 3, 3);
    const all = {
      addSprite: (c: Client) => c.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite: OAK, x: 5, y: 5 }),
      paintTexture: (c: Client) => c.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [0, 1], paint: { layer: "texture", texture: MOSS } }),
      litSprite: (c: Client) => c.mutation(api.combatMapEdit.updateObject, { campaignId, objectId: candle, lit: false }),
      spriteSight: (c: Client) => c.mutation(api.combatMapEdit.setObjectSight, { campaignId, objectId: candle, sight: "block" }),
    };
    const names = Object.keys(all) as (keyof typeof all)[];
    for (const name of names) expect([name, await code(all[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(all[name](f.other))]).toEqual([name, "NOT_FOUND"]);
    const player = await f.player();
    for (const name of names) expect([name, await code(all[name](player))]).toEqual([name, "FORBIDDEN"]);
    for (const name of names) expect([name, await code(all[name](f.gm))]).toEqual([name, "ok"]);
  });
});

describe("Sprites editing: placing sprites", () => {
  useAllowlist();

  it("fills the Classic kind, variant and radius from the catalog for a built-in sprite (D1, D2, D4)", async () => {
    const f = await withMap();
    const oak = await f.object(await f.addSprite(OAK, 6.2, 7.9));
    expect(oak).toMatchObject({ kind: "tree", variant: "green", r: 1, x: 6, y: 8, rot: 0, sprite: OAK });
    const bush = await f.object(await f.addSprite(BUSH, 2, 2));
    expect(bush).toMatchObject({ kind: "bush", r: 0.5, sprite: BUSH });
  });

  it("refuses kind and sprite together with INVALID (G14b)", async () => {
    const f = await withMap();
    expect(await code(f.gm.mutation(api.combatMapEdit.addObject, { campaignId: f.campaignId, mapId: f.mapId, kind: "crate", sprite: OAK, x: 1, y: 1 }))).toBe("INVALID");
    expect((await f.get()).objects).toHaveLength(0);
  });

  it("places doors closed: the Classic Door and a door sprite get kind door and no `open` field (map-movement M2)", async () => {
    const f = await withMap();
    const classic = (await f.gm.mutation(api.combatMapEdit.addObject, { campaignId: f.campaignId, mapId: f.mapId, kind: "door", x: 3, y: 3 })).objectId;
    const sprite = await f.addSprite({ builtin: "dungeon/wooden-door-closed" }, 6, 6);
    for (const id of [classic, sprite]) {
      const row = await f.object(id);
      expect(row?.kind).toBe("door");
      expect(row?.open).toBeUndefined();
    }
  });

  it("refuses an unknown built-in key or a texture key with SPRITE_UNKNOWN, and a call without kind or sprite with INVALID", async () => {
    const f = await withMap();
    expect(await code(f.addSprite({ builtin: "forest/no-such-thing" }, 1, 1))).toBe("SPRITE_UNKNOWN");
    expect(await code(f.addSprite(MOSS, 1, 1))).toBe("SPRITE_UNKNOWN");
    expect(await code(f.gm.mutation(api.combatMapEdit.addObject, { campaignId: f.campaignId, mapId: f.mapId, x: 1, y: 1 }))).toBe("INVALID");
    expect((await f.get()).objects).toHaveLength(0);
  });

  it("places this campaign's uploaded sprite with the row's Classic look; another campaign's or a deleted one is SPRITE_NOT_FOUND", async () => {
    const f = await withMap();
    const stone = (await f.upload(OBJECT_LABELS)) as Id<"spritePackSprites">;
    const placed = await f.object(await f.addSprite({ uploaded: stone }, 4, 4));
    expect(placed).toMatchObject({ kind: "pillar", r: 1, sprite: { uploaded: stone } });

    const heather = await f.upload(TEXTURE_LABELS);
    expect(await code(f.addSprite({ uploaded: heather }, 4, 4))).toBe("INVALID");

    const { campaignId: mine } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const foreign = await f.upload(OBJECT_LABELS, mine);
    expect(await code(f.addSprite({ uploaded: foreign }, 4, 4))).toBe("SPRITE_NOT_FOUND");

    await f.gm.mutation(api.spritePacks.removeSprite, { campaignId: f.campaignId, spriteId: stone });
    expect(await code(f.addSprite({ uploaded: stone }, 5, 5))).toBe("SPRITE_NOT_FOUND");
    // The object placed before the delete keeps its ref (D9).
    expect((await f.get()).objects).toHaveLength(1);
  });

  it("uses the sprite's traits for the light switch and keeps the GM's sight override (D3, Q1)", async () => {
    const f = await withMap();
    const candle = await f.addSprite(CANDELABRA, 3, 3);
    expect((await f.object(candle))?.kind).toBe("crystal");
    await f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: candle, lit: false });
    expect((await f.object(candle))?.lit).toBe(false);
    const bush = await f.addSprite(BUSH, 6, 6);
    expect(await code(f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: bush, lit: false }))).toBe("INVALID");
    // A sprite with light "none" on a Classic light kind is not a light (the trait wins).
    const odd = await f.t.run((c) => c.db.insert("combatMapObjects", { mapId: f.mapId, kind: "campfire", x: 2, y: 2, r: 1, rot: 0, sprite: BUSH }));
    expect(await code(f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: odd, lit: false }))).toBe("INVALID");
    // A bush blocks sight once the GM says so; "default" goes back to the manifest's cover.
    await f.gm.mutation(api.combatMapEdit.setObjectSight, { campaignId: f.campaignId, objectId: bush, sight: "block" });
    expect((await f.object(bush))?.sight).toBe("block");
    await f.gm.mutation(api.combatMapEdit.setObjectSight, { campaignId: f.campaignId, objectId: bush, sight: "default" });
    expect((await f.object(bush))?.sight).toBeUndefined();
  });
});

describe("Sprites editing: painting textures", () => {
  useAllowlist();

  it("adds the texture to the palette and writes the texture layer and its terrain class in one stroke", async () => {
    const f = await withMap();
    await f.texture([0, 1, 30], MOSS);
    const layout = await f.get();
    expect(layout.texturePalette).toEqual([MOSS]);
    expect(layout.textureCells).toEqual([{ tile: 0, cells: expect.stringMatching(/^AA\.{28}A\.+$/) }]);
    const decoded = decodeCells(layout.cells, layout.w, layout.h);
    expect(decoded.paint).toEqual({ "0,0": "grass", "1,0": "grass", "0,1": "grass" });

    // The same texture again keeps its slot; another takes the next code; the path paints "path".
    await f.texture([2], MOSS);
    await f.texture([3], { builtin: "forest/muddy-path" });
    const after = await f.get();
    expect(after.texturePalette).toEqual([MOSS, { builtin: "forest/muddy-path" }]);
    expect(after.textureCells?.[0]?.cells.slice(0, 4)).toBe("AAAB");
    expect(decodeCells(after.cells, after.w, after.h).paint["3,0"]).toBe("path");
  });

  it("matches the client's optimistic copy (paletteSlot, paintLayoutTextures, paintLayoutCells)", async () => {
    const f = await withMap();
    const before = await f.get();
    const squares = [5, 6, 35, 36, 300];
    const slot = paletteSlot(before.texturePalette ?? [], MOSS, usedTextureCodes(before.textureCells ?? []))!;
    const textureCells = paintLayoutTextures(before.textureCells ?? [], before.w, squares, textureCode(slot.index));
    const cells = paintLayoutCells(before.cells, before.w, squares, "grass");
    await f.texture(squares, MOSS);
    const after = await f.get();
    expect(after.texturePalette).toEqual(slot.palette);
    expect([...(after.textureCells ?? [])].sort((a, b) => a.tile - b.tile)).toEqual(textureCells.sort((a, b) => a.tile - b.tile));
    expect([...after.cells].sort((a, b) => a.tile - b.tile)).toEqual(cells.sort((a, b) => a.tile - b.tile));
  });

  it("erases both layers; terrain paint clears the texture under it; Undo all painting clears textures and the palette", async () => {
    const f = await withMap();
    await f.texture([0, 1, 2, 3], MOSS);
    await f.gm.mutation(api.combatMapEdit.paintCells, { campaignId: f.campaignId, mapId: f.mapId, squares: [0], paint: "eraseTerrain" });
    await f.gm.mutation(api.combatMapEdit.paintCells, { campaignId: f.campaignId, mapId: f.mapId, squares: [1], paint: "water" });
    let layout = await f.get();
    expect(layout.textureCells?.[0]?.cells.slice(0, 4)).toBe("..AA");
    const paint = decodeCells(layout.cells, layout.w, layout.h).paint;
    expect(paint["0,0"]).toBeUndefined();
    expect(paint["1,0"]).toBe("water");
    expect(paint["2,0"]).toBe("grass");

    await f.gm.mutation(api.combatMapEdit.clearPaint, { campaignId: f.campaignId, mapId: f.mapId, layer: "terrain" });
    layout = await f.get();
    expect(layout.textureCells).toBeUndefined();
    expect(layout.texturePalette).toBeUndefined();
    expect(await f.tiles("texture")).toHaveLength(0);
    expect(await f.tiles("terrain")).toHaveLength(0);
  });

  it("gives SPRITE_PALETTE_FULL past MAX_TEXTURE_PALETTE textures in use, and reuses a slot no square uses any more", async () => {
    const f = await withMap();
    const textures = CATALOG_ENTRIES.filter((e) => e.category === "texture").slice(0, MAX_TEXTURE_PALETTE + 1);
    expect(textures).toHaveLength(MAX_TEXTURE_PALETTE + 1);
    for (const [i, entry] of textures.slice(0, MAX_TEXTURE_PALETTE).entries()) await f.texture([i], { builtin: entry.key });
    expect((await f.get()).texturePalette).toHaveLength(MAX_TEXTURE_PALETTE);
    const extra = { builtin: textures[MAX_TEXTURE_PALETTE]!.key };
    expect(await code(f.texture([20], extra))).toBe("SPRITE_PALETTE_FULL");
    expect((await f.tiles("texture"))[0]?.cells[20]).toBe(".");

    // Square 4 held slot E; erase it and the new texture takes that slot.
    await f.gm.mutation(api.combatMapEdit.paintCells, { campaignId: f.campaignId, mapId: f.mapId, squares: [4], paint: "eraseTerrain" });
    await f.texture([20], extra);
    const layout = await f.get();
    expect(layout.texturePalette?.[4]).toEqual(extra);
    expect(layout.textureCells?.[0]?.cells[20]).toBe(TEXTURE_CODES[4]);
  });

  it("checks texture refs: unknown or object keys SPRITE_UNKNOWN, foreign uploads SPRITE_NOT_FOUND, an uploaded object INVALID", async () => {
    const f = await withMap();
    expect(await code(f.texture([0], { builtin: "forest/no-such-texture" }))).toBe("SPRITE_UNKNOWN");
    expect(await code(f.texture([0], OAK))).toBe("SPRITE_UNKNOWN");
    const stone = await f.upload(OBJECT_LABELS);
    expect(await code(f.texture([0], { uploaded: stone }))).toBe("INVALID");
    const { campaignId: mine } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await code(f.texture([0], { uploaded: await f.upload(TEXTURE_LABELS, mine) }))).toBe("SPRITE_NOT_FOUND");
    expect(await code(f.texture([-1], MOSS))).toBe("INVALID");
    expect((await f.get()).texturePalette).toBeUndefined();

    // This campaign's uploaded texture paints its terrain class.
    const heather = await f.upload(TEXTURE_LABELS);
    await f.texture([0], { uploaded: heather });
    const layout = await f.get();
    expect(layout.texturePalette).toEqual([{ uploaded: heather }]);
    expect(layout.cells.find((t) => t.layer === "terrain")?.cells[0]).toBe(codeOfTerrain("swamp"));
  });
});

describe("Sprites editing: pickers", () => {
  it("lists the setting's sprites, then common, then uploaded ones, straight from the catalog", () => {
    const palette = spritePalette("forest", [
      { _id: "u1" as Id<"spritePackSprites">, name: "Standing stone", category: "object", w: 1, h: 2, sight: "block", light: "none", height: "tall", footprint: "circle", classicKind: "pillar", url: "https://x/u1.webp" },
      { _id: "u2" as Id<"spritePackSprites">, name: "Heather", category: "texture", w: 4, h: 4, sight: "none", light: "none", height: "flat", footprint: "rect", classicKind: "rubble", terrain: "swamp", url: null },
    ]);
    const groups = palette.objects.map((o) => o.group);
    expect(groups.indexOf("common")).toBeGreaterThan(groups.lastIndexOf("setting"));
    expect(groups.at(-1)).toBe("uploaded");
    const forest = CATALOG_ENTRIES.filter((e) => e.key.startsWith("forest/") && e.category === "object");
    expect(palette.objects.filter((o) => o.group === "setting").map((o) => o.key)).toEqual(forest.map((e) => e.key));
    expect(palette.objects.find((o) => o.key === "forest/oak-tree")).toMatchObject({ name: "Oak tree", placement: builtinPlacement("forest/oak-tree") });
    expect(palette.textures.map((t) => t.key)).toContain("forest/moss");
    expect(palette.textures.at(-1)).toMatchObject({ name: "Heather", terrain: "swamp", group: "uploaded" });
    expect(searchPalette(palette.objects, "oak").map((o) => o.key)).toEqual(["forest/oak-tree"]);
    // A pack setting of its own: common only (plus uploads).
    expect(spritePalette("", []).objects.every((o) => o.group === "common")).toBe(true);
  });
});
