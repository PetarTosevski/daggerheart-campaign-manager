import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_PACK_SPRITES, MAX_SPRITE_BYTES, MAX_SPRITE_PACKS, MAX_SPRITE_PX } from "../../convex/lib/validators/spritePacks";
import { classicFits, suggestClassic, uniqueSlug, slugOf, defaultLabels } from "../../src/components/combat-map/packs/labels";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

// Sprite packs P8 (plan .omc/plans/sprite-packs.yaml): the GM's packs, uploads and labels. Every function is the
// GM's (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN); uploads follow CF16 / CF17 (E7): a
// rejected file is deleted and the mutation returns {ok: false, code}. TE2's authz matrix does not exist yet; D12
// folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

/** Labels of a 1 x 1 cover object, as the upload screen sends them. */
const LABELS = {
  name: "Standing stone",
  category: "object",
  w: 1,
  h: 1,
  sight: "block",
  light: "none",
  height: "tall",
  footprint: "circle",
  classicKind: "pillar",
  px: { w: 160, h: 160 },
} as const;

async function outsider(t: Setup["t"]) {
  const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
  return t.withIdentity({ subject: `${id}|session` });
}

/** A campaign with a joined player, a pack and helpers to store uploads and attach sprites. */
async function withPack() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { packId } = await gm.mutation(api.spritePacks.createPack, { campaignId, name: "Moors", extends: "forest", idempotencyKey: key() });
  // convex-test records no content type, so set the one an upload would carry (as combat-maps.test.ts does).
  const store = (contentType = "image/webp", bytes = 64) =>
    t.run(async (c) => {
      const id = await c.storage.store(new Blob([new Uint8Array(bytes)], { type: contentType }));
      await (c.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType });
      return id;
    });
  const attach = async (labels: Record<string, unknown> = {}, pack: Id<"spritePacks"> = packId) => {
    const result = await gm.mutation(api.spritePacks.attachSprite, { campaignId, packId: pack, storageId: await store(), ...LABELS, ...labels } as never);
    if (!result.ok) throw new Error(result.message);
    return result.spriteId;
  };
  const sprite = (id: Id<"spritePackSprites">) => t.run((c) => c.db.get("spritePackSprites", id));
  const files = () => t.run((c) => c.db.query("files").collect());
  const packs = () => gm.query(api.spritePacks.packs, { campaignId });
  return { ...ctx, player, packId, store, attach, sprite, files, packs };
}

describe("sprite packs: access", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("keeps every function from anonymous callers, outsiders and players, and lets the GM run each", async () => {
    const f = await withPack();
    const { campaignId, packId } = f;
    const spriteId = await f.attach();
    const second = await f.attach({ name: "Cairn" });
    const storageIds = [await f.store(), await f.store(), await f.store(), await f.store()];
    let next = 0;
    const calls = {
      packs: (c: Client) => c.query(api.spritePacks.packs, { campaignId }),
      createPack: (c: Client) => c.mutation(api.spritePacks.createPack, { campaignId, name: "Extra", idempotencyKey: key() }),
      renamePack: (c: Client) => c.mutation(api.spritePacks.renamePack, { campaignId, packId, name: "Heath" }),
      setPackExtends: (c: Client) => c.mutation(api.spritePacks.setPackExtends, { campaignId, packId, extends: null }),
      spriteUploadUrl: (c: Client) => c.mutation(api.spritePacks.spriteUploadUrl, { campaignId }),
      attachSprite: (c: Client) => c.mutation(api.spritePacks.attachSprite, { campaignId, packId, storageId: storageIds[next++]!, ...LABELS }),
      updateSprite: (c: Client) => c.mutation(api.spritePacks.updateSprite, { campaignId, spriteId, patch: { sight: "cover" } }),
      reorderSprite: (c: Client) => c.mutation(api.spritePacks.reorderSprite, { campaignId, spriteId, direction: "down" }),
      removeSprite: (c: Client) => c.mutation(api.spritePacks.removeSprite, { campaignId, spriteId: second }),
      deletePack: (c: Client) => c.mutation(api.spritePacks.deletePack, { campaignId, packId }),
    };
    const names = Object.keys(calls) as (keyof typeof calls)[];
    const out = await outsider(f.t);
    for (const name of names) expect([name, await code(calls[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(calls[name](out))]).toEqual([name, "NOT_FOUND"]);
    for (const name of names) expect([name, await code(calls[name](f.player))]).toEqual([name, "FORBIDDEN"]);
    // The GM last: deletePack runs after every call that needs the pack.
    for (const name of names) expect([name, await code(calls[name](f.gm))]).toEqual([name, "ok"]);
  });

  it("refuses another campaign's pack and sprite", async () => {
    const a = await withPack();
    const spriteId = await a.attach();
    const { campaignId: mine } = await a.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const storageId = await a.store();
    expect(await code(a.gm.mutation(api.spritePacks.renamePack, { campaignId: mine, packId: a.packId, name: "X" }))).toBe("SPRITE_PACK_NOT_FOUND");
    expect(await code(a.gm.mutation(api.spritePacks.deletePack, { campaignId: mine, packId: a.packId }))).toBe("SPRITE_PACK_NOT_FOUND");
    expect(await code(a.gm.mutation(api.spritePacks.attachSprite, { campaignId: mine, packId: a.packId, storageId, ...LABELS }))).toBe("SPRITE_PACK_NOT_FOUND");
    // Refused before the file is touched: it stays for the orphan sweep.
    expect(await a.t.run((c) => c.storage.getUrl(storageId))).not.toBeNull();
    expect(await code(a.gm.mutation(api.spritePacks.updateSprite, { campaignId: mine, spriteId, patch: { w: 2 } }))).toBe("SPRITE_NOT_FOUND");
    expect(await code(a.gm.mutation(api.spritePacks.removeSprite, { campaignId: mine, spriteId }))).toBe("SPRITE_NOT_FOUND");
    expect(await code(a.gm.mutation(api.spritePacks.reorderSprite, { campaignId: mine, spriteId, direction: "up" }))).toBe("SPRITE_NOT_FOUND");
    expect(await code(a.gm.mutation(api.spritePacks.renamePack, { campaignId: a.campaignId, packId: "nope", name: "X" }))).toBe("SPRITE_PACK_NOT_FOUND");
    expect(await code(a.gm.mutation(api.spritePacks.removeSprite, { campaignId: a.campaignId, spriteId: "nope" }))).toBe("SPRITE_NOT_FOUND");
  });
});

describe("sprite packs: packs", () => {
  useAllowlist();

  it("creates packs that are their own setting or add to a built-in one (Q3), once per key", async () => {
    const f = await withPack();
    const k = key();
    const first = await f.gm.mutation(api.spritePacks.createPack, { campaignId: f.campaignId, name: "  Ship deck  ", idempotencyKey: k });
    const replay = await f.gm.mutation(api.spritePacks.createPack, { campaignId: f.campaignId, name: "  Ship deck  ", idempotencyKey: k });
    expect(replay.packId).toBe(first.packId);
    const rows = await f.packs();
    expect(rows.map((p) => [p.name, p.extends])).toEqual([
      ["Moors", { id: "forest", label: "Forest" }],
      ["Ship deck", null],
    ]);
    // Both appear in the Setting picker's options (P5 `settings`).
    const settings = await f.gm.query(api.combatMapStyle.settings, { campaignId: f.campaignId });
    expect(settings.packs.map((p) => [p.name, p.extends?.id ?? null])).toEqual([
      ["Moors", "forest"],
      ["Ship deck", null],
    ]);
  });

  it("checks names, built-in settings and the pack cap", async () => {
    const f = await withPack();
    const create = (name: string, ext?: string) =>
      code(f.gm.mutation(api.spritePacks.createPack, { campaignId: f.campaignId, name, ...(ext ? { extends: ext } : {}), idempotencyKey: key() }));
    expect(await create("   ")).toBe("INVALID");
    expect(await create("x".repeat(61))).toBe("INVALID");
    expect(await create("Ok", "common")).toBe("SPRITE_SETTING_UNKNOWN");
    expect(await create("Ok", "atlantis")).toBe("SPRITE_SETTING_UNKNOWN");
    for (let i = 1; i < MAX_SPRITE_PACKS; i++) expect(await create(`Pack ${i}`)).toBe("ok");
    expect(await create("One too many")).toBe("SPRITE_PACK_LIMIT");
  });

  it("renames a pack and changes what it extends", async () => {
    const f = await withPack();
    const { campaignId, packId } = f;
    await f.gm.mutation(api.spritePacks.renamePack, { campaignId, packId, name: " Heath " });
    await f.gm.mutation(api.spritePacks.setPackExtends, { campaignId, packId, extends: "swamp" });
    expect((await f.packs())[0]).toMatchObject({ name: "Heath", extends: { id: "swamp", label: "Swamp" } });
    await f.gm.mutation(api.spritePacks.setPackExtends, { campaignId, packId, extends: null });
    expect((await f.packs())[0]!.extends).toBeNull();
    expect(await f.t.run(async (c) => "extends" in (await c.db.get("spritePacks", packId))!)).toBe(false);
    expect(await code(f.gm.mutation(api.spritePacks.setPackExtends, { campaignId, packId, extends: "common" }))).toBe("SPRITE_SETTING_UNKNOWN");
    expect(await code(f.gm.mutation(api.spritePacks.renamePack, { campaignId, packId, name: "" }))).toBe("INVALID");
  });

  it("deletes a pack with its sprites and files; objects that used them stay and fall back (D9)", async () => {
    const f = await withPack();
    const { campaignId, packId } = f;
    const a = await f.attach();
    await f.attach({ name: "Cairn" });
    const storage = (await f.files()).map((r) => r.storageId);
    const { mapId } = await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    const objectId = await f.t.run((c) => c.db.insert("combatMapObjects", { mapId, kind: "pillar", x: 2, y: 2, r: 0.5, rot: 0, sprite: { uploaded: a } }));
    await f.gm.mutation(api.spritePacks.deletePack, { campaignId, packId });
    expect(await f.packs()).toEqual([]);
    expect(await f.files()).toEqual([]);
    expect(await f.t.run((c) => c.db.query("spritePackSprites").collect())).toEqual([]);
    for (const id of storage) expect(await f.t.run((c) => c.storage.getUrl(id))).toBeNull();
    expect(await f.t.run((c) => c.db.get("combatMapObjects", objectId))).toMatchObject({ kind: "pillar", sprite: { uploaded: a } });
    const sources = await f.gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(sources.sprites).toEqual([]);
  });
});

describe("sprite packs: uploads", () => {
  useAllowlist();

  it("claims an allowed upload as kind sprite and lists it with its labels, URL and traits", async () => {
    const f = await withPack();
    const spriteId = await f.attach();
    const file = (await f.files())[0]!;
    expect(file).toMatchObject({ kind: "sprite", refId: spriteId, campaignId: f.campaignId });
    const row = (await f.sprite(spriteId))!;
    expect(row).toMatchObject({ fileId: file._id, name: "Standing stone", slug: "standing-stone", sight: "block", order: 0, classicKind: "pillar" });
    expect(row.terrain).toBeUndefined();
    const listed = (await f.packs())[0]!.sprites;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ _id: spriteId, name: "Standing stone", w: 1, h: 1, sight: "block", light: "none", height: "tall", packId: f.packId });
    expect(listed[0]!.url).toEqual(expect.any(String));
  });

  it("gives each sprite a unique slug and the next order; textures keep a terrain class and rotate by default", async () => {
    const f = await withPack();
    await f.attach();
    const twin = await f.attach();
    const moss = await f.attach({ name: "Moss", category: "texture", terrain: "grass", sight: "none", height: "flat", classicKind: "rubble" });
    expect(await f.sprite(twin)).toMatchObject({ slug: "standing-stone-2", order: 1 });
    expect(await f.sprite(moss)).toMatchObject({ category: "texture", terrain: "grass", rotatable: true, order: 2 });
  });

  it("deletes a rejected file and returns ok: false (SVG, text, too big, too many pixels)", async () => {
    const f = await withPack();
    const attempts = [
      { storageId: await f.store("image/svg+xml"), px: LABELS.px },
      { storageId: await f.store("text/plain"), px: LABELS.px },
      { storageId: await f.store("image/png", MAX_SPRITE_BYTES + 1), px: LABELS.px },
      { storageId: await f.store("image/png"), px: { w: MAX_SPRITE_PX + 1, h: 10 } },
      { storageId: await f.store("image/png"), px: { w: 0, h: 10 } },
    ];
    for (const attempt of attempts) {
      const result = await f.gm.mutation(api.spritePacks.attachSprite, { campaignId: f.campaignId, packId: f.packId, ...LABELS, ...attempt });
      expect(result).toMatchObject({ ok: false, code: "INVALID" });
      expect(await f.t.run((c) => c.storage.getUrl(attempt.storageId))).toBeNull();
    }
    expect(await f.files()).toEqual([]);
    expect((await f.packs())[0]!.sprites).toEqual([]);
  });

  it("refuses a claimed or missing file with NOT_FOUND and keeps it (a storage id is no proof of access)", async () => {
    const f = await withPack();
    const spriteId = await f.attach();
    const claimed = (await f.files())[0]!.storageId;
    expect(await code(f.gm.mutation(api.spritePacks.attachSprite, { campaignId: f.campaignId, packId: f.packId, storageId: claimed, ...LABELS }))).toBe(
      "NOT_FOUND",
    );
    expect(await f.t.run((c) => c.storage.getUrl(claimed))).not.toBeNull();
    expect(await f.sprite(spriteId)).not.toBeNull();
  });

  it("refuses bad labels with INVALID before touching the file", async () => {
    const f = await withPack();
    const storageId = await f.store();
    for (const labels of [
      { name: " " },
      { name: "x".repeat(61) },
      { w: 0 },
      { h: 5 },
      { w: 1.5 },
      { category: "texture" as const },
      { light: "torch" as const, classicKind: "pillar" as const },
      { light: "none" as const, classicKind: "campfire" as const },
      { light: "faintglow" as const, classicKind: "walltorch" as const },
    ]) {
      expect([labels, await code(f.gm.mutation(api.spritePacks.attachSprite, { campaignId: f.campaignId, packId: f.packId, storageId, ...LABELS, ...labels }))]).toEqual([
        labels,
        "INVALID",
      ]);
    }
    expect(await f.t.run((c) => c.storage.getUrl(storageId))).not.toBeNull();
  });

  it("returns SPRITE_LIMIT and deletes the file past MAX_PACK_SPRITES", async () => {
    const f = await withPack();
    await f.t.run(async (c) => {
      const gmId = (await c.db.query("users").first())!._id;
      for (let i = 0; i < MAX_PACK_SPRITES; i++) {
        const storageId = await c.storage.store(new Blob([new Uint8Array(4)]));
        const fileId = await c.db.insert("files", { storageId, campaignId: f.campaignId, uploadedBy: gmId, kind: "sprite", refId: "pending", createdAt: 1 });
        const { name: _name, ...rest } = LABELS;
        void _name;
        await c.db.insert("spritePackSprites", { campaignId: f.campaignId, packId: f.packId, fileId, name: `S${i}`, slug: `s${i}`, ...rest, order: i, createdAt: 1 });
      }
    });
    const storageId = await f.store();
    const result = await f.gm.mutation(api.spritePacks.attachSprite, { campaignId: f.campaignId, packId: f.packId, storageId, ...LABELS });
    expect(result).toMatchObject({ ok: false, code: "SPRITE_LIMIT" });
    expect(await f.t.run((c) => c.storage.getUrl(storageId))).toBeNull();
  });

  it("puts uploaded sprites of a pack added to Forest into a forest map's sprite sources, labelled for the GM only", async () => {
    const f = await withPack();
    const { campaignId } = f;
    const stone = await f.attach();
    const { mapId } = await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    await f.gm.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "forest" } });
    const gm = await f.gm.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(gm.view).toBe("gm");
    expect(gm.sprites.map((s) => ("name" in s ? [s._id, s.name, s.sight, s.w] : null))).toEqual([[stone, "Standing stone", "block", 1]]);
    // A player sees only sprites placed on the live map, without labels (D10).
    const player = await f.player.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
    expect(player.sprites).toEqual([]);
  });
});

describe("sprite packs: labels", () => {
  useAllowlist();

  it("changes one label per call; a new name gets a unique slug", async () => {
    const f = await withPack();
    const { campaignId } = f;
    const stone = await f.attach();
    const other = await f.attach({ name: "Cairn" });
    const update = (spriteId: Id<"spritePackSprites">, patch: Record<string, unknown>) =>
      f.gm.mutation(api.spritePacks.updateSprite, { campaignId, spriteId, patch } as never);
    await update(other, { name: "Standing stone" });
    expect(await f.sprite(other)).toMatchObject({ name: "Standing stone", slug: "standing-stone-2" });
    await update(stone, { name: "Standing stone" });
    expect(await f.sprite(stone)).toMatchObject({ slug: "standing-stone" });
    await update(stone, { w: 2 });
    await update(stone, { h: 1 });
    await update(stone, { sight: "cover" });
    await update(stone, { height: "low" });
    await update(stone, { footprint: "rect" });
    await update(stone, { classicKind: "boulder" });
    expect(await f.sprite(stone)).toMatchObject({ w: 2, h: 1, sight: "cover", height: "low", footprint: "rect", classicKind: "boulder" });
    await update(stone, { category: "texture" });
    expect(await f.sprite(stone)).toMatchObject({ category: "texture", terrain: "grass", rotatable: true });
    await update(stone, { terrain: "snow" });
    await update(stone, { rotatable: false });
    expect(await f.sprite(stone)).toMatchObject({ terrain: "snow", rotatable: false });
    for (const patch of [{ w: 0 }, { h: 4.5 }, { name: "" }]) expect(await code(update(stone, patch))).toBe("INVALID");
    // Two fields at once are refused by the validator (an intent is one field).
    await expect(update(stone, { w: 2, h: 2 })).rejects.toThrow();
  });

  it("keeps the Classic look lighting like the sprite (D2)", async () => {
    const f = await withPack();
    const { campaignId } = f;
    const lamp = await f.attach({ name: "Lamp" });
    const update = (patch: Record<string, unknown>) => f.gm.mutation(api.spritePacks.updateSprite, { campaignId, spriteId: lamp, patch } as never);
    await update({ light: "torch" });
    expect(await f.sprite(lamp)).toMatchObject({ light: "torch", classicKind: "torch" });
    await update({ classicKind: "walltorch" });
    expect(await code(update({ classicKind: "campfire" }))).toBe("INVALID");
    await update({ light: "campfire" });
    expect(await f.sprite(lamp)).toMatchObject({ classicKind: "campfire" });
    await update({ light: "faintglow" });
    expect(await f.sprite(lamp)).toMatchObject({ light: "faintglow", classicKind: "crystal" });
    await update({ light: "none" });
    expect(await f.sprite(lamp)).toMatchObject({ light: "none", classicKind: "crystal" });
  });

  it("removes a sprite and its file, and moves sprites up and down", async () => {
    const f = await withPack();
    const { campaignId } = f;
    const a = await f.attach({ name: "A" });
    const b = await f.attach({ name: "B" });
    const c = await f.attach({ name: "C" });
    const names = async () => (await f.packs())[0]!.sprites.map((s) => s.name);
    await f.gm.mutation(api.spritePacks.reorderSprite, { campaignId, spriteId: c, direction: "up" });
    expect(await names()).toEqual(["A", "C", "B"]);
    await f.gm.mutation(api.spritePacks.reorderSprite, { campaignId, spriteId: a, direction: "up" });
    expect(await names()).toEqual(["A", "C", "B"]);
    await f.gm.mutation(api.spritePacks.reorderSprite, { campaignId, spriteId: a, direction: "down" });
    expect(await names()).toEqual(["C", "A", "B"]);
    await f.gm.mutation(api.spritePacks.reorderSprite, { campaignId, spriteId: b, direction: "down" });
    expect(await names()).toEqual(["C", "A", "B"]);

    const storage = (await f.files()).find((r) => r.refId === b)!.storageId;
    await f.gm.mutation(api.spritePacks.removeSprite, { campaignId, spriteId: b });
    expect(await names()).toEqual(["C", "A"]);
    expect(await f.sprite(b)).toBeNull();
    expect((await f.files()).map((r) => r.refId).sort()).toEqual([a, c].sort());
    expect(await f.t.run((ctx) => ctx.storage.getUrl(storage))).toBeNull();
  });
});

describe("sprite packs: label helpers", () => {
  it("suggests a Classic look that fits the light (D2) and makes unique slugs", () => {
    const lights = ["none", "faintglow", "torch", "campfire"] as const;
    for (const light of lights)
      for (const sight of ["block", "cover", "none"] as const)
        for (const w of [1, 2])
          for (const category of ["object", "texture"] as const)
            expect(classicFits(suggestClassic({ category, w, h: w, sight, light }), light)).toBe(true);
    expect(suggestClassic({ category: "object", w: 1, h: 1, sight: "block", light: "none" })).toBe("pillar");
    expect(suggestClassic({ category: "object", w: 2, h: 2, sight: "cover", light: "none" })).toBe("table");
    expect(slugOf("Bird's Nest (on the ground)")).toBe("birds-nest-on-the-ground");
    expect(slugOf("!!!")).toBe("sprite");
    expect(uniqueSlug("a", new Set(["a", "a-2"]))).toBe("a-3");
    expect(defaultLabels("large", 0)).toMatchObject({ name: "Sprite 1", w: 2, h: 2, sight: "cover", classicKind: "table" });
    expect(defaultLabels("terrain", 3)).toMatchObject({ name: "Texture 4", category: "texture", sight: "none", height: "flat", terrain: "grass" });
  });
});
