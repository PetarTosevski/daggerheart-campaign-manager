# TASK-CV1: Countdown visibility

Status: Review. Plan: `.omc/plans/countdown-visibility.yaml`, tracer CV1. Builds on D2 countdowns (`TASK-104-dashboard-core-mechanics.md`).

## Request (user, 2026-10-19)

"On the timers: give me the option to A) make the timer entirely private B) make the timer public but the name & description private (or set any field to what i wish) and C) everything public".

## What works

- `countdowns.visibility` (optional, widened): `{ mode: "private" }` or `{ mode: "public", hidden: ("name" | "description" | "category" | "consequence" | "progress")[] }`. Absent means everything public, so countdowns made before CV1 don't change. The hidden list is normalised on write (one entry per field, canonical order), so it stays capped at five.
- `countdowns.create` takes an optional `visibility`. `countdowns.setVisibility({ campaignId, countdownId, visibility })` is a keyed GM mutation (`keyedGmMutation`): players FORBIDDEN, outsiders NOT_FOUND, and a countdown from another campaign or one owned by a frame tracker NOT_FOUND.
- `countdowns.listByCampaign` (`enough: "owner"`) returns everything to the GM, including `visibility`. Players get no private countdowns, and each hidden field comes back as `null`. Hidden progress blanks `currentValue` and `startingValue` but keeps the status. The redaction (`countdownForPlayer` in `src/lib/domain/countdowns`) runs on the server, so hidden values never reach the player's websocket.
- Frame-owned countdowns (`ownerKey` set) are unchanged. They keep their `revealed` flag and their own panels.

## UI

- The New countdown dialog has a "Who can see this" control with three presets: Private, Public, details hidden, and Public. The middle preset shows a checkbox per field (Name, Description, Category, Consequence, Progress); Name and Description start ticked. The dialog defaults to Public, which matches how countdowns behaved before CV1.
- Each GM card has a visibility badge (eye-off "Private", eye "Partly hidden", eye "Public"). It opens a "Who can see this" dialog with the same control.
- Cards now show the description (Notes) under the consequence.
- Player cards show hidden fields as dashed gold "Hidden" pills. A hidden name reads "Hidden countdown". Hidden progress shows a covered hourglass, "?" in place of the value, and a "The sand is covered" strip in place of the grains.

## Tests

- `tests/unit/countdown-actions.test.ts`: `countdownForPlayer` (private, partly hidden, all public), normalisation, presets.
- `tests/convex/countdowns.test.ts`: a countdown without visibility is public; A, B (default and any field, with hidden progress) and C; the player's result never contains the hidden strings; the GM changes visibility later; players get FORBIDDEN; outsiders, other campaigns and frame-owned countdowns get NOT_FOUND.
- `tests/e2e/dashboard.spec.ts`: the GM creates one countdown per preset, and a player who joined by code sees nothing of the private one, placeholders on the partly hidden one and everything on the public one. The GM then changes two countdowns from their badges, and the player's board updates live.
- `tests/e2e/visual/CV1.spec.ts`: GM cards, the New countdown dialog, the change dialog and player cards at 1440 and 390 (`test-results/visual/CV1/`).
