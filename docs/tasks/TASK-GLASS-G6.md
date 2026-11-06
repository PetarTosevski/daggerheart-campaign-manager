# TASK-GLASS-G6: Codex and World Map buttons are glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G6; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.7.
Built on G0 (`docs/tasks/TASK-GLASS-G0.md`) and the briefs' default answers (Q1-Q9 = a). Owns
`src/app/(gm)/campaigns/[campaignId]/codex/**` and `.../world/**`. The hex overlay is not touched (dcm-kggd is a
separate bug); map tokens, hexes, pins and sprite art keep their look.

## Buttons per file

### Codex

| File | Button | Role | Notes |
|---|---|---|---|
| `codex/page.tsx` | "👁 Player view" / "← Back to GM view" (GM) | neutral + `aria-pressed` | a switch (Q6 a); was a gold / black pill |
| `codex/page.tsx` | "+ New character" / "+ New location" | confirm | `flex-1` kept |
| `codex/page.tsx` | "📍 From map" | neutral | beside the confirm (two-confirms rule) |
| `codex/entry-detail.tsx` | "👁 Reveal true allegiance" | neutral, sm | |
| `codex/entry-detail.tsx` | "👁 Known to players" / "🔒 Secret from players" | neutral + `aria-pressed` | was green / red; the pressed (known) one glows gold |
| `codex/entry-detail.tsx` | "📍 Link to map pin" / "📍 Change pin" | neutral | |
| `codex/entry-detail.tsx` | "🗺 Show on map" (`<Link>`, GM and player) | neutral (`brandButton`) | the player's keeps `self-start` |
| `codex/entry-detail.tsx` | "Unlink" | neutral | keeps the pin, only drops the link |
| `codex/entry-detail.tsx` | "Delete" / "Click again to delete" | danger | the two-tap stays a two-tap |
| `codex/gallery.tsx` | tile "👁 Revealed" / "🔒 Hidden" | neutral, sm + `aria-pressed` | `flex-none` so the label stays on one line |
| `codex/gallery.tsx` | tile ★ "Use as the main picture" | neutral, sm, icon | the cover is lit with `gb-hope` (the Hope colour set), not `aria-pressed`: picking it again does not unpick it, so it is not a switch |
| `codex/gallery.tsx` | tile × "Delete image" / "Sure?" | danger, sm (icon until the first tap) | two-tap unchanged |
| `codex/gallery.tsx` | lightbox ‹ "Previous image", › "Next image" | neutral, icon | |
| `codex/gallery.tsx` | lightbox "Close · Esc" | cancel | |
| `codex/pin-picker.tsx` | "Cancel" | cancel | |

### World Map

| File | Button | Role | Notes |
|---|---|---|---|
| `world/world-board.tsx` | map toolbar: 🗺 Terrain, ⬡ Hex grid, 🖌 Paint, 👁 Player view / ✎ GM view, 📏 Measure, Hide all tokens / Show tokens, ⛶ Full screen | tool + `aria-pressed` | lit gold when on; keep `tip` (see CSS) |
| `world/world-board.tsx` | Zoom out −, Zoom in + | tool, icon | |
| `world/world-board.tsx` | Fit | tool | |
| `world/world-board.tsx` | paint toolbar: brush sizes | tool, sm, icon + `aria-pressed` | the inline 36 px style is gone |
| `world/world-board.tsx` | paint toolbar: "↶ Undo stroke" | cancel | Undo |
| `world/world-board.tsx` | paint toolbar: "Reset to suggested" | neutral | |
| `world/world-board.tsx` | paint toolbar: "Done" | cancel | strokes save as they are painted, so Done only closes the toolbar (as G13's sharing Done) |
| `world/world-board.tsx` | route panel: Straight line / Waypoints / Freehand | neutral, sm + `aria-pressed` | a three-way switch |
| `world/world-board.tsx` | route panel: Miles / Kilometres, "Speeds…", "Clear" | neutral, sm | |
| `world/world-board.tsx` | route panel: "Undo point" | cancel, sm | |
| `world/world-board.tsx` | route panel: "Move party along route" | confirm, sm | |
| `world/world-board.tsx` | route panel: "Done" | cancel, sm | was a 34 px gold override |
| `world/travel-legend.tsx` | "Edit speeds…" | neutral, sm | `ml-auto` kept |
| `world/travel-rules.tsx` | "Restore the board's speeds" | neutral | |
| `world/travel-rules.tsx` | "Save speeds" (submit) | confirm | the Modal's ✕ is `brand/modal.tsx` (G0) |
| `world/palette.tsx` | marker buttons (Village, Cave, …, custom) | tool, sm + `aria-pressed` | a palette tool (placing = on); keeps `pal` for its row layout and grab cursor |
| `world/palette.tsx` | ✎ "Rename …" | neutral, sm, icon | |
| `world/palette.tsx` | ✓ "Save name" | confirm, sm, icon | |
| `world/palette.tsx` | "Add to menu" | confirm, sm | |
| `world/token-panel.tsx` | "Send party here" | confirm | `flex-1` kept |
| `world/token-panel.tsx` | "Delete" (marker) | danger | |
| `world/token-panel.tsx` | "Clear party trail" | neutral, sm | a reset (role map: "Reset counts" is neutral); `mt-1` kept |
| `world/map-image.tsx` | "Upload map image" / "Replace map image" | confirm | |
| `world/map-image.tsx` | "Remove map image" / "Use the frame's map" | danger, sm | both drop the uploaded image |
| `world/hex-panel.tsx` | "Set origin by clicking the map" | neutral, sm + `aria-pressed` | |
| `world/hex-panel.tsx` | "Move the party here" | confirm | |
| `world/hex-panel.tsx` | "Place the party here (no travel)" | neutral, sm | the second action beside the confirm |
| `world/crawl-regions.tsx` | "Collect the Echo" | confirm, sm | |
| `world/crawl-regions.tsx` | "Locate Soul Echoes" | neutral, sm | |
| `world/crawl-regions.tsx` | "Generate region" (submit) | confirm, sm | the form's main action |
| `world/crawl-regions.tsx` | "Paint hex … with this region", "Roll another encounter" | neutral, sm | |
| `world/crawl-regions.tsx` | "Remove region" | danger, sm | |

### Left alone, and why

| File | Button | Why |
|---|---|---|
| `codex/page.tsx` | Characters / Locations, and the region / allegiance chips (`role="tab"`) | page tabs stay (Q6 a) |
| `codex/entry-list.tsx` | entry rows | list rows that open something |
| `codex/entry-detail.tsx` | the picture (opens the lightbox) | a picture, not an action button |
| `codex/gallery.tsx` | the tile's open button (`cx-thumb-open`), the "＋ Add images" drop zone (`cx-drop`) | the tile is a picture; the drop zone is a dashed drop target, not a button-shaped action |
| `codex/pin-picker.tsx` | the pins | map pins keep their look |
| `world/map-view.tsx` | tokens and the party token (`tok`) | map tokens |
| `world/world-board.tsx` | terrain brushes (`brush`) | each is the terrain's own paint colour, a swatch like the marker colours |
| `world/palette.tsx` | marker colour swatches (`role="radio"`) | swatches |
| `world/token-panel.tsx` | the "On the map" rows | list rows that open something |
| `world/travel-legend.tsx` | "▸ Travel speeds" (`w-legend-toggle`) | a section heading's disclosure, like the `<summary>` elements in the same panels (unchanged) |

## CSS

| File | Deleted | Added |
|---|---|---|
| `codex/codex.css` | `.cx-ghost` (+ `:hover`, `:disabled`), `.cx-tb` (+ `.on`, `:hover`) | `.cx-tools` wraps (`flex-wrap`); `.cx-tools .gb.gb-icon { width: 34px }` so a 150 px tile fits the three tools |
| `world/world.css` | `.pal` (+ `:hover`, `[aria-pressed]`), `.pal-edit` (+ `:hover`), `.zbtn` (+ `.zw`, `.zgold`, `[aria-pressed]`, `:disabled`, the touch rule), `.mseg` (+ `[aria-pressed]`, `:disabled`); their entries in the shared `:focus-visible` rule and the reduced-motion rule | an unlayered block (layout only): `.gb.pal` (full width, left aligned, grab cursor), `.gb.tip { overflow: visible }` and a `z-index` while hovered / focused |

Why the unlayered block: `world.css` is in `@layer components`, and `glass-button.css` is unlayered, so a layered rule
cannot reach a `.gb` (G0's cascade section). `.gb` clips with `overflow: hidden`, which would cut off the `.tip`
tooltip (`::after`, hung below the button); the fill (`::before`) is `inset: 0` with the button's radius, so it needs
no clip. `.tip`, `.brush`, `.tok`, `.w-legend-toggle`, `.cx-drop`, `.cx-thumb*` stay.

## Shots

`tests/e2e/visual/GLASS-G6.spec.ts` (`E2E_VISUAL=1`) writes to `test-results/visual/GLASS-G6/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g6/`:

- `codex-{gm,player}-{1440,1024,390}`: a character with a revealed image.
- `codex-gm-hover-confirm`, `codex-gm-focus-known`, `codex-gm-gallery-sure`, `codex-gm-hover-delete`,
  `codex-gm-lightbox`, `codex-gm-pin-picker`, `codex-player-lightbox-focus-close`.
- `world-{gm,player}-{1440,1024,390}`: a Witherwild map with a selected marker (GM).
- `world-gm-hover-send`, `world-gm-focus-zoom-tip` (the tooltip shows below the focused tool), `world-gm-paint`,
  `world-gm-measure` (+ `-1024`, `-390`), `world-gm-speeds-hover-save`, `world-player-focus-done`.
- `horizon-gm-{1440,1024,390}`, `horizon-gm-hover-generate`: the hex-crawl and regions panels.

The spec asserts the roles, the viewer colours (the GM's confirm has the Fear rim and the cancel the Hope rim; a
player's cancel the Fear rim), 44 px at ≤ 1100 px and axe with a hovered and a keyboard-focused button. The paint
toolbar's axe scan excludes `.brush`: the terrain brushes (white text on the terrain colour) fail colour contrast on
Road and Plains, which G6 does not change.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G6`: OK.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/brand`, `codex-view`, `world-*`, `horizon-travel`
  8 files, 80 passed; the full suite 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3873 / 3973, `E2E_REUSE_SERVERS=1`, `E2E_VISUAL=1`, `--workers=1`: codex (2),
  world (3), live-world (2), horizon (3), visual PD1 (1) and GLASS-G6 (3): 14 passed.

## Notes

- On the narrowest gallery tiles (about 150 px, e.g. a single image at 1440) the tools wrap onto two rows, so they
  cover the lower half of the tile; the tile still opens from its upper half (the spec clicks there).
- "Send party here" wraps onto two lines in the 260 px side column next to Delete (glass labels wrap, G0).
- The paint toolbar's "Done" wraps onto its own row at 1440 (the glass buttons are wider than the old 40 px ones).
