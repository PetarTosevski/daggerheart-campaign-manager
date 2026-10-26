# TASK-SR-S11: Story & Advancement page (wealth, inventory, description, questions, notes)

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S11 (wave 2). Builds on TASK-SR-S0.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`. All changes are in C/sections/story.tsx and story.css. UI only, no Convex changes.

## What changed

- **Wealth:**
  - "Handfuls of coins" and "Bags of coins" each show 10 pips with the board's `gold-hand` / `gold-bag` art. Tapping pip k sets the count to k. Tapping the last marked pip clears it, as the board's `pips()` does. Pip names are "Handfuls k of 10" and "Bags k of 10", with `aria-pressed`.
  - Each label row keeps the existing stepper ("Handfuls of gold" / "Bags of gold", 0–99), so counts above 10 still work.
  - The chest is the board's `gold-chest` toggle button ("Chest of coins", `aria-pressed`). Every change goes through the existing `update({ gold })`.
  - Read-only viewers see decorative pips, the stepper value and a chest image named "Has a chest of coins" / "No chest of coins".
- **Inventory:**
  - First comes the board's starting-inventory note (`#efe3c8`), ending with the class's `classItems`.
  - Then the existing item list, each item in a locked `sh-in` row with a 44 px "Remove <item>" button.
  - Last, a `PaperInput` ("New item") with a solid "Add" pill.
  - InventoryBox looks up the class from `@/lib/srd/classes`, because page-two.tsx (not owned) passes it no `cls`.
- **Character Description:**
  - The board's italic intro line, then the class's prompts as board line labels ("Clothes that are …", "Attitude like …").
  - Below them, one lined `PaperTextarea` named "Description" for the existing field.
- **Background Questions / Connections:** the board's intro texts, and the Background outro line about Experiences. Each question is a 17 px semibold label over a lined `sh-ta` (min 80 px).
- **Notes:** a lined `sh-ta` textbox named "Notes", under the Level Up region (placement by S0).
- **Text fields:** a local `PaperText` replaces TextField's `key={value}` remount (CL7). It shows the saved value while unfocused and saves on blur. After a save it keeps the typed text until the live value arrives, and drops it if the save fails. Read-only viewers get a lined paragraph, never a textbox.
- **Art:** the board's coin, bag and chest images are inline SVG data URLs in its CSS, not `/_blob/` design assets, so they are copied into story.css as such.

## Defaults taken (open questions)

- Wealth "Other", the Inventory weapon rows and "Other items" are not built (no data field; needs user confirmation). The item list stands in for "Other items".
- Description stays one field. Only the class prompts (clothes and attitude) are shown, not the board's generic eyes, body and colour lines.

## Visual comparison

Spec: `tests/e2e/visual/S11.spec.ts`. Shots: `test-results/visual/S11/<region>-{1440,390}.png`; board: `node scripts/board-shots.mjs wealth inventory description background connections`.

| Region | Verdict |
|---|---|
| wealth | Pip art, sizes, wrap and chest match. Steppers sit on the label rows, which the board does not have. No "Other" textarea. At 390 the pips are 44 px. |
| inventory | Starting-inventory note matches. The item rows replace the board's weapon rows and Other items. |
| description | Intro and Cinzel labels match. One lined textarea instead of 5 inputs (default). |
| background | Matches (labels, lined textareas, intro and outro). |
| connections | Matches. |

At 390 there is no horizontal scroll (asserted by `shoot`).

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed (`tests/unit/sheet-render.test.ts` unchanged).
- e2e on ports 3190/3492 with `E2E_VISUAL=1`: `tests/e2e/character-sheet.spec.ts` (unchanged, 3 tests) and `tests/e2e/visual/S11.spec.ts`: 4 passed.
