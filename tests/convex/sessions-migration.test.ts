import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S3 (Q11, dcm-bxp.48): convex/migrations/sessions.ts backfills the `sessions` table from the pre-D10 'Session
// started' / 'Session ended…' campaign rows of the action log and a running session from campaignState.sessionStartedAt.

const GM = "gm@example.com";
const T0 = Date.UTC(2026, 0, 1, 18, 0, 0);
const HOUR = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("migrations/sessions", () => {
  useAllowlist(GM);

  async function setup() {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Old", idempotencyKey: key() });
    const { campaignId: quiet } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Quiet", idempotencyKey: key() });
    /** Writes a campaign row of the log at `at` (as the pre-D10 code did). */
    const log = (at: number, summary: string, campaign: Id<"campaigns"> = campaignId) =>
      t.run(async (ctx) => {
        vi.setSystemTime(at);
        await logAction(ctx, { campaignId: campaign, actorId: gmId, kind: "session", visibility: "public", summary, undoable: true });
      });
    return { t, gm, gmId, campaignId, quiet, log };
  }
  type Env = Awaited<ReturnType<typeof setup>>;

  /** The pre-D10 history: two whole sessions, an End with nothing running, a scene end, and a session running now. */
  async function history(env: Env) {
    await env.log(T0 + 1 * HOUR, "Session started");
    await env.log(T0 + 2 * HOUR, "Scene ended; 1 scene effect ended");
    await env.log(T0 + 3 * HOUR, "Session ended; 2 Wither → +2 Fear");
    await env.log(T0 + 4 * HOUR, "Session ended");
    await env.log(T0 + 10 * HOUR, "Session started");
    await env.log(T0 + 12 * HOUR, "Session ended");
    // The running session: the old `start` stamped the state a moment before its row.
    await env.t.run(async (ctx) => {
      const state = (await ctx.db
        .query("campaignState")
        .withIndex("by_campaign", (q) => q.eq("campaignId", env.campaignId))
        .unique())!;
      await ctx.db.patch("campaignState", state._id, { sessionStartedAt: T0 + 20 * HOUR });
    });
    await env.log(T0 + 20 * HOUR + 3, "Session started");
  }

  const sessions = (env: Env, campaignId = env.campaignId) =>
    env.t.run(async (ctx) =>
      (
        await ctx.db
          .query("sessions")
          .withIndex("by_campaign_n", (q) => q.eq("campaignId", campaignId))
          .collect()
      ).map((s) => ({ n: s.n, status: s.status, title: s.title, startedAt: s.startedAt, endedAt: s.endedAt })),
    );
  const liveId = (env: Env) =>
    env.t.run(
      async (ctx) =>
        (await ctx.db
          .query("campaignState")
          .withIndex("by_campaign", (q) => q.eq("campaignId", env.campaignId))
          .unique())!.liveSessionId,
    );

  async function migrate(env: Env, reset = false) {
    await env.t.mutation(internal.migrations.sessions.backfillSessions, { batchSize: 2, ...(reset ? { reset } : {}) });
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  const EXPECTED = [
    { n: 1, status: "played", title: undefined, startedAt: T0 + 1 * HOUR, endedAt: T0 + 3 * HOUR },
    { n: 2, status: "played", title: undefined, startedAt: T0 + 10 * HOUR, endedAt: T0 + 12 * HOUR },
    { n: 3, status: "live", title: undefined, startedAt: T0 + 20 * HOUR + 3, endedAt: undefined },
  ];

  it("backfills Played sessions in order from the log and the running one as Live; a second run changes nothing", async () => {
    const env = await setup();
    await history(env);
    await migrate(env);
    expect(await sessions(env)).toEqual(EXPECTED);
    const live = await liveId(env);
    expect(live).toBeDefined();
    expect(await env.gm.query(api.sessions.current, { campaignId: env.campaignId })).toMatchObject({ startedAt: T0 + 20 * HOUR, sessionId: live, n: 3 });
    expect(await sessions(env, env.quiet)).toEqual([]);

    await migrate(env, true);
    expect(await sessions(env)).toEqual(EXPECTED);
    expect(await liveId(env)).toBe(live);
  });

  it("a dry run processes a batch and commits nothing", async () => {
    const env = await setup();
    await history(env);
    const status = await env.t.mutation(internal.migrations.run.run, { fn: "migrations/sessions:backfillFromLog", batchSize: 100, dryRun: true });
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(status).toMatchObject({ processed: expect.any(Number) });
    expect(await sessions(env)).toEqual([]);
    expect((await liveId(env)) ?? null).toBeNull();
  });

  it("a running session with no start row (or a log the step has not reached) is created as Live", async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      const state = (await ctx.db
        .query("campaignState")
        .withIndex("by_campaign", (q) => q.eq("campaignId", env.campaignId))
        .unique())!;
      await ctx.db.patch("campaignState", state._id, { sessionStartedAt: T0 + HOUR });
    });
    await env.t.mutation(internal.migrations.run.run, { fn: "migrations/sessions:backfillLive" });
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await sessions(env)).toEqual([{ n: 1, status: "live", title: undefined, startedAt: T0 + HOUR, endedAt: undefined }]);
    // The log step afterwards does not add the same session again.
    await env.log(T0 + HOUR + 2, "Session started");
    await env.t.mutation(internal.migrations.run.run, { fn: "migrations/sessions:backfillFromLog", reset: true });
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await sessions(env)).toHaveLength(1);
  });

  it("skips the rows the D10 code wrote itself (from the campaign's first session log line on)", async () => {
    const env = await setup();
    await env.log(T0 + HOUR, "Session started");
    await env.log(T0 + 2 * HOUR, "Session ended");
    vi.setSystemTime(T0 + 5 * HOUR);
    // D10: the GM creates Session 2, starts it (stamping its log), ends it, starts it again (B7) and ends it.
    const { sessionId } = await env.gm.mutation(api.sessionRecords.create, { campaignId: env.campaignId, idempotencyKey: key() });
    await env.gm.mutation(api.sessions.start, { campaignId: env.campaignId, sessionId, idempotencyKey: key() });
    vi.setSystemTime(T0 + 6 * HOUR);
    await env.gm.mutation(api.sessions.end, { campaignId: env.campaignId, idempotencyKey: key() });
    vi.setSystemTime(T0 + 7 * HOUR);
    await env.gm.mutation(api.sessions.start, { campaignId: env.campaignId, sessionId, idempotencyKey: key() });
    vi.setSystemTime(T0 + 8 * HOUR);
    await env.gm.mutation(api.sessions.end, { campaignId: env.campaignId, idempotencyKey: key() });

    await migrate(env);
    expect(await sessions(env)).toEqual([
      { n: 1, status: "played", title: undefined, startedAt: T0 + 7 * HOUR, endedAt: T0 + 8 * HOUR },
      { n: 2, status: "played", title: undefined, startedAt: T0 + HOUR, endedAt: T0 + 2 * HOUR },
    ]);
  });
});
