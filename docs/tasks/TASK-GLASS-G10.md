# TASK-GLASS-G10: the Combat Map's edit side uses glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G10; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.11.
Built on G0 (`docs/tasks/TASK-GLASS-G0.md`) and the briefs' default answers (Q1-Q9 = a). Everything here renders
inside the campaign shell (`data-viewer` from the shell) or inside the Combat HUD (its own `data-viewer`, same value),
so no portal needs `ViewerScope`.

The GM's classic column (Maps, Play / Edit, Scene, Edit by hand, Combatants, the token card, Reveal, Vision and fog)
shows in Edit as the page's aside and in Play inside the HUD's "Map tools" drawer; the player's view card and token
card show in the HUD's "Your character" drawer; the vision card also shows in the HUD dock's Fog pop-over and the area
tools in its Areas pop-over. Those panels are this tracer's files, so they are glass in both places. The HUD's own
buttons (dock, spotlight, revive, hud/tools, card faces, tokens, map art) are untouched.

## Buttons per file

Unless noted, `cm-btn cm-sm` became `size="sm"` (34 px, 44 px at ≤ 1100 px or on touch) and `cm-btn` medium.

| File | Button | Role | Notes |
|---|---|---|---|
| `combat-map/page.tsx` | SlotBoundary "Try again" | neutral, sm | |
| `combat-map/page.tsx` | GM Fear "Spend a Fear" / "Gain a Fear" (− / +) | neutral, sm, icon | stepper (Q7 a); `cm-fear-step` dropped |
| `combat-map/page.tsx` | Map mode "▶ Play" / "✎ Edit map" | neutral, sm + `aria-pressed`, `flex-1` | a two-option switch (Q6 a) inside the `cm-seg` track |
| `combat-map/page.tsx` | `<PreviewPicker glass />` in the scene tools | (see `vision/header.tsx`) | |
| `combat-map/error.tsx`, `packs/error.tsx` | "Try again" | neutral, sm | route error boundaries |
| `combat-map/packs/page.tsx` | SlotBoundary "Try again" | neutral, sm | |
| `combat-map/packs/page.tsx` | "← Combat Map" (`<Link>`) | `brandButton` cancel | Back; `no-underline` |
| `editor/edit-tools-panel.tsx` | Edit tool (Move view, Terrain, Objects, Block sight, Erase terrain, Clear sight) | tool, sm + `aria-pressed` | palette: clear until hovered, gold when chosen |
| `editor/edit-tools-panel.tsx` | Brush 1 / 2 / 3 | tool, sm, icon + `aria-pressed` | |
| `editor/edit-tools-panel.tsx` | Terrain swatches (grass, dirt, …) | tool, sm + `aria-pressed` | keeps `cm-ed-terrain` (layout: left aligned, capitalised) |
| `editor/edit-tools-panel.tsx` | Object kinds (Tree, Bush, …) | tool, sm + `aria-pressed` | |
| `editor/edit-tools-panel.tsx` | Sprite and texture tiles (Sprites style) | tool, sm + `aria-pressed` | keeps `cm-ed-sprite` (layout: thumbnail left, name ellipsised); the thumbnail art is unchanged |
| `editor/edit-tools-panel.tsx` | "Undo all painting" | danger, sm | removes every painted square (role map: removes something); keeps `cm-ed-push` (`margin-left: auto`) |
| `editor/edit-tools-panel.tsx` | Selected object: sight (Blocks sight / Cover only / No effect) | neutral, sm + `aria-pressed` | a three-option switch |
| `editor/edit-tools-panel.tsx` | "Use the default" (was `cm-linkbtn`) | neutral, sm | |
| `editor/edit-tools-panel.tsx` | "🔥 Lit · click to put out" | neutral, sm + `aria-pressed` | keeps `cm-ed-start` (`align-self`) |
| `editor/edit-tools-panel.tsx` | Smaller / Bigger | neutral, sm | |
| `editor/edit-tools-panel.tsx` | Rotate left / right (⟲ ⟳) | neutral, sm, icon | |
| `editor/edit-tools-panel.tsx` | "Done" | cancel, sm | closes the object card |
| `editor/edit-tools-panel.tsx` | "Delete" | danger, sm | |
| `generate/scene-panel.tsx` | Suggested scene chips | neutral, sm | `cm-scene-chip` dropped (44 px came from the class; small glass is 44 px on touch) |
| `generate/scene-panel.tsx` | Size Small / Medium / Large | neutral, sm + `aria-pressed` | |
| `generate/scene-panel.tsx` | "✦ Generate map" / "✦ Regenerate map" (was `cm-go`) | confirm | the card's main action |
| `generate/scene-panel.tsx` | "↻ Another version" | neutral | the second action beside Regenerate |
| `generate/scene-panel.tsx` | "＋ Generate new map" | confirm on an image map (its only generate button, was `cm-go`), else neutral | |
| `generate/scene-panel.tsx` | "Stop" (while drawing) | cancel, sm | |
| `maps/image-upload.tsx` | `MapImageButton` default class | `brandButton` neutral | "🖼 Use my own map image" in the Scene card |
| `maps/maps-panel.tsx` | "＋ New map" | neutral, sm | `aria-expanded` unchanged |
| `maps/maps-panel.tsx` | Blank map Small / Medium / Large | neutral, sm | three equal choices: none is the main one |
| `maps/maps-panel.tsx` | "🖼 From my own map image", row "Image" (`MapImageButton`) | `brandButton` neutral, sm | |
| `maps/maps-panel.tsx` | Row Set live / Rename / Duplicate | neutral, sm | |
| `maps/maps-panel.tsx` | Row "Delete" / "Confirm delete" (two taps) | danger, sm | |
| `packs/index.tsx` | `PacksLink` "Sprite packs" (`<Link>`) | `brandButton` neutral | `no-underline` |
| `packs/index.tsx` | "Create pack" (submit) | confirm | |
| `packs/pack-card.tsx` | "Delete pack" / "Confirm delete" | danger | |
| `packs/pack-card.tsx` | "＋ Add sprites" / "Hide upload" | neutral | |
| `packs/pack-card.tsx` | Sprite row ↑ / ↓ | neutral, sm, icon | `cm-pk-move` dropped |
| `packs/pack-card.tsx` | Sprite row "Delete" / "Confirm delete" | danger, sm | |
| `packs/uploader.tsx` | "Choose images…" | neutral | |
| `packs/uploader.tsx` | Sheet layout options | neutral, sm + `aria-pressed` | a switch |
| `packs/uploader.tsx` | Select all / Select none | neutral, sm | |
| `packs/uploader.tsx` | "Upload selected (n)" (was `cm-go`) | confirm | |
| `packs/uploader.tsx` | "Clear" | cancel | backs out of the cut sprites |
| `style/index.tsx` | Map style Classic / Sprites | neutral, sm + `aria-pressed`, `flex-1` | inside the `cm-seg` track |
| `vision/header.tsx` | `PreviewPicker` "👁 Player view ▾" and its menu items | neutral, sm (glass only with the new `glass` prop) | see "Left alone" for the dock; the chosen menu item (`aria-checked`) gets the switched-on gold |
| `vision/panels.tsx` | Light you carry (No light, Torch, …) | neutral, sm + `aria-pressed` | |
| `vision/panels.tsx` | Door Open / Close | neutral, sm + `aria-pressed` | disabled out of reach, unchanged |
| `vision/panels.tsx` | "Find me", "⟲ Turn", "Turn ⟳" | neutral, sm | |
| `vision/panels.tsx` | "◎ Range circles" | neutral, sm + `aria-pressed` | |
| `vision/panels.tsx` | "Done" | cancel, sm | |
| `vision/panels.tsx` | See the map as (GM / each PC) | neutral, sm + `aria-pressed` | |
| `vision/panels.tsx` | Fog brush Off / Reveal / Hide / Erase | tool, sm + `aria-pressed` | palette |
| `vision/panels.tsx` | Brush 1 / 2 / 3 | tool, sm, icon + `aria-pressed` | |
| `vision/panels.tsx` | "Clear marks" / "Forget explored" (two taps) | danger, sm | |
| `vision/panels.tsx` | Reveal to (each PC) | neutral, sm + `aria-pressed` | |
| `vision/vision-layer.tsx` | Error line "Dismiss" | cancel, sm | |
| `map-view/map-board.tsx` | "Make live" | neutral, sm | |
| `map-view/map-board.tsx` | "Areas", "Aa Names" | tool, sm + `aria-pressed` | the board's toolbar |
| `map-view/map-board.tsx` | Zoom out / Zoom in (− / +) | tool, sm, icon | |
| `map-view/map-board.tsx` | "Fit" | tool, sm | |
| `map-view/grid-controls.tsx` | Smaller / Bigger squares, Shift grid ← → ↑ ↓ | tool, sm, icon | |
| `map-view/grid-controls.tsx` | "✥ Drag to shift" | tool, sm + `aria-pressed` | |
| `map-view/area-pick.tsx` | Pick bar "Cancel" | cancel, sm | |
| `map-view/area-pick.tsx` | Result line ✕ ("Dismiss") | cancel, sm, icon | |
| `map-view/area-overlay.tsx` | Boundary "Try again" | neutral, sm | |
| `map-view/area-overlay.tsx` | Area "Move", "Pick on the map" | neutral, sm | |
| `map-view/area-overlay.tsx` | Area "Remove" | danger, sm | |
| `tokens/combatants-panel.tsx` | "＋ Party (n)", "＋ Session encounter" | neutral | panel actions |
| `tokens/combatants-panel.tsx` | "Clear tokens" / "Click again to clear" | danger | |
| `tokens/combatants-panel.tsx` | Queue chips "⚔ <adversary>" (was `cm-chip`) | neutral, sm | |
| `tokens/combatants-panel.tsx` | "Place all" | neutral, sm | keeps `cm-self-start` |
| `tokens/combatants-panel.tsx` | Custom token side (Ally, Enemy, …) | neutral, sm + `aria-pressed` | |
| `tokens/combatants-panel.tsx` | "＋ Add token" (submit) | confirm | keeps `cm-self-start` |
| `tokens/token-panel.tsx` | "◎ Hide all circles", "◎ Range circles" | neutral, sm (+ `aria-pressed`) | |
| `tokens/token-panel.tsx` | "End <effect> · n Fear" | confirm, sm | spending Fear (briefs, G9 note) |
| `tokens/token-panel.tsx` | Conditions (PC and tracker), Side, Size | neutral, sm + `aria-pressed` | chips / switches |
| `tokens/token-panel.tsx` | Turn left / right (⟲ ⟳) | neutral, sm, icon | |
| `tokens/token-panel.tsx` | "Done" | cancel, sm | |
| `tokens/token-panel.tsx` | "Remove from map" | danger, sm | |
| `tokens/tokens-layer.tsx` | Error line "Dismiss" | cancel, sm | |

Behaviour is unchanged: labels, accessible names, `aria-*`, `data-testid`s, `type`, disabled logic, the two-tap
deletes and every handler are as before.

### Left alone, and why

| File | Button | Why |
|---|---|---|
| `vision/header.tsx` | The HUD dock's "👁 Player view ▾" (and its menu) | the dock is the HUD: `hud/dock/index.tsx` renders `<PreviewPicker {...state} />` without `glass`, so it keeps `cm-btn cm-pv-btn` and the dock's own `.hud-dock .cm-pv-btn` look, pixel for pixel. Only the scene tools (`page.tsx`) pass `glass`. |
| `maps/maps-panel.tsx` | Map row name (`cm-maprow-name`) | a list row that opens the map |
| `tokens/token-panel.tsx` | HP / Stress pips (`cm-pip`) | pips |
| `tokens/tokens-layer.tsx`, `vision/vision-layer.tsx` | Tokens, door and light markers on the board | map art |
| `settings/hand-sharing.tsx` | "Players can see each other's cards" | a `role="switch"` checkbox, not a button |

## CSS

| File | Change |
|---|---|
| `combat-map/combat-map.css` | `.cm-seg button` rules (look, pressed, focus, touch) now `.cm-seg button:not(.gb)`: the track's glass buttons keep the glass look (the old rule's 0,1,1 specificity beat `.gb`). G11's roll controls can use the same track. `.cm-fear .cm-fear-step` (both) deleted. The `.cm-btn`, `.cm-go`, `.cm-danger`, `.cm-chip` rules **stay**: G11's files (actions, drawer, requests) and the HUD dock's Player view still use `cm-btn`; GZ removes them. |
| `editor/editor.css` | `.cm-btn.cm-ed-terrain` / `.cm-btn.cm-ed-sprite` → `.gb.cm-ed-terrain` / `.gb.cm-ed-sprite` (layout only); `.cm-linkbtn` (+ `:focus-visible`, the 44 px touch rule) deleted |
| `generate/generate.css` | `.cm-scene-chip` and the phones' `.cm-scene-actions .cm-go / .cm-btn` 44 px rule deleted |
| `map-view/map-view.css` | `.cm-area-tools .cm-btn`, `.cm-area-pick-bar .cm-btn` dropped from the touch rule |
| `packs/packs.css` | `.cm-pk-packrow .cm-btn`, `.cm-pk-move` deleted |
| `style/style-switch.css` | `.cm-style-seg button` deleted |
| `vision/vision.css` | `.cm-pv-btn` background deleted (the dock's rule sets its own); `.gb.cm-pv-item` (left aligned) and `.gb.cm-pv-item[aria-checked="true"]` (the switched-on gold through `--text` and the Hope rim) added for the glass menu |

## HUD unchanged

- No file under `src/components/combat-map/hud/**` changed.
- The dock's Player view is asserted in `GLASS-G10.spec.ts`: class `cm-pv-btn`, no `gb`.
- `hud-shell`, `hud-tablet` and `hud-dock` pass.
- The classic panels inside the HUD's drawers and pop-overs are this tracer's files and are glass now (briefs: "The panels also render in the HUD's tools drawer in Play, so shoot both"). That covers Map tools, Your character, the Fog card and the Areas tools.

## Shots

`tests/e2e/visual/GLASS-G10.spec.ts` (`E2E_VISUAL=1`) writes to `test-results/visual/GLASS-G10/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g10/`:

- `tools-gm-1440`: Play, the HUD's Map tools drawer (Fear stepper, map style switch, Player view, Maps with Delete, the Play / Edit switch, Combatants with Clear tokens). axe clean.
- `fog-pop-gm`: the dock's Fog pop-over (See the map as, the fog brush tools, Clear marks / Forget explored). axe clean.
- `edit-gm-{1440,1024,390}` and `-full`: the GM's Edit layout (header tools, Maps, Scene, Edit by hand with the terrain palette, the map toolbar). Every glass button is at least 44 px at 1024 and 390.
- `scene-gm-hover-confirm`: a hovered "✦ Generate map" (the GM's Fear confirm; the spec checks its rim is not the Hope gold). axe clean.
- `edit-gm-focus-tool`: a keyboard-focused "Objects" tool. axe clean.
- `object-gm-hover-delete`: the selected crate's card, Done (cancel, the GM's Hope) and a hovered Delete. axe clean.
- `packs-gm-{1440,1024,390}`: the sprite packs page ("← Combat Map" cancel, Create pack confirm). axe clean.
- `drawer-player-{1440,1024,390}`: the player's "Your character" drawer (view card with Find me / Turn / carried light, and the token card after Find me). 44 px at 1024 and 390, axe clean.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm tracer:guard .omc/plans/glass-buttons.yaml G10`: OK.
- vitest (`--maxWorkers=1 --testTimeout=120000`):
  - touched areas (`tests/unit/hud`, `tests/unit/combat-map`, `tests/unit/brand`, `error-boundaries-redirect`, `combat-doors`, `combat-vision-tokens`, `area-effects-kinds`, `lane4-e4-picks-glow`, `combat-actions/distance-sight`): 50 files, 689 passed.
  - full suite: 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3889 / 3989, `E2E_REUSE_SERVERS=1`, `--workers=1`:
  - `visual/GLASS-G10` (`E2E_VISUAL=1`): 1 passed.
  - These 22 specs passed: combat-map-edit, combat-map-flow, combat-map-generate, combat-map-shell, combat-maps,
    combat-tokens, combat-vision, combat-light-uploaded, combat-movement, area-overlay, sprite-edit, sprite-generate,
    sprite-packs-flow, sprite-packs-shell, sprite-packs-upload, sprite-style, hud-shell, hud-tablet, hud-dock, and the
    visual C4, SP-P7, SP-P8. In all, 49 tests passed.
  - **Failing before G10 (stale since the HUD cut-over H8.1 / H8.2, 2026-11-03), not caused by this restyle:** the
    visual C3, C5, C6, C8, MV-M1, SP-P6, SP-P9 and SP-P10. Each one fails before it reaches a button this tracer
    changed. They were written for the classic Play layout:
    - C3, C5, C6, SP-P6 and SP-P9 wait for the `complementary "Map tools"` aside on a page that has a map. With a map,
      Play is now the HUD, so that column sits in the closed drawer.
    - C8 and SP-P10 wait for the player's `region "Your view"`, which now sits in the closed "Your character" drawer.
    - MV-M1 looks for the player's token as `^Ash, Party…your character`. HUD tokens read "Open Ash's sheet, …".
    - None of them changed after the cut-over except C8 (a query rename). They need the `openMapTools` helper
      (`tests/e2e/hud/helpers.ts`) and the HUD token names. That is a follow-up outside G10's owns.
