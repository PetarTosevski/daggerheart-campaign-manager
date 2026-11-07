import { api } from "../../../convex/_generated/api";
import { key } from "../helpers";
import type { Area, World } from "./harness";

/**
 * Authz matrix: the party's walk along a drawn route (plan world-journey MJ1, convex/mapJourney.ts). Every member reads
 * the trip (players see the token walk, the days and the line, Q4); starting, stopping, resuming, cancelling and the
 * speed need End day's access (D4: `keyedGmMutation` / `gmMutation`, owner-only, so the grantee's campaign edit grant
 * is FORBIDDEN). The world is beast-feast, whose blank map (all Wilds) can be walked anywhere.
 */

const ROUTE = [
  { x: 10, y: 50 },
  { x: 30, y: 50 },
];

/** A trip under way, started by the GM. */
async function trip(w: World) {
  await w.as("gm").mutation(api.mapJourney.start, { campaignId: w.campaignId, points: ROUTE, speed: "slow", idempotencyKey: key() });
}

/** A stopped trip. */
async function stopped(w: World) {
  await trip(w);
  await w.as("gm").mutation(api.mapJourney.stop, { campaignId: w.campaignId, idempotencyKey: key() });
}

const GM_ONLY = { grantee: "FORBIDDEN" } as const;

const area: Area = {
  area: "world-journey",
  world: { frameId: "beast-feast" },
  entries: [
    { fn: api.mapJourney.get, access: "view", setup: trip, expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.mapJourney.start, access: "gm", args: () => ({ points: ROUTE, speed: "fast" }), expect: GM_ONLY },
    { fn: api.mapJourney.stop, access: "gm", setup: trip, expect: GM_ONLY },
    { fn: api.mapJourney.resume, access: "gm", setup: stopped, expect: GM_ONLY },
    { fn: api.mapJourney.cancel, access: "gm", setup: stopped, expect: GM_ONLY },
    { fn: api.mapJourney.setSpeed, access: "gm", setup: stopped, args: () => ({ speed: "fast" }), expect: GM_ONLY },
  ],
};

export default area;
