import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { hideFearNumbers } from "../../convex/feed";
import { HIDDEN_FEAR_TITLE } from "../../convex/journalLog";
import { key } from "./helpers";
import { buildWorld, type World } from "./authz/world";

/**
 * Config R1 (plan `.omc/plans/config.yaml`; user Q3 changed 2026-11-04): with "Players see the GM's Fear" off, no read
 * sends a player the GM's Fear pool or a Fear change. The GM (creator) and a co-GM always get the numbers; with the
 * switch on (the book's default) players get them too. "Rolled with Fear" on a roll is the die, not the pool: it stays.
 */

const NOW = new Date("2026-11-04T19:00:00Z").getTime();
const POOL = 7;
const SUMMARY = "Short rest: GM gains 3 Fear (1d4 3)";
const ROLL_SUMMARY = "Agility 14 with Fear";
type Viewer = "gm" | "coGm" | "player";
const VIEWERS: readonly Viewer[] = ["gm", "coGm", "player"];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** A world with Fear at POOL, a live session holding a Fear history row, a rest row (+3 Fear) and a roll with Fear. */
async function setup() {
  const w = await buildWorld();
  const gm = w.as("gm");
  vi.setSystemTime(NOW - 60_000);
  await gm.mutation(api.fear.set, { campaignId: w.campaignId, value: POOL - 3, idempotencyKey: key() });
  vi.setSystemTime(NOW);
  const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId: w.campaignId, idempotencyKey: key() });
  await gm.mutation(api.sessions.start, { campaignId: w.campaignId, sessionId, idempotencyKey: key() });
  vi.setSystemTime(NOW + 60_000);
  await gm.mutation(api.fear.set, { campaignId: w.campaignId, value: POOL, idempotencyKey: key() });
  await w.t.run(async (ctx) => {
    await ctx.db.insert("actionLog", { campaignId: w.campaignId, actorId: w.users.gm, kind: "rest", visibility: "public", summary: SUMMARY, fearDelta: 3, undoable: false, at: NOW + 61_000 });
    await ctx.db.insert("actionLog", { campaignId: w.campaignId, actorId: w.users.player, characterId: w.characterA, kind: "feature", visibility: "public", summary: ROLL_SUMMARY, undoable: false, at: NOW + 62_000 });
  });
  vi.setSystemTime(NOW + 120_000);
  return { w, sessionId };
}

async function setPlayersSeeFear(w: World, value: boolean) {
  await w.as("gm").mutation(api.campaignSettings.set, { campaignId: w.campaignId, change: { key: "playersSeeFear", value } });
}

/** Every Fear read a member makes, as one object. */
async function reads(w: World, sessionId: string, viewer: Viewer) {
  const c = w.as(viewer);
  const campaignId = w.campaignId;
  const listed = (await c.query(api.campaigns.list, {})).find((x) => x._id === campaignId);
  const feed = await c.query(api.feed.list, { campaignId, paginationOpts: { numItems: 20, cursor: null } });
  return {
    fear: await c.query(api.campaigns.fear, { campaignId }),
    scene: (await c.query(api.combatHud.scene, { campaignId })).fear,
    list: listed?.fear,
    feed: feed.page,
    log: (await c.query(api.journalLog.list, { campaignId, sessionId })).lines,
  };
}

describe("Players see the GM's Fear (config R1)", () => {
  it("on (the default): every member gets the pool, the Fear change and its numbers", async () => {
    const { w, sessionId } = await setup();
    for (const viewer of VIEWERS) {
      const r = await reads(w, sessionId, viewer);
      expect(r, viewer).toMatchObject({ fear: POOL, scene: POOL, list: POOL });
      expect(r.feed.find((row) => row.kind === "rest")).toMatchObject({ summary: SUMMARY, fearDelta: 3 });
      expect(r.log.find((l) => l.source === "fear")).toMatchObject({ title: `Fear ${POOL - 3} → ${POOL}` });
    }
  });

  it("off: the GM and a co-GM still get every number", async () => {
    const { w, sessionId } = await setup();
    await setPlayersSeeFear(w, false);
    for (const viewer of ["gm", "coGm"] as const) {
      const r = await reads(w, sessionId, viewer);
      expect(r, viewer).toMatchObject({ fear: POOL, scene: POOL, list: POOL });
      expect(r.feed.find((row) => row.kind === "rest")).toMatchObject({ summary: SUMMARY, fearDelta: 3 });
      expect(r.log.find((l) => l.source === "fear")).toMatchObject({ title: `Fear ${POOL - 3} → ${POOL}` });
    }
  });

  it("off: a player gets null for the pool and no Fear numbers anywhere; 'with Fear' on a roll stays", async () => {
    const { w, sessionId } = await setup();
    await setPlayersSeeFear(w, false);
    const r = await reads(w, sessionId, "player");
    expect(r).toMatchObject({ fear: null, scene: null, list: null });
    const rest = r.feed.find((row) => row.kind === "rest")!;
    expect(rest.summary).toBe("Short rest: GM gains Fear");
    expect(rest).not.toHaveProperty("fearDelta");
    expect(r.feed.find((row) => row.kind === "feature")?.summary).toBe(ROLL_SUMMARY);
    const fearLine = r.log.find((l) => l.source === "fear")!;
    expect(fearLine.title).toBe(HIDDEN_FEAR_TITLE);
    expect(fearLine).not.toHaveProperty("sub");
    expect(r.log.find((l) => l.source === "feed" && l.title.startsWith("Short rest"))?.title).toBe("Short rest: GM gains Fear");

    // The leak check: no number sits next to "Fear" in anything the player received, and the pool's value is nowhere
    // as a fear field.
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/\d+ Fear|Fear \d+ →/);
    expect(text).not.toMatch(/"fear(Delta)?":\s*\d/);
  });

  it("turning it back on gives the player the numbers again (no reload: the same reads)", async () => {
    const { w, sessionId } = await setup();
    await setPlayersSeeFear(w, false);
    expect((await reads(w, sessionId, "player")).fear).toBeNull();
    await setPlayersSeeFear(w, true);
    expect(await reads(w, sessionId, "player")).toMatchObject({ fear: POOL, scene: POOL, list: POOL });
  });
});

describe("hideFearNumbers", () => {
  it.each([
    ["Short rest: GM gains 2 Fear (1d4 2)", "Short rest: GM gains Fear"],
    ["Long rest: GM gains 5 Fear (1d4 3 + 2 PCs); Clock ticks", "Long rest: GM gains Fear; Clock ticks"],
    ["Spent 1 Fear: Collapse (Cave)", "Spent Fear: Collapse (Cave)"],
    ["Session ended; 3 Wither → +2 Fear (1 Fear lost)", "Session ended; 3 Wither → Fear (Fear lost)"],
    ["Fear 3 → 5", "Fear changed"],
    ["Vex: Tag Team result 14, Success with Fear; GM gains 1 Fear", "Vex: Tag Team result 14, Success with Fear; GM gains Fear"],
  ])("%s", (input, output) => expect(hideFearNumbers(input)).toBe(output));

  it("keeps the dice: 'with Fear', the Fear Die and a Hope / Fear pair", () => {
    for (const keep of ["Agility 14 with Fear", "Mira: Wither token (Shade); Fear Die 4 vs 2: no gain", "Vex risks it all: Hope 5, Fear 3. "]) {
      expect(hideFearNumbers(keep)).toBe(keep);
    }
  });
});
