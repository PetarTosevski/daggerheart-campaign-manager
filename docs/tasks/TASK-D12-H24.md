# TASK-D12-H24: D12 end to end - pending list closed, full suite green twice, beads settled

Plan `.omc/plans/d12-hardening.yaml`, tracer H24 (depends on H0-H23). Bead dcm-bxp.11 (D12).

Status: Complete apart from the "green twice" acceptance. The suites were not green twice; "Suite runs" lists the
four real bugs that block it, each filed as a bead.

## What changed

- **No more pending list.** `tests/convex/authz/harness.ts`: `runMatrix` no longer declares an `it.todo` per pending
  name. `tests/convex/authz-matrix.test.ts`: a pending name no longer counts as listed, so the coverage test names it
  as missing, and the new test "no area lists a pending name" fails on any name in any area's `pending`. A public
  function without an entry or an exemption now fails CI. Before the change every area's `pending` was already `[]`
  (15 area files checked).
- `Area.pending` stays in the type, documented as "always empty", only because every `*.entries.ts`,
  `authz-synth.test.ts` and `unauthenticated-sweep.test.ts` still carry or read it and those files are outside H24's
  owns. Follow-up bead **dcm-bxp.119** removes the field and the `pending` mentions in `docs/testing.md` and
  `TASK-D12-H0.md`.
- **knownBug must name a bead.** New guard test "every knownBug names a bead": a `knownBug` value must match
  `dcm-<id>` (for example `dcm-bxp.101`). No entry carries a `knownBug` today, so there are no open-bead checks to
  make. (The demo entry in `authz-synth.test.ts` is not an area file and is not checked.)
- Self-tests for the guard: a pending name is reported both as missing and as a pending problem; a non-bead
  `knownBug` is reported; the missing/stale/duplicate test now uses entries and an exemption instead of pending names.
- **`tests/e2e/d12-flow.spec.ts`**: one test. (1) Signed out, `/campaigns` redirects to
  `/signin?next=%2Fcampaigns` with the test sign-in form. (2) The GM sets a table name, opens Settings > Saved data,
  shows the backup, changes the table name, pastes the backup back and restores it; the field and the server hold the
  backed-up name; the original settings are restored in `finally`. (3) `gmAndPlayer` (the player joins by code in a
  second browser): the GM sets Fear 3 and the player's dashboard shows III with no reload. (4) The GM's dashboard at
  1024x768: zero serious or critical axe findings (moderate/minor go to annotations; there were none) and no sideways
  scroll. About 14 s alone.
- `docs/design-port-roadmap.md`: D12 marked done.

## Suite runs

Measured 2026-10-22 in the H24 worktree on top of the integration branch (H0-H23, a8a01e2), with the local e2e
backend and `next start` on worktree ports, Playwright run with `E2E_REUSE_SERVERS=1` (docs/testing.md "Running e2e
on a loaded machine"). **The suite was not green twice.** The failures are listed with their causes.

| Run | Result | Time | Load average |
| --- | --- | --- | --- |
| `pnpm lint`, `pnpm typecheck` | clean | | |
| `pnpm build` | passes | 26 s (warm) | ~2 |
| vitest 1 | 235 files, 5626 passed, 1 expected fail, 0 failed | 85 s | ~20-38 |
| vitest 2 | 5625 passed, 1 expected fail, **1 failed** (notes-sharing) | 25 s | ~0.5 |
| e2e 1 (263 tests) | 235 passed, **28 failed** | 63 min | ~22-38 |
| e2e 1, the 28 rerun alone | 26 passed, 2 failed (combat-movement 1440, players password) | 7.9 min | ~1-3 |
| e2e 2 (263 tests) | 260 passed, **3 failed** | 20.3 min | ~2-3 |

The "1 expected fail" is the `knownBug` demo entry in `tests/convex/authz-synth.test.ts`, an `it.fails` on purpose.

Failure causes:

- **e2e 1, load timeouts (26 of 28).** Tests 50-106 ran while the host load average was 30 or more. They failed on the
  default 30 s test timeout, or with `Function execution timed out (maximum duration: 1s)` from the local Convex
  backend. All 26 passed when rerun alone at low load. No bead.
- **players.spec.ts:94 "email + password", real test bug, dcm-bxp.120.** It fails on any fresh backend. Earlier specs
  (lorekeeper-shell, notes-*) sign `e2e-password@example.test` in through the test sign-in first, so password sign-up
  is refused and the fallback sign-in answers "Wrong email or password." It failed in both full runs and alone.
- **combat-movement.spec.ts:48, real bug, dcm-bxp.121.** The player's page hangs after Ash walks through the open
  door: the "Close door 1" click never completes, the screencast stops, and the test hits its 300 s timeout. It is
  intermittent and happens at both viewports: 1440 failed 3 of 4 runs (twice alone at low load, once with a trace),
  and 390 failed in e2e 2.
- **auth-single-run.spec.ts:125, real bug, dcm-bxp.123.** A rejected cached token sometimes ends on the error screen
  "Your session has ended. Sign in again." instead of being refreshed. It failed in e2e 2 and in 1 of 3 runs alone at
  load average about 2.
- **vitest 2, notes-sharing.test.ts, real bug, dcm-bxp.122.** `notesSharing.shared` sorts by owner name and then
  `createdAt` only, so pages created in the same millisecond come back in either order. The test failed 3 of 6 runs
  alone.

`tests/e2e/d12-flow.spec.ts` passed alone (13.7 s) and in both full runs.

## Beads

- Filed: **dcm-bxp.118** (campaign export, analysis option B), **dcm-bxp.119** (drop the leftover `pending: []`),
  and from the suite runs **dcm-bxp.120** (players.spec password account), **dcm-bxp.121** (combat-movement hang),
  **dcm-bxp.122** (notesSharing.shared order), **dcm-bxp.123** (rejected token reaches the error screen).
- No knownBug follow-ups: no matrix entry carries a `knownBug`.
- No moderate a11y follow-ups: H20, H21 and H22 recorded no moderate or minor axe findings; the flow's scan found none.
  The one open tablet item is dcm-hlj (GM Fear spiral tokens under 44 px), already filed by H20.
- To close at merge (orchestrator): dcm-t30 (unit timeouts under load, fixed by H3). Already closed before H24:
  dcm-bxp.21, .23, .29, .51, .57, .64, .79, .88, .100, dcm-lm0, dcm-o95.
- dcm-bxp.11 (the D12 epic bead): close after the user confirms.
