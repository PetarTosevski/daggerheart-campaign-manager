# TASK-F7-H2: Martial Preparation downtime move; rest undo reads undoable; actionLog undoable index

Status: Review. Plan: `.omc/plans/followups-7.yaml`, tracer H2. Bead: `dcm-bxp.63` (Martial Preparation, plus the G6
follow-ups it carries). Previous work: `docs/tasks/TASK-F6-G6.md`.

## Goal
Martial Preparation works as the user answered, and the snapshot cleanup reads an index.

## User answers (binding, dcm-bxp.63)
- 2026-10-22: build as written (core class feature, CB p.48), automated in the dice roller.
- 2026-10-22: offered on short and long rests whenever the party has a Slayer at mastery rank; an ally's die is cleared
  at session end and gives a Hope (like the Slayer's); an ally holds up to their Proficiency in these dice; the Slayer's
  own die joins their pool, capped at Proficiency.
- From G6: `rests.status` reads the row's `undoable`; `actionLog` gets an `ALSO_RETENTION` note in schema-guard and an
  index `[undoable, at]` for the snapshot job.

## Book (CB p.48, Call of the Slayer, mastery)
"Martial Preparation: ... Your party gains access to the Martial Preparation downtime move." ... "You and each ally who
chooses this downtime move gain a d6 Slayer Die. A PC with a Slayer Die can spend it to roll the die and add the result
to an attack or damage roll of their choice."

## What changed
- Move id `martialPreparation` (widened): `restMoveValidator` (convex/lib/validators/rests.ts), `RestMove` and
  `MOVE_LABELS` ("Martial Preparation") in `src/lib/domain/rest/moves.ts`.
- Who offers it: `holdsMartialPreparation(sheet)` (session-features/holders.ts) is true for Call of the Slayer at mastery
  rank, never through a multiclass (CB 111 gives only the foundation card). `frameRestMoves` takes an optional
  `martialPreparation` flag and adds `MARTIAL_PREPARATION_MOVE` to every PC's extra moves on either rest.
  `restMovesFor(campaign, sheet, party)` passes it. `rests.current` (pickable moves) and `rests.choose` compute it from
  the resting party: a PC with status `active` holding the mastery card. An away, dead or retired Slayer gives nothing.
  Beast Feast does not forbid it, because it clears no Stress or HP and gains no Hope.
- The effect: `gainMartialPreparationDie(sheet)` (session-features/slayer.ts) adds one die to the sheet's
  `sessionFeatures.slayerDice`, up to the sheet's Proficiency. The Slayer's die and an ally's die use the same field, so:
  - the dice box spends it (server `spendSlayerDice` checks only the count);
  - session end clears it for a Hope each (`clearSlayerAtEnd` runs for every PC);
  - rest undo restores it, from the rest's `before` snapshots.
  `applyMoves` resolves the move on the mover only (`validateChoice` refuses a target) and logs
  "Martial Preparation: +1 Slayer Die (n/cap)" or "Martial Preparation: Slayer Dice full (n/cap)". Each pick counts,
  so taking the move twice gives two dice, up to the cap, like any core move picked twice. An interrupted long rest keeps
  the move (`interruptedMoves`).
- Spending an ally's die in the UI: `holdsSlayer` now means "holds Slayer Dice to spend". It is true for the Slayer
  card's holder or for any sheet with `slayerDice > 0`, so the dice box's "+ Slayer Dice" (dice-box.tsx) and the sheet's
  "Slayer Dice n/cap" chip (features/panel.tsx) show for an ally without editing either file. The strict check is the new
  `holdsSlayerFeature`, which `canStore` and `storeSlayerDie` use, so an ally is never offered "store a Slayer Die"
  after a roll with Hope. Weapon Specialist's reroll stays the Slayer's only (`holdsWeaponSpecialist`).
- Rest picker (src/components/party/rest/picker.tsx): picking the move shows a short explanation of the die.
- Rest Undo: `rests.current` sets `last.undoable` from the group's first actionLog row (`undoable` and not undone), not
  from `groupId` alone. A rest whose rows were stripped after 30 days no longer offers an Undo that `rests.undo` would
  refuse with UNDO_STALE.
- `actionLog` index `by_undoable_at` = `["undoable", "at"]` (convex/tables/actionLog.ts).
  `cleanup.stripActionLogSnapshots` reads undoable rows with `at < cutoff` through this index, 200 per run. Rows logged
  with `undoable: false` carry no snapshot, so they need no strip. A stripped row leaves the index range, so each run
  reads from the start. The job reschedules itself while a batch is full, with no cursor and no lookback window.
  `ACTION_LOG_STRIP_WINDOW_MS` is gone. The first run after deploy strips every older row, so the G6 backfill command is
  no longer needed. `from` and `cursor` are still accepted and ignored, for runs scheduled before the deploy.
- `tests/convex/schema-guard.test.ts`: an `ALSO_RETENTION` note for `actionLog`.

## Tests
- `tests/unit/rest-martial-preparation.test.ts`: tests the pure rules:
  - holder ranks and multiclass;
  - the frame flag in every frame, Beast Feast included;
  - no target allowed;
  - gain up to the cap, and the "full" line;
  - two picks give two dice;
  - an interrupted long rest keeps the move;
  - an ally's die is spendable and `holdsSlayer` is true for it, but the ally can't store;
  - session end clears the die for a Hope.
- `tests/convex/rests.test.ts` ("Martial Preparation"):
  - the move is offered only with a mastery Slayer (not at specialization), on short and long rests, and not once the
    Slayer is away; choose refuses it otherwise (REST_RULE);
  - the Slayer's pool and an ally's pool grow to their caps; undo takes the dice back;
  - an interrupted long rest keeps the move;
  - an ally spends the die on a damage roll, and the unspent die clears at `sessions.end` for a Hope.
  - "Undo only while undoable": `last.undoable` turns false once the rows are not undoable, and undo answers
    UNDO_STALE.
- `tests/convex/cleanup.test.ts`: tests that the strip works in batches through the index, and that rows of any age,
  undone rows included, are stripped in one pass with nothing left scheduled.
- `tests/e2e/rest.spec.ts` (new test): with a mastery Slayer (seeded with `sessionFeatures:seedForE2e`), the GM picks
  Martial Preparation for an ally on the sheet and finishes the rest. The ally's sheet then shows "Slayer Dice 1/1".
- No public function was added. `rests.current` and `rests.choose` keep their signatures; only the `moves` union
  widened. The authz matrix needed no change.

## Notes for the orchestrator
- Regenerate `convex/_generated` after the merge, for the new index.
- `docs/data-model.md`: `actionLog` gains `by_undoable_at`, and `restChoices.moves[].move` gains `martialPreparation`.
