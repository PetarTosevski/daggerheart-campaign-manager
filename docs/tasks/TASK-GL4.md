# TASK-GL4: Guided level-up end to end

Status: Review. Plan: `.omc/plans/guided-level-up.yaml`, tracer GL4 (depends on GL1, GL2 and GL3). It changes tests and docs only.

## What changed

- **`tests/e2e/level-up.spec.ts`:** rewritten for the guided mode. The removed `PaperModal` stepper is gone, so the spec no longer drives it. One test now runs these steps:
  1. With no GM flag, the player's sheet shows level 1 and no "Level up to 2" button.
  2. The GM presses "Party levels up" on the roster. The roster status says 1 character can level up.
  3. The player presses ▲ ("Level up to 2"). The region "Level-up to 2" opens with no dialog. The first step has `aria-current="step"`, and the "Experiences" heading has focus.
  4. The player types "Always Land on My Feet" in "New Experience (+2) for level 2".
  5. **Next** moves focus to the "Level Up" heading. The player ticks "Tier 2: +1 to two unmarked traits for level 2". In the inline group "Traits to raise for level 2" they pick Agility and Instinct (both `aria-pressed`). Then they tick "Tier 2: +1 Stress slot for level 2". The step reads "Advancements (2/2) (done)".
  6. **Next** moves focus to the "Domain Deck" heading. The player presses "Choose <first core level-2 Warrior card> for level 2", and "Undo choice of <card>" appears.
  7. **Next** opens the summary ("Your choices"). It lists the Experience, both picks with their trait targets, and the card, and reads "Everything is chosen". The player presses "Finish level-up" and the ribbon closes.
  8. The sheet shows the result:
     - "Level 2" on the level circle;
     - the card in "Loadout and vault";
     - "Experience 3" = "Always Land on My Feet" at +2;
     - Agility +3 and Instinct +1, each with its tier mark;
     - the Tier 2 boxes taken at level 2, plus "2 / 2 advancements used" and no "Set level" for the player;
     - for the GM, the same history and "Set level".
  9. "Undo level 2" returns the sheet to level 1: no advancements, no marks, Agility +2 and no third Experience.
- **`class-features.spec.ts`, `class-features-hf.spec.ts`, `domain-deck.spec.ts`:** no changes. None of them used the old modal (they make no "Level up to" or "Confirm level" call), and all pass as they are.

## Verification

e2e ran on ports 3157/3426.

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest (`--maxWorkers=4 --testTimeout=60000`): 106 files and 1091 tests passed.
- e2e `tests/e2e/level-up.spec.ts`: 1 passed.
- Full e2e suite (`E2E_PORT=3157 E2E_CONVEX_PORT=3426 pnpm test:e2e`): **68 passed, 0 failed**. The `@visual` specs are not part of the default run (they need `E2E_VISUAL=1`).
- `pnpm tracer:guard .omc/plans/guided-level-up.yaml GL4`: OK.

## Defaults taken

- The "no ▲ without the flag" check runs before the GM flags the party. Undo might bring the flag back, so a check after undo would test the undo rules instead.
- The trait advancement is the option with a target chooser, as in the old spec.
