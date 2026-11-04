import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { UI_STATE_DEFAULTS, RANGE_RINGS_MAX } from "../../src/lib/config/preferences";
import { errorCode, setupWithCampaign } from "./helpers";

/** Config P2: the caller's UI state on the account, one row per key (Q15 b). */
describe("uiState (P2)", () => {
  it("returns the defaults for a user with no rows", async () => {
    const { gm } = await setupWithCampaign();
    expect(await gm.query(api.uiState.get, {})).toEqual(UI_STATE_DEFAULTS);
  });

  it("sets one key at a time; each key is one row; other users are untouched", async () => {
    const { t, gm, other } = await setupWithCampaign();
    await gm.mutation(api.uiState.set, { change: { key: "tokenNames", value: true } });
    await gm.mutation(api.uiState.set, { change: { key: "adversarySort", value: "book" } });
    await gm.mutation(api.uiState.set, { change: { key: "tokenNames", value: false } });
    await gm.mutation(api.uiState.set, { change: { key: "rangeRings", value: ["a", "b"] } });
    expect(await gm.query(api.uiState.get, {})).toEqual({
      ...UI_STATE_DEFAULTS,
      tokenNames: false,
      adversarySort: "book",
      rangeRings: ["a", "b"],
    });
    expect(await other.query(api.uiState.get, {})).toEqual(UI_STATE_DEFAULTS);
    const rows = await t.run((ctx) => ctx.db.query("userUiState").collect());
    expect(rows).toHaveLength(3);
  });

  it("replaces the range circles whole and refuses too many, repeated or bad ids with INVALID", async () => {
    const { gm } = await setupWithCampaign();
    await gm.mutation(api.uiState.set, { change: { key: "rangeRings", value: ["a", "b"] } });
    await gm.mutation(api.uiState.set, { change: { key: "rangeRings", value: ["c"] } });
    expect((await gm.query(api.uiState.get, {})).rangeRings).toEqual(["c"]);

    const max = Array.from({ length: RANGE_RINGS_MAX }, (_, i) => `t${i}`);
    await gm.mutation(api.uiState.set, { change: { key: "rangeRings", value: max } });
    expect((await gm.query(api.uiState.get, {})).rangeRings).toEqual(max);

    for (const value of [[...max, "one-more"], ["a", "a"], [""], ["x".repeat(65)]]) {
      await expect(gm.mutation(api.uiState.set, { change: { key: "rangeRings", value } })).rejects.toSatisfy(
        (e) => errorCode(e) === "INVALID",
      );
    }
  });

  it("refuses the signed-out caller", async () => {
    const { t } = await setupWithCampaign();
    await expect(t.query(api.uiState.get, {})).rejects.toSatisfy((e) => errorCode(e) === "UNAUTHENTICATED");
    await expect(t.mutation(api.uiState.set, { change: { key: "tokenNames", value: true } })).rejects.toSatisfy(
      (e) => errorCode(e) === "UNAUTHENTICATED",
    );
  });

  it("importLegacy sets only unset keys, cleans range circles and is idempotent", async () => {
    const { t, gm } = await setupWithCampaign();
    await gm.mutation(api.uiState.set, { change: { key: "tokenNames", value: false } });
    const legacy = {
      tokenNames: true,
      environmentSort: "book" as const,
      rollFeedCollapsed: true,
      rangeRings: ["", "x".repeat(65), ...Array.from({ length: 60 }, (_, i) => `t${i}`)],
    };
    await gm.mutation(api.uiState.importLegacy, { uiState: legacy });
    const state = await gm.query(api.uiState.get, {});
    expect(state.tokenNames).toBe(false);
    expect(state.environmentSort).toBe("book");
    expect(state.rollFeedCollapsed).toBe(true);
    expect(state.rangeRings).toEqual(Array.from({ length: 50 }, (_, i) => `t${i + 10}`));

    await gm.mutation(api.uiState.importLegacy, { uiState: { ...legacy, rollFeedCollapsed: false } });
    await gm.mutation(api.uiState.importLegacy, { uiState: {} });
    expect(await gm.query(api.uiState.get, {})).toEqual(state);
    expect(await t.run(async (ctx) => (await ctx.db.query("userUiState").collect()).length)).toBe(4);
  });
});
