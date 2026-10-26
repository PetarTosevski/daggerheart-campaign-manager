# TASK-D12-H3: Unit tests stop timing out under full-suite load (dcm-t30)

Plan `.omc/plans/d12-hardening.yaml`, tracer H3 (wave 1). Bead dcm-t30. User answer (2026-10-21): make the slow tests
do less work, with one 15-second limit for unit tests, and cap parallel workers only if they still time out.

## Cause (profiled)

A CPU profile of `tier-boxes.test.ts` (node inspector, 0.5 ms sampling) put 37 of 47 s in `queryAllByRole`. Nearly all
of it was `computeAccessibleName` → `isHidden` → jsdom `getComputedStyle`, which cascades the UA stylesheet and parses
inline styles up the ancestor chain for every candidate element. `getByRole(role, { name })` does that for every
element of the role in the container on every lookup, so a lookup over a whole character sheet (hundreds of buttons
and checkboxes) costs seconds once the CPU is shared. `hidden: true` does not avoid it: testing-library still computes
the name of every candidate (measured, no gain). A missed `getByRole` is worse still: its error message prints the
container and every role in it.

## What changed

- **Lookups by label.** Elements named by `aria-label` or `aria-labelledby` are found with
  `getByLabelText(name, { selector })` (`input[type=checkbox]`, `input[type=radio]`, `button`, `article`, `section`,
  `[role=group]`, lists). It matches attributes and label text, with no style computation.
- **Visibility stays a role query.** Where the test checks that something is hidden (face-down Domain Deck cards are
  `aria-hidden`, the filter and hide toggle), the role query stays. The first attempt changed one of these to a label
  query and the test failed: the face-down card is in the DOM but hidden. So the test still checks that the card is
  hidden. Null checks that became label queries are stricter than before, because the element must be absent, not
  just hidden.
- **`hidden: true`** on unnamed role lists where visibility is not under test (`tier-boxes`: every box in the region is
  disabled; `sheet-render`: the read-only sheet has no buttons). Both now also count hidden buttons, which is stricter.
- **No throwing miss.** `photo-import-review` "is disabled while saving" asserted `expect(() => save()).toThrow()`;
  it is now `queryByRole(...)).toBeNull()`, the same assertion without the error-message dump.
- **Tablists scoped** (`sheet-render`): tabs are looked up inside the two tablists through one `tab(name)` helper,
  the Experiences heading inside its box, and the Notes textbox by its label. Added after full run 8.
- **One limit.** `vitest.config.ts` sets `testTimeout: 15_000` for the unit project, and for the convex project too.
  The convex tests passed 5 s in the baseline run as well (12 of 28 timeouts, see below), and a five-run acceptance on
  the full suite needs both. The per-test `15_000` in `wizard-steps.test.tsx` is gone; `tests/unit/**` has no
  per-test timeout.
- No assertion was removed or weakened. Rendering was already scoped: each file renders one component or the sheet
  it tests.

## Durations (A/B in one vitest run, same load, rebuild version vs this version)

Run 2026-10-21 20:33, load 4 to 9, 16 cores, `--project unit` with the ten files.

| File | Slowest test before | Same test after | File total before → after |
|---|---|---|---|
| wizard-steps | step 1 classes as radios: 6466 ms | 1630 ms | 11846 → 3839 ms |
| domain-deck-level-up | chooses the level's card: 10241 ms | 5528 ms | 18952 → 9501 ms |
| photo-import-review | is disabled while saving: 6618 ms | 211 ms | 10278 → 3960 ms |
| sheet-render | renders the board shell: 4331 ms | 4815 ms (first render and jsdom warm-up) | 18289 → 14662 ms |
| tier-boxes | open tier tickable: 3287 ms | 530 ms | 21233 → 8728 ms |

Alone at low load, sheet-render's queries now take 4.6 s for the whole file and domain-deck-level-up's 2.5 s; what is
left is the render of the full sheet plus the first `getComputedStyle` call of a file (about 0.9 s under load: jsdom
parses its UA stylesheet).

Baseline full `pnpm test` before the change (19:56, load 13 rising to 21): exit 1, wall 154 s, **28 timeouts in 19
files**: unit `domain-deck-level-up` (3), `tier-boxes` (3), `sheet-render` (2), `experiences-level-up` (3),
`encounter-damage` (2), `sprite-cut` (1); convex `schema-guard` (2), `combat-doors`, `combat-token-movement`,
`combat-tokens`, `combat-vision`, `combat-vision-sprites`, `countdown-rolls`, `death-moves`, `photo-import`,
`rest-frame-hooks`, `rolls`, `sessions`, `sprite-fields` (1 each).

## Five full runs (acceptance)

**Not met.** The longest clean streak was three runs in a row. Every run had 2478 tests. The machine is 16 cores, and
other worktrees were running their own suites at the same time (load 25 to 49).

A: a worker per core (vitest default), 15 s limit.

| Run | Exit | Wall | Load start → end | Timeouts |
|---|---|---|---|---|
| a1 | 0 | 86 s | 4.5 → 25.1 | 0 |
| a2 | 0 | 93 s | 25.1 → 29.2 | 0 |
| a3 | 0 | 108 s | 29.2 → 31.8 | 0 |
| a4 | 1 | 113 s | 31.8 → 33.8 | 1: convex schema-guard |
| a5 | 0 | 93 s | 33.8 → 30.5 | 0 |
| a6 | 0 | 123 s | 22.8 → 35.4 | 0 |
| a7 | 1 | 178 s | 35.4 → 43.5 | 1: schema-guard |
| a8 | 1 | 182 s | 43.5 → 44.2 | 9: schema-guard (2), combat-doors, combat-token-movement, combat-tokens, combat-vision, rest-frame-hooks, rests, unit sheet-render "▲ starts the guided level-up" |
| a9 | 1 | 155 s | 44.2 → 44.6 | 1: schema-guard |

B: `maxWorkers: "50%"` (the plan's last resort), same limit.

| Run | Exit | Wall | Load start → end | Timeouts |
|---|---|---|---|---|
| b1 | 1 | 402 s | 46.0 → 48.5 | 10: schema-guard (2), combat-doors, combat-token-movement, combat-tokens, combat-vision, notes-journals, rest-frame-hooks, sessions, unit domain-deck-level-up |
| b2 | 0 | 190 s | 48.5 → 34.2 | 0 |
| b3 | 1 | 238 s | 34.2 → 45.9 | 1: schema-guard |
| b4 | 0 | 233 s | 45.9 → 48.8 | 0 |
| b5 | 0 | 173 s | 48.8 → 34.7 | 0 |

**maxWorkers is not capped.** Halving the workers doubled wall time and did not remove the timeouts: they came from
the load other processes put on the machine, not from vitest's own workers. The cap is reverted.

Compared with the baseline (28 timeouts at load 13 to 21, 13 of them in jsdom files), the unit project timed out twice
in 14 runs, both at load above 43. Of the six runs that failed, all but two failed only on convex schema-guard, which
is outside H3's owns (below).

## Slow files outside H3's owns

Filed as bead **dcm-lm0**.

- `tests/convex/schema-guard.test.ts` (timed out in 6 of 14 runs): `publicFunctions()` imports every convex module
  (`await load()`) inside each of its two tests, so the transform and import count against the test. Load the
  modules once in `beforeAll`, or memoize the promise.
- `tests/convex/combat-doors`, `combat-token-movement`, `combat-tokens`, `combat-vision`, `rest-frame-hooks`, `rests`,
  `sessions`, `notes-journals` (timed out only at load above 45): one test runs every role against every function.
  Split it per role or per function (`test.each`).
- `tests/unit/experiences-level-up.test.ts` (3 baseline timeouts): `getByRole(..., { name })` over the full sheet.
  Use `getByLabelText` for names that come from aria-label, as the H3 files do.
- `tests/unit/encounter-damage.test.ts` (2 baseline timeouts): screen-wide `getByRole("button", { name })` for
  buttons named by aria-label ("Mark Hit Point 3 of 7", "Spotlight Bear"). Same fix.
- `tests/unit/sprite-cut.test.ts` (1 baseline timeout, 9.4 s): pixel loops over a full sheet image. Use a smaller
  fixture.
