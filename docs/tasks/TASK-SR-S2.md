# TASK-SR-S2: Defence and Hope boxes (scars, Light in the Dark 7th slot)

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S2 (wave 2). Shell and primitives: `docs/tasks/TASK-SR-S0.md`.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`. Files: `C/sections/defence-hope.tsx`, `C/sections/defence-hope.css` (classes prefixed `dh-`), `tests/e2e/visual/S2.spec.ts`.

## What changed

- **Defence:** the board's centred wrap of two 76 px `sh-num` circles and the armor slot grid.
  - Evasion circle shows the derived value (`img "Evasion N"`, testid `evasion`), then the `EVASION` label, then the gear / subclass / effect modifiers as an italic `sh-small` line ("(+1 gear) (+2 effects)").
  - Editors get a small labelled "Base Evasion" `PaperNumber` under it. It keeps a local draft while focused and re-syncs from the sheet when unfocused (CL7; the old `key={sheet.evasion}` remount is gone). Same `update({ evasion })` on blur, same 0-40 range.
  - Armor circle shows the derived Armor Score (`img "Armor Score N"`), read-only (Evasion/Armor stay derived: open-question default).
  - Armor slots: board `armor-slot` shields (`Pip kind="armor"`) in a 6-column grid of 32 px (44 px at phone width). The grid holds one shield per Armor Score point, as today; the board always draws 12. Group "Armor Slot: n of m marked", buttons "Armor Slot k of m"; read-only viewers get one `img` with the same summary.
- **Hope:**
  - Head row: "Hope max N" (Cinzel 20, red and heavy once scarred, as the board's `hopeMaxStyle`) | wine `SCARS` label with a 32 px − / count / + stepper (44 px at phone width). Group "Scars", buttons "Decrease Scars" / "Increase Scars". The + now stops at `scarsMax(hopeSlotBonus)` (7 with Light in the Dark), matching the server; before it stopped at 6.
  - Coin row: the board's flex row of 40 px coins (44 px at phone width), board opacities (.2 off, .68 on). With Light in the Dark (`hopeSlotBonus` 1) the 7th coin sits in the same row with a gold ring and `title="Light in the Dark"`. Slots lost to scars (trailing slots, as before) render as the board's `hope-scar`: the coin split down a jagged crack, both halves greyed and pushed apart. When a scar takes the 7th slot, the cracked coin keeps the ring and title.
  - Names unchanged: group "Hope: n of m marked[, k lost to scars]", buttons "Hope k of m", `img "Hope slot lost to a scar"`.
  - The two italic rules lines in a 2-column `sh-small` grid (1 column at phone width).
  - "Class Hope feature": `sh-lbl` and the class's Hope feature text in a read-only lined `sh-ta` box (the board's textarea; the data model has no free-text field, so it keeps the app's data). `HopeFeatureSlot` (S6) still follows it.

## Visual comparison

App: `tests/e2e/visual/S2.spec.ts` (Bard with Hope 3, 1 scar, 1 Armor Slot marked; Beastbound Ranger at level 2 with Light in the Dark, Hope 7, then 1 scar). Board: `node scripts/board-shots.mjs defence hope`.

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| defence | test-results/visual/S2/defence-{1440,390}.png | test-results/visual/board/defence-{1440,390}.png | Layout: same centred wrap (circles, then the slot grid). Type and colour: match (Cinzel circles, sh-lbl, shield outlines and filled shields). Spacing: match. Deviations: the base Evasion input and modifier line under Evasion; one shield per Armor Score point instead of 12. |
| hope | test-results/visual/S2/hope-{1440,390}.png | test-results/visual/board/hope-{1440,390}.png | Layout: head row, coin row, rules lines, Class Hope feature: same order. Type and colour: match (red scarred max, wine scars). The board's coin art (`/_blob/`) does not load from disk, so the board shot has no coins; the app's use the same asset. The board's `hf` pill below is S6's. |
| hope (Light in the Dark) | test-results/visual/S2/hope-litd-{1440,390}.png, hope-litd-scar-{1440,390}.png | board has none (the Test Bard has no companion) | The 7th coin is in the same row at 1440 and at 390 (coins spread edge to edge at phone width so 7 × 44 px fit); gold ring; cracked when scarred. |

At 390 there is no horizontal scroll (`shoot` asserts it).

## Deliberate deviations

- Evasion and Armor circles are derived values, not inputs (open-question default); the base Evasion input sits under the Evasion circle for editors.
- Armor slot count follows the Armor Score (the server rejects marks beyond it); the board shows a fixed 12.
- Class Hope feature is read-only text in the lined box, not an editable textarea (no data field).
- Below 640 px, scar steppers and coins are 44 px (touch targets); the board uses 32 px and 40 px.

## Verification

See the tracer report (lint, typecheck, unit tests, e2e: hope-features, character-sheet, visual S2).
