import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { featureOn, requireFeature } from "../../convex/lib/features";
import schema from "../../convex/schema";
import type { FeatureMode } from "../../src/lib/admin/config";
import { FEATURE_KEYS, FEATURES, type FeatureKey } from "../../src/lib/admin/features";
import { errorCode } from "./helpers";
import { modules } from "./setup";

/**
 * Config AD9: feature switches. The owner sets each feature to Off / Only me / Testers / Everyone; `features.mine`
 * tells each caller only their own on / off; a missing switch = Everyone; Journal and Share links are inert (N2 a);
 * `featureOn` is the one server check. docs/tasks/TASK-CONFIG-AD9.md.
 */

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 }),
    tester: await ctx.db.insert("users", { email: "tester@example.com", emailVerificationTime: 1 }),
    other: await ctx.db.insert("users", { email: "other@example.com", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  await t.run(async (ctx) => {
    await ctx.db.insert("appTesters", { userId: ids.tester, addedAt: 1, addedBy: ids.owner });
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), tester: as(ids.tester), other: as(ids.other) };
}

const allOn = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));

describe("FEATURES (Q25 b)", () => {
  it("lists every board row but the dropped combat HUD, with the board's descriptions", () => {
    expect(FEATURES.map((f) => f.key)).toEqual(["journal", "dice3d", "phoneLayout", "lorekeeperWeb", "spriteTokens", "shareLinks"]);
    for (const f of FEATURES) expect(f.description.length).toBeGreaterThan(0);
    expect(FEATURES.filter((f) => f.inert).map((f) => f.key)).toEqual(["journal", "shareLinks"]);
  });
});

describe("features.mine", () => {
  it("with no switches saved, everything is on for everyone, signed out included", async () => {
    const { t, owner, other } = await setup();
    expect(await t.query(api.features.mine, {})).toEqual(allOn);
    expect(await other.query(api.features.mine, {})).toEqual(allOn);
    expect(await owner.query(api.features.mine, {})).toEqual(allOn);
  });

  it("resolves each mode for the owner, a tester, another user and a signed-out caller", async () => {
    const { t, owner, tester, other } = await setup();
    const modes: [FeatureKey, FeatureMode][] = [
      ["dice3d", "off"],
      ["phoneLayout", "owner"],
      ["lorekeeperWeb", "testers"],
      ["spriteTokens", "everyone"],
    ];
    for (const [key, mode] of modes) await owner.mutation(api.features.setMode, { key, mode });
    const pick = (flags: Record<string, boolean>) => ({
      dice3d: flags.dice3d,
      phoneLayout: flags.phoneLayout,
      lorekeeperWeb: flags.lorekeeperWeb,
      spriteTokens: flags.spriteTokens,
    });
    expect(pick(await owner.query(api.features.mine, {}))).toEqual({ dice3d: false, phoneLayout: true, lorekeeperWeb: true, spriteTokens: true });
    expect(pick(await tester.query(api.features.mine, {}))).toEqual({ dice3d: false, phoneLayout: false, lorekeeperWeb: true, spriteTokens: true });
    expect(pick(await other.query(api.features.mine, {}))).toEqual({ dice3d: false, phoneLayout: false, lorekeeperWeb: false, spriteTokens: true });
    expect(pick(await t.query(api.features.mine, {}))).toEqual({ dice3d: false, phoneLayout: false, lorekeeperWeb: false, spriteTokens: true });
  });

  it("returns only the caller's booleans: no modes, no tester list, no owner, no other user", async () => {
    const { ids, owner, other } = await setup();
    await owner.mutation(api.features.setMode, { key: "lorekeeperWeb", mode: "testers" });
    const mine = await other.query(api.features.mine, {});
    expect(Object.keys(mine).sort()).toEqual([...FEATURE_KEYS].sort());
    for (const value of Object.values(mine)) expect(typeof value).toBe("boolean");
    const text = JSON.stringify(mine);
    for (const id of Object.values(ids)) expect(text).not.toContain(id);
    expect(text).not.toContain("testers");
  });

  it("Journal and Share links do nothing yet (N2 a): saved, but always on", async () => {
    const { t, owner, other } = await setup();
    await owner.mutation(api.features.setMode, { key: "journal", mode: "off" });
    await owner.mutation(api.features.setMode, { key: "shareLinks", mode: "off" });
    expect(await other.query(api.features.mine, {})).toEqual(allOn);
    expect(await t.query(api.features.mine, {})).toEqual(allOn);
    const list = await owner.query(api.features.list, {});
    expect(list.find((row) => row.key === "journal")?.mode).toBe("off");
    expect(list.find((row) => row.key === "shareLinks")?.mode).toBe("off");
  });

  it("follows the tester list and the owner role as they change", async () => {
    const { t, ids, owner, tester } = await setup();
    await owner.mutation(api.features.setMode, { key: "dice3d", mode: "testers" });
    expect((await tester.query(api.features.mine, {})).dice3d).toBe(true);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("appTesters").withIndex("by_user", (q) => q.eq("userId", ids.tester)).unique();
      await ctx.db.delete("appTesters", row!._id);
    });
    expect((await tester.query(api.features.mine, {})).dice3d).toBe(false);
    await owner.mutation(api.features.setMode, { key: "phoneLayout", mode: "owner" });
    await t.mutation(internal.adminSetup.setOwner, { email: "tester@example.com" });
    expect((await owner.query(api.features.mine, {})).phoneLayout).toBe(false);
    expect((await tester.query(api.features.mine, {})).phoneLayout).toBe(true);
  });
});

describe("features.list / features.setMode (owner only)", () => {
  it("lists every feature in board order; never saved = everyone with no change date", async () => {
    const { owner } = await setup();
    expect(await owner.query(api.features.list, {})).toEqual(FEATURE_KEYS.map((key) => ({ key, mode: "everyone", changedAt: null })));
  });

  it("saves a mode with its change time and writes one feature.set audit row", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.features.setMode, { key: "spriteTokens", mode: "owner" });
    await owner.mutation(api.features.setMode, { key: "spriteTokens", mode: "testers" });
    const row = (await owner.query(api.features.list, {})).find((r) => r.key === "spriteTokens");
    expect(row).toMatchObject({ mode: "testers" });
    expect(typeof row?.changedAt).toBe("number");
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
    const features = audit.filter((a) => a.action === "feature.set");
    expect(features).toMatchObject([
      { actorId: ids.owner, field: "spriteTokens", from: "everyone", to: "owner" },
      { actorId: ids.owner, field: "spriteTokens", from: "owner", to: "testers" },
    ]);
    const switches = await t.run((ctx) => ctx.db.query("featureSwitches").collect());
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatchObject({ key: "spriteTokens", mode: "testers", changedBy: ids.owner });
  });

  it("choosing the current mode changes nothing and is not audited", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.features.setMode, { key: "dice3d", mode: "off" });
    await owner.mutation(api.features.setMode, { key: "dice3d", mode: "off" });
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
    expect(audit.filter((a) => a.action === "feature.set")).toHaveLength(1);
  });

  it("refuses everyone but the owner on the server, and a refused call saves nothing", async () => {
    const { t, tester, other } = await setup();
    expect(errorCode(await fail(t.mutation(api.features.setMode, { key: "dice3d", mode: "off" })))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(other.mutation(api.features.setMode, { key: "dice3d", mode: "off" })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(tester.mutation(api.features.setMode, { key: "dice3d", mode: "off" })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(tester.query(api.features.list, {})))).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("featureSwitches").collect())).toEqual([]);
  });

  it("rejects an unknown feature key or mode at the validator", async () => {
    const { owner } = await setup();
    await expect(owner.mutation(api.features.setMode, { key: "combatHud" as FeatureKey, mode: "off" })).rejects.toThrow();
    await expect(owner.mutation(api.features.setMode, { key: "dice3d", mode: "admins" as FeatureMode })).rejects.toThrow();
  });
});

describe("featureOn / requireFeature (the one server check)", () => {
  it("agrees with features.mine and throws FEATURE_OFF when off", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.features.setMode, { key: "lorekeeperWeb", mode: "testers" });
    await t.run(async (ctx) => {
      const user = async (id: Id<"users">) => ctx.db.get("users", id);
      expect(await featureOn(ctx, await user(ids.owner), "lorekeeperWeb")).toBe(true);
      expect(await featureOn(ctx, await user(ids.tester), "lorekeeperWeb")).toBe(true);
      expect(await featureOn(ctx, await user(ids.other), "lorekeeperWeb")).toBe(false);
      expect(await featureOn(ctx, null, "lorekeeperWeb")).toBe(false);
      expect(await featureOn(ctx, null, "dice3d")).toBe(true);
      await requireFeature(ctx, await user(ids.tester), "lorekeeperWeb");
      expect(errorCode(await fail(requireFeature(ctx, await user(ids.other), "lorekeeperWeb")))).toBe("FEATURE_OFF");
    });
  });

  it("Off is off for the owner too", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.features.setMode, { key: "dice3d", mode: "off" });
    await t.run(async (ctx) => {
      expect(await featureOn(ctx, await ctx.db.get("users", ids.owner), "dice3d")).toBe(false);
    });
  });
});
