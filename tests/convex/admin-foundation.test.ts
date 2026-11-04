import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AUDIT_TTL_MS, BATCH, EXPORT_TTL_MS, LIMIT_REQUEST_TTL_MS } from "../../convex/adminRetention";
import crons from "../../convex/crons";
import { recordAdminChange } from "../../convex/lib/adminAudit";
import { readAppConfig } from "../../convex/lib/appConfig";
import { isAppOwner } from "../../convex/lib/appOwner";
import { appOwnerAction, appOwnerMutation, appOwnerQuery } from "../../convex/lib/functions";
import schema from "../../convex/schema";
import { ADMIN_AUDIT_ACTIONS, DEFAULT_CAPS, DEFAULT_LOREKEEPER } from "../../src/lib/admin/config";
import { adminMessages } from "../../src/lib/errors/admin";
import { errorMessage } from "../../src/lib/convex-errors";
import { publicFunctions } from "./authz/inventory";
import { errorCode } from "./helpers";
import { modules } from "./setup";

/**
 * Config AD0: the app owner (superadmin) is one stored id set only by the internal `adminSetup.setOwner`; the
 * `appOwner*` wrappers refuse everyone else on the server; settings default to today's behaviour; audit rows and
 * exports expire. docs/tasks/TASK-CONFIG-AD0.md.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date("2026-11-04T12:00:00Z").getTime();

const OWNER = "owner@example.com";
const OTHER = "other@example.com";

// Probe functions built with the owner wrappers, registered as one extra module (as in functions.test.ts).
const probe = {
  read: appOwnerQuery({ args: {}, handler: async (ctx) => ctx.user._id }),
  write: appOwnerMutation({
    args: {},
    handler: async (ctx) => {
      await recordAdminChange(ctx, ctx.user._id, { action: "readOnly.set", from: false, to: true });
      return ctx.user._id;
    },
  }),
  run: appOwnerAction({ args: {}, handler: async (ctx) => ctx.user._id }),
};
const ref = {
  read: makeFunctionReference<"query">("probe:read"),
  write: makeFunctionReference<"mutation">("probe:write"),
  run: makeFunctionReference<"action">("probe:run"),
};

// Secrets and keys the settings must never echo (env values of every kind the deployment holds).
const SECRET_ENV = {
  ANTHROPIC_API_KEY: "sk-ant-secret-value-123",
  AUTH_RESEND_KEY: "re_secret_value_456",
  E2E_AUTH_SECRET: "e2e-secret-value-789",
  SITE_URL: "https://secret-site.example.com",
  MAIL_FROM: "secret-sender@example.com",
};
const LK_ENV = ["LOREKEEPER_DAILY_QUESTIONS", "LOREKEEPER_CAMPAIGN_MONTHLY_USD", "LOREKEEPER_MONTHLY_USD"];
const ENV_NAMES = [...Object.keys(SECRET_ENV), ...LK_ENV];

let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
});
afterEach(() => {
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  vi.useRealTimers();
});

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

async function setup() {
  const t = convexTest(schema, { ...modules, "../../convex/probe.ts": async () => probe });
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: OWNER, emailVerificationTime: 1 }),
    other: await ctx.db.insert("users", { email: OTHER, emailVerificationTime: 1 }),
  }));
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, as, owner: as(ids.owner), other: as(ids.other) };
}

const ownerRow = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
  t.run(async (ctx) => (await ctx.db.query("appConfig").withIndex("by_key", (q) => q.eq("key", "app")).unique())?.ownerId ?? null);

describe("adminSetup.setOwner (internal, deployment admin key)", () => {
  it("names the owner by a verified email, case-insensitively, and audits it", async () => {
    const { t, ids } = await setup();
    expect(await t.mutation(internal.adminSetup.setOwner, { email: "  Owner@Example.com " })).toEqual({ userId: ids.owner });
    expect(await ownerRow(t)).toBe(ids.owner);
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").collect());
    expect(audit).toMatchObject([{ action: "owner.set", actorId: ids.owner, to: ids.owner, target: ids.owner }]);
  });

  it("never names an unverified or unknown email (CF3)", async () => {
    const { t } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { email: "lookalike@example.com" }));
    expect(errorCode(await fail(t.mutation(internal.adminSetup.setOwner, { email: "lookalike@example.com" })))).toBe("NOT_FOUND");
    expect(errorCode(await fail(t.mutation(internal.adminSetup.setOwner, { email: "nobody@example.com" })))).toBe("NOT_FOUND");
    expect(errorCode(await fail(t.mutation(internal.adminSetup.setOwner, { email: "  " })))).toBe("INVALID");
    expect(await ownerRow(t)).toBeNull();
  });

  it("refuses an email two verified accounts share", async () => {
    const { t } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { email: OTHER, emailVerificationTime: 2 }));
    expect(errorCode(await fail(t.mutation(internal.adminSetup.setOwner, { email: OTHER })))).toBe("INVALID");
    expect(await ownerRow(t)).toBeNull();
  });

  it("hands the role over when run again: the old owner is refused at once", async () => {
    const { t, ids, owner, other } = await setup();
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    expect(await owner.query(ref.read, {})).toBe(ids.owner);
    await t.mutation(internal.adminSetup.setOwner, { email: OTHER });
    expect(errorCode(await fail(owner.query(ref.read, {})))).toBe("FORBIDDEN");
    expect(await other.query(ref.read, {})).toBe(ids.other);
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").collect());
    expect(audit.at(-1)).toMatchObject({ action: "owner.set", from: ids.owner, to: ids.other });
  });

  it("is internal: no client can call it, and nothing public sets the owner", async () => {
    const names = (await publicFunctions()).map((f) => f.name);
    expect(names.filter((name) => name.startsWith("adminSetup:"))).toEqual([]);
  }, 120_000);
});

describe("isAppOwner (the only owner check)", () => {
  it("is false for everyone while no owner is set, and for a signed-out caller", async () => {
    const { t, ids } = await setup();
    await t.run(async (ctx) => {
      expect(await isAppOwner(ctx, null)).toBe(false);
      expect(await isAppOwner(ctx, await ctx.db.get("users", ids.owner))).toBe(false);
    });
  });

  it("is true only for the stored owner, and false once their email is no longer verified", async () => {
    const { t, ids } = await setup();
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    await t.run(async (ctx) => {
      expect(await isAppOwner(ctx, await ctx.db.get("users", ids.owner))).toBe(true);
      expect(await isAppOwner(ctx, await ctx.db.get("users", ids.other))).toBe(false);
      await ctx.db.patch("users", ids.owner, { emailVerificationTime: undefined });
      expect(await isAppOwner(ctx, await ctx.db.get("users", ids.owner))).toBe(false);
    });
  });
});

describe("appOwner wrappers", () => {
  it("refuse signed-out callers with UNAUTHENTICATED and everyone but the owner with FORBIDDEN", async () => {
    const { t, ids, owner, other } = await setup();
    // Before an owner is set, nobody passes.
    for (const caller of [owner, other]) {
      expect(errorCode(await fail(caller.query(ref.read, {})))).toBe("FORBIDDEN");
      expect(errorCode(await fail(caller.mutation(ref.write, {})))).toBe("FORBIDDEN");
      expect(errorCode(await fail(caller.action(ref.run, {})))).toBe("FORBIDDEN");
    }
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    expect(errorCode(await fail(t.query(ref.read, {})))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(t.mutation(ref.write, {})))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(t.action(ref.run, {})))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(other.query(ref.read, {})))).toBe("FORBIDDEN");
    expect(errorCode(await fail(other.mutation(ref.write, {})))).toBe("FORBIDDEN");
    expect(errorCode(await fail(other.action(ref.run, {})))).toBe("FORBIDDEN");
    expect(await owner.query(ref.read, {})).toBe(ids.owner);
    expect(await owner.mutation(ref.write, {})).toBe(ids.owner);
    expect(await owner.action(ref.run, {})).toBe(ids.owner);
    // Only the owner's call wrote (a refused mutation writes nothing).
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").collect());
    expect(audit.filter((row) => row.action === "readOnly.set")).toMatchObject([{ actorId: ids.owner, from: false, to: true }]);
  });

  it("refuse a look-alike account with the owner's email that is not the stored id", async () => {
    const { t, as } = await setup();
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    const lookalike = await t.run((ctx) => ctx.db.insert("users", { email: OWNER }));
    expect(errorCode(await fail(as(lookalike).query(ref.read, {})))).toBe("FORBIDDEN");
    expect(errorCode(await fail(as(lookalike).action(ref.run, {})))).toBe("FORBIDDEN");
  });

  it("refuse the owner's session once the account row is deleted", async () => {
    const { t, ids, owner } = await setup();
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    await t.run((ctx) => ctx.db.delete("users", ids.owner));
    expect(errorCode(await fail(owner.query(ref.read, {})))).toBe("FORBIDDEN");
    expect(errorCode(await fail(owner.action(ref.run, {})))).toBe("FORBIDDEN");
  });
});

describe("appAdmin.me", () => {
  it("answers for the caller only: null signed out, false for others, true for the owner", async () => {
    const { t, owner, other } = await setup();
    expect(await t.query(api.appAdmin.me, {})).toBeNull();
    expect(await owner.query(api.appAdmin.me, {})).toEqual({ isOwner: false });
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    expect(await other.query(api.appAdmin.me, {})).toEqual({ isOwner: false });
    expect(await owner.query(api.appAdmin.me, {})).toEqual({ isOwner: true });
  });
});

describe("appAdmin.settings and readAppConfig", () => {
  it("default to today's behaviour: open sign-up, the Q19 caps, the Lorekeeper code defaults", async () => {
    const { t, owner } = await setup();
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    expect(await owner.query(api.appAdmin.settings, {})).toEqual({
      signUpMode: "open",
      caps: { campaignsPerGm: 10, campaignsApp: 100, charactersPerPlayer: 5, playersPerCampaign: 8 },
      lorekeeper: { ...DEFAULT_LOREKEEPER },
      spendAlertMonth: null,
    });
    expect(DEFAULT_CAPS).toEqual({ campaignsPerGm: 10, campaignsApp: 100, charactersPerPlayer: 5, playersPerCampaign: 8 });
  });

  it("read today's LOREKEEPER_* env vars before the code defaults, and a typo never changes a limit", async () => {
    const { t } = await setup();
    process.env.LOREKEEPER_DAILY_QUESTIONS = "12";
    process.env.LOREKEEPER_CAMPAIGN_MONTHLY_USD = "20";
    process.env.LOREKEEPER_MONTHLY_USD = "lots";
    const settings = await t.run((ctx) => readAppConfig(ctx));
    expect(settings.lorekeeper).toMatchObject({ dailyQuestions: 12, campaignMonthlyUsd: 20, monthlyUsd: 150 });
  });

  it("use the owner's saved values over the env vars", async () => {
    const { t } = await setup();
    process.env.LOREKEEPER_DAILY_QUESTIONS = "12";
    await t.run((ctx) =>
      ctx.db.insert("appConfig", {
        key: "app",
        signUpMode: "invite",
        caps: { campaignsApp: 3 },
        lorekeeper: { dailyQuestions: 7, atLimit: "short" },
        spendAlertMonth: "2026-11",
        updatedAt: NOW,
      }),
    );
    const settings = await t.run((ctx) => readAppConfig(ctx));
    expect(settings).toMatchObject({
      signUpMode: "invite",
      caps: { ...DEFAULT_CAPS, campaignsApp: 3 },
      lorekeeper: { dailyQuestions: 7, atLimit: "short", monthlyUsd: 150 },
      spendAlertMonth: "2026-11",
    });
  });

  it("never return a key, a secret or the owner id", async () => {
    Object.assign(process.env, SECRET_ENV);
    const { t, ids, owner } = await setup();
    await t.mutation(internal.adminSetup.setOwner, { email: OWNER });
    const text = JSON.stringify(await owner.query(api.appAdmin.settings, {}));
    for (const value of Object.values(SECRET_ENV)) expect(text).not.toContain(value);
    expect(text).not.toContain(ids.owner);
    expect(JSON.stringify(await owner.query(api.appAdmin.me, {}))).toBe('{"isOwner":true}');
  });
});

describe("audit and retention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("schedules the admin jobs at odd minutes", () => {
    const jobs = (crons as unknown as { crons: Record<string, { schedule: { type: string; cron?: string } }> }).crons;
    expect(jobs["expire admin audit"]?.schedule).toEqual({ type: "cron", cron: "43 4 * * *" });
    expect(jobs["expire limit requests"]?.schedule).toEqual({ type: "cron", cron: "57 4 * * *" });
    expect(jobs["expire admin exports"]?.schedule).toEqual({ type: "cron", cron: "3 * * * *" });
  });

  it("lists every later tracer's action in the audit union (rule 7: no in-place edit later)", () => {
    for (const action of ["campaign.view", "limits.request.approve", "limits.request.decline", "limits.campaign.set", "account.suspend", "account.unsuspend", "account.delete", "campaign.create", "campaign.delete"]) {
      expect(ADMIN_AUDIT_ACTIONS).toContain(action);
    }
  });

  it("expires audit rows older than 365 days in batches, rescheduling itself, and keeps newer ones", async () => {
    const { t, ids } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 30; i++) {
        await ctx.db.insert("adminAudit", { at: NOW - AUDIT_TTL_MS - DAY - i, actorId: ids.owner, action: "cap.set", field: "campaignsApp", from: 100, to: 50 });
      }
      await ctx.db.insert("adminAudit", { at: NOW - AUDIT_TTL_MS + DAY, actorId: ids.owner, action: "feature.set", field: "dice3d", from: "everyone", to: "off" });
    });
    await t.mutation(internal.adminRetention.expireAudit, {});
    expect(await t.run(async (ctx) => (await ctx.db.query("adminAudit").collect()).length)).toBe(31);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run((ctx) => ctx.db.query("adminAudit").collect());
    expect(left.map((row) => row.action)).toEqual(["feature.set"]);
  });

  it("deletes exports and their files after an hour, keeping newer ones", async () => {
    const { t, ids } = await setup();
    const { oldFile, newFile } = await t.run(async (ctx) => {
      const oldFile = await ctx.storage.store(new Blob(["{}"], { type: "application/json" }));
      const newFile = await ctx.storage.store(new Blob(["{}"], { type: "application/json" }));
      await ctx.db.insert("adminExports", { requestedBy: ids.owner, status: "ready", fileId: oldFile, createdAt: NOW - EXPORT_TTL_MS - MINUTE });
      await ctx.db.insert("adminExports", { requestedBy: ids.owner, status: "failed", createdAt: NOW - EXPORT_TTL_MS - MINUTE });
      await ctx.db.insert("adminExports", { requestedBy: ids.owner, status: "ready", fileId: newFile, createdAt: NOW - MINUTE });
      return { oldFile, newFile };
    });
    await t.mutation(internal.adminRetention.expireExports, {});
    await t.run(async (ctx) => {
      expect((await ctx.db.query("adminExports").collect()).map((row) => row.fileId)).toEqual([newFile]);
      expect(await ctx.db.system.get("_storage", oldFile)).toBeNull();
      expect(await ctx.db.system.get("_storage", newFile)).not.toBeNull();
    });
  });

  it("expires decided limit requests after 365 days and keeps pending ones", async () => {
    const { t, ids } = await setup();
    await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", {
        ownerId: ids.other,
        frameId: "witherwild",
        name: "Limits",
        nameKey: "limits",
        tier: 1,
        level: 1,
        createdAt: NOW,
        lastOpenedAt: NOW,
      });
      const old = NOW - LIMIT_REQUEST_TTL_MS - DAY;
      const base = { campaignId, requestedBy: ids.other, wants: { dailyQuestions: 60 }, reason: "Big table" };
      await ctx.db.insert("lorekeeperLimitRequests", { ...base, status: "approved", createdAt: old, decidedAt: old, decidedBy: ids.owner });
      await ctx.db.insert("lorekeeperLimitRequests", { ...base, status: "declined", createdAt: old, decidedAt: old, decidedBy: ids.owner });
      await ctx.db.insert("lorekeeperLimitRequests", { ...base, status: "pending", createdAt: old });
      await ctx.db.insert("lorekeeperLimitRequests", { ...base, status: "approved", createdAt: NOW - DAY, decidedAt: NOW, decidedBy: ids.owner });
    });
    await t.mutation(internal.adminRetention.expireLimitRequests, {});
    const left = await t.run((ctx) => ctx.db.query("lorekeeperLimitRequests").collect());
    expect(left.map((row) => row.status).sort()).toEqual(["approved", "pending"]);
  });
});

describe("admin error codes", () => {
  it("every code has a message the client shows", () => {
    for (const [code, text] of Object.entries(adminMessages)) {
      expect(errorMessage(new ConvexError({ code }))).toBe(text);
    }
    expect(Object.keys(adminMessages)).not.toContain("ADMIN_ONLY");
  });
});
