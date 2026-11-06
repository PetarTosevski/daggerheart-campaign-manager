# TASK-RULES-DEF: D8 Manual Defeated button; adjustResource follows D4 / D5; rule leftovers

Plan `.omc/plans/rule-switches.yaml`, tracer DEF (beads dcm-jh6d.68, dcm-jh6d.71, dcm-jh6d.69). Built on RDM
(`docs/tasks/TASK-RULES-RDM.md`, D8 Manual as built: tracker only), RX (`TASK-RULES-RX.md`) and RFC (`TASK-RULES-RFC.md`).

## D8 Manual: the GM's Defeated button (jh6d.68, user 2026-11-06)

CB p.208: "When an adversary marks their last Hit Point, they are defeated." Under Manual the app leaves the adversary
up at its last HP and tells the GM "<adversary> marked its last HP: defeated?" (RDM). The GM now answers with a button.

| Piece | Behaviour |
|---|---|
| `encounterTracking.markDefeated({ instanceId })` (keyed GM mutation) | Sets the instance's `defeated` flag. ENCOUNTER_RULE in Book, for a Minion group, before the last HP is marked, or when already defeated; ENCOUNTER_NOT_RUNNING outside a running encounter. One undoable GM-only `adversary` row "Bear marked defeated" with `adversaryBefore`, so the GM's undo stands it back up at its last HP. No public line (the Book's defeat writes none). |
| Stored flag | None new: the existing `encounterAdversaries.defeated` boolean is the flag. Under Manual nothing but this button sets it (`defeatedAfter`), so no schema change was needed. |
| `adversaryDown(instance, rules)` (`convex/lib/combatTokenViews.ts`) | Book: the flag or every HP marked. Manual: the flag only. A Minion group still falls with its last Minion (D6, as `instanceWrites`). |
| Readers | Token `stats.down` (`combatTokenViews.viewsOf`), `adversaryDefeated(campaign, instance)` (`convex/lib/spotlight.ts`: spotlight / take-with-Fear ADVERSARY_DEFEATED), `loadActor` (`convex/lib/adversaryFeatures.ts`: the adversary's attack and features), `encounterTracking.spotlight` and `reviveInstance`. |
| Tracker card | "Last HP" badge plus a **Defeated** button (optimistic). |
| HUD stat block | "Last HP" line with a **Defeated** button (`ruleSettings.get`; Book until loaded). |
| Tracker D8 for Minion groups | `markHp` / `markStress` on a Minion group use the Book D8 (no note, defeated with its last Minion). |

## adjustResource follows the switches (jh6d.71)

`characters.adjustResource` passes `ruleModesOf(campaign)` to `applyResourceDelta`. D4 Manual (CB p.92): Stress past a
full track is dropped, no HP, and the GM gets "Ash: Stress full, mark 1 HP?". D5 Manual follows `markStress`. The
write is unlogged, so the note has no group and is never undoable.

## Leftovers (jh6d.69)

- `undoEntry` (`convex/lib/actionLog.ts`) clears `deathMoveSpent` for every character whose death row the undone group
  holds (as `deathMoves.undo` does): undoing X2 Manual's Risk It All from the feed makes the move due again.
- X1 Manual note on the other last-HP paths: `characters.adjustResource` (HP, and Stress overflow into HP),
  `characters.applyDamage`, `characters.updateSheet` (a lowered maximum). Text as the hit path's: "Ash marked their last
  HP: their death move is made at the table." No characterId / groupId (unlogged writes). Only when the move becomes due
  with the write.
- X1 Manual: the GM and a co-GM may record a death move with `deathMoves.choose` (players still DEATH_MOVE_RULE). The
  move then follows X2 (Manual while X1 is Manual). `deathMoves.state.gmRecord` (true for the GM while a move is due and
  nobody is asked) drives the GM queue's new card `GmDeathRecord` (`hud/queue/death-record.tsx`): the three moves and
  "Record the death move"; it counts in "Waiting on you".
- `buildRun` callers: `allyPicks.completeRider` posts the rider's `ruleNotesOfUse` (M1, C1, D4) in the attack's group
  (a Defined Ranges "who is in range?" note is left out: the actor's review chose the choosers). The rider writes no
  adversary row, so no `instanceWrites`. `featurePrompts` (`charge`, `allyRoll`) runs through
  `featureRunner.resolveFeatureUse`, which already posts the RFC notes and passes the modes to `instanceWrites`.

## Not done (outside DEF's files)

1. `tests/convex/rules-death.test.ts` "Manual: choose is refused for the player and the GM" now fails on purpose: the GM
   row must expect `ok` (user 2026-11-06). Change its GM line to the GM recording the move (`hopeDie: null`).
2. The HUD's `isDefeatedRow` (`src/components/combat-map/hud/spotlight/model.ts`, read by the spotlight disc and the
   revive model) still adds "every HP marked": it should read `stats.down` alone (the server's `down` is D8-aware), and
   `tests/unit/hud/spotlight-disc.test.tsx` "isDefeatedRow" drops its `{ hp: 8, hpMax: 8, down: false } → true` case.
3. `src/components/combat-map/tokens/use-tokens.ts` optimistic `applyMark` uses the Book D8 (a brief grey under Manual
   until the server answers).
4. A follow-up roll (Double Swipe's second attack) posts no R3 note and moves no spotlight: `afterPcActionRoll` runs
   once for the use's main roll in `convex/combatCards.ts` and `convex/lib/featureRunner.ts` (OE2's files); and the
   "R3 stays Book here" comment in `convex/combatCards.ts`.
5. The riders in `convex/lib/combatActions.ts` / `convex/combatCards.ts` (RFC "Not done" 2) are not DEF's.
