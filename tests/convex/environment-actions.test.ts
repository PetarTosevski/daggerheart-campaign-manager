import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupWithCampaign>>;

// EF1: the Environment tab spends a feature's Fear and starts its countdown (Private) on the dashboard.

async function setup({ hopeAndFear = true, fear = 0 } = {}) {
  const ctx = await setupWithCampaign();
  await ctx.gm.mutation(api.campaigns.setOption, { campaignId: ctx.campaignId, option: "hopeAndFear", enabled: hopeAndFear });
  if (fear > 0) await ctx.gm.mutation(api.fear.set, { campaignId: ctx.campaignId, value: fear, idempotencyKey: key() });
  return ctx;
}

const fearOf = async ({ gm, campaignId }: Ctx) => (await gm.query(api.campaigns.get, { campaignId }))?.fear;

const spend = ({ gm, campaignId }: Ctx, environmentId: string, featureName: string, who = gm) =>
  who.mutation(api.environmentActions.spendFear, { campaignId, environmentId, featureName, idempotencyKey: key() });

const start = ({ gm, campaignId }: Ctx, environmentId: string, featureName: string, who = gm) =>
  who.mutation(api.environmentActions.startCountdown, { campaignId, environmentId, featureName, idempotencyKey: key() });

const codeOf = async (p: Promise<unknown>) => errorCode(await p.then(() => null, (e: unknown) => e));

describe("environment actions (EF1)", () => {
  useAllowlist();

  describe("spendFear", () => {
    it("spends the feature's Fear cost, records a Fear spend in history and logs the feature in the GM's feed", async () => {
      const ctx = await setup({ fear: 5 });
      expect(await spend(ctx, "raging-river", "Undertow")).toMatchObject({ fear: 4, spent: 1 });
      expect(await spend(ctx, "divine-usurpation", "Godslayer")).toMatchObject({ fear: 1, spent: 3 });
      expect(await fearOf(ctx)).toBe(1);

      const rows = await ctx.t.run((c) => c.db.query("history").withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaignId)).collect());
      expect(rows.filter((r) => r.action === "spend")).toEqual([
        expect.objectContaining({ kind: "fear", before: 5, after: 4 }),
        expect.objectContaining({ kind: "fear", before: 4, after: 1 }),
      ]);
      const log = await ctx.t.run((c) => c.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaignId)).collect());
      expect(log.map((r) => [r.kind, r.visibility, r.summary])).toEqual([
        ["feature", "gm", "Spent 1 Fear: Undertow (Raging River)"],
        ["feature", "gm", "Spent 3 Fear: Godslayer (Divine Usurpation)"],
      ]);
    });

    it("is undone from the feed by the GM: the Fear comes back and the row shows as undone", async () => {
      const ctx = await setup({ fear: 5 });
      const { entryId } = await spend(ctx, "divine-usurpation", "Godslayer");
      expect(await fearOf(ctx)).toBe(2);
      const feed = await ctx.gm.query(api.feed.list, { campaignId: ctx.campaignId, paginationOpts: { numItems: 10, cursor: null } });
      expect(feed.page[0]).toMatchObject({ _id: entryId, canUndo: true, fearDelta: -3 });
      expect(await ctx.gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() })).toEqual({ undone: [entryId], fearReverted: -3 });
      expect(await fearOf(ctx)).toBe(5);
      expect(await codeOf(ctx.gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
    });

    it("refuses with FEAR_EMPTY when the GM holds less than the cost, and changes nothing", async () => {
      const ctx = await setup({ fear: 2 });
      expect(await codeOf(spend(ctx, "divine-usurpation", "Godslayer"))).toBe("FEAR_EMPTY");
      expect(await fearOf(ctx)).toBe(2);
    });

    it("refuses a feature without a Fear cost (INVALID) and unknown environments or features (NOT_FOUND)", async () => {
      const ctx = await setup({ fear: 3 });
      expect(await codeOf(spend(ctx, "mountain-pass", "Icy Winds"))).toBe("INVALID");
      expect(await codeOf(spend(ctx, "no-such-place", "Undertow"))).toBe("NOT_FOUND");
      expect(await codeOf(spend(ctx, "raging-river", "No Such Feature"))).toBe("NOT_FOUND");
      expect(await fearOf(ctx)).toBe(3);
    });
  });

  describe("startCountdown", () => {
    const listed = ({ gm, campaignId }: Ctx) => gm.query(api.countdowns.listByCampaign, { campaignId });

    it("starts a Private dashboard countdown from a numbered label, named after the environment and feature", async () => {
      const ctx = await setup();
      const result = await start(ctx, "cult-ritual", "The Summoning");
      expect(result).toMatchObject({ name: "Cult Ritual: The Summoning", startingValue: 6 });
      const [countdown] = await listed(ctx);
      expect(countdown).toMatchObject({
        _id: result.countdownId,
        name: "Cult Ritual: The Summoning",
        category: "threat",
        startingValue: 6,
        currentValue: 6,
        status: "active",
        consequence: "",
        visibility: { mode: "private" },
      });
      expect(countdown?.description).toMatch(/^When the PCs enter the scene or the cult begins the ritual/);
    });

    it("uses N of a Loop N label, rolls a dice label on the server, and picks the category from the label", async () => {
      const ctx = await setup();
      expect(await start(ctx, "mountain-pass", "Icy Winds")).toMatchObject({ startingValue: 4 });
      const rolled = await start(ctx, "chaos-realm", "Everything You Are This Place Will Take from You");
      expect(rolled.startingValue).toBeGreaterThanOrEqual(1);
      expect(rolled.startingValue).toBeLessThanOrEqual(4);
      expect(await start(ctx, "raiding-party", "Rally the Locals")).toMatchObject({ startingValue: 5 });
      expect(await start(ctx, "alchemists-abandoned-workshop", "It’s Alive!")).toMatchObject({ startingValue: 6 });
      const byName = Object.fromEntries((await listed(ctx)).map((c) => [c.name, c.category]));
      expect(byName).toEqual({
        "Mountain Pass: Icy Winds": "threat",
        "Chaos Realm: Everything You Are This Place Will Take from You": "threat",
        "Raiding Party: Rally the Locals": "project",
        "Alchemist’s Abandoned Workshop: It’s Alive!": "consequence",
      });
    });

    it("is private: a player of the campaign does not see it", async () => {
      const ctx = await setup();
      await ctx.gm.mutation(api.members.invite, { campaignId: ctx.campaignId, email: OTHER_EMAIL });
      await start(ctx, "mountain-pass", "Icy Winds");
      expect(await listed(ctx)).toHaveLength(1);
      expect(await ctx.other.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId })).toEqual([]);
    });

    it("refuses a feature without a countdown (INVALID) and unknown environments or features (NOT_FOUND)", async () => {
      const ctx = await setup();
      expect(await codeOf(start(ctx, "raging-river", "Undertow"))).toBe("INVALID");
      expect(await codeOf(start(ctx, "no-such-place", "Icy Winds"))).toBe("NOT_FOUND");
      expect(await codeOf(start(ctx, "mountain-pass", "Undertow"))).toBe("NOT_FOUND");
      expect(await listed(ctx)).toEqual([]);
    });
  });

  it("refuses Hope & Fear environments when the campaign's switch is off (NOT_FOUND); Core ones still work", async () => {
    const ctx = await setup({ hopeAndFear: false, fear: 3 });
    expect(await codeOf(spend(ctx, "abandoned-mine", "Into the Spider’s Web"))).toBe("NOT_FOUND");
    expect(await codeOf(start(ctx, "abandoned-mine", "Impending Collapse"))).toBe("NOT_FOUND");
    expect(await spend(ctx, "raging-river", "Undertow")).toMatchObject({ fear: 2, spent: 1 });
    expect(await start(ctx, "mountain-pass", "Icy Winds")).toMatchObject({ startingValue: 4 });
  });

  it("players get FORBIDDEN and outsiders NOT_FOUND", async () => {
    const ctx = await setup({ fear: 3 });
    // An outsider: no access to the campaign at all.
    expect(await codeOf(spend(ctx, "raging-river", "Undertow", ctx.other))).toBe("NOT_FOUND");
    expect(await codeOf(start(ctx, "mountain-pass", "Icy Winds", ctx.other))).toBe("NOT_FOUND");
    await ctx.gm.mutation(api.members.invite, { campaignId: ctx.campaignId, email: OTHER_EMAIL });
    expect(await codeOf(spend(ctx, "raging-river", "Undertow", ctx.other))).toBe("FORBIDDEN");
    expect(await codeOf(start(ctx, "mountain-pass", "Icy Winds", ctx.other))).toBe("FORBIDDEN");
    expect(await fearOf(ctx)).toBe(3);
    expect(await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId })).toEqual([]);
  });

  it("a retried request (same idempotency key) applies once", async () => {
    const ctx = await setup({ fear: 3 });
    const idempotencyKey = key();
    const args = { campaignId: ctx.campaignId, environmentId: "raging-river", featureName: "Undertow", idempotencyKey };
    await ctx.gm.mutation(api.environmentActions.spendFear, args);
    expect(await ctx.gm.mutation(api.environmentActions.spendFear, args)).toMatchObject({ fear: 2, spent: 1 });
    expect(await fearOf(ctx)).toBe(2);
  });

  it("starts a countdown written in a feature's text, and picks one of several by its label", async () => {
    const ctx = await setup();
    const climb = await start(ctx, "cliffside-ascent", "The Climb");
    expect(climb).toMatchObject({ name: "Cliffside Ascent: The Climb", startingValue: 12 });
    const pick = (label: string) =>
      ctx.gm.mutation(api.environmentActions.startCountdown, { campaignId: ctx.campaignId, environmentId: "heist", featureName: "Infiltration", label, idempotencyKey: key() });
    expect(await pick("Consequence Countdown (10)")).toMatchObject({ name: "Heist: Infiltration (Consequence)", startingValue: 10 });
    expect(await pick("Progress Countdown (12)")).toMatchObject({ name: "Heist: Infiltration (Progress)", startingValue: 12 });
    expect(await codeOf(pick("Countdown (99)"))).toBe("INVALID");
  });
});
