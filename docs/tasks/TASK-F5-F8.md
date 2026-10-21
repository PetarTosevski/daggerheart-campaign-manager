# TASK-F5-F8: Dice follow-ups - collapsible GM roll form, Waxing Moon +2 named on damage, Tag Team partner confirmation

Plan `.omc/plans/followups-5.yaml`, tracer F8 (no dependencies). Beads dcm-bxp.34, dcm-bxp.66 (TASK-SF-F4 G2) and
dcm-bxp.67 (TASK-SF-F4 G1). Client only: no server change was needed.

## Changes

| Bead | Where | What |
|---|---|---|
| dcm-bxp.34 | `roll-feed.tsx` | The GM's secret roll form sits behind a "Secret GM roll" disclosure button (`aria-expanded`, `aria-controls="gm-roll-form"`), open by default. Folding it hides only the form; the feed list stays. The choice is stored per device under `dcm:gm-roll-form-collapsed`. The feed's own fold and this one share one helper, `deviceFlag(key)`: localStorage read and written in try/catch, an in-memory fallback when storage throws, read with `useSyncExternalStore` (server snapshot: open). |
| dcm-bxp.66 | `dice-box.tsx` `rollLabel` | The damage result line names every automatic roll option, for example "Primary: Dagger (1d8+1) · Waxing Moon +2 (5 + 3)". These are the same `rollOptions(...).filter(o => o.auto)` that the server applies in `prepareDamage`. Under Roll options the "Waxing Moon +2 (always)" chip already showed. The bead's "no entry" claim did not reproduce: the spec and the RTL test both see the chip. Only the result label was missing it. |
| dcm-bxp.67 | `tag-team.tsx` | After a successful pick, the panel shows a confirmation ("Kai’s roll counts for both; the GM gains n Fear.", `role="status"`) with a Close button, once `pending` empties. This works even when the panel was never opened, as in the partner's box. Close returns to the "Tag Team Roll…" button. The initiator sees the same confirmation in place of the start form. |

The D12-H21 accessibility fixes are unchanged: `dice.css` is untouched, so the 44 px targets under the tablet media
query and the contrast fixes still apply.

## Tests

- `tests/unit/dice-ui.test.tsx` (RTL, 6 tests):
  - Waxing named in the result and listed as a chip; no mention in a Full phase.
  - The partner's confirmation after the pick, and Close.
  - The GM form is open by default, folds, is remembered after a remount and opens again; it still folds when storage throws; players never see it.
- `tests/e2e/dice-followups.spec.ts`, at 1440x900 and 390x844:
  - The GM folds the form, the feed stays, and a reload keeps it folded.
  - Mira (seeded: Moon mastery, moon die 2) rolls damage: the chip shows, the result line names "Waxing Moon +2", and the feed row agrees.
  - Bryn starts a Tag Team with Kai through the API; in Kai's box, with the panel never opened, the GM picks Kai's roll and sees "counts for both".
  - Every step is checked for no horizontal scroll.

## Verification

Backend and `scripts/e2e-next.mjs` were started by hand on E2E_PORT 3110 / E2E_CONVEX_PORT 3332, with
`E2E_REUSE_SERVERS=1`:

| Specs | Result |
|---|---|
| `dice-followups.spec.ts` | 2 passed |
| `dice`, `dice-3d`, `session-features-dice`, `session-features-flow`, `a11y-party` | 18 passed |
| `encounter-tracker`, `a11y-smoke`, `dashboard`, `live-dashboard` | 17 passed |

`pnpm lint`, `pnpm typecheck` and `pnpm test --maxWorkers=4 --testTimeout=60000` all pass (225 files, 5454 passed,
1 expected fail).

## Outside owns (note for the orchestrator)

Two comments in `tests/e2e/session-features-flow.spec.ts` are now stale: l.193 (the box's result line does not name
the bonus, G2) and l.214 (the partner gets no "counts for both" line, G1). Its assertions still pass. A later tracer
that owns the spec can tighten them: on l.194 assert "Waxing Moon +2" in `last-roll`, and after l.216 assert the
partner's status line.
