# TASK DA15: Oasis rerolls are a party pool; each holder closes their own panel

Plan `.omc/plans/drawer-answers.yaml`, tracer DA15 (bead dcm-bxp.99.19.54). Changes DA5 (docs/tasks/TASK-DA-DA5.md),
which followed SD-R (docs/tasks/TASK-SD-SD-R.md). Book pages are printed pages. HF = Hope & Fear.

## Book text and the answer

- Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take the
  higher result."
- User 2026-10-30, confirmed: after a short rest the party gets ONE reroll per Duneborne (Oasis holder). Any holder's
  "Reroll (keep higher)" spends one from the pool on ANY party member's downtime die. The same die can be rerolled again
  while rerolls remain, keeping the higher each time. When the pool is empty nobody can reroll.
- Each Duneborne player closes their OWN Oasis panel; closing withdraws that holder's unused reroll from the pool. The
  window ends when every holder has closed, or when the next rest starts. This replaces DA5's once-per-holder rule and
  its GM-wide close.

## The pool

Each reroll records whose reroll of the pool it spent (`spentFrom`). A holder's reroll is in the pool while their panel
is open and no reroll spent it. A reroll spends the pressing holder's own reroll first, else the first unused one in
holder order (the order `oasisHolders` stores). Closing a panel takes that holder's reroll out only if it is still
unused: a reroll another holder already spent stays spent. DA5 rows (no `spentFrom`) count as the presser's own.

`rests.closeResults` is **removed**, not kept as a GM "close for everyone": the user's answer replaces the GM-wide close.
The GM can still close a holder's panel on that holder's sheet (`closeOasis` takes `edit` on the holder, so the owner or
the GM), one holder at a time.

## What landed

| File | What |
|------|------|
| `src/lib/domain/rest/feature-moves.ts` | `oasisPool(dice, {holders, closed})` gives `left`, `unused` (holders whose reroll is in the pool) and `open` (holders whose panel is open). `oasisReroll(dice, index, holderId, rng, pool)` refuses (REST_RULE) a non-holder, a holder who closed, a missing die and an empty pool; it spends the holder's own reroll first, keeps the higher and records `spentFrom`. The same die can be rerolled again. |
| `convex/lib/validators/rests.ts`, `convex/tables/rests.ts` | Widened only: `oasisRerollValidator.spentFrom` (optional) and `rests.oasisClosed` (optional ids). `resultsClosedAt` is deprecated: no longer written, still read (a rest the GM closed under DA5 stays closed). |
| `convex/rests.ts` | `closeResults` removed. New keyed public mutation `rests.closeOasis {restId, characterId}`: `loadCharacter(..., "edit")`, the rest is the campaign's latest and ran as a short rest, the character is a holder; adds the holder to `oasisClosed` (closing twice is a no-op). Not logged: it changes no sheet. `oasisReroll` checks the pool through the domain. `current.last` gains `oasisClosed` and `oasisLeft`; `resultsOpen` now means the Oasis window is open (dice rolled, not closed under DA5, at least one holder's panel open). `rests.undo` also clears `oasisClosed`; the rerolls revert with the rest's actionLog group as before. Starting the next rest still ends the window (only the latest rest counts). |
| `src/components/party/rest/index.tsx`, `picker.tsx` | A holder's sheet shows `OasisDice` while the window is open and that holder has not closed: the dice, "N rerolls left for the party." (or "No rerolls left for the party."), a "Reroll (keep higher)" button on every die while the pool holds one, and a 44 px "Close Oasis" button described by "Closing gives up <name>'s unused reroll, if any." The picker's note says the holder adds one reroll to the party's pool. |
| `src/components/party/rest/launcher.tsx` | The GM's "Rest results" group shows while the window is open: the dice, the rerolls left and the holders whose panel is still open. No "Close results" button. |
| `tests/unit/rest-feature-moves.test.ts` | Pool: own reroll first, then another's; the same die twice keeping the higher; empty pool, non-holder, closed holder and missing die refused; closing withdraws only an unused reroll; DA5 rows count as the presser's own. The panel: the pool text, buttons while rerolls remain, none when empty, gone once this holder closed or all closed, the "Close Oasis" button and what it sends. |
| `tests/convex/rests-features.test.ts` | Two Duneborne: one holder spends both rerolls on the same die (`spentFrom` own then the other's), then the pool refuses both; undo reverts both rerolls. Per-holder close: refused before the rest ends, idempotent, withdraws the unused reroll, the closed holder can't reroll, the GM closes for a holder, the window ends when all closed, undo clears `oasisClosed`. A closing holder whose reroll another holder spent withdraws nothing; another player can't close a holder's panel (FORBIDDEN); a non-holder has no panel (REST_RULE). The DA5 tests keep passing with the pool (one holder, one reroll). |
| `tests/convex/authz/play.entries.ts` | `rests.closeResults` row removed; `rests.closeOasis`: `own` (anonymous UNAUTHENTICATED, outsider NOT_FOUND, other player FORBIDDEN, owner and GM pass and meet REST_RULE on the open rest). |
| `tests/e2e/rest.spec.ts` | The Oasis spec: the reroll empties a one-holder pool ("No rerolls left for the party.", no buttons, panel still up); the dashboard shows "0 rerolls left for the party. Still open: <hero>."; the holder's "Close Oasis" removes the panel and the dashboard's results group. |

## For the orchestrator

- `docs/data-model.md` (not owned): `rests` gains optional `oasisClosed` (character ids); each `dice[].rerolls[]` gains
  optional `spentFrom`; `resultsClosedAt` is deprecated (no longer written).
- `docs/tasks/TASK-DA-DA5.md` (not owned by DA15; the brief asked to change it): its once-per-holder rule and
  `closeResults` are superseded by this tracer. Suggested line under its title: "Superseded in part by DA15
  (docs/tasks/TASK-DA-DA15.md): the rerolls are a party pool and each holder closes their own panel; `closeResults` is
  removed." DA5's QUESTION 1 (who closes) and 3 (two holders on one die) are answered by DA15.
- No optimistic update on either button: the reroll is a server roll and closing hides the panel only once the server
  agrees; both buttons are disabled while a call runs.

## QUESTIONS

These are choices made where the answer did not say; each is easy to change.

1. **Whose reroll a holder spends once their own is gone.** With three Duneborne A, B, C, if A rerolls twice, the second
   reroll spends B's (the first unused in holder order, the order the rest stored them). If B then closes, nothing is
   withdrawn and C's reroll stays in the pool (one left). Had it spent C's, B's close would withdraw B's and the pool
   would be empty. Fine, or should the second reroll spend a particular holder's (for example the last one's)?
2. **A holder whose reroll another holder spent.** Their panel stays open (they can still spend a reroll another open
   holder left in the pool) until they close it. Fine, or should their panel close itself once the pool is empty?
3. **The GM's dashboard results.** The dice show on the dashboard only while the Oasis window is open (a party without a
   Duneborne no longer sees them there; DA5 showed them until the GM closed them). The actionLog feed still lists every
   die. Fine, or should the dashboard show the last rest's dice until the next rest?
4. **An Unconscious Duneborne** (DA5 QUESTION 2, still open): an Unconscious holder adds no reroll to the pool.
5. **Effects after the rest** (DA5 QUESTION 4, still open): the extra is cleared on the target's sheet as it is now.
