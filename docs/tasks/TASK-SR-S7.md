# TASK-SR-S7: Class and frame extras (Beastform, Companion, Motherboard, Beast Feast, Castle High)

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S7 (wave 2). Depends on S0.

## What changed

All UI changes are in `src/components/party/extras/`. The styles are in the new `extras.css`, with classes prefixed `xs-` so they never collide with the sheet route's `cs-*` rules. No Convex changes, and permissions are as before: everyone in the campaign sees the extras, and only the owner and the GM edit them (`view.canEdit` from `characterExtras.get`).

- **ui.tsx** (shared pieces):
  - The dark `ExtraCard` and its dark class constants are gone.
  - `ExtraBox` is an `sh-box` (SheetBox) with the frame name as a wine kicker over the `sh-h` heading.
  - `PlaqueBox` is the board's white `cs-box` with a `cs-plaque` title (green rule, leaf tips, wine Cinzel). It is a region named by its title.
  - `ExtraSheet` is a wide PaperModal (`xs-sheet`, max 1000 px) on the board's paper texture. Its head carries the banner art. The `h2` title is visually hidden because the banner shows the same words, but it still names the dialog.
  - `PawIcon`.
  - `Pips` now uses sheet-ui `Pip kind="diamond"`, in a group named "<label>: n of m marked".
  - Button classes: `BTN` is the green `cs-btn` pill and `ALT_BTN` is the white one with a wine outline. Both are 44 px below 640 px.
  - Fields use `sh-in` and `sh-ta`.
- **ClassExtras** (Class Features box):
  - One `Launcher` row (`cs-launch` + green `cs-open` pill with the paw icon) for "Beastform" and one for "Companion".
  - Each opens an `ExtraSheet`: dialog "Druid Beastform" (subtitle "Your tier N") or "Ranger Companion" (subtitle "Name: …" once the companion is named).
  - `data-testid="class-extras"` is kept.
- **Beastform sheet:**
  - The intro note, then the current form in the board's green `cs-cur` bar with "Drop beastform".
  - Then the forms in a 2-column grid of tier plaques, "Tier 1 (Level 1)" to "Tier 4 (Level 8–10)". Tiers above the character's tier are dimmed and say "Unlocks at a higher tier".
  - Each form row shows the name, examples, stat line, "Gain advantage on:" and its features. Editors get a "Choose <form>" button (aria-pressed).
  - The chosen row expands with the same options as before: upgraded form (Evolved), hybrid picks, Evolution trait, then Transform / Cancel.
  - The old "Transform into" select is replaced by these rows.
- **Companion sheet:** the board's two columns.
  - Left column: the portrait frame (Name, Animal), Creation, Attack & Damage (Attack field, Range and Damage chips, damage type), and Defense (Stress diamonds that save at once, Evasion ring, drop-out warning).
  - Right column: Experiences, Training (green tick boxes and the `used / cap` counter, Vicious selects, Expert/Advanced options), Special Gifts, Inventory.
  - Save / Discard work as before. `companion-evasion` is kept.
- **FrameExtras** (frame extras region, `data-testid="character-extras"`): one `ExtraBox` per frame extra.
  - **Motherboard:** kicker "Motherboard", title "Ikonis Module". It holds three plaques:
    - the Ikonis, titled with its name (`ikonis-damage` and `ikonis-augments` are kept);
    - Scrap & Quantum, as list rows with Buy / Sell pills;
    - Augments, with armor pips for the used slots and a highlighted row for each installed augment.
  - **Beast Feast:** kicker "Beast Feast", title "Ingredients & Cookbook". It holds two plaques:
    - Ingredients, with diamond pips for carried / capacity;
    - Party Cookbook.
  - **Castle High:** kicker "Castle High", title "Skyshard Artifact".

## Deviations (deliberate)

- **Beastform: Choose, then Transform.** On the board, each form's button transforms at once and marks the Stress. In the app, Evolved and Hybrid forms and the Evolution trait need extra choices, so the button chooses the form and its options open under it. The app still does not mark the Stress (the note says so), as before.
- **Companion name:** on the board the name is a field in the sheet head. In the app it is in the portrait frame, next to the animal, because it is part of the saved draft. The head shows "Name: …" once the companion is named.
- **No Proficiency pips on the companion sheet:** `characterExtras.get` does not return Proficiency.
- **Closing a sheet drops unsaved companion edits:** PaperModal unmounts its body when it closes, like a cancelled dialog.

## Visual comparison

App shots: `E2E_VISUAL=1 pnpm test:e2e tests/e2e/visual/S7.spec.ts`. The same spec shoots the board overlays, because `scripts/board-shots.mjs` has no overlay regions and the board has no Druid or Beastbound seed. It turns the board's Test Bard into a Druid or a Beastbound Ranger in localStorage.

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| csBeast | test-results/visual/S7/beast-sheet-{1440,390}.png | test-results/visual/board/csBeast-{1440,390}.png | Layout: matches (intro note, 2-column tier plaques, form rows with dashed rules, locked tiers dimmed). The banner art loads in the app; from disk the board shows none. Type: Garamond body, where the board uses IBM Plex Sans. Button: "Choose" (see Deviations). At 390, one column. |
| csComp | S7/comp-sheet-* | board/csComp-* | Layout: matches (portrait frame, Creation, Attack & Damage chips, Defense diamonds and Evasion ring, Experiences, Training ticks, Special Gifts, Inventory). The board's name field in the head is in the portrait frame instead. No Proficiency pips. At 390, one column with no horizontal scroll. |
| launchers | S7/beast-launcher-*, S7/comp-launcher-* | sheet-p1 / class-features of a Druid or Ranger | cs-launch green-tint row, sh-small text, green pill with paw icon. |
| Motherboard | S7/motherboard-* | (none: the board has no Motherboard) | Paper sh-box with kicker and plaques, sh-in fields, armor pips for augment slots; no dark cards are left. |
| Beast Feast | S7/beast-feast-* | (none) | Same treatment; diamond pips for carried ingredients. |

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3163/3438 with `E2E_VISUAL=1`, 12 passed: visual/S7 (6), motherboard-ikonis (1; it now also checks the "Ikonis Module" region, its kicker and the augment slot pips), rest-frame-hooks, character-sheet.
