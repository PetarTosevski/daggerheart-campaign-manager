import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { HIDDEN_FEAR_TITLE } from "../../convex/journalLog";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Config JO2: 'Write the session log from the Combat Map' (tableSettings.autoSessionLog, default on). Off, the
// Journal's session log reads only the session's own lines (start / end / scene stamps, the GM's typed lines); the
// feed, Fear and encounter sources are skipped, nothing is deleted, and turning it on again shows them as before.

const EMAILS = "gm@example.com,p1@example.com";
const NOW = new Date("2026-11-04T19:10:00Z").getTime();
const MIN = 60_000;

async function played() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const p1 = t.withIdentity({ subject: `${ids.p1}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Switch", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });

  await gm.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: key() });
  const feedRow = await t.run((ctx) =>
    ctx.db.insert("actionLog", { campaignId, actorId: ids.gm, kind: "feature", visibility: "public", undoable: false, at: NOW + 1 * MIN, summary: "Brannoc: Mark a Stress" }),
  );
  const fearRow = await t.run((ctx) =>
    ctx.db.insert("history", { campaignId, kind: "fear", action: "spend", by: ids.gm, before: 4, after: 3, at: NOW + 2 * MIN }),
  );
  await t.run((ctx) =>
    ctx.db.insert("encounters", {
      campaignId,
      name: "Ambush",
      status: "ended",
      pcs: 2,
      adjustments: [],
      gmTurn: 1,
      createdAt: NOW,
      updatedAt: NOW,
      startedAt: NOW + 3 * MIN,
      endedAt: NOW + 4 * MIN,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("sessionLog", { campaignId, sessionId, at: NOW + 5 * MIN, text: "Scene 2 began: The bridge", by: ids.gm, auto: true, event: "scene" }),
  );
  vi.setSystemTime(NOW + 6 * MIN);
  await gm.mutation(api.sessionPlay.addLog, { campaignId, sessionId, text: "The bridge is out.", idempotencyKey: key() });
  vi.setSystemTime(NOW + 10 * MIN);
  await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });

  const list = (who = gm) => who.query(api.journalLog.list, { campaignId, sessionId });
  const setSwitch = (value: boolean) => gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "autoSessionLog", value } });
  const setFear = (value: boolean) => gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "playersSeeFear", value } });
  return { t, gm, p1, campaignId, sessionId, feedRow, fearRow, list, setSwitch, setFear };
}

const shape = (lines: { source: string; icon: string; title: string }[]) => lines.map((l) => [l.source, l.icon, l.title]);

describe("journalLog.list: autoSessionLog switch (config JO2)", () => {
  useAllowlist(EMAILS);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("on by default: the feed, Fear and encounter lines are in the log", async () => {
    const env = await played();
    const sources = new Set((await env.list()).lines.map((l) => l.source));
    expect(sources).toEqual(new Set(["auto", "gm", "feed", "fear", "encounter"]));
  });

  it("off: only the session's own lines (start, scene, GM line, end) for the GM and players", async () => {
    const env = await played();
    await env.setSwitch(false);
    const expected = [
      ["auto", "start", "Session started."],
      ["auto", "scene", "Scene 2 began: The bridge"],
      ["gm", "note", "The bridge is out."],
      ["auto", "end", expect.stringMatching(/^Session ended/)],
    ];
    const gmLog = await env.list();
    expect(shape(gmLog.lines)).toEqual(expected);
    expect(gmLog.truncated).toBe(false);
    expect(shape((await env.list(env.p1)).lines)).toEqual(expected);
  });

  it("nothing is deleted: turning it on again shows the same lines, overrides included", async () => {
    const env = await played();
    const { gm, campaignId, sessionId } = env;
    await gm.mutation(api.journalLog.setText, { campaignId, sessionId, source: "feed", sourceId: env.feedRow, text: "Brannoc grits his teeth" });
    const before = await env.list();

    await env.setSwitch(false);
    expect((await env.list()).lines.some((l) => l.source === "feed" || l.source === "fear" || l.source === "encounter")).toBe(false);
    const counts = await env.t.run(async (ctx) => ({
      feed: await ctx.db.get("actionLog", env.feedRow),
      fear: await ctx.db.get("history", env.fearRow),
      overrides: (await ctx.db.query("sessionLogOverrides").collect()).length,
    }));
    expect(counts.feed).not.toBeNull();
    expect(counts.fear).not.toBeNull();
    expect(counts.overrides).toBe(1);

    await env.setSwitch(true);
    expect(await env.list()).toEqual(before);
    expect(before.lines.find((l) => l.sourceId === env.feedRow)!.title).toBe("Brannoc grits his teeth");
  });

  it("the Fear scrubbing for players still applies with the switch on (R1)", async () => {
    const env = await played();
    await env.setFear(false);
    const playerFear = (await env.list(env.p1)).lines.find((l) => l.source === "fear")!;
    expect([playerFear.title, playerFear.sub]).toEqual([HIDDEN_FEAR_TITLE, undefined]);
    const gmFear = (await env.list()).lines.find((l) => l.source === "fear")!;
    expect([gmFear.title, gmFear.sub]).toEqual(["The GM spent 1 Fear", "Fear 4 → 3"]);
  });
});
