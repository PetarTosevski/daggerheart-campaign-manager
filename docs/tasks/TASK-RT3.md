# TASK-RT3: Phone app follows the new rest settings

Status: Review. Plan: `.omc/plans/rest-ticks.yaml`, tracer RT3 (wave 2). Bead: dcm-674k. Builds on RT1's API
(`docs/tasks/TASK-RT1.md`); the user's decisions and answers Q1–Q3 are in the plan header.

## What changed

- `apps/mobile/src/features/dashboard/countdowns.tsx`
  - The GM countdown card shows "On long rest" and "On short rest" for every countdown type: Off, Fixed (a − / +
    stepper, 1..20), PCs who rested, Die and Die + PCs (a d4..d20 picker), and Automatic / Reminder once a setting is
    on. A summary line reads "On long rest: d6 + PCs who rested, Reminder" (`restTickAmountLabel`).
  - Every tap is one `countdowns.setRestTick` intent with the whole setting (or null for Off); picking a kind keeps the
    current mode, N and die size where they apply (new: fixed 1, d6, Automatic).
  - A chase card shows one control for the pair (sent through the party row, or the rivals row when the party side is
    cancelled); the server writes both rows. A cancelled countdown shows no control (the server refuses it).
  - The old long-term "Automatic / Reminder" switch and its `countdownTracks.setRestMode` call are gone. "Arm" is not
    shown for long-term countdowns (Q3: they never tick on rolls); every other type keeps it.
- `apps/mobile/src/features/dashboard/rests.tsx`
  - The after-rest panel mounts for every rest that fires a setting (`restTickRestFor`: a finished long or short rest
    and an interrupted long rest), reads the widened `afterRest` and is titled "Countdowns after the long rest" /
    "... short rest" by its `kind`.
  - Each reminder reads "Tick <name>? <amount> (<roll text>)" (just "<amount>" for a fixed amount) with a
    "Tick −<amount>" button calling `tickOnRest`.

## Out of scope

- The New countdown sheet (`apps/mobile/src/features/dashboard/gm-panels.tsx`) and the New chase form are unchanged:
  they create countdowns without rest settings; the GM sets them on the card afterwards.
- No optimistic updates: the phone's `useIntent` has none for any countdown control; the card follows the live query.

## Notes for the orchestrator

- `apps/mobile/test/features/dashboard/dashboard.roles.test.tsx` (not in RT3's `owns`) has an `afterRest` fixture
  without `kind`, which RT1 made required, so the harness's returns check fails three of its tests on master already.
  Fix at merge: add `kind: "long"` to that fixture (line 59).

## Tests

- `apps/mobile/test/features/dashboard/countdowns.roles.test.tsx`: payloads of every kind button (fixed 1, pcs, die d6,
  die + PCs d6), one idempotency key per tap, no `setRestMode` call; an existing setting's summary, stepper, mode, die
  size and Off payloads; stepper bounds 1 and 20; long-term without Arm; cancelled without a control; one control per
  chase pair sent through the party row.
- `apps/mobile/test/features/dashboard/rest-launcher.roles.test.tsx`: the reminder lines with and without a roll text,
  the button amount and the `tickOnRest` payload; the panel mounts after an interrupted long rest and not after an
  interrupted short rest; existing fixtures gain `kind`.
