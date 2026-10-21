import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SETTINGS } from "../../src/lib/sprite-packs/index";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

// Sprite packs P5 (plan .omc/plans/sprite-packs.yaml): setStyle / setSetting / settings are the GM's (player
// FORBIDDEN, outsider NOT_FOUND, anonymous UNAUTHENTICATED); spriteSources is every member's, a player only for
// the live map (D10). TE2's authz matrix does not exist yet; D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

/** A third account outside the campaign. */
async function outsider(t: Setup["t"]) {
  const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
  return t.withIdentity({ subject: `${id}|session` });
}

type SpriteRow = { name: string; light?: "none" | "faintglow" | "torch" | "campfire"; category?: "object" | "texture" };

/** A campaign with a player, a live map and a second (hidden) map, and helpers to add packs and uploaded sprites. */
async function withMaps() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const { mapId: hidden } = await gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
  const gmId = await t.run(async (c) => (await c.db.query("users").first())!._id);

  const pack = (name: string, extendsId?: string, campaign: Id<"campaigns"> = campaignId) =>
    t.run((c) =>
      c.db.insert("spritePacks", { campaignId: campaign, name, ...(extendsId === undefined ? {} : { extends: extendsId }), createdBy: gmId, createdAt: 1, updatedAt: 1 }),
    );
  const sprite = (packId: Id<"spritePacks">, row: SpriteRow, order = 0, campaign: Id<"campaigns"> = campaignId) =>
    t.run(async (c) => {
      const storageId = await c.storage.store(new Blob([new Uint8Array(8)], { type: "image/webp" }));
      const fileId = await c.db.insert("files", { storageId, campaignId: campaign, uploadedBy: gmId, kind: "sprite", refId: "pending", createdAt: 1 });
      const id = await c.db.insert("spritePackSprites", {
        campaignId: campaign,
        packId,
        fileId,
        name: row.name,
        slug: row.name.toLowerCase().replace(/\s+/g, "-"),
        category: row.category ?? "object",
        w: 1,
        h: 1,
        sight: "cover",
        light: row.light ?? "none",
        height: "low",
        footprint: "circle",
        classicKind: "crate",
        px: { w: 160, h: 160 },
        order,
        createdAt: 1,
      });
      await c.db.patch("files", fileId, { refId: id });
      return id;
    });
  const mapRow = (id: Id<"combatMaps"> = mapId) => t.run(async (c) => (await c.db.get("combatMaps", id))!);
  return { ...ctx, player, mapId, hidden, gmId, pack, sprite, mapRow };
}

describe("combat map style: access", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("keeps the GM functions from anonymous callers, outsiders and players, and lets the GM run each", async () => {
    const f = await withMaps();
    const { campaignId, mapId } = f;
    const gmOnly = {
      setStyle: (c: Client) => c.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" }),
      setSetting: (c: Client) => c.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "forest" } }),
      settings: (c: Client) => c.query(api.combatMapStyle.settings, { campaignId }),
    };
    const names = Object.keys(gmOnly) as (keyof typeof gmOnly)[];
    const out = await outsider(f.t);
    for (const name of names) expect([name, await code(gmOnly[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(gmOnly[name](out))]).toEqual([name, "NOT_FOUND"]);
    for (const name of names) expect([name, await code(gmOnly[name](f.player))]).toEqual([name, "FORBIDDEN"]);
    for (const name of names) expect([name, await code(gmOnly[name](f.gm))]).toEqual([name, "ok"]);
  });

  it("lets every member read the live map's sprite sources and only the GM any other map's", async () => {
    const f = await withMaps();
    const { campaignId, mapId, hidden } = f;
    const sources = (c: Client, id = mapId) => c.query(api.combatMapStyle.spriteSources, { campaignId, mapId: id });
    const out = await outsider(f.t);
    expect(await code(sources(f.t as unknown as Client))).toBe("UNAUTHENTICATED");
    expect(await code(sources(out))).toBe("NOT_FOUND");
    expect(await code(sources(f.player))).toBe("ok");
    expect(await code(sources(f.gm))).toBe("ok");
    // A map that is not live: the player gets nothing (D10), the GM reads it.
    expect(await code(sources(f.player, hidden))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(sources(f.gm, hidden))).toBe("ok");
    // Bad ids and another campaign's map.
    expect(await code(sources(f.gm, "nope" as Id<"combatMaps">))).toBe("COMBAT_MAP_NOT_FOUND");
    const { campaignId: mine } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await code(f.gm.query(api.combatMapStyle.spriteSources, { campaignId: mine, mapId }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatMapStyle.setStyle, { campaignId: mine, mapId, style: "sprites" }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatMapStyle.setSetting, { campaignId: mine, mapId, setting: null }))).toBe("COMBAT_MAP_NOT_FOUND");
  });
});

describe("combat map style: setStyle", () => {
  useAllowlist();

  it("leaves new and D9 maps Classic and stores the keyword-picked setting on the first switch to Sprites (Q4, D7)", async () => {
    const f = await withMaps();
    const { campaignId, mapId } = f;
    // Q4: a new map has no style (Classic).
    expect((await f.mapRow()).style).toBeUndefined();
    expect((await f.gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId })).style).toBe("classic");
    await f.t.run((c) => c.db.patch("combatMaps", mapId, { prompt: "A snowy tundra camp in a blizzard" }));

    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
    let row = await f.mapRow();
    expect([row.style, row.setting, row.settingPicked]).toEqual(["sprites", { builtin: "snow-and-tundra" }, false]);

    // Back to Classic: only the style changes (D1); the setting stays for the next switch.
    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "classic" });
    row = await f.mapRow();
    expect([row.style, row.setting, row.settingPicked]).toEqual(["classic", { builtin: "snow-and-tundra" }, false]);

    // A GM-picked setting is never overwritten by a switch.
    await f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "tavern" } });
    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
    row = await f.mapRow();
    expect([row.style, row.setting, row.settingPicked]).toEqual(["sprites", { builtin: "tavern" }, true]);
  });

  it("writes no object, area or cell rows (D1)", async () => {
    const f = await withMaps();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "tree", x: 4.5, y: 4.5 });
    const snapshot = () =>
      f.t.run(async (c) => ({
        objects: await c.db.query("combatMapObjects").withIndex("by_map", (q) => q.eq("mapId", mapId)).collect(),
        cells: await c.db.query("combatMapCells").withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId)).collect(),
        areas: (await c.db.get("combatMaps", mapId))!.areas,
      }));
    const before = await snapshot();
    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "classic" });
    expect(await snapshot()).toEqual(before);
  });
});

describe("combat map style: setSetting and settings", () => {
  useAllowlist();

  it("stores a built-in setting or a campaign pack, and null lets Claude choose (keyword pick, not picked)", async () => {
    const f = await withMaps();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "cave" } });
    expect([(await f.mapRow()).setting, (await f.mapRow()).settingPicked]).toEqual([{ builtin: "cave" }, true]);

    const own = await f.pack("Clockwork");
    await f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { pack: own } });
    expect([(await f.mapRow()).setting, (await f.mapRow()).settingPicked]).toEqual([{ pack: own }, true]);

    await f.t.run((c) => c.db.patch("combatMaps", mapId, { prompt: "A brawl in a smoky tavern" }));
    await f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: null });
    expect([(await f.mapRow()).setting, (await f.mapRow()).settingPicked]).toEqual([{ builtin: "tavern" }, false]);
  });

  it("refuses an unknown built-in setting, common, and a pack of another campaign or a deleted one", async () => {
    const f = await withMaps();
    const { campaignId, mapId } = f;
    const set = (setting: { builtin: string } | { pack: Id<"spritePacks"> }) => code(f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting }));
    expect(await set({ builtin: "moon" })).toBe("SPRITE_SETTING_UNKNOWN");
    expect(await set({ builtin: "common" })).toBe("SPRITE_SETTING_UNKNOWN");
    const { campaignId: theirs } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
    expect(await set({ pack: await f.pack("Foreign", undefined, theirs) })).toBe("SPRITE_PACK_NOT_FOUND");
    const gone = await f.pack("Gone");
    await f.t.run((c) => c.db.delete("spritePacks", gone));
    expect(await set({ pack: gone })).toBe("SPRITE_PACK_NOT_FOUND");
    expect((await f.mapRow()).setting).toBeUndefined();
  });

  it("lists the built-in settings and the campaign's packs, own settings and extensions (Q3)", async () => {
    const f = await withMaps();
    const { campaignId } = f;
    const own = await f.pack("Clockwork");
    const ext = await f.pack("More trees", "forest");
    const odd = await f.pack("Odd", "nowhere");
    const { campaignId: theirs } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
    await f.pack("Foreign", undefined, theirs);
    const result = await f.gm.query(api.combatMapStyle.settings, { campaignId });
    expect(result.builtin).toEqual(SETTINGS.map((s) => ({ id: s.id, label: s.label })));
    expect(result.builtin.map((s) => s.id)).not.toContain("common");
    expect(result.packs).toEqual([
      { _id: own, name: "Clockwork", extends: null },
      { _id: ext, name: "More trees", extends: { id: "forest", label: "Forest" } },
      { _id: odd, name: "Odd", extends: null },
    ]);
  });
});

describe("combat map style: spriteSources", () => {
  useAllowlist();

  it("gives the GM the setting's packs and every uploaded ref, a player only the live map's referenced sprites (D10)", async () => {
    const f = await withMaps();
    const { campaignId, mapId } = f;
    const trees = await f.pack("More trees", "forest");
    const caves = await f.pack("Cave bits", "cave");
    const birch = await f.sprite(trees, { name: "Birch" }, 0);
    const willow = await f.sprite(trees, { name: "Willow", light: "faintglow" }, 1);
    const stalagmite = await f.sprite(caves, { name: "Stalagmite" }, 0);
    const moss = await f.sprite(caves, { name: "Moss", category: "texture" }, 1);
    const glow = await f.sprite(caves, { name: "Glow" }, 2);
    await f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "forest" } });
    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
    await f.t.run(async (c) => {
      await c.db.insert("combatMapObjects", { mapId, kind: "rock", x: 3, y: 3, r: 0.5, rot: 0, sprite: { uploaded: stalagmite } });
      await c.db.insert("combatMapObjects", { mapId, kind: "tree", x: 5, y: 5, r: 1, rot: 0, sprite: { builtin: "forest/oak-tree" } });
      await c.db.insert("combatMapObjects", { mapId, kind: "tree", x: 7, y: 5, r: 1, rot: 0, sprite: { uploaded: birch } });
      await c.db.patch("combatMaps", mapId, {
        areas: [{ terrain: "grass", shape: "rect", x: 1, y: 1, w: 3, h: 3, texture: { uploaded: moss } }],
        texturePalette: [{ uploaded: glow }],
      });
    });

    const gmView = await f.gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    if (gmView.view !== "gm") throw new Error("expected the GM's sources");
    expect([gmView.style, gmView.setting, gmView.settingPicked]).toEqual(["sprites", { builtin: "forest" }, true]);
    expect(gmView.sprites.map((s) => s._id).sort()).toEqual([birch, willow, stalagmite, moss, glow].sort());
    const willowRow = gmView.sprites.find((s) => s._id === willow)!;
    expect(willowRow).toMatchObject({ name: "Willow", packId: trees, light: "faintglow", category: "object", w: 1, h: 1, classicKind: "crate" });
    expect(typeof willowRow.url).toBe("string");

    const playerView = await f.player.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    if (playerView.view !== "player") throw new Error("expected the player's sources");
    expect([playerView.style, playerView.setting]).toEqual(["sprites", { builtin: "forest" }]);
    // Only what the map references: the unplaced Willow stays the GM's; no labels or packs (D10).
    expect(playerView.sprites.map((s) => s._id).sort()).toEqual([birch, stalagmite, moss, glow].sort());
    for (const row of playerView.sprites) {
      expect(Object.keys(row)).not.toContain("name");
      expect(Object.keys(row)).not.toContain("packId");
      expect(typeof row.url).toBe("string");
    }
    expect(JSON.stringify(playerView)).not.toMatch(/Birch|Stalagmite|Moss|Glow|Willow|More trees|Cave bits/);
  });

  it("resolves a missing or deleted setting by keywords and drops deleted, foreign and fileless sprites (D7, D9)", async () => {
    const f = await withMaps();
    const { campaignId, mapId } = f;
    await f.t.run((c) => c.db.patch("combatMaps", mapId, { prompt: "Pirates board a galleon" }));
    // No stored setting: the keyword picker's, not picked.
    let view = await f.gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(view.setting).toEqual({ builtin: "ship-deck" });
    expect(view.view === "gm" && view.settingPicked).toBe(false);

    const own = await f.pack("Clockwork");
    const cog = await f.sprite(own, { name: "Cog" });
    const lost = await f.sprite(own, { name: "Lost" }, 1);
    const { campaignId: theirs } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
    const foreign = await f.sprite(await f.pack("Foreign", undefined, theirs), { name: "Foreign" }, 0, theirs);
    await f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { pack: own } });
    view = await f.gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(view.setting).toEqual({ pack: own });
    expect(view.sprites.map((s) => s._id).sort()).toEqual([cog, lost].sort());

    await f.t.run(async (c) => {
      await c.db.insert("combatMapObjects", { mapId, kind: "crate", x: 3, y: 3, r: 0.5, rot: 0, sprite: { uploaded: foreign } });
      await c.db.insert("combatMapObjects", { mapId, kind: "crate", x: 4, y: 3, r: 0.5, rot: 0, sprite: { uploaded: cog } });
      // Cog's file is gone: it stays listed with no link (the painter draws its Classic kind).
      const row = (await c.db.get("spritePackSprites", cog))!;
      await c.db.delete("files", row.fileId);
      await c.db.delete("spritePackSprites", lost);
    });
    view = await f.player.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(view.sprites).toHaveLength(1);
    expect(view.sprites[0]).toMatchObject({ _id: cog, url: null });

    // The pack is deleted: back to the keyword picker; the referenced row still resolves while it exists.
    await f.t.run((c) => c.db.delete("spritePacks", own));
    view = await f.gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(view.setting).toEqual({ builtin: "ship-deck" });
    expect(view.view === "gm" && view.settingPicked).toBe(false);
    expect(view.sprites.map((s) => s._id)).toEqual([cog]);
  });
});
