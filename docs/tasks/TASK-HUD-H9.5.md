# TASK-HUD-H9.5: class controls move into the HUD sheet

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, batch A, tracer H9.5 (boards Main, GMDesktop). User answer
Q5 (a) (`.omc/plans/combat-hud-v2-delta.md`, "User answers 2026-11-04"); bead dcm-bxp.99.32.43 (the orchestrator closes
it after merge). Mode: replace. No server change, no codegen.

## What landed

- **The class controls are on the HUD sheet panel** (`hud/sheet/class.tsx`, mounted by `hud/sheet/panel.tsx`). Each one
  sits where it belongs on the sheet:
  - **class counters and held dice**, as chips right under the trackers (`SheetCounters`, list "Class counters",
    testid `hud-sheet-counters`);
  - **Beastform "Drop out" (Q10) and the Martial Artist's Focus / Refocus / stance shifts (Q5)**, in a new
    "Beastform and stance" section just above Features (`SheetForm`, testid `hud-sheet-form`);
  - **Flying (Q16)** at the top of "Conditions & lasting effects", where the Flying effect is also listed
    (`SheetFlying`, testid `hud-sheet-flying`);
  - **DA7 "Active"**: a feature whose effect still holds (Rogue's Dodge) shows "Active <when it comes back>." under its
    name and an "Active" badge where the Use was, instead of "Used · …" (`FeatureHeld`, testids `hud-sheet-active`,
    `hud-sheet-held`; the row gets `data-state="active"`).
- **Who sees what** (the sheet's modes, `sheetRights`):
  - own PC: the controls act;
  - GM, any PC: shown, greyed (`data-greyed="true"`) and disabled until "Play for this character" (DA6), as
    `SheetExtras` did;
  - another player (view mode): never reads `combatFeatures.drawer` (refused while hands are hidden, U1). A read-only
    "Class state" chip list shows the Beastform and Flying from `combatHud.sheet` (`SheetClassView`); counters and Focus
    are not on that read.
- **Same controls, same server calls.** The sheet reuses `FlyingToggle`, `BeastformControl` and `StanceControls` from
  `drawer/list/controls.tsx` unchanged (`combatFeatures.setFlying`, `classFeatures.endEffect`,
  `combatFeatures.shiftStance` / `refocus`, with their optimistic updates) on `combatFeatures.drawer`. Each part has its
  own `PartBoundary`; a used feature's row asks the drawer in its own boundary (while it loads, the row keeps "Used").
- **`SheetExtras` is gone**: `drawer/index.tsx` is deleted, and both mounts in `page.tsx` (the GM's Map tools column
  and the player's "Your character" drawer) are removed. The drawer holds map tools only.
- `drawer/drawer.css` (the `sd-*` control styles) was loaded only through `drawer/index.tsx`; `hud/sheet/panel.tsx` now
  imports it. `sheet.css` adds `.hsh-class`, `.hsh-chips`, `.hsh-active`.

## Files

| File | Change |
|---|---|
| `src/components/combat-map/hud/sheet/class.tsx` | New: `SheetCounters`, `SheetForm`, `SheetFlying`, `FeatureHeld`, `SheetClassView`, `classControlsOf` |
| `src/components/combat-map/hud/sheet/panel.tsx` | Mounts them; `FeatureRow` split into `FeatureRow` (asks `FeatureHeld` for used rows) and `FeatureRowBody`; `SheetConditions` takes children (Flying); imports `drawer.css` |
| `src/components/combat-map/hud/sheet/sheet.css` | Class controls and Active styles |
| `src/components/combat-map/drawer/index.tsx` | Deleted (`SheetExtras`) |
| `src/components/combat-map/drawer/drawer.css` | Header comment only |
| `src/app/(gm)/campaigns/[campaignId]/combat-map/page.tsx` | `SheetExtras` import and both mounts removed |
| `tests/unit/hud/sheet-class-controls.test.tsx` | New: the ported `SheetExtras` tests plus placement, Refocus, Active, view mode |
| `tests/unit/sheet-drawer.test.tsx` | `SheetExtras` tests removed (moved to the file above); models and `D5Use` kept. Added to owns by the orchestrator (rebuild aa18499a) |
| `tests/e2e/hud-sheet.spec.ts` | New test: Moss in Winged Beast; GM greyed until Play-for; player's Flying (server + GM's sheet live); Drop out; no `sheet-extras` in Map tools |

`tests/e2e/combat-vision.spec.ts` (in owns) needed no change: it opens "Your character" for the light pill and "Your
view" only.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest `tests/unit/hud/**`, `tests/unit/sheet-drawer.test.tsx`, `drawer-prompts`, `drawer-use`: 34 files, 462 passed.
- e2e on ports 3693 / 3793, servers by hand (`E2E_REUSE_SERVERS=1`; the managed web server timed out at load 60),
  `--workers=1`: `hud-sheet` (3), `combat-vision`, `hud-shell` (2), `combat-cannonball`, `hud-phone` (2): 9 / 9 passed.
- Axe found that the classic `sd-grey` fade (opacity 0.55) fails colour contrast on the GM's greyed labels. In the sheet
  the controls no longer fade (`.hsh-class` resets the opacity); their buttons are disabled instead.

## QUESTIONS (defaults taken)

1. **View mode** shows only the Beastform and Flying (read only, from `combatHud.sheet`). Counters, held dice, Focus and
   the active stance are not on that read; showing them to other players needs a server field on `combatHud.sheet`.
   Default: not shown (as before: `SheetExtras` never showed them to other players).
2. **"Active" in view mode** still reads "Used · …": `combatHud.sheet` folds `active` into `used`. A `held` flag on the
   sheet feature would fix it server-side.
3. **"Full sheet" link** (the bead's last item) is not part of Q5's answer; not added.
