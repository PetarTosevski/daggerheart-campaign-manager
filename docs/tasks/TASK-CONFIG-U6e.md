# TASK-CONFIG-U6e: Names, range circles, sort orders and roll folds on the account

Plan `.omc/plans/config.yaml`, tracer U6e (bead dcm-jh6d.24). Q15 b says every value the browser kept moves to the
account. The Combat Map's Names switch and range circles, the adversary and environment sort orders, and the roll feed,
GM roll form and free roll folds are now stored in `userUiState` (server: P2, `uiState.get` / `uiState.set`), so they
follow the user to every device. The Combat HUD's layout and look are unchanged. Only the place the values are stored
moved.

## What changed

- `src/lib/use-ui-state.ts` (new): `useUiState(key)` returns `[value, setValue]`.
  - It reads `uiState.get`. While that loads, the value is the key's default (`UI_STATE_DEFAULTS`).
  - It writes `uiState.set({ change: { key, value } })`, a single-field intent (rule 12), with the optimistic update
    `uiStateLocally`. That update puts the key's new value into the cached `uiState.get` and does nothing until the
    query has loaded.
  - If the write is refused, Convex rolls the change back and the HUD toast shows the refusal
    (`hudToasts.refusal(refusalFor(error))`). Off the HUD (the dashboard's roll feed, the catalogues) no toast host is
    mounted, so the rollback is the only sign.
- `map-view/use-viewer-flag.ts`: deleted. Its last caller was `useShowNames`. `NAMES_KEY` is gone too; the legacy key
  stays in `LEGACY_KEYS` for IMP.
- `map-view/controls.ts`: `useShowNames()` is now `useUiState("tokenNames")`.
- `tokens/rings.ts`: `useRings()` works over `useUiState("rangeRings")`, and the new list replaces the old one whole.
  - The new `toggledRings` turns a token's circles off, or adds the token as the newest and caps the list with
    `capRangeRings`: at most `RANGE_RINGS_MAX` (50) tokens, the oldest dropped first. The old browser cap was 200; the
    server's limit is 50.
  - `hideAll` writes nothing when none of the given tokens has circles on.
- `adversaries/catalogue/index.tsx` and `adversaries/environments/index.tsx`: the sort is
  `useUiState("adversarySort")` / `useUiState("environmentSort")`, and choosing an order still resets the page length.
- `party/dice/roll-feed.tsx`: `deviceFlag` is gone. The three folds use `useUiState("rollFeedCollapsed")`,
  `useUiState("gmRollFormCollapsed")` and `useUiState("freeRollFormOpen")`.
- None of these files reads or writes localStorage or sessionStorage any more; a test greps them to check.
- `tests/unit/use-ui-state.test.tsx` (new) covers:
  - `uiStateLocally`.
  - Every key: the default while loading, the account's value once loaded, a one-key write with the optimistic update,
    and no browser storage.
  - A refusal toast.
  - The Names switch, `toggledRings` (including the 50 cap) and `useRings`.
  - The storage grep over the moved files.

## Signed out

Signed out isn't handled in the hook. These screens sit behind sign-in: a userQuery from a signed-out viewer throws
`UNAUTHENTICATED`, and that error goes to the route's boundary like any other campaign query. While auth or the query
loads, the hook returns the defaults. I did not add `useConvexAuth`, because none of the 82 unit tests that mock
`convex/react` mocks it.

## Old browser values

IMP isn't built (Questions 2026-11-05: take the defaults). Old values stay in this browser's localStorage untouched, and
the account shows its own values or the defaults until IMP imports them.

## Out of owns (orchestrator OK'd)

- `tests/unit/hud/dock.test.tsx`: its `useMutation` mock records calls. The Names test expects
  `uiState:set { key: "tokenNames", value: true }`, then rerenders with `uiState.get` saying on, instead of reading
  localStorage `dh.combat.names`.
- `tests/unit/dice-ui.test.tsx`: the GM roll form test expects `uiState:set` for `gmRollFormCollapsed` and gets the
  folded state from a mocked `uiState.get`. The "storage throws" case was removed, since no storage is used now.
- `tests/unit/free-roll.test.tsx`: the player's Roll dice test expects `uiState:set { key: "freeRollFormOpen" }` and
  rerenders with `uiState.get` saying open. The mocked `useQuery` serves `uiState:get`.
- `tests/e2e/fixtures.ts`: `signInAsTestGm` also resets every UI-state key to its default. The test accounts are
  shared, so without the reset one spec's fold, sort or circles would leak into the next (approved in the brief).

## Checks

- `pnpm lint` and `pnpm typecheck` pass.
- Focused vitest passes: `use-ui-state`, `dice-ui`, `free-roll`, `hud/dock`, `hud/panels`, `hud/make-room`.
- The full vitest suite (`--maxWorkers=1 --testTimeout=120000`) passes: 552 files, 11892 tests, plus 1 expected fail
  and 1 todo.
- e2e on ports 3981 / 4081, `--workers=1`, servers started by hand with `E2E_REUSE_SERVERS=1` (the managed build timed
  out while vitest ran): `dice-followups`, `environments`, `adversaries`, `combat-tokens`, `hud-dock` and
  `live-dice-mixed` all pass, 15 tests. `dice-followups` checks that the GM roll form stays folded after a reload,
  which is now stored on the account.
- `pnpm tracer:guard .omc/plans/config.yaml U6e`.
