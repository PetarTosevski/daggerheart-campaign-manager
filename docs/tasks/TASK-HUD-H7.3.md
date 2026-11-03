# TASK-HUD-H7.3: phone pickers, result and hit window as bottom sheets

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 8, tracer H7.3 (board PlayerPhone 'Picking a target' and
'You're hit', 390 × 844; HANDOFF "Phone"). Briefs: `.omc/plans/combat-hud-briefs.md` "Common rules", "Wave 8". Parent
bead dcm-bxp.99.32. Mode: add; renders only inside the HUD shell (switch on). No server change, no codegen.

## What landed

At 760 px and below (the existing phone breakpoint of H3.0 / H4.1 / H4.2):

| File | What |
|---|---|
| `hud/pick/panel.tsx` | A footer **Cancel** button (`hud-pick-cancel`, `pick.cancel()`, the same path as ✕ / Esc) before the primary. pick.css shows it only on a phone; the desktop and tablet panel is unchanged. |
| `hud/pick/pick.css` | The picking panel (every picker: card, attack, feature, the GM's purple one) is a bottom sheet: `position: fixed` on the bottom edge, full width, top radius 22, the board's handle (`::before`) and shadow, at most `min(70dvh, 100dvh − 112px)` high (clear of the phone's party strip). Rows 44 px; every button / input / select inside the picker's own rows (`extra`: weapon tiles, roll chips, steppers, spell / feature chips) at least 44 px. The header ✕ hides (the board's phone sheet has none); the footer is the board's `.bs-f`: the cost line over **Cancel + the primary**, half width each, 48 px. The footer is sticky on the sheet's bottom edge (a long picker scrolls under it) and padded 76 px so the app's floating "Ask the Lorekeeper" pill does not cover the buttons; reason / refusal lines read above it (flex `order`). "Waiting for the GM" moves to top 112 (under the party strip). The target-ring layer drops to z 29 and the action ring hides while the sheet is up (see Stacking). |
| `hud/result/result.css` | The result spot is a fixed bottom sheet (handle, radius 22, z 91, the same max height); 44 px controls (✕, chips, Done); popups with a footer (Your roll waits: Pass / Use; follow-up asks: Cancel / Confirm) get half-width 48 px buttons in a sticky footer clear of the pill; the plain result keeps its 76 px bottom room. |
| `hud/hit/hit.css` | The hit window (and "Waiting for the others") is a fixed bottom sheet (handle, radius 22, the board's red edge shadow, z 93). The footer is the board's `.bs-f.col`: the primary (Mark Armor · take n HP) on top, Take n HP / Pass under it, full width, 48 px, sticky and clear of the pill. "Pay something else?" and every button in the window at least 44 px. |
| `tests/e2e/hud-phone-sheets.spec.ts` | Three tests at 390 × 844 (below). |

## Stacking (for H7.2 and H7.1)

All of these live in `.hud-over` (z 30, shell.css), whose stacking context holds the side panel (z 90, ui.css
`.hud-panel`) and the tools drawer (z 95):

| Layer (≤ 760 px) | z-index |
|---|---|
| Tools drawer (`HudTools`) | 95 |
| **Hit window** (`.hud-hit-spot`) | **93** |
| **Picking panel** (`.hud-pk`) | **92** |
| **Result / roll waits / asks** (`.hud-res-spot`) | **91** |
| Side panel: full-screen sheet, GM stat block (`.hud-panel`) | 90 |
| H7.2's tab sheet, party strip, edge chips, GM queue sheet | **must stay below 90** (≤ 89) |

What H7.2 must respect:

1. Keep the phone tab sheet (Hand / Attack / Dice / Feed), the party strip, the edge chips and the GM's queue sheet
   **inside `.hud-over` and below z 90** (or in an ancestor stacking context that sits below it). Our sheets then cover
   the tab sheet's lower part and its top stays usable; nothing needs to close.
2. Do not give a region ancestor of the pop region a `transform`, `filter` or `contain` at phone width: the sheets are
   `position: fixed` to the viewport (an open side panel sets `.hud-r-pop { right: var(--hud-sheet-w) }`, which collapses
   the pop region to 0 px on a phone).
3. The party strip is assumed ≤ 104 px (board `.mparty`): the sheets stop 112 px below the top.
4. The map's own layers stack over `.hud-over` (they are outside it with no stacking context): on a phone pick.css drops
   the target-ring layer to z 29 and hides the action ring (`.hud-ar`) while any of the three sheets is up
   (`.hud-root:has(...)`). If H7.2 adds map layers (edge chips inside the map), keep them ≤ 29 or the sheets will be
   drawn under them.
5. The app's floating "Ask the Lorekeeper" pill (campaign layout, outside the HUD) sits bottom right at 390 px and
   covers the bottom 68 px; the sheets pad their footers 76 px for it. If the phone shell hides or moves the pill on the
   combat page, these pads (`pick.css`, `result.css`, `hit.css`, "Clear of the app's floating…") can drop to the
   board's 16 px.

Decision taken (the board never shows both): the sheets stand **over** the full-screen sheet and the GM's stat block,
because a picker opens from them (a feature's Use on the sheet, the stat block's Attack) and must stay usable; the
board's phone frame puts the sheet over its `.bs` only because they never meet.

## Board states matched (shots: `test-results/visual/HUD-H7.3/`)

- PlayerPhone 'Picking a target' → `player-picking-390.png` (the attack picker on the seed's Moss: handle, header, 44 px
  rows with bands and "GM approves", the weapon and roll rows, Cancel + "Attack Jagged Knife Bandit with …"),
  `player-picking-over-sheet-390.png` (the same over Moss's full-screen sheet), `gm-picking-390.png` (the GM's purple
  picker over the Lieutenant's stat block).
- PlayerPhone 'You're hit' → `youre-hit-390.png` (red header, damage, threshold tiles, the question, HP / Armor rows,
  Mark Armor over Take 2 HP at 48 px, over an open picker).
- `player-result-390.png`: the attack's result as a bottom sheet.
- Deviations: the footers keep 76 px of bottom room for the Lorekeeper pill (board: 16 px); the picker's cost line sits
  over the buttons (the board writes the cost under its rider); the HUD at 390 px still sits under the campaign header
  (page scroll), which H7.2's shell owns. The board's card picker ('Vicious Entangle') is the same panel; the spec opens
  the attack picker through the action ring because the phone hand moves into H7.2's tab sheet.

## What moved out of the old column

Nothing (layout only).

## Tests

- `tests/e2e/hud-phone-sheets.spec.ts` (3), at 390 × 844:
  1. player: ring → Attack; the picker is a bottom sheet (x 0, width 390, bottom on the edge, top ≥ 100), ✕ hidden,
     Cancel + primary on one row, ≥ 48 px, every visible button ≥ 44 px, nothing stacked over them
     (`elementFromPoint`), axe; Moss's full-screen sheet opened from the banner: the picker stays on top and Cancel ends
     it; the attack's result is a bottom sheet with 44 px controls, axe, ✕ closes.
  2. GM: the stat block's Attack → the purple picker is a bottom sheet over the stat block, 44 / 48 px, on top, axe,
     Cancel ends it.
  3. player: with a picker open, the Brute's hit: "You were hit" bottom sheet, Mark Armor above Take n HP, full width,
     48 px, on top, axe; Mark Armor answers and the picker underneath still answers (Cancel).
- No unit test: the change is CSS plus one button wired to the existing `pick.cancel()` (tests/unit is outside this
  tracer's owns); the e2e spec covers it.

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest focused `tests/unit/hud`: 29 files, 393 passed. Full suite (`--maxWorkers=2 --testTimeout=120000`): 476 files,
  10577 passed + 1 expected fail, 1 failed: `tests/convex/lane4-s1-card-switches.test.ts` "Rune Ward held by an ally"
  (the Ward Die rolled 8 and added reminders; random, untouched by this tracer); the file reruns 17 / 17.
- e2e (ports 3180 / 3472, servers by hand, `E2E_REUSE_SERVERS=1`): `hud-phone-sheets.spec.ts` 3 / 3. All
  `tests/e2e/hud-*.spec.ts` at desktop: 37 passed + 3 failed on the loaded first run (hud-card-pick live, hud-death,
  hud-hit: elements not found / timeouts while three other worktrees ran e2e); the three rerun 6 / 6. After the last CSS
  touch (result background, scoping): `hud-phone-sheets`, `hud-result`, `hud-queue` rerun together, 7 / 7.
- Merge order with H7.2: no shared file; H7.2's tab sheet must keep z < 90 (Stacking).

## Out-of-owns edits

None.

## Beads

- Filed **dcm-bxp.99.32.34**: `hud/queue/queue.css` styles the GM's Resolutions panel as `.hud-res`, the result panel's
  class, so the result card picks up the queue's padding / background / shadow on every viewport. H7.3's phone rules are
  scoped to `.hud-res-spot > .hud-res` so they neither lose to it nor leak into Resolutions.
- Follow-ups for H7.2 are the stacking notes above (its shell owns the pill, the page scroll and the strip height).

## QUESTIONS (safest reversible defaults taken)

1. **Sheets over the full-screen sheet?** Default: yes (pickers open from the sheet and the stat block). Alternative:
   close the side panel when a picker / hit opens on a phone.
2. **Hit footer focus order.** The board stacks the primary on top (`.bs-f.col`); the shared Popup puts the secondary
   first in the DOM, so CSS `column-reverse` puts Mark Armor on top while Tab still reaches Take n HP first. Changing
   the DOM order is `hud/ui/popup.tsx` (not owned).
3. **The Lorekeeper pill** on the combat page at phone width covers the sheets' bottom-right; 76 px of room is kept.
   Hide it on the phone combat page (H7.2 / the layout)?

## User answers 2026-11-02 (applied)

- **The Lorekeeper pill** (QUESTIONS 3): hidden on the combat map at phone width (≤ 760 px; the drawer's own pill in
  `src/components/lorekeeper/drawer/index.tsx`, by pathname, so other pages keep it). The Lorekeeper stays in the nav.
  The sheets' 76 px of bottom room is the board's 16 px again (`pick.css`, `result.css`, `hit.css`; `phone.css`'s
  72 px → 16 px plus the safe area). `hud-phone-sheets.spec.ts` checks the pill is hidden and the 16 px room.
- Seen while checking: at tablet width (1024) the pill still covers the GM stat block's Attack, so
  `hud-tablet.spec.ts:153` fails its Attack click on this host (the pill intercepts the click). Not changed here: the
  answer covers phone width only.
