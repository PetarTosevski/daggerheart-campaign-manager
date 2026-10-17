import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const PLAYER = "player@example.com";

describe("Horizon Doom Track and Soul Echoes", () => {
  useAllowlist(`${GM},${PLAYER},stranger@example.com`);

  async function setup(frameId: "journey-to-horizon" | "witherwild" = "journey-to-horizon") {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM }));
    const playerId = await t.run((ctx) => ctx.db.insert("users", { email: PLAYER }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    const player = t.withIdentity({ subject: `${playerId}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Valloren", idempotencyKey: key() });
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    const setTier = (tier: number) => t.run((ctx) => ctx.db.patch(campaignId, { tier }));
    const setFear = (fear: number) =>
      t.run(async (ctx) => {
        const state = await ctx.db
          .query("campaignState")
          .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
          .unique();
        await ctx.db.patch(state!._id, { fear });
      });
    const fear = async () => (await gm.query(api.campaigns.get, { campaignId }))!.fear;
    const mark = (boxId: string, campaign: Id<"campaigns"> = campaignId) =>
      gm.mutation(api.trackers.horizon.markBox, { campaignId: campaign, boxId, idempotencyKey: key() });
    return { t, gm, player, campaignId, setTier, setFear, fear, mark };
  }

  async function gmView(gm: Awaited<ReturnType<typeof setup>>["gm"], campaignId: Id<"campaigns">) {
    const view = await gm.query(api.trackers.horizon.get, { campaignId });
    if (view.role !== "gm") throw new Error("expected the GM view");
    return view;
  }

  it("starts with no marks and one Echo", async () => {
    const { gm, campaignId } = await setup();
    expect(await gm.query(api.trackers.horizon.get, { campaignId })).toEqual({
      role: "gm",
      partyTier: 1,
      echoesCollected: 1,
      boxes: {},
    });
  });

  it("marks a nested box only after its parent; unmarks only leaves", async () => {
    const { gm, campaignId, mark } = await setup();
    expect(errorCode(await mark("1a1").catch((e) => e))).toBe("DOOM_RULE");
    await mark("1a");
    await gm.mutation(api.trackers.horizon.markBox, { campaignId, boxId: "1a1", session: 3, idempotencyKey: key() });
    const view = await gmView(gm, campaignId);
    expect(view.boxes["1a1"]).toMatchObject({ marked: true, occurred: false, session: 3 });
    const unmark = (boxId: string) => gm.mutation(api.trackers.horizon.unmarkBox, { campaignId, boxId, idempotencyKey: key() });
    expect(errorCode(await unmark("1a").catch((e) => e))).toBe("DOOM_RULE");
    await unmark("1a1");
    await unmark("1a");
    expect((await gmView(gm, campaignId)).boxes).toEqual({});
  });

  it("marks only in the campaign's tier or below", async () => {
    const { gm, campaignId, mark, setTier } = await setup();
    expect(errorCode(await mark("2a").catch((e) => e))).toBe("DOOM_RULE");
    await setTier(2);
    await mark("2a");
    await mark("1b");
    expect(Object.keys((await gmView(gm, campaignId)).boxes).sort()).toEqual(["1b", "2a"]);
  });

  it("a Tier 4 mark gains Fear equal to the marked Tier 4 boxes, capped at 12", async () => {
    const { mark, setTier, setFear, fear } = await setup();
    await setTier(4);
    expect(await mark("1a")).toEqual({ boxId: "1a", fear: null });
    expect(await mark("4a")).toEqual({ boxId: "4a", fear: { gained: 1, lost: 0, newValue: 1 } });
    expect(await mark("4b")).toEqual({ boxId: "4b", fear: { gained: 2, lost: 0, newValue: 3 } });
    await setFear(10);
    expect(await mark("4c")).toEqual({ boxId: "4c", fear: { gained: 2, lost: 1, newValue: 12 } });
    expect(await fear()).toBe(12);
  });

  it("players see only the Echo count and the text of occurred events", async () => {
    const { gm, player, campaignId, mark } = await setup();
    await mark("1a");
    await mark("1b");
    expect(await player.query(api.trackers.horizon.get, { campaignId })).toEqual({
      role: "player",
      echoesCollected: 1,
      occurred: [],
    });
    await gm.mutation(api.trackers.horizon.setOccurred, { campaignId, boxId: "1b", occurred: true, idempotencyKey: key() });
    expect(await player.query(api.trackers.horizon.get, { campaignId })).toEqual({
      role: "player",
      echoesCollected: 1,
      occurred: [{ id: "1b", tier: 1, text: "A new settlement is overtaken by surging wilderness." }],
    });
    const occurUnmarked = gm.mutation(api.trackers.horizon.setOccurred, {
      campaignId,
      boxId: "1c",
      occurred: true,
      idempotencyKey: key(),
    });
    expect(errorCode(await occurUnmarked.catch((e) => e))).toBe("DOOM_RULE");
  });

  it("only the GM changes the track or the Echoes", async () => {
    const { player, campaignId } = await setup();
    for (const call of [
      player.mutation(api.trackers.horizon.markBox, { campaignId, boxId: "1a", idempotencyKey: key() }),
      player.mutation(api.trackers.horizon.unmarkBox, { campaignId, boxId: "1a", idempotencyKey: key() }),
      player.mutation(api.trackers.horizon.setOccurred, { campaignId, boxId: "1a", occurred: true, idempotencyKey: key() }),
      player.mutation(api.trackers.horizon.setEchoes, { campaignId, value: 2, idempotencyKey: key() }),
    ]) {
      expect(errorData(await call.catch((e) => e))).toBe("FORBIDDEN");
    }
  });

  it("collects Soul Echoes 1–10, reporting level-ups and Horizon", async () => {
    const { gm, player, campaignId } = await setup();
    const set = (value: number) => gm.mutation(api.trackers.horizon.setEchoes, { campaignId, value, idempotencyKey: key() });
    expect(await set(2)).toEqual({ previousValue: 1, newValue: 2, levelUps: 1, horizonUnlocked: false });
    expect(await set(10)).toEqual({ previousValue: 2, newValue: 10, levelUps: 8, horizonUnlocked: true });
    expect(await set(9)).toEqual({ previousValue: 10, newValue: 9, levelUps: 0, horizonUnlocked: false });
    expect((await player.query(api.trackers.horizon.get, { campaignId })).echoesCollected).toBe(9);
    for (const value of [0, 11, 2.5]) expect(errorCode(await set(value).catch((e) => e))).toBe("ECHO_RANGE");
  });

  it("replays a retried mark without gaining Fear twice", async () => {
    const { gm, campaignId, setTier, fear } = await setup();
    await setTier(4);
    const k = key();
    const first = await gm.mutation(api.trackers.horizon.markBox, { campaignId, boxId: "4a", idempotencyKey: k });
    const again = await gm.mutation(api.trackers.horizon.markBox, { campaignId, boxId: "4a", idempotencyKey: k });
    expect(again).toEqual(first);
    expect(await fear()).toBe(1);
    const mismatch = gm.mutation(api.trackers.horizon.markBox, { campaignId, boxId: "4b", idempotencyKey: k });
    expect(errorData(await mismatch.catch((e) => e))).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("is disabled outside Journey to Horizon, on the server", async () => {
    const { gm, campaignId, mark } = await setup("witherwild");
    expect(errorData(await gm.query(api.trackers.horizon.get, { campaignId }).catch((e) => e))).toBe("MECHANIC_DISABLED");
    expect(errorData(await mark("1a").catch((e) => e))).toBe("MECHANIC_DISABLED");
  });

  it("hides the campaign from strangers", async () => {
    const { t, campaignId } = await setup();
    const strangerId = await t.run((ctx) => ctx.db.insert("users", { email: "stranger@example.com" }));
    const stranger = t.withIdentity({ subject: `${strangerId}|s` });
    expect(errorData(await stranger.query(api.trackers.horizon.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });
});
