# TASK-F9-J6: the Lorekeeper flow e2e recovers from a failed answer with Try again (dcm-bxp.82.9)

Plan: `.omc/plans/followups-9.yaml`, tracer J6.

## Problem

F8-I7 made the e2e fake model fail any question containing `FAKE-FAIL`, which shows the answer error card. But Try
again re-sends the same question text (`chat.tsx` `onRetry` -> `onAsk(question, …)`), and the fake has no state and
can't tell a retry from the first ask (the failed answer's empty text drops that turn from the history). So a retry of a
`FAKE-FAIL` question always fails again, and no spec could show the recovery.

## Decision

A backend switch, on the fake path only. `LOREKEEPER_FAKE_MODEL=fail` turns the fake model on (like `true`) and makes
every fake answer stream fail with `overloaded_error`, whatever the question (`convex/lib/claude.ts`:
`FAKE_FAIL_SWITCH`, `fakeModelEnabled`, `fakeEvents(request, fail)`, `fakeStream`).

- It reuses the existing `LOREKEEPER_FAKE_MODEL` variable, not a new `LOREKEEPER_FAKE_FAIL`. A new variable would have
  to be declared in `convex/convex.config.ts` (CF19: env is read only through the typed `env`), which is outside J6.
- It applies only on the local e2e deployment (`isE2EDeployment`) and only when the fake model replaces the API. The
  real model path never reads it, and a deployment with a real key ignores it like the `true` value.
- The `FAKE-FAIL` text trigger stays, because `tests/e2e/visual/D13-L6.spec.ts` uses it for the error card shot. It
  still fails every time, Try again included.

## Test

`tests/e2e/lorekeeper-flow.spec.ts`, "a failed answer shows the error card, and Try again gets the answer once the
model is back":

1. Sets `LOREKEEPER_FAKE_MODEL=fail` with `convexEnv`.
2. The player asks a books-only question and sees the error card ("The Lorekeeper couldn’t answer just now. Try again."
   with a Try again button).
3. Sets the flag back to `true` and presses Try again. The answer ("From the rules", with its book chip and Copy) shows
   under the failed card, which stays, and the question appears twice.

`finally` sets the flag back to `true` (the value `pnpm e2e:setup` sets), so a failing run leaves the backend usable.

## Follow-up

`docs/testing.md` still lists only the `FAKE-FAIL` text trigger. Add the `fail` switch there (outside J6's owns).
