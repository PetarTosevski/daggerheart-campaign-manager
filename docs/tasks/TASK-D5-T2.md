# TASK-D5-T2: Level-up engine and stepper (includes dcm-mf7)

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T2 (wave 2, depends on T0).

## What works

The GM presses "Party levels up" on the roster; every active character below level 10 gets `levelUpPending` and a "Level up pending" badge (roster and dashboard card). The owner opens the sheet, presses "Level up to N" and goes through the stepper: achievements, two picks, the level's domain card with an optional trade, and a summary. "Undo level N" takes back the latest level and can be repeated. "Advancements" shows the tier grid as read-only history; the GM can also set a level directly there (no automation).

## Files

| File | Role |
|---|---|
| `src/lib/domain/level-up/index.ts` | Pure engine: `availableOptions`, `validateLevelUp`, `applyLevelUp`, `revertLevelUp`, `cardsWithin`, `isMarked`, `markEpoch`, `picksFor`; `LevelUpRuleError` |
| `convex/levelUp.ts` | `apply`, `undoLast` (keyedUserMutation, owner or GM), `correctLevel` (keyedUserMutation, GM via `loadCharacter(..., "owner")`), `partyLevelUp` (keyedGmMutation) |
| `src/components/party/level-up/` | Slots: `LevelUpButton` (stepper, undo, history, GM correction), `LevelUpCardBadge`, `LevelUpRosterBadge`, `PartyLevelUpButton` |
| `tests/unit/level-up.test.ts`, `tests/convex/level-up.test.ts`, `tests/e2e/level-up.spec.ts` | Tests |

## Rules (book pages re-checked)

- CB 109: tiers (2: levels 2-4, 3: 5-7, 4: 8-10); achievements at 2, 5 and 8 give an Experience at +2 and +1 Proficiency; at 5 and 8 the trait marks clear.
- CB 110: two options with unmarked slots, from the current tier or a lower one. Slots per tier: traits 3, HP 2, Stress 2, Experiences 1, domain card 1, Evasion 1; tiers 3-4 add upgraded subclass 1, Proficiency 1 and multiclass 1. Proficiency and multiclass take both picks.
- CB 110 (dcm-mf7): "Choose two unmarked character traits and gain a permanent +1 bonus to them. You can't increase these stats again until the next tier."
- CB 110: the domain card option is "up to level 4" in tier 2 and "up to level 7" in tier 3; a multiclassed character takes multiclass-domain cards "at no higher than half your level".
- CB 110: upgraded subclass goes foundation → specialization → mastery and crosses out that tier's multiclass.
- CB 111: the level's domain card is the level or lower from a domain the character has; optional trade of one card "for a different domain card of an equal level or lower". Multiclass starts at level 5, adds one domain of the new class not already held, the class feature and a foundation card; it crosses out one unused upgraded subclass of its tier (so no mastery card) and the other multiclass option.

## Decisions taken here

- Trait marks are stored as the epoch the sheet already reads (`page-one.tsx`: 1 for levels up to 4, 2 for 5-7, 3 from 8), via `markEpoch`. Reaching 5 or 8 deletes the older marks; undoing that level rebuilds them from the previous tier's trait picks.
- Undo is the inverse of the advancement (not a snapshot), so later sheet changes survive; it refuses when the level no longer matches the latest advancement (the GM corrected it). Undo sets `levelUpPending` again so the level can be redone.
- The new card goes into the loadout when it has room (fewer than 5), otherwise the vault. A trade swaps in place.
- `partyLevelUp` logs one row per flagged character (same group); every level row is `undoable: false`, which also stops `actionLog.undo` from restoring a pre-level-up snapshot.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`, local push with `--typecheck=enable`, `tests/e2e/level-up.spec.ts`.
