# TASK-D12-H15: Unauthenticated sweep - generated Convex sweep and signed-out route sweep

Plan `.omc/plans/d12-hardening.yaml`, tracer H15 (depends on H0). Design: analysis section 3 and the user's answer to
Q3: a generated test that calls every server function signed out (it must refuse) and as a stranger (it must show
nothing), plus a browser test that every page sends a signed-out visitor to sign-in. No sweep against the real local
server.

## What landed

| File | Role |
|---|---|
| `tests/convex/unauthenticated-sweep.test.ts` | Every `publicFunctions()` name, found at runtime: signed out must be UNAUTHENTICATED, a signed-in stranger must get nothing. |
| `tests/e2e/unauthenticated.spec.ts` | Every page route, signed out, redirects to `/signin?next=<path>` and leaks no names; a non-member sees "Campaign not found". |

Both reuse H0 and touch no shared file: the inventory (`tests/convex/authz/inventory.ts`), the synthesizer
(`synth.ts`), the world (`world.ts`), the e2e fixtures (`signInAsTestGm`, `convexAs`, `bardDraft`, `E2E_PLAYER_EMAIL`).

## The Convex sweep

- **Which functions:** `publicFunctions()` at collection time (top-level await), minus `EXEMPT` (the three Convex Auth
  exports, which no wrapper defines). No hand-written list and no matrix entry needed: a new public function gets two
  tests the day it lands.
- **Signed out:** the call must throw `ConvexError` with `data.code === "UNAUTHENTICATED"`. The `maybeUserQuery` reads,
  found by `wrapperOf` (not listed by hand), must return `null`; a test pins that set to `campaigns:get` and
  `users:viewer`.
- **Stranger** (the world's `outsider`: allowlisted, signed in, in no campaign): the call must give NOT_FOUND, FORBIDDEN,
  `null`, `[]` or `{}`. Skipped: `STRANGER_OWN`, the 5 `user`-class functions (`campaigns:list`, `campaigns:create`,
  `settings:get`, `settings:update`, `members:joinByCode`) plus `users:viewer` (the caller's own account).
- **Any other error** (a validator error, a string payload, a TypeError) fails the row with that error (TE1).
- **World:** H0's `buildWorld()` (a real campaign with GM, two players with characters, a grantee, the outsider). On it run,
  best effort: every area's `setup` from `tests/convex/authz/*.entries.ts`, then `SEEDS`, ten GM calls with
  synthesized arguments that put a combat map, tokens, an encounter, a session, a notes page and a sprite pack in place.
  So the stranger is refused real rows of another campaign. A table that still has no row gets a well-formed id of a
  missing document (`missingId`), where the stranger must answer NOT_FOUND or `null` too.
- **Arguments:** `synthArgs` with the function's matrix area's `nameHints` and, when the matrix has an entry for the
  function, that entry's `args` (they pass validation that runs before the access check, such as a non-zero delta; H0
  pitfalls). Hints or args that read ids the entry's own setup registers (undefined here) are dropped, so the
  synthesized value stands. The sweep reads the matrix files but never needs them: with every area file empty it
  still runs every function.
- **World reuse:** like the matrix: refused calls roll back, so one world serves until a mutation resolves or an action
  runs.

### Counts (rebuild at fb12c57)

- Inventory: **358** public functions, **355** swept (3 exempt).
- **705 tests:** 1 inventory test, **355** signed-out rows (353 UNAUTHENTICATED, 2 null), **349** stranger rows
  (355 minus the 6 in `STRANGER_OWN`). That is 355 functions x 2 roles, minus the 6 skips.
- Stranger outcomes (a scratch run that logged each row): **345 NOT_FOUND, 4 null**. 302 of the 349 rows ran on real
  rows (298 NOT_FOUND; null from `campaigns:get`, `characters:get`, `codex:entryText`, which hide what a stranger may not
  see). 47 rows took a missing-document id (NOT_FOUND, and `members:revokeInvite` returning null for a missing invite):
  the tables are filled only by entry-level setups (action log rows, rests, token objects, notes entries, sprites,
  invites, uploads...). Before `SEEDS` it was 135 rows on missing ids.
- With every stranger exemption removed (scratch run), only `campaigns:create` (the new campaign id),
  `members:joinByCode` (the matrix entry passes the real join code: a stranger with the code joins, by design) and
  `settings:get` (the caller's own settings) returned data; `campaigns:list` gave `[]` and `settings:update` `null`.
  That is the 5 user-class functions.
- Time: about 22 s for the file alone (17 s of it loading the Convex modules), about 3 s of rows.

### Leaks found

**None.** No public function returned anything to a signed-out caller or a stranger, so no bead was filed.

### Proof that a new function is swept (scratch run, reverted)

Added `convex/zzSweepProbe.ts` with a raw `query` `leakName` and a `userQuery` `leakToStranger`, both returning the
campaign's name for any `campaignId`, then ran `pnpm vitest run tests/convex/unauthenticated-sweep.test.ts`:

```
× zzSweepProbe:leakName -> UNAUTHENTICATED
× zzSweepProbe:leakName -> NOT_FOUND | FORBIDDEN | null | empty
× zzSweepProbe:leakToStranger -> NOT_FOUND | FORBIDDEN | null | empty
AssertionError: zzSweepProbe:leakName signed out: value "Matrix": expected { value: 'Matrix' } to deeply equal { code: 'UNAUTHENTICATED' }
AssertionError: zzSweepProbe:leakName as a stranger: value "Matrix": expected false to be true
AssertionError: zzSweepProbe:leakToStranger as a stranger: value "Matrix": expected false to be true
Tests  3 failed | 706 passed (709)
```

The probe file was deleted; the sweep is green again (705 passed).

## The route sweep (e2e)

`beforeAll`: the test GM creates, through `convexAs`, a Witherwild campaign `Sealed <random>`, a join code and a Bard
`Vesper<random>`.

1. **Signed out**, for each route (`/`, `/new`, `/frames/witherwild`, `/campaigns`, `/join/<code>`, and the campaign
   routes: dashboard, `party`, `party/new`, `party/<characterId>`, `world`, `codex`, `adversaries`, `combat-map`,
   `combat-map/packs`, `sessions`, `notes`, `[section]` as `/timeline`):
   - `request.get(path, { maxRedirects: 0 })` answers 3xx with `location` `/signin?next=<encoded path>` (`/` goes to
     `/signin`, as `src/proxy.ts` does), and the body holds neither name;
   - in the browser the page lands on that URL and shows the sign-in form, and `page.content()` holds neither name.
2. **Signed-in non-member** (`e2e-player@example.test`, who never joins): every campaign route except `[section]` shows
   the heading "Campaign not found", and the HTML holds neither name. Signed in, `[section]` with a slug that has no board
   is a 404 from `notFound()` before any campaign data loads.

### Run

Ports 3172 / 3456 (`pnpm worktree:setup`), the local backend (`scripts/convex-e2e.mjs`) and `scripts/e2e-next.mjs`
started by hand, `E2E_REUSE_SERVERS=1`, load average about 13-20:

- `pnpm exec playwright test tests/e2e/unauthenticated.spec.ts`: **2 passed (17.3 s)**, then **2 passed (8.9 s)**.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean (tsconfig.json rewrite from the e2e build reverted first).
- `pnpm test --maxWorkers=4 --testTimeout=60000` (load average about 15): 195 files passed, 4008 tests passed, 1 expected
  fail, 188 todo; the sweep file passed. 2 files failed outside this tracer, on rebuild fb12c57 as merged (they fail
  alone too, with no H15 file involved): `tests/unit/sprite-catalog.test.ts` and `tests/unit/sprite-builtin-pack.test.ts`
  (30 tests; the catalog lists about twice the expected items, for example 1169 sprites against 589).
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H15`: passes.
