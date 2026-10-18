import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { COUNTDOWN_VISIBILITY_PRESETS, type CountdownVisibility } from "../../src/lib/domain/countdowns/index";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

const DETAILS = {
  name: "  The bridge collapses ",
  description: "",
  category: "threat" as const,
  startingValue: 3,
  consequence: "The road east is cut off.",
};

async function withCountdown(startingValue = 3) {
  const ctx = await setupWithCampaign();
  const { countdownId } = await ctx.gm.mutation(api.countdowns.create, {
    campaignId: ctx.campaignId,
    ...DETAILS,
    startingValue,
    idempotencyKey: key(),
  });
  const op = (action: "advance" | "reverse" | "pause" | "resume" | "cancel" | "correction", amount?: number) =>
    ctx.gm.mutation(api.countdowns.operate, { countdownId, action, amount, idempotencyKey: key() });
  const current = async () =>
    (await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId })).find(
      (c) => c._id === countdownId,
    );
  return { ...ctx, countdownId: countdownId as Id<"countdowns">, op, current };
}

describe("countdowns", () => {
  useAllowlist();

  it("creates an active countdown at its starting value with trimmed text", async () => {
    const { current } = await withCountdown();
    expect(await current()).toMatchObject({
      name: "The bridge collapses",
      currentValue: 3,
      startingValue: 3,
      status: "active",
      category: "threat",
      completedAt: null,
    });
  });

  it("validates the details", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    for (const bad of [{ name: " " }, { startingValue: 0 }, { startingValue: 21 }, { startingValue: 2.5 }]) {
      const error = await gm
        .mutation(api.countdowns.create, { campaignId, ...DETAILS, ...bad, idempotencyKey: key() })
        .catch((e) => e);
      expect(errorCode(error)).toBe("INVALID");
    }
  });

  it("ticks down to completion once, records the time, and reopens by reversing", async () => {
    const { op, current } = await withCountdown(2);
    await op("advance");
    expect(await op("advance")).toEqual({ previousValue: 1, newValue: 0, status: "completed" });
    const done = await current();
    expect(done?.completedAt).toEqual(expect.any(Number));
    expect(errorCode(await op("advance").catch((e) => e))).toBe("COUNTDOWN_RULE");
    await op("reverse");
    expect(await current()).toMatchObject({ currentValue: 1, status: "active", completedAt: null });
  });

  it("blocks ticking while paused but allows a correction", async () => {
    const { op, current } = await withCountdown(5);
    await op("pause");
    expect(errorCode(await op("advance").catch((e) => e))).toBe("COUNTDOWN_RULE");
    await op("correction", -2);
    expect(await current()).toMatchObject({ currentValue: 3, status: "paused" });
    await op("resume");
    expect((await current())?.status).toBe("active");
  });

  it("keeps the value within 0 and the starting value", async () => {
    const { op } = await withCountdown(3);
    expect(errorCode(await op("reverse").catch((e) => e))).toBe("COUNTDOWN_RULE");
    expect(errorCode(await op("correction", -4).catch((e) => e))).toBe("COUNTDOWN_RULE");
  });

  it("hides a cancelled countdown and refuses further changes", async () => {
    const { op, current } = await withCountdown();
    await op("cancel");
    expect(await current()).toBeUndefined();
    expect(errorCode(await op("resume").catch((e) => e))).toBe("COUNTDOWN_RULE");
  });

  it("requires an amount exactly for corrections", async () => {
    const { op } = await withCountdown();
    expect(errorCode(await op("correction").catch((e) => e))).toBe("INVALID");
    expect(errorCode(await op("advance", 1).catch((e) => e))).toBe("INVALID");
  });

  it("replays a retried operation", async () => {
    const { gm, countdownId, current } = await withCountdown(5);
    const k = key();
    await gm.mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: k });
    await gm.mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: k });
    expect((await current())?.currentValue).toBe(4);
    const mismatch = await gm
      .mutation(api.countdowns.operate, { countdownId, action: "reverse", idempotencyKey: k })
      .catch((e) => e);
    expect(errorCode(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("hides another owner's countdowns", async () => {
    const { other, campaignId, countdownId } = await withCountdown();
    expect(errorCode(await other.query(api.countdowns.listByCampaign, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    const error = await other
      .mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(error)).toBe("NOT_FOUND");
  });

  it("lets players read the list but not change it", async () => {
    const { gm, other, campaignId, countdownId } = await withCountdown();
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    expect(await other.query(api.countdowns.listByCampaign, { campaignId })).toHaveLength(1);
    const error = await other
      .mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });

  describe("visibility (CV1)", () => {
    async function withPlayer() {
      const ctx = await setupWithCampaign();
      await ctx.gm.mutation(api.members.invite, { campaignId: ctx.campaignId, email: OTHER_EMAIL });
      const create = (visibility?: CountdownVisibility, name = "The dam breaks") =>
        ctx.gm.mutation(api.countdowns.create, {
          campaignId: ctx.campaignId,
          ...DETAILS,
          name,
          description: "Secret plan",
          visibility,
          idempotencyKey: key(),
        });
      const list = (who: typeof ctx.gm) => who.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId });
      return { ...ctx, create, list };
    }

    it("treats a countdown without visibility as public", async () => {
      const { create, list, other } = await withPlayer();
      await create();
      expect(await list(other)).toEqual([
        expect.objectContaining({ name: "The dam breaks", description: "Secret plan", currentValue: 3, startingValue: 3, visibility: { mode: "public", hidden: [] } }),
      ]);
    });

    it("A: a private countdown reaches the GM only", async () => {
      const { create, list, gm, other } = await withPlayer();
      await create(COUNTDOWN_VISIBILITY_PRESETS.private);
      expect(await list(gm)).toEqual([expect.objectContaining({ name: "The dam breaks", visibility: { mode: "private" } })]);
      expect(await list(other)).toEqual([]);
    });

    it("B: public with name and description hidden blanks them for players only", async () => {
      const { create, list, gm, other } = await withPlayer();
      await create(COUNTDOWN_VISIBILITY_PRESETS.partly);
      expect(await list(gm)).toEqual([expect.objectContaining({ name: "The dam breaks", description: "Secret plan" })]);
      const [seen] = await list(other);
      expect(seen).toMatchObject({
        name: null,
        description: null,
        category: "threat",
        consequence: "The road east is cut off.",
        currentValue: 3,
        startingValue: 3,
        status: "active",
      });
      expect(JSON.stringify(seen)).not.toMatch(/dam breaks|Secret plan/);
    });

    it("B: any field can be hidden, hidden progress keeps only the status", async () => {
      const { create, list, other } = await withPlayer();
      await create({ mode: "public", hidden: ["progress", "category", "consequence", "progress"] });
      const [seen] = await list(other);
      expect(seen).toMatchObject({
        name: "The dam breaks",
        description: "Secret plan",
        category: null,
        consequence: null,
        currentValue: null,
        startingValue: null,
        status: "active",
        visibility: { mode: "public", hidden: ["category", "consequence", "progress"] },
      });
    });

    it("C: everything public", async () => {
      const { create, list, other } = await withPlayer();
      await create(COUNTDOWN_VISIBILITY_PRESETS.public);
      expect(await list(other)).toEqual([expect.objectContaining({ name: "The dam breaks", consequence: "The road east is cut off.", currentValue: 3 })]);
    });

    it("the GM changes visibility later; players cannot", async () => {
      const { create, list, gm, other, campaignId } = await withPlayer();
      const { countdownId } = await create(COUNTDOWN_VISIBILITY_PRESETS.private);
      const set = (who: typeof gm, visibility: CountdownVisibility) =>
        who.mutation(api.countdowns.setVisibility, { campaignId, countdownId, visibility, idempotencyKey: key() });

      await set(gm, COUNTDOWN_VISIBILITY_PRESETS.partly);
      expect(await list(other)).toEqual([expect.objectContaining({ name: null, description: null })]);
      await set(gm, COUNTDOWN_VISIBILITY_PRESETS.public);
      expect(await list(other)).toEqual([expect.objectContaining({ name: "The dam breaks" })]);

      expect(errorCode(await set(other, COUNTDOWN_VISIBILITY_PRESETS.public).catch((e) => e))).toBe("FORBIDDEN");
      await set(gm, COUNTDOWN_VISIBILITY_PRESETS.private);
      expect(errorCode(await set(other, COUNTDOWN_VISIBILITY_PRESETS.public).catch((e) => e))).toBe("FORBIDDEN");
      expect(await list(other)).toEqual([]);
    });

    it("outsiders get NOT_FOUND, and another campaign's or a frame's countdown is not found", async () => {
      const { t, gm, other, campaignId, countdownId } = await withCountdown();
      const visibility = COUNTDOWN_VISIBILITY_PRESETS.private;
      // `other` has no access to this campaign at all.
      expect(
        errorCode(await other.mutation(api.countdowns.setVisibility, { campaignId, countdownId, visibility, idempotencyKey: key() }).catch((e) => e)),
      ).toBe("NOT_FOUND");
      // As GM of their own campaign they still cannot reach this countdown through it.
      const { campaignId: theirs } = await other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: key() });
      expect(
        errorCode(
          await other
            .mutation(api.countdowns.setVisibility, { campaignId: theirs, countdownId, visibility, idempotencyKey: key() })
            .catch((e) => e),
        ),
      ).toBe("NOT_FOUND");
      const owned = await t.run((ctx) =>
        ctx.db.insert("countdowns", {
          campaignId,
          name: "Objective",
          description: "",
          category: "project",
          startingValue: 4,
          currentValue: 4,
          status: "active",
          consequence: "",
          createdAt: 0,
          ownerKey: "nation:armada",
        }),
      );
      expect(
        errorCode(await gm.mutation(api.countdowns.setVisibility, { campaignId, countdownId: owned, visibility, idempotencyKey: key() }).catch((e) => e)),
      ).toBe("NOT_FOUND");
    });
  });

  it("does not operate countdowns owned by a frame tracker", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    const owned = await t.run((ctx) =>
      ctx.db.insert("countdowns", {
        campaignId,
        name: "Objective",
        description: "",
        category: "project",
        startingValue: 4,
        currentValue: 4,
        status: "active",
        consequence: "",
        createdAt: 0,
        ownerKey: "nation:armada",
        kind: "objective-minor",
      }),
    );
    const error = await gm
      .mutation(api.countdowns.operate, { countdownId: owned, action: "advance", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(error)).toBe("NOT_FOUND");
    expect(await gm.query(api.countdowns.listByCampaign, { campaignId })).toEqual([]);
  });
});
