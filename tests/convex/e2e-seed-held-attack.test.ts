import { afterEach, describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

/**
 * dcm-bxp.99.32.25: `combatRequests.seedHeldAttackForE2e` (the HUD H4.1 browser specs' seeding) opens an `afterRoll`
 * request with fixed Hope and Fear dice; Pass resolves it with those same dice. Refused outside the local e2e backend.
 */

const LOCAL = "http://127.0.0.1:3212";
const before = process.env.CONVEX_CLOUD_URL;
afterEach(() => {
  if (before === undefined) delete process.env.CONVEX_CLOUD_URL;
  else process.env.CONVEX_CLOUD_URL = before;
});

async function scene() {
  const w = await buildWorld();
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ogreToken = await w.t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10 });
    const encounterId = await ctx.db.insert("encounters", { campaignId: w.campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const ogre = await ctx.db.insert("encounterAdversaries", {
      campaignId: w.campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Ogre",
      order: 0,
      summoned: false,
      stats: { difficulty: 30, major: 100, severe: 200, hpMax: 5, stressMax: 1 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    return ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: Math.PI, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: ogre }, side: "enemy", x: 6, y: 10 });
  });
  return { w, ogreToken };
}

describe("combatRequests.seedHeldAttackForE2e", () => {
  allowWorldEmails();

  it("opens a held attack with the given dice and options; Pass resolves it with the same dice", async () => {
    process.env.CONVEX_CLOUD_URL = LOCAL;
    const { w, ogreToken } = await scene();
    const options = [{ featureId: "class:warlock:patrons-boon", useId: "main" }];
    const requestId = await w.t.mutation(internal.combatRequests.seedHeldAttackForE2e, { characterId: w.characterA, targetTokenId: ogreToken, hope: 3, fear: 7, options });
    const row = await w.t.run((ctx) => ctx.db.get("combatRequests", requestId));
    expect(row).toMatchObject({ kind: "afterRoll", status: "open", createdBy: w.users.player, payload: { kind: "afterRoll", dice: [3, 7], dualityAt: 0, options, hits: [{ tokenId: ogreToken, hit: false }] } });
    expect(row!.payload.kind === "afterRoll" && row!.payload.roll.outcome).toBe("failFear");

    const out = await w.as("player").mutation(api.combatActions.afterRoll, { campaignId: w.campaignId, requestId, choice: { kind: "pass" }, idempotencyKey: key() });
    if (out.status !== "resolved") throw new Error(out.status);
    expect(out.roll?.dice.filter((d) => d.role === "hope" || d.role === "fear").map((d) => d.value)).toEqual([3, 7]);
    expect((await w.t.run((ctx) => ctx.db.get("combatRequests", requestId)))!.status).toBe("resolved");
  });

  it("is refused outside the local e2e backend", async () => {
    process.env.CONVEX_CLOUD_URL = "https://example.convex.cloud";
    const { w, ogreToken } = await scene();
    await expect(w.t.mutation(internal.combatRequests.seedHeldAttackForE2e, { characterId: w.characterA, targetTokenId: ogreToken, hope: 3, fear: 7, options: [{ featureId: "x", useId: "main" }] })).rejects.toThrow(/local e2e backend/);
  });
});
