# TASK-RULES-RR: rest rule switches (F2, T2, T4)

Plan `.omc/plans/rule-switches.yaml`, tracer RR (epic dcm-jh6d part A). Modes are read through `ruleModesOf` /
`ruleMode` (`convex/lib/ruleModes.ts`); Manual notes go through `postRuleNote` (GM-only `actionLog` row, kind `rule`).
Pure functions in `src/lib/domain/rest` take the mode as a last parameter that defaults to Book.

## F2 Fear from rests (`fearFromRests`)

| Mode | Book passage | What the app does |
|---|---|---|
| Book | CB p.105: "On a short rest, they gain 1d4 Fear. On a long rest, … 1d4 + the number of PCs" | Unchanged: `restFear` on finish |
| Extended downtime | CB p.181: "If you're fast-forwarding the story across multiple days (or longer) … You gain 1d6 Fear per PC" | Q7 (a): the launcher offers "Extended downtime (several days)" next to the long rest. `rests.start({ kind: "long", extended: true })` stores `rests.extended`; finishing it rolls 1d6 per active PC (`extendedDowntimeFear`), stored as `fearRoll` (the sum). Other rests follow the book. `extended` on a short rest, or in another mode, is REST_RULE |
| Manual | — | No Fear gained, no `fearDelta`. The public rest row reads "Long rest: Gain 1d4 + 4 Fear" (`restFearPrompt`), the rest stores `fearPrompt`, the launcher shows it, and a GM note with the same text joins the rest's undo group |

Interpretation: an Extended downtime long rest that is interrupted runs as a short rest (CB p.105) and gains the
short rest's 1d4 (`restFearRule`). The Extended choice is checked at `start`; at finish it counts only while the mode is
still Extended downtime (Manual wins if the GM switched to it between start and finish).

## T2 Short-rest limit (`shortRestLimit`)

| Mode | Book passage | What the app does |
|---|---|---|
| Book | CB p.105: "A party can take up to three short rests before their next rest must be a long rest." | Unchanged: the fourth short rest is refused (REST_RULE, `mustLongRest`) |
| Manual | — | The rest starts. The launcher keeps the short-rest button enabled with a warning, and `start` posts the GM note "Fourth short rest in a row: the book says long rest" (`overShortRestLimit`) |

Interpretation: starting a rest writes no undo group, so the T2 note has no `groupId` and is never undoable (as the
start itself). It is posted for every short rest past the third in a row.

## T4 Interrupted rest (`interruptedRest`)

| Mode | Book passage | What the app does |
|---|---|---|
| Book | CB p.105: "If a short rest is interrupted … characters don't gain its benefits. If a long rest is interrupted, the characters instead gain the benefits of a short rest" | Unchanged: `interruptedMoves` |
| Manual | — | Interrupt (short or long rest) closes the rest as `interrupted` with no moves, no Fear, no hooks and no rest rows, and posts the GM note "Rest interrupted: decide what anyone keeps". Nothing was applied, so the note has no undo group |

## Files

- `src/lib/domain/rest/moves.ts`: `mustLongRest(kind, n, mode = "book")`, `overShortRestLimit`, `SHORT_REST_LIMIT_NOTE`.
- `src/lib/domain/rest/index.ts`: `restFearRule`, `canStartExtended`, `extendedDowntimeFear`, `restFearPrompt`,
  `interruptedMoves(…, mode = "book")`, `INTERRUPTED_REST_NOTE`.
- `convex/lib/validators/rests.ts`: `rests.extended?`, `rests.fearPrompt?` (widened).
- `convex/rests.ts`: `start` (`extended` arg, T2), `applyRest` (F2), `interrupt` (T4), `undo` clears `fearPrompt`.
- `convex/restsReads.ts`: `current` returns `rules` (F2, T2, T4 modes), `open.extended`, `last.fearPrompt` (hidden
  like the Fear when players don't see the GM's Fear).
- `src/components/party/rest/launcher.tsx`: the Extended downtime button, the T2 warning, the Manual Fear line.
- Tests: `tests/unit/rules/rest-modes.test.ts`, `tests/convex/rules-rests.test.ts`.
