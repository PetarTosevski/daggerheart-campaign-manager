import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FrameId } from "../../src/lib/frames";
import { setupWithCampaign, useAllowlist } from "./helpers";

/**
 * RD1 (rule-switches plan, bead dcm-bxp.134): `migrations/ruleDefaults:pinFrameOptions` pins today's value of the four
 * optional frame rules on existing campaigns (TE5: old shape in, new shape out, a second run changes nothing).
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type T = Setup["t"];

const fn = "migrations/ruleDefaults:pinFrameOptions";

async function run(t: T, dryRun = false) {
  await t.mutation(internal.migrations.run.run, { fn, ...(dryRun ? { dryRun: true } : {}) });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function campaign(
  { t, gm }: Setup,
  frameId: FrameId,
  name: string,
  options: Record<string, boolean> | undefined,
  deleted = false,
): Promise<Id<"campaigns">> {
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name, idempotencyKey: `k-${name}` });
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options, ...(deleted ? { deletedAt: 1 } : {}) }));
  return campaignId;
}

describe("migrations/ruleDefaults:pinFrameOptions", () => {
  useAllowlist();

  it("pins a missing frame option to today's default, keeps set keys and other options, and skips frames without one", async () => {
    const setup = await setupWithCampaign();
    const { t, campaignId: witherwild } = setup;
    await t.run((ctx) => ctx.db.patch("campaigns", witherwild, { options: { witherPersists: true } }));
    const castleNoKey = await campaign(setup, "castle-high", "Castle", undefined);
    const castleOff = await campaign(setup, "castle-high", "CastleOff", { lessLethal: false, hopeAndFear: true });
    const castleOn = await campaign(setup, "castle-high", "CastleOn", { lessLethal: true });
    const andaluria = await campaign(setup, "dark-heart-of-andaluria", "Andaluria", { hopeAndFear: false });
    const horizon = await campaign(setup, "journey-to-horizon", "Horizon", undefined, true);
    const motherboard = await campaign(setup, "motherboard", "Motherboard", {});
    // An option from another frame on the row (a stale key) is neither pinned nor removed.
    const strayKey = await campaign(setup, "witherwild", "Stray", { lessLethal: false });

    const ids = [witherwild, castleNoKey, castleOff, castleOn, andaluria, horizon, motherboard, strayKey];
    const read = () => t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get("campaigns", id))));
    const before = await read();

    await run(t, true);
    expect(await read()).toEqual(before);

    await run(t);
    const after = await read();
    expect(after.map((c) => c!.options)).toEqual([
      { witherPersists: true },
      { lessLethal: true },
      { lessLethal: false, hopeAndFear: true },
      { lessLethal: true },
      { hopeAndFear: false, transformations: true },
      { enduranceCountdowns: true },
      { remnantCorruption: true },
      { lessLethal: false },
    ]);
    // Rows with nothing to pin are not written.
    for (const i of [0, 2, 3, 7]) expect(after[i]).toEqual(before[i]);
    // The deleted campaign stays deleted.
    expect(after[5]!.deletedAt).toBe(1);

    await run(t, false);
    await t.mutation(internal.migrations.run.run, { fn, reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await read()).toEqual(after);
  });
});
