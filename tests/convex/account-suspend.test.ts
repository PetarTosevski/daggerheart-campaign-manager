import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { createOrUpdateUser } from "../../convex/lib/users";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

/**
 * Config AD14 (N11): the owner suspends an account and lifts the suspension. Suspended = signed out everywhere (its
 * sessions go), refused by every wrapper and at sign-in with ACCOUNT_SUSPENDED, nothing deleted, its campaign still
 * playable for the others. Safeguards: a reason, the email typed again, never the owner. docs/tasks/TASK-CONFIG-AD14.md.
 */

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", name: "Olive", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com", name: "Mira", emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), gm: as(ids.gm), player: as(ids.player) };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

const audit = (t: T) => t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
const status = (t: T, userId: Id<"users">) =>
  t.run((ctx) => ctx.db.query("accountStatus").withIndex("by_user", (q) => q.eq("userId", userId)).first());

async function session(t: T, userId: Id<"users">) {
  return t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 });
    await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: Date.now() + 1e9 });
    return sessionId;
  });
}

const suspendArgs = (userId: Id<"users">, email = "gm@example.com") => ({ userId, reason: "Spam campaigns", confirmEmail: email });

describe("suspend", () => {
  it("signs the account out everywhere, refuses every call and sign-in, deletes nothing; Lift restores it", async () => {
    const { t, ids, owner, gm, player } = await setup();
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Ember", idempotencyKey: key() });
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await player.mutation(api.members.joinByCode, { code });
    await session(t, ids.gm);
    await session(t, ids.player);

    await owner.mutation(api.adminAccountActions.suspend, suspendArgs(ids.gm, "  GM@Example.com "));

    // Signed out everywhere: its sessions and refresh tokens are gone; the player's stay.
    const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
    expect(sessions.map((s) => s.userId)).toEqual([ids.player]);
    expect(await t.run((ctx) => ctx.db.query("authRefreshTokens").collect())).toHaveLength(1);
    // Every wrapper refuses it (user, maybe-user, campaign queries and mutations).
    expect(errorCode(await fail(gm.query(api.campaigns.list, {})))).toBe("ACCOUNT_SUSPENDED");
    expect(errorCode(await fail(gm.query(api.campaigns.get, { campaignId })))).toBe("ACCOUNT_SUSPENDED");
    expect(errorCode(await fail(gm.mutation(api.campaigns.setPlayersSeeHands, { campaignId, enabled: false })))).toBe("ACCOUNT_SUSPENDED");
    // Sign-in is refused, by the existing account and by a Google sign-in of its email.
    expect(
      errorCode(await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: ids.gm, profile: {} })).catch((e: unknown) => e)),
    ).toBe("ACCOUNT_SUSPENDED");
    expect(
      errorCode(
        await t
          .run((ctx) =>
            createOrUpdateUser(ctx, { existingUserId: null, provider: { id: "google" }, profile: { email: "gm@example.com", emailVerified: true } }),
          )
          .catch((e: unknown) => e),
      ),
    ).toBe("ACCOUNT_SUSPENDED");
    // Nothing deleted, and the campaign stays playable for the player.
    expect(await t.run((ctx) => ctx.db.get("campaigns", campaignId))).toMatchObject({ ownerId: ids.gm });
    expect((await player.query(api.campaigns.get, { campaignId }))?.name).toBe("Ember");
    expect(await status(t, ids.gm)).toMatchObject({ reason: "Spam campaigns", by: ids.owner, suspendedAt: expect.any(Number) });
    expect(await owner.query(api.adminAccountActions.statuses, {})).toEqual([{ userId: ids.gm, suspended: true, deleteAfter: null }]);

    // Suspending again changes nothing.
    const before = (await audit(t)).length;
    await owner.mutation(api.adminAccountActions.suspend, suspendArgs(ids.gm));
    expect((await audit(t)).length).toBe(before);

    await owner.mutation(api.adminAccountActions.unsuspend, { userId: ids.gm });
    expect(await status(t, ids.gm)).toBeNull();
    expect(await gm.query(api.campaigns.list, {})).toBeDefined();
    expect(await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: ids.gm, profile: {} }))).toBe(ids.gm);
    expect(await owner.query(api.adminAccountActions.statuses, {})).toEqual([]);

    const rows = (await audit(t)).filter((r) => r.action.startsWith("account."));
    expect(rows).toMatchObject([
      { action: "account.suspend", actorId: ids.owner, target: ids.gm, to: "Spam campaigns" },
      { action: "account.unsuspend", actorId: ids.owner, target: ids.gm },
    ]);
    // The audit keeps the id only, never the email.
    expect(JSON.stringify(rows)).not.toContain("gm@example.com");
  });

  it("needs a reason and the account's email typed again", async () => {
    const { t, ids, owner } = await setup();
    expect(errorCode(await fail(owner.mutation(api.adminAccountActions.suspend, { ...suspendArgs(ids.gm), reason: "  " })))).toBe("INVALID");
    expect(
      errorCode(await fail(owner.mutation(api.adminAccountActions.suspend, { ...suspendArgs(ids.gm), reason: "x".repeat(301) }))),
    ).toBe("INVALID");
    expect(errorCode(await fail(owner.mutation(api.adminAccountActions.suspend, suspendArgs(ids.gm, "player@example.com"))))).toBe("INVALID");
    expect(await status(t, ids.gm)).toBeNull();
  });

  it("never targets the owner's own account, and refuses everyone but the owner", async () => {
    const { t, ids, owner, gm } = await setup();
    expect(errorCode(await fail(owner.mutation(api.adminAccountActions.suspend, suspendArgs(ids.owner, "owner@example.com"))))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(await fail(owner.mutation(api.adminAccountActions.unsuspend, { userId: ids.owner })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(gm.mutation(api.adminAccountActions.suspend, suspendArgs(ids.player, "player@example.com"))))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(await fail(t.mutation(api.adminAccountActions.suspend, suspendArgs(ids.player, "player@example.com"))))).toBe(
      "UNAUTHENTICATED",
    );
    expect(await status(t, ids.owner)).toBeNull();
    expect(await status(t, ids.player)).toBeNull();
  });

  it("refuses a missing account with NOT_FOUND", async () => {
    const { t, ids, owner } = await setup();
    await t.run((ctx) => ctx.db.delete("users", ids.player));
    expect(errorCode(await fail(owner.mutation(api.adminAccountActions.suspend, suspendArgs(ids.player, "player@example.com"))))).toBe(
      "NOT_FOUND",
    );
  });
});
