import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { capLimits, remaining, reserve, reservePass, settle, usageDay, usageMonth, type UsageScopes } from "../../convex/lib/lorekeeper/caps";
import { costMicros, PRIMARY_MODEL, reserveMicros, RETRY_MODEL } from "../../src/lib/lorekeeper/pricing";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D13 L5: the Lorekeeper's cost caps (Q9: 40 questions per person per UTC day, $50 per campaign per calendar month,
// $150 per month server-wide, all env vars). Money is booked per pass: `reserve` for the Sonnet pass at ask time,
// `reservePass` before the Opus retry and the web pass, `settle` with the real cost. No model is called.

const NOW = new Date("2026-10-21T12:00:00Z").getTime();
const NEXT_DAY = new Date("2026-10-22T00:00:01Z").getTime();
const NEXT_MONTH = new Date("2026-11-01T00:00:01Z").getTime();
const SONNET_RESERVE = reserveMicros(PRIMARY_MODEL); // 70_000
const OPUS_RESERVE = reserveMicros(RETRY_MODEL); // 140_000
const ENV_NAMES = ["LOREKEEPER_DAILY_QUESTIONS", "LOREKEEPER_CAMPAIGN_MONTHLY_USD", "LOREKEEPER_MONTHLY_USD", "LOREKEEPER_MODEL", "ANTHROPIC_MODEL"];

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
});
afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

/** A campaign with a GM and two players, joined through the public API. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  const callers = { gm: as(ids.gm), p1: as(ids.p1), p2: as(ids.p2) };
  const { campaignId } = await callers.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Lore", idempotencyKey: key() });
  const code = await callers.gm.mutation(api.members.rotateJoinCode, { campaignId });
  await callers.p1.mutation(api.members.joinByCode, { code });
  await callers.p2.mutation(api.members.joinByCode, { code });

  /** `caps.reserve` for one user, in its own transaction (as `lorekeeper.ask` would). */
  const ask = (who: keyof typeof ids, now = NOW, model = PRIMARY_MODEL) =>
    t.run(async (ctx) => {
      const user = (await ctx.db.get("users", ids[who]))!;
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      return reserve(ctx, user, campaign, model, now);
    });
  /** The error code `ask` throws, or "ok". */
  const askCode = (who: keyof typeof ids, now = NOW) => ask(who, now).then(() => "ok", errorCode);
  const scopes = (who: keyof typeof ids, now = NOW): UsageScopes => ({ userId: ids[who], campaignId, day: usageDay(now), month: usageMonth(now) });
  const rows = () => t.run((ctx) => ctx.db.query("lorekeeperUsage").collect());
  const row = async (kind: "user" | "campaign" | "deployment", who: keyof typeof ids = "p1", period?: string) =>
    (await rows()).find(
      (r) =>
        r.kind === kind &&
        (kind !== "user" || r.userId === ids[who]) &&
        (kind !== "campaign" || r.campaignId === campaignId) &&
        r.period === (period ?? (kind === "user" ? usageDay(NOW) : usageMonth(NOW))),
    );
  /** Seeds the month's campaign or deployment spend. */
  const spend = (kind: "campaign" | "deployment", micros: number, month = usageMonth(NOW)) =>
    t.run((ctx) =>
      ctx.db.insert("lorekeeperUsage", {
        kind,
        ...(kind === "campaign" ? { campaignId } : {}),
        period: month,
        questions: 0,
        costMicros: micros,
        updatedAt: NOW,
      }),
    );
  return { t, ids, callers, campaignId, ask, askCode, scopes, rows, row, spend };
}

type World = Awaited<ReturnType<typeof setup>>;

const mine = (w: World, who: keyof World["callers"], day = usageDay(NOW), month = usageMonth(NOW)) =>
  w.callers[who].query(api.lorekeeperUsage.mine, { campaignId: w.campaignId, day, month });

describe("caps limits", () => {
  it("defaults to 40 questions, $50 per campaign and $150 server-wide", () => {
    expect(capLimits()).toEqual({ dailyQuestions: 40, campaignMonthlyMicros: 50_000_000, deploymentMonthlyMicros: 150_000_000 });
  });

  it("reads the env vars in the call, and ignores values that are not non-negative numbers", () => {
    process.env.LOREKEEPER_DAILY_QUESTIONS = "5";
    process.env.LOREKEEPER_CAMPAIGN_MONTHLY_USD = "12.5";
    process.env.LOREKEEPER_MONTHLY_USD = "-3";
    expect(capLimits()).toEqual({ dailyQuestions: 5, campaignMonthlyMicros: 12_500_000, deploymentMonthlyMicros: 150_000_000 });
    process.env.LOREKEEPER_DAILY_QUESTIONS = "lots";
    expect(capLimits().dailyQuestions).toBe(40);
  });
});

describe("caps.reserve", () => {
  useAllowlist(EMAILS);

  it("counts the question and books Sonnet's worst case on all three counters", async () => {
    const w = await setup();
    expect(await w.ask("p1")).toEqual({ micros: SONNET_RESERVE, day: "2026-10-21", month: "2026-10" });
    expect(await w.row("user")).toMatchObject({ userId: w.ids.p1, questions: 1, costMicros: SONNET_RESERVE });
    expect(await w.row("campaign")).toMatchObject({ campaignId: w.campaignId, questions: 1, costMicros: SONNET_RESERVE });
    expect(await w.row("deployment")).toMatchObject({ questions: 1, costMicros: SONNET_RESERVE });
    expect(await w.rows()).toHaveLength(3);
  });

  it("refuses the 41st question of a UTC day with LOREKEEPER_CAP_USER and books nothing for it", async () => {
    const w = await setup();
    for (let i = 0; i < 40; i++) await w.ask("p1");
    expect(await w.askCode("p1")).toBe("LOREKEEPER_CAP_USER");
    expect(await w.row("user")).toMatchObject({ questions: 40 });
    expect(await w.row("campaign")).toMatchObject({ questions: 40, costMicros: 40 * SONNET_RESERVE });
    // The cap is per person: another member still asks.
    expect(await w.askCode("p2")).toBe("ok");
  });

  it("a new UTC day resets the question count", async () => {
    const w = await setup();
    process.env.LOREKEEPER_DAILY_QUESTIONS = "1";
    await w.ask("p1");
    expect(await w.askCode("p1")).toBe("LOREKEEPER_CAP_USER");
    expect(await w.askCode("p1", NEXT_DAY)).toBe("ok");
    expect(await w.row("user", "p1", "2026-10-22")).toMatchObject({ questions: 1 });
  });

  it("a campaign at its monthly cap refuses every member, GM included, until the next month", async () => {
    const w = await setup();
    await w.spend("campaign", 50_000_000 - SONNET_RESERVE + 1);
    expect(await w.askCode("p1")).toBe("LOREKEEPER_CAP_CAMPAIGN");
    expect(await w.askCode("p2")).toBe("LOREKEEPER_CAP_CAMPAIGN");
    expect(await w.askCode("gm")).toBe("LOREKEEPER_CAP_CAMPAIGN");
    expect(await w.row("user")).toBeUndefined();
    expect(await w.askCode("p1", NEXT_MONTH)).toBe("ok");
  });

  it("a deployment at its monthly cap refuses with LOREKEEPER_CAP_DEPLOYMENT", async () => {
    const w = await setup();
    process.env.LOREKEEPER_MONTHLY_USD = "1";
    await w.spend("deployment", 1_000_000 - SONNET_RESERVE + 1);
    expect(await w.askCode("p1")).toBe("LOREKEEPER_CAP_DEPLOYMENT");
    process.env.LOREKEEPER_MONTHLY_USD = "2";
    expect(await w.askCode("p1")).toBe("ok");
  });

  it("a cap of 0 refuses every question (the Lorekeeper switched off by setting)", async () => {
    const w = await setup();
    process.env.LOREKEEPER_DAILY_QUESTIONS = "0";
    expect(await w.askCode("gm")).toBe("LOREKEEPER_CAP_USER");
    process.env.LOREKEEPER_DAILY_QUESTIONS = "40";
    process.env.LOREKEEPER_CAMPAIGN_MONTHLY_USD = "0";
    expect(await w.askCode("gm")).toBe("LOREKEEPER_CAP_CAMPAIGN");
  });

  it("concurrent reserves never pass a cap", async () => {
    const w = await setup();
    // Room for exactly one more Sonnet reservation in the campaign.
    await w.spend("campaign", 50_000_000 - SONNET_RESERVE);
    const results = await Promise.all([w.askCode("p1"), w.askCode("p2")]);
    expect(results.sort()).toEqual(["LOREKEEPER_CAP_CAMPAIGN", "ok"]);
    expect((await w.row("campaign"))?.costMicros).toBe(50_000_000);

    process.env.LOREKEEPER_DAILY_QUESTIONS = "1";
    process.env.LOREKEEPER_CAMPAIGN_MONTHLY_USD = "100";
    const same = await Promise.all([w.askCode("gm"), w.askCode("gm")]);
    expect(same.sort()).toEqual(["LOREKEEPER_CAP_USER", "ok"]);
    expect(await w.row("user", "gm")).toMatchObject({ questions: 1 });
  });
});

describe("caps.reservePass (the Opus retry and the web pass)", () => {
  useAllowlist(EMAILS);

  it("books the pass's worst case without counting another question", async () => {
    const w = await setup();
    await w.ask("p1");
    const booked = await w.t.run((ctx) => reservePass(ctx, w.scopes("p1"), RETRY_MODEL, NOW));
    expect(booked).toBe(OPUS_RESERVE);
    const web = await w.t.run((ctx) => reservePass(ctx, w.scopes("p1"), PRIMARY_MODEL, NOW, { webSearches: 3 }));
    expect(web).toBe(SONNET_RESERVE + 30_000);
    for (const kind of ["user", "campaign", "deployment"] as const) {
      expect(await w.row(kind)).toMatchObject({ questions: 1, costMicros: SONNET_RESERVE + OPUS_RESERVE + SONNET_RESERVE + 30_000 });
    }
  });

  it("returns null and books nothing when the retry would break the campaign or deployment budget", async () => {
    const w = await setup();
    await w.spend("campaign", 50_000_000 - SONNET_RESERVE - OPUS_RESERVE + 1);
    await w.ask("p1"); // the Sonnet pass still fits
    expect(await w.t.run((ctx) => reservePass(ctx, w.scopes("p1"), RETRY_MODEL, NOW))).toBeNull();
    expect((await w.row("campaign"))?.costMicros).toBe(50_000_000 - OPUS_RESERVE + 1);
    expect((await w.row("user"))?.costMicros).toBe(SONNET_RESERVE);

    process.env.LOREKEEPER_CAMPAIGN_MONTHLY_USD = "100";
    process.env.LOREKEEPER_MONTHLY_USD = "0.2";
    expect(await w.t.run((ctx) => reservePass(ctx, w.scopes("p1"), RETRY_MODEL, NOW))).toBeNull();
  });

  it("ignores the daily question cap (the question is already counted)", async () => {
    const w = await setup();
    process.env.LOREKEEPER_DAILY_QUESTIONS = "1";
    await w.ask("p1");
    expect(await w.t.run((ctx) => reservePass(ctx, w.scopes("p1"), RETRY_MODEL, NOW))).toBe(OPUS_RESERVE);
  });
});

describe("caps.settle", () => {
  useAllowlist(EMAILS);

  it("replaces the reservation with the real cost on all three counters", async () => {
    const w = await setup();
    const reserved = await w.ask("p1");
    const actual = costMicros({ input: 9500, cacheRead: 1500, cacheWrite: 0, output: 2000, webSearches: 0 }, PRIMARY_MODEL);
    await w.t.run((ctx) => settle(ctx, w.scopes("p1"), reserved.micros, actual));
    for (const kind of ["user", "campaign", "deployment"] as const) {
      expect(await w.row(kind)).toMatchObject({ questions: 1, costMicros: actual });
    }
  });

  it("settles each pass separately (Sonnet, then the Opus retry)", async () => {
    const w = await setup();
    const primary = await w.ask("p1");
    await w.t.run((ctx) => settle(ctx, w.scopes("p1"), primary.micros, 30_000));
    const retry = (await w.t.run((ctx) => reservePass(ctx, w.scopes("p1"), RETRY_MODEL, NOW)))!;
    expect((await w.row("campaign"))?.costMicros).toBe(30_000 + OPUS_RESERVE);
    await w.t.run((ctx) => settle(ctx, w.scopes("p1"), retry, 50_000));
    expect((await w.row("campaign"))?.costMicros).toBe(80_000);
  });

  it("settles to 0 on an error before any token, and frees the budget", async () => {
    const w = await setup();
    await w.spend("campaign", 50_000_000 - SONNET_RESERVE);
    const reserved = await w.ask("p1");
    expect(await w.askCode("p2")).toBe("LOREKEEPER_CAP_CAMPAIGN");
    await w.t.run((ctx) => settle(ctx, w.scopes("p1"), reserved.micros, 0));
    expect(await w.row("user")).toMatchObject({ questions: 1, costMicros: 0 });
    expect(await w.askCode("p2")).toBe("ok");
  });

  it("settles against the reservation's periods even after midnight, never below 0, and skips missing counters", async () => {
    const w = await setup();
    const reserved = await w.ask("p1");
    await w.t.run((ctx) => settle(ctx, w.scopes("p1"), reserved.micros + 1_000_000, 0));
    expect((await w.row("campaign"))?.costMicros).toBe(0);
    // A counter that expired is not recreated.
    await w.t.run((ctx) => settle(ctx, w.scopes("p1", NEXT_MONTH), 10, 1_000));
    expect(await w.rows()).toHaveLength(3);
  });
});

describe("lorekeeperUsage.mine", () => {
  useAllowlist(EMAILS);

  it("shows the caller's own questions left today and the budgets as booleans", async () => {
    const w = await setup();
    expect(await mine(w, "p1")).toEqual({ questionsLeft: 40, campaignCapReached: false, deploymentCapReached: false });
    await w.ask("p1");
    await w.ask("p1");
    await w.ask("p2");
    expect(await mine(w, "p1")).toEqual({ questionsLeft: 38, campaignCapReached: false, deploymentCapReached: false });
    // Never another user's numbers: p2 and the GM see their own counts.
    expect((await mine(w, "p2")).questionsLeft).toBe(39);
    expect((await mine(w, "gm")).questionsLeft).toBe(40);
    // The client's coarse day: tomorrow is a fresh allowance.
    expect((await mine(w, "p1", "2026-10-22")).questionsLeft).toBe(40);
  });

  it("matches what reserve would refuse", async () => {
    const w = await setup();
    await w.spend("campaign", 50_000_000 - SONNET_RESERVE + 1);
    expect(await mine(w, "p2")).toMatchObject({ campaignCapReached: true, deploymentCapReached: false });
    process.env.LOREKEEPER_MONTHLY_USD = "0";
    expect(await mine(w, "p2")).toMatchObject({ deploymentCapReached: true });
    process.env.LOREKEEPER_DAILY_QUESTIONS = "0";
    expect((await mine(w, "p2")).questionsLeft).toBe(0);
  });

  it("returns the remaining allowance through the helper as well", async () => {
    const w = await setup();
    await w.ask("gm");
    const left = await w.t.run(async (ctx) => {
      const user = (await ctx.db.get("users", w.ids.gm))!;
      const campaign = (await ctx.db.get("campaigns", w.campaignId))!;
      return remaining(ctx, user, campaign, usageDay(NOW), usageMonth(NOW));
    });
    expect(left.questionsLeft).toBe(39);
  });

  it("rejects a malformed day or month with INVALID", async () => {
    const w = await setup();
    for (const [day, month] of [
      ["21-10-2026", "2026-10"],
      ["2026-10-21", "2026-13"],
      ["2026-11-01", "2026-10"],
    ]) {
      expect(await mine(w, "p1", day, month).then(() => "ok", errorCode)).toBe("INVALID");
    }
  });

  it("refuses outsiders with NOT_FOUND and signed-out callers with UNAUTHENTICATED", async () => {
    const w = await setup();
    const outsiderId = await w.t.run((ctx) => ctx.db.insert("users", { email: "out@example.com" }));
    const outsider = w.t.withIdentity({ subject: `${outsiderId}|s` });
    const args = { campaignId: w.campaignId, day: usageDay(NOW), month: usageMonth(NOW) };
    expect(await outsider.query(api.lorekeeperUsage.mine, args).then(() => "ok", errorCode)).toBe("NOT_FOUND");
    expect(await w.t.query(api.lorekeeperUsage.mine, args).then(() => "ok", errorCode)).toBe("UNAUTHENTICATED");
  });
});
