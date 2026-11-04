import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { reserve, reservePass, settle, usageDay, usageMonth, type UsageScopes } from "../../convex/lib/lorekeeper/caps";
import { monthLabel, spendAlertEmail } from "../../convex/spendAlert";
import { PRIMARY_MODEL, reserveMicros, RETRY_MODEL } from "../../src/lib/lorekeeper/pricing";
import { key } from "./helpers";
import { makeTest } from "./setup";

// Config AD7 (Q32 a): the month's first crossing of 80% of the deployment's Lorekeeper limit, detected in reserve /
// reservePass / settle, marks appConfig.spendAlertMonth and schedules spendAlert:send once; the email goes to the
// owner's verified address through Resend, carries no key, and is never sent on the e2e backend.

// By name: `internal.spendAlert` appears once the orchestrator regenerates convex/_generated.
const sendRef = makeFunctionReference<"action", { month: string }, null>("spendAlert:send");

const SONNET_RESERVE = reserveMicros(PRIMARY_MODEL);
const ENV_NAMES = ["LOREKEEPER_MONTHLY_USD", "AUTH_RESEND_KEY", "MAIL_FROM", "SITE_URL", "CONVEX_CLOUD_URL", "E2E_AUTH_ENABLED"];

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

/** The app owner (verified), a GM and a campaign; the deployment limit at $10 (80% = $8). */
async function setup({ owner = true }: { owner?: boolean } = {}) {
  const t = makeTest();
  const now = Date.now();
  const month = usageMonth(now);
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
  }));
  process.env.LOREKEEPER_MONTHLY_USD = "10";
  if (owner) await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  const { campaignId } = await as(ids.gm).mutation(api.campaigns.create, { frameId: "witherwild", name: "Lore", idempotencyKey: key() });
  const scopes: UsageScopes = { userId: ids.gm, campaignId, day: usageDay(now), month };

  const ask = (at = now) =>
    t.run(async (ctx) => {
      const user = (await ctx.db.get("users", ids.gm))!;
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      return reserve(ctx, user, campaign, PRIMARY_MODEL, at);
    });
  /** Sets a month's deployment spend. */
  const spent = (micros: number, period = month) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "deployment").eq("period", period))
        .first();
      if (row) await ctx.db.patch("lorekeeperUsage", row._id, { costMicros: micros });
      else await ctx.db.insert("lorekeeperUsage", { kind: "deployment", period, questions: 0, costMicros: micros, updatedAt: now });
    });
  const jobs = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const alertJobs = async () => (await jobs()).filter((j) => j.name === "spendAlert:send");
  const alertMonth = () => t.run(async (ctx) => (await ctx.db.query("appConfig").first())?.spendAlertMonth ?? null);
  return { t, ids, campaignId, now, month, scopes, ask, spent, alertJobs, alertMonth };
}

describe("detecting the 80% crossing", () => {
  it("sends nothing under 80%", async () => {
    const w = await setup();
    await w.spent(7_000_000);
    await w.ask();
    expect(await w.alertJobs()).toEqual([]);
    expect(await w.alertMonth()).toBeNull();
  });

  it("reserve at 80% marks the month and schedules one email; a second crossing sends nothing", async () => {
    const w = await setup();
    await w.spent(8_000_000);
    await w.ask();
    expect(await w.alertMonth()).toBe(w.month);
    const first = await w.alertJobs();
    expect(first.map((j) => j.args)).toEqual([[{ month: w.month }]]);
    await w.ask();
    await w.spent(9_500_000);
    await w.ask();
    expect(await w.alertJobs()).toHaveLength(1);
  });

  it("settle detects the crossing from the real cost", async () => {
    const w = await setup();
    await w.spent(7_900_000);
    // Real cost above the booked amount pushes the month past 80%.
    await w.t.run((ctx) => settle(ctx, w.scopes, SONNET_RESERVE, SONNET_RESERVE + 200_000));
    expect(await w.alertMonth()).toBe(w.month);
    expect(await w.alertJobs()).toHaveLength(1);
  });

  it("reservePass detects it too", async () => {
    const w = await setup();
    await w.spent(8_100_000);
    await w.t.run((ctx) => reservePass(ctx, w.scopes, RETRY_MODEL, w.now));
    expect(await w.alertJobs()).toHaveLength(1);
  });

  it("a new month sends again; a past month's settle never sends", async () => {
    const w = await setup();
    await w.t.run(async (ctx) => {
      const row = (await ctx.db.query("appConfig").first())!;
      await ctx.db.patch("appConfig", row._id, { spendAlertMonth: "2000-01" });
    });
    await w.spent(9_000_000, "2000-02");
    await w.t.run((ctx) => settle(ctx, { ...w.scopes, month: "2000-02" }, 0, 100));
    expect(await w.alertJobs()).toEqual([]);
    await w.spent(8_000_000);
    await w.ask();
    expect(await w.alertMonth()).toBe(w.month);
    expect(await w.alertJobs()).toHaveLength(1);
  });

  it("sends nothing and marks nothing while 'Email me at 80%' is off; on again, it sends (AU3)", async () => {
    const w = await setup();
    await w.t.run(async (ctx) => {
      const row = (await ctx.db.query("appConfig").first())!;
      await ctx.db.patch("appConfig", row._id, { lorekeeper: { emailAt80: false } });
    });
    await w.spent(8_500_000);
    await w.ask();
    expect(await w.alertJobs()).toEqual([]);
    expect(await w.alertMonth()).toBeNull();
    await w.t.run(async (ctx) => {
      const row = (await ctx.db.query("appConfig").first())!;
      await ctx.db.patch("appConfig", row._id, { lorekeeper: { emailAt80: true } });
    });
    await w.ask();
    expect(await w.alertMonth()).toBe(w.month);
    expect(await w.alertJobs()).toHaveLength(1);
  });

  it("does nothing while no owner is set, and with a limit of 0", async () => {
    const w = await setup({ owner: false });
    await w.spent(9_000_000);
    await w.t.run((ctx) => reservePass(ctx, w.scopes, PRIMARY_MODEL, w.now, { mode: "owner" }));
    expect(await w.alertJobs()).toEqual([]);

    const z = await setup();
    process.env.LOREKEEPER_MONTHLY_USD = "0";
    await z.t.run((ctx) => reservePass(ctx, z.scopes, PRIMARY_MODEL, z.now, { mode: "owner" }));
    expect(await z.alertJobs()).toEqual([]);
  });
});

describe("spendAlert.send", () => {
  async function marked() {
    const w = await setup();
    await w.spent(8_200_000);
    await w.ask();
    process.env.AUTH_RESEND_KEY = "re_secret_key_123";
    process.env.MAIL_FROM = "app@example.com";
    process.env.SITE_URL = "https://app.example.com/";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return { w, fetchMock };
  }

  it("emails the owner's verified address with the month's numbers and no key", async () => {
    const { w, fetchMock } = await marked();
    await w.t.action(sendRef, { month: w.month });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body as string) as { to: string[]; subject: string; text: string; html: string };
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.subject).toMatch(/^Lorekeeper at 8\d% of its monthly limit$/);
    expect(body.text).toContain("of its $10.00 limit for");
    expect(body.html).toContain("https://app.example.com/admin");
    expect(JSON.stringify(body)).not.toContain("re_secret_key_123");
    expect(JSON.stringify(body)).not.toContain(w.ids.owner);
  });

  it("sends nothing on the e2e backend", async () => {
    const { w, fetchMock } = await marked();
    process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
    await w.t.action(sendRef, { month: w.month });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a month that is not the marked one", async () => {
    const { w, fetchMock } = await marked();
    await w.t.action(sendRef, { month: "2000-01" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the owner's email is no longer verified", async () => {
    const { w, fetchMock } = await marked();
    await w.t.run((ctx) => ctx.db.patch("users", w.ids.owner, { emailVerificationTime: undefined }));
    await w.t.action(sendRef, { month: w.month });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a Resend failure without the key", async () => {
    const { w } = await marked();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await w.t.action(sendRef, { month: w.month });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("re_secret_key_123");
    expect(JSON.stringify(log.mock.calls)).not.toContain("owner@example.com");
    log.mockRestore();
  });
});

describe("the email text", () => {
  it("states the spend, the limit, the month and what happens at the limit", () => {
    const email = spendAlertEmail({ month: "2026-11", spentMicros: 121_400_000, limitMicros: 150_000_000, atLimit: "short" }, null);
    expect(email.subject).toBe("Lorekeeper at 80% of its monthly limit");
    expect(email.text).toContain("$121.40 of its $150.00 limit for November 2026 (80%)");
    expect(email.text).toContain("shorter answers");
    expect(email.html).not.toContain("App admin</a>");
    expect(monthLabel("bad")).toBe("bad");
  });
});
