/**
 * The party walks a drawn route (plan world-journey MJ1, dcm-zod8.2). "Move party along route" starts a trip stored in
 * `mapJourneys` (one per campaign); every screen animates the party token from the stored start time
 * (`get`), and a scheduled internal `tick` passes one campaign day, with End day's effects (`passCampaignDay`, D3), each
 * time the walked distance crosses a whole travel day (D2, D6: days pass on the server only). The GM stops, resumes,
 * cancels and changes the speed (D4: End day's access). A manual party move ends the trip as Cancel (D5, `endJourney`
 * from convex/maps.ts).
 *
 * The party's stored position (map scalars) follows the trip at each day boundary, on Stop and on arrival; the walked
 * part joins the trail (the last 12 points) whenever a moving stretch ends (Stop, Cancel while moving, arrival).
 */
import { v } from "convex/values";

import {
  MAX_ROUTE_POINTS,
  arrived,
  daysDue,
  nextBoundaryMs,
  pointAt,
  progressAt,
  routeTimeline,
  samplePath,
  walkedPath,
} from "../src/lib/domain/travel/journey";
import { mapScale, type Point } from "../src/lib/domain/travel/index";
import { appError } from "../src/lib/errors/app-error";
import { assembleTerrain, HORIZON_FRAME, mapImageSize, TERRAIN_TILES, travelRules } from "../src/lib/world/map-state";
import { suggestedTerrain, terrainAt } from "../src/lib/world/terrain";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { passCampaignDay } from "./campaignTime";
import { campaignQuery, gmMutation, keyedGmMutation } from "./lib/functions";
import { readTiles, saveScalars, writableMap } from "./lib/maps";
import { journeySpeedValidator, journeyViewValidator } from "./lib/validators/maps";

type Journey = Doc<"mapJourneys">;

/** Days one tick passes at most; a tick that finds more due (a late scheduler) passes these and runs again at once. */
const MAX_DAYS_PER_TICK = 7;
/** Trail points one walked stretch adds (as `moveParty`'s via points); the trail keeps the last 12. */
const TRAIL_SAMPLE = 11;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (n: number) => Math.max(0, Math.min(100, n));

function findJourney(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("mapJourneys")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
}

const view = (j: Journey) => ({
  points: j.points,
  cum: j.cum,
  totalDays: j.totalDays,
  speed: j.speed,
  status: j.status,
  baseDays: j.baseDays,
  startedAt: j.startedAt,
  daysPassed: j.daysPassed,
  generation: j.generation,
});

/** The campaign's trip, or null: every member reads it (D: players see the token walk, the days and the line). */
export const get = campaignQuery({
  need: "view",
  args: {},
  returns: v.union(journeyViewValidator, v.null()),
  handler: async (ctx) => {
    const row = await findJourney(ctx, ctx.campaign._id);
    return row ? view(row) : null;
  },
});

/** Passes every whole day due at `progress` (End day's effects, labelled as a day on the road); returns the new count. */
async function passDue(ctx: MutationCtx, campaign: Doc<"campaigns">, row: Journey, progress: number, max = Infinity): Promise<number> {
  const due = Math.min(max, daysDue(progress, row.daysPassed));
  for (let i = 0; i < due; i++) await passCampaignDay(ctx, campaign, row.startedBy, { onTheRoad: true });
  return row.daysPassed + due;
}

/** Puts the party at `at`; with `walked`, that stretch (sampled) joins the trail first. */
async function placeParty(ctx: MutationCtx, campaign: Doc<"campaigns">, at: Point, walked: Point[] | null) {
  const map = await writableMap(ctx, campaign);
  const { party } = map.scalars;
  const via = walked ? samplePath(walked, TRAIL_SAMPLE + 1).slice(0, -1) : [];
  const trail = [...party.trail, ...via.map((p) => ({ x: round2(p.x), y: round2(p.y) }))].slice(-12);
  await saveScalars(ctx, campaign._id, map, { ...map.scalars, party: { x: round2(at.x), y: round2(at.y), trail } });
}

async function cancelTick(ctx: MutationCtx, row: Journey) {
  if (row.scheduledId) await ctx.scheduler.cancel(row.scheduledId);
}

async function schedule(ctx: MutationCtx, row: Journey, now: number): Promise<Id<"_scheduled_functions">> {
  return ctx.scheduler.runAt(Math.max(now, nextBoundaryMs(row, now)), internal.mapJourney.tick, { journeyId: row._id, generation: row.generation });
}

/**
 * Ends a moving stretch at `now`: passes the due days, puts the party at the walked point with the stretch in its
 * trail. Returns the progress and the days passed. A paused trip is already settled.
 */
async function settle(ctx: MutationCtx, campaign: Doc<"campaigns">, row: Journey, now: number) {
  const progress = progressAt(row, now);
  if (row.status !== "moving") return { progress, daysPassed: row.daysPassed };
  const daysPassed = await passDue(ctx, campaign, row, progress);
  await placeParty(ctx, campaign, pointAt(row.points, row.cum, progress), walkedPath(row.points, row.cum, row.baseDays, progress));
  return { progress, daysPassed };
}

/**
 * Ends the campaign's trip as Cancel, if there is one (D5: a manual party move, or a new trip, replaces it). Days
 * already passed stay passed; the party stays where it is on the route. Returns whether a trip ended.
 */
export async function endJourney(ctx: MutationCtx, campaign: Doc<"campaigns">): Promise<boolean> {
  const row = await findJourney(ctx, campaign._id);
  if (!row) return false;
  await settle(ctx, campaign, row, Date.now());
  await cancelTick(ctx, row);
  await ctx.db.delete("mapJourneys", row._id);
  return true;
}

const pointArg = v.object({ x: v.number(), y: v.number() });

/**
 * Starts the party walking `points` at `speed` (D4: the GM / co-GM). The server works out the travel days from the
 * stored map (scale, painted terrain, Measure's method and pace, the travel rules); a blocked route is refused. A trip
 * already under way ends as Cancel first.
 */
export const start = keyedGmMutation({
  args: { points: v.array(pointArg), speed: journeySpeedValidator },
  returns: v.object({ totalDays: v.number() }),
  handler: async (ctx, { points, speed }) => {
    const campaign = ctx.campaign;
    if (campaign.frameId === HORIZON_FRAME) throw appError("INVALID", "Journey to Horizon moves the party hex by hex.");
    if (points.length < 2) throw appError("INVALID", "Draw a route of at least two points.");
    if (points.length > MAX_ROUTE_POINTS) throw appError("INVALID", `A route has at most ${MAX_ROUTE_POINTS} points.`);
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw appError("INVALID", "A route point is not on the map.");
    const route = points.map((p) => ({ x: clampPct(p.x), y: clampPct(p.y) }));
    return ctx.once("map_journey_start", { points: route, speed }, async () => {
      const { scalars } = await writableMap(ctx, campaign);
      const image = mapImageSize(campaign.frameId, scalars);
      const scale = mapScale(scalars.scaleKm, image.width, image.height);
      const tiles = await readTiles(
        ctx,
        campaign,
        Array.from({ length: TERRAIN_TILES }, (_, i) => i),
      );
      const grid = assembleTerrain(
        suggestedTerrain(campaign.frameId),
        [...tiles].map(([tile, cells]) => ({ tile, cells })),
      );
      const timeline = routeTimeline(route, scale, (p) => terrainAt(grid, p.x, p.y), scalars.options, travelRules(scalars));
      if (timeline.blocked) throw appError("INVALID", "The party can't walk this route: it crosses terrain they can't pass.");
      if (!(timeline.totalDays > 0)) throw appError("INVALID", "This route is too short to walk.");

      await endJourney(ctx, campaign);
      const now = Date.now();
      const id = await ctx.db.insert("mapJourneys", {
        campaignId: campaign._id,
        points: timeline.points.map((p) => ({ x: round2(p.x), y: round2(p.y) })),
        cum: timeline.cum,
        totalDays: timeline.totalDays,
        speed,
        status: "moving",
        baseDays: 0,
        startedAt: now,
        daysPassed: 0,
        generation: 1,
        startedBy: ctx.user._id,
      });
      const row = (await ctx.db.get("mapJourneys", id))!;
      await ctx.db.patch("mapJourneys", id, { scheduledId: await schedule(ctx, row, now) });
      return { totalDays: timeline.totalDays };
    });
  },
});

/** Stops the walk where the party is now (to play out an event): due days pass, the rest of the route stays. */
export const stop = keyedGmMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const campaign = ctx.campaign;
    return ctx.once("map_journey_stop", {}, async () => {
      const row = await findJourney(ctx, campaign._id);
      if (!row || row.status !== "moving") return null;
      const { progress, daysPassed } = await settle(ctx, campaign, row, Date.now());
      await cancelTick(ctx, row);
      if (arrived(progress, row.totalDays)) await ctx.db.delete("mapJourneys", row._id);
      else await ctx.db.patch("mapJourneys", row._id, { status: "paused", baseDays: progress, daysPassed, generation: row.generation + 1, scheduledId: undefined });
      return null;
    });
  },
});

/** Walks on from where the party stopped. */
export const resume = keyedGmMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const campaign = ctx.campaign;
    return ctx.once("map_journey_resume", {}, async () => {
      const row = await findJourney(ctx, campaign._id);
      if (!row || row.status !== "paused") return null;
      const now = Date.now();
      const next: Journey = { ...row, status: "moving", startedAt: now, generation: row.generation + 1 };
      await ctx.db.patch("mapJourneys", row._id, { status: "moving", startedAt: now, generation: next.generation, scheduledId: await schedule(ctx, next, now) });
      return null;
    });
  },
});

/** Cancels the trip: the rest of the route goes, the party stays where it is, days already passed stay passed. */
export const cancel = keyedGmMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const campaign = ctx.campaign;
    return ctx.once("map_journey_cancel", {}, async () => {
      await endJourney(ctx, campaign);
      return null;
    });
  },
});

/** Changes the walking speed (sets it, so a retry is harmless); a moving trip walks on from where it is now. */
export const setSpeed = gmMutation({
  args: { speed: journeySpeedValidator },
  returns: v.null(),
  handler: async (ctx, { speed }) => {
    const row = await findJourney(ctx, ctx.campaign._id);
    if (!row || row.speed === speed) return null;
    if (row.status === "paused") {
      await ctx.db.patch("mapJourneys", row._id, { speed });
      return null;
    }
    const now = Date.now();
    const progress = progressAt(row, now);
    const daysPassed = await passDue(ctx, ctx.campaign, row, progress);
    await cancelTick(ctx, row);
    const next: Journey = { ...row, speed, baseDays: progress, startedAt: now, daysPassed, generation: row.generation + 1 };
    await ctx.db.patch("mapJourneys", row._id, {
      speed,
      baseDays: progress,
      startedAt: now,
      daysPassed,
      generation: next.generation,
      scheduledId: await schedule(ctx, next, now),
    });
    return null;
  },
});

/**
 * A day boundary (or the arrival) of a moving trip. A tick of an older generation (the trip stopped, resumed, changed
 * speed or ended since it was scheduled) does nothing. Passes the due days, moves the party, then finishes the trip or
 * schedules the next boundary.
 */
export const tick = internalMutation({
  args: { journeyId: v.id("mapJourneys"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { journeyId, generation }) => {
    const row = await ctx.db.get("mapJourneys", journeyId);
    if (!row || row.generation !== generation || row.status !== "moving") return null;
    const campaign = await ctx.db.get("campaigns", row.campaignId);
    if (!campaign || campaign.deletedAt !== undefined || campaign.archivedAt !== undefined) {
      await ctx.db.delete("mapJourneys", row._id);
      return null;
    }
    const now = Date.now();
    const progress = progressAt(row, now);
    const daysPassed = await passDue(ctx, campaign, row, progress, MAX_DAYS_PER_TICK);
    if (daysDue(progress, daysPassed) > 0) {
      // A late tick with more days due than one transaction should pass: the rest right after.
      const scheduledId = await ctx.scheduler.runAfter(0, internal.mapJourney.tick, { journeyId, generation });
      await ctx.db.patch("mapJourneys", row._id, { daysPassed, scheduledId });
      return null;
    }
    if (arrived(progress, row.totalDays)) {
      await placeParty(ctx, campaign, row.points[row.points.length - 1], walkedPath(row.points, row.cum, row.baseDays, row.totalDays));
      await ctx.db.delete("mapJourneys", row._id);
      return null;
    }
    await placeParty(ctx, campaign, pointAt(row.points, row.cum, progress), null);
    await ctx.db.patch("mapJourneys", row._id, { daysPassed, scheduledId: await schedule(ctx, row, now) });
    return null;
  },
});
