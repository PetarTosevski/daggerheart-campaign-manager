# TASK DA10: Event engine - Unshakable on every Stress mark, stance drop ends Grappling's Restrain, Beastform ends on its events

Plan `.omc/plans/drawer-answers.yaml`, tracer DA10 (bead dcm-bxp.99.19.19; closes dcm-bxp.99.19.50 (1),
dcm-bxp.99.19.10, dcm-bxp.99.19.6 (1)). Depends on DA0, DA4, DA8, DA9. Status: Review. Book pages are printed pages
(CB = Core Book, HF = Hope & Fear).

## Book passages and user answers

- **Unshakable** (CB p.59, Firbolg): "When you would mark a Stress, roll a d6. On a result of 6, don't mark it." User
  2026-10-30 (dcm-bxp.99.19.50 (1)): the server rolls a d6 on EVERY Stress mark it makes, Stress paid as a cost too, and
  skips that Stress on a 6; the roll shows in the log; manual tracker clicks don't roll; one helper. CB p.92: "If you
  would mark Stress but your Stress is full, mark 1 Hit Point instead."
- **Grappling** (HF p.12): "On a successful attack within Melee range, you can spend a Focus or mark a Stress to
  temporarily Restrain the target or throw the target up to Close range." HF p.12, Dropping Out of Stances: "If you are
  already in a stance when you shift into a different stance, you automatically drop out of the previously active stance.
  You also drop out of your active stance when you take Severe damage or mark your last Hit Point. Otherwise, you drop out
  of your active stance at the end of the scene. When you drop out of a stance, you lose any ongoing benefits it
  provides." User 2026-10-29 (dcm-bxp.99.19.10): the Restrain ends when the stance drops.
- **Beastform** (CB p.30): "If you mark your last Hit Point, you automatically drop out of this form." CB p.32 Fragile:
  "When you take Major or greater damage, you drop out of Beastform." CB p.30 Evolution: "choose one trait to raise by +1
  until you drop out of that Beastform." CB p.34 Legendary Beast: "you retain all traits and features from the original
  form". User: Beastform ends on its end events and Evolution's +1 ends with it.

## What was built

### Unshakable: `convex/lib/unshakable.ts` (the one helper)

| Piece | What |
|---|---|
| `holdsUnshakable(sheet)` | Through `owned()`: a Firbolg, or a mixed ancestry whose second feature is Unshakable. |
| `rollUnshakable(count, rng)` | One d6 per Stress (each rolled separately), a 6 skips that one. |
| `unmarkSkipped` / `unshake(before, after, count)` | For a write that already marked `count` Stress: the difference between marking `count` and `count - skipped` from the tracks before is taken off, the overflow Hit Point included. |
| `markStressOn(sheet, amount)` | A direct mark (Recall Cost, Flow State). |
| `stressMarksIn(plan, who, isActor)` / `unshakePlan` | A card or feature plan's Stress on one creature: its paid Stress costs (the actor's) and its `mark` stress steps. |
| `unshakableText` / `logUnshakable` | "Unshakable d6: 3, 6 (1 of 2 Stress not marked)"; a public row in the caller's undo group with the d6s as its roll record (kind `feature`, or the caller's), so the caller's undo reverts it. |

Where it runs:

| Stress mark | File | Log |
|---|---|---|
| Every card and feature use's actor (costs and Stress steps) | `actorSheetAfter` (`convex/lib/cardRunner.ts`) runs `unshakePlan`; `unshakable.out` collects the roll | |
| Feature uses on the map / drawer | `resolveFeatureUse` (`convex/lib/featureRunner.ts`, outside owns): actor and allies | the use's notes (public row) |
| Card uses on the map | `resolveUse` (`convex/combatCards.ts`, outside owns): actor and allies | public row in the use's group |
| An adversary hit: Stress instead of HP and the attack's Stress riders | `resolveIncomingHit` (`convex/lib/incomingHits.ts`); runs before the after-hit uses so "when you mark a Stress" reads the result. The old after-hit auto run of Unshakable is skipped (it would roll twice). | public row in the hit's group; the GM line names it |
| Reaction cards / features in the window and after-hit answers | `respondToHit`, `respondAfterHit`, after-hit autos (`incomingHits.ts`) | public row in the hit's group |
| An adversary feature's Stress without a hit | `commit` (`convex/lib/adversaryActions.ts`, outside owns) | public row in the action's group |
| The Hand's Recall Cost | `moveCardFor` (`convex/lib/cardHand.ts`) | the recall row ("recalls X (1 Stress; Unshakable d6: 6 (1 Stress not marked))") |
| Rest timing uses (Wild Surge's rest Stress) | `runRestTiming` (`cardHand.ts`), with the rest's dice | the PC's rest row |
| Flow State's "Shift - 1 Stress" | `shiftStance` (`convex/combatFeatures.ts`) | the shift row |
| Manual tracker clicks (`characters.adjustResource`, the drawer's tracks) | not rolled | |

### Grappling's Restrain ends when the stance drops: `convex/lib/stanceDrop.ts`

- `stances.ts`: Grappling's restrain condition carries `endsOn: ["stanceDrops"]` (DA0's event).
- `writeSheetChanges` (`cardRunner.ts`): when the actor gives a condition with that event to another creature, the
  actor's sheet gets a marker effect `sd:<target token id>` ("Restrained on a target until your stance drops; condition:
  restrained", until `manual`). No schema change: a sheet effect.
- `withoutStance` (pure): the sheet without its active stance and its markers. `endStanceConditions`: each marker's
  condition comes off the encounter instance on that token (standard condition or tag); returns `adversaryBefore` and feed
  lines. `dropStance` = both.
- Where the stance drops:
  - a shift to another stance (`combatFeatures.shiftStance`): the shift row and a GM row with `adversaryBefore` in one
    group, so undoing the shift restores the Restrain;
  - the scene's end (`endScene`, `convex/combatScenes.ts`; also the dashboard's `scenes.end` and an encounter's end): the
    campaign row carries `adversaryBefore`, undo restores it;
  - NOT a rest (deviation from the acceptance line, see QUESTIONS 1): `convex/lib/restHooks.ts` is unchanged;
  - a hit that is Severe or marks the last Hit Point (`resolveIncomingHit`): the hit's group (GM row `adversaryBefore`),
    the public row says "drops out of their stance". Severe is in the book (HF p.12) though the plan's line names only
    the last Hit Point.

### Beastform ends on its events: `beastformEnds` (`convex/lib/incomingHits.ts`)

After a resolved hit, `beastformEnds(sheet, { lastHp, severity })` reads `activeBeastform` and `beastformEndsOn`:
`lastHp` for every form, `majorDamage` (severity Major or Severe after armor) for a Fragile form, an Evolved form's
Fragile base, or a Hybrid that picked Fragile. It removes the `beastform` effect and `evolution` with it (as
`classFeatures.endEffect`'s `ENDS_WITH`), in the hit's group; the public row says "drops out of Beastform".

## Tests

- `tests/convex/unshakable.test.ts`: the helper with fixed dice (holders, one d6 per Stress, overflow HP, direct marks,
  plan counting, feed words); Recall Cost (6 skipped, 5 marked, undo), a manual tracker click doesn't roll, a feature's
  2-Stress cost (6 and 2: one marked, notes, undo), Flow State's shift, an adversary hit's Stress riders (row with the
  d6s in the hit's group, undo).
- `tests/convex/stance-drop.test.ts`: the Grappling entry; the marker from `writeSheetChanges`; `withoutStance`; a shift,
  the scene's end, a rest (leaves both), a Minor hit (nothing) and a Severe hit (drops, undo restores).
- `tests/convex/beastform-ends.test.ts`: `beastformEnds` (Fragile, last HP, Evolved base); a Fragile form on Major with
  Evolution and undo; a non-Fragile form stays on Major and drops out on the last Hit Point.

## Outside owns (named)

- `convex/lib/featureRunner.ts` (the plan header says "DA10 / DA12 own featureRunner.ts", the owns list doesn't): log the
  actor's roll in the notes, roll for allies.
- `convex/combatCards.ts`: log the actor's roll, roll for allies.
- `convex/lib/adversaryActions.ts`: Unshakable on a feature's Stress without a hit (the PC writes live here, not in
  `adversaryFeatures.ts`, which is unchanged).
- `tests/convex/feature-prompts.test.ts` (DA12's Charge test): its Firbolg now rolls Unshakable on Charge's Stress, so
  the test sets that d6 to 1 (without it the test failed one run in six).

## QUESTIONS

1. **Does a rest drop the stance?** HF p.12: "Otherwise, you drop out of your active stance at the end of the scene." The
   book doesn't name a rest. The plan's acceptance says dropStance runs "on a rest", but SD8's answer pins the opposite:
   `tests/convex/feature-hooks.test.ts` "rests leave scene limits and the active stance alone (Q3)" (docs/tasks/
   TASK-SD-SD8.md: "Rests and hits behave as before (Q3)"), and DA10 must leave existing tests unchanged. Built: a rest
   leaves the stance, so the Restrain stays (`stance-drop.test.ts` pins it). If a rest should drop the stance, it is a
   rest hook calling `withoutStance` + `endStanceConditions` and that SD8 test changes.
2. **Restrained twice.** The encounter instance keeps one `restrained` flag. Built: the stance drop takes it off even if
   something else also Restrained the target. Should the drop leave it when another source holds it (needs a source on
   instance conditions)?
3. **Unshakable and the overflow Hit Point.** CB p.92: "If you would mark Stress but your Stress is full, mark 1 Hit Point
   instead." CB p.59: "When you would mark a Stress, roll a d6. On a result of 6, don't mark it." Built: the d6 is rolled
   for a Stress past a full track too, and a 6 marks neither the Stress nor the Hit Point. Agreed?
4. **Unshakable on a Stress cost.** User: "including Stress paid as a cost". Built: on a 6 the use still happens and the
   Stress isn't marked. Agreed?
5. **Severe damage drops the stance.** HF p.12: "You also drop out of your active stance when you take Severe damage or
   mark your last Hit Point." The plan's line names the last Hit Point only; SD8 said "hits behave as before (Q3)" about
   the `hit` expiry. Built: a resolved adversary or card hit that is Severe (after armor) or marks the last Hit Point drops
   the stance, as the book says (no existing test pinned otherwise). Agreed?
6. **Fragile on Evolved and Hybrid forms.** CB p.34 Legendary Beast: "you retain all traits and features from the original
   form". Built: Legendary / Mythic Beast of a Fragile form drops out on Major damage; a Hybrid drops out only when it
   picked Fragile as one of its features. Agreed?

## Follow-ups (not done)

- Riders (`convex/lib/combatActions.ts` `runRiderPart`, `convex/combatCards.ts` riders path) and
  `convex/lib/adversaryActions.ts` line ~1102 call `actorSheetAfter` without collecting the roll: Unshakable applies there
  but the d6 is not logged (e.g. Grappling's "mark a Stress" on a rider).
- `convex/lib/adversaryActions.ts` `commit` counts a feature's Stress from the track's rise: a Stress past a full track
  (overflow HP) there is not rolled.
- `sessions.end` (`expire(sheet, "session")`, convex/sessions.ts) drops the stance without `dropStance`: a Restrain
  marker and the instance's Restrained stay. Use `withoutStance` + `endStanceConditions` there.
- The marker shows in the sheet's effect list with an End button; ending it by hand removes the marker, not the
  condition.
- `HitResolution.stressMarked` still reports the window's count before Unshakable.
- DA0's task doc names "DA11" for the Unshakable rolls and `stanceDrop.ts`; that work is DA10.

## Checks

See the report: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `tests/e2e/combat-feature-reactions.spec.ts`,
`node scripts/tracer-guard.mjs .omc/plans/drawer-answers.yaml DA10`.
