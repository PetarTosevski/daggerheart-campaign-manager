# TASK H3: Adversary rows carry target ids; GM sees adversary tokens flash; the hit prompt retries by itself

Plan `.omc/plans/followups-7.yaml`, tracer H3 (wave 1, no dependencies). Answers TASK-CA-AA5.md QUESTIONS 1, 2 and 5.
No bead: the user answers are in the plan entry. Status: Review.

## User answers implemented (quoted from the plan)

- "The public adversary row stores target token ids (ids only, widen-only field) and feed.list passes them; the flash
  matches by id, not names; players still receive no numbers" (AA5 Q1).
- "adversary tokens touched by a feature flash for the GM only" (AA5 Q2).
- "the incoming-hit prompt retries a failed load a few times (backoff) before showing 'Try again'" (AA5 Q5).

## What changed

| File | What |
|------|------|
| `convex/lib/validators/actionLog.ts` | `actionTargetValidator {tokenId: Id<"combatTokens">, side: "pc" \| "adversary", tone: "hit" \| "miss" \| "effect"}`; `actionLogFields.targets?: ActionTarget[]` (widen only: optional, older rows have none). `ActionTarget` type. |
| `convex/lib/adversaryActions.ts` | `finish` reads the live map's tokens before the public row and patches `targets` onto it (`publicTargets`): the token of each creature the action named (outcomes: PC by `characterId`, adversary by instance id; tone hit / miss after a roll, "effect" without one), then each other adversary its feature changed (allies; "effect"). Creatures without a token on the live map are left out; no live map, no field. The text (`summary`) is unchanged. |
| `convex/feed.ts` | `common.targets?` in the returns validator; the GM gets every entry, a player only `side: "pc"` (adversary tokens flash for the GM only, and players never get adversary token ids from the feed). |
| `src/components/combat-map/actions/adversary/model.ts` | `newActionFlashes(rows, seen, tokens, gm)` matches `row.targets` to tokens by id; adversary entries only with `gm`. `parseActionRow` (the name parser) removed: nothing reads names any more. `FlashTarget` type; `FlashToken` no longer needs `name`. |
| `src/components/combat-map/actions/adversary/flash.tsx` | The GM reads `combatTokens.list` (every token on the map, the same subscription as the map's token layer), a player `combatTokens.party` (PC tokens); passes `gm`. |
| `src/components/combat-map/actions/reactions/prompt.tsx` | `HitBoundary`: a caught error retries by itself after `HIT_RETRY_DELAYS_MS` = 500, 1500, 4000 ms, rendering nothing meanwhile; only after the third failed retry the alert "The incoming hit failed to load." with "Try again" (which starts the retries afresh). A retry that stays up `HIT_RETRY_STABLE_MS` (10 s) resets the count. Timers cleared on unmount. Used by the map (player column, GM's own PCs) and the character sheet alike. |

`convex/lib/adversaryHits.ts` and `src/components/combat-map/actions/adversary/**` other than the two files above were
not changed. No new public function, wrapper, `need`, argument validator or error code; no index; no migration (the
field is optional and new).

## What a player receives (Q14, U1)

The public row's `targets` holds token ids and a tone (hit / miss / effect), never a number; the tone was already in
the row's text ("Bear hit Ash"). A player's `feed.list` drops the adversary entries. Test: "names the hit PC's token
by id; feed.list passes it to players, with no numbers".

## Tests

- `tests/convex/adversary-actions.test.ts`, "the public row's target token ids (followups-7 H3)" (4 new): the hit PC's
  token by id for player, other player and GM (no `ROLL_KEYS` in it); a manual feature without a roll gives tone
  "effect"; an adversary target's token reaches the GM's feed and not a player's; no live map, no `targets`.
- `tests/convex/feed.test.ts` (2 new): a stored row with a PC and an adversary target: the GM gets both, a player only
  the PC one; a row without targets reads back without the field.
- `tests/unit/adversary-panel.test.tsx`: the parser tests replaced by id tests (new rows only; GM, undone and non
  adversary rows never flash; no `targets` = no flash; an unknown token id is skipped; a name with ", " doesn't matter;
  an adversary token flashes with `gm` only); `HitFlashLayer` for the GM reads `combatTokens.list` and flashes an
  adversary token.
- `tests/unit/incoming-hit.test.tsx` (2 new): a failing child stays quiet through a failed retry and loads on the next
  one without an alert; after every retry fails, "Try again" shows, no more retries run on their own, and the tap
  loads it.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 285 files, 7654 passed, 1 expected fail.
- e2e (ports 3184 / 3480): `tests/e2e/combat-adversary.spec.ts` 2 passed (the flashes of both specs now come from the
  row's target ids).
- `pnpm tracer:guard .omc/plans/followups-7.yaml H3`: OK.
- `convex/_generated` not committed (no new public module).

## QUESTIONS

1. **PCs a feature changed without naming them**: a PC whose sheet an adversary feature changed but who was not one of
   the action's targets (rare: a rider landing on someone else) does not flash; only named targets and changed
   adversaries do. Flash them too (tone "effect")?
2. **Retry timing**: 3 quiet retries at 0.5 s, 1.5 s and 4 s (about 6 s in all) before "Try again". Different counts or
   delays wanted?
