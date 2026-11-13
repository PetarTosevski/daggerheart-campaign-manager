# TASK-ME1: wall geometry for drawn walls (pure, shared)

Status: Review. Plan: `.omc/plans/map-editor.yaml`, tracer ME1 (bead dcm-5rhs.1, epic dcm-5rhs). ME4 (server), ME7 (editor) and ME12 (phone) build on it.

## Rule (user, 2026-11-13)

Walls are freeform polylines of six kinds. Tokens stay on the square grid.

| kind | sight | movement |
|---|---|---|
| `wall` | blocks | blocks |
| `door` | closed (`open` absent or false): blocks. Open: passes | closed: blocks. Open: passes |
| `window` | passes | blocks |
| `secret` | a wall until `revealed`; then a door (`open` decides) | same |
| `low` | passes, but a line across it is **cover** (disadvantage on attacks, CB p.104, the same as the "cover" sight mode) | the step across it is **difficult** (D5, like `DIFFICULT_TERRAINS`) |
| `oneway` | passes only from its **open side** | blocks both ways |

## Coordinates

- Points are in **squares**, the same frame as map areas and objects. Square (x, y) covers [x, x + 1) x [y, y + 1). Its centre is (x + 0.5, y + 0.5). Integer points are square corners. y grows downwards.
- A run's `points` are `[x, y]` pairs. Consecutive points make its segments. A run needs at least two valid points. Non-finite points and zero-length segments are dropped.
- **One-way open side:** walk the run from its first point to its last. The open side is on the **left as drawn on screen** (y down), unless `side: "right"`. A run drawn eastwards (+x) has its open side to the north (smaller y). A run drawn southwards (+y) has it to the east. A viewer on the open side sees and targets through. A viewer on the other side is blocked.
- A **step** is a token square moving to one of its 8 neighbours. Its line runs from one square centre to the other.

## Crossing rule (sight lines and steps alike)

A line P to Q crosses a segment when either of these holds:

1. P and Q, both nudged by the same tiny fixed offset (about 1e-6 squares, right and down), lie strictly on opposite sides of the segment's line, and the nudged line meets the segment (its ends included).
2. **Graze:** an end of the segment lies on the open line between P and Q.

What follows from it (each case is tested in `tests/unit/walls.test.ts`):

- A run ending exactly on a square corner blocks the diagonal step past that corner. There is no corner cutting, which matches the movement path taking both squares at an exact corner (D4).
- A run ending exactly on an edge midpoint blocks the straight step through that midpoint.
- A diagonal step cannot slip through the point where two walls meet. This holds whether they are two runs or one bent run.
- A square centre lying exactly on a wall counts as being a hair right and below it. Example: a diagonal wall drawn corner to corner runs through square centres. That square belongs to one side for every step, so a token can never cross a wall in two steps through it.
- A sight line that grazes a wall's end is blocked. This is measure zero and does not show in fog.
- A step or line running exactly along a wall is not blocked by it, unless one of the wall's ends lies inside it.

## API (`src/lib/domain/combat-map/walls.ts`, re-exported from `combat-map/index.ts`)

```ts
WALL_KINDS: readonly ["wall", "door", "window", "secret", "low", "oneway"]
type WallKind; type WallSide = "left" | "right"
type WallRun = { kind; points: [x, y][]; open?: boolean | null; revealed?: boolean | null; side?: WallSide | null }
wallEffect(run): { sight: "block" | "cover" | "none" | "oneway"; move: "block" | "difficult" | "open" }
prepareWalls(runs, w, h): PreparedWalls | null   // null = no wall has an effect (behaves as no walls)
traceSight(walls, ax, ay, bx, by): "clear" | "cover" | "block"
traceStep(walls, ax, ay, bx, by): "open" | "difficult" | "block"
```

`PreparedWalls` stores each segment once and buckets it into every square it touches (CSR arrays `start` / `items`). A query only tests the segments in the squares its own line touches, and tests each one once (a stamp array). Unknown kinds and open doors are not indexed.

### Integration (walls are optional everywhere; without them nothing changes)

- **Vision** (`vision.ts`): `VisionMapInput.walls?: WallRun[]`. `prepareMap` builds `PreparedMap.walls?: PreparedWalls`, which is absent when nothing has an effect. `los` = the old sample walk AND `traceSight !== "block"`. Fog, token visibility, map lights and glowing terrain all go through `los`, so walls apply to all of them. Walls never mark `blocked` samples, because they are thin lines. They work on uploaded image maps too.
- **Movement** (`movement.ts`): `MovementMapInput.walls?: WallRun[]`. `buildMovementGrid` traces every in-map step once and adds `MovementGrid.wallSteps?: { blocked, difficult }`: per square, one bit per neighbour step. A step and its reverse share the result.
  - `wallStep(grid, from, to)` gives one step's effect.
  - `pathSteps(from, to)` gives the supercover anchors, one neighbour at a time. An exact corner counts as one diagonal step.
  - `checkMove` / `pathBlocked` / `crossedDifficult` also walk the move's steps, and every square of a large token's footprint steps alongside. A low wall sets `difficult`. A blocked move still reports a low wall it crosses.
- **Attack sight** (`combat-actions/sight.ts`): `lineOfSight` uses `los`, so walls, closed doors, hidden secret doors and one-way walls seen from their closed side leave no line of sight. A clear line across a low wall counts as covered, the same as a line past a "cover" object. The target is in cover only when every clear line is covered. If part of it is seen past the low wall's end, there is no cover. Every low wall the line crosses counts, wherever it stands. Unlike cover objects, there is no exception for a low wall touching the attacker's or the target's square.

## Usage

```ts
import { prepareMap, buildMovementGrid, checkMove, lineOfSight } from "...";

const walls: WallRun[] = [
  { kind: "wall", points: [[10, 0], [10, 5]] },
  { kind: "door", points: [[10, 5], [10, 7]], open: false },
  { kind: "wall", points: [[10, 7], [10, 12]] },
  { kind: "oneway", points: [[4, 0], [4, 12]] },          // drawn southwards: open side east (+x)
];
const map = prepareMap({ w: 20, h: 12, base: "grass", objects, walls });   // vision and attack sight
const grid = buildMovementGrid({ w: 20, h: 12, base: "grass", objects, walls });
checkMove(grid, { x: 8, y: 5 }, { x: 12, y: 5 }, 1);      // { blocked: true, difficult: false }: the closed door
lineOfSight(map, { x: 2, y: 5 }, { x: 13, y: 5 }, objects); // the one-way wall's closed side faces the attacker: no line of sight
```

ME4 will store runs in `combatMapWalls` (kind, points, open, revealed, side) and pass them as `walls` to both builders. Before a player's map query returns runs, it must turn an unrevealed secret door into `kind: "wall"`. The geometry already treats it as a wall.

## Performance

`tests/unit/walls-bench.test.ts` builds a 64 x 64 map with 400 runs of 64 points (25,200 segments, all kinds mixed). On a loaded host:

- `prepareMap`: median **13.9 ms**. The acceptance limit is 30 ms.
- `buildMovementGrid`: about 16 ms.
- One viewer's full `visibleSquares`: about 12 ms.

## Tests

- `tests/unit/walls.test.ts`: the kinds, preparation and bucketing, sight (one-way both sides and `side: "right"`, low wall cover), steps (edge walls, runs ending on a corner or an edge midpoint, two walls meeting, splits). It also has "no way through" checks: a diagonal wall through square centres, a four-run room, and 60 random closed polygons (freeform, snapped to corners, snapped to half squares; one run and one run per side). In each, a flood fill from inside never reaches a square outside.
- `tests/unit/movement-walls.test.ts`: the grid is unchanged without walls; opening, doors, windows, secret doors, one-way, low wall difficult, corner cutting, size-2 tokens, terrain alongside, image maps, `pathSteps`.
- `tests/unit/vision-walls.test.ts`: `prepareMap` is unchanged without walls; los per kind, one-way, fog at night on an image map.
- `tests/unit/combat-sight-walls.test.ts`: `lineOfSight` per kind, partial low-wall cover, one-way targeting.
- `tests/unit/walls-bench.test.ts`: the benchmark.
- The existing vision, movement and attack-sight tests pass unchanged.
