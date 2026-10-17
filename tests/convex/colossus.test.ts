import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, errorData, GM_EMAIL, key, OTHER_EMAIL, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

/** Every server die comes up `face`. */
function forceDice(face: number) {
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill(face - 1)) as typeof crypto.getRandomValues);
}

async function setup(frameId: "colossus-of-the-drylands" | "witherwild" = "colossus-of-the-drylands") {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL }));
  const playerId = await t.run((ctx) => ctx.db.insert("users", { email: OTHER_EMAIL }));
  const gm = t.withIdentity({ subject: `${gmId}|s` });
  const player = t.withIdentity({ subject: `${playerId}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Drylands", idempotencyKey: key() });
  await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
  return { gm, player, campaignId };
}

describe("Colossus tracker", () => {
  useAllowlist();
  afterEach(() => vi.restoreAllMocks());

  it("starts at the book's values", async () => {
    const { gm, campaignId } = await setup();
    expect(await gm.query(api.trackers.colossus.get, { campaignId })).toEqual({
      phase: "hunt",
      colossiDefeated: 0,
      gm: { siphonMarked: 1, kudamatPower: 0, emerged: false, thresholds: { major: 0, severe: 0 }, log: [] },
    });
  });

  it("rests mark the track; a full track is rolled server-side into Kudamat's Power", async () => {
    const { gm, campaignId } = await setup();
    await gm.mutation(api.trackers.colossus.correct, { campaignId, siphonMarked: 8, idempotencyKey: key() });
    forceDice(7);
    const result = await gm.mutation(api.trackers.colossus.markRest, { campaignId, kind: "long", idempotencyKey: key() });
    expect(result.siphonMarked).toBe(1);
    expect(result.rolls).toEqual([expect.objectContaining({ reason: "full", dice: Array(10).fill(7), gained: 7, powerAfter: 7 })]);
    const view = await gm.query(api.trackers.colossus.get, { campaignId });
    expect(view.gm).toMatchObject({ siphonMarked: 1, kudamatPower: 7, thresholds: { major: 4, severe: 7 } });
    expect(view.gm?.log).toHaveLength(1);
  });

  it("defeating a colossus rolls, counts, resets and starts the interlude; rests then don't mark", async () => {
    const { gm, campaignId } = await setup();
    await gm.mutation(api.trackers.colossus.markRest, { campaignId, kind: "short", idempotencyKey: key() });
    forceDice(12);
    const result = await gm.mutation(api.trackers.colossus.defeatColossus, { campaignId, idempotencyKey: key() });
    expect(result).toMatchObject({ colossiDefeated: 1, roll: { dice: [12, 12], gained: 12 }, notice: expect.stringMatching(/levels up/) });
    expect(await gm.query(api.trackers.colossus.get, { campaignId })).toMatchObject({
      phase: "interlude",
      colossiDefeated: 1,
      gm: { siphonMarked: 1, kudamatPower: 12 },
    });
    const error = await gm
      .mutation(api.trackers.colossus.markRest, { campaignId, kind: "short", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(error)).toBe("TRACKER_RULE");
    await gm.mutation(api.trackers.colossus.setPhase, { campaignId, phase: "hunt", idempotencyKey: key() });
    expect((await gm.query(api.trackers.colossus.get, { campaignId })).phase).toBe("hunt");
  });

  it("shows Kudamat's emergence at Power 100", async () => {
    const { gm, campaignId } = await setup();
    await gm.mutation(api.trackers.colossus.correct, { campaignId, kudamatPower: 101, idempotencyKey: key() });
    expect((await gm.query(api.trackers.colossus.get, { campaignId })).gm).toMatchObject({
      emerged: true,
      thresholds: { major: 51, severe: 101 },
    });
  });

  it("players see only the phase and the slain count, and cannot change anything", async () => {
    const { gm, player, campaignId } = await setup();
    await gm.mutation(api.trackers.colossus.correct, { campaignId, kudamatPower: 40, colossiDefeated: 2, idempotencyKey: key() });
    expect(await player.query(api.trackers.colossus.get, { campaignId })).toEqual({ phase: "hunt", colossiDefeated: 2, gm: null });
    const error = await player
      .mutation(api.trackers.colossus.markRest, { campaignId, kind: "short", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorData(error)).toBe("FORBIDDEN");
  });

  it("replays an idempotent defeat without rolling or counting twice", async () => {
    const { gm, campaignId } = await setup();
    const idempotencyKey = key();
    forceDice(3);
    const first = await gm.mutation(api.trackers.colossus.defeatColossus, { campaignId, idempotencyKey });
    forceDice(9);
    expect(await gm.mutation(api.trackers.colossus.defeatColossus, { campaignId, idempotencyKey })).toEqual(first);
    expect(await gm.query(api.trackers.colossus.get, { campaignId })).toMatchObject({ colossiDefeated: 1, gm: { kudamatPower: 3 } });
    const mismatch = await gm
      .mutation(api.trackers.colossus.setPhase, { campaignId, phase: "hunt", idempotencyKey })
      .catch((e) => e);
    expect(errorData(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("validates corrections", async () => {
    const { gm, campaignId } = await setup();
    for (const bad of [{}, { siphonMarked: 11 }, { colossiDefeated: 10 }, { kudamatPower: -3 }]) {
      const error = await gm.mutation(api.trackers.colossus.correct, { campaignId, ...bad, idempotencyKey: key() }).catch((e) => e);
      expect(errorCode(error)).toBe("INVALID");
    }
  });

  it("is only for Colossus of the Drylands campaigns", async () => {
    const { gm, campaignId } = await setup("witherwild");
    expect(errorData(await gm.query(api.trackers.colossus.get, { campaignId }).catch((e) => e))).toBe("MECHANIC_DISABLED");
    const error = await gm.mutation(api.trackers.colossus.defeatColossus, { campaignId, idempotencyKey: key() }).catch((e) => e);
    expect(errorData(error)).toBe("MECHANIC_DISABLED");
  });
});
