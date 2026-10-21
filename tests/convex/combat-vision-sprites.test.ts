import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { visionTraitsOf } from "../../convex/lib/spriteSources";
import { catalogEntry, spriteTraits } from "../../src/lib/sprite-packs/index";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { adversaryArt } from "../../src/lib/srd/adversary-art";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { key, setupWithCampaign, useAllowlist } from "./helpers";

// Sprite packs P5 (plan .omc/plans/sprite-packs.yaml): the server's vision (playerView, previewAs, toggleLight's
// "has seen") resolves sprite traits (P1 catalog or uploaded row) and passes them with `rot` into prepareMap (P3),
// so what players see on Sprites maps follows the manifest (D3, D4, Q1); unknown or deleted sprites fall back to
// their Classic kind (D1, D9). Also: adversary tokens carry their rulebook art for players (R4: portraits only).

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

const NIGHT = { cycle: "NIGHT" as const, cycleDay: 3 };
const DAY = { cycle: "DAY" as const, cycleDay: 3 };

const WALL = "grassland-and-road/stone-wall-section"; // block, rect 2 x 1, Classic pillar
const POOL = "cave/underground-pool"; // none, Classic rock
const CANDLES = "dungeon/candle-cluster"; // faint glow, Classic crystal (not a Classic light)

type Light = "none" | "faintglow" | "torch" | "campfire";
type Sight = "block" | "cover" | "none";

/** A live medium Sprites map (30 x 20) with the player's "Ash" at (5, 10) looking east, by day. */
async function withScene() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const ashToken = (await gm.query(api.combatTokens.list, { campaignId, mapId })).find((tk) => tk.name === "Ash")!._id;
  await t.run((c) => c.db.patch("combatTokens", ashToken, { x: 5, y: 10, face: 0 }));
  const gmId = await t.run(async (c) => (await c.db.query("users").first())!._id);
  const setTime = (time: { cycle: "DAY" | "NIGHT"; cycleDay: number }) =>
    t.run(async (c) => {
      const row = await c.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      if (row === null) await c.db.insert("campaignTime", { campaignId, week: 1, ...time });
      else await c.db.patch("campaignTime", row._id, time);
    });
  await setTime(DAY);
  const enemy = async (name: string, x: number, y: number) => {
    const { tokenId } = await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name, hp: 3, side: "enemy", idempotencyKey: key() });
    await t.run((c) => c.db.patch("combatTokens", tokenId, { x, y }));
    return tokenId;
  };
  const object = (o: { kind: string; x: number; y: number; r?: number; rot?: number; sprite?: { builtin: string } | { uploaded: Id<"spritePackSprites"> } }) =>
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
  const packId = await t.run((c) => c.db.insert("spritePacks", { campaignId, name: "Mine", createdBy: gmId, createdAt: 1, updatedAt: 1 }));
  const uploaded = (row: { sight: Sight; light?: Light; footprint?: "circle" | "rect"; w?: number; h?: number }, order = 0) =>
    t.run(async (c) => {
      const storageId = await c.storage.store(new Blob([new Uint8Array(8)], { type: "image/webp" }));
      const fileId = await c.db.insert("files", { storageId, campaignId, uploadedBy: gmId, kind: "sprite", refId: "pending", createdAt: 1 });
      const id = await c.db.insert("spritePackSprites", {
        campaignId,
        packId,
        fileId,
        name: `Sprite ${order}`,
        slug: `sprite-${order}`,
        category: "object",
        w: row.w ?? 1,
        h: row.h ?? 1,
        sight: row.sight,
        light: row.light ?? "none",
        height: "low",
        footprint: row.footprint ?? "circle",
        classicKind: "crate",
        px: { w: 160, h: 160 },
        order,
        createdAt: 1,
      });
      await c.db.patch("files", fileId, { refId: id });
      return id;
    });
  const okView = async () => {
    const v = await player.query(api.combatVision.playerView, { campaignId });
    if (v.state !== "ok") throw new Error(`expected a view, got ${v.state}`);
    return v;
  };
  const names = async () => (await okView()).others.map((o) => o.name).sort();
  const removeObjects = () =>
    t.run(async (c) => {
      for (const row of await c.db.query("combatMapObjects").withIndex("by_map", (q) => q.eq("mapId", mapId)).collect()) await c.db.delete("combatMapObjects", row._id);
    });
  return { ...ctx, player, ash, mapId, packId, gmId, setTime, enemy, object, uploaded, okView, names, removeObjects };
}

describe("sprite traits: types", () => {
  it("passes P1's catalog traits into P3's VisionTraits unchanged (compile-time check, P5)", () => {
    const traits = spriteTraits({ builtin: WALL })!;
    expect(visionTraitsOf(traits)).toEqual({ sight: "block", light: "none", height: "tall", footprint: "rect", w: 2, h: 1 });
    expect(catalogEntry(POOL)).toMatchObject({ sight: "none", light: "none" });
    expect(catalogEntry(CANDLES)).toMatchObject({ light: "faintglow" });
  });
});

describe("sprite traits in the server's vision", () => {
  useAllowlist();

  it("hides a token behind a sprite wall section, along its length only (rect footprint turned by rot, D4)", async () => {
    const f = await withScene();
    await f.enemy("Goblin", 15, 10);
    expect(await f.names()).toEqual(["Goblin"]);
    // r 2 scales the 2 x 1 wall to 4 x 2 squares. Upright (rot 90 degrees) at (10, 12) it spans y 10..14 across the
    // Goblin's line of sight (y about 10.5) and hides it.
    await f.object({ kind: "pillar", x: 10, y: 12, r: 2, rot: Math.PI / 2, sprite: { builtin: WALL } });
    expect(await f.names()).toEqual([]);
    // Lying flat (rot 0) at the same spot it spans y 11..13 only: the line passes above it.
    await f.removeObjects();
    await f.object({ kind: "pillar", x: 10, y: 12, r: 2, rot: 0, sprite: { builtin: WALL } });
    expect(await f.names()).toEqual(["Goblin"]);
  });

  it("lets sight pass over a sprite pool even when its Classic kind blocks (D3)", async () => {
    const f = await withScene();
    await f.enemy("Goblin", 15, 10);
    await f.object({ kind: "pillar", x: 10, y: 10.5, r: 1.5, sprite: { builtin: POOL } });
    expect(await f.names()).toEqual(["Goblin"]);
    // The same object without a sprite is a Classic pillar and blocks.
    await f.removeObjects();
    await f.object({ kind: "pillar", x: 10, y: 10.5, r: 1.5 });
    expect(await f.names()).toEqual([]);
  });

  it("falls back to the Classic kind for a deleted uploaded sprite or an unknown built-in key (D1, D9)", async () => {
    const f = await withScene();
    await f.enemy("Goblin", 15, 10);
    const glass = await f.uploaded({ sight: "none" });
    await f.object({ kind: "pillar", x: 10, y: 10.5, r: 1.5, sprite: { uploaded: glass } });
    expect(await f.names()).toEqual(["Goblin"]);
    await f.t.run((c) => c.db.delete("spritePackSprites", glass));
    expect(await f.names()).toEqual([]);
    await f.removeObjects();
    await f.object({ kind: "pillar", x: 10, y: 10.5, r: 1.5, sprite: { builtin: "forest/no-such-sprite" } });
    expect(await f.names()).toEqual([]);
  });

  it("lights a token at night by a sprite's faint glow, built-in or uploaded (Q1), and the preview agrees (R12)", async () => {
    const f = await withScene();
    await f.enemy("Goblin", 12, 10);
    await f.setTime(NIGHT);
    expect(await f.names()).toEqual([]);
    // A built-in candle cluster (Classic crystal, no Classic light) lights its square at night.
    await f.object({ kind: "crystal", x: 12, y: 10.5, r: 0.5, sprite: { builtin: CANDLES } });
    expect(await f.names()).toEqual(["Goblin"]);
    expect(await f.gm.query(api.combatVision.previewAs, { campaignId: f.campaignId, characterId: f.ash })).toEqual(await f.okView());
    // Switched off, it lights nothing.
    await f.t.run(async (c) => {
      const row = (await c.db.query("combatMapObjects").withIndex("by_map", (q) => q.eq("mapId", f.mapId)).first())!;
      await c.db.patch("combatMapObjects", row._id, { lit: false });
    });
    expect(await f.names()).toEqual([]);
    // An uploaded glowing sprite on a dark Classic kind lights too; a Classic campfire with light "none" does not.
    await f.removeObjects();
    const glow = await f.uploaded({ sight: "none", light: "faintglow" });
    await f.object({ kind: "crate", x: 12, y: 10.5, r: 0.5, sprite: { uploaded: glow } });
    expect(await f.names()).toEqual(["Goblin"]);
    await f.removeObjects();
    const dark = await f.uploaded({ sight: "none", light: "none" }, 1);
    await f.object({ kind: "campfire", x: 12, y: 10.5, r: 0.5, sprite: { uploaded: dark } });
    expect(await f.names()).toEqual([]);
  });

  it("keeps spriteSources and playerView within the C1 budget on a 300-object Sprites map (TE6, E5)", { timeout: 120_000 }, async () => {
    const f = await withScene();
    const { t, campaignId, mapId } = f;
    const ids: Id<"spritePackSprites">[] = [];
    for (let i = 0; i < 64; i++) ids.push(await f.uploaded({ sight: i % 3 === 0 ? "block" : "cover", light: i % 7 === 0 ? "faintglow" : "none", footprint: i % 2 ? "rect" : "circle", w: 2, h: 1 }, i));
    const builtins = [WALL, POOL, CANDLES, "forest/oak-tree"];
    await t.run(async (c) => {
      for (let i = 0; i < 300; i++) {
        const sprite = i % 2 ? { uploaded: ids[i % ids.length]! } : { builtin: builtins[i % builtins.length]! };
        await c.db.insert("combatMapObjects", { mapId, kind: "rock", x: 1 + (i % 28) + 0.5, y: 1 + Math.floor(i / 28) * 1.7, r: 0.5, rot: (i % 8) * 0.4, sprite });
      }
    });
    for (let i = 0; i < 10; i++) await f.enemy(`Enemy ${i}`, 20 + i, 18);
    const playerId = await t.run(async (c) => (await c.db.query("users").withIndex("email", (q) => q.eq("email", "other@example.com")).first())!._id);
    const asPlayer = t.withIdentity({ subject: `${playerId}|s` });
    const asGm = t.withIdentity({ subject: `${f.gmId}|s` });
    const measure = (client: typeof asGm, run: (c: Parameters<Parameters<typeof asGm.run>[0]>[0]) => Promise<unknown>) =>
      client.run(async (c) => {
        const before = await c.meta.getTransactionMetrics();
        const start = performance.now();
        await run(c);
        const ms = performance.now() - start;
        const after = await c.meta.getTransactionMetrics();
        return { ms, documentsRead: after.documentsRead.used - before.documentsRead.used, bytesRead: after.bytesRead.used - before.bytesRead.used };
      });
    const results: Record<string, { ms: number; documentsRead: number; bytesRead: number }> = {};
    for (const time of [DAY, NIGHT]) {
      await f.setTime(time);
      results[`playerView ${time.cycle}`] = await measure(asPlayer, (c) => c.runQuery(api.combatVision.playerView, { campaignId }));
    }
    results["spriteSources gm"] = await measure(asGm, (c) => c.runQuery(api.combatMapStyle.spriteSources, { campaignId, mapId }));
    results["spriteSources player"] = await measure(asPlayer, (c) => c.runQuery(api.combatMapStyle.spriteSources, { campaignId, mapId }));
    for (const [label, r] of Object.entries(results)) {
      console.info(`${label}: ${r.ms.toFixed(1)} ms, ${r.documentsRead} documents, ${r.bytesRead} bytes`);
      // Convex gives a query 1 s; the C1 engine budget is 50 ms, the whole call with convex-test overhead stays far below 1 s.
      expect(r.ms).toBeLessThan(500);
      // 300 objects + 64 sprite rows + 64 file rows + tokens + map, campaign and membership rows.
      expect(r.documentsRead).toBeLessThan(600);
      expect(r.bytesRead).toBeLessThan(512 * 1024);
    }
  });
});

describe("adversary tokens show their rulebook art to players (R4: portrait only)", () => {
  useAllowlist();

  it("sends an SRD adversary's art, nothing without art or for custom tokens, never stats", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    const withArt = ADVERSARIES.find((a) => adversaryArt(a.id) !== undefined)!;
    const withoutArt = ADVERSARIES.find((a) => adversaryArt(a.id) === undefined)!;
    const { encounterId } = await f.gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
    const add = (adversaryId: string) =>
      f.gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "srd", adversaryId }, count: 1, summoned: false, idempotencyKey: key() });
    const instanceIds = [...(await add(withArt.id)).instanceIds, ...(await add(withoutArt.id)).instanceIds];
    await f.gm.mutation(api.encounters.start, { campaignId, encounterId });
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: key() });
    const tokens = await f.gm.query(api.combatTokens.list, { campaignId, mapId });
    const labelOf = async (id: Id<"encounterAdversaries">) => (await f.t.run((c) => c.db.get("encounterAdversaries", id)))!.label;
    const artLabel = await labelOf(instanceIds[0]!);
    const plainLabel = await labelOf(instanceIds[1]!);
    await f.t.run(async (c) => {
      await c.db.patch("combatTokens", tokens.find((tk) => tk.name === artLabel)!._id, { x: 9, y: 10 });
      await c.db.patch("combatTokens", tokens.find((tk) => tk.name === plainLabel)!._id, { x: 11, y: 10 });
    });
    await f.enemy("Bandit", 13, 10);

    const v = await f.okView();
    const row = (name: string) => v.others.find((o) => o.name === name)!;
    expect(row(artLabel).portrait).toEqual({ kind: "url", url: adversaryArt(withArt.id)!.src });
    expect(Object.keys(row(plainLabel))).not.toContain("portrait");
    expect(Object.keys(row("Bandit"))).not.toContain("portrait");
    expect(JSON.stringify(v.others)).not.toMatch(/hp|stress|difficulty|conditions|revealedTo/i);
    // The GM's preview is the player's result.
    expect(await f.gm.query(api.combatVision.previewAs, { campaignId, characterId: f.ash })).toEqual(v);
  });
});
