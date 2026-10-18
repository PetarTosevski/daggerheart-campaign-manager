# TASK-D5-R2: Character status, limits, keyed damage and level-up polish

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer R2 (end of D5). Fixes review M3, M5 and L2 (`.omc/audit/d5-review.md`) and integration polish items 27, 29, 30 and 31 (`.omc/autopilot/d5-integration.md`).

## M3: owners can't revive

`characters.setStatus` loads the character with owner precision. When the character is `dead` or `away`, only the GM (`permission === "owner"`) may change the status. Anyone else gets `FORBIDDEN`. Every status change clears `away`. Setting the current status again does nothing. The owner can still mark an active character dead or retired.

## M5: bounded party

- `MAX_CHARACTERS_PER_CAMPAIGN` = 50 and `MAX_CHARACTERS_PER_PLAYER` = 12 (`convex/characters.ts`). Both are reversible defaults. `create` (inside `ctx.once`) and `assignOwner` (when the owner changes) refuse with `INVALID` past either cap. Characters the GM owns count only towards the campaign cap (see Questions).
- `characters.create` is rate-limited by `createCharacter` (20 per hour, bursts of 30; `RATE_LIMITS` in `convex/lib/functions.ts`). A refused call rolls back, so it uses no token.
- `rests.start` and the rest finish (`applyRest`) refuse more than 49 resting PCs with `REST_RULE` (`restingParty`). An undo group holds 50 rows, and one of them is the campaign's.
- The session party read (`sessions.ts`) and the party feature read (`classFeatures.ts`) read one row past their limit. They throw (`INVALID` / `CLASS_FEATURE_RULE`) instead of silently skipping characters.
- Not in R2's owns: `actionLog.undoEntry` should still throw when its group read hits `GROUP_MAX`.

## L2: keyed damage

`characters.applyDamage` is a `keyedUserMutation`, and its body runs in `ctx.once("character_damage", …)`. The sheet's `applyDamage` (sheet-context) sends `crypto.randomUUID()` on every call. The Withered path in `damage-calculator.tsx` uses `useIntent`.

## Polish 27: Brawler Combo Die (HF 10)

HF p. 10, Brawler, Combo Strike (re-checked in hopefear.txt, page 10):

> Your Combo Die starts as a d4. Once per tier, you can increase your Combo Die by one step as a level advancement option.

- `comboDie` is a new entry in `ADVANCEMENT_OPTIONS` (`src/lib/validation/characters.ts`). Both Convex validators derive from that list, so the stored pick and `levelUp.apply`'s `choiceValidator` widen with it.
- `OPTION_RULES.comboDie`: 1 slot per tier, from tier 2, takes 1 pick. `offersOption` limits it to a Brawler or a Brawler multiclass (a multiclass gains the class feature, CB 110). `availableOptions` and the tier grid hide it for everyone else. `validateLevelUp` refuses it with "Only a Brawler has a Combo Die."
- Apply raises `classState.comboDie` one step through `COMBO_DIE_STEPS` (4, 6, 8, 10, 12). Three tiers reach d10 at most. Revert lowers it one step. Back at d4 the field is removed, so undo returns the exact earlier sheet.

## Polish 29: Rally Die with Hope & Fear off

`classFeatures.use` skips the `classFeaturesAvailable` check for `rallyDieStress`, and the features panel always offers it. The Rally Die comes from a Bard (CB 28), not from the character's class. The H&F class's own features stay off.

## Polish 30: Horizon long rest up front

`assertSanctuaryLongRest` (exported from `convex/trackers/horizon.ts`; HF 176: "Inside a sanctuary, the party can take a long rest") does nothing outside Journey to Horizon or without a placed party. Otherwise it throws `REST_RULE` unless a sanctuary marker shares the party's hex. `rests.start` calls it for a long rest. The rest hook still calls it on finish, for a party that moved after the rest began.

## Polish 31: vault button cost

`page-two.tsx` labels "Move to loadout (free)" only while the rest box is ticked and `rests.current` has an open rest (or the Recall Cost is 0). Otherwise the label shows "(N Stress)".

## Tests

- `tests/convex/characters.test.ts`: M3 (dead/away → active only by the GM; away cleared), M5 caps (create, GM-assigned create, hand-over, 50 total), create rate limit (31st RATE_LIMITED), L2 replay (same key: same result, damage once; different request: IDEMPOTENCY_MISMATCH).
- `tests/convex/rests.test.ts`: over 49 resting PCs refused at start and at finish.
- `tests/convex/sessions.test.ts`: start and end INVALID over 49 characters.
- `tests/convex/class-features.test.ts`: Rally Die clears Stress for a Brawler with H&F off, Combo Strike refused; Rally over 50 characters refused.
- `tests/convex/horizon.test.ts`: `rests.start` refuses a long rest outside a sanctuary and opens it inside one. `tests/convex/rest-frame-hooks.test.ts` now starts in the sanctuary and moves the party before checking that finish is refused and interrupt works.
- `tests/convex/level-up.test.ts` and `tests/unit/level-up.test.ts`: Combo Die offered only to a Brawler (or Brawler multiclass), one slot per tier, d4 → d6 → d8, undo restores.
- `tests/unit/sheet-render.test.ts`: mocks `rests.current`; the vault button shows "2 Stress" with no open rest, "free" with one; the damage call carries an idempotency key.
- `tests/convex/wither.test.ts`, `tests/e2e/character-sheet.spec.ts`: updated for the key and the honest vault label.

## Questions

- Per-player cap: characters the GM owns (unassigned) are exempt from the 12 and bounded only by the campaign's 50. If the GM should also stop at 12, remove the `owner === campaign.ownerId` early return in `assertRoom`.
- Combo Die for a multiclassed Brawler: allowed, because a multiclass gains the class feature (Combo Strike) and the advancement belongs to that feature. Restricting it to a primary Brawler is a one-line change in `offersOption`.
- Should an owner be able to retire a dead character? Today only the GM can change a dead or away character's status (review M3 says "from dead/away, require owner").
