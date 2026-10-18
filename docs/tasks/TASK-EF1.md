# TASK-EF1: Spend Fear on environment features and start their countdowns

Status: Review. Plan: `.omc/plans/env-actions.yaml`, tracer EF1. User 2026-10-19: "add functionality to the environment
tab, let me spend fear for the effects / start the countdowns for the selected environments"; countdowns started this way
start Private (user's answer). Builds on EV1 (environment data), CV1 (countdown visibility), D8 A0 (`spendFear`).

## What was built
- `convex/environmentActions.ts` (keyed GM wrappers: player FORBIDDEN, outsider NOT_FOUND; args + returns validators):
  - `spendFear({environmentId, featureName})`: spends the feature's `fearCost` through `convex/lib/fear.ts` `spendFear`
    (reason `feature`, one `history` row, FEAR_EMPTY when the GM holds less) and writes a GM-only `actionLog` row
    (kind `feature`, no character, not undoable): "Spent 1 Fear: Undertow (Raging River)". Returns `{ fear, spent }`.
  - `startCountdown({environmentId, featureName})`: inserts a dashboard countdown named "<Environment>: <Feature>", the
    feature text as description (capped at 1000), consequence empty, category from the label (Consequence → consequence,
    Progress → project, otherwise threat), starting value from the label ("(6)", "(Loop 4)", "(Long-Term N)" → the
    number; "(Loop 1d4)" → rolled on the server inside `ctx.once`, so a retry keeps the roll), visibility Private, plus
    the countdown `history` create row (as `countdowns.create`). Returns `{ countdownId, name, startingValue }`.
  - Both: unknown environment or feature, or a Hope & Fear environment with the campaign's switch off → NOT_FOUND
    (`environmentsFor`, the catalogue's own rule); a feature without a Fear cost / without a countdown → INVALID.
- `src/lib/domain/environments/index.ts`: `environmentCountdownStart`, `environmentCountdownCategory`,
  `environmentCountdownName` (pure).
- `src/components/adversaries/environments/feature-actions.tsx`: `useEnvironmentActions` (optimistic Fear drop on
  `campaigns.get`, like the tracker's Spend Fear; the status line belongs to the environment it was written for),
  `EnvironmentFearBar` (GM Fear as the dashboard's token art, the number, "+ Fear" via `fear.adjust`),
  `FeatureActions` ("Spend N Fear", disabled with "No Fear to spend." / "You hold N Fear." as its description when
  short; "Start countdown"), `EnvironmentStatus` (`role=status`).
- `stat-block.tsx`: optional `top` and `renderFeatureActions` slots. `index.tsx`: takes `campaignId` and `fear`.
  `page.tsx`: passes them (the opened-adversary panel inside the Environment tab is unchanged).
- `environments.css`: `env-sb-top`, `env-fear`, `env-token*`, `env-act*` (parchment ink outline, Fear purple, 44 px).

## Acceptance evidence
- `tests/convex/environment-actions.test.ts` (10): spend (history + feed row), FEAR_EMPTY, INVALID / NOT_FOUND, start
  with a number / Loop / dice / Progress / Consequence label and categories, Private (player sees none), H&F off
  refused while Core works, player FORBIDDEN / outsider NOT_FOUND, idempotent replay.
- `tests/unit/environment-catalogue.test.ts` (+1): label parsing; all 17 printed countdown labels have a start value.
- `tests/e2e/environments.spec.ts` (+1, 6 total pass): disabled spend with reason at 0 Fear, "+ Fear", spend lowers
  dashboard Fear, status line, 44 px, Start countdown → GM dashboard shows "Mountain Pass: Icy Winds" Private 4/4; a
  player who joined by code sees no countdown.

## Deliberate choices
- No new error codes (`src/lib/errors/*` not owned): NOT_FOUND / INVALID from `common.ts`.
- Dashboard countdowns do not loop; a "Loop N" countdown starts at N and the GM restarts it by hand.
- Only features with a printed countdown label get "Start countdown". Countdowns mentioned only in a feature's text
  (Cliffside Ascent "The Climb" Progress Countdown (12), Haunted City "Apocalypse Then" Progress Countdown (5), the
  Heist's two countdowns) get no button.
- The Fear log row is not undoable (undo is per character); the Fear spend itself is in `history`.

## QUESTIONS
- Should text-only countdowns (The Climb, Apocalypse Then, Heist) also get "Start countdown"?
- Should a spent environment Fear be undoable from the feed?
