import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, GM_EMAIL, key, OTHER_EMAIL, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

/** Every server die comes up `face`. */
function forceDice(face: number) {
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill(face - 1)) as typeof crypto.getRandomValues);
}

async function setup(frameId: "colossus-of-the-drylands" | "witherwild" = "colossus-of-the-drylands") {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL, emailVerificationTime: 1 }));
  const playerId = await t.run((ctx) => ctx.db.insert("users", { email: OTHER_EMAIL, emailVerificationTime: 1 }));
  const gm = t.withIdentity({ subject: `${gmId}|s` });
  const player = t.withIdentity({ subject: `${playerId}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Drylands", idempotencyKey: key() });
  await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
  return { t, gm, player, campaignId };
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
    expect(errorCode(error)).toBe("FORBIDDEN");
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
    expect(errorCode(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
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
    expect(errorCode(await gm.query(api.trackers.colossus.get, { campaignId }).catch((e) => e))).toBe("MECHANIC_DISABLED");
    const error = await gm.mutation(api.trackers.colossus.defeatColossus, { campaignId, idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(error)).toBe("MECHANIC_DISABLED");
  });
});

describe("Colossus tracker storage", () => {
  useAllowlist();

  const row = (t: Awaited<ReturnType<typeof setup>>["t"], campaignId: Id<"campaigns">) =>
    t.run((ctx) =>
      ctx.db
        .query("frameTrackers")
        .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", "colossus"))
        .unique(),
    );

  it("refuses corrupt saved data with TRACKER_CORRUPT and leaves it untouched", async () => {
    const { t, gm, campaignId } = await setup();
    await t.run((ctx) => ctx.db.insert("frameTrackers", { campaignId, key: "colossus", data: { phase: "lunch" }, updatedAt: 0 }));
    expect(errorCode(await gm.query(api.trackers.colossus.get, { campaignId }).catch((e) => e))).toBe("TRACKER_CORRUPT");
    const error = await gm.mutation(api.trackers.colossus.setPhase, { campaignId, phase: "hunt", idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(error)).toBe("TRACKER_CORRUPT");
    expect((await row(t, campaignId))?.data).toEqual({ phase: "lunch" });
  });

  it("refuses an unknown schemaVersion", async () => {
    const { t, gm, campaignId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("frameTrackers", {
        campaignId,
        key: "colossus",
        data: { phase: "hunt", siphonMarked: 1, kudamatPower: 0, colossiDefeated: 0, log: [], schemaVersion: 2 },
        updatedAt: 0,
      }),
    );
    expect(errorCode(await gm.query(api.trackers.colossus.get, { campaignId }).catch((e) => e))).toBe("TRACKER_CORRUPT");
  });

  it("writes schemaVersion and still reads data saved before versioning", async () => {
    const { t, gm, campaignId } = await setup();
    const legacy = { phase: "interlude", siphonMarked: 3, kudamatPower: 5, colossiDefeated: 1, log: [] };
    await t.run((ctx) => ctx.db.insert("frameTrackers", { campaignId, key: "colossus", data: legacy, updatedAt: 0 }));
    expect(await gm.query(api.trackers.colossus.get, { campaignId })).toMatchObject({ phase: "interlude", gm: { siphonMarked: 3 } });
    await gm.mutation(api.trackers.colossus.setPhase, { campaignId, phase: "hunt", idempotencyKey: key() });
    expect((await row(t, campaignId))?.data).toEqual({ ...legacy, phase: "hunt", schemaVersion: 1 });
  });

  it("the stampSchemaVersion migration versions old tracker blobs and skips character extras", async () => {
    vi.useFakeTimers();
    try {
      const { t, gm, campaignId } = await setup();
      const legacy = { phase: "hunt", siphonMarked: 1, kudamatPower: 0, colossiDefeated: 0, log: [] };
      await t.run(async (ctx) => {
        await ctx.db.insert("frameTrackers", { campaignId, key: "colossus", data: legacy, updatedAt: 0 });
        await ctx.db.insert("frameTrackers", { campaignId, key: "cookbook", data: { entries: [] }, updatedAt: 0 });
      });
      // Referenced by name: the generated api lists the module after the next codegen.
      await t.mutation(makeFunctionReference<"mutation">("migrations/trackers:stampSchemaVersion"), {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const rows = await t.run((ctx) => ctx.db.query("frameTrackers").collect());
      expect(rows.map((r) => [r.key, r.data])).toEqual([
        ["colossus", { ...legacy, schemaVersion: 1 }],
        ["cookbook", { entries: [] }],
      ]);
      expect((await gm.query(api.trackers.colossus.get, { campaignId })).phase).toBe("hunt");
    } finally {
      vi.useRealTimers();
    }
  });
});
