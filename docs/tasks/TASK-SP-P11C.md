# TASK-SP-P11C: Batch 2 sheets into the catalog - desert, coast-and-beach, ship-deck, sewers, ruins, mushroom-cavern, volcanic

Status: Done (catalog extras committed; overrides below are for P11Z to apply). Plan: `.omc/plans/sprite-packs.yaml`,
tracer P11C (depends on P10). Bead: dcm-bxp.56.

## What this tracer did

- Added each folder's batch-2 items (docs/sprite-packs/batch-2.md) as catalog extras (`extras` in `defineFolder`,
  TASK-SP-P4.md "Extra sheets") on `props-2`, `large-2` and `terrain-2`, in the doc's order. That is 29 items per
  folder, 203 in total (catalog 589 -> 792 keys once P11A/B add theirs too). Every new object has `standIn: false`, so
  the Classic mapping tables do not change.
- Cut all 21 sheets with `pnpm sprites:cut --setting <folder> --out <scratch>/p11c-out`. Every sheet gives its
  expected count (16 / 9 / 4) with 0 missing, 0 unassigned and fringe 0.000 after defringe. The order matched the
  doc on every sheet; I checked it on the contact sheets.
- Tried the override entries below on a local copy of `overrides.json` (reverted, not committed) and checked the
  re-cut sprites.

## Traits (the rules used)

- **Sizes:** props 1 x 1. Large items are 2 x 2, like the existing large items. These are bigger: buildings and
  landmarks 3 x 3, like the village cottages (boathouse, mushroom house, collapsed dome, chapel corner, mesa,
  colossus head, desert shrine, sea-stack arch, sleeping dragon, lava-lake island, ash-buried house, salt pans,
  sunken plaza, circle of mushroom folk, river bend, fungus bridge, ship's galley). Long ones are 3 x 2 (fishing boat,
  breakwater, meeting table, canal boat, amphitheatre seating). The sphinx is 2 x 3 (drawn portrait). The mermaid
  figurehead and gangplank are 1 x 2 (drawn upright, so no rotate is needed and the orientation check stays quiet).
  The mummy is 1 x 1 because it is one man-sized figure. Every non-square item has a rect footprint.
- **Light (D2):** only items that are drawn burning or glowing give light.
  - torch: small fire elemental, fire giant's throne (flaming braziers on its arms). Classic kind `torch`.
  - campfire: burning bush, giant brass brazier. Classic kind `campfire`.
  - faintglow (non-light Classic kind): beggar's cooking pot (embers), forgotten shrine (candles), glowing moth,
    glowing fern, glowing seed pods, crystal flower, glowing water lily, crystal throne, curtain of glowing vines,
    fire beetle, small lava stream, puddle of molten gold, smoking fissure, fire rune stone, magma fall, island in a
    lava lake, salamander nest, lava tube opening.
  - No light, because they are drawn cold or unlit: brass oil lamp, small galley stove, toppled brazier. The pearl
    and the construct's runes only shine in the drawing.
  - Textures give no light (as before).
- **Doors:** `ship-deck/brig-cell` and `sewers/sluice-gate` get Classic kind `door` and move `door`, with sight
  `cover`. They are bars and gates: they block while closed and stay see-through, like the sewers iron gate. That
  makes 8 door sprites.
- **Move:** the default comes from the traits (`defaultMove`). The explicit overrides are:
  - open: desert/sunken-tomb-entrance, ship-deck/hammock, ship-deck/gangplank, sewers/chalked-thieves-mark,
    sewers/rag-bedroll, sewers/open-drain-cover, ruins/mosaic-fragment, ruins/wildflowers-in-cracks,
    ruins/crumbling-bridge, ruins/sunken-plaza, mushroom-cavern/giant-fungus-bridge.
  - block: ship-deck/kraken-tentacles, sewers/forgotten-shrine, ruins/giant-stone-hand.
  - difficult: sewers/coins-in-the-muck, sewers/ooze-pool, mushroom-cavern/underground-river-bend,
    mushroom-cavern/curtain-of-glowing-vines (it blocks sight but can be pushed through),
    volcanic/puddle-of-molten-gold, volcanic/island-in-a-lava-lake.
  - Also difficult by default (Classic rubble / bush / log / bones): quicksand patch, lava stream, salt pans, sea
    urchins, slime, refuse heap, slag heap, and so on.
- **Terrain classes:** water: coral reef shallows, murky green water. deep: stormy sea water. swamp: tidal mudflat.
  These follow the movement defaults (difficult). Red-hot cracked ground is `stone`, because it is solid cracked
  rock and not molten. Say if it should be `lava` (difficult). Canvas sail laid flat is `wood` (a floor surface).

## Per sheet: verdict and override entries for `scripts/sprite-packs/overrides.json`

Cut indices are 0-based (the report's #n is index n-1).

| Sheet | Verdict | Notes |
|---|---|---|
| desert/props-2 | ok with overrides | pink fringe under the half-buried helmet (#9) and around the quicksand (#13) |
| desert/large-2 | ok with overrides | pink ring around the sandworm (#3). The colossus head (#8) has a soft pink rim round its sand: `unpink` alone leaves a rose edge, and `untint` over the whole cut greys it out (the stone face stays grey) |
| desert/terrain-2 | ok | tile 0.85 .. 1.00 after the seam fix |
| coast-and-beach/props-2 | ok | — |
| coast-and-beach/large-2 | ok with overrides | pink in the water halo of the fishing boat (#4) and the sea-stack arch (#9) |
| coast-and-beach/terrain-2 | ok | coral reef shallows repeat visibly in 3 x 3 but tile 1.00 |
| ship-deck/props-2 | ok | — |
| ship-deck/large-2 | ok with overrides | the grain heap's bottom edge (#8) fades into magenta |
| ship-deck/terrain-2 | ok | — |
| sewers/props-2 | ok | the caged rat trap's mesh keys through cleanly |
| sewers/large-2 | **regenerate** (ok with overrides as a fallback) | soft pink halos on 8 of 9 cells (`unpink` cleans them). The real problem: #5 sluice gate, #6 canal boat, #7 pair of brick pillars and #9 wererat den are drawn in a 3/4 or isometric view with walls behind them, not top-down. Also, #7 is two pillars with a gap: as one rect footprint it blocks the gap |
| sewers/terrain-2 | ok | cutter flag "uneven swatches (off-centre cross)" is harmless; grating shows its frame per tile (expected for a grate); brick 0.73, cobbles 0.74 |
| ruins/props-2 | ok with overrides | pink patch under the wildflowers (#16) |
| ruins/large-2 | ok (note) | #4 library shelves, #6 crumbling bridge, #7 chapel corner are isometric rather than top-down; readable, keep unless the user wants a redo. The dome's hole keys to transparent, which is correct |
| ruins/terrain-2 | ok (low tile accepted) | cracked marble 0.33, root-split paving 0.38, weathered terracotta 0.34: tile floors whose seam fix did not help (kept as drawn). They look like regular tiles in 3 x 3, the same case as the temple rune tiles accepted in P4 |
| mushroom-cavern/props-2 | ok with overrides | pink glow on the moth (#2), fern (#4), seed pods (#7), crystal flower (#9), water lily (#13): `unpink` leaves them white / green, checked; web strands on the web-wrapped body (#12): `unmix` |
| mushroom-cavern/large-2 | ok with overrides | pink glow around the crystal throne (#6), purple fringe under the vine curtain (#8). The river bend (#3) and fungus bridge (#4) are full-bleed and touch the border (kept, meant to join up) |
| mushroom-cavern/terrain-2 | ok | — |
| volcanic/props-2 | ok with overrides | pink smoke on the smouldering backpack (#9) and smoking fissure (#11) |
| volcanic/large-2 | ok with overrides | pink glow on the salamander nest (#6), pink ash smoke on the ash-buried house (#7), pink smoke above the giant brazier (#8). The magma fall (#3) is full-bleed and touches the border (kept) |
| volcanic/terrain-2 | ok | — |

Entries to add under `"sheets"` (tested together, cuts unchanged at 16 / 9 / 4):

```json
"desert/props-2": { "unpink": [8, 12], "note": "pink fringe under the half-buried helmet and around the quicksand" },
"desert/large-2": {
  "unpink": [2, 7],
  "untint": { "7": [[0, 0, 1, 1]] },
  "note": "pink ring round the sandworm; pink rim of the colossus head's sand (unpink leaves a rose edge, untint greys it)"
},
"coast-and-beach/large-2": { "unpink": [3, 8], "note": "pink in the water halo of the fishing boat and the sea-stack arch" },
"ship-deck/large-2": { "unpink": [7], "note": "grain heap's bottom edge fades into magenta" },
"sewers/large-2": { "unpink": [0, 1, 3, 4, 5, 6, 7, 8], "note": "soft pink halos round the waterfall, ooze pool, shrine candles, gate, boat, pillars, refuse heap and den" },
"ruins/props-2": { "unpink": [15], "note": "pink patch under the wildflowers" },
"mushroom-cavern/props-2": {
  "unpink": [1, 3, 6, 8, 12],
  "unmix": [11],
  "note": "pink glow on the moth, fern, seed pods, crystal flower and water lily; web strands on the web-wrapped body"
},
"mushroom-cavern/large-2": { "unpink": [5, 7], "note": "pink glow round the crystal throne; purple fringe under the vine curtain" },
"volcanic/props-2": { "unpink": [8, 10], "note": "pink smoke on the smouldering backpack and smoking fissure" },
"volcanic/large-2": { "unpink": [5, 6, 7], "note": "pink glow on the salamander nest; pink smoke on the ash-buried house and the brazier" }
```

No `rotate` is needed. The orientation check raised no flag, because the 1 x 2 items are drawn upright.

### Suggested prompt fix for sewers/large-2

Keep the list. Before the style block, add: "Draw every object strictly from directly above, as a floor plan: no
walls standing behind it, no front faces, no 3/4 or isometric view. The sluice gate is a wooden gate across a
channel seen from above; the canal boat is a boat seen from above on no water; the brick pillars are two separate
square pillar tops; the wererat den is a nest of rags and bones on the floor. Hard clean edges against the magenta:
no soft glow, mist or halo." For the trait problem, the user could also split "pair of brick pillars" into a single
pillar, which P11Z can rename in the catalog.

## Tests (P11Z's, not changed here)

`tests/unit/sprite-catalog.test.ts` and `tests/unit/sprite-builtin-pack.test.ts` fail only on pins that P11Z owns:

- the prompts-doc extra-sheet lists: prompts.md needs `- props-2 / large-2 / terrain-2` lines for these folders, from
  batch-2.md;
- the key count (`20 * 29 + 9` -> 792 with all of batch 2);
- the exact Q1 light lists (add the lights above);
- the move-override list (add the overrides above);
- "exactly six door sprites" (now eight: + ship-deck/brig-cell, sewers/sluice-gate);
- the village test that expects the only extra sheet to be the town's;
- the pack tests that need files for the new keys (they come after P11Z's build).

The D2 light-kind rule, the size rule, unique keys and the sight/light stand-in rule all pass.

## Acceptance evidence

- `pnpm typecheck` and `pnpm lint` are clean.
- `pnpm tracer:guard .omc/plans/sprite-packs.yaml P11C` passes.
- Review output (scratch, not committed): `p11c-out/contact-<folder>.png`, `p11c-out2/` (with the overrides),
  `p11c-out3/` (the colossus untint).
