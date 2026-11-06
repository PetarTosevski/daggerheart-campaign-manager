# TASK-RULES-RX: death moves follow X1 and X2

Plan `.omc/plans/rule-switches.yaml`, tracer RX (epic dcm-jh6d, bead dcm-bxp.134). Rules: X1 "Death move prompt" and
X2 "Death moves resolve themselves" (CB p.106). User answer Q8 (a): two rows; X2 resolves to Manual and is read-only
while X1 is Manual (`resolveRuleModes`, RS0).

## X1 Death move prompt

| Mode | What happens when a PC marks their last Hit Point |
|---|---|
| Book | Today's behaviour: the player is asked (HUD modal, sheet strip), the GM confirms (HD4). |
| Manual | Nobody is asked. `deathMoves.state.awaitingMove` and `combatHud.party`'s `deathMoveDue` are false for everyone; `deathMoves.choose` is refused with `DEATH_MOVE_RULE`. A hit through `incomingHits` writes "Ash took Bear's hit and marked their last Hit Point" and a GM-only note "Ash marked their last HP: their death move is made at the table." in the hit's group (undone with the hit). The HUD still shows the PC down at 0 HP. A move already waiting for the GM can still be confirmed (it resolves by hand, X2 being Manual). |

## X2 Death moves resolve themselves

| Mode | Avoid Death | Risk It All |
|---|---|---|
| Book | Rolls the Hope Die, scar at or under the level (today). | Rolls the Duality Dice and applies the outcome (today). |
| Manual | Rolls nothing. The PC drops unconscious (no roll decides that). Public row "… Roll the Hope Die in the dice box; the GM marks any scar."; GM note "Avoid Death (Ash): roll the Hope Die; scar at or under level 1." | Rolls nothing, changes nothing; `deathMoveSpent` is set so the prompt does not reopen until the last HP is marked again. GM note: what each result does (less lethal: "goes to the infirmary or home instead of dying"). |

Blaze of Glory rolls nothing and is the same in every mode. The move row and its note share a group (the request's
group when the GM confirms a player's move, else `death-manual:<characterId>:<at>`), so one undo takes back both.
`deathMoves.undo` clears `deathMoveSpent`, making the move due again.

Castle High's less-lethal rule (HF p.127) works in every mode: Book applies it as before; Manual's note names it and the
GM sets the away status.

## Code

- Pure helpers, mode parameters defaulting to Book: `deathMovePrompted`, `resolvesItself`, `dropUnconscious`,
  `lastHpNote`, `manualMoveSummary`, `manualMoveNote` (`src/lib/domain/death/index.ts`).
- Server: `convex/deathMoves.ts` (`choose`, `makeMove`, `undo`, `state`), `convex/lib/incomingHits.ts` (the hit's note),
  `convex/lib/combatHud.ts` (`deathMoveDue`).
- UI: `deathResultText` (`src/components/party/death/waiting.tsx`) reads a Manual result (no dice).
- Tests: `tests/convex/rules-death.test.ts`, `tests/unit/rules/death-modes.test.tsx`.

## Known gap

`actionLog.undo` (the feed's Undo, `convex/lib/actionLog.ts`, outside RX) does not clear `deathMoveSpent`: undoing a
Manual Risk It All from the feed leaves the move spent until a Hit Point is cleared. `deathMoves.undo` (the sheet and
HUD) clears it. Other paths that mark the last HP (sheet edits, direct damage) post no X1 note; only `incomingHits` does.
