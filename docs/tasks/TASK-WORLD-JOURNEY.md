# TASK: the party walks the drawn route (world journey MJ1)

Plan `.omc/plans/world-journey.yaml`, tracer MJ1, bead dcm-zod8.2 (epic dcm-zod8).

## What the user asked (2026-11-07)

"Move party along route" teleported the party. Now the token walks the route, the GM can stop it to play out an
event, and campaign days pass as the walked distance crosses each whole travel day (stopped at 3 days → 3 days
passed). The rest of the line stays; the GM resumes or cancels. Slow / Normal / Fast = 6 / 3 / 1 s of real time per
travel day. Players see the token walk, the days tick and the remaining line, without buttons.

## How it works

- **Domain** (`src/lib/domain/travel/journey.ts`, pure): `routeTimeline` walks the route exactly as `analyseRoute`
  does and returns the cumulative travel days per point (its total equals Measure's days), adding a point where the
  terrain changes so the token slows in marsh and speeds up on road (up to 1200 points; above that the drawn points
  are kept). `progressAt`, `pointAt`, `remainingPath`, `walkedPath`, `daysDue` (whole days only, D2), `nextBoundaryMs`.
- **Table** `mapJourneys` (`convex/tables/maps.ts`, typed validators in `convex/lib/validators/maps.ts`): one row per
  campaign while a trip exists. Purged with the campaign (`convex/cleanup.ts`).
- **Functions** (`convex/mapJourney.ts`):
  - `get` (every member, `returns` declared): the trip or null.
  - `start` (keyed, GM / co-GM as End day, D4): the server computes the days from the stored map (scale, terrain,
    Measure's method and pace, travel rules). A blocked route, fewer than two points or Journey to Horizon → `INVALID`.
    A trip under way ends as Cancel first.
  - `stop` / `resume` / `cancel` (keyed) and `setSpeed` (set-style): Stop passes the due days, freezes the progress
    and puts the party (map scalars) at that point with the walked stretch in its trail; Cancel does the same and
    deletes the row (days passed stay passed, Q3).
  - `tick` (internal, scheduled at each whole-day boundary and at arrival; D6): ignores a stale `generation`, passes
    every due day (at most 7 per run, the rest right after), moves the party, then finishes or schedules the next
    boundary.
- **End day refactor** (`convex/campaignTime.ts`): `passCampaignDay` holds End day's body; `endDay` and the tick share
  it, so a travel day is an End day ("Day 2 ended on the road" in the feed), undoable as before (D3).
- **Manual moves** (`convex/maps.ts` `moveParty`: drag, arrow keys, "send party here") end a trip first (D5).
- **UI**: `use-journey.ts` (the query plus a purely visual requestAnimationFrame loop; the local clock is clamped
  between the days the server has passed and the next whole day), `map-view.tsx` (token at the animated point, dashed
  gold remaining line for everyone, even with Measure closed), `journey-bar.tsx` ("On the road · Day 2.4 of 7.0 · 2
  days passed"; GM: speed, Stop / Resume, Cancel trip, with optimistic updates), Measure panel speed picker and the
  move button (disabled with the reason on a blocked route; the drawing clears once the trip starts).

## Tests

- `tests/unit/travel-journey.test.ts`: the timeline agrees with `analyseRoute`, positions, days due, boundaries.
- `tests/convex/map-journey.test.ts` (fake timers): 3.4-day route passes 3 days and ends at the route's end; stop at
  2.5 → 2 days, party at the 2.5-day point, route kept; resume passes day 3 at 3.0; cancel keeps the party; stale
  ticks do nothing; blocked route → `INVALID`; `moveParty` ends the trip; a new trip replaces one; players read only.
- `tests/convex/authz/world-journey.{entries,test}.ts`: every new public function in the matrix.
- `tests/e2e/world-journey.spec.ts`: GM draws waypoints, Fast, Move; the token walks and days pass; Stop freezes it;
  a player sees the bar and line without buttons; Resume; Cancel clears the line for both.

## Not in this tracer

The calendar above the map is MC1's (`world/page.tsx`); its queries update live when the trip passes days.
