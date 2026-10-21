# TASK-SP-P11A: Batch 2 sheets into the catalog (common, forest, grassland-and-road, mountain-and-cliffs, cave, dungeon, crypt-and-graveyard)

Status: Done (catalog extras + review). Plan: `.omc/plans/sprite-packs.yaml`, tracer P11A (depends on P10). P11Z applies
the overrides below, rebuilds the pack and updates the tests and the prompts doc.

## What changed

Each folder's catalog file (`src/lib/sprite-packs/catalog/<folder>.ts`) gains `extras` for `props-2` (16), `large-2` (9)
and `terrain-2` (4), named exactly as `docs/sprite-packs/batch-2.md` writes them, in its order: 29 new items per
folder, 203 in all (catalog 589 -> 792). Every new object is `standIn: false` (the mapping tables do not use it for
Classic objects; it is placed by sprite ref). No trait kind was invented.

- **Sizes.** Props 1 x 1. Large items 2 x 2 unless named here: 3 x 3 for whole buildings and big layouts like the
  village cottages (grassland windmill, granary, horse stable, sheep pen, vineyard rows; forest elven tree-house, druid
  stone circle; cave goblin camp; crypt small mausoleum, gravedigger's hut); 3 x 2 for wide layouts (grassland duck
  pond, stone arch bridge, ploughed field strip; mountain pass gate; dungeon row of three prison cells); 3 x 1 for the
  common palisade and the crypt row of headstones; 2 x 1 (`long`) for the common saddled horse, ox, spiked barricade and
  the crypt embalming table. Every non-square item has a rect footprint.
- **Light (D2 / Q1).** Only real light sources. torch: mountain-and-cliffs/dwarven-lantern (Classic `torch`). campfire
  (Classic `campfire`, burning fire drawn): common/cooking-pot-on-a-tripod, common/campsite-with-two-bedrolls,
  forest/druid-stone-circle, cave/goblin-camp, dungeon/cauldron-of-gruel. faintglow (Classic kind not a light kind):
  common/oil-lamp, common/glowing-magic-circle-on-the-ground, cave/glowworm-cluster, cave/miners-helmet-with-a-candle,
  dungeon/glowing-glyph-trap, crypt-and-graveyard/ghostly-blue-candle, crypt-and-graveyard/necromancers-altar (lit
  candles, like dungeon/altar-with-candles). Not lit: the portal arch, the rune stone, the broken lantern, ghost, wraith.
- **Doors (M2).** `move: "door"`, Classic kind `door`, sight block / tall, rect (the closed wooden door's traits; an
  open door's `open` flag clears sight and movement): dungeon/wooden-door-open, dungeon/round-vault-door,
  cave/dwarven-door-in-the-rock, mountain-and-cliffs/dwarven-mountain-pass-gate.
- **Movement.** Default from the traits (D1) except these explicit `move`s (water and puddles difficult, flat dropped
  items and stairs open, fences / heaps / cells block):

```ts
    "common/round-wooden-shield": "open",
    "common/dropped-longsword": "open",
    "common/open-spellbook": "open",
    "common/rolled-up-carpet": "open",
    "common/supply-dump-of-crates-sacks-and-barrels": "block",
    "common/wooden-barricade-with-spikes": "block",
    "common/dragons-hoard-heap-of-gold-coins": "difficult",
    "forest/pile-of-pinecones": "open",
    "forest/shed-deer-antlers": "open",
    "forest/stepping-stones-in-a-stream": "difficult",
    "forest/forest-spring": "difficult",
    "forest/forest-stream-bend": "difficult",
    "forest/archway-of-living-branches": "open",
    "forest/woodcutters-log-pile": "block",
    "grassland-and-road/sheaf-of-wheat": "open",
    "grassland-and-road/pitchfork-and-rake": "open",
    "grassland-and-road/duck-pond": "difficult",
    "grassland-and-road/sheep-pen": "block",
    "grassland-and-road/stone-arch-bridge-over-a-brook": "open",
    "mountain-and-cliffs/small-waterfall-pool": "difficult",
    "mountain-and-cliffs/dwarven-mountain-pass-gate": "door",
    "mountain-and-cliffs/hot-spring-pool": "difficult",
    "mountain-and-cliffs/wooden-scaffold-walkway": "open",
    "cave/pick-and-shovel": "open",
    "cave/rope-ladder-going-down": "open",
    "cave/mine-cart-track-junction": "open",
    "cave/dwarven-door-in-the-rock": "door",
    "dungeon/key-ring-on-a-hook": "open",
    "dungeon/straw-pile": "open",
    "dungeon/poison-dart-trap": "open",
    "dungeon/glowing-glyph-trap": "open",
    "dungeon/wooden-door-open": "door",
    "dungeon/wall-manacles": "open",
    "dungeon/dripping-slime-puddle": "difficult",
    "dungeon/round-vault-door": "door",
    "dungeon/row-of-three-prison-cells": "block",
    "dungeon/spiral-staircase": "open",
    "crypt-and-graveyard/skeleton-rising-from-the-ground": "open",
    "crypt-and-graveyard/gravediggers-shovel-and-pick": "open",
    "crypt-and-graveyard/memorial-wreath": "open",
    "crypt-and-graveyard/iron-grave-cage": "block",
    "crypt-and-graveyard/crypt-staircase-going-down": "open",
```

- **Textures** take their terrain class's movement. Classes: common gravel path, dry yellow grass grass, pebbled ground
  and trampled mud dirt; forest pine needles, fern undergrowth, red autumn leaves grass, forest stream pebbles water;
  grassland ploughed soil dirt, clover and flower meadow grass, cart-rutted road path; mountain slate ledge and rock with
  snow patches stone, mountain moss and frosty grass grass; cave all four cave; dungeon all four stone; crypt bone-strewn
  floor stone, overgrown graveyard path path, ash and dust dirt, dead grass grass. Not rotatable (directional):
  ploughed soil, cart-rutted road, slate ledge, wet flagstones, iron grating floor, overgrown graveyard path.

## Review of the 21 sheets

Cut with `pnpm sprites:cut --setting <the 7 folders> --out <scratch>/p11a-out`. Every sheet gives its expected count
(16 / 9 / 4), 0 missing, 0 unassigned; fringe after defringe 0.000 on every object sheet. The overrides below were tried
in a throw-away run (overrides.json restored from git right after, not committed); each one is checked against the cut
without it.

| Sheet | Verdict | Notes |
|---|---|---|
| common/props-2 | ok with overrides | #11 oil lamp: glass chimney tinted pink (glass over magenta); `unmix` makes it clear glass |
| common/large-2 | ok with overrides | #2 ox drawn upright (flagged) -> `rotate` 90 (head to the left); #6 magic circle's white glow came out solid violet -> `unmix` gives a white glow with soft alpha |
| common/terrain-2 | ok | tile 0.92 .. 1.00 after the seam fix |
| forest/props-2 | ok with overrides | components fallback; purple fringe on #13 stepping stones and #14 forest spring -> `unpink` |
| forest/large-2 | ok with overrides | components fallback; #6 sapling thicket lost most of its thin leaves -> `unmix` keeps them (a faint grey ground haze stays) |
| forest/terrain-2 | ok | 25 px magenta outer frame: "magenta left in swatch" flags, but the final swatches show no pink (checked per row and column); tile 0.90 .. 1.00 |
| grassland-and-road/props-2 | ok | components fallback |
| grassland-and-road/large-2 | ok | ploughed field strip and ox-drawn plough are drawn diagonally (kept) |
| grassland-and-road/terrain-2 | regenerate (or cutter fix) | 78 px magenta outer frame. `cutTerrain` finds no frame (`frameDepth` returns 0 when the outermost line is all magenta), so every swatch keeps a magenta strip that the seam fix moves inside: clear pink lines across every tile in the 3 x 3 previews. No override reaches terrain swatches. Fix either way: P11Z teaches `frameDepth` to skip leading all-magenta lines, or regenerate with the prompt fix below |
| mountain-and-cliffs/props-2 | ok with overrides | #14 dwarven lantern: big pink glow -> `unpink` |
| mountain-and-cliffs/large-2 | ok with overrides | #6 hot spring pool pink steam, #8 statue head pink rim -> `unpink` |
| mountain-and-cliffs/terrain-2 | ok as is; better after the cutter fix | 44 px magenta outer frame: faint pink line near one edge of each swatch (mean magenta lean +8 over the swatch, grassland +40), visible only zoomed in |
| cave/props-2 | ok with overrides | #12 miner's helmet: pink candle glow -> `unpink` (a faint ring outline stays) |
| cave/large-2 | regenerate recommended | the sheet has a text label under every item (against the style block); bands cut them away cleanly, so the cut is usable now with `unpink` #1 (pink rim on the goblin camp). But #8 giant stalactite cluster and #5 underground waterfall are side views (a hanging fringe and a cliff face) and #7 cave troll sits in a drawn pit |
| cave/terrain-2 | ok | tile 1.00 |
| dungeon/props-2 | ok | — |
| dungeon/large-2 | ok | #1 gelatinous cube is clean without `unmix` (tried: no visible gain) |
| dungeon/terrain-2 | ok | wet flagstones 0.31 -> 0.52, bloodstained stone 0.59: the stains repeat visibly in the 3 x 3, accepted |
| crypt-and-graveyard/props-2 | ok with overrides | components fallback; #3 ghost tinted pink (semi-transparent) -> `unmix` makes it white; #13 ghostly blue candle purple aura -> `unpink` leaves the blue flame glow |
| crypt-and-graveyard/large-2 | ok | components fallback |
| crypt-and-graveyard/terrain-2 | ok | tile 0.94 .. 1.00 |

### Override entries for scripts/sprite-packs/overrides.json (P11Z)

Cut indices are 0-based (the report's #n is index n-1).

```json
"common/props-2": { "unmix": [10], "note": "oil lamp glass chimney tinted pink by the magenta behind it" },
"common/large-2": { "rotate": { "1": 90 }, "unmix": [5], "note": "ox drawn upright, the catalog sizes it 2 x 1; magic circle glow came out solid violet" },
"forest/props-2": { "unpink": [12, 13], "note": "purple fringe on the stepping stones and the forest spring" },
"forest/large-2": { "unmix": [5], "note": "sapling thicket's thin leaves" },
"mountain-and-cliffs/props-2": { "unpink": [13], "note": "pink glow around the dwarven lantern" },
"mountain-and-cliffs/large-2": { "unpink": [5, 7], "note": "pink steam on the hot spring pool; pink rim on the dwarven statue head" },
"cave/props-2": { "unpink": [11], "note": "pink glow around the miner's candle" },
"cave/large-2": { "when": { "found": 9 }, "unpink": [0], "note": "pink rim on the goblin camp (current sheet, which has text labels)" },
"crypt-and-graveyard/props-2": { "unmix": [2], "unpink": [12], "note": "ghost tinted pink; purple aura around the ghostly blue candle" }
```

### Sheets to regenerate, with prompt fixes

- **grassland-and-road/terrain-2** (unless P11Z fixes `frameDepth` for magenta frames, which also cleans up
  mountain-and-cliffs/terrain-2 and forest/terrain-2): add to the terrain prompt "The four swatches fill the image
  edge to edge: no outer border or frame of any colour; only a thin straight magenta cross separates them."
- **cave/large-2:** add "No text anywhere: no labels, captions or names under the objects. Every object strictly
  top-down (seen from directly above), never a side view: the giant stalactite cluster as a ring of stone cone tips
  around a dark centre seen from above, the underground waterfall as a pool with a foaming fall at one rock edge seen
  from above, the cave troll standing on plain ground without a pit around it."

## Tests (tests/unit/sprite-catalog.test.ts and sprite-builtin-pack.test.ts, P11Z's)

Not changed here. With the new items 17 tests fail until P11Z updates them and rebuilds the pack:

- the doc's extra-sheet lists: `docs/sprite-packs/prompts.md` needs `- props-2:`, `- large-2:`, `- terrain-2:` lines for
  the 7 folders (from batch-2.md; 7 failures) and the "one extra sheet today is the village sheet" test;
- key count 589 -> 792 ("keys are unique");
- the Q1 light lists (add the 13 keys under "Light" above);
- the movement OVERRIDES map (add the block above) and the door list (add the 4 doors; the Classic `door` list becomes 10);
- texture mapping: `textureCandidates("grass", "forest")` now lists 6 (the 3 new forest grass textures join),
  `pickTexture` blocks 3 -> 6, `folderEntries` 29 -> 58 per folder. Note for P11Z: extra-sheet textures join the
  Classic -> Sprites terrain mapping (textures have no `standIn`), e.g. forest stream pebbles becomes the only forest
  `water` texture and the forest pine needles / fern / autumn leaves mix into forest grass;
- sprite-builtin-pack: every catalog item has a file, and the 589 count (both clear after the rebuild).

## Acceptance evidence

- `pnpm typecheck` clean; `pnpm exec eslint src/lib/sprite-packs/catalog` clean.
- `pnpm tracer:guard .omc/plans/sprite-packs.yaml P11A` passes.
- Review output (scratch, not committed): contact sheets `contact-<folder>.png`, `report.html`, `summary.txt`, PNG
  candidates and 3 x 3 terrain previews in the P11A scratch out dir.
