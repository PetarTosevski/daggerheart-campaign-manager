# TASK-SR-S6: Hope and class features in the board's Hope and Class Features boxes

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S6 (wave 2, depends on S0). Board: `reference/designs/project/Party.dc.html`, the `hf` block (lines 824-829) and the `cf.rows` (lines 905-919).

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **`HopeFeatureSlot`** (`src/components/party/features/index.tsx`) now renders `HopeFeatureBlock` inside the Hope box, under the class Hope feature text. The block has:
  - the picker rows (ally select, feature inputs), as labelled `sh-in` fields;
  - a full-width gold outline pill named "✦ Use <feature> · <cost>", for example "Use Rogue’s Dodge · 3 Hope". The ✦ is `aria-hidden`;
  - a gold `role=status` message box. It shows a hard block first (dead, away, unconscious), then the last result, then "Needs N Hope.";
  - "Active effects": a list of `EffectRow`s, each with an End button named "End <source>", then "Got hit" when an effect lasts until a hit.
- **`FeaturesPanel`** renders the board's cf rows inside the Class Features box. It no longer has its own box or "Features" heading.
  - Each class action is one row (`role=group` named by the feature). A row holds the Cinzel title, the cost chip, the `sh-small` text, the pickers, a solid wine "Use <feature>" `Pill` and the status box.
  - Conditions and held dice are wine `thr-pill`-style chips in lists named "Conditions" and "Held dice".
  - Class state is a 2-column `dl`.
- **Class Features box** (C/sections/class-features.tsx) shows, in order:
  - ClassExtras (S7);
  - the cf rows;
  - the class feature text inside a `<details>` named "Full feature text" (collapsed, 44 px summary, lined paper body).
- **Styles** are in `src/components/party/features/features.css` (hf and cf) and C/sections/class-features.css (the disclosure). Both use the `--sheet-*` tokens and drop every `cs-*` class.
- **Unavailable characters** (dead, away, unconscious) still see the controls. The controls are disabled and the reason is shown, in the status box for the Hope feature and in each row. Viewers who cannot edit see the rows, chips, state and effects, with no buttons, as before.

## Accessible names (change from S0's frozen list)

- The **"Features" region is gone**. Specs now use the region "Class Features" for class actions, held dice, conditions and state, and the region "Hope" (exact) for the Hope feature and "Active effects".
- I updated all three specs that used the old region: class-features, class-features-hf and hope-features. No other spec or unit test used it.
- Unchanged: the groups named by the feature, "Use <feature>" (a substring of the Hope pill's name), the lists "Active effects", "Held dice" and "Conditions", "End <source>" and "Got hit".

## Deviations (deliberate)

- **Pickers come before the Use pill.** The board shows them after the click. The app needs the ally or input before the call, and the pill stays disabled until they are filled.
- **Effect duration.** There is no "(until …)" note: each effect's text already states how long it lasts, and a generic note contradicted some texts (Rogue’s Dodge).
- **Use buttons** in cf rows are the solid wine `Pill`, not the board's gold gradient. White on gold fails contrast.
- **No "Take a rest" button** under the effects (the board has one). Rests run through the GM's rest flow.

## Visual comparison

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| hope (hf block) | test-results/visual/S6/hope-{1440,390}.png, hope-effects-{1440,390}.png | test-results/visual/board/hope-{1440,390}.png | Gold outline pill, gold status box and dashed effect rows match. The pill is full width (acceptance); the board's is content width. The feature text above is S2's. |
| class-features | S6/class-features-{1440,390}.png | board/class-features-{1440,390}.png | cf rows match: cream card, Cinzel title with inline text. Same "▸ Full feature text" disclosure. The Use pill is wine, not gold. No horizontal scroll at 390. |

## Verification

- `pnpm lint` and `pnpm typecheck` are clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3127/3366 with `E2E_VISUAL=1`, 9 passed: class-features (2), class-features-hf (2), hope-features (1, now also checks the away state), character-sheet (3) and visual/S6 (1).
