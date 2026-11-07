/**
 * World journey MJ1 (plan .omc/plans/world-journey.yaml, dcm-zod8.2): the party walks a drawn route on the server's
 * clock. A scheduled internal tick passes one campaign day (End day's effects) at each whole travel day (D2, D3, D6);
 * the GM stops, resumes, cancels and changes the speed (D4); a manual party move ends the trip (D5).
 *
 * The map is beast-feast's (blank terrain: all Wilds, 40 km/day on foot) at 680 km wide, so a horizontal stretch of
 * 20% of the map is 136 km = 3.4 travel days. Normal speed walks a travel day in 3 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

const DAY_MS = 3000;
const ROUTE = [
  { x: 10, y: 50 },
  { x: 20, y: 50 },
  { x: 30, y: 50 },
];

async function world(): Promise<World> {
  const w = await buildWorld({ frameId: "beast-feast" });
  await w.as("gm").mutation(api.maps.setOptions, { campaignId: w.campaignId, scaleKm: 680 });
  vi.useFakeTimers();
  return w;
}

const gm = (w: World) => w.as("gm");
const start = (w: World, points = ROUTE) => gm(w).mutation(api.mapJourney.start, { campaignId: w.campaignId, points, speed: "normal", idempotencyKey: key() });
const stop = (w: World) => gm(w).mutation(api.mapJourney.stop, { campaignId: w.campaignId, idempotencyKey: key() });
const resume = (w: World) => gm(w).mutation(api.mapJourney.resume, { campaignId: w.campaignId, idempotencyKey: key() });
const cancel = (w: World) => gm(w).mutation(api.mapJourney.cancel, { campaignId: w.campaignId, idempotencyKey: key() });
const trip = (w: World) => w.as("player").query(api.mapJourney.get, { campaignId: w.campaignId });
const day = async (w: World) => (await w.as("player").query(api.campaignTime.calendar, { campaignId: w.campaignId })).day;
const party = async (w: World) => (await gm(w).query(api.maps.get, { campaignId: w.campaignId })).state.party;

/** Moves the fake clock and lets every scheduled tick that came due finish. */
async function wait(w: World, ms: number) {
  vi.advanceTimersByTime(ms);
  await w.t.finishInProgressScheduledFunctions();
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe("the party walks a drawn route", () => {
  it("a 3.4-day route passes exactly 3 days, one per travel day, and ends with the party at the route's end", async () => {
    const w = await world();
    const { totalDays } = await start(w);
    expect(totalDays).toBeCloseTo(3.4, 6);
    expect(await trip(w)).toMatchObject({ status: "moving", speed: "normal", daysPassed: 0, baseDays: 0 });
    expect(await day(w)).toBe(1);

    await wait(w, DAY_MS - 10);
    expect(await day(w)).toBe(1);
    await wait(w, 20);
    expect(await day(w)).toBe(2);
    expect((await trip(w))?.daysPassed).toBe(1);
    // The stored party follows the walk at each day boundary.
    expect((await party(w)).x).toBeCloseTo(10 + 20 / 3.4, 1);

    for (let i = 0; i < 5; i++) await wait(w, DAY_MS);
    expect(await day(w)).toBe(4);
    expect(await trip(w)).toBeNull();
    const at = await party(w);
    expect(at).toMatchObject({ x: 30, y: 50 });
    expect(at.trail[0]).toEqual({ x: 10, y: 50 });
    // Each travel day is an End day, labelled as a day on the road.
    const groups = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(groups.filter((g) => g.characterId === undefined && g.summary.endsWith("on the road"))).toHaveLength(3);
  });

  it("stopped at 2.5 days: 2 days passed, the party at the 2.5-day point, the route kept; Resume passes day 3 at 3.0", async () => {
    const w = await world();
    await start(w);
    await wait(w, 2.5 * DAY_MS);
    await stop(w);
    expect(await day(w)).toBe(3);
    const stopped = await trip(w);
    expect(stopped).toMatchObject({ status: "paused", daysPassed: 2 });
    expect(stopped!.baseDays).toBeCloseTo(2.5, 6);
    expect((await party(w)).x).toBeCloseTo(10 + (20 * 2.5) / 3.4, 1);

    // While stopped no day passes.
    await wait(w, 10 * DAY_MS);
    expect(await day(w)).toBe(3);
    expect((await trip(w))?.status).toBe("paused");

    await resume(w);
    await wait(w, 0.5 * DAY_MS - 10);
    expect(await day(w)).toBe(3);
    await wait(w, 20);
    expect(await day(w)).toBe(4);
    expect((await trip(w))?.daysPassed).toBe(3);
    await wait(w, DAY_MS);
    expect(await trip(w)).toBeNull();
    expect(await day(w)).toBe(4);
  });

  it("Cancel removes the trip and keeps the party where it stopped; days already passed stay passed", async () => {
    const w = await world();
    await start(w);
    await wait(w, 1.5 * DAY_MS);
    await stop(w);
    const stoppedAt = await party(w);
    await cancel(w);
    expect(await trip(w)).toBeNull();
    expect(await party(w)).toEqual(stoppedAt);
    expect(await day(w)).toBe(2);
    await wait(w, 10 * DAY_MS);
    expect(await day(w)).toBe(2);
  });

  it("a stale tick after Stop or a speed change does nothing", async () => {
    const w = await world();
    await start(w);
    const row = await w.t.run(async (ctx) => (await ctx.db.query("mapJourneys").first())!);
    await wait(w, 0.5 * DAY_MS);
    await stop(w);
    // The tick scheduled for the first boundary, run by hand with its old generation.
    await w.t.mutation(internal.mapJourney.tick, { journeyId: row._id, generation: row.generation });
    await wait(w, 5 * DAY_MS);
    expect(await day(w)).toBe(1);
    expect(await trip(w)).toMatchObject({ status: "paused", daysPassed: 0 });

    await resume(w);
    await gm(w).mutation(api.mapJourney.setSpeed, { campaignId: w.campaignId, speed: "fast" });
    const fast = (await trip(w))!;
    expect(fast.speed).toBe("fast");
    await w.t.mutation(internal.mapJourney.tick, { journeyId: row._id, generation: fast.generation - 1 });
    expect(await day(w)).toBe(1);
    // Fast walks a day in 1 s: the 0.5 day left to the first boundary takes 500 ms.
    await wait(w, 510);
    expect(await day(w)).toBe(2);
  });

  it("refuses a blocked route, and one of fewer than two points, with a code", async () => {
    const w = await world();
    // Impassable on the route's row (y = 50 → row 49), column 20 (x ≈ 15.6).
    await gm(w).mutation(api.maps.paintCells, { campaignId: w.campaignId, indexes: [49 * 128 + 20], codes: "#" });
    expect(errorCode(await start(w).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await start(w, [{ x: 10, y: 50 }]).catch((e) => e))).toBe("INVALID");
    expect(await trip(w)).toBeNull();
  });

  it("a manual party move ends the trip as Cancel, then moves the party", async () => {
    const w = await world();
    await start(w);
    await wait(w, 1.2 * DAY_MS);
    await gm(w).mutation(api.maps.moveParty, { campaignId: w.campaignId, x: 70, y: 70, idempotencyKey: key() });
    expect(await trip(w)).toBeNull();
    const at = await party(w);
    expect(at).toMatchObject({ x: 70, y: 70 });
    // The stop point (1.2 days along) joined the trail before the move.
    expect(at.trail[at.trail.length - 1].x).toBeCloseTo(10 + (20 * 1.2) / 3.4, 1);
    await wait(w, 10 * DAY_MS);
    expect(await day(w)).toBe(2);
  });

  it("a new trip replaces one under way", async () => {
    const w = await world();
    await start(w);
    await wait(w, 0.5 * DAY_MS);
    await start(w, [
      { x: 20, y: 20 },
      { x: 25, y: 20 },
    ]);
    const now = (await trip(w))!;
    expect(now.points[0]).toEqual({ x: 20, y: 20 });
    expect(now.generation).toBe(1);
    await wait(w, 2 * DAY_MS);
    expect(await trip(w)).toBeNull();
    expect(await day(w)).toBe(1);
  });

  it("players read the trip but can't start, stop, resume, cancel or change the speed", async () => {
    const w = await world();
    await start(w);
    const player = w.as("player");
    const c = { campaignId: w.campaignId };
    expect(await trip(w)).not.toBeNull();
    const refused = [
      player.mutation(api.mapJourney.start, { ...c, points: ROUTE, speed: "fast", idempotencyKey: key() }),
      player.mutation(api.mapJourney.stop, { ...c, idempotencyKey: key() }),
      player.mutation(api.mapJourney.resume, { ...c, idempotencyKey: key() }),
      player.mutation(api.mapJourney.cancel, { ...c, idempotencyKey: key() }),
      player.mutation(api.mapJourney.setSpeed, { ...c, speed: "fast" }),
    ];
    for (const call of refused) expect(errorCode(await call.catch((e) => e))).toBe("FORBIDDEN");
    expect((await trip(w))?.status).toBe("moving");
  });
});
