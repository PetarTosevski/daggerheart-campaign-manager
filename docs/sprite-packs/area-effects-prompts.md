# Area-effect sheet prompts (for Gemini / Nano Banana)

For the map overlay that draws effect areas (dcm-lqnt, art bead dcm-7mwl, list in `.omc/plans/aoe-sprites.md`).
Same pipeline as the sprite packs (`docs/sprite-packs/prompts.md`): one prompt per **sheet**, magenta background,
the cutter splits the sheet.

Image models can't make real transparency, so:
- **Fills** (fog, darkness, auras ...) are opaque, seamless swatches like terrain. The overlay draws them
  see-through, clipped to the area's circle.
- **Circle decals** (rune circles, barriers) and **walls** are objects on flat magenta, cut out like props.

## How to run them

- Best model available (Nano Banana Pro), largest square size (2048 x 2048 or more).
- One prompt per sheet. Regenerate until every cell is filled, nothing overlaps, and the background or gaps are
  flat magenta.
- Save as `C:\Users\Petar\sprite-sheets\area-effects\<sheet>.png` with the sheet names below
  (`fills-1.png` ... `fills-4.png`, `decals.png`, `walls.png`). Raw sheets are never committed.
- After saving, tell Claude: the cutter and build step for `area-effects` are part of the overlay tracer.

## Fill sheets (4 sheets x 4 swatches)

Template (replace the four lines at the end):

```
A sheet of 4 square magical-effect textures for a top-down fantasy battle map, arranged in a 2 × 2 grid with a
thin solid magenta (#FF00FF) gap between the squares. Each square is filled edge to edge with one magical effect
seen from straight above, as if it covers the ground: no objects, no creatures, no ground showing through, no
border, no vignette, no bright centre. Even density across the whole square. Each texture must tile seamlessly:
its left edge continues into its right edge and its top edge into its bottom edge. Mid-tone values with clear
swirls, wisps or patterns so it reads well when drawn semi-transparent over a map. Hand-painted generic fantasy
tabletop style, soft painterly detail, light from the top-left. No text, no letters, no grid, no frames.
Top left: <a>. Top right: <b>. Bottom left: <c>. Bottom right: <d>.
Square image.
```

`fills-1` (darkness and concealment)
- Top left: **darkness**: thick black and deep violet magical smoke, heavy and opaque, faint purple swirls.
- Top right: **fog**: dense pale grey drifting fog with soft white wisps.
- Bottom left: **smoke**: rolling charcoal-grey smoke shroud with darker billows.
- Bottom right: **shadow**: inky blue-black living shadow with thin tendril-like streaks.

`fills-2` (hazards)
- Top left: **ink**: dark blue-black ink cloud spreading in water, with curling plumes.
- Top right: **acid**: bubbling toxic green acid pool with yellow-green foam and bubbles.
- Bottom left: **brambles**: dense tangle of thorny dark-green vines and brown thorns covering the ground.
- Bottom right: **generic**: neutral soft blue-grey magical haze with faint shimmering particles.

`fills-3` (elemental auras)
- Top left: **aura-fire**: glowing embers and orange-red heat haze with small flame licks.
- Top right: **aura-earth**: swirling dust, sand grains and small floating pebbles in brown and ochre.
- Bottom left: **aura-water**: swirling sea-green mist with water droplets and ripples.
- Bottom right: **aura-air**: pale swirling wind currents with white streaks and leaves.

`fills-4` (storms and zones)
- Top left: **storm-hurricane**: violent grey-green wind with diagonal streaks all blowing the same direction (left to right).
- Top right: **storm-blizzard**: driving snow and ice crystals in white and pale blue.
- Bottom left: **storm-sandstorm**: thick blowing sand in tan and orange, streaks blowing left to right.
- Bottom right: **suppressing-fire**: many arrows and crossbow bolts streaking across the ground, motion lines, scattered spent bolts.

## Circle decals (1 sheet, 3 x 3)

```
A sheet of 9 round magical circles for a top-down fantasy battle map, arranged in an even 3 × 3 grid, one per
cell, read left to right, top to bottom. Each is a perfectly round effect seen from straight above, filling about
80% of its cell, centred, with a wide margin of empty magenta around it. Perfectly flat, solid magenta
background (#FF00FF): no ground, no grass, no texture, no gradient, no vignette, no cast shadow. Each circle is
see-through in the middle (thin patterns, glow lines, not a solid disc) so tokens stay visible on top of it.
Hand-painted generic fantasy tabletop style, clean lines, soft glow, light from the top-left. No text, no letters,
no numbers, no grid lines, no frames. Nothing touches or overlaps a neighbouring cell.
1. rune-circle: a ring of glowing blue arcane runes on the ground.
2. radiant-circle: a golden holy circle with sun rays and a thin ring of light.
3. moonlight: a pool of cool silver-blue moonlight with a crescent motif at its edge.
4. healing-barrier: a translucent green-gold dome edge seen from above, a ring of leaves and light.
5. silence: a muted grey bubble ring with faint ripples, like sound being swallowed.
6. fortress: a woven ring of living wood and roots forming a round wall seen from above.
7. ritual-dark: a dark red and black ritual circle with jagged sigils.
8. frost-glyph: an icy white-blue glyph circle with frost crystals.
9. shadow-pool: a soft-edged ring of creeping black shadow with a clear centre.
Square image.
```

## Walls (1 sheet, 4 strips)

```
A sheet of 4 long straight wall effects for a top-down fantasy battle map, stacked in 4 horizontal rows, one per
row, each a long thin strip seen from straight above running left to right across almost the full width of the
image, about one-sixth of the image height thick, with a wide band of empty magenta between rows. Perfectly flat,
solid magenta background (#FF00FF): no ground, no texture, no gradient, no cast shadow. The left and right ends
of each strip are cut straight so the strip can be repeated end to end seamlessly. Hand-painted generic fantasy
tabletop style, soft glow, light from the top-left. No text, no letters, no grid lines, no frames.
Row 1, fire-wall: a wall of roaring orange and yellow flames.
Row 2, force-wall: a translucent shimmering blue force barrier with hexagonal light patterns.
Row 3, hunger-wall: a wall of dark grasping maws, teeth and black tendrils.
Row 4, shadow-line: a thin wall of living black shadow with violet edges.
Square image.
```

## Which effect uses which art

See the table in `.omc/plans/aoe-sprites.md`. Dark Cloud uses `darkness`, Mysterious Mist uses `fog`, Wall of
Flame uses `fire-wall`, Circle of Power uses `radiant-circle`, Hush uses `silence`, and so on. `smoke`, `shadow`,
`shadow-line` and `shadow-pool` cover rogue effects and future shadow or smoke areas. Anything without its own art
falls back to `generic`.
