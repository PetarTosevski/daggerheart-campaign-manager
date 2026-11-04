import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { deleteSessionRows, liveWindows } from "../../convex/lib/sessions";
import { appError } from "../../src/lib/errors/app-error";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Journal J0 (plan .omc/plans/journal.yaml): the widened session shapes, the start / end stamps' `event`, the played
// time End adds up (Q3), the live windows of a restarted session (D10 B7), and the new error codes.

const EMAILS = "gm@example.com,p1@example.com";
const NOW = new Date("2026-11-02T19:10:00Z").getTime();
const MIN = 60_000;

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Journal", idempotencyKey: key() });
  const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
  const start = () => gm.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: key() });
  const end = () => gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  const session = () => t.run(async (ctx) => (await ctx.db.get("sessions", sessionId))!);
  const windows = () => t.run(async (ctx) => liveWindows(ctx, (await ctx.db.get("sessions", sessionId))!, Date.now()));
  return { t, gm, ids, campaignId, sessionId, start, end, session, windows };
}

describe("journal foundation", () => {
  useAllowlist(EMAILS);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Start / End stamp the log with event 'start' / 'end'; End adds each window to playedMs", async () => {
    const env = await setup();
    await env.start();
    vi.setSystemTime(NOW + 90 * MIN);
    await env.end();
    expect((await env.session()).playedMs).toBe(90 * MIN);

    // B7: started again later; the second window adds to the first.
    vi.setSystemTime(NOW + 24 * 60 * MIN);
    await env.start();
    vi.setSystemTime(NOW + 24 * 60 * MIN + 30 * MIN);
    await env.end();
    expect((await env.session()).playedMs).toBe(120 * MIN);

    const log = await env.t.run((ctx) =>
      ctx.db
        .query("sessionLog")
        .withIndex("by_session_at", (q) => q.eq("sessionId", env.sessionId))
        .collect(),
    );
    expect(log.map((l) => [l.event, l.auto, l.at - NOW])).toEqual([
      ["start", true, 0],
      ["end", true, 90 * MIN],
      ["start", true, 24 * 60 * MIN],
      ["end", true, 24 * 60 * MIN + 30 * MIN],
    ]);
  });

  it("liveWindows returns every window of a restarted session, the running one open until now", async () => {
    const env = await setup();
    expect(await env.windows()).toEqual([]);
    await env.start();
    vi.setSystemTime(NOW + 60 * MIN);
    await env.end();
    vi.setSystemTime(NOW + 120 * MIN);
    await env.start();
    vi.setSystemTime(NOW + 150 * MIN);
    expect(await env.windows()).toEqual([
      { from: NOW, to: NOW + 60 * MIN, open: false },
      { from: NOW + 120 * MIN, to: NOW + 150 * MIN, open: true },
    ]);
  });

  it("liveWindows matches legacy stamps by text (auto lines only) and falls back to startedAt / endedAt", async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      const base = { campaignId: env.campaignId, sessionId: env.sessionId, by: env.ids.gm };
      await ctx.db.insert("sessionLog", { ...base, at: NOW, text: "Session started.", auto: true });
      // A GM-typed line with the same words is not a mark.
      await ctx.db.insert("sessionLog", { ...base, at: NOW + 10 * MIN, text: "Session ended early for snacks", auto: false });
      await ctx.db.insert("sessionLog", { ...base, at: NOW + 40 * MIN, text: "Session ended. Ash lost 2 unspent dice.", auto: true });
      await ctx.db.patch("sessions", env.sessionId, { status: "played", startedAt: NOW + 60 * MIN, endedAt: NOW + 80 * MIN });
    });
    // The legacy window, plus the latest start (no stamp) closed at endedAt.
    expect(await env.windows()).toEqual([
      { from: NOW, to: NOW + 40 * MIN, open: false },
      { from: NOW + 60 * MIN, to: NOW + 80 * MIN, open: false },
    ]);

    // Without any stamp: [startedAt, endedAt].
    const bare = await env.t.run(async (ctx) => {
      const id = await ctx.db.insert("sessions", { campaignId: env.campaignId, n: 9, status: "played", startedAt: NOW, endedAt: NOW + 5 * MIN, createdAt: NOW, updatedAt: NOW });
      return liveWindows(ctx, (await ctx.db.get("sessions", id))!, NOW + 99 * MIN);
    });
    expect(bare).toEqual([{ from: NOW, to: NOW + 5 * MIN, open: false }]);
  });

  it("stores the widened scene, session and log fields", async () => {
    const env = await setup();
    const encounterId = await env.t.run(async (ctx) => {
      const id = await ctx.db.insert("encounters", { campaignId: env.campaignId, name: "Ambush at the Forest Camp", status: "draft", pcs: 4, adjustments: [], gmTurn: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("sessionPrep", {
        campaignId: env.campaignId,
        sessionId: env.sessionId,
        scenes: [{ id: "s1", type: "combat", text: "Ambush", title: "Ambush at the Forest Camp", state: "playing", encounterId: id }],
        updatedAt: NOW,
      });
      await ctx.db.insert("sessionLog", {
        campaignId: env.campaignId,
        sessionId: env.sessionId,
        at: NOW,
        text: "Scene 1 began · The old road north",
        by: env.ids.gm,
        auto: true,
        event: "scene",
        editedAt: NOW,
      });
      return id;
    });
    const prep = await env.t.run((ctx) =>
      ctx.db
        .query("sessionPrep")
        .withIndex("by_session", (q) => q.eq("sessionId", env.sessionId))
        .unique(),
    );
    expect(prep!.scenes[0]).toMatchObject({ title: "Ambush at the Forest Camp", state: "playing", encounterId });
    // A 'scene' line is not a window mark.
    expect(await env.windows()).toEqual([]);
  });

  it("deleting the session deletes its overrides and per-PC stats", async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      const characterId = await ctx.db.insert("characters", { campaignId: env.campaignId, ownerId: env.ids.gm, createdBy: env.ids.gm, status: "active", sheet: {}, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("sessionLogOverrides", { campaignId: env.campaignId, sessionId: env.sessionId, source: "feed", sourceId: "x", hidden: true, updatedAt: NOW });
      await ctx.db.insert("sessionCharacterStats", { campaignId: env.campaignId, sessionId: env.sessionId, characterId, hopeSpent: 1, hpMarked: 2 });
    });
    expect(await env.t.run((ctx) => deleteSessionRows(ctx, env.sessionId))).toBe(2);
    const left = await env.t.run(async (ctx) => ({
      overrides: await ctx.db.query("sessionLogOverrides").collect(),
      stats: await ctx.db.query("sessionCharacterStats").collect(),
    }));
    expect(left).toEqual({ overrides: [], stats: [] });
  });

  it("the new error codes carry their code", () => {
    for (const code of ["SESSION_LOG_SOURCE_NOT_FOUND", "SESSION_LOG_OVERRIDE_LIMIT", "SESSION_SCENE_STATE"] as const) {
      expect(errorCode(appError(code))).toBe(code);
    }
  });
});
