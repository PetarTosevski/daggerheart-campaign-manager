# TASK-D5-T3: GM-run party rests and downtime moves

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T3 (wave 2). Decision 10: the GM starts a party rest, each player picks two moves, the GM finishes it; no solo rests.

## What works

- Dashboard `RestLauncher` (GM): start a short or long rest, see who picked what, finish or interrupt, undo the latest rest. The panel shows "n of 3 short rests"; after three, a fourth short rest needs the override checkbox (`rests.start` `override`, stored as `gmOverride`). Players see the panel only while a rest is open.
- Sheet `RestPicker` (owner or GM, while a rest is open): two move selects (the same move twice is allowed), an ally target for Tend to Wounds / Repair Armor (and the "All" versions), a project for Work on a Project (or "GM asks for a roll"), a "New project" form on long rests, and free loadout/vault swaps (`characters.moveCard` with `duringRest: true`). Dead, away and unconscious characters see why they can't pick.

## Functions (`convex/rests.ts`)

| Function | Wrapper | Who |
|---|---|---|
| `current` | `campaignQuery` need view, `returns` | everyone in the campaign |
| `projects(characterId)` | `userQuery` + `loadCharacter(view)` | everyone who sees the character |
| `start(kind, override?)` | `keyedGmMutation` | GM |
| `finish(restId)` / `interrupt(restId)` / `undo(restId)` | `keyedGmMutation` | GM |
| `choose(restId, characterId, moves)` | `keyedUserMutation` + `loadCharacter(edit)` | the character's owner, the GM |
| `createProject(characterId, name, startingValue)` | `keyedUserMutation` + `loadCharacter(edit)` | the character's owner, the GM |

`finish` (and `interrupt` of a long rest): server dice (`rollDie`), `applyMoves`, then per resting PC `restedSheet` = `expire(shortRest|longRest)` + `onRest` hook + wake from Unconscious on a long rest; `runRestHooks` (convex/lib/restHooks.ts, empty until T3b); project ticks through `applyCountdownAction` + `recordHistory`; GM Fear through `gainFear`; one `actionLog` row per resting PC (`before` = sheet before) plus a campaign row with `fearDelta`, all one `groupId`. Resting PCs = `status: "active"` (dead, retired and away left out, HF 127).

`undo`: only the campaign's newest rest; `undoEntry` on its group restores every sheet and reverts the Fear (UNDO_STALE once any PC has a newer log row); the rest goes back to `open` so the GM can finish it again. Project ticks and frame tracker changes are not reverted (plan note 11).

Projects are countdowns with `ownerKey` = the character id, `category`/`kind` `project`; they stay off the dashboard list (`countdowns.listByCampaign` reads only `ownerKey` unset). T3 did not edit `convex/countdowns.ts`.

## Pure rules (`src/lib/domain/rest/`)

`moves.ts` (no imports, used by the UI): move ids and labels, `REST_MOVES`, `ALLY_MOVES`, `MOVES_PER_REST`, `MAX_SHORT_RESTS`, `shortRestsSinceLong`, `needsOverride`. `index.ts`: `validateChoice` (RuleError `REST_RULE`), `applyMoves`, `interruptedMoves`, `restFear`, `restedSheet`.

## Book references (re-checked)

- CB 105, Downtime: "each PC has the chance to make two downtime moves"; "A party can take up to three short rests before their next rest must be a long rest. If a short rest is interrupted (such as by an adversary's attack), characters don't gain its benefits. If a long rest is interrupted, the characters instead gain the benefits of a short rest (even if they've already had three short rests)."
- CB 105, Short rest: "Each player can swap any domain cards in their loadout for cards in their vault, then choose two of the following moves (or choose the same move twice)." Tend to Wounds "clear a number of Hit Points equal to 1d4 + your tier. You can do this to an ally instead." Clear Stress "1d4 + your tier". Repair Armor "1d4 + your tier. You can do this to an ally's armor instead." Prepare "gain a Hope. If you choose to Prepare with one or more members of your party, you each gain 2 Hope."
- CB 105, Long rest: Tend to All Wounds (ally allowed), Clear All Stress, Repair All Armor (ally allowed), Prepare, Work on a Project.
- CB 105, Working on a Project: "Each time a PC takes the Work on a Project downtime move during a long rest, they either automatically tick down their countdown, or the GM might ask them to make an action roll to gauge their progress."
- CB 105, Downtime consequences: "On a short rest, they gain 1d4 Fear. On a long rest, they gain an amount of Fear equal to 1d4 + the number of PCs".
- CB 105, Refreshing features: rest effects and per-rest features end/refresh on either rest; long-rest ones only on a long rest (`expire`).
- CB 106, Avoid Death: an unconscious character returns "when an ally clears 1 or more of their marked Hit Points or when the party finishes a long rest".
- HF 127, A Less Lethal Campaign: "in the infirmary for a few weeks or being sent home for the semester" → `away` PCs do not rest and do not count for Fear.

## Interpretations (reversible, listed as questions in the T3 report)

- An interrupted long rest also gives the GM a short rest's Fear (1d4); an interrupted short rest gives no Fear.
- Only finished short rests count toward the three; interrupted rests don't, and an interrupted long rest doesn't reset the count.
- "Prepare together" with nobody else choosing it gives 1 Hope (a plain Prepare).
- Undo reopens the rest rather than leaving it finished.
- "GM asks for a roll" is noted in the feed and on the picker; the picker can't open T1's dice box from the rest slot.
- Make a Feast and Tribute are refused in core; `restHooks.extraMoves(campaign, kind)` is where T3b adds frame moves.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test` (new: `tests/unit/rest.test.ts`, `tests/convex/rests.test.ts`), local push with `--typecheck=enable`, `tests/e2e/rest.spec.ts`.
