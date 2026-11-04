# TASK DA5: Oasis - the player picks the downtime die to reroll

Plan `.omc/plans/drawer-answers.yaml`, tracer DA5 (bead dcm-bxp.99.19.45 (1), with pins for (2), (4) and
dcm-bxp.99.19.47 (4)). Follows SD-R's open item (docs/tasks/TASK-SD-SD-R.md, "Not done" and QUESTION 1).
Book pages are printed pages. CB = Core Book, HF = Hope & Fear.

## Book text and the answer

- Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take the
  higher result."
- User 2026-10-30: the player picks. After the downtime dice are shown, a Duneborne gets a "Reroll (keep higher)" button
  on any party member's downtime die, once per short rest. This replaces SD-R's automatic lowest-die reroll.
- User 2026-10-30 (follow-up): the button is available ONLY while the short rest's results are first shown. Once that
  results panel is closed, the reroll is gone, and the server enforces it. Still once per Oasis holder per short rest.

## The results-panel marker

`rests.resultsClosedAt` (optional number, widened) is the server's marker. A rest that ran as a short rest and rolled
dice shows its results (`current.last.resultsOpen`: dice rolled and no `resultsClosedAt`): the GM's dashboard Rest panel
lists the dice in a "Rest results" group with a "Close results" button, and each Oasis holder's sheet shows the reroll
panel. `rests.closeResults {restId}` (keyed GM mutation, the latest ended rest only; closing twice is a no-op) sets the
marker; from then on `rests.oasisReroll` answers REST_RULE and both panels are gone. Starting the next rest ends the
window too (only the latest rest's dice can be rerolled). `rests.undo` clears the marker with the dice, so a rest
finished again shows fresh results.

## What landed

| File | What |
|------|------|
| `src/lib/domain/rest/feature-moves.ts` | `applyMovesWithOasis` is gone. `applyMovesWithDice` runs `applyMoves` and returns the dice it rolled, in roll order, each with its mover, move (`DICE_MOVES`: Tend to Wounds, Clear Stress, Repair Armor), ally target and tier. `oasisReroll(dice, index, holderId, rng)` rerolls one die, keeps the higher and gives the difference; REST_RULE for a missing die or a holder who already rerolled. `applyDieDelta` clears the difference on the move's resource (never below zero). |
| `convex/lib/validators/rests.ts` | Widened only (rule 7, CD4): `rests.dice` (optional array of `downtimeDieValidator`, with each die's `rerolls`) and `rests.oasisHolders` (optional ids). Rows from before have neither; `current` reads them as empty. |
| `convex/rests.ts` | `applyRest` stores the dice and the Oasis holders (resting, not Unconscious) when the rest ran as a short rest (a short rest, or an interrupted long one). New keyed public mutation `rests.oasisReroll {restId, characterId (the holder), die (index)}`: `loadCharacter(..., "edit")` (holder's owner or the GM), the rest is the campaign's latest and ran as a short rest, the holder is in `oasisHolders`, the die exists and the holder has not rerolled this rest; the server rolls, keeps the higher, saves the target's sheet with the extra cleared, patches the die and logs one public `rest` row in the rest's actionLog group, so `rests.undo` reverts it. `rests.undo` also clears `dice` and `oasisHolders`. `current.last` returns `dice` and `oasisHolders`. |
| `src/components/party/rest/launcher.tsx` | The GM's "Rest results" group (the dice, the Oasis note, "Close results") while `last.resultsOpen`. |
| `src/components/party/rest/index.tsx`, `picker.tsx`, `rest.css` | With no open rest and the results open, a holder's sheet (owner or GM) shows `OasisDice` (same lazily loaded module as the picker): the party's dice with the move, ally, kept result and tier, and a 44 px "Reroll (keep higher)" `<button>` on each (described by the die's text) until the holder has rerolled; then the kept result and "Used this rest." The picker's Oasis note now says the reroll comes after the dice are shown. |
| `tests/convex/rests-features.test.ts` | The reroll on an ally's die (kept higher, difference cleared, capped by what is marked), only holders, a missing die, once per rest, undo reverts it and clears the dice; a lower reroll keeps the first result; the GM rerolls for a holder; the open next rest and a long rest refuse; an interrupted long rest stores the dice and allows the reroll; an interrupted short rest stores none. Pins below. |
| `tests/unit/rest-feature-moves.test.ts` | `applyMovesWithDice`, `oasisReroll`, `applyDieDelta`; the dice list and button (44 px class, keyboard-reachable `<button>`, its description, the index it sends), the used state, no button without edit. |
| `tests/convex/authz/play.entries.ts` | `rests.oasisReroll`: `own` (anonymous UNAUTHENTICATED, outsider NOT_FOUND, other player FORBIDDEN, owner and GM pass and meet REST_RULE on the open rest). `rests.closeResults`: `gm` (players FORBIDDEN; the GM meets REST_RULE on the open rest). |
| `tests/e2e/rest.spec.ts` | A Duneborne's sheet after a short rest: both dice listed, Enter on a die's "Reroll (keep higher)", then "Used this rest." and no buttons; the GM closes the results on the dashboard and the sheet's Oasis panel is gone. |

The Convex test "Oasis only while the results are first shown" covers `closeResults` (refused before the rest ends,
idempotent), the refused reroll after it, and undo clearing the marker.

## Pins

- Efficient (CB p.53, dcm-bxp.99.19.45 (2)): a short rest takes at most one long rest move (SD-R's test, unchanged).
- Interrupted rests (CB p.105, dcm-bxp.99.19.45 (4)): an interrupted short rest gives no Hardy (and stores no dice); an
  interrupted long rest gives Hardy, the Celestial Trance move and Oasis; Efficient adds no long rest move there and a
  Clank's long rest move converts like everyone's (as built).
- Toxic Concoctions and Feed tokens are kept on an interrupted long rest and spent on a finished one
  (dcm-bxp.99.19.47 (4)).

## For the orchestrator

- `docs/data-model.md` (not owned): `rests` gains optional `dice` (downtime dice: `characterId`, `move`, `targetId?`,
  `sides`, `bonus`, `rolled`, `value`, `rerolls[{holderId, rolled, kept}]`), optional `oasisHolders` and optional
  `resultsClosedAt`.
- No optimistic update on the reroll button: the result is a server roll, so the client cannot predict it; the button is
  disabled while the call runs and the list updates from `rests.current`.
## QUESTIONS

These are choices made where the answer did not say; each is easy to change.

1. **Who closes the results panel.** User 2026-10-30: the reroll is available "only while the short rest's results are
   first shown". DA5 has one results panel per rest, the GM's on the dashboard: the GM's "Close results" ends every
   holder's window at once (players don't see the dashboard's rest panel once a rest is over). Should each holder close
   their own panel instead (a per-holder marker), or should closing also happen on its own (session end, a new scene)?
2. **An Unconscious Duneborne.** HF p.27 "you ... can reroll". An Unconscious PC rests but picks no moves (decision 9),
   so DA5 does not count an Unconscious holder for Oasis. Should they still get the reroll?
3. **Two holders on the same die.** "once per short rest" is per holder; DA5 lets a second Duneborne reroll a die the
   first already rerolled (keeping the higher again). Allowed, or one Oasis reroll per die?
4. **Effects after the rest.** The extra is cleared on the target's sheet as it is now (for example a Tend to Wounds die
   raised by 3 clears up to 3 more HP from what is marked now, even if the target took damage since). Fine, or should
   the reroll be refused once the target has changed?
