# TASK-GLASS-G4: the frame trackers use glass buttons; TRACKER_BTN is gone

Plan `.omc/plans/glass-buttons.yaml`, tracer G4; briefs `.omc/plans/glass-buttons-briefs.md` (Q1-Q9 = a); bead
dcm-q861.5. Built on G0 (9926a1bb) and follows its "Notes for the area tracers". A restyle only: labels, accessible
names, `aria-*`, roles, `type`, disabled logic and handlers are unchanged; the objective's Abandon stays a two-step.

Sizes: buttons inside a card (rows, inline forms) are small (34 px, 44 px on touch); a card's header action and
dialog buttons are medium (44 px). `TRACKER_BTN` was `min-h-10` (40 px).

## Buttons per file

All under `src/app/(gm)/campaigns/[campaignId]/trackers/`.

### `tracker-card.tsx`

`TRACKER_BTN` (38 uses in 6 files) deleted. `TrackerCard` (the panel frame and its "GM only" tag) is unchanged.

### `five-banners.tsx`

| Button | Role | Was |
|---|---|---|
| Advance week (card header) | confirm | `TRACKER_BTN` |
| Advance to week N → Cancel / Advance | cancel / confirm | `TRACKER_BTN` / `solid` |
| Shown / Hidden (`RevealToggle`, `aria-pressed`) | neutral, sm, `aria-pressed` (gold when shown) | `TRACKER_BTN` + brand border |
| − / + (Worsen / Improve relationship) | neutral, sm, icon | `TRACKER_BTN` |
| Tick −1 | confirm, sm | `TRACKER_BTN` + solid gold |
| +1, Pause / Resume, Reopen, Dismiss | neutral, sm | `TRACKER_BTN` |
| Abandon objective… (opens the confirm) | danger, sm (`self-end`) | underlined text button |
| Abandon this objective? → Keep it / Abandon | cancel, sm / danger, sm | `TRACKER_BTN` / solid red |
| Edit sheet | neutral, sm (`self-start`) | `TRACKER_BTN` |
| + Objective | neutral, sm | `TRACKER_BTN` |
| Objective dialog: Major / Minor, Steps 4 / 5 / 6 (`role="radio"`) | neutral; the checked one carries `tone: "hope"` | `TRACKER_BTN` + solid gold when checked |
| Objective dialog / sheet dialog: Cancel / Start at N, Save | cancel / confirm | `TRACKER_BTN` / `solid` |

Left alone: the relationship matrix cells (coloured rating cells of a data grid, `aria-pressed` selects one; like
hexes and pips they keep their rating colours).

### `colossus.tsx`

| Button | Role | Was |
|---|---|---|
| Hunt / Interlude (`role="radio"`, `flex-1`) | neutral; the checked one carries `tone: "hope"` | `TRACKER_BTN` + brand tint |
| Colossus defeated | confirm | `TRACKER_BTN` |
| Correction: short rest +1 / long rest +2 | neutral, sm | `TRACKER_BTN` |
| Correct Power → Set | confirm, sm | `TRACKER_BTN` |

Left alone: the Colossi-slain diamonds and the Siphoning Track slots (pips).

### `age-of-umbra.tsx`

| Button | Role | Was |
|---|---|---|
| Add pyre | neutral, sm (adds a row) | `TRACKER_BTN` |
| − / + Blessed Branch | neutral, sm, icon | `TRACKER_BTN` |
| Ignite a Blessed Branch (opens the dialog) | confirm, sm | `TRACKER_BTN` |
| Follow the map | neutral, sm | `TRACKER_BTN` |
| Vicinity → Save | confirm, sm | `TRACKER_BTN` |
| Rename → Save / Cancel | confirm, sm / cancel, sm | `TRACKER_BTN` |
| Show on map (link) | neutral, sm (`brandButton` on the `<Link>`) | `TRACKER_BTN` |
| Rename | neutral, sm | `TRACKER_BTN` |
| Remove (pyre) | danger, sm | `TRACKER_BTN` |
| Ignite dialog → Ignite | confirm | default (neutral) |
| Roll Lurking Darkness (card header) | confirm, sm | `TRACKER_BTN` |
| Lurking dialog → Remove (watcher row) | danger, sm | `TRACKER_BTN` |
| Lurking dialog → + Add watcher | neutral, sm | `TRACKER_BTN` |
| Lurking dialog → Roll d12 | confirm | default (neutral) |
| Lurking result → Done | cancel | default (neutral) |

Left alone: the pyre's flame toggle (a round burning / out status marker, like a pip).

### `andaluria.tsx`

| Button | Role | Was |
|---|---|---|
| New hunt | confirm, sm | `TRACKER_BTN` |
| Add clue | neutral, sm (adds a row) | `TRACKER_BTN` |
| Archive hunt / Restore hunt | neutral, sm | `TRACKER_BTN` |
| Delete hunt (`window.confirm` kept) | danger, sm | `TRACKER_BTN` |
| Remove (clue, `ml-auto`) | danger, sm | underlined text button |

### `horizon.tsx`

| Button | Role | Was |
|---|---|---|
| Occurred / Not yet (`aria-pressed`, `shrink-0`) | neutral, sm, `aria-pressed` | `TRACKER_BTN` + gold when occurred |

Left alone: the Soul Echo discs (pips) and the Doom Track checkboxes.

### `weredragon.tsx`

| Button | Role | Was |
|---|---|---|
| Roll the night sky | confirm, sm | `TRACKER_BTN` |
| Apply reading | confirm, sm | `TRACKER_BTN` |
| Submit secret | confirm, sm | `TRACKER_BTN` |

### `index.tsx`

No buttons (the loading card).

## Radio groups

The objective size / steps pickers and the Colossus phase switch are `role="radio"` with `aria-checked` (the specs
select them as radios). The glass "switched on" look keys on `aria-pressed`, which is not valid on a radio, so the
checked radio takes the glass Hope colour set instead: `glassButtonClass({ role: "neutral", tone: "hope", wrap: true })`
(gold rim and gold text; it has no gold glass tint, unlike `aria-pressed`). No CSS was added. If GZ wants the full
switched-on look for radios, a `[role="radio"][aria-checked="true"]` selector next to `.gb[aria-pressed="true"]` in
`glass-button.css` would do it for every tracer at once.

## Shots

`tests/e2e/visual/GLASS-G4.spec.ts` (`E2E_VISUAL=1`), one test per frame (a fresh campaign of that frame with a GM and a
player). The GM first fills the tracker through the UI, so its row buttons show. Shots in
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g4/` and `test-results/visual/GLASS-G4/` (54 files):

- `<frame>-{gm,player}-{1440,1024,390}`: the whole dashboard, for `five-banners`, `colossus`, `age-of-umbra`,
  `weredragon`, `andaluria` and `horizon`.
- `<frame>-gm-hover`: one hovered button, with axe on every tracker card in that state:
  - confirm: Advance week, Colossus defeated, Ignite a Blessed Branch, Apply reading, New hunt;
  - neutral: Horizon's Occurred toggle (Horizon has no confirm).
- `<frame>-gm-focus`: one button focused from the keyboard, with axe again.
- Dialogs and states:
  - `five-banners-objective-dialog-gm`: the objective dialog, with the checked radios in Hope;
  - `five-banners-abandon-gm`: an objective row with Tick −1, and the Abandon two-step open;
  - `five-banners-advance-dialog-gm`: the Advance week dialog;
  - `age-of-umbra-rename-gm`: Rename's Save / Cancel;
  - `age-of-umbra-ignite-dialog-gm`: the Ignite dialog;
  - `age-of-umbra-lurking-dialog-gm`: the Lurking Darkness dialog with a watcher row.
- At 1024 every visible glass button in the tracker cards is at least 44 px tall (both viewers, all six frames).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G4`: every change owned.
- vitest, touched areas (`--maxWorkers=1 --testTimeout=120000`): five-banners, colossus, age-of-umbra, andaluria,
  horizon-doom, weredragon, lazy-boundaries, sheet-drawer, frames/rule-errors, `tests/unit/brand`: 10 files, 120 passed.
  Full suite: 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3869 / 3969 with `E2E_REUSE_SERVERS=1`, `--workers=1`:
  - five-banners, age-of-umbra, andaluria, colossus, horizon, weredragon, core-calendar, glass-foundation: 16 passed.
  - visual/GLASS-G4: 6 passed (axe clean with a button hovered and with one keyboard-focused; 44 px at 1024).
