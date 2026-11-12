import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { key, setupWithCampaign, useAllowlist } from "./helpers";

/**
 * Plan rest-ticks RT1 (dcm-674k), rule 7 "migrate": migrations/countdownRestTicks:moveLongTermRest moves a long-term
 * countdown's legacy `armed` + `restMode` to `onLongRest` (old shape in, new shape out), leaves other types alone, is
 * idempotent, and a long rest ticks a long-term countdown identically before and after.
 */

const MIGRATION = "migrations/countdownRestTicks:moveLongTermRest";
const FIXED_1 = { kind: "fixed", n: 1 } as const;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Legacy = { mode?: "standard" | "longTerm"; armed?: boolean; restMode?: "auto" | "remind"; onLongRest?: { amount: typeof FIXED_1 | { kind: "pcs" }; mode: "auto" | "remind" } };

describe(MIGRATION, () => {
  useAllowlist();

  async function setup() {
    const ctx = await setupWithCampaign();
    const insert = (name: string, legacy: Legacy) =>
      ctx.t.run((c) =>
        c.db.insert("countdowns", {
          campaignId: ctx.campaignId,
          name,
          description: "",
          category: "threat",
          consequence: "",
          startingValue: 8,
          currentValue: 8,
          status: "active",
          createdAt: 0,
          ...legacy,
        }),
      );
    const row = (id: Id<"countdowns">) => ctx.t.run(async (c) => (await c.db.get("countdowns", id))!);
    const shape = async (id: Id<"countdowns">) => {
      const r = await row(id);
      return { armed: r.armed, restMode: r.restMode, onLongRest: r.onLongRest };
    };
    const migrate = async (reset = false) => {
      await ctx.t.mutation(internal.migrations.run.run, { fn: MIGRATION, batchSize: 2, reset });
      await ctx.t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    const longRest = async () => {
      const { restId } = await ctx.gm.mutation(api.rests.start, { campaignId: ctx.campaignId, kind: "long", idempotencyKey: key() });
      await ctx.gm.mutation(api.rests.finish, { campaignId: ctx.campaignId, restId, idempotencyKey: key() });
      return restId;
    };
    const undo = (restId: Id<"rests">) => ctx.gm.mutation(api.rests.undo, { campaignId: ctx.campaignId, restId, idempotencyKey: key() });
    return { ...ctx, insert, row, shape, migrate, longRest, undo };
  }

  it("old shape in, new shape out; other types and migrated rows untouched; idempotent", async () => {
    const ctx = await setup();
    const auto = await ctx.insert("Auto", { mode: "longTerm", armed: true, restMode: "auto" });
    const remind = await ctx.insert("Remind", { mode: "longTerm", armed: true, restMode: "remind" });
    const absent = await ctx.insert("Absent", { mode: "longTerm", armed: true });
    const unarmed = await ctx.insert("Unarmed", { mode: "longTerm", armed: false, restMode: "remind" });
    const done = await ctx.insert("Done", { mode: "longTerm", onLongRest: { amount: { kind: "pcs" }, mode: "remind" } });
    const both = await ctx.insert("Both", { mode: "longTerm", armed: true, restMode: "auto", onLongRest: { amount: { kind: "pcs" }, mode: "remind" } });
    const standard = await ctx.insert("Standard", { mode: "standard", armed: true });

    await ctx.migrate();

    expect(await ctx.shape(auto)).toEqual({ armed: undefined, restMode: undefined, onLongRest: { amount: FIXED_1, mode: "auto" } });
    expect(await ctx.shape(remind)).toEqual({ armed: undefined, restMode: undefined, onLongRest: { amount: FIXED_1, mode: "remind" } });
    expect(await ctx.shape(absent)).toEqual({ armed: undefined, restMode: undefined, onLongRest: { amount: FIXED_1, mode: "auto" } });
    expect(await ctx.shape(unarmed)).toEqual({ armed: undefined, restMode: undefined, onLongRest: undefined });
    expect(await ctx.shape(done)).toEqual({ armed: undefined, restMode: undefined, onLongRest: { amount: { kind: "pcs" }, mode: "remind" } });
    expect(await ctx.shape(both)).toEqual({ armed: undefined, restMode: undefined, onLongRest: { amount: { kind: "pcs" }, mode: "remind" } });
    expect(await ctx.shape(standard)).toEqual({ armed: true, restMode: undefined, onLongRest: undefined });

    const after = await Promise.all([auto, remind, absent, unarmed, done, both, standard].map((id) => ctx.row(id)));
    await ctx.migrate(true);
    expect(await Promise.all([auto, remind, absent, unarmed, done, both, standard].map((id) => ctx.row(id)))).toEqual(after);
  });

  it("a long rest ticks a long-term countdown identically before and after the migration, and the GM's view is unchanged", async () => {
    const ctx = await setup();
    const auto = await ctx.insert("Invasion", { mode: "longTerm", armed: true });
    const remind = await ctx.insert("Plague", { mode: "longTerm", armed: true, restMode: "remind" });
    const unarmed = await ctx.insert("Quiet", { mode: "longTerm", armed: false });
    const viewBefore = await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });

    const first = await ctx.longRest();
    const before = await Promise.all([auto, remind, unarmed].map(async (id) => (await ctx.row(id)).currentValue));
    const panelBefore = await ctx.gm.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId });
    expect(before).toEqual([7, 8, 8]);
    await ctx.undo(first);
    await ctx.gm.mutation(api.rests.finish, { campaignId: ctx.campaignId, restId: first, idempotencyKey: key() });
    await ctx.undo(first);
    expect(await Promise.all([auto, remind, unarmed].map(async (id) => (await ctx.row(id)).currentValue))).toEqual([8, 8, 8]);

    await ctx.migrate();
    expect(await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId })).toEqual(viewBefore);

    await ctx.gm.mutation(api.rests.finish, { campaignId: ctx.campaignId, restId: first, idempotencyKey: key() });
    expect(await Promise.all([auto, remind, unarmed].map(async (id) => (await ctx.row(id)).currentValue))).toEqual(before);
    const panelAfter = await ctx.gm.query(api.countdownTracks.afterRest, { campaignId: ctx.campaignId });
    expect(panelAfter).toEqual(panelBefore);
    expect(panelAfter?.reminders.map((r) => [r.name, r.amount])).toEqual([["Plague", 1]]);
  });
});
