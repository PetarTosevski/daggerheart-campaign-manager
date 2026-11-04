import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_TALLY_FEED_ROWS } from "../../convex/journalTally";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Journal JD3a (plan .omc/plans/journal.yaml): the session tally's six numbers over the session's live windows.

const EMAILS = "gm@example.com";
const NOW = new Date("2026-11-02T19:10:00Z").getTime();
const MIN = 60_000;

const NULL_TALLY = { fearGained: null, fearSpent: null, hopeSpent: null, hpMarked: null, adversariesDefeated: null, criticals: null };

async function setup() {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com" }));
  const gm = t.withIdentity({ subject: `${gmId}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Journal", idempotencyKey: key() });
  const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
  const start = () => gm.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: key() });
  const end = () => gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
  const tally = () => gm.query(api.journalTally.tally, { campaignId, sessionId });

  const fear = (at: number, action: string, before: number, after: number) =>
    t.run((ctx) => ctx.db.insert("history", { campaignId, kind: "fear", action, before, after, at, by: gmId } as never));
  const roll = (at: number, outcome: "critical" | "successHope", extra: { undoneAt?: number; removedAt?: number } = {}) =>
    t.run((ctx) =>
      ctx.db.insert("actionLog", {
        campaignId,
        actorId: gmId,
        kind: "roll",
        visibility: "public",
        summary: "Vex rolled",
        roll: { kind: "action", dice: [], modifier: 0, total: 16, outcome, manual: false },
        undoable: false,
        at,
        ...extra,
      }),
    );
  type Instance = { defeated: boolean; hp?: number; minionCount?: number; hpMax?: number };
  const encounter = (startedAt: number | undefined, instances: Instance[]) =>
    t.run(async (ctx) => {
      const encounterId = await ctx.db.insert("encounters", {
        campaignId,
        name: "Ambush at the Forest Camp",
        status: startedAt === undefined ? "draft" : "ended",
        pcs: 4,
        adjustments: [],
        gmTurn: 1,
        createdAt: NOW,
        updatedAt: NOW,
        ...(startedAt === undefined ? {} : { startedAt }),
      });
      for (const [order, i] of instances.entries()) {
        await ctx.db.insert("encounterAdversaries", {
          campaignId,
          encounterId,
          source: { kind: "srd", adversaryId: "bear" },
          label: `Foe ${order + 1}`,
          order,
          summoned: false,
          ...(i.minionCount === undefined ? {} : { minionCount: i.minionCount }),
          stats: { difficulty: 12, major: null, severe: null, hpMax: i.hpMax ?? 5, stressMax: 1 },
          hp: i.hp ?? 0,
          stress: 0,
          defeated: i.defeated,
          conditions: [],
          tags: [],
          spotlights: 0,
          spotlightTurn: 1,
          updatedAt: NOW,
        });
      }
    });
  const character = (name: string) =>
    t.run((ctx) => ctx.db.insert("characters", { campaignId, ownerId: gmId, createdBy: gmId, status: "active", sheet: { name }, createdAt: NOW, updatedAt: NOW } as never));
  const stats = (characterId: Id<"characters">, hopeSpent: number, hpMarked: number, session: Id<"sessions"> = sessionId) =>
    t.run((ctx) => ctx.db.insert("sessionCharacterStats", { campaignId, sessionId: session, characterId, hopeSpent, hpMarked }));
  return { t, gm, gmId, campaignId, sessionId, start, end, tally, fear, roll, encounter, character, stats };
}

describe("journalTally.tally", () => {
  useAllowlist(EMAILS);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is all null before the session was ever live", async () => {
    const env = await setup();
    expect(await env.tally()).toEqual({ ...NULL_TALLY, live: false, truncated: false });
  });

  it("counts the six numbers of a live session's open window", async () => {
    const env = await setup();
    await env.roll(NOW - 5 * MIN, "critical"); // before the session: not counted
    await env.fear(NOW - 5 * MIN, "gain", 0, 3);
    await env.start();
    await env.fear(NOW + 1 * MIN, "gain", 3, 5);
    await env.fear(NOW + 2 * MIN, "spend", 5, 4);
    await env.roll(NOW + 3 * MIN, "critical");
    await env.roll(NOW + 4 * MIN, "critical", { removedAt: NOW + 5 * MIN }); // removed from the feed: still counts
    await env.roll(NOW + 5 * MIN, "critical", { undoneAt: NOW + 6 * MIN }); // undone: not counted
    await env.roll(NOW + 6 * MIN, "successHope");
    await env.encounter(NOW + 7 * MIN, [
      { defeated: true },
      { defeated: false },
      { defeated: false, minionCount: 6, hpMax: 6, hp: 2 }, // two Minions of six defeated
      { defeated: true, minionCount: 4, hpMax: 4, hp: 4 }, // the whole group
    ]);
    await env.encounter(NOW - 30 * MIN, [{ defeated: true }]); // started before the session
    await env.encounter(undefined, [{ defeated: true }]); // never started
    const moss = await env.character("Moss");
    const vex = await env.character("Vex");
    await env.stats(moss, 2, 3);
    await env.stats(vex, 1, 0);
    vi.setSystemTime(NOW + 10 * MIN);
    expect(await env.tally()).toEqual({
      fearGained: 2,
      fearSpent: 1,
      hopeSpent: 3,
      hpMarked: 3,
      adversariesDefeated: 1 + 2 + 4,
      criticals: 2,
      live: true,
      truncated: false,
    });
  });

  it("counts every window of a restarted session and nothing between them", async () => {
    const env = await setup();
    await env.start();
    await env.fear(NOW + 1 * MIN, "gain", 0, 2);
    await env.roll(NOW + 2 * MIN, "critical");
    await env.encounter(NOW + 3 * MIN, [{ defeated: true }]);
    vi.setSystemTime(NOW + 60 * MIN);
    await env.end();

    // Between the windows: not counted.
    await env.fear(NOW + 90 * MIN, "gain", 2, 6);
    await env.roll(NOW + 90 * MIN, "critical");
    await env.encounter(NOW + 90 * MIN, [{ defeated: true }]);

    vi.setSystemTime(NOW + 120 * MIN);
    await env.start();
    await env.fear(NOW + 121 * MIN, "spend", 6, 3);
    await env.roll(NOW + 122 * MIN, "critical");
    await env.encounter(NOW + 123 * MIN, [{ defeated: true }, { defeated: true }]);
    vi.setSystemTime(NOW + 130 * MIN);
    expect(await env.tally()).toMatchObject({ fearGained: 2, fearSpent: 3, criticals: 2, adversariesDefeated: 3, live: true });

    vi.setSystemTime(NOW + 150 * MIN);
    await env.end();
    expect(await env.tally()).toMatchObject({ fearGained: 2, fearSpent: 3, criticals: 2, adversariesDefeated: 3, live: false, truncated: false });
  });

  it("takes Fear of finished windows from the stored tally, and from history when none is stored", async () => {
    const env = await setup();
    await env.start();
    await env.fear(NOW + 1 * MIN, "gain", 0, 2);
    vi.setSystemTime(NOW + 60 * MIN);
    await env.end();
    // The stored tally is the source for finished windows (as sessionPlay.tally).
    await env.t.run((ctx) => ctx.db.patch("sessions", env.sessionId, { tally: { fearGained: 7, fearSpent: 1, shortRests: 1, longRests: 0 } }));
    expect(await env.tally()).toMatchObject({ fearGained: 7, fearSpent: 1 });
    // No stored tally (played before it existed): counted from the history in the window.
    await env.t.run((ctx) => ctx.db.patch("sessions", env.sessionId, { tally: undefined }));
    expect(await env.tally()).toMatchObject({ fearGained: 2, fearSpent: 0 });
  });

  it("sums only this session's character stats", async () => {
    const env = await setup();
    await env.start();
    const oriel = await env.character("Oriel");
    await env.stats(oriel, 4, 5);
    const other = await env.t.run((ctx) =>
      ctx.db.insert("sessions", { campaignId: env.campaignId, n: 9, status: "played", startedAt: NOW, endedAt: NOW + MIN, createdAt: NOW, updatedAt: NOW }),
    );
    await env.stats(oriel, 9, 9, other);
    expect(await env.tally()).toMatchObject({ hopeSpent: 4, hpMarked: 5 });
  });

  it("marks the result truncated past the feed read cap", async () => {
    const env = await setup();
    await env.start();
    await env.t.run(async (ctx) => {
      for (let i = 0; i <= MAX_TALLY_FEED_ROWS; i++) {
        await ctx.db.insert("actionLog", {
          campaignId: env.campaignId,
          actorId: env.gmId,
          kind: "roll",
          visibility: "public",
          summary: "roll",
          roll: { kind: "action", dice: [], modifier: 0, total: 20, outcome: "critical", manual: false },
          undoable: false,
          at: NOW + 1 + i,
        });
      }
    });
    vi.setSystemTime(NOW + 10 * MIN);
    // Start writes its own feed row, so the cap leaves room for fewer than MAX_TALLY_FEED_ROWS criticals: a floor.
    const result = await env.tally();
    expect(result.truncated).toBe(true);
    expect(result.criticals).toBeGreaterThan(MAX_TALLY_FEED_ROWS - 10);
    expect(result.criticals).toBeLessThanOrEqual(MAX_TALLY_FEED_ROWS);
  });

  // Journal JT: the open window's read has no upper time bound. A query's `Date.now()` is frozen when it runs, so a
  // bound at `now` would leave later writes outside its read range and Convex would never re-run it (the tiles froze
  // until a reload). The clock stays frozen here while rows land after it: the re-run must include them.
  it("includes rows written after the query's own time in a live session's open window (live updates)", async () => {
    const env = await setup();
    await env.start();
    vi.setSystemTime(NOW + 10 * MIN);
    expect(await env.tally()).toMatchObject({ fearGained: 0, criticals: 0, live: true });
    await env.roll(NOW + 11 * MIN, "critical");
    await env.fear(NOW + 12 * MIN, "gain", 0, 1);
    expect(await env.tally()).toMatchObject({ fearGained: 1, criticals: 1, live: true });
  });

  it("keeps the upper bound of a closed window: rows after End are out", async () => {
    const env = await setup();
    await env.start();
    vi.setSystemTime(NOW + 10 * MIN);
    await env.end();
    await env.roll(NOW + 11 * MIN, "critical");
    await env.fear(NOW + 12 * MIN, "gain", 0, 1);
    await env.t.run((ctx) => ctx.db.patch("sessions", env.sessionId, { tally: undefined }));
    expect(await env.tally()).toMatchObject({ fearGained: 0, criticals: 0, live: false });
  });

  it("sessionWrap.after includes a level-up written after the query's own time while live, not after End", async () => {
    const env = await setup();
    const vex = await env.character("Vex");
    const levelUp = (at: number, summary: string) =>
      env.t.run((ctx) =>
        ctx.db.insert("actionLog", { campaignId: env.campaignId, characterId: vex, actorId: env.gmId, kind: "levelUp", visibility: "public", summary, undoable: false, at }),
      );
    const after = () => env.gm.query(api.sessionWrap.after, { campaignId: env.campaignId, sessionId: env.sessionId });
    await env.start();
    vi.setSystemTime(NOW + 10 * MIN);
    expect((await after())?.levelUps).toEqual([]);
    await levelUp(NOW + 11 * MIN, "Vex reached level 2.");
    expect((await after())?.levelUps).toEqual([{ characterId: vex, summary: "Vex reached level 2.", at: NOW + 11 * MIN }]);

    vi.setSystemTime(NOW + 20 * MIN);
    await env.end();
    await levelUp(NOW + 21 * MIN, "Vex reached level 3.");
    expect((await after())?.levelUps.map((l) => l.summary)).toEqual(["Vex reached level 2."]);
  });

  it("refuses a session of another campaign with SESSION_NOT_FOUND", async () => {
    const env = await setup();
    const { campaignId: other } = await env.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const error = await env.gm.query(api.journalTally.tally, { campaignId: other, sessionId: env.sessionId }).catch((e: unknown) => e);
    expect(errorCode(error)).toBe("SESSION_NOT_FOUND");
  });
});
