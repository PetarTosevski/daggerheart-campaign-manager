# TASK-SR-S8: Level circle, level-up stepper, advancements tier grid and history

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S8. Owns `src/components/party/level-up/`.

## What changed

- **Level circle (`LevelUpButton`, header):** the board's `lvl-wrap` (styles in `level-up/level-up.css`).
  - The 66 px double-ring circle keeps the frozen name, img "Level N".
  - A green ▲ badge sits on top of the circle when the viewer may level up: owner with a pending level-up, or the GM, below level 10. Its accessible name is "Level up to N+1", and it opens the stepper.
  - A small − at the bottom left reads "Undo level N". It shows when the viewer can edit and the latest advancement is the current level.
  - A viewer with no ▲ sees a green `Badge` reading "Level up pending" while a level-up is pending.
  - Below 640 px both badges have a 44 px hit area (a `::before` overlay).
  - The separate "Level up to N", "Undo level N" and "Advancements" pills are gone, so the header fits on one row at 1440.
- **Stepper:** now a `PaperModal` (`lu-modal`, 680 px), still named "Level up to N". It keeps all 4 steps, every pick (traits, Experiences, domain card, subclass, multiclass with class, domain and foundation) and `validateLevelUp`, unchanged.
  - **Option buttons:** they look like the board's advPick buttons (`lu-opt`) and carry `aria-pressed`, which is true when the option is taken at this level. Clicking takes another slot. When no picks are left, clicking a pressed option removes it.
  - Each pick keeps its Remove button.
  - Trait and Experience chips use the same buttons. Selects are `sh-in`, and Back/Next/Confirm use `sh-modal-cancel` / `sh-modal-ok`.
- **AdvancementTiers (Story & Advancement):** region "Level Up".
  - **Header:** `adv-head` with the `adv-budget` pill, "<used> / <total> advancements used". It reads "No advancements yet" at level 1, as on the board. Then comes the board's italic note.
  - **Tier boxes:** "Tier 2/3/4" are `SheetBox` regions titled "Levels 2–4 (Tier 2)" and so on. Each has the wine intro, the choose line, one row per option and the outro. Rows use the board's option text.
  - **Checkboxes:** read-only (`disabled`) `adv-box` checkboxes, one per slot. A 2-pick option (Proficiency, Multiclass) has one joined box. A box's name is "Tier T: <option> (k)[, taken at level L]", and "(level L…)" follows the text.
  - **Crossed options:** options crossed out by multiclass or subclass are struck through, with the reason as a title and as sr-only text.
  - **Locked tiers:** a tier above the character's current tier is faded and shows "Reach level N to unlock".
- **History and GM correction:** the "Advancements" modal is removed, because the tier boxes show the same history (slots taken, plus the level that took them). The GM's "Correct level" form ("Set level") is now a dashed paper row under the tiers, shown only when `isGm`.

## Defaults taken (open questions)

- − undoes the latest level-up; the GM correction sits under the tier boxes.
- The tier boxes are visible to every viewer of the sheet (read-only). The old modal was available only to editors.

## Visual comparison

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| level-circle | test-results/visual/S8/level-circle-{1440,390}.png, level-circle-undo-* | test-results/visual/board/level-circle-* | Same circle, ring, type and green ▲. The ▲ is always shown (not only on hover) because it is the only way to level up; − as on the board. |
| level-up-head | S8/level-up-head-* | board/level-up-head-* | Match: Cinzel heading without rules, green pill, italic note. |
| level-up | S8/level-up-* | board/level-up-* | Match: three tier boxes, wine intro, adv-box and joined boxes with the brush tick, faded locked tiers. The app adds "(level N)" after taken options. |
| stepper | S8/stepper-{1440,390}.png | board advPick (no region) | Parchment dialog, Cinzel 22 title, advPick option buttons, Back ghost and green Cinzel Next. |
| correct-level | S8/correct-level-* | none | Paper row under the tiers. |

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3161/3434: level-up, party-roster, and `E2E_VISUAL=1` S8 passed (6 tests).
- `tests/e2e/level-up.spec.ts` now also checks:
  - the budget pill and the checked Tier 2 boxes;
  - the locked Tier 3;
  - no "Set level" for the player, and "Set level" for the GM;
  - "No advancements yet" after the undo.
