# TASK-GL2: Type the new Experience and pick +1 Experiences in the Experiences box

Status: Review. Plan: `.omc/plans/guided-level-up.yaml`, tracer GL2 (depends on GL0). No server or schema change.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Target:** the Experiences `SheetBox` (`C/sections/identity.tsx`) has `id="lu-target-experiences"`, so `goTo("experiences")` scrolls to it and focuses its "Experiences" heading.
- **Draft panels (`ExperiencesLevelUp`):** shown only while `useLevelUpDraft().active`. Each is a dashed green panel with a green "Level N" pill (`aria-hidden`), so draft input never looks like saved rows.
  - At levels 2/5/8 (`ACHIEVEMENT_LEVELS`): a text input named "New Experience (+2) for level N", `maxLength` 200 (the hook's cap; the engine asks for at most 80 and reports it in the ribbon), bound to `setExperienceName`. At 12 Experiences a note repeats the engine's limit.
  - With an `experiences` pick in the draft: a fieldset "+1 to two Experiences for level N" with "Choose two (n/2)" and one 44 px checkbox per Experience named "+1 to <name>" and a `+2 → +3` preview. Unticked boxes disable once two are chosen; an Experience already at +10 is disabled (sr-only reason). Changes call `setPickTargets(option, tier, targets)` for the first `experiences` pick.
- **Add form:** while the mode is on, the direct "New Experience" Add form is hidden, so there is one way to add the level's Experience. Outside the mode the box is unchanged.

## Verification

e2e ran on ports 3128/3368.

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest: `tests/unit/experiences-level-up.test.ts` (5 tests): target id and no draft UI outside the mode; level 2 input, focus, done state, storage and Cancel; no input at level 3; checkboxes, the cap of two, a +10 Experience disabled, stored targets.
- e2e: `E2E_VISUAL=1` GL2 (1), GL0 (1) and character-sheet (3) passed.
- **Expected failure outside GL2's owns:** `tests/unit/sheet-render.test.ts` "▲ starts the guided level-up" expects the Character Sheet tab to take focus because the Experiences target did not exist yet. Now the Experiences heading takes focus. The orchestrator updates that line at merge: `expect(screen.getByRole("heading", { name: "Experiences" })).toHaveFocus()`.

Screenshots: `test-results/visual/GL2/new-experience-{1440,390}.png`, `plus-one-{1440,390}.png`.

## Defaults taken (open questions)

- The direct Add form is hidden during the mode.
- Experiences at +10 cannot be chosen for +1 (the engine rejects them).
