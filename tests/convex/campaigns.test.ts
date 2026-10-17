import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { makeTest } from "./setup";

const GM_EMAIL = "gm@example.com";
const OTHER_EMAIL = "other@example.com";

function errorData(error: unknown): unknown {
  return (error as { data?: unknown }).data;
}

function errorCode(error: unknown): unknown {
  const data = errorData(error);
  return typeof data === "object" && data !== null ? (data as { code?: unknown }).code : data;
}

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
    expect(errorData(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
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
    expect(errorData(error)).toBe("NOT_FOUND");
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

  it("requires sign-in", async () => {
    const { t } = await setup();
    const error = await t.query(api.campaigns.list, {}).catch((e) => e);
    expect(errorData(error)).toBe("UNAUTHENTICATED");
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
