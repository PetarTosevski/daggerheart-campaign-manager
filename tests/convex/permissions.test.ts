import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { permissionFor, upsertGrant, type Permission } from "../../convex/lib/permissions";
import { errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const OUTSIDER = "outsider@example.com";
const OTHER_GM = "othergm@example.com";
const OTHER_PLAYER = "otherplayer@example.com";

describe("grants", () => {
  useAllowlist(`${GM},${OUTSIDER},${OTHER_GM},${OTHER_PLAYER}`);

  async function setup() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
      otherGm: await ctx.db.insert("users", { email: OTHER_GM, emailVerificationTime: 1 }),
      otherPlayer: await ctx.db.insert("users", { email: OTHER_PLAYER, emailVerificationTime: 1 }),
    }));
    const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
    const gm = as(ids.gm);
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Shared", idempotencyKey: key() });
    const visible = await gm.mutation(api.maps.addToken, { campaignId, type: "village", x: 10, y: 10, idempotencyKey: key() });
    const hidden = await gm.mutation(api.maps.addToken, { campaignId, type: "cave", x: 20, y: 20, idempotencyKey: key() });
    await gm.mutation(api.maps.updateToken, { campaignId, id: visible.id, patch: { notes: "GM secret" } });
    await gm.mutation(api.maps.updateToken, { campaignId, id: hidden.id, patch: { name: "Wyrm lair", hidden: true } });
    // Another campaign with its own GM and player.
    const otherGm = as(ids.otherGm);
    const { campaignId: other } = await otherGm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    await otherGm.mutation(api.members.invite, { campaignId: other, email: OTHER_PLAYER });
    await as(ids.otherPlayer).mutation(api.campaigns.markOpened, { campaignId: other });
    return { t, ids, gm, outsider: as(ids.outsider), otherPlayer: as(ids.otherPlayer), campaignId, other, visible };
  }

  type Grant = Pick<Doc<"grants">, "resourceType" | "resourceId" | "principalKind" | "principalId" | "permission" | "createdBy">;

  it("without grants an outsider has no access", async () => {
    const { outsider, campaignId } = await setup();
    expect(errorData(await outsider.query(api.maps.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await outsider.query(api.codex.list, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await outsider.query(api.characters.listByCampaign, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("a view grant to another campaign's user gives the player-filtered map, read-only", async () => {
    const { t, ids, outsider, campaignId, visible } = await setup();
    await t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "map", resourceId: campaignId, principalKind: "user", principalId: ids.outsider, permission: "view", createdBy: ids.gm }),
    );
    const view = await outsider.query(api.maps.get, { campaignId });
    expect(view.role).toBe("player");
    expect(view.state.tokens).toEqual([{ id: visible.id, type: "village", x: 10, y: 10, name: "Village", notes: "", hidden: false, location: false }]);
    expect(JSON.stringify(view)).not.toMatch(/Wyrm lair|GM secret/);
    expect(errorData(await outsider.mutation(api.maps.addToken, { campaignId, type: "camp", x: 1, y: 1, idempotencyKey: key() }).catch((e) => e))).toBe("FORBIDDEN");
    // The grant is on the map only: the codex stays hidden.
    expect(errorData(await outsider.query(api.codex.list, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("a view grant to a campaign reaches its members", async () => {
    const { t, ids, otherPlayer, campaignId, other } = await setup();
    await t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "map", resourceId: campaignId, principalKind: "campaign", principalId: other, permission: "view", createdBy: ids.gm }),
    );
    const view = await otherPlayer.query(api.maps.get, { campaignId });
    expect(view.role).toBe("player");
    expect(JSON.stringify(view)).not.toMatch(/Wyrm lair|GM secret/);
  });

  it("an edit grant allows map edits and gives the GM view", async () => {
    const { t, ids, outsider, campaignId } = await setup();
    const grant: Grant = { resourceType: "map", resourceId: campaignId, principalKind: "user", principalId: ids.outsider, permission: "view", createdBy: ids.gm };
    await t.run((ctx) => upsertGrant(ctx, grant));
    await t.run((ctx) => upsertGrant(ctx, { ...grant, permission: "edit" }));
    // One row per (resource, principal): the second grant replaced the first.
    expect(await t.run(async (ctx) => (await ctx.db.query("grants").collect()).map((g) => g.permission))).toEqual(["edit"]);

    const view = await outsider.query(api.maps.get, { campaignId });
    expect(view.role).toBe("gm");
    expect(JSON.stringify(view)).toMatch(/Wyrm lair/);
    const { id } = await outsider.mutation(api.maps.addToken, { campaignId, type: "camp", x: 1, y: 1, idempotencyKey: key() });
    expect((await outsider.query(api.maps.get, { campaignId })).state.tokens.some((tok) => tok.id === id)).toBe(true);
  });
});

describe("permissionFor read cost", () => {
  useAllowlist(`${GM},${OUTSIDER},${OTHER_PLAYER}`);

  /** Runs permissionFor on the campaign's map with a ctx.db that counts get/query calls. */
  async function readsFor(t: ReturnType<typeof makeTest>, userId: Id<"users">, campaignId: Id<"campaigns">, need: Permission) {
    return t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      const user = (await ctx.db.get("users", userId))!;
      let reads = 0;
      const db = new Proxy(ctx.db, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (prop === "get" || prop === "query") reads++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const permission = await permissionFor({ ...ctx, db }, user, { type: "map", campaign }, need);
      return { permission, reads };
    });
  }

  it("short-circuits on the role and never reads the caller's other campaigns", async () => {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
      player: await ctx.db.insert("users", { email: OTHER_PLAYER, emailVerificationTime: 1 }),
    }));
    const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
    const { campaignId } = await as(ids.gm).mutation(api.campaigns.create, { frameId: "witherwild", name: "Cost", idempotencyKey: key() });
    await as(ids.gm).mutation(api.members.invite, { campaignId, email: OTHER_PLAYER });
    await as(ids.player).mutation(api.campaigns.markOpened, { campaignId });

    expect(await readsFor(t, ids.gm, campaignId, "owner")).toEqual({ permission: "owner", reads: 0 });
    expect(await readsFor(t, ids.player, campaignId, "view")).toEqual({ permission: "view", reads: 1 });

    // No access: role (membership, invite) plus, per target, one user grant and one campaign-grant range.
    const before = await readsFor(t, ids.outsider, campaignId, "owner");
    expect(before).toEqual({ permission: null, reads: 6 });
    for (let i = 0; i < 5; i++) {
      await as(ids.outsider).mutation(api.campaigns.create, { frameId: "witherwild", name: `Mine ${i}`, idempotencyKey: key() });
    }
    expect(await readsFor(t, ids.outsider, campaignId, "owner")).toEqual(before);
  });
});
