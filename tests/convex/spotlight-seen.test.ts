import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SEEN_MAX } from "../../convex/lib/spotlightSeen";
import { MAX_COMBAT_TOKENS } from "../../convex/lib/combatMaps";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key, setupWithCampaign } from "./helpers";

// User 2026-11-03 (docs/tasks/TASK-SPOTLIGHT-SEEN.md): a player learns which adversary holds the spotlight only when the
// party has seen it this scene. `playerView` lists the adversaries it shows that have no record yet
// (`unseenAdversaries`); `markSeen` records the ones the character sees now; `combatSpotlight.state` sends a player the
// spotlighted adversary's id and name only for a recorded one (the GM always); End scene forgets them.

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));
const W = 30; // a medium map is 30 x 20

/** A live medium map in daylight: the player's Ash at (5, 10) looking east, the GM's Bryn in a corner, two adversaries. */
async function scene() {
  const { t, gm, other: player, campaignId } = await setupWithCampaign();
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: characterDraft("Ash"), idempotencyKey: key() });
  const { characterId: bryn } = await gm.mutation(api.characters.create, { campaignId, draft: characterDraft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const tokens = await gm.query(api.combatTokensReads.list, { campaignId, mapId });
  const ashToken = tokens.find((tk) => tk.name === "Ash")!._id;
  const brynToken = tokens.find((tk) => tk.name === "Bryn")!._id;
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatTokens", ashToken, { x: 5, y: 10, face: 0 });
    await ctx.db.patch("combatTokens", brynToken, { x: 1, y: 1, face: Math.PI });
    const time = await ctx.db
      .query("campaignTime")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    if (time === null) await ctx.db.insert("campaignTime", { campaignId, week: 1, cycle: "DAY", cycleDay: 3 });
    else await ctx.db.patch("campaignTime", time._id, { cycle: "DAY", cycleDay: 3 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const adversary = async (label: string, x: number, srdId = "bear") => {
      const adversaryId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: srdId },
        label,
        order: x,
        summoned: false,
        stats: { difficulty: 10, major: 5, severe: 10, hpMax: 6, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId }, side: "enemy", x, y: 10, face: Math.PI });
    };
    return { lieutenant: await adversary("Jagged Knife Lieutenant", 10, "jagged-knife-lieutenant"), bandit:await adversary("Jagged Knife Bandit", 14) };
  });
  const fog = (x: number, mark: "hide" | "erase") => gm.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [10 * W + x], mark });
  const view = async () => {
    const v = await player.query(api.combatVision.playerView, { campaignId });
    if (v.state !== "ok") throw new Error(`expected a view, got ${v.state}`);
    return v;
  };
  const markSeen = (tokenIds: string[], characterId: string = ash) => player.mutation(api.combatVision.markSeen, { campaignId, characterId, tokenIds });
  const spotlight = (tokenId: Id<"combatTokens">) => gm.mutation(api.combatSpotlight.gmTake, { campaignId, tokenId, idempotencyKey: key() });
  const state = (who: "gm" | "player") => (who === "gm" ? gm : player).query(api.combatSpotlight.state, { campaignId });
  const rows = () => t.run((ctx) => ctx.db.query("combatSeen").collect());
  return { t, gm, player, campaignId, mapId, ash, bryn, ashToken, ...ids, fog, view, markSeen, spotlight, state, rows };
}

describe("spotlight-seen: which adversary holds the spotlight, for players", () => {
  it("never seen this scene: the player gets no id and no name; the GM gets both", async () => {
    const s = await scene();
    await s.fog(14, "hide"); // the Bandit stands in a GM-hidden square
    expect((await s.view()).others.map((o) => o._id)).toEqual([s.lieutenant]);
    await s.spotlight(s.bandit);
    expect(await s.state("gm")).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: s.bandit, adversaryName: "Jagged Knife Bandit" });
    expect(await s.state("player")).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: null, adversaryName: null });
    // The player's client cannot claim it: markSeen keeps only what the character sees now.
    expect(await s.markSeen([s.bandit])).toEqual({ added: 0 });
    expect(await s.state("player")).toMatchObject({ adversaryTokenId: null, adversaryName: null });
    expect(await s.rows()).toEqual([]);
  });

  it("the view lists unrecorded adversaries in sight; markSeen records them once; the player then learns the spotlight", async () => {
    const s = await scene();
    await s.fog(14, "hide");
    expect((await s.view()).unseenAdversaries).toEqual([s.lieutenant]);
    await s.spotlight(s.lieutenant);
    // Visible but not yet recorded (the client's write has not landed): nothing yet.
    expect((await s.state("player")).adversaryTokenId).toBeNull();
    expect(await s.markSeen([s.lieutenant, s.bandit, "not-a-token"])).toEqual({ added: 1 });
    expect(await s.markSeen([s.lieutenant])).toEqual({ added: 0 });
    expect((await s.view()).unseenAdversaries).toEqual([]);
    expect(await s.state("player")).toMatchObject({ adversaryTokenId: s.lieutenant, adversaryName: "Jagged Knife Lieutenant" });
    expect((await s.rows()).map((r) => r.tokenId)).toEqual([s.lieutenant]);
  });

  it("seen, then hidden: the player still gets the id and the name, but the view does not draw the token", async () => {
    const s = await scene();
    await s.markSeen([s.lieutenant]);
    await s.fog(10, "hide");
    const v = await s.view();
    expect(v.others.map((o) => o._id)).not.toContain(s.lieutenant);
    await s.spotlight(s.lieutenant);
    expect(await s.state("player")).toMatchObject({ adversaryTokenId: s.lieutenant, adversaryName: "Jagged Knife Lieutenant" });
  });

  it("End scene forgets: the player loses the name until the party sees the adversary again", async () => {
    const s = await scene();
    await s.markSeen([s.lieutenant, s.bandit]);
    expect(await s.rows()).toHaveLength(2);
    await s.spotlight(s.lieutenant);
    await s.gm.mutation(api.combatScenes.end, { campaignId: s.campaignId, idempotencyKey: key() });
    expect(await s.rows()).toEqual([]);
    expect(await s.state("player")).toMatchObject({ adversaryTokenId: null, adversaryName: null });
    expect((await s.state("gm")).adversaryTokenId).toBe(s.lieutenant);
    // Still in sight: the view lists both again, and the client's next write records them.
    expect([...(await s.view()).unseenAdversaries].sort()).toEqual([s.lieutenant, s.bandit].sort());
    await s.markSeen([s.lieutenant]);
    expect((await s.state("player")).adversaryName).toBe("Jagged Knife Lieutenant");
  });

  it("refuses another player's character (COMBAT_NOT_YOUR_TOKEN) and too many tokens (INVALID); one campaign's records stay its own", async () => {
    const s = await scene();
    expect(await code(s.markSeen([s.lieutenant], s.bryn))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(s.markSeen(Array.from({ length: MAX_COMBAT_TOKENS + 1 }, () => s.lieutenant)))).toBe("INVALID");
    expect(await s.markSeen([])).toEqual({ added: 0 });
    expect(await s.rows()).toEqual([]);
    expect(SEEN_MAX).toBeGreaterThanOrEqual(MAX_COMBAT_TOKENS);
  });

  it("seen is party knowledge (dcm-onze): player A sees, player B with no token learns the name and portrait; nobody saw, neither does", async () => {
    const s = await scene();
    const bId = await s.t.run((ctx) => ctx.db.insert("users", { email: "b@example.com", emailVerificationTime: 1 }));
    const b = s.t.withIdentity({ subject: `${bId}|session` });
    await b.mutation(api.members.joinByCode, { code: await s.gm.mutation(api.members.rotateJoinCode, { campaignId: s.campaignId }) });
    const stateB = () => b.query(api.combatSpotlight.state, { campaignId: s.campaignId });
    const none = { adversaryTokenId: null, adversaryName: null, adversaryPortrait: null };

    // Nobody saw it yet: neither player learns it (the card reads "The GM has the spotlight"); the GM does.
    await s.spotlight(s.lieutenant);
    const gmState = await s.state("gm");
    expect(gmState).toMatchObject({ adversaryTokenId: s.lieutenant, adversaryName: "Jagged Knife Lieutenant" });
    expect(await s.state("player")).toMatchObject(none);
    expect(await stateB()).toMatchObject(none);

    // Player A's character sees it: B, who has no token on the map, learns it from the party.
    expect(await s.markSeen([s.lieutenant])).toEqual({ added: 1 });
    expect(gmState.adversaryPortrait).toBe("/adversary-art/jagged-knife-lieutenant.webp");
    const named = { adversaryTokenId: s.lieutenant, adversaryName: "Jagged Knife Lieutenant", adversaryPortrait: gmState.adversaryPortrait };
    expect(await stateB()).toMatchObject(named);
    expect(await s.state("player")).toMatchObject(named);
    // The Bandit nobody saw stays unknown to both.
    await s.spotlight(s.bandit);
    expect(await stateB()).toMatchObject(none);
    expect(await s.state("player")).toMatchObject(none);

    // End scene clears it for the whole party.
    await s.spotlight(s.lieutenant);
    await s.gm.mutation(api.combatScenes.end, { campaignId: s.campaignId, idempotencyKey: key() });
    expect(await stateB()).toMatchObject(none);
  });

  it("a PC holding the spotlight sends no adversary to anyone", async () => {
    const s = await scene();
    await s.markSeen([s.lieutenant]);
    await s.spotlight(s.lieutenant);
    await s.gm.mutation(api.combatSpotlight.handTo, { campaignId: s.campaignId, characterId: s.ash, idempotencyKey: key() });
    expect(await s.state("player")).toMatchObject({ holder: { kind: "pc" }, adversaryTokenId: null, adversaryName: null });
    expect(await s.state("gm")).toMatchObject({ adversaryTokenId: null, adversaryName: null });
  });
});
