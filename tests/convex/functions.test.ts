import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  campaignMutation,
  campaignQuery,
  creatorMutation,
  creatorQuery,
  gmMutation,
  gmQuery,
  keyedCampaignMutation,
  keyedCreatorMutation,
  maybeUserQuery,
  userAction,
  userMutation,
  userQuery,
} from "../../convex/lib/functions";
import { upsertGrant } from "../../convex/lib/permissions";
import schema from "../../convex/schema";
import { RuleError } from "../../src/lib/errors/app-error";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { modules } from "./setup";

// Probe functions built with the wrappers, registered as one extra module.
const probe = {
  whoami: userQuery({ args: {}, handler: async (ctx) => ctx.user._id }),
  maybeWhoami: maybeUserQuery({ args: {}, handler: async (ctx) => ctx.user?._id ?? null }),
  edit: campaignMutation({
    need: "edit",
    args: {},
    handler: async (ctx) => ({ campaignId: ctx.campaign._id, permission: ctx.permission, userId: ctx.user._id }),
  }),
  view: campaignQuery({ need: "view", enough: "owner", args: {}, handler: async (ctx) => ctx.permission }),
  gm: gmQuery({ args: {}, handler: async (ctx) => ctx.permission }),
  keyed: keyedCampaignMutation({
    need: "edit",
    args: { n: v.number() },
    handler: async (ctx, { n }) => ctx.once("probe", { n }, async () => ({ n, by: ctx.user._id })),
  }),
  fail: userMutation({
    args: { kind: v.union(v.literal("rule"), v.literal("zod"), v.literal("type"), v.literal("convex")) },
    handler: async (_ctx, { kind }) => {
      if (kind === "rule") throw new RuleError("FEAR_RANGE", "Fear must remain between 0 and 12.");
      if (kind === "zod") z.object({ name: z.string().min(1, "Name is required.") }).parse({ name: "" });
      if (kind === "convex") throw new ConvexError({ code: "NAME_TAKEN", message: "Taken." });
      throw new TypeError("boom");
    },
  }),
  limited: userMutation({ rateLimit: "joinByCode", args: {}, handler: async () => "ok" }),
  whoamiAction: userAction({ args: {}, handler: async (ctx) => ctx.user._id }),
  // Config G1: the creator rank and the archived guard.
  creatorRead: creatorQuery({ args: {}, handler: async (ctx) => ctx.permission }),
  creatorWrite: creatorMutation({ args: {}, handler: async (ctx) => ctx.permission }),
  creatorKeyed: keyedCreatorMutation({ args: {}, handler: async (ctx) => ctx.once("probe_creator", {}, async () => ctx.permission) }),
  needCreator: campaignMutation({ need: "creator", args: {}, handler: async (ctx) => ctx.permission }),
  gmWrite: gmMutation({ args: {}, handler: async (ctx) => ctx.permission }),
  gmWriteArchived: gmMutation({ archived: "allow", args: {}, handler: async (ctx) => ctx.permission }),
};

const ref = {
  whoami: makeFunctionReference<"query">("probe:whoami"),
  maybeWhoami: makeFunctionReference<"query">("probe:maybeWhoami"),
  edit: makeFunctionReference<"mutation">("probe:edit"),
  view: makeFunctionReference<"query">("probe:view"),
  gm: makeFunctionReference<"query">("probe:gm"),
  keyed: makeFunctionReference<"mutation">("probe:keyed"),
  fail: makeFunctionReference<"mutation">("probe:fail"),
  limited: makeFunctionReference<"mutation">("probe:limited"),
  whoamiAction: makeFunctionReference<"action">("probe:whoamiAction"),
  creatorRead: makeFunctionReference<"query">("probe:creatorRead"),
  creatorWrite: makeFunctionReference<"mutation">("probe:creatorWrite"),
  creatorKeyed: makeFunctionReference<"mutation">("probe:creatorKeyed"),
  needCreator: makeFunctionReference<"mutation">("probe:needCreator"),
  gmWrite: makeFunctionReference<"mutation">("probe:gmWrite"),
  gmWriteArchived: makeFunctionReference<"mutation">("probe:gmWriteArchived"),
};

// The rate limiter's test helper references vite/client types, which clash
// with setup.ts's ImportMeta declaration, so tsc must not follow this import.
const RATE_LIMITER_TEST = "@convex-dev/rate-limiter/test";
const rateLimiter = ((await import(/* @vite-ignore */ RATE_LIMITER_TEST)) as { default: { register: (t: unknown) => void } }).default;

const GM = "gm@example.com";
const PLAYER = "player@example.com";
const OUTSIDER = "outsider@example.com";
const REVOKED = "revoked@example.com";

async function setup() {
  const t = convexTest(schema, { ...modules, "../../convex/probe.ts": async () => probe });
  rateLimiter.register(t);
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", { email: PLAYER, emailVerificationTime: 1 }),
    outsider: await ctx.db.insert("users", { email: OUTSIDER, emailVerificationTime: 1 }),
    revoked: await ctx.db.insert("users", { email: REVOKED, emailVerificationTime: 1 }),
  }));
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  const gm = as(ids.gm);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Probe", idempotencyKey: key() });
  await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
  const grant = (principalId: string, permission: "view" | "edit" | "owner", principalKind: "user" | "campaign" = "user") =>
    t.run((ctx) =>
      upsertGrant(ctx, { resourceType: "campaign", resourceId: campaignId, principalKind, principalId, permission, createdBy: ids.gm }),
    );
  return { t, ids, gm, player: as(ids.player), outsider: as(ids.outsider), revoked: as(ids.revoked), campaignId, grant, as };
}

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

describe("user wrappers", () => {
  useAllowlist(`${GM},${PLAYER},${OUTSIDER}`);

  it("put the signed-in user on ctx, reject anonymous and deleted-user callers", async () => {
    const { t, ids, gm, revoked } = await setup();
    await t.run((ctx) => ctx.db.delete("users", ids.revoked));
    expect(await gm.query(ref.whoami, {})).toBe(ids.gm);
    expect(await gm.action(ref.whoamiAction, {})).toBe(ids.gm);
    expect(errorCode(await fail(t.query(ref.whoami, {})))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(t.action(ref.whoamiAction, {})))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(revoked.query(ref.whoami, {})))).toBe("FORBIDDEN");
    expect(errorCode(await fail(revoked.action(ref.whoamiAction, {})))).toBe("FORBIDDEN");
  });

  it("maybeUserQuery gives null when signed out", async () => {
    const { t, ids, gm } = await setup();
    expect(await t.query(ref.maybeWhoami, {})).toBeNull();
    expect(await gm.query(ref.maybeWhoami, {})).toBe(ids.gm);
  });

  it("send every error payload as an object { code, message }", async () => {
    const { t } = await setup();
    const anon = await fail(t.query(ref.whoami, {}));
    expect(errorData(anon)).toEqual({ code: "UNAUTHENTICATED", message: "Your session has ended. Sign in again." });
  });
});

describe("campaign wrappers", () => {
  useAllowlist(`${GM},${PLAYER},${OUTSIDER}`);

  it("put campaign and permission on ctx and enforce need", async () => {
    const { gm, player, outsider, campaignId, ids } = await setup();
    expect(await gm.mutation(ref.edit, { campaignId })).toEqual({ campaignId, permission: "owner", userId: ids.gm });
    expect(await gm.query(ref.gm, { campaignId })).toBe("owner");
    expect(await player.query(ref.view, { campaignId })).toBe("view");
    expect(errorCode(await fail(player.mutation(ref.edit, { campaignId })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(player.query(ref.gm, { campaignId })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(outsider.query(ref.view, { campaignId })))).toBe("NOT_FOUND");
  });

  it("an edit grant on the campaign raises access through the wrappers", async () => {
    const { player, outsider, campaignId, grant, ids } = await setup();
    await grant(ids.outsider, "view");
    expect(await outsider.query(ref.view, { campaignId })).toBe("view");
    expect(errorCode(await fail(outsider.mutation(ref.edit, { campaignId })))).toBe("FORBIDDEN");
    await grant(ids.outsider, "edit");
    expect(await outsider.mutation(ref.edit, { campaignId })).toMatchObject({ permission: "edit" });
    expect(errorCode(await fail(outsider.query(ref.gm, { campaignId })))).toBe("FORBIDDEN");
    // A grant raises a player above their role, too.
    await grant(ids.player, "edit");
    expect(await player.mutation(ref.edit, { campaignId })).toMatchObject({ permission: "edit" });
  });

  it("a grant to another campaign reaches that campaign's GM", async () => {
    const { outsider, campaignId, grant } = await setup();
    const { campaignId: other } = await outsider.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    await grant(other, "edit", "campaign");
    expect(await outsider.mutation(ref.edit, { campaignId })).toMatchObject({ permission: "edit" });
  });

  it("treat a deleted campaign as missing", async () => {
    const { t, gm, campaignId } = await setup();
    await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { deletedAt: 1 }));
    expect(errorCode(await fail(gm.query(ref.gm, { campaignId })))).toBe("NOT_FOUND");
  });
});

describe("creator wrappers and the archived guard (config G1)", () => {
  useAllowlist(`${GM},${PLAYER},${OUTSIDER}`);

  /** The setup plus a co-GM member (a promoted player) and an owner grant to the outsider. */
  async function withCoGm() {
    const s = await setup();
    const coGmId = await s.t.run((ctx) => ctx.db.insert("users", { email: "cogm@example.com", emailVerificationTime: 1 }));
    await s.t.run((ctx) => ctx.db.insert("campaignMembers", { campaignId: s.campaignId, userId: coGmId, joinedAt: 0, lastOpenedAt: 0 }));
    await s.gm.mutation(api.members.setCoGm, { campaignId: s.campaignId, userId: coGmId, coGm: true });
    await s.grant(s.ids.outsider, "owner");
    return { ...s, coGm: s.as(coGmId) };
  }

  it("only the creator passes need creator; a co-GM and an owner grant are FORBIDDEN; ctx.permission stays owner", async () => {
    const { gm, coGm, outsider, player, campaignId } = await withCoGm();
    for (const fn of [ref.creatorWrite, ref.needCreator]) {
      expect(await gm.mutation(fn, { campaignId })).toBe("owner");
      expect(errorCode(await fail(coGm.mutation(fn, { campaignId })))).toBe("FORBIDDEN");
      expect(errorCode(await fail(outsider.mutation(fn, { campaignId })))).toBe("FORBIDDEN");
      expect(errorCode(await fail(player.mutation(fn, { campaignId })))).toBe("FORBIDDEN");
    }
    expect(await gm.query(ref.creatorRead, { campaignId })).toBe("owner");
    expect(errorCode(await fail(coGm.query(ref.creatorRead, { campaignId })))).toBe("FORBIDDEN");
    expect(await gm.mutation(ref.creatorKeyed, { campaignId, idempotencyKey: key() })).toBe("owner");
    expect(errorCode(await fail(coGm.mutation(ref.creatorKeyed, { campaignId, idempotencyKey: key() })))).toBe("FORBIDDEN");
    // The co-GM and the owner grant pass every GM wrapper.
    expect(await coGm.query(ref.gm, { campaignId })).toBe("owner");
    expect(await coGm.mutation(ref.gmWrite, { campaignId })).toBe("owner");
    expect(await outsider.mutation(ref.gmWrite, { campaignId })).toBe("owner");
  });

  it("an archived campaign refuses mutations unless archived allow; queries read it", async () => {
    const { t, gm, coGm, player, campaignId } = await withCoGm();
    await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { archivedAt: 1 }));
    expect(errorCode(await fail(gm.mutation(ref.gmWrite, { campaignId })))).toBe("CAMPAIGN_ARCHIVED");
    expect(errorCode(await fail(gm.mutation(ref.creatorWrite, { campaignId })))).toBe("CAMPAIGN_ARCHIVED");
    expect(errorCode(await fail(gm.mutation(ref.edit, { campaignId })))).toBe("CAMPAIGN_ARCHIVED");
    expect(errorCode(await fail(gm.mutation(ref.keyed, { campaignId, n: 1, idempotencyKey: key() })))).toBe("CAMPAIGN_ARCHIVED");
    expect(await gm.mutation(ref.gmWriteArchived, { campaignId })).toBe("owner");
    expect(await coGm.mutation(ref.gmWriteArchived, { campaignId })).toBe("owner");
    // Access first: a player is FORBIDDEN, never CAMPAIGN_ARCHIVED.
    expect(errorCode(await fail(player.mutation(ref.gmWrite, { campaignId })))).toBe("FORBIDDEN");
    expect(await gm.query(ref.gm, { campaignId })).toBe("owner");
    expect(await player.query(ref.view, { campaignId })).toBe("view");
  });
});

describe("keyed wrappers: ctx.once", () => {
  useAllowlist(`${GM},${PLAYER},${OUTSIDER}`);

  it("replays for the same user, rejects another user's replay, and stores a SHA-256 request hash", async () => {
    const { t, gm, outsider, campaignId, grant, ids } = await setup();
    await grant(ids.outsider, "edit");
    const k = key();
    const first = await gm.mutation(ref.keyed, { campaignId, n: 1, idempotencyKey: k });
    expect(first).toEqual({ n: 1, by: ids.gm });
    expect(await gm.mutation(ref.keyed, { campaignId, n: 1, idempotencyKey: k })).toEqual(first);
    expect(errorCode(await fail(gm.mutation(ref.keyed, { campaignId, n: 2, idempotencyKey: k })))).toBe("IDEMPOTENCY_MISMATCH");
    // Same scope (the campaign), same key and request, different user.
    expect(errorCode(await fail(outsider.mutation(ref.keyed, { campaignId, n: 1, idempotencyKey: k })))).toBe("IDEMPOTENCY_MISMATCH");

    const rows = await t.run((ctx) => ctx.db.query("operations").collect());
    const row = rows.find((r) => r.idempotencyKey === k);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode('{"n":1}'));
    const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(row).toMatchObject({ kind: "probe", requestHash: expected, createdBy: ids.gm, campaignId });
  });
});

describe("error normalisation", () => {
  useAllowlist(`${GM},${PLAYER},${OUTSIDER}`);

  it("turns RuleError and ZodError into ConvexError { code, message } and rethrows a TypeError unchanged", async () => {
    const { gm } = await setup();
    const rule = await fail(gm.mutation(ref.fail, { kind: "rule" }));
    expect(rule).toBeInstanceOf(ConvexError);
    expect(errorData(rule)).toEqual({ code: "FEAR_RANGE", message: "Fear must remain between 0 and 12." });

    const zod = await fail(gm.mutation(ref.fail, { kind: "zod" }));
    expect(errorData(zod)).toEqual({ code: "INVALID", message: "Name is required." });

    const convex = await fail(gm.mutation(ref.fail, { kind: "convex" }));
    expect(errorData(convex)).toEqual({ code: "NAME_TAKEN", message: "Taken." });

    const type = await fail(gm.mutation(ref.fail, { kind: "type" }));
    expect(type).toBeInstanceOf(TypeError);
    expect(type).not.toBeInstanceOf(ConvexError);
    expect((type as Error).message).toBe("boom");
  });
});

describe("rate limits", () => {
  useAllowlist(`${GM},${PLAYER},${OUTSIDER}`);

  it("reject with RATE_LIMITED past the limit, per user", async () => {
    const { gm, player } = await setup();
    for (let i = 0; i < 10; i++) expect(await gm.mutation(ref.limited, {})).toBe("ok");
    expect(errorCode(await fail(gm.mutation(ref.limited, {})))).toBe("RATE_LIMITED");
    expect(await player.mutation(ref.limited, {})).toBe("ok");
  });
});
