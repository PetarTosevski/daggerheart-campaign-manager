# TASK-FP4: F5 Manual notes the Fear of adversary uses that run on their own

Status: Review. Plan `.omc/plans/finish-in-progress.yaml`, tracer FP4, bead dcm-bxp.134.4 (follow-up of
`docs/tasks/TASK-RULES-WF.md`, F5 `fearFeatures`, CB p.154).

## What changed

F5 Manual already took no Fear for every adversary run: `rangesFlag` gives the runner `fearFeatures: "manual"`, which
drops a use's upfront Fear costs (`withoutFearCosts`, src/lib/domain/adversary-effects/run.ts). The GM-clicked uses
(`adversaryAction`'s main feature, `environmentActions.spendFear`) also posted "Spend N Fear by hand"; the uses that run
without a click posted nothing, so their Fear was silently skipped.

`noteTriggeredFear` in `convex/lib/adversaryActions.ts` now posts the clicked uses' note (`fearFeatureNote`, built on
`fearByHandText`) for each of those runs under Manual. The amount is the use's Book upfront Fear read from the run's own
context (so a cost read from the trigger, My Turn, counts). The note has no `groupId`, so it is never undoable: it
changed nothing. Book posts nothing and spends as before.

| Path (convex/lib/adversaryActions.ts) | What runs without a click | Manual now |
| --- | --- | --- |
| `adversaryAction`, before the damage | `onAttack` `beforeDamage` uses: automatic ones, and reactions the GM opted into with the attack (`reactions`) | note per use with a Fear cost |
| `adversaryAction`, after the roll | `onHit` / `onMiss` automatic uses (Momentum's kind) | note per use with a Fear cost |
| `afterHitTriggers` | `onTargetMarksHp` / `onDealDamage` / `onDefeatPc` automatic uses after a hit resolves | note per use with a Fear cost |
| `pcRollAdversaryUses` | `pcRolls` automatic uses (and reactions, if a caller ever passes `reactions`) | note per use with a Fear cost (author: `actorId`, else the caller) |
| `pcEscape` | `pcEscapes` automatic uses | note per use with a Fear cost |

Not a path: `featureAsk` (convex/lib/adversaryFeatures.ts) only reads and already asks no feature Fear under Manual.
Reactions offered to the GM (`offers`, "Reaction available") run later through `adversaryAction` as a clicked feature,
which already notes. No other module runs adversary effects (cardRunner, combatActions, combatAreas and adversaryHits
read stat blocks only). Environments have no automatic uses: their Fear features run only from `spendFear`.

Data note: no printed adversary has an automatic use with a Fear cost today; every Fear-cost trigger in the SRD tables
is a reaction the GM opts into. The test therefore gives the Giant Rat test-only uses through `vi.mock` of
`src/lib/srd/adversary-effects/index`.

## Tests

`tests/convex/fear-features-manual-triggered.test.ts`: an automatic use on the attack's hit or miss, a reaction opted into
before the damage, and an automatic use on a PC's roll, each in Book (Fear spent, no note; NOT_ENOUGH_FEAR past the
GM's Fear) and Manual (0 Fear, nothing spent, the note, `undoable: false`).

## Open questions (Book behaviour kept as is)

1. Fear inside a use's steps (an `optional` or `pay` step's Fear cost) is not an upfront cost: the runner spends it in
   Book and in Manual alike, for clicked and triggered uses (`withoutFearCosts` drops `use.costs` only). An opted-in
   reaction takes all its optional steps (`optionalIds`). Should F5 Manual drop and note those too?
2. The triggered note is outside the use's undo group (never undoable, as asked). Undoing the attack leaves the note in
   the GM feed; the clicked uses' notes sit in the group and go with the undo. Keep, or join the group?
