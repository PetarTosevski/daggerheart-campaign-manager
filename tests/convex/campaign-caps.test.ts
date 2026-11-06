import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_CAPS } from "../../src/lib/admin/config";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

/**
 * Config AD5a (docs/tasks/TASK-CONFIG-AD5a.md): campaigns per GM and campaigns in the app are capped (Q19 a). Archived
 * and deleted campaigns don't count (Q9 a); create, restore and unarchive check the caps; the app owner is capped too.
 * Every refusal asserts `ConvexError.data.code`.
 */

const fail = (p: Promise<unknown>) => p.then(() => "resolved", errorCode);

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", name: "Olive", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com", name: "Mira", emailVerificationTime: 1 }),
    other: await ctx.db.insert("users", { email: "other@example.com", name: "Bram", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  const owner = as(ids.owner);
  const setCap = (cap: "campaignsPerGm" | "campaignsApp", value: number) =>
    owner.mutation(api.adminAccounts.setCap, { cap, value });
  return { t, ids, owner, gm: as(ids.gm), other: as(ids.other), setCap };
}

type Caller = Awaited<ReturnType<typeof setup>>["gm"];

const create = (who: Caller, name: string) =>
  who.mutation(api.campaigns.create, { frameId: "witherwild", name, idempotencyKey: key() });

async function createId(who: Caller, name: string) {
  return (await create(who, name)).campaignId;
}

describe("campaign caps (config AD5a)", () => {
  it("defaults are Q19 a: 10 per GM, 100 in the app", () => {
    expect(DEFAULT_CAPS.campaignsPerGm).toBe(10);
    expect(DEFAULT_CAPS.campaignsApp).toBe(100);
  });

  it("refuses a GM's campaign past campaignsPerGm with CAP_CAMPAIGNS_PER_GM; other GMs are unaffected", async () => {
    const { gm, other, setCap } = await setup();
    await setCap("campaignsPerGm", 2);
    await createId(gm, "One");
    await createId(gm, "Two");
    expect(await fail(create(gm, "Three"))).toBe("CAP_CAMPAIGNS_PER_GM");
    await createId(other, "Elsewhere");
  });

  it("refuses past campaignsApp with CAP_CAMPAIGNS_APP, across GMs", async () => {
    const { gm, other, setCap } = await setup();
    await setCap("campaignsApp", 2);
    await createId(gm, "One");
    await createId(other, "Two");
    expect(await fail(create(gm, "Three"))).toBe("CAP_CAMPAIGNS_APP");
    expect(await fail(create(other, "Four"))).toBe("CAP_CAMPAIGNS_APP");
  });

  it("caps the app owner too (Q19 a)", async () => {
    const { owner, setCap } = await setup();
    await setCap("campaignsPerGm", 1);
    await createId(owner, "Mine");
    expect(await fail(create(owner, "Another"))).toBe("CAP_CAMPAIGNS_PER_GM");
  });

  it("deleted campaigns don't count; restoring one past the cap is refused", async () => {
    const { gm, setCap } = await setup();
    await setCap("campaignsPerGm", 1);
    const first = await createId(gm, "One");
    await gm.mutation(api.campaigns.remove, { campaignId: first });
    const second = await createId(gm, "Two");
    expect(await fail(gm.mutation(api.campaigns.restore, { campaignId: first }))).toBe("CAP_CAMPAIGNS_PER_GM");
    await gm.mutation(api.campaigns.remove, { campaignId: second });
    await gm.mutation(api.campaigns.restore, { campaignId: first });
  });

  it("archived campaigns don't count; unarchiving past the cap is refused, and so is restoring for the app cap", async () => {
    const { gm, other, setCap } = await setup();
    await setCap("campaignsPerGm", 1);
    const first = await createId(gm, "One");
    await gm.mutation(api.campaignSettings.archive, { campaignId: first });
    const second = await createId(gm, "Two");
    expect(await fail(gm.mutation(api.campaignSettings.unarchive, { campaignId: first }))).toBe("CAP_CAMPAIGNS_PER_GM");
    await gm.mutation(api.campaignSettings.archive, { campaignId: second });
    await gm.mutation(api.campaignSettings.unarchive, { campaignId: first });

    // App cap: an archived campaign frees an app slot too.
    await setCap("campaignsPerGm", 10);
    await setCap("campaignsApp", 2);
    const theirs = await createId(other, "Theirs");
    expect(await fail(create(other, "More"))).toBe("CAP_CAMPAIGNS_APP");
    await other.mutation(api.campaigns.remove, { campaignId: theirs });
    await createId(other, "Replacement");
    expect(await fail(other.mutation(api.campaigns.restore, { campaignId: theirs }))).toBe("CAP_CAMPAIGNS_APP");
  });

  it("restoring a deleted archived campaign is allowed at the cap: it comes back archived", async () => {
    const { t, gm, setCap } = await setup();
    await setCap("campaignsPerGm", 1);
    const first = await createId(gm, "One");
    await gm.mutation(api.campaignSettings.archive, { campaignId: first });
    await gm.mutation(api.campaigns.remove, { campaignId: first });
    await createId(gm, "Two");
    await gm.mutation(api.campaigns.restore, { campaignId: first });
    const restored = await t.run((ctx) => ctx.db.get("campaigns", first));
    expect(restored?.deletedAt).toBeUndefined();
    expect(restored?.archivedAt).toBeTypeOf("number");
  });

  it("a lowered cap never removes existing campaigns; it only refuses new ones", async () => {
    const { t, ids, gm, setCap } = await setup();
    await createId(gm, "One");
    await createId(gm, "Two");
    await setCap("campaignsPerGm", 1);
    expect(await fail(create(gm, "Three"))).toBe("CAP_CAMPAIGNS_PER_GM");
    const live = await t.run((ctx) =>
      ctx.db
        .query("campaigns")
        .withIndex("by_owner_deletedAt_archivedAt", (q) => q.eq("ownerId", ids.gm).eq("deletedAt", undefined))
        .take(10),
    );
    expect(live).toHaveLength(2);
  });
});
