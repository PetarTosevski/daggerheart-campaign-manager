# TASK-FX-FX1: Deterministic adversary-actions tests

Plan `.omc/plans/flaky-adversary.yaml`, tracer FX1. Bead dcm-bxp.99.29. Test-only change; no production code changed.

## Symptom

Two tests in `tests/convex/adversary-actions.test.ts` each failed once in a full-suite run and passed alone:

- "a PC with no free Armor Slot and no card resolves at once": `r.targets[0].resolved` was `false`.
- "I Am Your Shield (CB p.341): Bryn marks a Stress, takes the hit and marks two Armor Slots": the `responders`
  assertion failed.

## Root cause

The flake comes from the Bear's attack roll. The fixture's card loadout makes the tests depend on that roll. The
suite's load and the seeded rolls in `convex/lib/incomingHits.ts` play no part.

1. `buildWorld` creates Ash and Bryn from `characterDraft` (`tests/fixtures/characters.ts`), a Warrior whose level-1
   loadout holds **Get Back Up** (CB p.329, `src/lib/srd/card-effects/blade.ts`): a reaction with the trigger
   `whenYouWouldTakeDamage, severity: "severe"`.
2. The Bear attacks with Claws, `1d8+3 phy`. The attack roll is a d20 from `rollDie` (`convex/lib/dice.ts`,
   `crypto.getRandomValues`, not seeded). A normal hit deals 4 to 11 damage, below Ash's Severe threshold of 16. On a
   natural 20 the hit is a critical (8 + 1d8 + 3 = 12 to 19 damage), and it is Severe when the 1d8 rolls 5 or more.
3. On a Severe hit, `openWindow` (`src/lib/domain/adversary-actions/window.ts`) finds Get Back Up eligible for Ash
   and lists Ash as a target responder with `cardIds: ["get-back-up"]`. This follows the rules, so it is not a bug.
   - Test 1: Ash has no free Armor Slot, but the card still makes Ash a responder. `isComplete` is false, so the
     hit waits for Ash's answer and `resolved` is `false`.
   - Test 2: Ash's responder is `{ cardIds: ["get-back-up"] }` instead of the expected `{ cardIds: [] }`.

The chance is 1/20 x 1/2 = **2.5% per run of each test**.

### Proof

- A diagnostic loop of 300 arenas running test 1's scenario gave 6 unresolved hits (2%). Every one had the roll
  `d20 = 20` (critical), damage 18 or 19 and `responders: [{ role: "target", cardIds: ["get-back-up"] }]`.
- A temporary `vi.spyOn(crypto, "getRandomValues")` fixed every die at its maximum (value 119, which is `-1` mod
  4, 6, 8, 10, 12 and 20). Under it, exactly these two tests failed and the other 36 passed. With every die at its
  minimum (value 0), all 38 passed.

## Fix

Both tests now empty Ash's loadout first (`NO_CARDS = { domainCards: { owned: [], loadout: [] } }`). Test 1 says "no
card" in its title, so it now sets that state. Test 2 asserts that Ash's responder entry has no cards. Without a
card, no roll can make Ash an extra responder, and every other assertion in both tests is computed from the stored
damage. The file's header comment explains why.

After the fix, the forced-dice probe passed all 38 tests at the values 0, 9, 19, 39, 49, 59, 79, 99, 109 and 119
(every die at its minimum, at its maximum, a natural 20 with mid-range damage, and others). The probe was removed
before the commit.

## Checks

- `for i in $(seq 50); do pnpm vitest run tests/convex/adversary-actions.test.ts || break; done`: 50/50 passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm vitest run --maxWorkers=4 --testTimeout=60000`,
  `pnpm tracer:guard .omc/plans/flaky-adversary.yaml FX1`.
