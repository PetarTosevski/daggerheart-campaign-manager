# TASK-SR-S1: Identity, portrait, traits, Experiences

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S1 (wave 2). Analysis: `.omc/autopilot/sheet-redesign-analysis.md` §2.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`. Files: C/sections/identity.tsx, C/sections/identity.css, tests/e2e/visual/S1.spec.ts.

## What changed

- **Columns:** the board's 240 px left column holds the portrait arch and Experiences under it. The right column holds the identity box, bottom-aligned to the 270 px portrait height, and the six trait cards under it. Column gaps are 22 px, as on the board. Below 760 px the columns stack (S0's `cs-top`) and the portrait is centred at 240 px wide.
- **Portrait (`pt-frame`):** 270 px tall, 4 px double border, 110/110/14/14 radius, `#f6edd8` ground. With no art it shows the board's person icon. Editors get the existing `PortraitUpload` as the `pt-actions` overlay, restyled as a `pt-btn`. The overlay shows on hover or focus, always when there is no image, and always on touch devices (`hover: none`). Players see no button, because `PortraitUpload` renders nothing when `canEdit` is false.
- **Identity grid:** a 3-column `sh-box` (2 columns below 1100 px, 1 below 520 px) with Name, Pronouns (the board's Gender slot), Ancestry, Community, Subclass, Class and Transformation. Name and Pronouns stay save-on-blur fields (`TextField` with `sh-lbl` labels). The other five fields use the `sh-in sh-locked` style with the title "Set at character creation".
- **Transformation:** read-only (the default for the open question). It shows the transformation's name, from `transformationId` or a Shapeshifter ancestry (the same rule as the heritage cards), and otherwise "None". It carries the board's H&F tag and the title "Gained through the story, not at will".
- **Trait cards:** a `#fbf5e6` card with a green Cinzel head, a 72 px `sh-num` ring and italic verbs. The `trait-mark` dot is always drawn. It is filled green and is `img` "<Trait> marked this tier" when the trait is marked this tier, and an empty ring that is `aria-hidden` otherwise. It is shown, not toggled. Editors get small paper −/+ steppers under the ring: 32 px at desktop, 44 px below 640 px. The group is named after the trait, and the buttons are "Decrease/Increase <Trait>", the same names as before.
- **Experiences:** board rows of an `sh-in` name field and a 50 px `sh-in` "+2" field ("Experience N modifier"). The modifier field accepts `+2`, `2`, `-1` or `−1`, is clamped to −5..10, saves on blur or Enter, and reverts if the input is invalid. It shows the saved value while unfocused (CL7: no content keys). Rows also have a small × button ("Remove <name>") and an add row ("New Experience" + Add pill), as before. Players see locked text for both fields and no controls. List keys are now the Experience `id` instead of index plus name (CL14).

## Deviations (deliberate)

- **7 identity fields instead of 6.** The acceptance keeps Class, and the open-question default adds a read-only Transformation field, so the grid has 3 rows at desktop. The box then grows above the portrait height (it is bottom-aligned with `min-height: 270px`, not a fixed height).
- **Experiences stay a dynamic list** (up to 12, with add and remove), as the analysis decided. The board has 5 fixed rows. The × button narrows the name field at desktop, so long names are cut off visually while unfocused.
- **Trait values are not direct inputs.** The board edits the ring directly. The app keeps the display ring plus the stepper, as the acceptance asks.
- **Portrait button text** reads "Portrait" with a camera icon, not the board's "Add portrait". The text belongs to `PortraitUpload` (src/components/party/portrait.tsx), which S1 does not own. There is no "Remove" button: see QUESTIONS.

## Visual comparison

App: `E2E_VISUAL=1 E2E_PORT=… E2E_CONVEX_PORT=… pnpm test:e2e tests/e2e/visual/S1.spec.ts`. Board: `node scripts/board-shots.mjs portrait identity traits experiences`.

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| portrait | test-results/visual/S1/portrait-{1440,390}.png | test-results/visual/board/portrait-{1440,390}.png | Layout, colour and spacing match: arch, double border, 270 px. The board's art is blank (blob assets don't load from disk); the app shows the subclass art. At 390 the app centres a 240 px arch. |
| identity | S1/identity-* | board/identity-* | Type and colour match (Cinzel labels, sh-in fields, locked fields, H&F tag). Layout: 3 rows instead of 2 (Class added). At 390 the fields form one column; the board overflows there. |
| traits | S1/traits-* | board/traits-* | Green heads, rings, mark dots and italic verbs match. The app adds −/+ steppers under the ring for editors. At 390 the cards form 2 columns. |
| experiences | S1/experiences-* | board/experiences-* | Row look matches (name field + 50 px value). The app adds × per row and an add row. |
| top (whole region) | S1/top-* | board/sheet-p1-* (top part) | Board column structure and gaps. |

At 390 there is no horizontal scroll: `shoot` asserts `scrollWidth <= 390`.

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3189/3490: character-sheet (3), character-wizard (4), level-up (1) and the S1 visual spec (`E2E_VISUAL=1`): 9 passed.

## QUESTIONS

- **Portrait "Remove":** the board has one, but the app has no way to clear a portrait. `sheetPatchSchema.portrait` cannot be unset, because undefined is dropped in transit, and there is no remove mutation. Adding one is outside UI-only scope.
- **Intent mutations:** traits and Experiences still save through `updateSheet` (a whole traits object or Experiences list), as before. `setTrait`, `addExperience`, `setExperience` and `removeExperience` already exist (CL3). Switching would change behaviour and the sheet context, so S1 left it to H19 or the orchestrator.
