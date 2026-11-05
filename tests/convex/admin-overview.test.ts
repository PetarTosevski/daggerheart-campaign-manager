import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ADMIN_PAGE_MAX, ADMIN_READ_BOUND, LIMIT_REQUESTS_BOUND } from "../../convex/adminOverview";
import { recordAdminChange } from "../../convex/lib/adminAudit";
import schema from "../../convex/schema";
import { DEFAULT_CAPS, DEFAULT_LOREKEEPER } from "../../src/lib/admin/config";
import { errorCode } from "./helpers";
import { modules } from "./setup";

/**
 * Config AD2: the App admin Overview reads (docs/tasks/TASK-CONFIG-AD2.md). Owner only; counts are bounded; alerts are
 * codes + params; the campaigns card and Recent changes paginate. No email, key or secret ever comes back.
 */

const NOW = new Date("2026-11-04T12:00:00Z").getTime();
const DAY = "2026-11-04";
const MONTH = "2026-11";
const MICROS = 1_000_000;

const SECRET_ENV = {
  ANTHROPIC_API_KEY: "sk-ant-secret-value-123",
  AUTH_RESEND_KEY: "re_secret_value_456",
  E2E_AUTH_SECRET: "e2e-secret-value-789",
};
const ENV_NAMES = [...Object.keys(SECRET_ENV), "LOREKEEPER_DAILY_QUESTIONS", "LOREKEEPER_MONTHLY_USD"];

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
});

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", name: "Petar", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com", name: "Mira", emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", { email: "player@example.com", name: "Bo", emailVerificationTime: 1 }),
    player2: await ctx.db.insert("users", { email: "player2@example.com", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), gm: as(ids.gm) };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

function insertCampaign(t: T, ownerId: Id<"users">, name: string, extra: { deletedAt?: number; archivedAt?: number; createdAt?: number } = {}) {
  return t.run((ctx) =>
    ctx.db.insert("campaigns", {
      ownerId,
      frameId: "witherwild",
      name,
      nameKey: name.toLowerCase(),
      tier: 1,
      level: 1,
      createdAt: extra.createdAt ?? NOW,
      lastOpenedAt: NOW,
      ...(extra.deletedAt !== undefined ? { deletedAt: extra.deletedAt } : {}),
      ...(extra.archivedAt !== undefined ? { archivedAt: extra.archivedAt } : {}),
    }),
  );
}

describe("adminOverview: owner only", () => {
  it("refuses a GM with FORBIDDEN and a signed-out caller with UNAUTHENTICATED, before reading anything", async () => {
    const { t, gm } = await setup();
    expect(errorCode(await fail(gm.query(api.adminOverview.stats, { month: MONTH })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(gm.query(api.adminOverview.alerts, { day: DAY, month: MONTH })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(gm.query(api.adminOverview.campaigns, { paginationOpts: { cursor: null, numItems: 10 } })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(gm.query(api.adminOverview.audit, { paginationOpts: { cursor: null, numItems: 10 } })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(t.query(api.adminOverview.stats, { month: MONTH })))).toBe("UNAUTHENTICATED");
  });

  it("rejects a malformed day or month (CF10)", async () => {
    const { owner } = await setup();
    expect(errorCode(await fail(owner.query(api.adminOverview.stats, { month: "2026-13" })))).toBe("INVALID");
    expect(errorCode(await fail(owner.query(api.adminOverview.alerts, { day: "2026-10-04", month: MONTH })))).toBe("INVALID");
    expect(errorCode(await fail(owner.query(api.adminOverview.alerts, { day: "x", month: MONTH })))).toBe("INVALID");
  });
});

describe("adminOverview.stats", () => {
  it("splits accounts into owner / GM / player and counts live non-archived campaigns against the cap", async () => {
    const { t, ids, owner } = await setup();
    await insertCampaign(t, ids.gm, "Live");
    await insertCampaign(t, ids.gm, "Archived", { archivedAt: NOW });
    // A deleted campaign makes nobody a GM and doesn't count.
    await insertCampaign(t, ids.player, "Gone", { deletedAt: NOW });
    // The owner's own campaign: still counted once, as the owner.
    await insertCampaign(t, ids.owner, "Mine");
    await t.run((ctx) =>
      ctx.db.insert("lorekeeperUsage", { kind: "deployment", period: MONTH, questions: 412, costMicros: 31 * MICROS, updatedAt: NOW }),
    );
    await t.run((ctx) =>
      ctx.db.insert("lorekeeperUsage", { kind: "deployment", period: "2026-10", questions: 999, costMicros: 99 * MICROS, updatedAt: NOW }),
    );
    expect(await owner.query(api.adminOverview.stats, { month: MONTH })).toEqual({
      accounts: { total: 4, owner: 1, gms: 1, players: 2, more: false },
      campaigns: { live: { count: 2, more: false }, cap: DEFAULT_CAPS.campaignsApp },
      lorekeeper: { questions: 412, costMicros: 31 * MICROS, limitMicros: DEFAULT_LOREKEEPER.monthlyUsd * MICROS },
    });
  });

  it("reads zeros for a month with no counter", async () => {
    const { owner } = await setup();
    const stats = await owner.query(api.adminOverview.stats, { month: "2026-01" });
    expect(stats.lorekeeper).toMatchObject({ questions: 0, costMicros: 0 });
  });

  it(`stops counting at ${ADMIN_READ_BOUND} accounts and flags "more"`, async () => {
    const { t, owner } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < ADMIN_READ_BOUND; i++) await ctx.db.insert("users", { email: `u${i}@example.com` });
    });
    const stats = await owner.query(api.adminOverview.stats, { month: MONTH });
    expect(stats.accounts.total).toBe(ADMIN_READ_BOUND);
    expect(stats.accounts.more).toBe(true);
  });
});

describe("adminOverview.alerts", () => {
  it("lists requests waiting, read-only, missing keys, spend and users near today's cap, as codes with params", async () => {
    const { t, ids, owner } = await setup();
    process.env.LOREKEEPER_DAILY_QUESTIONS = "30";
    process.env.LOREKEEPER_MONTHLY_USD = "100";
    const campaignId = await insertCampaign(t, ids.gm, "Live");
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("lorekeeperLimitRequests", {
          campaignId,
          requestedBy: ids.gm,
          wants: { dailyQuestions: 60 },
          reason: "Big table",
          status: "pending",
          createdAt: NOW + i,
        });
      }
      await ctx.db.insert("lorekeeperLimitRequests", {
        campaignId,
        requestedBy: ids.gm,
        wants: { dailyQuestions: 60 },
        reason: "Old",
        status: "declined",
        createdAt: NOW - 10,
        decidedAt: NOW,
        decidedBy: ids.owner,
      });
      await ctx.db.insert("appStatus", { key: "app", readOnly: true, updatedAt: NOW });
      await ctx.db.insert("lorekeeperUsage", { kind: "deployment", period: MONTH, questions: 10, costMicros: 85 * MICROS, updatedAt: NOW });
      // Mira at 27 of 30 (90%): listed. Bo at 26 (86%): not. The owner at 30: uncapped, never listed. Yesterday: not.
      await ctx.db.insert("lorekeeperUsage", { kind: "user", userId: ids.gm, period: DAY, questions: 27, costMicros: 0, updatedAt: NOW });
      await ctx.db.insert("lorekeeperUsage", { kind: "user", userId: ids.player, period: DAY, questions: 26, costMicros: 0, updatedAt: NOW });
      await ctx.db.insert("lorekeeperUsage", { kind: "user", userId: ids.owner, period: DAY, questions: 30, costMicros: 0, updatedAt: NOW });
      await ctx.db.insert("lorekeeperUsage", { kind: "user", userId: ids.player2, period: "2026-11-03", questions: 30, costMicros: 0, updatedAt: NOW });
    });
    expect(await owner.query(api.adminOverview.alerts, { day: DAY, month: MONTH })).toEqual([
      { code: "limitRequestsWaiting", params: { count: 3, more: false } },
      { code: "readOnly", params: {} },
      { code: "keyMissing", params: { service: "lorekeeper" } },
      { code: "keyMissing", params: { service: "email" } },
      { code: "spendNearLimit", params: { costMicros: 85 * MICROS, limitMicros: 100 * MICROS } },
      { code: "userNearDailyCap", params: { userId: ids.gm, name: "Mira", questions: 27, cap: 30 } },
    ]);
  });

  it("is empty on a quiet day with the keys set, and says spendAtLimit at 100%", async () => {
    const { t, owner } = await setup();
    Object.assign(process.env, SECRET_ENV);
    expect(await owner.query(api.adminOverview.alerts, { day: DAY, month: MONTH })).toEqual([]);
    await t.run((ctx) =>
      ctx.db.insert("lorekeeperUsage", {
        kind: "deployment",
        period: MONTH,
        questions: 1,
        costMicros: DEFAULT_LOREKEEPER.monthlyUsd * MICROS,
        updatedAt: NOW,
      }),
    );
    const alerts = await owner.query(api.adminOverview.alerts, { day: DAY, month: MONTH });
    expect(alerts.map((a) => a.code)).toEqual(["spendAtLimit"]);
    // Presence only: no key or secret value appears anywhere in the answer.
    const text = JSON.stringify(alerts);
    for (const secret of Object.values(SECRET_ENV)) expect(text).not.toContain(secret);
  });

  it(`reads at most ${LIMIT_REQUESTS_BOUND + 1} pending requests and flags "more"`, async () => {
    const { t, ids, owner } = await setup();
    Object.assign(process.env, SECRET_ENV);
    await t.run(async (ctx) => {
      for (let i = 0; i < LIMIT_REQUESTS_BOUND + 5; i++) {
        const campaignId = await ctx.db.insert("campaigns", {
          ownerId: ids.gm,
          frameId: "witherwild",
          name: `C${i}`,
          nameKey: `c${i}`,
          tier: 1,
          level: 1,
          createdAt: NOW,
          lastOpenedAt: NOW,
        });
        await ctx.db.insert("lorekeeperLimitRequests", {
          campaignId,
          requestedBy: ids.gm,
          wants: {},
          reason: "r",
          status: "pending",
          createdAt: NOW + i,
        });
      }
    });
    expect(await owner.query(api.adminOverview.alerts, { day: DAY, month: MONTH })).toEqual([
      { code: "limitRequestsWaiting", params: { count: LIMIT_REQUESTS_BOUND, more: true } },
    ]);
  });
});

describe("adminOverview.campaigns", () => {
  it("pages live campaigns newest first with the GM's name, players, live now and last played; never emails", async () => {
    const { t, ids, owner } = await setup();
    const older = await insertCampaign(t, ids.gm, "Older", { createdAt: NOW - 1000 });
    const newer = await insertCampaign(t, ids.player2, "Newer");
    await insertCampaign(t, ids.gm, "Deleted", { deletedAt: NOW });
    await t.run(async (ctx) => {
      await ctx.db.insert("campaignMembers", { campaignId: older, userId: ids.player, joinedAt: NOW, lastOpenedAt: NOW });
      await ctx.db.insert("campaignMembers", { campaignId: older, userId: ids.player2, joinedAt: NOW, lastOpenedAt: NOW, role: "coGm" });
      const base = { campaignId: older, createdAt: NOW, updatedAt: NOW };
      await ctx.db.insert("sessions", { ...base, n: 1, status: "played", startedAt: NOW - 5000, endedAt: NOW - 4000 });
      await ctx.db.insert("sessions", { ...base, n: 2, status: "played", startedAt: NOW - 3000, endedAt: NOW - 2000 });
      const live = await ctx.db.insert("sessions", { ...base, campaignId: newer, n: 1, status: "live", startedAt: NOW });
      await ctx.db.insert("campaignState", { campaignId: newer, fear: 0, liveSessionId: live, sessionStartedAt: NOW });
    });
    const first = await owner.query(api.adminOverview.campaigns, { paginationOpts: { cursor: null, numItems: 1 } });
    expect(first.page).toEqual([
      {
        campaignId: newer,
        name: "Newer",
        gmId: ids.player2,
        gmName: null,
        players: { count: 0, more: false },
        archived: false,
        liveNow: true,
        lastPlayedAt: null,
        createdAt: NOW,
      },
    ]);
    expect(first.isDone).toBe(false);
    const second = await owner.query(api.adminOverview.campaigns, { paginationOpts: { cursor: first.continueCursor, numItems: 10 } });
    expect(second.page).toEqual([
      {
        campaignId: older,
        name: "Older",
        gmId: ids.gm,
        gmName: "Mira",
        players: { count: 2, more: false },
        archived: false,
        liveNow: false,
        lastPlayedAt: NOW - 2000,
        createdAt: NOW - 1000,
      },
    ]);
    expect(second.isDone).toBe(true);
    expect(JSON.stringify([first, second])).not.toContain("@example.com");
  });

  it("lists live campaigns first, newest first, then archived ones, newest archived first (dcm-jh6d.65)", async () => {
    const { t, ids, owner } = await setup();
    // Interleaved creation, so neither creation order nor archivedAt order alone gives the expected list.
    await insertCampaign(t, ids.gm, "Live 1", { createdAt: NOW - 5000 });
    await insertCampaign(t, ids.gm, "Archived early", { createdAt: NOW - 4000, archivedAt: NOW - 100 });
    await insertCampaign(t, ids.gm, "Live 2", { createdAt: NOW - 3000 });
    await insertCampaign(t, ids.gm, "Archived late", { createdAt: NOW - 2000, archivedAt: NOW - 50 });
    await insertCampaign(t, ids.gm, "Live 3", { createdAt: NOW - 1000 });
    await insertCampaign(t, ids.gm, "Deleted", { deletedAt: NOW });
    const expected = ["Live 3", "Live 2", "Live 1", "Archived late", "Archived early"];

    const all = await owner.query(api.adminOverview.campaigns, { paginationOpts: { cursor: null, numItems: 10 } });
    // The page that ends the live range hands over to the archived one.
    expect(all.page.map((row) => row.name)).toEqual(["Live 3", "Live 2", "Live 1"]);
    expect(all.isDone).toBe(false);
    const rest = await owner.query(api.adminOverview.campaigns, { paginationOpts: { cursor: all.continueCursor, numItems: 10 } });
    expect(rest.page.map((row) => [row.name, row.archived])).toEqual([
      ["Archived late", true],
      ["Archived early", true],
    ]);
    expect(rest.isDone).toBe(true);

    const names: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: { page: { name: string }[]; isDone: boolean; continueCursor: string } = await owner.query(
        api.adminOverview.campaigns,
        { paginationOpts: { cursor, numItems: 2 } },
      );
      names.push(...page.page.map((row) => row.name));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(names).toEqual(expected);
  });

  it("ends on the live range when nothing is archived, and refuses a forged cursor with INVALID", async () => {
    const { t, ids, owner } = await setup();
    await insertCampaign(t, ids.gm, "Only");
    const page = await owner.query(api.adminOverview.campaigns, { paginationOpts: { cursor: null, numItems: 10 } });
    expect(page.page.map((row) => row.name)).toEqual(["Only"]);
    expect(page.isDone).toBe(true);
    expect(errorCode(await fail(owner.query(api.adminOverview.campaigns, { paginationOpts: { cursor: "bogus", numItems: 10 } })))).toBe(
      "INVALID",
    );
  });

  it(`never returns more than ${ADMIN_PAGE_MAX} rows a page`, async () => {
    const { t, ids, owner } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < ADMIN_PAGE_MAX + 5; i++) {
        await ctx.db.insert("campaigns", {
          ownerId: ids.gm,
          frameId: "witherwild",
          name: `C${i}`,
          nameKey: `c${i}`,
          tier: 1,
          level: 1,
          createdAt: NOW,
          lastOpenedAt: NOW,
        });
      }
    });
    const page = await owner.query(api.adminOverview.campaigns, { paginationOpts: { cursor: null, numItems: 1000 } });
    expect(page.page).toHaveLength(ADMIN_PAGE_MAX);
  });
});

describe("adminOverview.audit", () => {
  it("pages Recent changes newest first with the actor's name", async () => {
    const { t, ids, owner } = await setup();
    await t.run(async (ctx) => {
      await recordAdminChange(ctx, ids.owner, { action: "cap.set", field: "campaignsApp", from: 100, to: 50 });
      await recordAdminChange(ctx, ids.gm, { action: "campaign.create", target: "c1" });
    });
    // setOwner wrote the first row; the two above follow.
    const all = await owner.query(api.adminOverview.audit, { paginationOpts: { cursor: null, numItems: 10 } });
    expect(all.page.map((r) => r.action)).toEqual(["campaign.create", "cap.set", "owner.set"]);
    expect(all.page[0]).toMatchObject({ actorId: ids.gm, actorName: "Mira", target: "c1" });
    expect(all.page[1]).toMatchObject({ actorName: "Petar", field: "campaignsApp", from: 100, to: 50 });
    const firstPage = await owner.query(api.adminOverview.audit, { paginationOpts: { cursor: null, numItems: 2 } });
    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
  });
});
