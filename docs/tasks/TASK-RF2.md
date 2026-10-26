# TASK-RF2 — No fourth short rest in a row

- **Plan:** `.omc/plans/rules-fixes.yaml`, tracer RF2 (settles decision 17)
- **Branch:** tracer worktree off `rebuild`

## Rule

- CB 105: "A party can take up to three short rests before their next rest must be a long rest."
- HF 176: "When the party takes three short rests in a row, their next rest must be a long rest."
- CB 105: "If a long rest is interrupted, the characters instead gain the benefits of a short rest (even if they've already had three short rests)."

## Change

- `mustLongRest(kind, shortRests)` (was `needsOverride`) and `SHORT_REST_LIMIT_MESSAGE` in
  `src/lib/domain/rest/moves.ts`.
- `rests.start` refuses a fourth short rest since the last finished long rest with `REST_RULE`
  and the CB 105 quote, in every frame. There is no GM override any more.
- Widen/narrow: the `override` arg of `rests.start` stays as an optional, ignored, `@deprecated`
  arg so older clients still validate. Narrow it in a later change. `rests.gmOverride` is no
  longer written. It is still read: by `rests.current`, and by Horizon's
  `horizonDaysPassed` for old rows. Narrow it once no row carries it.
- An interrupted long rest still gives short-rest benefits whatever the count. It does not
  reset the count: an interrupted long rest is not a long rest.
- The GM's rest panel disables "Start short rest" after three short rests and gives the
  reason (`aria-describedby`). The override checkbox is gone.

## Tests

- Unit: `tests/unit/rest.test.ts` (`mustLongRest`).
- Convex: `tests/convex/rests.test.ts`: a fourth short rest is refused even with
  `override: true`, and no row gets `gmOverride`. An interrupted long rest after three short
  rests still gives benefits, and the next short rest is still refused.
  `tests/convex/rest-frame-hooks.test.ts`: on Horizon a refused fourth short rest passes no day.
- E2E: `tests/e2e/rest.spec.ts`: after three short rests the button is disabled with the
  rule, and a long rest enables it again.
