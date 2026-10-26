# TASK-D5-T4: Death moves, scars and Castle High away

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T4 (wave 2, depends on T0).

## What works

- `convex/deathMoves.ts` (all `keyedUserMutation` except `state`; owner or GM through `loadCharacter(..., "edit")`):
  - `choose({ characterId, move, action?, awayReason? })`: only for an active, conscious character with `hp === hpMax` and no move under way, else `DEATH_MOVE_RULE`. Rate-limited with `roll`. The server rolls every die.
    - `blazeOfGlory`: logs a narrated critical success (roll `{ outcome: "critical", dice: [] }`); `finishBlaze` then sets the character dead.
    - `avoidDeath`: adds `unconscious`, rolls the Hope Die (d12); at or under the level adds a scar; a scar on the last Hope slot sets `journeyEnds`.
    - `riskItAll`: rolls the Duality Dice. Hope higher: `resolveRiskItAll({ hp, stress })` clears the player's split, which must total `min(Hope Die, hp + stress)`. Fear higher: death. Matching: all Hit Points and Stress cleared.
  - `finishBlaze`, `resolveRiskItAll`: the second step. Which step is waiting comes from the character's latest live `actionLog` row (`pendingDeathMove`), so undoing the second step reopens it.
  - Dying with Wither tokens adds "taken by the Witherwild" to the row's summary.
  - Castle High with `lessLethal` on: death becomes `status: "away"`, `away: { reason }` (`awayReason`, default `infirmary`). `returnFromAway` is GM only (`loadCharacter(..., "owner")`), logged with `undoable: false`.
  - `undo({ entryId })`: a death row only. It calls `undoEntry` (actor or GM, latest row only), then sets the character back to active when that row took them out of play.
  - `state({ characterId })`: `awaitingMove`, `pending`, `undoEntryId` and `lessLethal`, for the sheet's modal.
- Every move writes an undoable `kind: "death"` row with the sheet from before the move. No Fear is gained. Manual kill and revive (`characters.setStatus`) are unchanged.
- Pure rules: `src/lib/domain/death/index.ts`. Errors: `DEATH_MOVE_RULE` (`src/lib/errors/death.ts`, unchanged).
- UI (`src/components/party/death/`): the `DeathMoveModal` slot shows the Unconscious and Journey-ends badges, opens the "Death move" modal for the owner and the GM when a move is due or waiting, and has an "Undo death move" button while the death row is the latest. `DeathCardBadge` shows Unconscious, Away (with its reason) and Journey ends on the party card, plus "Return to play" for the GM.

## Book references (re-checked)

- CB 106, Death Move: "when you mark your last Hit Point, you must make a death move." Blaze of Glory: "Take one action (at the GM's discretion), which critically succeeds, then cross through the veil of death." Avoid Death: they "return to consciousness when an ally clears 1 or more of their marked Hit Points or when the party finishes a long rest. After your character falls unconscious, roll your Hope Die. If its value is equal to or under your character's level, they gain a scar." Risk It All: "If the Hope Die is higher, your character stays on their feet and clears an amount of Hit Points or Stress equal to the value of the Hope Die (divide the Hope Die value between Hit Points and Stress however you'd prefer). If the Fear Die is higher, your character crosses through the veil of death. If you critically succeed, your character stays up and clears all Hit Points and Stress."
- CB 106, Scars: "If you ever cross out your last Hope slot, it's time to end your character's journey."
- CB 261, Witherwild: "If a character ever dies with Wither tokens on their sheet, their body is permanently taken over by the Witherwild."
- HF 127, A Less Lethal Campaign: "any death moves that would normally lead to a character's demise can instead lead to a character ending up in the infirmary for a few weeks or being sent home for the semester, making them unplayable for some time but not dead."

## Decisions taken as the reversible minimum (see the T4 report's QUESTIONS)

- The player (or GM) picks infirmary or sent home when making the move; the default is infirmary.
- `returnFromAway` leaves the sheet unchanged. A character still at full Hit Points is asked for a death move again.
- Risk It All gives the GM no Fear and the player no Hope.
- With a seventh Hope slot (`hopeSlotBonus`), the journey ends on the seventh scar, but stored scars stop at 6 (the sheet's limit).

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test` (`tests/unit/death.test.ts`, `tests/convex/death-moves.test.ts`), a local push with `--typecheck=enable`, and `tests/e2e/death.spec.ts`.
