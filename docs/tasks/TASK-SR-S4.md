# TASK-SR-S4: Active Weapons, Active Armor, Ikonis block

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S4 (wave 2). Depends on S0.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

All changes are in C/sections/equipment.tsx and C/sections/equipment.css (classes prefixed `eq-`).

- **Proficiency row:** the label, then the board's crossed-sword pips (`prof-sword`, as `eq-sword`), then the italic "why" line, for example "1 base +1 Tier 2 +1 Tier 3". The line counts 1 base, +1 for each achievement level reached (2, 5, 8; `ACHIEVEMENT_LEVELS`), and attributes anything above that to "+N advancement(s)". When Proficiency is lower than that count (a GM level correction does not change Proficiency), the line is left out instead of showing a wrong reason. The pips keep `role=img` "Proficiency N". The why line is also the pips' `title`. The big number after the pips is gone, as on the board.
- **Weapon blocks (Primary, Secondary):** a dashed top rule, a green Cinzel title (`h4`), and a 2-column grid: Name | Trait & Range / Damage dice | Feature.
  - Name stays a tier-filtered select for editors ("Primary weapon", "Secondary weapon"). Other viewers get a locked field.
  - Trait & Range, Damage dice and Feature are locked fields (`paperField.locked`). Feature holds the feature name and text, plus the burden (One-handed/Two-handed/Barehanded) in italics; it grows to fit the text.
  - With no weapon, the three derived fields show "—" (the board shows empty fields). `primary-damage` / `secondary-damage` stay on the Damage dice field when a weapon is set.
- **Ikonis (Motherboard, no primary weapon):** a Cinzel green "Ikonis" title (17 px) over the same 2-column grid: Name, Trait & Range, Damage dice, and Feature (the Ikonis description or "—", plus "Two-handed"). Under it, a note: "Edit it and its augments in the Motherboard panel below." `data-testid="ikonis-weapon"` is kept on the block.
- **Active Armor:** a 2-column grid.
  - Name is a select for editors ("Active armor") and locked for other viewers.
  - Base score is locked (derived Armor Score, as before), with the hint "Sets your Armor Score".
  - Base thresholds is the board's `thr-split`, read-only (locked colouring): Major top-left, Severe bottom-right, crack SVG. Screen readers hear "Major 5" and "Severe 11" (sr-only prefixes). With no armor, it shows the italic Major/Severe placeholders.
  - Feature is locked.
- **390 px:** the field grids drop to one column below 520 px. There is no horizontal scroll (checked by `shoot`).

## Visual comparison

App shots: `E2E_VISUAL=1 pnpm test:e2e tests/e2e/visual/S4.spec.ts`. Board shots: `node scripts/board-shots.mjs weapons armor`.

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| weapons | test-results/visual/S4/weapons-{1440,390}.png | test-results/visual/board/weapons-{1440,390}.png | Layout: matches (proficiency row with swords and why line; Primary/Secondary blocks with dashed rule, green Cinzel title, 2-column Name/Trait & Range/Damage dice/Feature grid). Type: Cinzel labels and titles, Garamond values match. Colour: locked fields use the sh-locked tint where the board shows editable inputs (derived data). Spacing: matches. At 390 the app stacks fields in one column; the board keeps two narrow columns. |
| armor | test-results/visual/S4/armor-{1440,390}.png | test-results/visual/board/armor-{1440,390}.png | Layout: matches (Name, Base score + "Sets your Armor Score", cracked split thresholds, Feature). Type and colour: match, with locked tint on the derived fields. At 390, one column. |
| motherboard-weapons (app only) | test-results/visual/S4/motherboard-weapons-{1440,390}.png | (none: the board has no Motherboard) | Ikonis title and grid in the weapon-block format; the edit note sits under the grid. |

## Deviations (deliberate)

- **Locked fields, not free text:** the board's weapon and armor fields are free text. In the app, names are selects for editors and every other value is derived from the SRD, so those fields are locked (acceptance item 1).
- **Burden in the Feature field:** the board has no burden field. The app already showed the burden, so it is kept as an italic line in Feature.
- **Why line omitted when inconsistent:** see Proficiency above.
- **Empty values:** "—" in locked fields with no weapon or armor, so a read-only field is not mistaken for an empty input.

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3198/3508 (with `E2E_VISUAL=1`), 8 passed: character-sheet (3), equipment-tiers (2), motherboard-ikonis (1), visual/S4 (2).
