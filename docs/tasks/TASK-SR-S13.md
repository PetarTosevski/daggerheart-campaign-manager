# TASK-SR-S13: Whole-sheet polish, player view and 390 px pass

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S13 (polish, after S0-S12). UI only, no `convex/` changes.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Old cs-* rules deleted (C/sheet.css):** every rule whose class no file references any more: `cs-box`, `cs-h`, `cs-lvl`, `cs-num`, `cs-circle`, `cs-trait-head`, `cs-pill`/`cs-solid`, `cs-thr-*`, `cs-take`, `cs-heart`, `cs-diamond`, `cs-armor`, `cs-coin`, `cs-prof`, `cs-cards`, `cs-dkc-*`, `cs-felt*`, `cs-hc-*`, `cs-status`. Each was checked with grep over `src/` and `tests/` (literal and template-literal uses). What is left is the tokens, the shell, the page grids, the Domains sub-tabs and the field rules `fields.tsx` still names (`cs-in`, `cs-ro`, `cs-ta`, `cs-lbl`, `cs-small`, `cs-step`, `cs-slot-row`, `cs-pip`, `cs-scar`).
- **Status controls under the footer (C/sheet.tsx):** `StatusControls` moved from the end of page 1 to just after the footer, so it shows on every page. It shares the footer's rule (`.cs-foot + .st-row` drops its own). Region "Status" and group "Character status" are unchanged.
- **No dark theme left in the sheet route:** the "Loading character…" and "Character not found" states are small paper cards on the sheet backdrop (`cs-empty`, `cs-back`), replacing `text-muted-text`, `text-parchment` and the brand button.
- **Parchment dialogs (sheet-ui.css):** `.sh-modal` sets `color-scheme: light`, so native controls in every PaperModal render light on the parchment.
- **390 px touch target:** the "Damage roll" field was 40 px tall at phone width. sheet.css raises it to 44 px below 640 px (`.sh-in.hp-take-in`). The rule belongs in sections/hp-stress.css, which S13 doesn't own.
- **Unit test (tests/unit/sheet-render.test.ts):** the open-rest mock now has the full `rests.current` shape (`kind`, `startedAt`, `gmOverride`, `choices: []`, `moves: []`), and `characters:listByCampaign` returns a list, so the rest picker renders for real instead of failing quietly. The shell test checks that the status row follows the footer.
- **Visual spec (tests/e2e/visual/S13.spec.ts):**
  - GM: on every page and sub-tab at 390, no horizontal scroll and no interactive control under 44 × 44 px. Checkboxes are measured by their label, and the ▲/− badges by their `::before` hit area. The Level Up tier checkboxes are skipped because they are disabled and only show state. Then every page is shot at 1440 and 390.
  - Player: `e2e-player@example.test` joins with the join code (fixtures `signInAsTestGm`) and opens the GM's character. On every page there are no non-tab buttons, no enabled textbox, combobox, checkbox, spinbutton or radio, no Status row and no level-up badge. There are at least 7 locked fields. The same 390 checks run, then every page is shot.

## Visual comparison

App: `E2E_VISUAL=1 pnpm test:e2e tests/e2e/visual/S13.spec.ts` → `test-results/visual/S13/{gm,player}-{sheet-p1,sheet-p2,sheet-p3,sheet-p3-hero}-{1440,390}.png`. Board: `node scripts/board-shots.mjs sheet-p1 sheet-p2 sheet-p3 sheet-p3-hero`.

| Page | Verdict |
|---|---|
| sheet-p1 | Board order, boxes, type and colour match. The status row now sits under the footer line, as the analysis proposed. Player: locked identity fields; no steppers, dice box, Take damage row, Use pills or status row. |
| sheet-p2 | Wealth, Inventory, the three text boxes, the Level Up tiers and Notes in the board's style. Player: lined read-only text, disabled tier boxes. |
| sheet-p3 | dk-tabs sub-tabs, domains box, felt hand and vault. Player: the deck is a picture and the vault is spread. |
| sheet-p3-hero | Hero cards with lock lines; the same for GM and player. |

At 390 every page stacks with no horizontal scroll, and every interactive control is at least 44 px (asserted).

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed.
- `E2E_VISUAL=1` S13 spec: 2 passed.
- Full e2e suite (`pnpm test:e2e`): 67 passed.
