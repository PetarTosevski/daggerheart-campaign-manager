# TASK-D12-H0: Authz matrix harness, argument synthesizer, world fixture and inventory guard

Plan `.omc/plans/d12-hardening.yaml`, tracer H0 (wave 1, foundation). Bead dcm-bxp.11. Design: analysis section 2
(`.omc/autopilot/d12-analysis.md`). Rule 14 / TE2: every public Convex function appears in
`tests/convex/authz-matrix.test.ts` for anonymous, outsider, player and GM.

## What landed

| File | Role |
|---|---|
| `tests/convex/authz-matrix.test.ts` | The guard: inventory == union of every area's `entries` and `exempt`; no name twice; access class agrees with the wrapper; plus self-tests of each check. |
| `tests/convex/authz/inventory.ts` | `publicFunctions()` (runtime, `isPublic`), `publicFunction(name)`, `wrapperOf(name)` (raw source scan). |
| `tests/convex/authz/world.ts` | `buildWorld(options)`, the `World` type, `Role`, `ROLES`, `allowWorldEmails()`. |
| `tests/convex/authz/synth.ts` | `synthArgs(exportArgs, w, hints)`, `NAME_HINTS`, `freshKey()`. |
| `tests/convex/authz/harness.ts` | `Entry`, `Area`, `Access`, `Outcome`, class defaults, `runMatrix(area)`. |
| `tests/convex/authz/<area>.entries.ts` | One per area (core, countdowns, characters, play, world, adversaries, combat, sessions, notes, trackers). |
| `tests/convex/authz/<area>.test.ts` | Three lines: `runMatrix(area)`. One vitest file per area, so areas run in parallel. |
| `tests/convex/authz-synth.test.ts` | Proves the synthesizer on a gm, a view, an own and a scoped function, and an area extending the world and NAME_HINTS. |
| `tests/fixtures/characters.ts` | `characterDraft(name, classId = "warrior")`, the shared creation draft (TE3). |

`tests/convex/helpers.ts` is unchanged (the world uses its `key`).

## Inventory (D12 start commit e0f3678)

`publicFunctions()` finds **358** public functions: **355** defined by the wrappers in 54 modules plus the **3** Convex
Auth exports (`auth:signIn`, `auth:signOut`, `auth:isAuthenticated`). By wrapper: keyedGmMutation 85, gmMutation 69,
userMutation 66, campaignQuery 32 (all `need: "view"`), keyedUserMutation 26, gmQuery 25, campaignMutation 25 (24 view,
1 edit), userQuery 16, keyedCampaignMutation 7 (5 view, 2 edit), userAction 2, maybeUserQuery 2. This matches analysis
1.1. By area (pending names H0 wrote): core 31 (28 pending + 3 worked entries; `characters:get` is one of them),
countdowns 16, characters 44 (+ `characters:get` in core = 45), play 40, world 35, adversaries 27, combat 63,
sessions 32, notes 27, trackers 39.

## How to fill an area (H5-H14)

You own `tests/convex/authz/<area>.entries.ts` and `<area>.test.ts`. Give every public function of the area an entry
(H0 wrote the names into a `pending` list; D12 H24 and B6 removed it, see below). Run `pnpm vitest run tests/convex/authz/<area>.test.ts tests/convex/authz-matrix.test.ts`.

### An entry

```ts
import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

const area: Area = {
  area: "adversaries",
  setup: async (w) => {                       // runs on every world this area builds
    const { encounterId } = await w.as("gm").mutation(api.encounters.create, { campaignId: w.campaignId, name: "Ambush", idempotencyKey: freshKey() });
    w.set("encounterId", encounterId);         // optional: named ids for hints and args
  },
  entries: [
    { fn: api.encounters.list, access: "gm" },                                   // most entries are one line
    { fn: api.encounters.rename, access: "gm", args: () => ({ name: "Renamed" }) }, // override only what matters
    { fn: api.photoImport.read, access: "scoped", okCodes: ["PHOTO_IMPORT_UNAVAILABLE"],
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", gm: "ok" } },
  ],
  pending: [],
};
export default area;
```

Fields of an `Entry`:

| Field | Meaning |
|---|---|
| `fn` | `api.<module>.<export>` (the guard reads its name with `getFunctionName`). |
| `access` | `gm`, `view`, `edit`, `own`, `scoped`, `user` or `maybe`; must agree with the wrapper (below). |
| `args?: (w) => object` | Merged over the synthesized arguments. Give values that pass validation (see Pitfalls). |
| `expect?: { role: outcome }` | Overrides the class defaults; naming a role the class does not run adds that row. |
| `okCodes?: string[]` | Domain codes that still mean access was granted (`PHOTO_IMPORT_UNAVAILABLE`, `TIME_RULE`...). Never `UNAUTHENTICATED`, `NOT_FOUND` or `FORBIDDEN` (the guard refuses). |
| `setup?: (w) => Promise<void>` | Extra state for this entry, after the area's `setup`, on every world the entry builds. |
| `world?: WorldOptions` | World options for this entry over the area's (another frame). |
| `knownBug?: "<bead id>"` | See knownBug below. |
| `note?: string` | Free text. |

Fields of an `Area`: `area` (unique name), `world?` (options for all its worlds, such as `{ frameId }`), `setup?`,
`nameHints?` (extra or replacement NAME_HINTS), `entries`, `exempt?`.

### Outcomes

| Outcome | Passes when |
|---|---|
| `UNAUTHENTICATED`, `NOT_FOUND`, `FORBIDDEN` | the call throws a `ConvexError` whose `data` is an object with that `code`. |
| `ok` | the call resolves (any value, null included), or throws a `ConvexError` whose code is in `okCodes`. |
| `null` | the call resolves to `null`. |
| `empty` | the call resolves to `[]` or `{}`. |

A `ConvexError` with a string payload, or any other error (a validator error, a `TypeError`), fails the row with that
error: errors are asserted on `ConvexError.data.code` as an object, never on message text (TE1).

### Roles and the default expectations per access class

Roles: `anon` (signed out), `outsider` (signed in, not in the campaign), `player` (playerA, owns characterA),
`otherPlayer` (playerB, owns characterB), `grantee` (a member with an `edit` grant on the campaign), `gm`. Rows run in
the order anon, outsider, otherPlayer, player, grantee, gm.

| Access | Wrapper | anon | outsider | otherPlayer | player | grantee | gm |
|---|---|---|---|---|---|---|---|
| `gm` | gmQuery, gmMutation, keyedGmMutation | UNAUTHENTICATED | NOT_FOUND | - | FORBIDDEN | - | ok |
| `view` | campaign* `need: "view"` | UNAUTHENTICATED | NOT_FOUND | - | ok | - | ok |
| `edit` | campaign* `need: "edit"` | UNAUTHENTICATED | NOT_FOUND | - | FORBIDDEN | ok | ok |
| `own` | user* on a character | UNAUTHENTICATED | NOT_FOUND | query: ok; mutation/action: FORBIDDEN | ok | - | ok |
| `user` | user* acting on the caller's own rows | UNAUTHENTICATED | ok | - | ok | - | ok |
| `maybe` | maybeUserQuery | null | ok | - | ok | - | ok |
| `scoped` | user* on another resource | no defaults: state anon, outsider, player and gm | | | | | |

`-` means the row does not run unless the entry's `expect` names it. `own` reads default to ok for otherPlayer
because party members view each other's characters (`rolePermission`); entries override where a read hides the
sheet, and `characters:get` overrides `outsider: "null"` (it returns null instead of throwing). The `own` player acts
on characterA; otherPlayer acts on characterA too (not their own).

### Overriding per role

`expect` replaces single cells and keeps the rest of the class defaults:

```ts
{ fn: api.countdowns.listByCampaign, access: "view", expect: { player: "empty" }, setup: hiddenCountdown }
{ fn: api.rolls.tagTeamApply, access: "own", expect: { otherPlayer: "ok" } }        // either participant may pick
{ fn: api.codex.update, access: "scoped", expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", grantee: "ok", gm: "ok" } }
```

The matrix proves access, not content: filtering rules stay in the feature tests.

### World and setup

`buildWorld({ frameId?, classId?, characterArgs? })` (default frame `witherwild`) creates the five users (inserted:
users have no public API), then through the public API the GM's campaign, the join code, the three joins, characterA
(by playerA) and characterB (by playerB), and inserts the grantee's `edit` grant on the campaign (grants have no
public API yet). `characterArgs(who)` adds `characters.create` arguments (a Motherboard Ikonis).

`World`: `t`, `frameId`, `campaignId`, `joinCode`, `users` (by role), `characterA`, `characterB`, `as(role)` (the
caller), `ids` + `set(name, id)` (named ids your setup registers), `use(table, id)` (the row synthesis uses for that
table), `idOf(table)` (the chosen row, else the table's first document; throws naming the table when there is none, so
create it in `setup`). Defaults chosen: `campaigns` the campaign, `characters` characterA, `users` playerA.

Every row runs on a world no earlier row changed. Queries share one world per entry. A refused mutation throws and
Convex rolls its transaction back, so the next row reuses the world unchanged; a mutation that resolved (committed),
or any action, retires the world and the next row builds a fresh one. This gives each role the state of a fresh
world at about a third of the cost of building one per row.

### Synthesized arguments

`synthArgs(fn.exportArgs(), w, hints)` builds arguments from the function's own validator: `v.id(table)` →
`w.idOf(table)`; a field named in NAME_HINTS (any type but `v.id`) → its table's `idOf`, or the resolver's value;
`idempotencyKey` → a fresh key; literal → its value; union → first member; number → 0; int64 → 0n; boolean → false;
string → "x"; array → []; object → its required fields; optional → omitted; record → {}.

Default NAME_HINTS: campaignId, characterId, fromCharacterId, userId, mapId (combatMaps), tokenId, objectId, packId,
spriteId, sessionId, logId (sessionLog), encounterId, instanceId (encounterAdversaries), customId, pageId, journalId;
`cursor` → null and `numItems` → 10 (first page). An area adds or replaces hints without touching harness.ts:

```ts
nameHints: { pyreId: (w) => w.ids.pyreId, mapId: "maps" },
```

### knownBug

A real authorization bug is not fixed in an area tracer (it owns no convex/ file). File a bead, give the entry the
correct expectations and `knownBug: "<bead id>"`, and list it in your task doc. The entry then runs as one
`it.fails` test over all its rows: it stays green while some row is wrong and turns red once the code is fixed, which
tells the fixer to remove `knownBug`.

### pending (removed)

H0 shipped a `pending` list of names without an entry yet (each an `it.todo`). D12 H24 removed its support and
B6 (dcm-bxp.119) removed the field from the `Area` type and every area file. A new public function fails `pnpm test`
until it has an entry; the guard's self-test "a public function with no entry fails" proves it.

### Exemptions

`exempt: { "<name>": "<reason>" }` on an area. Only functions that no wrapper defines may be exempt (the guard refuses
an exempted wrapped function) and every reason must be non-empty. Today: the three Convex Auth exports, in
core.entries.ts (H5 owns them).

### The guard (authz-matrix.test.ts)

1. Missing: a public function no area lists fails, naming it. Stale: a listed name that is not a public function fails.
2. A name listed twice (in one area or across areas, in entries or exempt) fails.
3. Access class versus wrapper: gm* → `gm`; campaign* `need: "view"` → `view`, `need: "edit"` → `edit`
   (`need: "owner"` → `gm`); userQuery/userMutation/keyedUserMutation/userAction → `own`, `scoped` or `user`;
   maybeUserQuery → `maybe`.
4. Every `scoped` entry states anon, outsider, player and gm; no `okCodes` holds an access code.
5. Every exemption has a reason; every `*.entries.ts` has its `*.test.ts`; area names are unique.
6. The only unwrapped public functions are the three Convex Auth exports (catches a builder the scan does not know).

New area files are picked up by glob (`./authz/*.entries.ts`); no shared index to edit.

### Pitfalls

- Validation that runs before authorization masks the access rows (`characters:adjustGold` with amount 0 answers
  INVALID even to an outsider). Give `args` that pass validation.
- A `beforeAll` runs before the per-test allowlist; build worlds inside tests (the harness does).
- Rate-limited functions: each world is a fresh convex-test instance with its own limiter, so the matrix never hits a
  limit.

## Guard proofs (temporary edits, reverted; from H0, when `pending` still existed)

In `core.entries.ts`, deleted `"members:roster"` from `pending` and filed `fear:adjust` as `view`, then ran
`pnpm vitest run tests/convex/authz-matrix.test.ts`:

```
× every public function is listed (entry, pending or exempt) and nothing else is
× every entry's access class agrees with its wrapper; scoped entries state every role; okCodes hold no access code
AssertionError: public functions with no matrix entry: expected [ 'members:roster' ] to deeply equal []
+   "fear:adjust: filed as view, but keyedGmMutation allows gm",
Tests  2 failed | 7 passed (9)
```

The file was restored and the guard is green. A stale name, a duplicate, a scoped entry missing roles, an access code
in `okCodes` and an exempted wrapped function are proven permanently by the guard's self-tests ("the guard's checks
catch what they should"); `authz-synth.test.ts` proves the knownBug path (an entry with a wrong expectation reports as
an expected fail).

## Timing

- World build: about 200 ms on a quiet machine (makeTest, 5 users, campaign, join code, 3 joins, 2 characters, grant).
  Per entry about 1-2 worlds (the reuse rule above): a gm entry builds one, a view or own entry two.
- Sample of 20 core and character entries (85 rows, written for measuring only, not committed): 14 s for the file
  alone including about 5 s of module loading; 43.6 s with the machine at load average 45 (16 cores, other tracers
  running). That is about 0.45 s per entry when quiet.
- Full parallel `pnpm test --maxWorkers=4` (load average about 27): `core.test.ts` (3 entries, 13 rows) ran its tests in
  0.4 s, `authz-matrix.test.ts` in 3.1 s, `authz-synth.test.ts` in 1.2 s; the nine stub files only declare todos.
- Projection for the largest area (combat, 63 entries plus its setup per world): about 30 s alone on a quiet machine,
  so under the 60 s budget, but a busy machine can double it. Keep area setups lean (create only what the entries need,
  through the cheapest call), and put expensive state in the entry's `setup` rather than the area's when few entries
  need it.

## Checks

- `pnpm typecheck`: clean. `pnpm exec eslint` on every new file: clean.
- `pnpm test --maxWorkers=4 --testTimeout=60000`, two full runs (load average 27 and 41): 188 files passed, 2515 tests
  passed, 1 expected fail (the knownBug demo), 352 todo (the pending names: 355 minus the 3 worked entries). Both runs
  had one failure outside this tracer: `tests/unit/wizard-steps.test.tsx` "step 1 offers classes..." hits its
  hard-coded 15 s per-test timeout under load (dcm-t30, fixed by H3, which owns that file); it passes alone.
- The authz files on the second full run: `authz-matrix.test.ts` 2.7 s, `authz-synth.test.ts` 1.0 s, `core.test.ts`
  under 1 s.
