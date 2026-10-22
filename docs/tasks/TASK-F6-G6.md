# TASK-F6-G6: Weapon Specialist and Martial Preparation in the dice roller; action-log snapshots stripped after 30 days

Status: Review (Martial Preparation waits on the user's answers; see Open questions). Plan: `.omc/plans/followups-6.yaml`,
tracer G6. Beads: `dcm-bxp.62` (Weapon Specialist), `dcm-bxp.63` (Martial Preparation), `dcm-c26` (snapshot retention).

## Goal
The two Slayer class features work as printed; old undo snapshots are cleaned up.

## User answers (binding)
- dcm-bxp.62 and dcm-bxp.63 (2026-10-22): build as written (core class feature, CB p.48), automated in the dice roller.
- dcm-c26 (2026-10-22): strip before-snapshots older than 30 days with an internal batched self-rescheduling cron; those
  rows stay in the log but are no longer undoable (the UI shows no Undo).

## Book (CB p.48, Call of the Slayer)
- Weapon Specialist (specialization): "once per long rest when you roll your Slayer Dice, reroll any 1s."
- Martial Preparation (mastery): "Your party gains access to the Martial Preparation downtime move." ... "You and each
  ally who chooses this downtime move gain a d6 Slayer Die."

## What changed
- Weapon Specialist (dcm-bxp.62), done:
  - `src/lib/domain/session-features/holders.ts`: `holdsWeaponSpecialist`, which is true for Call of the Slayer at
    specialization or mastery rank. A multiclass never counts, because it gives only the foundation card (CB p.111).
  - `src/lib/domain/session-features/slayer.ts`: `rerollSlayerOnes(sheet, dice, rng)`. If the holder's reroll is unspent,
    it rerolls each 1 once (a rerolled 1 stands). It then marks the featureUses entry `weaponSpecialistReroll` until
    `longRest` and returns a feed label, for example "Weapon Specialist: 1 -> 5, 1 -> 1". A roll with no 1 keeps the use.
    It also adds `weaponSpecialistUsed` and `WEAPON_SPECIALIST_KEY`, both exported from the index.
  - `convex/lib/rolls.ts`: `rollSlayerDice` now takes the sheet and applies the reroll with the server rng. This covers
    attack rolls (`spendSessionFeatures`) and damage rolls (`resolveDamage`), including manual rolls, because the Slayer
    Dice are always rolled on the server. The use is saved in the same sheet and log row as the roll, so undoing the roll
    gives the use back. The feed line shows the final dice and the reroll label.
- Snapshot retention (dcm-c26), done:
  - `convex/cleanup.ts`: `stripActionLogSnapshots` (internal) handles rows created in [`from`, `cutoff`), read by
    `by_creation_time` and paginated 200 per run (`ACTION_LOG_STRIP_BATCH`). It reschedules itself with the cursor until
    the range is done. For each row that is undoable or still has `before` / `adversaryBefore`, it unsets both snapshots
    and sets `undoable: false`. The row itself stays. `feed.list` already derives `canUndo` from `undoable`, so no Undo
    is shown, and `actionLog.undo` refuses with UNDO_STALE.
  - By default, `from` is `cutoff - 7 days`, so the daily run reads only rows aged 30 to 37 days instead of rereading
    every old row every day. Up to a week of missed runs is caught up. `actionLog` has no index on `undoable` (its table
    file belongs to another domain).
  - Backfill once after merge, for rows already older than 37 days:
    `npx convex run cleanup:stripActionLogSnapshots '{"from":0}'`.
  - `convex/crons.ts`: "strip old action log snapshots" runs daily at 05:07 (CD17: not on minute 0).
- Martial Preparation (dcm-bxp.63): not built (see Open questions). Today any sheet holding a Slayer Die can already
  spend it in the dice roller (`spendSlayerDice` checks only the count). The open part is how an ally gets the die.

## Tests
- `tests/convex/rolls.test.ts` ("Weapon Specialist ..."): with the server d6s stubbed through `crypto.getRandomValues`,
  the tests check that:
  - a damage roll rerolls each 1 once, sets the total, the use and the feed label;
  - an attack roll rerolls too;
  - once the use is spent, later 1s stand;
  - a roll with no 1 keeps the use;
  - undo gives the use back;
  - a foundation-rank Slayer never rerolls.
- `tests/convex/session-features.test.ts`: tests the pure rules (holder ranks and multiclass, reroll-once,
  short rest vs long rest expiry, no-op cases).
- `tests/convex/cleanup.test.ts` ("action log snapshots"): tests that:
  - batches of 200 reschedule until done;
  - old rows keep existing without `before` / `adversaryBefore` and become not undoable;
  - newer rows are untouched;
  - `feed.list` shows `canUndo: false` and undo answers UNDO_STALE;
  - the default 7-day window leaves older rows alone, and `from: 0` backfills them.
- No public function was added or changed in signature, so the authz matrix needed no change.

## Open questions / follow-ups (outside this tracer's owns)
- Martial Preparation needs a new downtime move. That means changes to `restMoveValidator`
  (convex/lib/validators/rests.ts), `src/lib/domain/rest/moves.ts` and index.ts, `convex/lib/restHooks.ts` and the rest UI,
  and none of these are in G6's owns. The mechanics questions are in the G6 report.
- `tests/convex/schema-guard.test.ts`: `actionLog` could get an `ALSO_RETENTION` note ("undo snapshots stripped after 30
  days, dcm-c26 cron"). The guard passes without it.
- `rests.status` reports `last.undoable` from `groupId` alone, so a rest older than 30 days whose rows were stripped still
  offers Undo, and `rests.undo` then answers UNDO_STALE. A fix in convex/rests.ts could read the row's `undoable`.
