import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseSetting, scenePrompt, settingOptions, settingPrompt } from "../../convex/combatMapGenerate";
import { folderOfKey } from "../../src/lib/sprite-packs/index";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// Sprite packs P7 (plan .omc/plans/sprite-packs.yaml): `generate` takes an optional setting (absent = "Let Claude
// choose"). A Sprites map without a pick runs a classification call, then the sprite layout call (one generation,
// Q2); a picked setting runs one call; a Classic map keeps today's scene prompt (E6); without Claude the keyword
// layout is mapped to the setting. fetch is stubbed: no test reaches the Messages API.
// TE2's authz matrix does not exist yet; D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];
type Setting = { builtin: string } | { pack: Id<"spritePacks"> };

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

/** A Messages API reply whose text is `text`. */
function reply(text: string, stopReason = "end_turn"): Response {
  return new Response(JSON.stringify({ stop_reason: stopReason, content: [{ type: "text", text }] }), { status: 200 });
}

/** A tavern laid out with sprites, plus parts the cleaner must drop (unknown keys, a texture used as an object). */
const tavernReply = {
  title: "The Prancing Pony",
  base: "wall",
  areas: [
    { terrain: "wood", texture: "tavern/tavern-floorboards", shape: "rect", x: 2, y: 2, w: 26, h: 16 },
    { terrain: "stone", texture: "tavern/no-such-floor", shape: "rect", x: 20, y: 3, w: 6, h: 5 },
    { terrain: "grass", texture: "tavern/kitchen-tiles", shape: "rect", x: 4, y: 12, w: 4, h: 4 },
    { terrain: "lava", shape: "teleport", x: 1, y: 1 },
  ],
  objects: [
    { sprite: "tavern/hearth-fireplace", x: 15, y: 3, rot: 0, scale: 1 },
    { sprite: "tavern/keg", x: 5, y: 5, rot: 0.3, scale: 9 },
    { sprite: "common/barrel", x: 6, y: 5, rot: 0 },
    { sprite: "tavern/dragon-egg", x: 8, y: 8, rot: 0, scale: 1 },
    { sprite: "tavern/worn-planks", x: 9, y: 9, rot: 0, scale: 1 },
    { kind: "tree", x: 3, y: 3, r: 1 },
  ],
};

/** The prompt text of each Messages API call so far. */
function prompts(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
  return fetchMock.mock.calls.map(([, init]) => (JSON.parse(init!.body as string) as { messages: { content: string }[] }).messages[0]!.content);
}

/** The max_tokens of each call so far. */
function maxTokens(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): number[] {
  return fetchMock.mock.calls.map(([, init]) => (JSON.parse(init!.body as string) as { max_tokens: number }).max_tokens);
}

async function withMap(style: "classic" | "sprites" = "sprites") {
  const ctx = await setupWithCampaign();
  const { t, campaignId, gm } = ctx;
  // The map starts Classic (since dcm-bxp.135 a GM who never chose gets Sprites) and switches as a GM would.
  await gm.mutation(api.settings.update, { defaultMapStyle: "classic" });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  if (style === "sprites") await gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style });
  const gmId = await t.run(async (c) => (await c.db.query("users").first())!._id);
  const get = async () => (await gm.query(api.combatMaps.get, { campaignId, mapId }))!;
  const generate = (c: Client = gm, args: { prompt?: string; setting?: Setting; another?: boolean } = {}) =>
    c.action(api.combatMapGenerate.generate, {
      campaignId,
      mapId,
      prompt: args.prompt ?? "A brawl in a crowded inn common room",
      size: "medium",
      ...(args.setting === undefined ? {} : { setting: args.setting }),
      ...(args.another === undefined ? {} : { another: args.another }),
    });
  const pack = (name: string, extendsId?: string, campaign: Id<"campaigns"> = campaignId) =>
    t.run((c) =>
      c.db.insert("spritePacks", { campaignId: campaign, name, ...(extendsId === undefined ? {} : { extends: extendsId }), createdBy: gmId, createdAt: 1, updatedAt: 1 }),
    );
  const sprite = (packId: Id<"spritePacks">, name: string, category: "object" | "texture" = "object") =>
    t.run(async (c) => {
      const storageId = await c.storage.store(new Blob([new Uint8Array(8)], { type: "image/webp" }));
      const fileId = await c.db.insert("files", { storageId, campaignId, uploadedBy: gmId, kind: "sprite", refId: "pending", createdAt: 1 });
      return c.db.insert("spritePackSprites", {
        campaignId,
        packId,
        fileId,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        category,
        w: 1,
        h: 1,
        sight: "cover",
        light: "none",
        height: "low",
        footprint: "circle",
        classicKind: "barrel",
        ...(category === "texture" ? { terrain: "wood" as const } : {}),
        px: { w: 160, h: 160 },
        order: 0,
        createdAt: 1,
      });
    });
  const player = async () => {
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    return ctx.other;
  };
  return { ...ctx, mapId, get, generate, pack, sprite, player };
}

/** Every built-in folder the map's sprite and texture refs come from. */
function folders(map: Awaited<ReturnType<Awaited<ReturnType<typeof withMap>>["get"]>>): Set<string> {
  const refs = [...map.objects.map((o) => o.sprite), ...map.areas.map((a) => a.texture)];
  return new Set(refs.flatMap((r) => (r !== undefined && "builtin" in r ? [folderOfKey(r.builtin)] : [])));
}

describe("combat map generation with sprite packs", () => {
  useAllowlist();
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.ANTHROPIC_MODEL;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.unstubAllGlobals();
  });

  it("lets only the GM generate with a setting (anonymous, outsider, player refused)", async () => {
    const f = await withMap();
    fetchMock.mockImplementation(() => Promise.resolve(reply(JSON.stringify(tavernReply))));
    const tavern = { setting: { builtin: "tavern" } };
    expect(await code(f.generate(f.t as unknown as Client, tavern))).toBe("UNAUTHENTICATED");
    expect(await code(f.generate(f.other, tavern))).toBe("NOT_FOUND");
    const player = await f.player();
    expect(await code(f.generate(player, tavern))).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await code(f.generate(f.gm, tavern))).toBe("ok");
  });

  it("Let Claude choose: classifies the scene, then lays out the chosen setting's sprites (two calls, one generation)", async () => {
    const f = await withMap();
    fetchMock.mockResolvedValueOnce(reply("tavern")).mockResolvedValueOnce(reply(JSON.stringify(tavernReply)));
    const result = await f.generate();
    expect(result).toEqual({ mapId: f.mapId, saved: true, drawnBy: "claude", claude: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [classify, layout] = prompts(fetchMock);
    expect(classify).toContain("Reply with ONLY the id");
    expect(classify).toContain("tavern = Tavern");
    expect(classify).toContain("snow-and-tundra = Snow and tundra");
    expect(classify).toContain("SCENE: A brawl in a crowded inn common room");
    expect(maxTokens(fetchMock)[0]).toBeLessThan(100);
    // The layout prompt lists the tavern's and common's sprites with size and sight, and the textures with terrain.
    expect(layout).toContain('The SETTING is "Tavern"');
    expect(layout).toContain("tavern/keg (keg; 1x1; cover)");
    expect(layout).toContain("tavern/hearth-fireplace (hearth fireplace; 2x2; blocks sight)");
    expect(layout).toContain("common/barrel (barrel; 1x1; cover)");
    expect(layout).toContain("tavern/tavern-floorboards (tavern floorboards; paints wood)");
    expect(layout).not.toContain("forest/");

    const map = await f.get();
    expect(map).toMatchObject({ setting: { builtin: "tavern" }, settingPicked: false, style: "sprites", source: "generated", name: "The Prancing Pony" });
    // Unknown sprites, a texture used as an object and a Classic object are dropped; the valid parts are kept.
    expect(map.objects.map((o) => o.sprite).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([
      { builtin: "common/barrel" },
      { builtin: "tavern/hearth-fireplace" },
      { builtin: "tavern/keg" },
    ]);
    // Each object keeps its Classic look from the catalog (D1); scale sets r and is clamped (2 x 1 / 2).
    expect(map.objects.find((o) => o.sprite && "builtin" in o.sprite && o.sprite.builtin === "tavern/keg")).toMatchObject({ kind: "barrel", r: 1 });
    expect(map.objects.find((o) => o.sprite && "builtin" in o.sprite && o.sprite.builtin === "tavern/hearth-fireplace")).toMatchObject({ kind: "campfire", r: 1 });
    // An unknown texture is dropped but its area stays; a texture forces its terrain class.
    expect(map.areas.map((a) => [a.terrain, a.texture])).toEqual([
      ["wood", { builtin: "tavern/tavern-floorboards" }],
      ["stone", undefined],
      ["stone", { builtin: "tavern/kitchen-tiles" }],
    ]);
  });

  it("a picked setting runs one call and is saved as picked", async () => {
    const f = await withMap();
    fetchMock.mockImplementation(() => Promise.resolve(reply(JSON.stringify(tavernReply))));
    await f.generate(f.gm, { prompt: "A fight at night", setting: { builtin: "tavern" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prompts(fetchMock)[0]).toContain('The SETTING is "Tavern"');
    expect(await f.get()).toMatchObject({ setting: { builtin: "tavern" }, settingPicked: true });
  });

  it("adds the variation line for Another version on a Sprites map", async () => {
    const f = await withMap();
    fetchMock.mockImplementation(() => Promise.resolve(reply(JSON.stringify(tavernReply))));
    await f.generate(f.gm, { setting: { builtin: "tavern" }, another: true });
    expect(prompts(fetchMock)[0]).toMatch(/\n\(Variation #\d+: make a different layout from before\.\)$/);
  });

  it("a Classic map gets today's scene prompt in one call and stores the keyword picker's setting", async () => {
    const f = await withMap("classic");
    const classic = { title: "Inn", base: "wood", areas: [{ terrain: "stone", shape: "rect", x: 1, y: 1, w: 5, h: 5 }], objects: [{ kind: "table", x: 5, y: 5, r: 1 }, { kind: "barrel", x: 8, y: 8, r: 0.8 }] };
    fetchMock.mockImplementation(() => Promise.resolve(reply(JSON.stringify(classic))));
    await f.generate();
    expect(prompts(fetchMock)).toEqual([scenePrompt("A brawl in a crowded inn common room", 30, 20)]);
    const map = await f.get();
    expect(map).toMatchObject({ setting: { builtin: "tavern" }, settingPicked: false });
    expect(map.style).toBeUndefined();
    expect(map.objects.every((o) => o.sprite === undefined)).toBe(true);

    // A setting the GM picked is named in the scene; the prompt template is still the board's.
    fetchMock.mockClear();
    await f.generate(f.gm, { prompt: "A fight at night", setting: { builtin: "ship-deck" } });
    expect(prompts(fetchMock)).toEqual([scenePrompt("A fight at night\nSetting: Ship deck.", 30, 20)]);
    expect(await f.get()).toMatchObject({ setting: { builtin: "ship-deck" }, settingPicked: true });
  });

  it("an answer that names no setting falls back to the keyword picker and still lays out with Claude", async () => {
    const f = await withMap();
    const snowy = { ...tavernReply, objects: [{ sprite: "common/barrel", x: 6, y: 5 }, { sprite: "common/wooden-crate", x: 7, y: 5 }] };
    fetchMock.mockResolvedValueOnce(reply("I think somewhere cold")).mockResolvedValueOnce(reply(JSON.stringify(snowy)));
    const result = await f.generate(f.gm, { prompt: "An ambush on a frozen lake" });
    expect(result).toMatchObject({ drawnBy: "claude", claude: "ok" });
    expect(prompts(fetchMock)[1]).toContain('The SETTING is "Snow and tundra"');
    expect(await f.get()).toMatchObject({ setting: { builtin: "snow-and-tundra" }, settingPicked: false });
  });

  it("a failed classification draws from keywords in the keyword picker's setting, with one call", async () => {
    const f = await withMap();
    fetchMock.mockResolvedValue(new Response("overloaded", { status: 529 }));
    const result = await f.generate(f.gm, { prompt: "A dark dungeon with cells" });
    expect(result).toEqual({ mapId: f.mapId, saved: true, drawnBy: "keywords", claude: "failed", reason: "HTTP 529" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const map = await f.get();
    expect(map).toMatchObject({ setting: { builtin: "dungeon" }, settingPicked: false, name: "Dungeon" });
    expect(folders(map).has("dungeon") || folders(map).has("common")).toBe(true);
  });

  it("falls back to a sprite layout when the sprite reply is unusable", async () => {
    const f = await withMap();
    fetchMock.mockResolvedValueOnce(reply("tavern")).mockResolvedValueOnce(reply(JSON.stringify({ objects: [{ sprite: "nope/nothing", x: 1, y: 1 }] })));
    const result = await f.generate();
    expect(result).toMatchObject({ drawnBy: "keywords", claude: "failed", reason: "unusable layout" });
    const map = await f.get();
    expect(map).toMatchObject({ setting: { builtin: "tavern" }, settingPicked: false, name: "Tavern" });
    expect(folders(map).has("tavern")).toBe(true);
  });

  it.each([
    ["A bandit ambush deep in an old forest", "forest"],
    ["A brawl in a crowded inn common room", "tavern"],
    ["An ambush on a frozen lake in a blizzard", "snow-and-tundra"],
    ["A market square in a busy village", "town-street-and-market"],
    ["Prison cells in a dungeon", "dungeon"],
    ["Boarding a pirate ship", "ship-deck"],
  ])("without a key, %s becomes a %s sprite layout", async (prompt, setting) => {
    const f = await withMap();
    delete process.env.ANTHROPIC_API_KEY;
    const result = await f.generate(f.gm, { prompt });
    expect(result).toEqual({ mapId: f.mapId, saved: true, drawnBy: "keywords", claude: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    const map = await f.get();
    expect(map.setting).toEqual({ builtin: setting });
    expect(map.settingPicked).toBe(false);
    // Every ref belongs to the setting or common, and the setting's own sprites or textures are there.
    const used = folders(map);
    expect([...used].every((folder) => folder === setting || folder === "common")).toBe(true);
    expect(used.has(setting)).toBe(true);
    if (setting !== "forest") expect(map.objects.some((o) => o.kind === "tree" && o.sprite !== undefined && "builtin" in o.sprite && o.sprite.builtin.startsWith("forest/"))).toBe(false);
  });

  it("without a key, a picked setting steers the keyword layout and the mapping", async () => {
    const f = await withMap();
    delete process.env.ANTHROPIC_API_KEY;
    await f.generate(f.gm, { prompt: "A bandit camp in an autumn forest clearing", setting: { builtin: "tavern" } });
    const map = await f.get();
    expect(map).toMatchObject({ setting: { builtin: "tavern" }, settingPicked: true, name: "Tavern" });
    expect(folders(map).has("tavern")).toBe(true);
    expect(map.objects.some((o) => o.kind === "tree")).toBe(false);
  });

  it("offers the campaign's own-setting packs to Claude and lays out uploaded sprites that extend the setting (Q3)", async () => {
    const f = await withMap();
    const own = await f.pack("Clockwork");
    await f.pack("More trees", "forest");
    const stools = await f.pack("Tavern extras", "tavern");
    const stool = await f.sprite(stools, "Three legged stool");
    const rug = await f.sprite(stools, "Bear rug", "texture");
    const withUploads = {
      ...tavernReply,
      areas: [{ terrain: "stone", texture: "custom/bear-rug", shape: "rect", x: 2, y: 2, w: 4, h: 3 }],
      objects: [...tavernReply.objects, { sprite: "custom/three-legged-stool", x: 10, y: 10, rot: 0, scale: 1 }],
    };
    fetchMock.mockResolvedValueOnce(reply("tavern")).mockResolvedValueOnce(reply(JSON.stringify(withUploads)));
    await f.generate();
    const [classify, layout] = prompts(fetchMock);
    expect(classify).toContain("pack-1 = Clockwork");
    expect(classify).not.toContain("More trees");
    expect(layout).toContain("custom/three-legged-stool (Three legged stool; 1x1; cover)");
    expect(layout).toContain("custom/bear-rug (Bear rug; paints wood)");
    const map = await f.get();
    expect(map.objects.some((o) => o.sprite !== undefined && "uploaded" in o.sprite && o.sprite.uploaded === stool)).toBe(true);
    expect(map.areas[0]).toMatchObject({ terrain: "wood", texture: { uploaded: rug } });

    // Claude may also choose the pack itself.
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(reply("pack-1")).mockResolvedValueOnce(reply(JSON.stringify(tavernReply)));
    await f.generate();
    expect(await f.get()).toMatchObject({ setting: { pack: own }, settingPicked: false });
    expect(prompts(fetchMock)[1]).toContain('The SETTING is "Clockwork"');
  });

  it("refuses a setting that is not a built-in one or a pack of this campaign", async () => {
    const f = await withMap();
    expect(await code(f.generate(f.gm, { setting: { builtin: "moon" } }))).toBe("SPRITE_SETTING_UNKNOWN");
    expect(await code(f.generate(f.gm, { setting: { builtin: "common" } }))).toBe("SPRITE_SETTING_UNKNOWN");
    const { campaignId: theirs } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
    expect(await code(f.generate(f.gm, { setting: { pack: await f.pack("Foreign", undefined, theirs) } }))).toBe("SPRITE_PACK_NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts Let Claude choose's two calls as one generation (Q2)", async () => {
    const f = await withMap();
    fetchMock.mockImplementation((_url, init) => {
      const text = (JSON.parse(init!.body as string) as { messages: { content: string }[] }).messages[0]!.content;
      return Promise.resolve(reply(text.startsWith("Pick the setting") ? "tavern" : JSON.stringify(tavernReply)));
    });
    for (let i = 0; i < 10; i++) expect(await code(f.generate())).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(await code(f.generate())).toBe("RATE_LIMITED");
  });
});

describe("setting classification", () => {
  const options = settingOptions([]);

  it("lists the 19 built-in settings and own-setting packs only", async () => {
    expect(options).toHaveLength(19);
    expect(settingPrompt("A cave", options)).toContain("mushroom-cavern = Mushroom cavern (Underdark)");
  });

  it.each([
    ["tavern", "tavern"],
    [" Tavern.\n", "tavern"],
    ['"ship-deck"', "ship-deck"],
    ["The best fit is mushroom-cavern", "mushroom-cavern"],
    ["cave", "cave"],
    ["no idea", null],
  ])("reads %j as %s", (text, token) => {
    expect(parseSetting(text, options)?.token ?? null).toBe(token);
  });
});
