import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { scenePrompt, toLayout } from "../../convex/combatMapGenerate";
import { DEFAULT_MODEL } from "../../convex/photoImport";
import { mapSpecSchema } from "../../src/lib/domain/combat-map/spec";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D9 C4: Claude lays out a map from the GM's description. `generate` (userAction, GM via an internal access check,
// rate limit combatMapGenerate) and `stop` (gmMutation). fetch is stubbed: no test reaches the Messages API.
// TE2's authz matrix does not exist yet; D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

/** A layout as Claude would reply: a grass clearing with a pond, a road and a few objects. */
const claudeLayout = {
  title: "Bandit camp",
  w: 30,
  h: 20,
  base: "grass",
  plankV: false,
  areas: [
    { terrain: "water", shape: "ellipse", x: 24, y: 6, rx: 3, ry: 2 },
    { terrain: "path", shape: "path", points: [[-1, 10], [31, 12]], width: 2 },
  ],
  objects: [
    { kind: "tent", x: 10, y: 8, r: 2, rot: 0.4 },
    { kind: "campfire", x: 14, y: 10, r: 1 },
    { kind: "tree", x: 2, y: 2, r: 1.8, variant: "autumn" },
    { kind: "crate", x: 12, y: 13, r: 0.8, sight: "block" },
    { kind: "dragon", x: 5, y: 5, r: 1 },
  ],
};

/** A Messages API reply whose text is `text`. */
function reply(text: string, stopReason = "end_turn"): Response {
  return new Response(JSON.stringify({ stop_reason: stopReason, content: [{ type: "text", text }] }), { status: 200 });
}

async function withMap() {
  const ctx = await setupWithCampaign();
  const { campaignId, gm } = ctx;
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const get = async (id: Id<"combatMaps"> = mapId) => (await gm.query(api.combatMaps.get, { campaignId, mapId: id }))!;
  const generate = (c: Client = gm, args: { prompt?: string; size?: "small" | "medium" | "large"; another?: boolean; mapId?: string } = {}) =>
    c.action(api.combatMapGenerate.generate, {
      campaignId,
      mapId: args.mapId ?? mapId,
      prompt: args.prompt ?? "A bandit camp in an autumn forest clearing",
      size: args.size ?? "medium",
      ...(args.another === undefined ? {} : { another: args.another }),
    });
  const player = async () => {
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    return ctx.other;
  };
  return { ...ctx, mapId, get, generate, player };
}

describe("combat map generation", () => {
  useAllowlist();
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.ANTHROPIC_MODEL;
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(reply(JSON.stringify(claudeLayout))));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    vi.unstubAllGlobals();
  });

  it("lets only the GM generate and stop (anonymous, outsider, player refused)", async () => {
    const f = await withMap();
    const stop = (c: Client) => c.mutation(api.combatMapGenerate.stop, { campaignId: f.campaignId, mapId: f.mapId });
    const anon = f.t as unknown as Client;
    expect(await code(f.generate(anon))).toBe("UNAUTHENTICATED");
    expect(await code(stop(anon))).toBe("UNAUTHENTICATED");
    expect(await code(f.generate(f.other))).toBe("NOT_FOUND");
    expect(await code(stop(f.other))).toBe("NOT_FOUND");
    const player = await f.player();
    expect(await code(f.generate(player))).toBe("FORBIDDEN");
    expect(await code(stop(player))).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await code(f.generate())).toBe("ok");
    expect(await code(stop(f.gm))).toBe("ok");
  });

  it("asks Claude with the board's scene prompt and saves its cleaned layout", async () => {
    const f = await withMap();
    const result = await f.generate();
    expect(result).toEqual({ mapId: f.mapId, saved: true, drawnBy: "claude", claude: "ok" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const body = JSON.parse(init!.body as string) as { model: string; messages: { content: string }[] };
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.messages[0]!.content).toBe(scenePrompt("A bandit camp in an autumn forest clearing", 30, 20));
    expect(body.messages[0]!.content).not.toContain("Variation #");

    const map = await f.get();
    expect(map).toMatchObject({ source: "generated", w: 30, h: 20, base: "grass", name: "Bandit camp", prompt: "A bandit camp in an autumn forest clearing" });
    expect(map.areas.map((a) => a.terrain)).toEqual(["water", "path"]);
    // The unknown kind ("dragon") is dropped; the sight override and the variant are kept.
    expect(map.objects.map((o) => o.kind).sort()).toEqual(["campfire", "crate", "tent", "tree"]);
    expect(map.objects.find((o) => o.kind === "crate")?.sight).toBe("block");
    expect(map.objects.find((o) => o.kind === "tree")?.variant).toBe("autumn");
    expect(map.seed).toBeGreaterThanOrEqual(1);
  });

  it("uses ANTHROPIC_MODEL when set and adds the variation line for Another version", async () => {
    const f = await withMap();
    process.env.ANTHROPIC_MODEL = "claude-test-model";
    await f.generate(f.gm, { another: true });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string; messages: { content: string }[] };
    expect(body.model).toBe("claude-test-model");
    expect(body.messages[0]!.content).toMatch(/\n\(Variation #\d+: make a different layout from before\.\)$/);
  });

  it("draws from keywords without ANTHROPIC_API_KEY and never calls the API", async () => {
    const f = await withMap();
    delete process.env.ANTHROPIC_API_KEY;
    const result = await f.generate(f.gm, { prompt: "A frozen lake with pine trees", size: "large" });
    expect(result).toEqual({ mapId: f.mapId, saved: true, drawnBy: "keywords", claude: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    const map = await f.get();
    expect(map).toMatchObject({ source: "generated", w: 40, h: 27, prompt: "A frozen lake with pine trees" });
    expect(map.areas.length + map.objects.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["an HTTP error", () => new Response("overloaded", { status: 529 }), "HTTP 529"],
    ["a reply that is not JSON", () => reply("Here is your map, a lovely forest!"), "no JSON"],
    ["a cut-off reply", () => reply("{", "max_tokens"), "too long"],
    ["a layout with almost nothing in it", () => reply(JSON.stringify({ base: "grass", areas: [], objects: [{ kind: "tree", x: 1, y: 1, r: 1 }] })), "unusable layout"],
  ])("falls back to keywords after %s and says why", async (_label, response, reason) => {
    const f = await withMap();
    fetchMock.mockImplementation(() => Promise.resolve(response()));
    const result = await f.generate(f.gm, { prompt: "A forest road" });
    expect(result).toEqual({ mapId: f.mapId, saved: true, drawnBy: "keywords", claude: "failed", reason });
    const map = await f.get();
    expect(map.source).toBe("generated");
    expect(map.objects.length).toBeGreaterThan(0);
  });

  it("falls back to keywords when the request itself fails", async () => {
    const f = await withMap();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
    const result = await f.generate();
    expect(result).toMatchObject({ saved: true, drawnBy: "keywords", claude: "failed", reason: "network" });
  });

  it("regenerating keeps tokens (moved inside the new size) and clears explored areas, painted cells and fog marks", async () => {
    const f = await withMap();
    await f.generate();
    const before = await f.get();
    const characterId = await f.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "pc@example.com" });
      return ctx.db.insert("characters", {
        campaignId: f.campaignId,
        ownerId: userId,
        createdBy: userId,
        status: "active",
        sheet: {} as never,
        createdAt: 0,
        updatedAt: 0,
      });
    });
    const tokenId = await f.t.run(async (ctx) => {
      await ctx.db.insert("combatExplored", { mapId: f.mapId, characterId, bits: "abc", updatedAt: 0 });
      for (const layer of ["terrain", "block", "fog"] as const) {
        await ctx.db.insert("combatMapCells", { mapId: f.mapId, layer, tile: 0, cells: ".".repeat(8 * 30) });
      }
      return ctx.db.insert("combatTokens", {
        campaignId: f.campaignId,
        mapId: f.mapId,
        ref: { kind: "custom", name: "Ogre", hp: 5, hpMax: 5, stress: 0, stressMax: 2, conditions: [] },
        side: "enemy",
        x: 28,
        y: 18,
        size: 2,
        face: 0,
        light: "none",
        revealedTo: [],
      });
    });

    delete process.env.ANTHROPIC_API_KEY;
    await f.generate(f.gm, { prompt: "A small ruined shrine", size: "small" });
    const after = await f.get();
    expect(after).toMatchObject({ w: 22, h: 15, name: "Bandit camp", prompt: "A small ruined shrine" });
    expect(after.objects.map((o) => o._id)).not.toEqual(expect.arrayContaining(before.objects.map((o) => o._id)));
    expect(after.cells).toEqual([]);
    const rows = await f.t.run(async (ctx) => ({
      token: await ctx.db.get("combatTokens", tokenId),
      explored: await ctx.db.query("combatExplored").withIndex("by_map_character", (q) => q.eq("mapId", f.mapId)).collect(),
    }));
    expect(rows.token).toMatchObject({ x: 20, y: 13, size: 2 });
    expect(rows.explored).toEqual([]);
  });

  it("replaces an uploaded image and deletes its file", async () => {
    const f = await withMap();
    const storageId = await f.t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([new Uint8Array(64)], { type: "image/png" }));
      await (ctx.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType: "image/png" });
      return id;
    });
    const attached = await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, storageId, width: 1200, height: 800 });
    expect(attached.ok).toBe(true);
    await f.generate();
    const map = await f.get();
    expect(map.source).toBe("generated");
    expect(map.image).toBeNull();
    const left = await f.t.run(async (ctx) => ({
      blob: await ctx.db.system.get("_storage", storageId),
      files: await ctx.db.query("files").withIndex("by_storage", (q) => q.eq("storageId", storageId)).collect(),
    }));
    expect(left).toEqual({ blob: null, files: [] });
  });

  it("drops a result that arrives after Stop and leaves the map as it was", async () => {
    const f = await withMap();
    let answer: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    const running = f.generate();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await f.gm.mutation(api.combatMapGenerate.stop, { campaignId: f.campaignId, mapId: f.mapId });
    answer(reply(JSON.stringify(claudeLayout)));
    expect(await running).toEqual({ mapId: f.mapId, saved: false, drawnBy: "claude", claude: "ok" });
    const map = await f.get();
    expect(map).toMatchObject({ source: "blank", name: "Map 1", areas: [], objects: [] });
    expect(map.prompt).toBeUndefined();
  });

  it("refuses an empty or too long description, and a map of another campaign", async () => {
    const f = await withMap();
    expect(await code(f.generate(f.gm, { prompt: "   " }))).toBe("INVALID");
    expect(await code(f.generate(f.gm, { prompt: "x".repeat(1001) }))).toBe("INVALID");
    expect(await code(f.generate(f.gm, { mapId: "not-a-map" }))).toBe("COMBAT_MAP_NOT_FOUND");
    const { campaignId: otherCampaign } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const { mapId: foreign } = await f.gm.mutation(api.combatMaps.create, { campaignId: otherCampaign, size: "small", idempotencyKey: key() });
    expect(await code(f.generate(f.gm, { mapId: foreign }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatMapGenerate.stop, { campaignId: f.campaignId, mapId: foreign }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows 10 generations per user per hour (Q5)", async () => {
    const f = await withMap();
    delete process.env.ANTHROPIC_API_KEY;
    for (let i = 0; i < 10; i++) expect(await code(f.generate())).toBe("ok");
    expect(await code(f.generate())).toBe("RATE_LIMITED");
  });
});

describe("toLayout", () => {
  it("forces the chosen size, keeps valid parts and passes the spec schema", () => {
    const layout = toLayout({ ...claudeLayout, w: 99, h: 3 }, 22, 15, 5)!;
    expect(layout).toMatchObject({ w: 22, h: 15, title: "Bandit camp" });
    expect(mapSpecSchema.safeParse({ ...layout, seed: 5, objects: layout.objects.map((o) => ({ points: [], ...o })) }).success).toBe(true);
    expect(layout.objects.every((o) => o.points === undefined || o.points.length > 0)).toBe(true);
  });

  it("refuses non-objects and near-empty layouts", () => {
    expect(toLayout(null, 30, 20, 1)).toBeNull();
    expect(toLayout([claudeLayout], 30, 20, 1)).toBeNull();
    expect(toLayout({ areas: [], objects: [] }, 30, 20, 1)).toBeNull();
  });
});
