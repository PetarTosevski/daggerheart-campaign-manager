import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { OPEN_THROTTLE_MS } from "../../convex/campaigns";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

const GM_EMAIL = "gm@example.com";
const OTHER_EMAIL = "other@example.com";

async function setup() {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL }));
  const otherId = await t.run((ctx) => ctx.db.insert("users", { email: OTHER_EMAIL }));
  return {
    t,
    gm: t.withIdentity({ subject: `${gmId}|session` }),
    other: t.withIdentity({ subject: `${otherId}|session` }),
  };
}

const CUSTOM = {
  pitch: "  A drowned kingdom rises.  ",
  tones: ["Dark", "Mysterious"],
  themes: "Grief",
  touchstones: "",
  partySize: 5,
  startingTier: 3,
  background: "custom",
};

describe("campaigns", () => {
  const previous = process.env.GM_EMAILS;
  beforeEach(() => {
    process.env.GM_EMAILS = `${GM_EMAIL},${OTHER_EMAIL}`;
  });
  afterEach(() => {
    process.env.GM_EMAILS = previous;
  });

  it("creates a frame campaign with Fear 0 at tier 1, level 1", async () => {
    const { gm } = await setup();
    const { campaignId } = await gm.mutation(api.campaigns.create, {
      frameId: "witherwild",
      name: "  The Long Spring ",
      idempotencyKey: "k1",
    });
    const campaign = await gm.query(api.campaigns.get, { campaignId });
    expect(campaign).toMatchObject({
      frameId: "witherwild",
      name: "The Long Spring",
      tier: 1,
      level: 1,
      fear: 0,
      custom: null,
    });
  });

  it("creates a custom campaign with trimmed details and its starting tier", async () => {
    const { gm } = await setup();
    const { campaignId } = await gm.mutation(api.campaigns.create, {
      frameId: "custom",
      name: "Saltwake",
      custom: CUSTOM,
      idempotencyKey: "k1",
    });
    const campaign = await gm.query(api.campaigns.get, { campaignId });
    expect(campaign).toMatchObject({ tier: 3, level: 5 });
    expect(campaign?.custom?.pitch).toBe("A drowned kingdom rises.");
  });

  it("requires custom details exactly for custom campaigns", async () => {
    const { gm } = await setup();
    const missing = await gm
      .mutation(api.campaigns.create, { frameId: "custom", name: "A", idempotencyKey: "k1" })
      .catch((e) => e);
    expect(errorCode(missing)).toBe("INVALID");
    const extra = await gm
      .mutation(api.campaigns.create, {
        frameId: "witherwild",
        name: "B",
        custom: CUSTOM,
        idempotencyKey: "k2",
      })
      .catch((e) => e);
    expect(errorCode(extra)).toBe("INVALID");
  });

  it("rejects an empty name and an unknown tone", async () => {
    const { gm } = await setup();
    const empty = await gm
      .mutation(api.campaigns.create, { frameId: "witherwild", name: "   ", idempotencyKey: "k1" })
      .catch((e) => e);
    expect(errorCode(empty)).toBe("INVALID");
    const tone = await gm
      .mutation(api.campaigns.create, {
        frameId: "custom",
        name: "C",
        custom: { ...CUSTOM, tones: ["Grimdark"] },
        idempotencyKey: "k2",
      })
      .catch((e) => e);
    expect(errorCode(tone)).toBe("INVALID");
  });

  it("keeps names unique per GM, ignoring case and outer whitespace", async () => {
    const { gm, other } = await setup();
    await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Ember", idempotencyKey: "k1" });
    const clash = await gm
      .mutation(api.campaigns.create, { frameId: "beast-feast", name: " ember ", idempotencyKey: "k2" })
      .catch((e) => e);
    expect(errorCode(clash)).toBe("NAME_TAKEN");
    // Another owner may use the same name.
    await other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Ember", idempotencyKey: "k1" });
  });

  it("replays a retried create and rejects a reused key with a different request", async () => {
    const { t, gm } = await setup();
    const first = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Once", idempotencyKey: "same" });
    const again = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: " Once", idempotencyKey: "same" });
    expect(again).toEqual(first);
    expect(await t.run((ctx) => ctx.db.query("campaigns").collect())).toHaveLength(1);
    const mismatch = await gm
      .mutation(api.campaigns.create, { frameId: "witherwild", name: "Twice", idempotencyKey: "same" })
      .catch((e) => e);
    expect(errorCode(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("lists only the GM's own campaigns, most recently opened first", async () => {
    const { gm, other } = await setup();
    const a = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "A", idempotencyKey: "a" });
    await gm.mutation(api.campaigns.create, { frameId: "motherboard", name: "B", idempotencyKey: "b" });
    await other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: "c" });
    await new Promise((r) => setTimeout(r, 5));
    await gm.mutation(api.campaigns.markOpened, { campaignId: a.campaignId });
    const names = (await gm.query(api.campaigns.list, {})).map((c) => c.name);
    expect(names).toEqual(["A", "B"]);
  });

  it("hides another owner's campaign", async () => {
    const { gm, other } = await setup();
    const { campaignId } = await other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Theirs", idempotencyKey: "k" });
    expect(await gm.query(api.campaigns.get, { campaignId })).toBeNull();
    const error = await gm.mutation(api.campaigns.remove, { campaignId }).catch((e) => e);
    expect(errorCode(error)).toBe("NOT_FOUND");
  });

  it("deletes a campaign recoverably, and undo restores it", async () => {
    const { gm } = await setup();
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Gone", idempotencyKey: "k" });
    await gm.mutation(api.campaigns.remove, { campaignId });
    expect(await gm.query(api.campaigns.list, {})).toEqual([]);
    expect(await gm.query(api.campaigns.get, { campaignId })).toBeNull();
    // A deleted campaign's name is free again.
    await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "gone", idempotencyKey: "k2" });
    const blocked = await gm.mutation(api.campaigns.restore, { campaignId }).catch((e) => e);
    expect(errorCode(blocked)).toBe("NAME_TAKEN");
  });

  it("restores a deleted campaign", async () => {
    const { gm } = await setup();
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Back", idempotencyKey: "k" });
    await gm.mutation(api.campaigns.remove, { campaignId });
    await gm.mutation(api.campaigns.restore, { campaignId });
    expect((await gm.query(api.campaigns.list, {})).map((c) => c.name)).toEqual(["Back"]);
  });

  it("records opens in campaignOpens, at most every 5 minutes, without touching the campaign", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      const { t, gm } = await setup();
      const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Open", idempotencyKey: "k" });
      const before = await t.run((ctx) => ctx.db.get("campaigns", campaignId));
      const opens = () => t.run((ctx) => ctx.db.query("campaignOpens").collect());

      vi.setSystemTime(2_000_000);
      await gm.mutation(api.campaigns.markOpened, { campaignId });
      expect(await opens()).toMatchObject([{ campaignId, lastOpenedAt: 2_000_000 }]);

      vi.setSystemTime(2_000_000 + OPEN_THROTTLE_MS - 1);
      await gm.mutation(api.campaigns.markOpened, { campaignId });
      expect((await opens())[0].lastOpenedAt).toBe(2_000_000);

      vi.setSystemTime(2_000_000 + OPEN_THROTTLE_MS);
      await gm.mutation(api.campaigns.markOpened, { campaignId });
      expect(await opens()).toHaveLength(1);
      expect((await opens())[0].lastOpenedAt).toBe(2_000_000 + OPEN_THROTTLE_MS);

      expect(await t.run((ctx) => ctx.db.get("campaigns", campaignId))).toEqual(before);
      expect((await gm.query(api.campaigns.get, { campaignId }))?.lastOpenedAt).toBe(2_000_000 + OPEN_THROTTLE_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("orders unopened campaigns by their stored lastOpenedAt", async () => {
    const { t, gm } = await setup();
    const a = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "A", idempotencyKey: "a" });
    const b = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "B", idempotencyKey: "b" });
    // Opens recorded on the campaign document before campaignOpens existed.
    await t.run(async (ctx) => {
      await ctx.db.patch("campaigns", a.campaignId, { lastOpenedAt: 2000 });
      await ctx.db.patch("campaigns", b.campaignId, { lastOpenedAt: 1000 });
    });
    const names = async () => (await gm.query(api.campaigns.list, {})).map((c) => [c.name, c.lastOpenedAt]);
    expect(await names()).toEqual([
      ["A", 2000],
      ["B", 1000],
    ]);
    await gm.mutation(api.campaigns.markOpened, { campaignId: b.campaignId });
    expect((await names()).map(([name]) => name)).toEqual(["B", "A"]);
  });

  it("creates the join code with the campaign", async () => {
    const { t, gm } = await setup();
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Coded", idempotencyKey: "k" });
    const campaign = await t.run((ctx) => ctx.db.get("campaigns", campaignId));
    expect(campaign?.joinCode).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it("rate-limits campaign creation per user", async () => {
    const { gm, other } = await setup();
    // Bursts of 30, refilling at 10 an hour.
    for (let i = 0; i < 30; i++) {
      await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: `C${i}`, idempotencyKey: `k${i}` });
    }
    const limited = await gm
      .mutation(api.campaigns.create, { frameId: "witherwild", name: "C30", idempotencyKey: "k30" })
      .catch((e) => e);
    expect(errorCode(limited)).toBe("RATE_LIMITED");
    await other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Mine", idempotencyKey: "k" });
  });

  it("returns null, not an error, to a signed-out get", async () => {
    const { t, gm } = await setup();
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Mine", idempotencyKey: "k" });
    expect(await t.query(api.campaigns.get, { campaignId })).toBeNull();
    expect(await gm.query(api.campaigns.get, { campaignId: "not-an-id" })).toBeNull();
  });

  it("requires sign-in", async () => {
    const { t } = await setup();
    const error = await t.query(api.campaigns.list, {}).catch((e) => e);
    expect(errorCode(error)).toBe("UNAUTHENTICATED");
  });
});

describe("settings", () => {
  const previous = process.env.GM_EMAILS;
  beforeEach(() => {
    process.env.GM_EMAILS = GM_EMAIL;
  });
  afterEach(() => {
    process.env.GM_EMAILS = previous;
  });

  it("returns defaults, then saves partial updates", async () => {
    const { gm } = await setup();
    expect(await gm.query(api.settings.get, {})).toEqual({ tableName: "", gmName: "", accent: "#e3b45a" });
    await gm.mutation(api.settings.update, { tableName: " Thursday Crew " });
    await gm.mutation(api.settings.update, { accent: "#8f78d8" });
    expect(await gm.query(api.settings.get, {})).toEqual({
      tableName: "Thursday Crew",
      gmName: "",
      accent: "#8f78d8",
    });
  });

  it("rejects an accent outside the palette", async () => {
    const { gm } = await setup();
    const error = await gm.mutation(api.settings.update, { accent: "#ff00ff" }).catch((e) => e);
    expect(errorCode(error)).toBe("INVALID");
  });
});
