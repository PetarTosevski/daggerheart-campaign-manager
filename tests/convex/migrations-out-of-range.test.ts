import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { setupWithCampaign, useAllowlist } from "./helpers";

/**
 * W3S0 (rule switches wave 3, bead dcm-bxp.134, Q12 a): `migrations/outOfRange:copyTableSetting` copies each
 * campaign's `tableSettings.outOfRange` into `ruleModes.outOfRange` (TE5: old shape in, new shape out, a second run
 * changes nothing). The table setting stays where it is until tracer WF narrows it.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type T = Setup["t"];
type Patch = { tableSettings?: { outOfRange?: "ask" | "refuse"; playersSeeFear?: boolean }; ruleModes?: Record<string, unknown>; deletedAt?: number };

const fn = "migrations/outOfRange:copyTableSetting";

async function run(t: T, extra: { dryRun?: boolean; reset?: boolean } = {}) {
  await t.mutation(internal.migrations.run.run, { fn, ...extra });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function campaign({ t, gm }: Setup, name: string, patch: Patch): Promise<Id<"campaigns">> {
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name, idempotencyKey: `k-${name}` });
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, patch as never));
  return campaignId;
}

describe("migrations/outOfRange:copyTableSetting", () => {
  useAllowlist();

  it("mirrors the table setting into the M4 rule mode, keeps every other field and skips rows that already match", async () => {
    const setup = await setupWithCampaign();
    const { t } = setup;
    const unset = await campaign(setup, "Unset", {});
    const ask = await campaign(setup, "Ask", { tableSettings: { outOfRange: "ask", playersSeeFear: false } });
    const refuse = await campaign(setup, "Refuse", { tableSettings: { outOfRange: "refuse" }, ruleModes: { hopeFearFromRolls: "manual" } });
    const refuseDeleted = await campaign(setup, "RefuseDeleted", { tableSettings: { outOfRange: "refuse" }, deletedAt: 1 });
    const alreadyRefuse = await campaign(setup, "Already", { tableSettings: { outOfRange: "refuse" }, ruleModes: { outOfRange: "refuse" } });
    // A stale rule mode (the table setting went back to Ask): the table setting wins until WF moves the readers.
    const stale = await campaign(setup, "Stale", { tableSettings: { outOfRange: "ask" }, ruleModes: { outOfRange: "refuse", darkness: "both" } });

    const ids = [unset, ask, refuse, refuseDeleted, alreadyRefuse, stale];
    const read = () => t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get("campaigns", id))));
    const before = await read();

    await run(t, { dryRun: true });
    expect(await read()).toEqual(before);

    await run(t);
    const after = await read();
    expect(after.map((c) => c!.ruleModes)).toEqual([
      undefined,
      undefined,
      { hopeFearFromRolls: "manual", outOfRange: "refuse" },
      { outOfRange: "refuse" },
      { outOfRange: "refuse" },
      { outOfRange: "book", darkness: "both" },
    ]);
    // The old setting is not removed (narrow waits for WF).
    expect(after.map((c) => c!.tableSettings?.outOfRange)).toEqual([undefined, "ask", "refuse", "refuse", "refuse", "ask"]);
    expect(after[1]!.tableSettings).toEqual({ outOfRange: "ask", playersSeeFear: false });
    // Rows that already match are not written; the deleted campaign stays deleted.
    for (const i of [0, 1, 4]) expect(after[i]).toEqual(before[i]);
    expect(after[3]!.deletedAt).toBe(1);

    await run(t);
    await run(t, { reset: true });
    expect(await read()).toEqual(after);
  });
});
