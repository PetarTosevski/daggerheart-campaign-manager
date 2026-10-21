import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import crons from "../../convex/crons";
import { BATCH, STALE_RUN_MS, USAGE_TTL_MS } from "../../convex/lorekeeperRetention";
import { GM_EMAIL, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D13 L0: the Lorekeeper's retention jobs. Usage counters expire after 13 months; answers stuck in pending or
// streaming end as errors. Conversations are never expired (Q10).

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date("2026-10-21T12:00:00Z").getTime();

type Test = ReturnType<typeof makeTest>;

async function seedConversation(t: Test) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: GM_EMAIL, emailVerificationTime: 1 });
    const campaignId = await ctx.db.insert("campaigns", {
      ownerId: userId,
      frameId: "witherwild",
      name: "Lore",
      nameKey: "lore",
      tier: 1,
      level: 1,
      createdAt: NOW,
      lastOpenedAt: NOW,
    });
    const conversationId = await ctx.db.insert("lorekeeperConversations", {
      campaignId,
      userId,
      title: "Old question",
      visibility: "private",
      webSearch: false,
      messageCount: 0,
      lastAt: NOW - 400 * DAY,
      createdAt: NOW - 400 * DAY,
    });
    return { userId, campaignId, conversationId };
  });
}

describe("lorekeeper retention", () => {
  useAllowlist();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules both jobs at odd minutes and no job for conversations", () => {
    const jobs = (crons as unknown as { crons: Record<string, { schedule: { type: string; cron?: string } }> }).crons;
    expect(jobs["expire lorekeeper usage"]?.schedule).toEqual({ type: "cron", cron: "47 4 * * *" });
    expect(jobs["end stuck lorekeeper answers"]?.schedule).toEqual({ type: "cron", cron: "29 * * * *" });
    expect(Object.keys(jobs).filter((name) => /conversation/i.test(name))).toEqual([]);
  });

  it("deletes usage counters older than 13 months in batches, rescheduling itself, and keeps newer ones", async () => {
    const t = makeTest();
    const { userId, campaignId } = await seedConversation(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 25; i++) {
        await ctx.db.insert("lorekeeperUsage", { kind: "user", userId, period: `2025-0${(i % 9) + 1}-01`, questions: 1, costMicros: 1, updatedAt: NOW - USAGE_TTL_MS - DAY - i });
      }
      await ctx.db.insert("lorekeeperUsage", { kind: "campaign", campaignId, period: "2025-10", questions: 9, costMicros: 9, updatedAt: NOW - USAGE_TTL_MS + DAY });
      await ctx.db.insert("lorekeeperUsage", { kind: "deployment", period: "2026-10", questions: 9, costMicros: 9, updatedAt: NOW });
    });

    await t.mutation(internal.lorekeeperRetention.expireUsage, {});
    // One run deletes one batch and reschedules itself for the rest.
    expect(await t.run(async (ctx) => (await ctx.db.query("lorekeeperUsage").collect()).length)).toBe(27);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await t.run((ctx) => ctx.db.query("lorekeeperUsage").collect());
    expect(left.map((row) => row.kind).sort()).toEqual(["campaign", "deployment"]);
  });

  it("ends answers stuck in pending or streaming as LOREKEEPER_TIMEOUT, keeps their text and never deletes conversations", async () => {
    const t = makeTest();
    const { userId, campaignId, conversationId } = await seedConversation(t);
    const ids = await t.run(async (ctx) => {
      const base = { conversationId, campaignId, userId, role: "answer" as const, createdAt: NOW - DAY };
      const reserved = { micros: 80_000, day: "2026-10-21", month: "2026-10" };
      const insert = (status: "pending" | "streaming" | "done" | "error", age: number, text = "") =>
        ctx.db.insert("lorekeeperMessages", { ...base, status, text, reserved, updatedAt: NOW - age });
      return {
        stuckPending: await insert("pending", STALE_RUN_MS + MINUTE),
        stuckStreaming: await insert("streaming", STALE_RUN_MS + MINUTE, "Half an answ"),
        freshStreaming: await insert("streaming", STALE_RUN_MS - MINUTE, "Still going"),
        oldDone: await insert("done", 300 * DAY, "An old answer"),
      };
    });

    await t.mutation(internal.lorekeeperRetention.expireStaleRuns, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await t.run(async (ctx) => {
      const get = (id: Id<"lorekeeperMessages">) => ctx.db.get("lorekeeperMessages", id);
      return {
        stuckPending: await get(ids.stuckPending),
        stuckStreaming: await get(ids.stuckStreaming),
        freshStreaming: await get(ids.freshStreaming),
        oldDone: await get(ids.oldDone),
        conversation: await ctx.db.get("lorekeeperConversations", conversationId),
      };
    });
    expect(rows.stuckPending).toMatchObject({ status: "error", errorCode: "LOREKEEPER_TIMEOUT", updatedAt: NOW });
    expect(rows.stuckStreaming).toMatchObject({ status: "error", errorCode: "LOREKEEPER_TIMEOUT", text: "Half an answ" });
    expect(rows.freshStreaming).toMatchObject({ status: "streaming", text: "Still going" });
    expect(rows.oldDone).toMatchObject({ status: "done", text: "An old answer" });
    // Q10: a conversation idle for over a year is kept.
    expect(rows.conversation).not.toBeNull();
  });

  it("handles a backlog of stuck answers over several runs", async () => {
    const t = makeTest();
    const { userId, campaignId, conversationId } = await seedConversation(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 10; i++) {
        await ctx.db.insert("lorekeeperMessages", {
          conversationId,
          campaignId,
          userId,
          role: "answer",
          status: i % 2 ? "pending" : "streaming",
          text: "",
          createdAt: NOW - DAY,
          updatedAt: NOW - STALE_RUN_MS - MINUTE - i,
        });
      }
    });
    await t.mutation(internal.lorekeeperRetention.expireStaleRuns, {});
    const afterOne = await t.run(async (ctx) => (await ctx.db.query("lorekeeperMessages").withIndex("by_status_updated", (q) => q.eq("status", "error")).collect()).length);
    expect(afterOne).toBe(BATCH);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const errors = await t.run(async (ctx) => (await ctx.db.query("lorekeeperMessages").withIndex("by_status_updated", (q) => q.eq("status", "error")).collect()).length);
    expect(errors).toBe(BATCH + 10);
  });
});
