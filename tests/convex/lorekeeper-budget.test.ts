import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { capLimits, remaining, reserve, reservePass, UNCAPPED_LEFT, usageDay, usageMonth, type UsageScopes } from "../../convex/lib/lorekeeper/caps";
import type { ReservationMode } from "../../convex/lib/validators/lorekeeper";
import { PRIMARY_MODEL, reserveMicros, RETRY_MODEL, SHORT_MAX_TOKENS } from "../../src/lib/lorekeeper/pricing";
import { sseResponse } from "../fixtures/lorekeeper/sse";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Config AD6: the Lorekeeper budget from the admin. capLimits reads the owner's settings over the env vars and the
// defaults, then the campaign's own numbers; at the monthly limit the owner's atLimit pauses, answers GMs only or gives
// shorter answers (both up to 120%); the web pass counts against the daily internet searches; the owner is never
// capped; adminLorekeeper.setLimit / useByCampaign are owner-only.

vi.mock("../../convex/lib/lorekeeper/retrieve", () => ({ retrieve: async () => [] }));

const NOW = new Date("2026-10-21T12:00:00Z").getTime();
const MONTH = usageMonth(NOW);
const SONNET_RESERVE = reserveMicros(PRIMARY_MODEL); // 70_000
const SHORT_RESERVE = reserveMicros(PRIMARY_MODEL, SHORT_MAX_TOKENS); // 60_000
const OPUS_RESERVE = reserveMicros(RETRY_MODEL);
const ENV_NAMES = ["LOREKEEPER_DAILY_QUESTIONS", "LOREKEEPER_CAMPAIGN_MONTHLY_USD", "LOREKEEPER_MONTHLY_USD", "LOREKEEPER_MODEL", "ANTHROPIC_MODEL", "ANTHROPIC_API_KEY"];
const EMAILS = "owner@example.com,gm@example.com,co@example.com,p1@example.com,out@example.com";

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

type Who = "owner" | "gm" | "co" | "p1";

/** The app owner (verified, named by setOwner), a campaign with its GM, a co-GM and a player. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    co: await ctx.db.insert("users", { email: "co@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  const callers = { owner: as(ids.owner), gm: as(ids.gm), co: as(ids.co), p1: as(ids.p1) };
  const { campaignId } = await callers.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Lore", idempotencyKey: key() });
  const code = await callers.gm.mutation(api.members.rotateJoinCode, { campaignId });
  await callers.co.mutation(api.members.joinByCode, { code });
  await callers.p1.mutation(api.members.joinByCode, { code });
  await callers.gm.mutation(api.members.setCoGm, { campaignId, userId: ids.co, coGm: true });

  const ask = (who: Who, now = NOW) =>
    t.run(async (ctx) => {
      const user = (await ctx.db.get("users", ids[who]))!;
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      return reserve(ctx, user, campaign, PRIMARY_MODEL, now);
    });
  const askCode = (who: Who) => ask(who).then((r) => r.mode ?? "ok", errorCode);
  const scopes = (who: Who): UsageScopes => ({ userId: ids[who], campaignId, day: usageDay(NOW), month: MONTH });
  const pass = (who: Who, opts: { web?: boolean; mode?: ReservationMode; model?: string } = {}) =>
    t.run((ctx) =>
      reservePass(ctx, scopes(who), opts.model ?? (opts.web ? PRIMARY_MODEL : RETRY_MODEL), NOW, {
        ...(opts.web ? { webSearches: 3 } : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
      }),
    );
  const left = (who: Who) =>
    t.run(async (ctx) => {
      const user = (await ctx.db.get("users", ids[who]))!;
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      return remaining(ctx, user, campaign, usageDay(NOW), MONTH);
    });
  const userRow = (who: Who) =>
    t.run((ctx) =>
      ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_user_period", (q) => q.eq("userId", ids[who]).eq("period", usageDay(NOW)))
        .first(),
    );
  /** Adds to a month's deployment spend (one counter row per month, as the meter keeps it). */
  const spend = (micros: number, month = MONTH) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "deployment").eq("period", month))
        .first();
      if (row) await ctx.db.patch("lorekeeperUsage", row._id, { costMicros: row.costMicros + micros });
      else await ctx.db.insert("lorekeeperUsage", { kind: "deployment", period: month, questions: 0, costMicros: micros, updatedAt: NOW });
    });
  /** The owner's saved Lorekeeper settings, through the public setter. */
  const set = (change: FunctionArgs<typeof api.adminLorekeeper.setLimit>["change"]) =>
    callers.owner.mutation(api.adminLorekeeper.setLimit, { change });
  /** The owner's per-campaign numbers (AD12 writes these; here straight into the table). */
  const campaignLimits = (numbers: { dailyQuestions?: number; dailyWebSearches?: number }) =>
    t.run((ctx) => ctx.db.insert("lorekeeperCampaignLimits", { campaignId, ...numbers, setBy: ids.owner, updatedAt: NOW }));
  return { t, ids, callers, campaignId, ask, askCode, pass, left, userRow, spend, set, campaignLimits };
}

type World = Awaited<ReturnType<typeof setup>>;

/** The deployment limit at $10 (ceiling $12), with `spent` already booked in `month`. */
async function atLimit(w: World, mode: "pause" | "gmOnly" | "short", spent = 10_000_000, month = MONTH) {
  await w.set({ field: "monthlyUsd", value: 10 });
  await w.set({ field: "atLimit", value: mode });
  await w.spend(spent, month);
}

describe("capLimits: admin settings over env vars and defaults, campaign numbers on top", () => {
  useAllowlist(EMAILS);

  it("takes the owner's saved values over the env vars", async () => {
    const w = await setup();
    process.env.LOREKEEPER_DAILY_QUESTIONS = "5";
    process.env.LOREKEEPER_MONTHLY_USD = "7";
    const limits = () => w.t.run((ctx) => capLimits(ctx, w.campaignId));
    expect(await limits()).toMatchObject({ dailyQuestions: 5, deploymentMonthlyMicros: 7_000_000, dailyWebSearches: 20, atLimit: "pause" });
    await w.set({ field: "dailyQuestions", value: 12 });
    await w.set({ field: "monthlyUsd", value: 99.5 });
    await w.set({ field: "campaignMonthlyUsd", value: 20 });
    await w.set({ field: "dailyWebSearches", value: 4 });
    await w.set({ field: "atLimit", value: "short" });
    expect(await limits()).toEqual({ dailyQuestions: 12, dailyWebSearches: 4, campaignMonthlyMicros: 20_000_000, deploymentMonthlyMicros: 99_500_000, atLimit: "short" });
  });

  it("the campaign's own numbers replace the per-person ones for that campaign only", async () => {
    const w = await setup();
    await w.campaignLimits({ dailyQuestions: 2, dailyWebSearches: 0 });
    expect(await w.t.run((ctx) => capLimits(ctx, w.campaignId))).toMatchObject({ dailyQuestions: 2, dailyWebSearches: 0 });
    await w.ask("p1");
    await w.ask("p1");
    expect(await w.askCode("p1")).toBe("LOREKEEPER_CAP_USER");
    expect(await w.left("p1")).toMatchObject({ questionsLeft: 0, webSearchesLeft: 0 });
  });
});

describe("at the monthly limit", () => {
  useAllowlist(EMAILS);

  it("pause refuses everyone with LOREKEEPER_CAP_DEPLOYMENT, GMs included", async () => {
    const w = await setup();
    await atLimit(w, "pause");
    for (const who of ["p1", "gm", "co"] as const) expect(await w.askCode(who)).toBe("LOREKEEPER_CAP_DEPLOYMENT");
    expect(await w.left("gm")).toMatchObject({ deploymentCapReached: true, shortAnswers: false });
  });

  it("GMs only lets the GM and co-GMs ask up to 120% of the limit; players are refused", async () => {
    const w = await setup();
    await atLimit(w, "gmOnly");
    expect(await w.askCode("p1")).toBe("LOREKEEPER_CAP_DEPLOYMENT");
    expect(await w.askCode("gm")).toBe("gmOnly");
    expect(await w.askCode("co")).toBe("gmOnly");
    expect(await w.left("p1")).toMatchObject({ deploymentCapReached: true });
    expect(await w.left("gm")).toMatchObject({ deploymentCapReached: false, shortAnswers: false });
    // A GM's later passes may use the room up to the ceiling too; a normal answer's may not.
    expect(await w.pass("gm", { mode: "gmOnly" })).toBe(OPUS_RESERVE);
    expect(await w.pass("gm")).toBeNull();
    // Past 1.2 × $10 the Lorekeeper pauses for everyone.
    await w.spend(2_000_000);
    expect(await w.askCode("gm")).toBe("LOREKEEPER_PAUSED");
    expect(await w.left("gm")).toMatchObject({ deploymentCapReached: true });
  });

  it("shorter answers: Sonnet at half length for everyone, no later pass, up to 120%", async () => {
    const w = await setup();
    process.env.LOREKEEPER_MODEL = RETRY_MODEL;
    await atLimit(w, "short");
    const reserved = await w.ask("p1");
    expect(reserved).toMatchObject({ mode: "short", micros: SHORT_RESERVE });
    expect(await w.left("p1")).toMatchObject({ deploymentCapReached: false, shortAnswers: true });
    expect(await w.pass("p1", { mode: "short" })).toBeNull();
    expect(await w.pass("p1", { mode: "short", web: true })).toBeNull();
    await w.spend(2_000_000 - SHORT_RESERVE - SHORT_RESERVE + 1);
    expect(await w.askCode("gm")).toBe("LOREKEEPER_PAUSED");
  });

  it("under the limit nothing changes: no mode, the normal worst case", async () => {
    const w = await setup();
    await w.set({ field: "atLimit", value: "short" });
    expect(await w.ask("p1")).toEqual({ micros: SONNET_RESERVE, day: usageDay(NOW), month: MONTH });
    expect(await w.left("p1")).toMatchObject({ shortAnswers: false, deploymentCapReached: false });
  });

  it("the campaign's monthly budget still refuses first", async () => {
    const w = await setup();
    await atLimit(w, "short");
    await w.set({ field: "campaignMonthlyUsd", value: 0 });
    expect(await w.askCode("gm")).toBe("LOREKEEPER_CAP_CAMPAIGN");
    expect(await w.left("gm")).toMatchObject({ campaignCapReached: true, shortAnswers: false });
  });
});

describe("the app owner is never capped", () => {
  useAllowlist(EMAILS);

  it("asks past every limit, still counted and booked", async () => {
    const w = await setup();
    await atLimit(w, "pause", 50_000_000);
    await w.set({ field: "dailyQuestions", value: 0 });
    await w.set({ field: "dailyWebSearches", value: 0 });
    await w.set({ field: "campaignMonthlyUsd", value: 0 });
    expect(await w.ask("owner")).toMatchObject({ mode: "owner", micros: SONNET_RESERVE });
    expect(await w.pass("owner", { mode: "owner" })).toBe(OPUS_RESERVE);
    expect(await w.pass("owner", { mode: "owner", web: true })).not.toBeNull();
    expect(await w.userRow("owner")).toMatchObject({ questions: 1, webSearches: 1 });
    expect(await w.left("owner")).toEqual({
      questionsLeft: UNCAPPED_LEFT,
      webSearchesLeft: UNCAPPED_LEFT,
      campaignCapReached: false,
      deploymentCapReached: false,
      shortAnswers: false,
    });
    // Everyone else is refused.
    expect(await w.askCode("gm")).toBe("LOREKEEPER_CAP_USER");
  });

  it("an owner whose email is no longer verified is capped like anyone", async () => {
    const w = await setup();
    await w.t.run((ctx) => ctx.db.patch("users", w.ids.owner, { emailVerificationTime: undefined }));
    process.env.LOREKEEPER_DAILY_QUESTIONS = "0";
    expect(await w.askCode("owner")).toBe("LOREKEEPER_CAP_USER");
  });
});

describe("daily internet searches", () => {
  useAllowlist(EMAILS);

  it("the web pass books one search on the asker's day row and is refused past the daily number", async () => {
    const w = await setup();
    await w.set({ field: "dailyWebSearches", value: 2 });
    await w.ask("p1");
    expect(await w.pass("p1", { web: true })).not.toBeNull();
    expect(await w.left("p1")).toMatchObject({ webSearchesLeft: 1 });
    expect(await w.pass("p1", { web: true })).not.toBeNull();
    expect(await w.userRow("p1")).toMatchObject({ webSearches: 2 });
    const before = await w.userRow("p1");
    expect(await w.pass("p1", { web: true })).toBeNull();
    expect(await w.userRow("p1")).toMatchObject({ webSearches: 2, costMicros: before!.costMicros });
    // The Opus retry is not a search.
    expect(await w.pass("p1")).toBe(OPUS_RESERVE);
    // Per person: the GM still searches.
    await w.ask("gm");
    expect(await w.pass("gm", { web: true })).not.toBeNull();
  });
});

describe("lorekeeperUsage.mine (the caller's own allowance)", () => {
  useAllowlist(EMAILS);

  it("answers GMs only per caller and adds the searches left", async () => {
    const w = await setup();
    await atLimit(w, "gmOnly");
    const args = { campaignId: w.campaignId, day: usageDay(NOW), month: MONTH };
    expect(await w.callers.p1.query(api.lorekeeperUsage.mine, args)).toMatchObject({ deploymentCapReached: true, webSearchesLeft: 20 });
    expect(await w.callers.co.query(api.lorekeeperUsage.mine, args)).toMatchObject({ deploymentCapReached: false });
  });
});

describe("shorter answers in the run", () => {
  useAllowlist(EMAILS);
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-123";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("one Sonnet pass at half the length, no retry and no internet, whatever the verdict", async () => {
    const w = await setup();
    process.env.LOREKEEPER_MODEL = RETRY_MODEL;
    // The ask runs at the real clock: the spend goes into the current month.
    await atLimit(w, "short", 10_000_000, usageMonth(Date.now()));
    const reply = [
      { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: PRIMARY_MODEL, content: [], usage: { input_tokens: 900, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "VERDICT: unclear\nThe books don't settle it.\nGM CALL: Your call." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 30 } },
      { type: "message_stop" },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(reply)));
    // The internet is on for the campaign and the conversation.
    await w.callers.gm.mutation(api.campaignSettings.set, { campaignId: w.campaignId, change: { key: "lorekeeperWeb", value: true } });
    const { answerId } = await w.callers.p1.mutation(api.lorekeeper.ask, { campaignId: w.campaignId, question: "Is flanking a thing?", webSearch: true });
    const row = () => w.t.run((ctx) => ctx.db.get("lorekeeperMessages", answerId));
    const until = Date.now() + 15_000;
    let done = await row();
    while (done !== null && (done.status === "pending" || done.status === "streaming") && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      done = await row();
    }
    expect(done).toMatchObject({ status: "done", reserved: { mode: "short" }, parts: { verdict: "unclear", call: "Your call." } });
    expect(done!.checkedAgain).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as { model: string; max_tokens: number; tools?: unknown };
    expect([body.model, body.max_tokens, body.tools]).toEqual([PRIMARY_MODEL, SHORT_MAX_TOKENS, undefined]);
  });
});

describe("adminLorekeeper.setLimit (owner only)", () => {
  useAllowlist(EMAILS);

  it("saves one field, audited with the effective value before", async () => {
    const w = await setup();
    process.env.LOREKEEPER_MONTHLY_USD = "150";
    await w.set({ field: "monthlyUsd", value: 80.456 });
    await w.set({ field: "allowGmRequests", value: true });
    const settings = await w.callers.owner.query(api.appAdmin.settings, {});
    expect(settings.lorekeeper).toMatchObject({ monthlyUsd: 80.46, allowGmRequests: true });
    const audit = await w.t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").order("asc").take(10));
    expect(audit.filter((a) => a.action === "lorekeeper.set").map((a) => [a.field, a.from, a.to, a.actorId])).toEqual([
      ["monthlyUsd", 150, 80.46, w.ids.owner],
      ["allowGmRequests", false, true, w.ids.owner],
    ]);
  });

  it("refuses bad values with INVALID and changes nothing", async () => {
    const w = await setup();
    for (const change of [
      { field: "monthlyUsd", value: -1 },
      { field: "monthlyUsd", value: 1e9 },
      { field: "dailyQuestions", value: 2.5 },
      { field: "dailyWebSearches", value: Number.NaN },
    ] as const) {
      expect(await w.set(change).then(() => "ok", errorCode)).toBe("INVALID");
    }
    expect(await w.t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").take(10))).toHaveLength(1); // owner.set only
  });

  it("refuses GMs and players with FORBIDDEN, signed out with UNAUTHENTICATED", async () => {
    const w = await setup();
    const change = { field: "atLimit", value: "short" } as const;
    for (const who of ["gm", "co", "p1"] as const) {
      expect(await w.callers[who].mutation(api.adminLorekeeper.setLimit, { change }).then(() => "ok", errorCode)).toBe("FORBIDDEN");
    }
    expect(await w.t.mutation(api.adminLorekeeper.setLimit, { change }).then(() => "ok", errorCode)).toBe("UNAUTHENTICATED");
  });
});

describe("adminLorekeeper.useByCampaign (owner only)", () => {
  useAllowlist(EMAILS);

  it("lists the month's campaigns by spend, with names and the app's total", async () => {
    const w = await setup();
    const { campaignId: second } = await w.callers.p1.mutation(api.campaigns.create, { frameId: "witherwild", name: "Second", idempotencyKey: key() });
    await w.ask("p1");
    await w.ask("gm");
    await w.t.run(async (ctx) => {
      const user = (await ctx.db.get("users", w.ids.p1))!;
      const campaign = (await ctx.db.get("campaigns", second))!;
      await reserve(ctx, user, campaign, RETRY_MODEL, NOW);
      await reserve(ctx, user, campaign, RETRY_MODEL, NOW);
    });
    const use = await w.callers.owner.query(api.adminLorekeeper.useByCampaign, { month: MONTH });
    expect(use.total).toEqual({ questions: 4, costMicros: 2 * SONNET_RESERVE + 2 * OPUS_RESERVE });
    expect(use.campaigns).toEqual([
      { campaignId: second, name: "Second", deleted: false, questions: 2, costMicros: 2 * OPUS_RESERVE },
      { campaignId: w.campaignId, name: "Lore", deleted: false, questions: 2, costMicros: 2 * SONNET_RESERVE },
    ]);
    expect(use.truncated).toBe(false);
    expect((await w.callers.owner.query(api.adminLorekeeper.useByCampaign, { month: "2026-09" })).campaigns).toEqual([]);
  });

  it("refuses a malformed month with INVALID and non-owners with FORBIDDEN", async () => {
    const w = await setup();
    expect(await w.callers.owner.query(api.adminLorekeeper.useByCampaign, { month: "2026-13" }).then(() => "ok", errorCode)).toBe("INVALID");
    expect(await w.callers.gm.query(api.adminLorekeeper.useByCampaign, { month: MONTH }).then(() => "ok", errorCode)).toBe("FORBIDDEN");
  });
});
