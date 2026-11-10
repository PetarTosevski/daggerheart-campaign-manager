# TASK-NB1: adversary sheet effects in pcMods (dcm-12kx)

Status: Review. Plan `.omc/plans/next-batch-1110.yaml`, tracer NB1. Branch `nb1-adversary-sheet-mods` from `master`.

## Finding: the fix was already on master

`pcMods` in `convex/lib/adversaryHits.ts` already reads adversary sheet effects. Wave 10's E2.4 landed it
(commit 87e54808, "adversary sheet effects in pcMods (dcm-12kx)"), but nobody closed the bead. For each sheet
effect whose id matches `ADVERSARY_SHEET_EFFECT` (`/^card:([^/:]+)\/(.+):\d+$/`), it collects the steps of that
adversary feature's uses and returns `lastingModsOf(steps, label)`, with `sourceId` `<adversaryId>/<feature>`.
`sheetLasting` in `convex/lib/adversaryFeatures.ts` does the same.
`tests/convex/lane4-e2-hits.test.ts` ("dcm-12kx: a hit reads what adversaries put on the PC") already covered
Unstuck, Leechpoles and Ravenous.

So this tracer makes no code change. It adds tests only:

- `tests/convex/lane3-s4-adversary-data.test.ts`: the proof now expects `pcDamageMods` of a sheet carrying Unstuck to
  return `marksMultiplier` x2 on hope / armor / hp / stress. The header comment no longer says "doesn't read them yet".
- `tests/convex/adversary-sheet-effect-mods.test.ts` (new) covers:
  - `pcMods` sources: Unstuck and Afflicted.
  - `pcDamageMods`: Unstuck x2; Leechpoles +1 per `leechpole` token, and no bonus with no tokens.
  - `pcFlags`: Ravenous gives `cannotSpendHope`; Afflicted gives `cannotClearHp` and `cannotClearStress`.
  - No mods for a label the entry doesn't give, an unknown feature or an unknown adversary.
  - `pcResistance` stays undefined.

  These are pure reads, so no error paths are asserted.

## Not done (outside owns)

- **Duplicated code.** `ADVERSARY_SHEET_EFFECT` is defined in both `adversaryHits.ts` and `adversaryFeatures.ts`.
  The entry-steps lookup in `pcMods` repeats the adversary branch of `entrySteps` in `adversaryFeatures.ts`.
  Removing the copies would mean exporting the regex and `entrySteps` from `adversaryFeatures.ts`, which NB1 doesn't
  own.
- **Wave 10 reminders.** The bead says wave 10 drops "the hit half of" these reminders. All four live in
  `src/lib/srd/adversary-effects/` (NB1 only reads that folder), and each is still there with an older reason:
  - `t4-core.ts` Reality Quake (around line 897) and `t4-hf.ts` Burrowing Leechpoles (around line 459) still say the
    sheet effect id is "over the 40-character cap and can't be saved (dcm-s7hd)". `lane4-e2-hits.test.ts` shows such
    ids save now (dcm-s7hd), so that reason is stale. Each reminder still covers more than the hit: Unstuck's spends
    and other marks (dcm-q40t), and Leechpoles' 2d4 tokens step.
  - `t4-hf.ts` Hunger Pangs / Ravenous (around line 1680): stays for a roll's Hope spends (dcm-akc0).
  - `t4-hf.ts` Nightmare Stare / Afflicted (around line 1965): stays for rest and downtime clears (dcm-v3ek).
