/**
 * dcm-uemx: a card use against "all targets within" a range (Rain of Blades, CB p.336) reports every target it rolled
 * against, misses included, and a large token counts from its nearest edge (CB p.103 Defined Ranges).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

type Stats = { difficulty: number; major: number | null; severe: number | null; hpMax: number; stressMax: number };

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, encounterId };
  });
  let order = 0;
  const enemy = (label: string, at: { x: number; y: number; size?: number }, stats: Stats) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats,
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: at.size ?? 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: at.x, y: at.y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const holding = (cards: string[]) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, domainCards: { owned: cards, loadout: cards.slice(0, 5) }, hope: 4 });
    });
  const use = async (cardId: string, targetTokenIds: Id<"combatTokens">[] = []) => {
    await gm.mutation(api.combatSpotlight.handToParty, { campaignId, idempotencyKey: key() });
    return player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId, targetTokenIds, choices: [], idempotencyKey: key() });
  };
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, holding, use };
}

const HIT: Stats = { difficulty: 1, major: 3, severe: 100, hpMax: 9, stressMax: 3 };
const MISS: Stats = { difficulty: 99, major: 3, severe: 100, hpMax: 9, stressMax: 3 };

describe("dcm-uemx: an 'all within range' card reports every target", () => {
  allowWorldEmails();

  it("Rain of Blades: the missed large token at the range's edge has a Miss row", async () => {
    const a = await arena();
    const ogre = await a.enemy("Cave Ogre", { x: 6, y: 10 }, HIT);
    // A 3×3 dragon whose nearest edge is 3 squares away (Very Close), its centre further.
    const dragon = await a.enemy("Volcanic Dragon", { x: 8, y: 8, size: 3 }, MISS);
    // Out of Very Close: 4 squares from the edge.
    const far = await a.enemy("Far Bandit", { x: 9, y: 12 }, HIT);
    await a.holding(["rain-of-blades"]);
    const r = await a.use("rain-of-blades");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(r.targets).toContainEqual({ tokenId: ogre.tokenId, hit: true, defeated: false });
    expect(r.targets).toContainEqual({ tokenId: dragon.tokenId, hit: false, defeated: false });
    expect(r.targets.map((t) => t.tokenId)).not.toContain(far.tokenId);
  });
});

/** Every key anywhere in a value (to prove a player's answer carries no severity). */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}

describe("dcm-uemx: combatHud.resultDamage, the GM's severity and HP per adversary hit", () => {
  allowWorldEmails();

  it("a card use: the GM reads Major · 2 HP for the hit, nothing for the miss; the player's answer and the query stay closed to players", async () => {
    const a = await arena();
    const ogre = await a.enemy("Cave Ogre", { x: 6, y: 10 }, HIT);
    const dragon = await a.enemy("Volcanic Dragon", { x: 8, y: 8, size: 3 }, MISS);
    await a.holding(["rain-of-blades"]);
    const r = await a.use("rain-of-blades");
    if (r.status !== "resolved") throw new Error(r.status);
    expect(keysOf(r).filter((k) => ["targetDamage", "severity", "hpMarked"].includes(k))).toEqual([]);
    // d8+2 with Proficiency 1 is 3..10: at least the Major threshold 3, under Severe 100.
    expect(await a.gm.query(api.combatHud.resultDamage, { campaignId: a.campaignId, entryId: r.entryId })).toEqual([{ tokenId: ogre.tokenId, severity: "major", hpMarked: 2 }]);
    expect((await a.t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", ogre.instanceId))!)).hp).toBe(2);
    void dragon;
    expect(errorCode(await a.player.query(api.combatHud.resultDamage, { campaignId: a.campaignId, entryId: r.entryId }).then(() => null, (e: unknown) => e))).toBe("FORBIDDEN");
    // Only the GM row carries it.
    const rows = await a.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows.filter((row) => row.targetDamage !== undefined).map((row) => row.visibility)).toEqual(["gm"]);
  });

  it("a weapon attack: the GM reads the severity and HP; an undone attack reads []", async () => {
    const a = await arena();
    const ogre = await a.enemy("Cave Ogre", { x: 6, y: 10 }, { difficulty: 1, major: 1, severe: 1000, hpMax: 9, stressMax: 3 });
    await a.gm.mutation(api.combatSpotlight.handToParty, { campaignId: a.campaignId, idempotencyKey: key() });
    const r = await a.player.mutation(api.combatActions.attack, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, targetTokenIds: [ogre.tokenId], slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(r.status);
    expect(keysOf(r).filter((k) => ["targetDamage", "severity", "hpMarked"].includes(k))).toEqual([]);
    expect(await a.gm.query(api.combatHud.resultDamage, { campaignId: a.campaignId, entryId: r.entryId })).toEqual([{ tokenId: ogre.tokenId, severity: "major", hpMarked: 2 }]);
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect(await a.gm.query(api.combatHud.resultDamage, { campaignId: a.campaignId, entryId: r.entryId })).toEqual([]);
  });
});
