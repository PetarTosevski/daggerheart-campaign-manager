# TASK-D5-R1: Undo integrity and roll trust

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer R1 (wave 5). Findings H1, H2, M1, M2, L1 and L4 (the refusal) of `.omc/audit/d5-review.md`, and polish item 28 of `.omc/autopilot/d5-integration.md`.

## Done

| Item | What changed | Test |
|---|---|---|
| H1 Unlogged changes | `undoEntry` (`convex/lib/actionLog.ts`) refuses with UNDO_STALE when a character whose sheet the group restores has `updatedAt` newer than its newest group row. A newer row undone since counts as explained, because undo now stamps `updatedAt` with the undo time (the same `now` as `undoneAt`). Logged writes already save before they log, so their `updatedAt` is never later than the row's `at`. | convex `action-log` (manual roll → GM `applyDamage` → undo refused for player and GM, damage kept; undoing two rolls newest first still works) |
| H2 Contiguity | `undoEntry` reads each character's rows from its oldest group row on (`by_character_at`, `gte`) and refuses when a live row there is not in the group (this replaces the old latest-row check). `rolls.tagTeamApply` refuses (DICE_RULE) when either character's latest live row is not its pending Tag Team row. | convex `action-log` (split group refused, whole group undoes), convex `rolls` (roll between tag team and apply: apply refused; after undoing that roll it applies) |
| M1 Roll context | `TYPED_MODIFIER_MAX = 10` and `assertTypedModifier` in `src/lib/domain/dice/index.ts`, applied to the typed modifier of action, reaction, damage, manual and Tag Team rolls (DICE_RULE). The dice box disables Roll and says the range when the field is outside it. Feed lines add " +N typed" (`typedLabel`) and, for a Difficulty a player typed, " vs DC N (player)" (the GM's stays " vs N"). A damage `critical` reads "critical (declared)" unless the character's latest live action roll was a critical success. | unit `dice`, convex `rolls` |
| M2 Reroll by undo | `PLAYER_DICE_UNDO_MS = 60_000` (exported from `convex/lib/actionLog.ts`): a player can't undo a group with a dice row (kind `roll` or `death` with a `roll`) older than that; the GM can at any time. Covers `deathMoves.undo` too, which goes through `undoEntry`. | convex `action-log` |
| L1 Volatile Magic | The rerolled damage roll keeps `manual: roll.manual`. | unit `hope-features` |
| L4 Rest rows | `actionLog.undo` passes `refuse: { kinds: ["rest"] }` to `undoEntry`, so a group with a rest row is refused (UNDO_STALE, "Undo a rest from the rest panel."); `rests.undo` still uses `undoEntry` without it. The roll feed hides Undo on rest rows. | convex `action-log` |
| 28 motherboardState | `characterExtras.motherboardState(ctx, campaign, characterId)` returns the row, else the legacy `frameTrackers` row, else null (null outside Motherboard). `installedAugments` and `rolls.ts` (`loadIkonis`) use it. | convex `rolls` (Ikonis rolls from a legacy tracker row) |

## Known limits

- H1 does not catch an unlogged change made between two rows that are then undone newest first: after the newer undo, the character's `updatedAt` is the undo time. Closing it needs each row to store the character's `updatedAt` before the action (a new `actionLog` field, outside R1's `owns`).
- M2 and L4 reuse the code UNDO_STALE with their own message; the error modules are outside R1's `owns`.
