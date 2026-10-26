# TASK-SR-S10: Downtime box with the rest picker

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S10 (wave 2). Depends on S0.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Downtime box (C/sections/downtime.tsx + .css):** the S0 placeholder line is gone. The box now holds the board's reference text, copied word for word from `Party.dc.html`: the SHORT REST and LONG REST blocks, with Cinzel 13 px heads in `#7a5b2e`, a 6 px flex column and bold move names.
  - The rest picker (`RestPicker`) stays at the top of the box. It renders only while the GM has a rest open.
  - While a rest is open, the moves this character has saved are highlighted in the block for that rest's kind: a green left rule and tint, plus a visible "Picked" tag ("Picked ×2" when the same move is picked twice). Prepare together highlights the Prepare entry. Frame and class moves that are not in the reference text (Make a Feast, Keep Watch, Tribute, Halt lycanthropy) are not highlighted.
  - The highlight comes from the box's own `rests.current` query, wrapped in a small error boundary. If that query fails, the boundary still renders the reference text, just without highlights (CL1).
- **Picker (src/components/party/rest/picker.tsx + new rest.css):**
  - The region "Downtime moves" is kept, now as a dashed gold inset (`rp`) instead of a nested `cs-box`. Its heading is an `h4` ("Short rest: downtime moves").
  - Move 1 and Move 2 are each a `group` named "Move N". The available moves are board chips: 44 px Garamond pills that turn green when pressed, with `aria-pressed`.
  - Ally target ("On": Myself or an ally) and Project stay `<select>`s, now with the paper field style (`sh-in`).
  - "Save moves" is a solid wine `Pill`. "Create project", "To vault" and "To loadout" are mark `Pill`s, and the project inputs use `sh-in`.
  - The logic is unchanged: the same mutations, the same state and the same viewer and unavailable rules.
- **launcher.tsx (dashboard):** not changed.

## Accessible names

These are unchanged: the region "Downtime", the region "Downtime moves", the button "Save moves", the lists "Rest loadout" and "Rest vault", the combobox "On" and the combobox "Project".

What changed: the "Move 1" and "Move 2" comboboxes are now groups with toggle buttons named after the moves. tests/e2e/rest.spec.ts and rest-frame-hooks.spec.ts are updated to match. No other spec or unit test used them.

## Visual comparison

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| downtime | test-results/visual/S10/downtime-{1440,390}.png | test-results/visual/board/downtime-{1440,390}.png | Text, heads, spacing and colours match. The app box is taller at 1440 because the grid row stretches to the Armor + Class Features column. At 390 the text wraps with no horizontal scroll. |
| downtime, rest open | test-results/visual/S10/downtime-rest-open-{1440,390}.png | (no board counterpart) | Picker on top with chips, an ally select, the solid pill and the card swaps. Picked entries are highlighted below. No horizontal scroll at 390. |

## Verification

- `pnpm lint` and `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3189/3490: rest.spec.ts, rest-frame-hooks.spec.ts, character-sheet.spec.ts and visual/S10.spec.ts (`E2E_VISUAL=1`) all passed.
