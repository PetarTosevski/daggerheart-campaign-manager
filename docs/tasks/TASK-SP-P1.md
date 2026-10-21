# TASK-SP-P1: Pure catalog (settings, per-item traits, mapping tables, keyword setting picker, sprite traits)

Plan: `.omc/plans/sprite-packs.yaml`, tracer P1 (wave 1, no dependencies). Bead: dcm-bxp.56.

## Decisions implemented

- **P1** (user, binding): "The Scene card gets a Setting picker (forest, tavern, dungeon, ... from the packs), defaulting to
  'Let Claude choose'". This tracer supplies the settings (`SETTINGS`) and the keyword picker (`pickSetting`) for it.
- **Q1 = (b)** (user, binding): torch-like kinds give torch light [6, 12], campfire-like kinds give campfire light [12, 24],
  things that only glow give the new **faint glow** light (clear 1, dim 3; `FAINT_GLOW_REACH`, owned by P3 in
  `src/lib/domain/combat-map/light.ts`); everything else gives none. Light names: `"none" | "faintglow" | "torch" | "campfire"`
  (spelling agreed with the orchestrator for P0 and P3).
- D1-D8 as written in the plan. The rules each value follows are below; every assignment is in the tables so you can review it.

## Module (`src/lib/sprite-packs/`, framework-free, relative imports)

| File | What it holds |
|---|---|
| `settings.ts` | `SETTING_IDS` (19), `SETTINGS` ({id, label}), `SETTING_LABEL`, `COMMON_FOLDER`, `DEFAULT_SETTING` (grassland-and-road), `isSettingId` |
| `catalog/types.ts` | entry types (`ObjectEntry`, `TextureEntry`), `SPRITE_LIGHTS`, `SPRITE_HEIGHTS`, `SPRITE_FOOTPRINTS`, `TEXTURE_SQUARES` (4), size bounds, `slugify`, the `obj` / `long` / `tex` / `defineFolder` builders |
| `catalog/<folder>.ts` (20) | one folder each: props (16), large (9), terrain (4) in the prompts doc's grid order |
| `catalog/index.ts` | `CATALOG` (folder -> sheets), `CATALOG_ENTRIES`, `catalogEntry(key)`, `folderEntries`, `folderOfKey` |
| `mapping.ts` | `spriteCandidates`, `textureCandidates`, `pickSprite(kind, variant, setting, objectId, seed)`, `pickTexture(terrain, setting, x, y, seed)`, `classicLight(kind)` |
| `pick-setting.ts` | `SETTING_KEYWORDS`, `scoreSettings`, `pickSetting(description, name?)` |
| `manifest.ts` | zod `builtinManifestSchema` (schemaVersion 1; `folders: {<folder>: [{key, file, px, variants, seam?}]}`), `EMPTY_MANIFEST`, `createSpriteLookup(manifest)` -> `{get(key) -> {entry, art} | null, unknownKeys}` |
| `traits.ts` | `SpriteRef`, `SpriteTraits` {sight, light, height, footprint, w, h}, `spriteTraits(ref, {uploaded?})` |
| `index.ts` | re-exports everything |

Entry shape: `{key, name, sheet, index, category, w, h, sight, light, height, footprint}` plus, for objects,
`classic {kind, variant?}` and `standIn`; for textures, `terrain` and `rotatable`.

## Rules the values follow

- **Keys (D8):** `<folder>/<slugify(name)>`; apostrophes are dropped (`swamp/will-o-wisp-light`). One name occurs as both
  an object and a texture in one folder (volcanic "cracked basalt"); the texture key gets `-terrain`
  (`volcanic/cracked-basalt-terrain`). The test pins that this is the only one.
- **Size (D4):** props 1 x 1; large 2 x 2; long items 2 x 1 with a rect footprint: the plan's list (bridges, wall / channel /
  boardwalk sections, bookshelf, bar counter, long tables and benches, pew row, cannon pair), the catacomb niche wall and the
  wooden pier section, plus **fallen tree trunk** and **rotting log** (long by nature; Q-P1-2). Textures cover
  `TEXTURE_SQUARES` (4) squares per side.
- **Sight (D3, R7's test):** block = big enough to hide behind; cover = furniture and low objects; none = flat things,
  small creatures, thin posts and see-through things. Flat (no-shadow) sprites are never blockers (test).
  Bars, gates, fences and cages are **cover** (you can see through them).
- **Shadow height (D5):** flat = lies on the ground (rugs, pools, stains, webs, tracks); tall = trees, tents, statues,
  pillars, walls, standing torches and lamps, posts; low = everything else.
- **Footprint:** rect for long items, buildings / corners / walls, beds, desks, counters, doors, coffins, rugs; circle otherwise.
- **Classic look (D1, D2):** one of the 22 kinds, chosen to look and behave alike. Light sprites map to `torch` (or
  `walltorch` for the hooked ship lantern) for torch light and to `campfire` for campfire light; nothing else maps to a
  Classic light kind (test). Faint-glow sprites map to a non-light kind (candles and crystals -> `crystal`, glowing
  mushrooms / moss / lichen -> `mushroom`, lava and embers -> `rock` / `rubble` / `log`), because no Classic kind has the
  faint-glow reach.
- **Stands in (D1 mapping):** on a Sprites map an object without a sprite ref is drawn with a sprite that "stands in" for its
  Classic kind. A sprite stands in only when vision cannot notice the swap: same kind, `standIn` not switched off, the kind's
  R7 sight default, and the kind's light (so faint-glow sprites never stand in). The setting's candidates are used, else
  common's, else null (draw Classic). Variant narrows the list when some candidate has that variant. `pickSprite` hashes
  (object id, seed); `pickTexture` hashes (terrain, 4 x 4 block, seed).
- **Textures (D6):** terrain class = the Classic terrain the texture paints (vision reads only wall / void as blocking, so the
  class mostly decides which Classic terrain it replaces). Not rotatable: planks, tiles, flagstones, bricks, carpets, roads,
  paths, wheat rows.

## Light summary (Q1)

- **Torch [6, 12]:** standing torch (lit), iron brazier (lit), lantern on a post, street lamp, floor brazier, drow lantern,
  burning brazier, **lantern on a hook** (ship deck; added to Q1(a)'s list as an obvious lantern).
- **Campfire [12, 24]:** campfire (burning), campfire in snow, **desert campfire** (added: a burning campfire), hearth
  fireplace, grand fireplace, fireplace grate, blacksmith forge, forge of the fire giants, kitchen stove.
- **Faint glow [1, 3]:** candle cluster (dungeon, crypt), candle, candle stand, candle stub, candelabra, altar with candles,
  glowing mushroom cluster, glowing blue / purple mushroom, giant glowing mushroom, luminous moss, glowing lichen,
  cave crystal, giant crystal cluster, crystal outcrop, crystal shard, giant crystal, will-o'-wisp light, lava pool, magma
  bubble, ember pile, fire geyser, lava bridge.
- **None, deliberately:** old campfire and campfire (burnt out), coil of rope and a lantern (unlit), incense burner,
  sulphur crystal, fire opal, obsidian shard, icicle cluster, mushroom cluster / grove, fungal tree, witch's cauldron,
  stained-glass light pattern, steam vent, smoking crater. Textures give no light (including "glowing lava" and
  "glowing moss floor"; Q-P1-3).

## QUESTIONS for the user (defaults are in the code; each is a one-line change)

- **Q-P1-1 (light borderline):** lantern on a hook and the desert campfire were added to the torch / campfire lists; crystal
  outcrop (mountain) and the lava bridge / fire geyser glow faintly; witch's cauldron and the incense burner give none.
  Change any?
- **Q-P1-2 (long logs):** fallen tree trunk and rotting log are 2 x 1 like the plan's long items. Keep, or 2 x 2?
- **Q-P1-3 (glowing terrain):** should the "glowing lava" and "glowing moss floor" textures light the squares they cover
  (faint glow)? Default no: the vision engine reads light only from objects.
- **Q-P1-4 (dead trees):** dead trees follow R7 (no effect on sight), not "trees block". Keep?

## Acceptance evidence

- `tests/unit/sprite-catalog.test.ts`: 53 tests. Parses `docs/sprite-packs/prompts.md` and asserts that every folder's
  three lists equal the doc in order (20 folders x 3 sheets), that keys are unique (580), the D2 light rule, exact torch /
  campfire / faint-glow lists, sizes 1..4, D3 / D5 / D6 invariants, settings (19, common never offered), mapping
  (setting -> common -> null, variant narrowing, sight / light match, determinism, spread, 4 x 4 texture blocks),
  `pickSetting` on 13 descriptions plus the map name, the manifest schema (empty valid, wrong folder / duplicate / version /
  size rejected) and lookup join, and `spriteTraits` for built-in, uploaded and deleted refs, with a compile-time check
  against the VisionTraits shape.
- Needed outside `owns` (orchestrator): add `src/lib/sprite-packs/**` to the framework-free file list in
  `eslint.config.mjs` (CH6), so the relative-import rule covers it (the module already uses relative imports only).

## Catalog tables (every assignment, for review)

Light column: blank = none. "Stands in" = used by the mapping tables for Classic objects without a ref.

### Common (added to every setting) (`common`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | wooden crate | 1 x 1 | cover |  | low | circle | crate | yes |
| 2 | props | barrel | 1 x 1 | cover |  | low | circle | barrel | yes |
| 3 | props | treasure chest (closed) | 1 x 1 | cover |  | low | circle | chest | yes |
| 4 | props | treasure chest (open, coins inside) | 1 x 1 | cover |  | low | circle | chest | yes |
| 5 | props | sack of grain | 1 x 1 | cover |  | low | circle | crate |  |
| 6 | props | small round table | 1 x 1 | cover |  | low | circle | table | yes |
| 7 | props | wooden chair | 1 x 1 | cover |  | low | circle | table |  |
| 8 | props | bedroll | 1 x 1 | none |  | flat | circle | log |  |
| 9 | props | campfire (burning) | 1 x 1 | none | **campfire** | low | circle | campfire | yes |
| 10 | props | campfire (burnt out, ashes) | 1 x 1 | none |  | flat | circle | rubble |  |
| 11 | props | standing torch (lit) | 1 x 1 | none | **torch** | tall | circle | torch | yes |
| 12 | props | iron brazier (lit) | 1 x 1 | none | **torch** | low | circle | torch | yes |
| 13 | props | pile of rubble | 1 x 1 | cover |  | low | circle | rubble | yes |
| 14 | props | scattered bones and a skull | 1 x 1 | none |  | flat | circle | bones | yes |
| 15 | props | weapon rack with swords and spears | 1 x 1 | cover |  | low | rect | crate |  |
| 16 | props | coil of rope and a lantern | 1 x 1 | none |  | low | circle | crate |  |
| 1 | large | covered wagon | 2 x 2 | block |  | tall | rect | tent |  |
| 2 | large | hay cart | 2 x 2 | block |  | tall | rect | tent |  |
| 3 | large | long feast table with benches | 2 x 1 | cover |  | low | rect | table | yes |
| 4 | large | bookshelf (seen from above, two squares wide) | 2 x 1 | block |  | tall | rect | crate |  |
| 5 | large | canvas tent (closed) | 2 x 2 | block |  | tall | circle | tent | yes |
| 6 | large | large boulder | 2 x 2 | block |  | tall | circle | boulder | yes |
| 7 | large | fallen tree trunk | 2 x 1 | cover |  | low | rect | log | yes |
| 8 | large | stone well | 2 x 2 | cover |  | low | circle | rock |  |
| 9 | large | broken statue lying on its side | 2 x 2 | cover |  | low | rect | statue |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | grass | grass | yes | `common/grass` |
| 2 | packed dirt | dirt | yes | `common/packed-dirt` |
| 3 | cobblestone road | path | no | `common/cobblestone-road` |
| 4 | flagstone floor | stone | no | `common/flagstone-floor` |

### Forest (`forest`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | bush | 1 x 1 | cover |  | low | circle | bush (green) | yes |
| 2 | props | fern clump | 1 x 1 | cover |  | low | circle | bush | yes |
| 3 | props | mushroom ring | 1 x 1 | none |  | flat | circle | mushroom | yes |
| 4 | props | tree stump | 1 x 1 | cover |  | low | circle | log |  |
| 5 | props | small rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 6 | props | mossy log (short) | 1 x 1 | cover |  | low | circle | log | yes |
| 7 | props | berry bush | 1 x 1 | cover |  | low | circle | bush | yes |
| 8 | props | flower patch | 1 x 1 | none |  | flat | circle | bush |  |
| 9 | props | thorn bramble | 1 x 1 | cover |  | low | circle | bush | yes |
| 10 | props | hollow log | 1 x 1 | cover |  | low | circle | log | yes |
| 11 | props | animal carcass | 1 x 1 | none |  | flat | circle | bones |  |
| 12 | props | bird's nest on the ground | 1 x 1 | none |  | flat | circle | bones |  |
| 13 | props | woodcutter's axe in a stump | 1 x 1 | cover |  | low | circle | log |  |
| 14 | props | signpost | 1 x 1 | none |  | tall | circle | pillar |  |
| 15 | props | small pond | 1 x 1 | none |  | flat | circle | rock |  |
| 16 | props | rabbit burrow | 1 x 1 | none |  | flat | circle | rubble |  |
| 1 | large | oak tree | 2 x 2 | block |  | tall | circle | tree (green) | yes |
| 2 | large | pine tree | 2 x 2 | block |  | tall | circle | tree (pine) | yes |
| 3 | large | birch tree | 2 x 2 | block |  | tall | circle | tree (olive) | yes |
| 4 | large | dead tree | 2 x 2 | none |  | tall | circle | deadtree | yes |
| 5 | large | giant mushroom | 2 x 2 | block |  | tall | circle | mushroom |  |
| 6 | large | autumn maple tree | 2 x 2 | block |  | tall | circle | tree (autumn) | yes |
| 7 | large | thick hedge | 2 x 2 | block |  | tall | rect | bush |  |
| 8 | large | hunter's lean-to | 2 x 2 | block |  | tall | rect | tent | yes |
| 9 | large | ancient tree with roots | 2 x 2 | block |  | tall | circle | tree (dark) | yes |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | forest floor with leaves | grass | yes | `forest/forest-floor-with-leaves` |
| 2 | moss | grass | yes | `forest/moss` |
| 3 | tall grass | grass | yes | `forest/tall-grass` |
| 4 | muddy path | path | no | `forest/muddy-path` |

### Grassland and road (`grassland-and-road`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | milestone | 1 x 1 | cover |  | low | circle | rock |  |
| 2 | props | wildflowers | 1 x 1 | none |  | flat | circle | bush |  |
| 3 | props | haystack (small) | 1 x 1 | cover |  | low | circle | bush |  |
| 4 | props | fence post | 1 x 1 | none |  | low | circle | pillar |  |
| 5 | props | rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 6 | props | shrub | 1 x 1 | cover |  | low | circle | bush | yes |
| 7 | props | wooden gate | 1 x 1 | cover |  | low | rect | log |  |
| 8 | props | scarecrow | 1 x 1 | none |  | tall | circle | deadtree |  |
| 9 | props | beehive | 1 x 1 | cover |  | low | circle | barrel |  |
| 10 | props | trough | 1 x 1 | cover |  | low | rect | crate |  |
| 11 | props | roadside shrine | 1 x 1 | cover |  | low | circle | statue |  |
| 12 | props | grave marker | 1 x 1 | cover |  | low | circle | rock |  |
| 13 | props | broken cart wheel | 1 x 1 | none |  | flat | circle | rubble |  |
| 14 | props | picnic blanket | 1 x 1 | none |  | flat | rect | rubble |  |
| 15 | props | rabbit | 1 x 1 | none |  | low | circle | rock |  |
| 16 | props | crow | 1 x 1 | none |  | low | circle | rock |  |
| 1 | large | lone oak tree | 2 x 2 | block |  | tall | circle | tree (green) | yes |
| 2 | large | haystack | 2 x 2 | block |  | tall | circle | boulder |  |
| 3 | large | windmill base | 2 x 2 | block |  | tall | rect | pillar |  |
| 4 | large | wooden bridge (two squares) | 2 x 1 | none |  | flat | rect | log |  |
| 5 | large | farmhouse corner | 2 x 2 | block |  | tall | rect | pillar |  |
| 6 | large | standing stones (pair) | 2 x 2 | block |  | tall | circle | boulder | yes |
| 7 | large | watchtower base | 2 x 2 | block |  | tall | rect | pillar |  |
| 8 | large | orchard tree | 2 x 2 | block |  | tall | circle | tree (olive) | yes |
| 9 | large | stone wall section | 2 x 1 | block |  | tall | rect | pillar |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | meadow grass | grass | yes | `grassland-and-road/meadow-grass` |
| 2 | dirt road | path | no | `grassland-and-road/dirt-road` |
| 3 | wheat field | grass | no | `grassland-and-road/wheat-field` |
| 4 | trampled grass | grass | yes | `grassland-and-road/trampled-grass` |

### Mountain and cliffs (`mountain-and-cliffs`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | loose rocks | 1 x 1 | cover |  | low | circle | rubble | yes |
| 2 | props | mountain goat | 1 x 1 | none |  | low | circle | rock |  |
| 3 | props | cairn | 1 x 1 | cover |  | low | circle | rock |  |
| 4 | props | snowy rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 5 | props | climbing rope with piton | 1 x 1 | none |  | flat | circle | rubble |  |
| 6 | props | cracked boulder | 1 x 1 | cover |  | low | circle | rock | yes |
| 7 | props | mountain shrub | 1 x 1 | cover |  | low | circle | bush | yes |
| 8 | props | eagle nest | 1 x 1 | none |  | flat | circle | bones |  |
| 9 | props | old campsite | 1 x 1 | none |  | flat | circle | rubble |  |
| 10 | props | broken pickaxe | 1 x 1 | none |  | flat | circle | bones |  |
| 11 | props | ice patch | 1 x 1 | none |  | flat | circle | rock |  |
| 12 | props | crystal outcrop | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 13 | props | bones of a climber | 1 x 1 | none |  | flat | circle | bones | yes |
| 14 | props | rope bridge anchor | 1 x 1 | cover |  | low | circle | log |  |
| 15 | props | lookout flag | 1 x 1 | none |  | tall | circle | pillar |  |
| 16 | props | tiny pine | 1 x 1 | cover |  | low | circle | bush (pine) | yes |
| 1 | large | cliff edge rock | 2 x 2 | block |  | tall | rect | boulder | yes |
| 2 | large | large boulder pair | 2 x 2 | block |  | tall | circle | boulder | yes |
| 3 | large | rock spire | 2 x 2 | block |  | tall | circle | boulder | yes |
| 4 | large | cave mouth | 2 x 2 | block |  | tall | circle | boulder |  |
| 5 | large | pine trees (pair) | 2 x 2 | block |  | tall | circle | tree (pine) | yes |
| 6 | large | rockslide | 2 x 2 | cover |  | low | circle | rubble | yes |
| 7 | large | rope bridge (two squares) | 2 x 1 | none |  | flat | rect | log |  |
| 8 | large | stone stair | 2 x 2 | none |  | low | rect | rubble |  |
| 9 | large | giant's skull | 2 x 2 | block |  | tall | circle | bones |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | rocky ground | dirt | yes | `mountain-and-cliffs/rocky-ground` |
| 2 | scree and gravel | path | yes | `mountain-and-cliffs/scree-and-gravel` |
| 3 | bare granite | stone | yes | `mountain-and-cliffs/bare-granite` |
| 4 | alpine grass | grass | yes | `mountain-and-cliffs/alpine-grass` |

### Cave (`cave`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | stalagmite | 1 x 1 | cover |  | low | circle | rock |  |
| 2 | props | glowing mushroom cluster | 1 x 1 | none | **faintglow** | low | circle | mushroom |  |
| 3 | props | cave crystal | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 4 | props | rock pile | 1 x 1 | cover |  | low | circle | rubble | yes |
| 5 | props | puddle | 1 x 1 | none |  | flat | circle | rock |  |
| 6 | props | bat colony (hanging) | 1 x 1 | none |  | low | circle | bones |  |
| 7 | props | bones | 1 x 1 | none |  | flat | circle | bones | yes |
| 8 | props | old campfire | 1 x 1 | none |  | flat | circle | rubble |  |
| 9 | props | ore vein | 1 x 1 | none |  | flat | circle | rock |  |
| 10 | props | spider web | 1 x 1 | none |  | flat | circle | bones |  |
| 11 | props | small stalagmite pair | 1 x 1 | cover |  | low | circle | rock |  |
| 12 | props | fungus patch | 1 x 1 | none |  | flat | circle | mushroom | yes |
| 13 | props | cave lizard | 1 x 1 | none |  | low | circle | rock |  |
| 14 | props | lost backpack | 1 x 1 | none |  | low | circle | crate |  |
| 15 | props | rock column (thin) | 1 x 1 | block |  | tall | circle | pillar | yes |
| 16 | props | dripping water pool | 1 x 1 | none |  | flat | circle | rock |  |
| 1 | large | rock column | 2 x 2 | block |  | tall | circle | pillar | yes |
| 2 | large | underground pool | 2 x 2 | none |  | flat | circle | rock |  |
| 3 | large | giant crystal cluster | 2 x 2 | block | **faintglow** | tall | circle | crystal |  |
| 4 | large | chasm crack | 2 x 2 | none |  | flat | circle | rubble |  |
| 5 | large | giant spider web | 2 x 2 | none |  | flat | circle | bones |  |
| 6 | large | rock wall chunk | 2 x 2 | block |  | tall | rect | boulder | yes |
| 7 | large | mushroom grove | 2 x 2 | block |  | tall | circle | mushroom |  |
| 8 | large | collapsed tunnel | 2 x 2 | cover |  | low | circle | rubble | yes |
| 9 | large | ancient altar stone | 2 x 2 | cover |  | low | rect | table |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | cave floor stone | cave | yes | `cave/cave-floor-stone` |
| 2 | wet cave rock | cave | yes | `cave/wet-cave-rock` |
| 3 | cave gravel | cave | yes | `cave/cave-gravel` |
| 4 | underground water (shallow) | water | yes | `cave/underground-water-shallow` |

### Dungeon (`dungeon`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | stone pillar (small) | 1 x 1 | block |  | tall | circle | pillar | yes |
| 2 | props | iron cage | 1 x 1 | cover |  | tall | rect | crate |  |
| 3 | props | chains on the floor | 1 x 1 | none |  | flat | circle | bones |  |
| 4 | props | lever | 1 x 1 | none |  | low | circle | rubble |  |
| 5 | props | pressure plate | 1 x 1 | none |  | flat | rect | rubble |  |
| 6 | props | wooden door (closed) | 1 x 1 | block |  | tall | rect | crate |  |
| 7 | props | portcullis section | 1 x 1 | cover |  | tall | rect | crate |  |
| 8 | props | torture rack | 1 x 1 | cover |  | low | rect | table |  |
| 9 | props | prisoner bench | 1 x 1 | cover |  | low | rect | table |  |
| 10 | props | trapdoor | 1 x 1 | none |  | flat | rect | crate |  |
| 11 | props | spike trap | 1 x 1 | none |  | flat | rect | rubble |  |
| 12 | props | broken shackles | 1 x 1 | none |  | flat | circle | bones |  |
| 13 | props | rat | 1 x 1 | none |  | low | circle | rock |  |
| 14 | props | candle cluster | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 15 | props | urn | 1 x 1 | cover |  | low | circle | barrel |  |
| 16 | props | bloodstain | 1 x 1 | none |  | flat | circle | bones |  |
| 1 | large | thick stone pillar | 2 x 2 | block |  | tall | circle | pillar | yes |
| 2 | large | iron maiden | 2 x 2 | block |  | tall | rect | statue |  |
| 3 | large | cell with bars | 2 x 2 | cover |  | tall | rect | crate |  |
| 4 | large | throne | 2 x 2 | cover |  | low | rect | statue |  |
| 5 | large | stone sarcophagus | 2 x 2 | cover |  | low | rect | chest |  |
| 6 | large | collapsed wall | 2 x 2 | cover |  | low | circle | rubble | yes |
| 7 | large | large pit | 2 x 2 | none |  | flat | circle | rubble |  |
| 8 | large | stone stair down | 2 x 2 | none |  | flat | rect | rubble |  |
| 9 | large | altar with candles | 2 x 2 | cover | **faintglow** | low | rect | table |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | dungeon flagstones | stone | no | `dungeon/dungeon-flagstones` |
| 2 | mossy stone floor | stone | yes | `dungeon/mossy-stone-floor` |
| 3 | cracked stone | stone | yes | `dungeon/cracked-stone` |
| 4 | dirt and straw floor | dirt | yes | `dungeon/dirt-and-straw-floor` |

### Crypt and graveyard (`crypt-and-graveyard`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | gravestone | 1 x 1 | cover |  | low | circle | rock |  |
| 2 | props | cracked gravestone | 1 x 1 | cover |  | low | circle | rock |  |
| 3 | props | candle cluster | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 4 | props | skull pile | 1 x 1 | none |  | low | circle | bones | yes |
| 5 | props | urn | 1 x 1 | cover |  | low | circle | barrel |  |
| 6 | props | coffin (closed) | 1 x 1 | cover |  | low | rect | chest |  |
| 7 | props | coffin (open) | 1 x 1 | cover |  | low | rect | chest |  |
| 8 | props | wilted flowers | 1 x 1 | none |  | flat | circle | bush |  |
| 9 | props | lantern on a post | 1 x 1 | none | **torch** | tall | circle | torch | yes |
| 10 | props | spiderweb | 1 x 1 | none |  | flat | circle | bones |  |
| 11 | props | bones | 1 x 1 | none |  | flat | circle | bones | yes |
| 12 | props | grave mound | 1 x 1 | cover |  | low | circle | rubble |  |
| 13 | props | broken statue head | 1 x 1 | cover |  | low | circle | rubble |  |
| 14 | props | holy symbol | 1 x 1 | none |  | flat | circle | bones |  |
| 15 | props | iron fence section | 1 x 1 | cover |  | tall | rect | log |  |
| 16 | props | raven | 1 x 1 | none |  | low | circle | rock |  |
| 1 | large | mausoleum corner | 2 x 2 | block |  | tall | rect | pillar |  |
| 2 | large | stone sarcophagus | 2 x 2 | cover |  | low | rect | chest |  |
| 3 | large | open grave | 2 x 2 | none |  | flat | rect | rubble |  |
| 4 | large | dead tree | 2 x 2 | none |  | tall | circle | deadtree | yes |
| 5 | large | angel statue | 2 x 2 | block |  | tall | circle | statue | yes |
| 6 | large | crypt gate | 2 x 2 | cover |  | tall | rect | pillar |  |
| 7 | large | bone pile | 2 x 2 | cover |  | low | circle | bones |  |
| 8 | large | ossuary shelf | 2 x 2 | block |  | tall | rect | crate |  |
| 9 | large | catacomb niche wall | 2 x 1 | block |  | tall | rect | pillar |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | crypt flagstones | stone | no | `crypt-and-graveyard/crypt-flagstones` |
| 2 | graveyard grass | grass | yes | `crypt-and-graveyard/graveyard-grass` |
| 3 | grave dirt | dirt | yes | `crypt-and-graveyard/grave-dirt` |
| 4 | dusty tomb floor | stone | yes | `crypt-and-graveyard/dusty-tomb-floor` |

### Castle interior (`castle-interior`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | banner stand | 1 x 1 | none |  | tall | circle | pillar |  |
| 2 | props | suit of armour | 1 x 1 | cover |  | tall | circle | statue |  |
| 3 | props | candelabra | 1 x 1 | none | **faintglow** | tall | circle | crystal |  |
| 4 | props | ornate chair | 1 x 1 | cover |  | low | circle | table |  |
| 5 | props | small table with goblet | 1 x 1 | cover |  | low | circle | table | yes |
| 6 | props | rug (small) | 1 x 1 | none |  | flat | rect | rubble |  |
| 7 | props | fireplace grate | 1 x 1 | none | **campfire** | low | circle | campfire | yes |
| 8 | props | weapon display | 1 x 1 | cover |  | low | rect | crate |  |
| 9 | props | tapestry rolled | 1 x 1 | cover |  | low | circle | log |  |
| 10 | props | footstool | 1 x 1 | none |  | low | circle | table |  |
| 11 | props | chest | 1 x 1 | cover |  | low | circle | chest | yes |
| 12 | props | chamber pot | 1 x 1 | none |  | low | circle | barrel |  |
| 13 | props | map table (small) | 1 x 1 | cover |  | low | circle | table | yes |
| 14 | props | harp | 1 x 1 | cover |  | low | circle | statue |  |
| 15 | props | statue bust | 1 x 1 | cover |  | low | circle | statue |  |
| 16 | props | floor brazier | 1 x 1 | none | **torch** | low | circle | torch | yes |
| 1 | large | throne on a dais | 2 x 2 | cover |  | low | rect | statue |  |
| 2 | large | long dining table | 2 x 1 | cover |  | low | rect | table | yes |
| 3 | large | four-poster bed | 2 x 2 | cover |  | tall | rect | table |  |
| 4 | large | grand fireplace | 2 x 2 | block | **campfire** | tall | rect | campfire |  |
| 5 | large | great rug | 2 x 2 | none |  | flat | rect | rubble |  |
| 6 | large | staircase | 2 x 2 | none |  | low | rect | rubble |  |
| 7 | large | stone column | 2 x 2 | block |  | tall | circle | pillar | yes |
| 8 | large | armoury rack | 2 x 2 | cover |  | tall | rect | crate |  |
| 9 | large | library desk | 2 x 2 | cover |  | low | rect | table |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | polished stone floor | stone | yes | `castle-interior/polished-stone-floor` |
| 2 | red carpet | stone | no | `castle-interior/red-carpet` |
| 3 | wooden floorboards | wood | no | `castle-interior/wooden-floorboards` |
| 4 | marble tiles | stone | no | `castle-interior/marble-tiles` |

### Tavern (`tavern`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | tavern table with mugs | 1 x 1 | cover |  | low | circle | table | yes |
| 2 | props | stool | 1 x 1 | cover |  | low | circle | table |  |
| 3 | props | barrel tap | 1 x 1 | cover |  | low | circle | barrel | yes |
| 4 | props | keg | 1 x 1 | cover |  | low | circle | barrel | yes |
| 5 | props | chair | 1 x 1 | cover |  | low | circle | table |  |
| 6 | props | plate of food | 1 x 1 | none |  | flat | circle | table |  |
| 7 | props | tankard tray | 1 x 1 | none |  | flat | circle | table |  |
| 8 | props | broom | 1 x 1 | none |  | flat | circle | log |  |
| 9 | props | card game table | 1 x 1 | cover |  | low | circle | table | yes |
| 10 | props | candle | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 11 | props | coat rack | 1 x 1 | none |  | tall | circle | pillar |  |
| 12 | props | bard's lute | 1 x 1 | none |  | flat | circle | log |  |
| 13 | props | drunk patron asleep | 1 x 1 | none |  | low | circle | bones |  |
| 14 | props | cat | 1 x 1 | none |  | low | circle | rock |  |
| 15 | props | bucket | 1 x 1 | none |  | low | circle | barrel |  |
| 16 | props | notice board | 1 x 1 | cover |  | tall | rect | pillar |  |
| 1 | large | bar counter (two squares) | 2 x 1 | cover |  | low | rect | table |  |
| 2 | large | hearth fireplace | 2 x 2 | block | **campfire** | tall | rect | campfire |  |
| 3 | large | long bench table | 2 x 1 | cover |  | low | rect | table | yes |
| 4 | large | stage platform | 2 x 2 | none |  | low | rect | table |  |
| 5 | large | stair up | 2 x 2 | none |  | low | rect | rubble |  |
| 6 | large | kitchen stove | 2 x 2 | cover | **campfire** | low | rect | campfire |  |
| 7 | large | storeroom shelves | 2 x 2 | block |  | tall | rect | crate |  |
| 8 | large | booth with benches | 2 x 2 | cover |  | low | rect | table |  |
| 9 | large | bed (inn room) | 2 x 2 | cover |  | low | rect | table |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | tavern floorboards | wood | no | `tavern/tavern-floorboards` |
| 2 | worn planks | wood | no | `tavern/worn-planks` |
| 3 | kitchen tiles | stone | no | `tavern/kitchen-tiles` |
| 4 | stone hearth floor | stone | yes | `tavern/stone-hearth-floor` |

### Town street and market (`town-street-and-market`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | market crate of apples | 1 x 1 | cover |  | low | circle | crate | yes |
| 2 | props | fish barrel | 1 x 1 | cover |  | low | circle | barrel | yes |
| 3 | props | vegetable stall basket | 1 x 1 | cover |  | low | circle | barrel |  |
| 4 | props | street lamp | 1 x 1 | none | **torch** | tall | circle | torch | yes |
| 5 | props | well bucket | 1 x 1 | none |  | low | circle | barrel |  |
| 6 | props | bench | 1 x 1 | cover |  | low | rect | log |  |
| 7 | props | cart (handcart) | 1 x 1 | cover |  | low | circle | crate |  |
| 8 | props | crate stack | 1 x 1 | cover |  | low | circle | crate | yes |
| 9 | props | pottery jars | 1 x 1 | cover |  | low | circle | barrel |  |
| 10 | props | bolt of cloth | 1 x 1 | none |  | low | circle | log |  |
| 11 | props | sign post | 1 x 1 | none |  | tall | circle | pillar |  |
| 12 | props | trash pile | 1 x 1 | cover |  | low | circle | rubble | yes |
| 13 | props | chicken | 1 x 1 | none |  | low | circle | rock |  |
| 14 | props | dog | 1 x 1 | none |  | low | circle | rock |  |
| 15 | props | rain barrel | 1 x 1 | cover |  | low | circle | barrel | yes |
| 16 | props | flower box | 1 x 1 | cover |  | low | rect | crate |  |
| 1 | large | market stall with awning | 2 x 2 | block |  | tall | rect | tent |  |
| 2 | large | fountain | 2 x 2 | cover |  | low | circle | statue |  |
| 3 | large | town well | 2 x 2 | cover |  | low | circle | rock |  |
| 4 | large | statue on a plinth | 2 x 2 | block |  | tall | circle | statue | yes |
| 5 | large | house corner | 2 x 2 | block |  | tall | rect | pillar |  |
| 6 | large | blacksmith forge | 2 x 2 | block | **campfire** | tall | rect | campfire |  |
| 7 | large | wagon | 2 x 2 | block |  | tall | rect | tent |  |
| 8 | large | large tree in a planter | 2 x 2 | block |  | tall | circle | tree (green) | yes |
| 9 | large | guard post | 2 x 2 | block |  | tall | rect | tent |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | cobblestones | path | no | `town-street-and-market/cobblestones` |
| 2 | town square flagstones | stone | no | `town-street-and-market/town-square-flagstones` |
| 3 | muddy street | dirt | yes | `town-street-and-market/muddy-street` |
| 4 | market plaza tiles | stone | no | `town-street-and-market/market-plaza-tiles` |

### Temple (`temple`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | candle stand | 1 x 1 | none | **faintglow** | tall | circle | crystal |  |
| 2 | props | offering bowl | 1 x 1 | none |  | low | circle | barrel |  |
| 3 | props | prayer mat | 1 x 1 | none |  | flat | rect | rubble |  |
| 4 | props | incense burner | 1 x 1 | none |  | low | circle | barrel |  |
| 5 | props | holy book on a lectern | 1 x 1 | cover |  | low | circle | table |  |
| 6 | props | bell | 1 x 1 | cover |  | low | circle | barrel |  |
| 7 | props | small statue | 1 x 1 | cover |  | low | circle | statue |  |
| 8 | props | flower offering | 1 x 1 | none |  | flat | circle | bush |  |
| 9 | props | font of holy water | 1 x 1 | cover |  | low | circle | barrel |  |
| 10 | props | pew (short) | 1 x 1 | cover |  | low | rect | log |  |
| 11 | props | relic box | 1 x 1 | cover |  | low | circle | chest | yes |
| 12 | props | banner of the faith | 1 x 1 | none |  | tall | circle | pillar |  |
| 13 | props | gong | 1 x 1 | cover |  | tall | circle | pillar |  |
| 14 | props | prayer beads | 1 x 1 | none |  | flat | circle | bones |  |
| 15 | props | urn of ashes | 1 x 1 | cover |  | low | circle | barrel |  |
| 16 | props | kneeler | 1 x 1 | none |  | low | circle | table |  |
| 1 | large | altar | 2 x 2 | cover |  | low | rect | table |  |
| 2 | large | great statue of a god | 2 x 2 | block |  | tall | circle | statue | yes |
| 3 | large | pew row | 2 x 1 | cover |  | low | rect | log |  |
| 4 | large | stone column | 2 x 2 | block |  | tall | circle | pillar | yes |
| 5 | large | sacred pool | 2 x 2 | none |  | flat | circle | rock |  |
| 6 | large | bell tower base | 2 x 2 | block |  | tall | rect | pillar |  |
| 7 | large | stained-glass light pattern | 2 x 2 | none |  | flat | rect | rubble |  |
| 8 | large | reliquary | 2 x 2 | cover |  | low | rect | chest |  |
| 9 | large | priest's dais | 2 x 2 | none |  | low | rect | rubble |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | temple marble | stone | yes | `temple/temple-marble` |
| 2 | mosaic floor | stone | no | `temple/mosaic-floor` |
| 3 | stone tiles with runes | stone | no | `temple/stone-tiles-with-runes` |
| 4 | polished wood | wood | no | `temple/polished-wood` |

### Swamp (`swamp`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | reeds | 1 x 1 | cover |  | low | circle | bush | yes |
| 2 | props | lily pads | 1 x 1 | none |  | flat | circle | bush |  |
| 3 | props | rotten stump | 1 x 1 | cover |  | low | circle | log |  |
| 4 | props | bog mushroom | 1 x 1 | none |  | low | circle | mushroom | yes |
| 5 | props | will-o'-wisp light | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 6 | props | frog | 1 x 1 | none |  | low | circle | rock |  |
| 7 | props | mossy rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 8 | props | bones in mud | 1 x 1 | none |  | flat | circle | bones | yes |
| 9 | props | sunken barrel | 1 x 1 | cover |  | low | circle | barrel | yes |
| 10 | props | hanging moss | 1 x 1 | none |  | low | circle | bush |  |
| 11 | props | cattails | 1 x 1 | cover |  | low | circle | bush | yes |
| 12 | props | snake | 1 x 1 | none |  | low | circle | rock |  |
| 13 | props | broken boat plank | 1 x 1 | none |  | flat | circle | log |  |
| 14 | props | witch's charm totem | 1 x 1 | none |  | tall | circle | pillar |  |
| 15 | props | insect swarm | 1 x 1 | none |  | low | circle | bones |  |
| 16 | props | bubbling mud | 1 x 1 | none |  | flat | circle | rubble |  |
| 1 | large | mangrove tree | 2 x 2 | block |  | tall | circle | tree (dark) | yes |
| 2 | large | dead swamp tree | 2 x 2 | none |  | tall | circle | deadtree | yes |
| 3 | large | stilt hut corner | 2 x 2 | block |  | tall | rect | pillar |  |
| 4 | large | sunken rowboat | 2 x 2 | cover |  | low | rect | log |  |
| 5 | large | bog pool | 2 x 2 | none |  | flat | circle | rock |  |
| 6 | large | giant lily pad | 2 x 2 | none |  | flat | circle | bush |  |
| 7 | large | rotting log | 2 x 1 | cover |  | low | rect | log | yes |
| 8 | large | witch's cauldron | 2 x 2 | cover |  | low | circle | barrel |  |
| 9 | large | broken boardwalk (two squares) | 2 x 1 | none |  | flat | rect | log |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | swamp mud | swamp | yes | `swamp/swamp-mud` |
| 2 | murky shallow water | water | yes | `swamp/murky-shallow-water` |
| 3 | bog grass | grass | yes | `swamp/bog-grass` |
| 4 | rotting boardwalk planks | wood | no | `swamp/rotting-boardwalk-planks` |

### Snow and tundra (`snow-and-tundra`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | snowy rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 2 | props | ice chunk | 1 x 1 | cover |  | low | circle | rock |  |
| 3 | props | snowman | 1 x 1 | cover |  | low | circle | statue |  |
| 4 | props | frozen bush | 1 x 1 | cover |  | low | circle | bush | yes |
| 5 | props | animal tracks | 1 x 1 | none |  | flat | circle | bones |  |
| 6 | props | snowy log | 1 x 1 | cover |  | low | circle | log | yes |
| 7 | props | ice spike | 1 x 1 | cover |  | low | circle | crystal |  |
| 8 | props | campfire in snow | 1 x 1 | none | **campfire** | low | circle | campfire | yes |
| 9 | props | fur bedroll | 1 x 1 | none |  | flat | circle | log |  |
| 10 | props | sled | 1 x 1 | cover |  | low | rect | crate |  |
| 11 | props | frozen corpse | 1 x 1 | none |  | low | circle | bones |  |
| 12 | props | wolf | 1 x 1 | none |  | low | circle | rock |  |
| 13 | props | snowdrift | 1 x 1 | cover |  | low | circle | rubble |  |
| 14 | props | broken spear in ice | 1 x 1 | none |  | flat | circle | bones |  |
| 15 | props | snowy signpost | 1 x 1 | none |  | tall | circle | pillar |  |
| 16 | props | icicle cluster | 1 x 1 | none |  | low | circle | crystal | yes |
| 1 | large | snowy pine tree | 2 x 2 | block |  | tall | circle | tree (pine) | yes |
| 2 | large | frozen lake hole | 2 x 2 | none |  | flat | circle | rock |  |
| 3 | large | ice formation | 2 x 2 | block |  | tall | circle | boulder | yes |
| 4 | large | igloo | 2 x 2 | block |  | tall | circle | tent | yes |
| 5 | large | snowy boulder | 2 x 2 | block |  | tall | circle | boulder | yes |
| 6 | large | mammoth skeleton | 2 x 2 | cover |  | low | circle | bones |  |
| 7 | large | frozen waterfall base | 2 x 2 | block |  | tall | circle | boulder |  |
| 8 | large | snow-covered tent | 2 x 2 | block |  | tall | circle | tent | yes |
| 9 | large | ice cave mouth | 2 x 2 | block |  | tall | circle | boulder |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | fresh snow | snow | yes | `snow-and-tundra/fresh-snow` |
| 2 | packed snow | snow | yes | `snow-and-tundra/packed-snow` |
| 3 | ice | water | yes | `snow-and-tundra/ice` |
| 4 | frozen tundra grass | grass | yes | `snow-and-tundra/frozen-tundra-grass` |

### Desert (`desert`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | cactus | 1 x 1 | cover |  | low | circle | bush |  |
| 2 | props | desert rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 3 | props | sun-bleached skull | 1 x 1 | none |  | flat | circle | bones | yes |
| 4 | props | dry bush | 1 x 1 | cover |  | low | circle | bush (olive) | yes |
| 5 | props | scorpion | 1 x 1 | none |  | low | circle | rock |  |
| 6 | props | clay jar | 1 x 1 | cover |  | low | circle | barrel |  |
| 7 | props | rug | 1 x 1 | none |  | flat | rect | rubble |  |
| 8 | props | water skin | 1 x 1 | none |  | flat | circle | bones |  |
| 9 | props | sand dune ripple | 1 x 1 | none |  | flat | circle | rubble |  |
| 10 | props | bones | 1 x 1 | none |  | flat | circle | bones | yes |
| 11 | props | broken pottery | 1 x 1 | none |  | flat | circle | rubble |  |
| 12 | props | palm sapling | 1 x 1 | cover |  | low | circle | bush |  |
| 13 | props | tent stake and rope | 1 x 1 | none |  | flat | circle | log |  |
| 14 | props | campfire | 1 x 1 | none | **campfire** | low | circle | campfire | yes |
| 15 | props | desert snake | 1 x 1 | none |  | low | circle | rock |  |
| 16 | props | ancient tablet | 1 x 1 | cover |  | low | circle | rock |  |
| 1 | large | palm tree | 2 x 2 | block |  | tall | circle | tree (olive) | yes |
| 2 | large | oasis pool | 2 x 2 | none |  | flat | circle | rock |  |
| 3 | large | sandstone pillar | 2 x 2 | block |  | tall | circle | pillar | yes |
| 4 | large | desert tent | 2 x 2 | block |  | tall | circle | tent | yes |
| 5 | large | camel | 2 x 2 | block |  | tall | circle | boulder |  |
| 6 | large | ruined obelisk | 2 x 2 | block |  | tall | circle | pillar | yes |
| 7 | large | giant skeleton ribs | 2 x 2 | cover |  | low | circle | bones |  |
| 8 | large | sand dune | 2 x 2 | block |  | tall | circle | boulder |  |
| 9 | large | merchant's caravan wagon | 2 x 2 | block |  | tall | rect | tent |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | desert sand | sand | yes | `desert/desert-sand` |
| 2 | cracked dry earth | dirt | yes | `desert/cracked-dry-earth` |
| 3 | sandstone floor | stone | no | `desert/sandstone-floor` |
| 4 | rocky desert | dirt | yes | `desert/rocky-desert` |

### Coast and beach (`coast-and-beach`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | seashell | 1 x 1 | none |  | flat | circle | bones |  |
| 2 | props | crab | 1 x 1 | none |  | low | circle | rock |  |
| 3 | props | driftwood | 1 x 1 | cover |  | low | circle | log | yes |
| 4 | props | rowboat oar | 1 x 1 | none |  | flat | circle | log |  |
| 5 | props | fishing net | 1 x 1 | none |  | flat | circle | rubble |  |
| 6 | props | rock with seaweed | 1 x 1 | cover |  | low | circle | rock | yes |
| 7 | props | tide pool | 1 x 1 | none |  | flat | circle | rock |  |
| 8 | props | sandcastle | 1 x 1 | cover |  | low | circle | rubble |  |
| 9 | props | seagull | 1 x 1 | none |  | low | circle | rock |  |
| 10 | props | rope post | 1 x 1 | none |  | low | circle | pillar |  |
| 11 | props | barrel washed ashore | 1 x 1 | cover |  | low | circle | barrel | yes |
| 12 | props | anchor | 1 x 1 | cover |  | low | circle | rubble |  |
| 13 | props | message bottle | 1 x 1 | none |  | flat | circle | bones |  |
| 14 | props | beach grass | 1 x 1 | cover |  | low | circle | bush | yes |
| 15 | props | starfish | 1 x 1 | none |  | flat | circle | bones |  |
| 16 | props | broken crate | 1 x 1 | cover |  | low | circle | crate | yes |
| 1 | large | rowboat | 2 x 2 | cover |  | low | rect | log |  |
| 2 | large | wooden pier section | 2 x 1 | none |  | flat | rect | log |  |
| 3 | large | palm tree | 2 x 2 | block |  | tall | circle | tree (olive) | yes |
| 4 | large | large sea rock | 2 x 2 | block |  | tall | circle | boulder | yes |
| 5 | large | shipwreck piece | 2 x 2 | block |  | tall | rect | boulder |  |
| 6 | large | fishing hut corner | 2 x 2 | block |  | tall | rect | pillar |  |
| 7 | large | lighthouse base | 2 x 2 | block |  | tall | circle | pillar |  |
| 8 | large | sea cave mouth | 2 x 2 | block |  | tall | circle | boulder |  |
| 9 | large | beached whale bones | 2 x 2 | cover |  | low | circle | bones |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | beach sand | sand | yes | `coast-and-beach/beach-sand` |
| 2 | wet sand | sand | yes | `coast-and-beach/wet-sand` |
| 3 | shallow sea water | water | yes | `coast-and-beach/shallow-sea-water` |
| 4 | rocky shore | stone | yes | `coast-and-beach/rocky-shore` |

### Ship deck (`ship-deck`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | deck cannon | 1 x 1 | cover |  | low | rect | barrel |  |
| 2 | props | coil of rope | 1 x 1 | none |  | low | circle | barrel |  |
| 3 | props | barrel | 1 x 1 | cover |  | low | circle | barrel | yes |
| 4 | props | crate | 1 x 1 | cover |  | low | circle | crate | yes |
| 5 | props | ship's wheel | 1 x 1 | cover |  | low | circle | table |  |
| 6 | props | anchor | 1 x 1 | cover |  | low | circle | rubble |  |
| 7 | props | bucket and mop | 1 x 1 | none |  | low | circle | barrel |  |
| 8 | props | cargo net | 1 x 1 | none |  | flat | circle | rubble |  |
| 9 | props | hatch (closed) | 1 x 1 | none |  | flat | rect | crate |  |
| 10 | props | hatch (open) | 1 x 1 | none |  | flat | rect | crate |  |
| 11 | props | lantern on a hook | 1 x 1 | none | **torch** | low | circle | walltorch | yes |
| 12 | props | sea chest | 1 x 1 | cover |  | low | circle | chest | yes |
| 13 | props | rigging pulley | 1 x 1 | none |  | low | circle | rubble |  |
| 14 | props | parrot | 1 x 1 | none |  | low | circle | rock |  |
| 15 | props | cannonballs pile | 1 x 1 | cover |  | low | circle | rubble |  |
| 16 | props | harpoon | 1 x 1 | none |  | flat | circle | log |  |
| 1 | large | mast with sail shadow | 2 x 2 | block |  | tall | circle | mast | yes |
| 2 | large | captain's table | 2 x 2 | cover |  | low | rect | table |  |
| 3 | large | capstan | 2 x 2 | cover |  | low | circle | barrel |  |
| 4 | large | lifeboat | 2 x 2 | cover |  | low | rect | log |  |
| 5 | large | cargo stack | 2 x 2 | block |  | tall | rect | crate |  |
| 6 | large | stairs below deck | 2 x 2 | none |  | flat | rect | rubble |  |
| 7 | large | cannon pair | 2 x 1 | cover |  | low | rect | barrel |  |
| 8 | large | ship's bow | 2 x 2 | none |  | flat | circle | hull |  |
| 9 | large | ship's stern cabin corner | 2 x 2 | block |  | tall | rect | pillar |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | deck planks | wood | no | `ship-deck/deck-planks` |
| 2 | wet deck planks | wood | no | `ship-deck/wet-deck-planks` |
| 3 | below-deck floor | wood | no | `ship-deck/below-deck-floor` |
| 4 | dark sea water | deep | yes | `ship-deck/dark-sea-water` |

### Sewers (`sewers`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | grate | 1 x 1 | none |  | flat | rect | rubble |  |
| 2 | props | rat | 1 x 1 | none |  | low | circle | rock |  |
| 3 | props | sewage puddle | 1 x 1 | none |  | flat | circle | rock |  |
| 4 | props | pipe outlet | 1 x 1 | none |  | low | circle | pillar |  |
| 5 | props | broken crate | 1 x 1 | cover |  | low | circle | crate | yes |
| 6 | props | ladder up | 1 x 1 | none |  | low | rect | log |  |
| 7 | props | lost dagger | 1 x 1 | none |  | flat | circle | bones |  |
| 8 | props | fungus patch | 1 x 1 | none |  | flat | circle | mushroom | yes |
| 9 | props | bones | 1 x 1 | none |  | flat | circle | bones | yes |
| 10 | props | rusty chain | 1 x 1 | none |  | flat | circle | bones |  |
| 11 | props | valve wheel | 1 x 1 | none |  | low | circle | rubble |  |
| 12 | props | sludge pile | 1 x 1 | cover |  | low | circle | rubble | yes |
| 13 | props | candle stub | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 14 | props | bucket | 1 x 1 | none |  | low | circle | barrel |  |
| 15 | props | torn sack | 1 x 1 | cover |  | low | circle | crate |  |
| 16 | props | eel | 1 x 1 | none |  | low | circle | rock |  |
| 1 | large | sewer channel (two squares) | 2 x 1 | none |  | flat | rect | rock |  |
| 2 | large | arched tunnel mouth | 2 x 2 | block |  | tall | rect | pillar |  |
| 3 | large | cistern | 2 x 2 | cover |  | low | circle | barrel |  |
| 4 | large | collapsed pipe | 2 x 2 | cover |  | low | circle | rubble |  |
| 5 | large | rat nest | 2 x 2 | cover |  | low | circle | rubble |  |
| 6 | large | stone bridge over channel | 2 x 1 | none |  | flat | rect | log |  |
| 7 | large | thieves' hideout corner | 2 x 2 | block |  | tall | rect | pillar |  |
| 8 | large | iron gate | 2 x 2 | cover |  | tall | rect | pillar |  |
| 9 | large | flooded chamber | 2 x 2 | none |  | flat | rect | rock |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | wet sewer stone | stone | yes | `sewers/wet-sewer-stone` |
| 2 | sewage water | water | yes | `sewers/sewage-water` |
| 3 | slimy brick floor | stone | no | `sewers/slimy-brick-floor` |
| 4 | mossy drainage stone | stone | yes | `sewers/mossy-drainage-stone` |

### Ruins (`ruins`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | broken column piece | 1 x 1 | cover |  | low | circle | rubble | yes |
| 2 | props | fallen statue hand | 1 x 1 | cover |  | low | circle | rubble |  |
| 3 | props | cracked tile | 1 x 1 | none |  | flat | rect | rubble |  |
| 4 | props | vine-covered rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 5 | props | ancient urn | 1 x 1 | cover |  | low | circle | barrel |  |
| 6 | props | rubble | 1 x 1 | cover |  | low | circle | rubble | yes |
| 7 | props | crumbled wall stub | 1 x 1 | cover |  | low | circle | rubble |  |
| 8 | props | mossy brick pile | 1 x 1 | cover |  | low | circle | rubble | yes |
| 9 | props | old coin pile | 1 x 1 | none |  | flat | circle | chest |  |
| 10 | props | rusted helmet | 1 x 1 | none |  | flat | circle | bones |  |
| 11 | props | bones | 1 x 1 | none |  | flat | circle | bones | yes |
| 12 | props | overgrown shrub | 1 x 1 | cover |  | low | circle | bush | yes |
| 13 | props | broken arch stone | 1 x 1 | cover |  | low | circle | rock |  |
| 14 | props | torn banner | 1 x 1 | none |  | flat | circle | rubble |  |
| 15 | props | ritual circle stone | 1 x 1 | cover |  | low | circle | rock |  |
| 16 | props | lizard | 1 x 1 | none |  | low | circle | rock |  |
| 1 | large | broken column | 2 x 2 | block |  | tall | circle | pillar | yes |
| 2 | large | fallen arch | 2 x 2 | cover |  | low | rect | rubble |  |
| 3 | large | overgrown statue | 2 x 2 | block |  | tall | circle | statue | yes |
| 4 | large | ruined wall corner | 2 x 2 | block |  | tall | rect | pillar |  |
| 5 | large | collapsed tower base | 2 x 2 | block |  | tall | circle | boulder |  |
| 6 | large | ancient altar | 2 x 2 | cover |  | low | rect | table |  |
| 7 | large | tree growing through stone | 2 x 2 | block |  | tall | circle | tree (dark) | yes |
| 8 | large | broken fountain | 2 x 2 | cover |  | low | circle | statue |  |
| 9 | large | stone stairs leading nowhere | 2 x 2 | cover |  | low | rect | rubble |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | cracked ancient flagstones | stone | no | `ruins/cracked-ancient-flagstones` |
| 2 | overgrown stone | stone | yes | `ruins/overgrown-stone` |
| 3 | mossy rubble ground | dirt | yes | `ruins/mossy-rubble-ground` |
| 4 | sand-covered tiles | sand | no | `ruins/sand-covered-tiles` |

### Mushroom cavern (Underdark) (`mushroom-cavern`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | glowing blue mushroom | 1 x 1 | none | **faintglow** | low | circle | mushroom |  |
| 2 | props | glowing purple mushroom | 1 x 1 | none | **faintglow** | low | circle | mushroom |  |
| 3 | props | spore puff | 1 x 1 | none |  | low | circle | mushroom | yes |
| 4 | props | luminous moss | 1 x 1 | none | **faintglow** | flat | circle | mushroom |  |
| 5 | props | crystal shard | 1 x 1 | none | **faintglow** | low | circle | crystal |  |
| 6 | props | underground beetle | 1 x 1 | none |  | low | circle | rock |  |
| 7 | props | rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 8 | props | mushroom stump | 1 x 1 | cover |  | low | circle | log |  |
| 9 | props | silk cocoon | 1 x 1 | cover |  | low | circle | barrel |  |
| 10 | props | dark pool | 1 x 1 | none |  | flat | circle | rock |  |
| 11 | props | bones | 1 x 1 | none |  | flat | circle | bones | yes |
| 12 | props | fungal spike | 1 x 1 | cover |  | low | circle | mushroom |  |
| 13 | props | glowing lichen | 1 x 1 | none | **faintglow** | flat | circle | mushroom |  |
| 14 | props | strange egg | 1 x 1 | cover |  | low | circle | barrel |  |
| 15 | props | drow lantern | 1 x 1 | none | **torch** | low | circle | torch | yes |
| 16 | props | cave fish | 1 x 1 | none |  | low | circle | rock |  |
| 1 | large | giant glowing mushroom | 2 x 2 | block | **faintglow** | tall | circle | mushroom |  |
| 2 | large | mushroom cluster | 2 x 2 | block |  | tall | circle | mushroom |  |
| 3 | large | giant crystal | 2 x 2 | block | **faintglow** | tall | circle | crystal |  |
| 4 | large | underground lake | 2 x 2 | none |  | flat | circle | rock |  |
| 5 | large | fungal tree | 2 x 2 | block |  | tall | circle | tree (pink) | yes |
| 6 | large | spider silk wall | 2 x 2 | block |  | tall | rect | pillar |  |
| 7 | large | obsidian rock | 2 x 2 | block |  | tall | circle | boulder | yes |
| 8 | large | chasm | 2 x 2 | none |  | flat | circle | rubble |  |
| 9 | large | ancient drow statue | 2 x 2 | block |  | tall | circle | statue | yes |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | dark cave floor | cave | yes | `mushroom-cavern/dark-cave-floor` |
| 2 | glowing moss floor | cave | yes | `mushroom-cavern/glowing-moss-floor` |
| 3 | fungal carpet | cave | yes | `mushroom-cavern/fungal-carpet` |
| 4 | black underground water | water | yes | `mushroom-cavern/black-underground-water` |

### Volcanic (`volcanic`)

| # | Sheet | Name | Size | Sight | Light | Shadow | Footprint | Classic look | Stands in |
|---|---|---|---|---|---|---|---|---|---|
| 1 | props | lava rock | 1 x 1 | cover |  | low | circle | rock | yes |
| 2 | props | steam vent | 1 x 1 | none |  | flat | circle | rubble |  |
| 3 | props | obsidian shard | 1 x 1 | none |  | low | circle | crystal | yes |
| 4 | props | fire salamander | 1 x 1 | none |  | low | circle | rock |  |
| 5 | props | scorched bones | 1 x 1 | none |  | flat | circle | bones | yes |
| 6 | props | sulphur crystal | 1 x 1 | none |  | low | circle | crystal | yes |
| 7 | props | ember pile | 1 x 1 | none | **faintglow** | flat | circle | rubble |  |
| 8 | props | cracked basalt | 1 x 1 | cover |  | low | circle | rock | yes |
| 9 | props | smoking crater | 1 x 1 | none |  | flat | circle | rubble |  |
| 10 | props | charred stump | 1 x 1 | cover |  | low | circle | log |  |
| 11 | props | magma bubble | 1 x 1 | none | **faintglow** | flat | circle | rubble |  |
| 12 | props | fire opal | 1 x 1 | none |  | flat | circle | crystal | yes |
| 13 | props | ash pile | 1 x 1 | none |  | flat | circle | rubble |  |
| 14 | props | burning brazier | 1 x 1 | none | **torch** | low | circle | torch | yes |
| 15 | props | broken chain | 1 x 1 | none |  | flat | circle | bones |  |
| 16 | props | heat-cracked shield | 1 x 1 | none |  | flat | circle | bones |  |
| 1 | large | lava pool | 2 x 2 | none | **faintglow** | flat | circle | rock |  |
| 2 | large | obsidian spire | 2 x 2 | block |  | tall | circle | pillar | yes |
| 3 | large | volcanic boulder | 2 x 2 | block |  | tall | circle | boulder | yes |
| 4 | large | fire geyser | 2 x 2 | none | **faintglow** | low | circle | rubble |  |
| 5 | large | basalt column cluster | 2 x 2 | block |  | tall | circle | pillar | yes |
| 6 | large | scorched tree | 2 x 2 | none |  | tall | circle | deadtree | yes |
| 7 | large | lava bridge | 2 x 1 | none | **faintglow** | flat | rect | log |  |
| 8 | large | dragon bones | 2 x 2 | cover |  | low | circle | bones |  |
| 9 | large | forge of the fire giants | 2 x 2 | block | **campfire** | tall | rect | campfire |  |

| # | Texture | Terrain class | Rotatable | Key |
|---|---|---|---|---|
| 1 | black volcanic rock | stone | yes | `volcanic/black-volcanic-rock` |
| 2 | glowing lava | lava | yes | `volcanic/glowing-lava` |
| 3 | ash ground | dirt | yes | `volcanic/ash-ground` |
| 4 | cracked basalt | stone | yes | `volcanic/cracked-basalt-terrain` |
