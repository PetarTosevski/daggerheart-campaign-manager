# TASK-SR-S3: Hit Points & Stress, damage calculator, Wither counter

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S3 (wave 2, depends on S0). Analysis: `.omc/autopilot/sheet-redesign-analysis.md` §6.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

UI only. No Convex changes, and the mutations and permissions are the same as before.

- **Threshold heads (C/sections/hp-stress.tsx):** three wine heads ("Minor Damage", "Major Damage", "Severe Damage") over Cinzel range fields. "Mark 1/2/3 HP" stays `sh-small` text, the default until the user decides whether these become buttons.
- **Threshold pills:** `Major N` / `Severe N` wine pills, then `=` and the breakdown as `thr-part` chips: the armor name with its base thresholds (or "Unarmored"), `Level +L`, and the subclass bonuses when there are any.
- **Take damage (C/damage-calculator.tsx):** the board's dashed `thr-take` row.
  - Fields: a "Take damage" label, the number input (still named "Damage roll"), and "Use an Armor Slot" and "Withered source" as small paper toggles. Each toggle is a real checkbox in a pill label.
  - Apply is a `Pill` (dmg-mark), and the preview is an italic `sh-small`.
  - Mutation, idempotency key per click and preview wording are unchanged.
- **HP and Stress rows:** label | 12-column `SlotRow` | 32 px paper −/+ (named "Decrease/Increase Hit Point slots" and "… Stress slots").
  - Slots past the character's maximum are drawn faded and dashed, like the board. They are decorative (`aria-hidden`).
  - Pips are the shared `Pip` heart and diamond. Their accessible names and group/img summaries are the frozen ones ("Hit Point k of m", "Hit Point: n of m marked").
- **Wither (src/components/party/wither/):** a slot row at the bottom of the same box, labelled "Wither" with the count (`data-testid="wither-tokens"`).
  - Tokens: 12 dark tokens (one per Fear Die face; more slots appear if the tokens exceed 12) form one `role="img"` row named "N Wither token(s)".
  - Controls: −/+ as 32 px paper steppers, GM only, with the same accessible names as before. The Fear Die result and errors are a `role="status"` `sh-small` line.
  - Witherwild campaigns only, as before.
- **Phone width (≤ 640 px):** each row puts its label and −/+ (44 px) on top, with the slots underneath.
  - HP and Stress use 6 × 44 px pips and hide the unused slots.
  - Wither tokens are decorative, so they stay one 12-column row of 18 px tokens.
  - Toggles and pills are at least 44 px.
- **Styles:** C/sections/hp-stress.css (`hp-*`, which damage-calculator.tsx also uses) and wither/wither.css (`wither-*`). The old `cs-thr-*`/`cs-take`/`cs-step` rules are no longer used by this box (S13 can delete them if nothing else uses them).

## Defaults taken (needs user confirmation)

- "Mark 1/2/3 HP" stays text, not buttons.
- The board's threshold "Other bonus" input is left out. The data model has no field for it, and board-only fields keep the app's existing data.
- The preview keeps the app's wording ("Severe damage: mark 3 Hit Points."). The board writes "13 damage → Severe: mark 3 HP", but the specs assert the app's wording.

## Visual comparison

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| hp-stress | test-results/visual/S3/hp-stress-{1440,390}.png | test-results/visual/board/hp-stress-{1440,390}.png | **Layout:** same order (heads, thresholds, take row, HP, Stress) and 12-column rows with −/+ at the right. The app adds the Wither row and has no Other bonus. **Type and colour:** match. Mark N HP is text, not outline pills. **At 390:** the app stacks label/−/+ over 44 px pips (no horizontal scroll), while the board squeezes 12 tiny pips into a row. |
| hp-stress-no-wither (Age of Umbra) | test-results/visual/S3/hp-stress-no-wither-{1440,390}.png | (same board shot) | Matches the board's box without the Wither row. |

The Wither row is app-only, because the board has none.

## Verification

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm test`: 100 files, 1047 tests passed.
- e2e (ports 3158/3428): character-sheet (3), death (1) and wither (1) passed; the `E2E_VISUAL=1` S3 visual spec (2) passed.
