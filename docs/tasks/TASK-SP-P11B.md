# TASK-SP-P11B: Batch 2 sheets into the catalog - castle-interior, tavern, town-street-and-market, temple, swamp, snow-and-tundra

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P11B (depends on P10). P11A and P11C do the other
folders; P11Z writes the overrides below into `scripts/sprite-packs/overrides.json`, adds the prompts-doc lines and
builds the pack.

## What was done

Every batch-2 item of the six folders (docs/sprite-packs/batch-2.md) is a catalog extra (`extras` in `defineFolder`,
TASK-SP-P4.md) in the doc's reading order: 174 new items, 29 per folder (props-2 16, large-2 / large-3 9,
terrain-2 4). The catalog grows from 589 to 763 keys before P11A and P11C.

| Folder | props-2 | large | terrain-2 | Extra sheet ids |
|---|---|---|---|---|
| castle-interior | 16 | 9 | 4 | props-2, large-2, terrain-2 |
| tavern | 16 | 9 | 4 | props-2, large-2, terrain-2 |
| town-street-and-market | 16 | 9 | 4 | props-2, **large-3**, terrain-2 (large-2 is the P4V village) |
| temple | 16 | 9 | 4 | props-2, large-2, terrain-2 |
| swamp | 16 | 9 | 4 | props-2, large-2, terrain-2 |
| snow-and-tundra | 16 | 9 | 4 | props-2, large-2, terrain-2 |

### Trait rules applied

- **standIn: false on every new item**, as for the village (P4V): the mapping tables keep their candidates, so the
  Classic stand-in lists and the tests that pin them do not change.
- **Sizes:** props 1 x 1 (the catalog test requires it). Large items 2 x 2 by default, `long` 2 x 1 where drawn long
  (war table, gambling table, guest bathtub, fireside armchairs, back-bar shelves, flat-bottomed punt). Buildings
  against the village's 3 x 3 cottages: townhouse, shop, witch's hut 3 x 3; town gate 4 x 3; clock tower 2 x 4
  (drawn upright); covered market hall 4 x 4; stable block 4 x 3; longhouse 4 x 3. Yards and scenes: tannery vats,
  canal with a footbridge, cloister garden, temple entrance steps, frozen ship's bow, ice bridge, glacier crevasse
  3 x 3; colonnade 3 x 2; dog sled team 3 x 1. Every non-square one is rect.
- **Light (D2: real light sources only):** campfire: kitchen hearth with a roasting spit (Classic `campfire`). Torch:
  eternal flame bowl, skull lantern on a stick, skull shrine (its brazier fire) (Classic `torch`). Faint glow: reading
  chair with a candle (Classic `table`), votive candle rack (Classic `crystal`). Not lights: the frozen lantern (frozen,
  out), frost crystal, crystal orb, oracle's smoking tripod (smoke, no flame), pot of stew, the witch's hut's small
  cauldron fire (part of a building), bubbling tar pit.
- **Doors (M0/M2):** gatehouse portcullis (2 x 2 rect) and town gate with two towers (4 x 3 rect): Classic `door`,
  move `door`, sight `cover` (bars, like the portcullis section). Note: the town gate's whole 4 x 3 rectangle is the
  door, so its towers block only while it is closed and sight never blocks; a GM who wants solid towers can paint
  sight blockers on them. The cellar trapdoor with stairs stays open (like the dungeon trapdoor, a floor hatch).
- **Move overrides** (all others take the D1 default):
  - block: guardian lion statue, great brass bell, colonnade, ice sculpture (solid like the suit of armour), inn stable
    stall with a horse (walled like the fenced coop).
  - difficult: lotus pond (like the sacred pool), ice-fishing hole with a rod (like the frozen lake hole), small frozen
    pond (like the ice patch), canal with a footbridge (water; the bridge is not modelled).
  - open: potted fern, topiary bush, swamp orchid (single potted / small plants of Classic kind `bush`), hearth rug,
    meditation cushion, beggar's bowl and mat, street drain, fishing pole in the mud, dead fish, pair of snowshoes,
    wooden skis, dropped fur cloak, boardwalk junction, ice bridge, cloister garden, raked sand garden, temple entrance
    steps.
  - Rubble / water defaults kept: broken chair, sunken stone arch, bubbling tar pit, glacier crevasse (difficult);
    textures by terrain class (duckweed water, canal water, blue glacier ice = water; peat bog, wet reed bed,
    algae-green mud = swamp; wind-swept snow, slush = snow: all difficult).

## Cutting and review

`pnpm sprites:cut --setting <the six> --out <scratch>/p11b-out`: every sheet gives its count (16 / 9 / 4), 0 missing,
0 unassigned, fringe after defringe 0.000 on every object sheet. Contact sheets and 3 x 3 terrain previews reviewed;
a second run with the overrides below (applied to a scratch copy of overrides.json, then reverted) confirmed each fix:
pink-leaning pixels 1717 -> 0 (kitchen hearth), 151 magenta -> 0 (reading chair), 628 -> 0 (eternal flame bowl),
596 -> 0 (oracle's tripod); the town large-3 order fixes the labels; the market hall entrance haze turns grey.

### Per sheet: verdict and override entries for P11Z

Cut indices are 0-based (the report's #n is index n-1).

| Sheet | Verdict | Reason |
|---|---|---|
| castle-interior/props-2 | ok with overrides | pink glow around the reading chair's candle (#16) |
| castle-interior/large-2 | ok with overrides | pink glow under the kitchen hearth (#2); multi-part items (tub + screen, two statues, three strongboxes) merge into one cut each |
| castle-interior/terrain-2 | ok | rush-strewn flagstones 0.48, battlement stone 0.38 (seam fix shows faint doubled stones along the blend; acceptable like the temple rune tiles) |
| tavern/props-2 | ok | the stew steam's pink keys out |
| tavern/large-2 | ok | soft purple drop shadows key out (as on the village sheet) |
| tavern/terrain-2 | ok | 0.50 .. 1.00 after the fix |
| town-street-and-market/props-2 | ok | components fallback, 16/16 in order |
| town-street-and-market/large-3 | ok with overrides, **canal: regenerate** | row 3 is drawn tannery, canal, gallows (doc: tannery, gallows, canal) -> `order`; covered market hall (#5) and stable block (#6) have a pink haze at the entrance -> `untint`; the canal (#8) has soft pink-green banks: `unpink` fades them but a rose-grey haze stays |
| town-street-and-market/terrain-2 | ok (flagged) | "magenta left in swatch #1..#4": the sheet has a magenta outer frame the frame finder does not strip (it only finds non-magenta frames), so each swatch carries a magenta strip on its outer sides; the seam fix blends it away (0 magenta pixels left, tile 0.01-0.05 -> 0.96-1.00) but leaves a soft band in each tile (mossy cobblestones, dirt alley). Either regenerate without the outer frame or let P11Z teach `frameDepth` a uniform magenta frame |
| temple/props-2 | ok with overrides | pink glow on the votive candles (#5) and the eternal flame (#7); the crystal orb (#14) is purple-white, leave it |
| temple/large-2 | ok with overrides | pink smoke on the oracle's tripod (#7); the four choir stalls merge into one cut |
| temple/terrain-2 | ok | sandstone temple floor 0.33 (ghosting along the seam blend, like polished wood); the purple prayer carpet is one bordered rug that tiles as repeated rugs (like the red carpet) |
| swamp/props-2 | ok | thin grid lines removed; the skull lantern's glow keys out; crayfish trap mesh keyed cleanly |
| swamp/large-2 | ok | water haze around the boardwalk junction and sunken arch keys to a dark rim; tar-pit steam fine |
| swamp/terrain-2 | ok | 0.93 .. 1.00 after the fix |
| snow-and-tundra/props-2 | ok with overrides | snowshoe netting: `unmix` keeps the lacing strands |
| snow-and-tundra/large-2 | ok (consider regenerating #6-#8) | frozen ship's bow, ice bridge and glacier crevasse are drawn as full square tiles (hard square edges) rather than isolated objects; they cut correctly and sit fine as 3 x 3 floor pieces |
| snow-and-tundra/terrain-2 | ok | 0.88 .. 1.00 after the fix |

Override entries (add under `sheets` in `scripts/sprite-packs/overrides.json`):

```json
"castle-interior/props-2": { "unpink": [15], "note": "pink glow around the reading chair's candle" },
"castle-interior/large-2": { "unpink": [1], "note": "pink glow under the kitchen hearth" },
"town-street-and-market/large-3": {
  "order": [0, 1, 2, 3, 4, 5, 6, 8, 7],
  "unpink": [7],
  "untint": { "4": [[0.33, 0.86, 0.67, 1]], "5": [[0.38, 0.85, 0.62, 1]] },
  "note": "row 3 drawn tannery, canal, gallows (catalog: gallows before canal); pink haze at the market hall and stable entrances; pink banks on the canal (cut #8)"
},
"temple/props-2": { "unpink": [4, 6], "note": "pink glow on the votive candles and the eternal flame" },
"temple/large-2": { "unpink": [6], "note": "pink smoke on the oracle's tripod" },
"snow-and-tundra/props-2": { "unmix": [5], "note": "snowshoe netting strands" }
```

(`order` takes original cut indices; `unpink` / `untint` index the cuts before ordering, so #7 is the canal.)

### Regenerate

1. **town-street-and-market/large-3, canal with a footbridge (cut #8):** the banks fade from green into magenta, so a
   rose haze remains after `unpink`. Prompt fix: "canal with a footbridge: a straight stone-lined canal crossed by an
   arched stone footbridge; the canal's stone walls end in a crisp outline on the flat magenta; no grass, no ground
   and no soft fade beside the canal." Until then the override above gives a usable sprite.
2. Optional: **town-street-and-market/terrain-2** without the outer magenta frame ("the four swatches fill the image
   edge to edge; only the thin magenta cross between them"), or a cutter fix (see the table).
3. Optional: **snow-and-tundra/large-2** frozen ship's bow, ice bridge, glacier crevasse as isolated objects on
   magenta ("drawn as an object with its own outline, not a square tile").

## For P11Z: tests that fail on these items (`tests/unit/sprite-catalog.test.ts`, `sprite-builtin-pack.test.ts`)

- "extra-sheet items match the doc's extra-sheet lists" for the six folders: the prompts doc needs `- props-2:`,
  `- large-2:` (`- large-3:` for the town) and `- terrain-2:` lines with these names (batch-2.md's lists verbatim).
- "the one extra sheet today is the village sheet": now 9 + 174 (+ P11A / P11C) extra items.
- "keys are unique and match <folder>/<slug>": count 589 -> 763 (+ P11A / P11C).
- "gives torch, campfire and faint-glow light exactly to the Q1 lists": add torch `temple/eternal-flame-bowl`,
  `swamp/skull-lantern-on-a-stick`, `swamp/skull-shrine`; campfire `castle-interior/kitchen-hearth-with-a-roasting-spit`;
  faint glow `castle-interior/reading-chair-with-a-candle`, `temple/votive-candle-rack`.
- "every object has a move ... unless overridden": add the move overrides listed above (first failure:
  `castle-interior/potted-fern` open).
- "the six door sprites map to Classic `door`": add `castle-interior/gatehouse-portcullis` and
  `town-street-and-market/town-gate-with-two-towers` (now eight).
- `sprite-builtin-pack.test.ts` "has a file for every catalog item" and "holds 589 sprites": pass once the pack is
  rebuilt.
