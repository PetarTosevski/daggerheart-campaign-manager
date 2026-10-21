# Sprite sheet prompts (for Nano Banana)

Sprite packs replace the combat map painter's drawn objects and terrain with images. Instead of one prompt per
sprite, each prompt asks for a **sheet**: a grid of separate sprites on one image. A script cuts a sheet into
single sprites (by finding each object on the flat background, so a slightly uneven grid is fine) and names
them in the order the prompt lists them. The upload screen shows every cut sprite with its name, so a wrong one
can be fixed by hand.

Status: the cutter is built and the 60 sheets are imported as the built-in packs (tracer P4,
docs/tasks/TASK-SP-P4.md). GM uploads and the painter using the sprites are planned work (bd: sprite packs).

### Cutter and built-in packs

- `pnpm sprites:cut [--src <dir>] [--setting <folder>]...` cuts the sheets (default `--src` is
  `/mnt/c/Users/Petar/sprite-sheets`; `.jpg`, `.png` or `.webp`), names the cuts in the order the lists below
  give them and writes a review to `sprite-sheets/_out/` (git-ignored): `report.html`, `summary.txt`, a contact
  sheet per folder (`contact-<folder>.png`, every sprite on a checkerboard with its name, size, sight, light and
  the app's shadow; every terrain tiled 3 × 3) and `contact-overall.png`. Nothing in the repo changes.
- `pnpm sprites:build` with the same arguments writes `public/sprite-packs/<folder>/<slug>.<hash>.webp`
  (objects 160 px per square, terrain 512 px per swatch, seam-fixed) and
  `src/lib/sprite-packs/builtin/manifest.ts`. Commit both. Never commit the sheets.
- **Regenerate one sheet:** save the new sheet over the old one, run `pnpm sprites:cut --setting <folder>`,
  check `sprite-sheets/_out/contact-<folder>.png`, then `pnpm sprites:build --setting <folder>`. Only that
  folder's files and manifest entries change; keys (`<folder>/<slug>`) stay, so placed objects keep working.
- **Fixes the cutter cannot decide** go in `scripts/sprite-packs/overrides.json` (format in
  `scripts/sprite-packs/lib/overrides.ts`): skip a cut, reorder, name an extra cut as a numbered variant of an
  item, remove a pink glow (`unpink`), keep thin web strands (`unmix`), turn an opaque pink-tinted fill
  inside given areas warm grey-brown (`untint`), rotate a long item drawn upright. A
  `when: {found: n}` override applies only while the cutter finds n cuts, and `when: {sha256: "<prefix>"}` only to
  the sheet file with that hash, so it goes quiet on a regenerated sheet.
  The cut indices are 0-based (the report's #n is index n-1).
- **Extra sheets:** a file named `<props|large|terrain>-<anything>` (e.g. `town-street-and-market/large-2.jpg`)
  is cut too when present. New items on it are new catalog items (own keys and traits), not variants: add a line
  `- large-2: cottage · garden fence · …` under the setting below and the same names, in reading order, under
  `extras: { "large-2": [...] }` in `src/lib/sprite-packs/catalog/<folder>.ts`; the cutter then names the sheet's
  cuts from that list. `overrides.json` can still name a cut as a numbered variant of an existing item; any other
  cut is listed in the report as unassigned. Extra sheets today: `town-street-and-market/large-2` (the village,
  tracer P4V, docs/tasks/TASK-SP-P4V.md) and batch 2 (docs/sprite-packs/batch-2.md, tracers P11A-C and P11Z):
  `props-2`, `large-2` (the town's `large-3`) and `terrain-2` in every folder, 1,169 sprites in all. Items on an
  extra sheet may be any size up to 4 x 4. Extra-sheet textures join the Classic terrain mapping after the
  primary ones (docs/tasks/TASK-SP-P11Z.md, "Textures").
- **Tolerances:** a flat outer frame of any colour around a terrain sheet (the white one) is found and cut off,
  a plain magenta outer frame too (P11Z), and the swatches are inset past the JPEG bleed; thin drawn grid lines (up to about 12 px at 2048) are removed
  before cutting, and dark-magenta grid lines key out with the background. Soft glows and smoke over magenta keep
  a pink aura; `unpink` removes it per sprite (never on purple objects).

## How to run them

- Use the best image model you have (Nano Banana Pro if available) at the largest square size it offers
  (2048 × 2048 or more). Bigger sheets give sharper sprites: a 4 × 4 sheet at 2048 px is 512 px per cell.
- Paste the **style block** at the end of every prompt, unchanged. It keeps every sheet in one style.
- One prompt per sheet. Regenerate a sheet until every cell is filled, nothing overlaps another cell, and the
  background is flat magenta.
- Save each sheet as `sprite-sheets/<setting>/<sheet>.png` in the project folder (git-ignored: raw sheets are
  never committed), for example `sprite-sheets/forest/props.png`, `sprite-sheets/forest/large.png`,
  `sprite-sheets/forest/terrain.png`. Keep the names: the cutter reads the setting and the sheet type from them.
  Folder names are the setting names below in lower case with hyphens (`common`, `grassland-and-road`,
  `town-street-and-market`, `mushroom-cavern`, …); the folders already exist.
- Scale: one map square is 5 ft. On a props sheet each object fills about one square; on a large sheet about
  two by two squares. Keep that in mind if you write your own lists.

## Style block (paste into every prompt)

```
Style: top-down orthographic view, looking straight down from above (no perspective, no isometric angle, no
side view). Generic fantasy tabletop battle-map art: hand-painted, clean dark outlines, soft painterly
shading, rich but natural colours, light coming from the top-left. Every object is fully visible and isolated
on a perfectly flat, solid magenta background (#FF00FF): no ground under it, no grass, no texture, no
gradient, no vignette, and no cast shadow (shadows are added later). No text, no letters, no numbers, no
labels, no grid lines, no borders, no frames. Each object sits in the middle of its own cell with a wide
margin of empty magenta around it; nothing touches or overlaps a neighbouring cell. All objects on the sheet
are drawn at the same scale.
```

## Sheet templates

**Props (16 one-square objects)**

```
A game sprite sheet: 16 separate props arranged in an even 4 × 4 grid, one prop per cell, read left to right,
top to bottom.
Row 1: <a>, <b>, <c>, <d>.
Row 2: <e>, <f>, <g>, <h>.
Row 3: <i>, <j>, <k>, <l>.
Row 4: <m>, <n>, <o>, <p>.
Square image.
<style block>
```

**Large objects (9 two-by-two-square objects)**

```
A game sprite sheet: 9 separate large objects arranged in an even 3 × 3 grid, one object per cell, read left
to right, top to bottom. Each object nearly fills its cell but keeps a margin of empty magenta.
Row 1: <a>, <b>, <c>.
Row 2: <d>, <e>, <f>.
Row 3: <g>, <h>, <i>.
Square image.
<style block>
```

**Terrain (4 seamless ground textures)**

Terrain is different: each cell is a full square swatch of ground, edge to edge, with no objects. Use this
instead of the style block's "isolated object" lines:

```
A sheet of 4 square ground textures for a top-down fantasy battle map, arranged in a 2 × 2 grid with a thin
solid magenta (#FF00FF) gap between the squares. Each square is filled edge to edge with one ground surface
seen from straight above, evenly lit, with no objects, no shadows, no paths crossing it and no border. Each
texture must tile seamlessly: its left edge continues into its right edge and its top edge into its bottom
edge. Hand-painted generic fantasy tabletop style, soft painterly detail, natural colours. No text, no grid.
Top left: <a>. Top right: <b>. Bottom left: <c>. Bottom right: <d>.
Square image.
```

## Shared sheets (every setting uses these)

`common/props`
1. wooden crate · 2. barrel · 3. treasure chest (closed) · 4. treasure chest (open, coins inside)
5. sack of grain · 6. small round table · 7. wooden chair · 8. bedroll
9. campfire (burning) · 10. campfire (burnt out, ashes) · 11. standing torch (lit) · 12. iron brazier (lit)
13. pile of rubble · 14. scattered bones and a skull · 15. weapon rack with swords and spears · 16. coil of rope and a lantern

`common/large`
1. covered wagon · 2. hay cart · 3. long feast table with benches · 4. bookshelf (seen from above, two squares wide)
5. canvas tent (closed) · 6. large boulder · 7. fallen tree trunk · 8. stone well · 9. broken statue lying on its side

`common/terrain`
grass · packed dirt · cobblestone road · flagstone floor

`common/props-2`
1. leather backpack · 2. quiver of arrows · 3. round wooden shield · 4. dropped longsword
5. spilled coin pouch · 6. cluster of potion bottles · 7. open spellbook · 8. pile of scrolls
9. cooking pot on a tripod · 10. bundle of firewood · 11. oil lamp · 12. small iron lockbox
13. rolled-up carpet · 14. tool bag with a hammer · 15. bear trap (open) · 16. wooden bucket of water

`common/large-2`
1. saddled horse · 2. ox · 3. wooden palisade section · 4. campsite with two bedrolls
5. supply dump of crates, sacks and barrels · 6. glowing magic circle on the ground · 7. wooden barricade with spikes
8. dragon's hoard (heap of gold coins) · 9. stone portal arch

`common/terrain-2`
gravel · dry yellow grass · pebbled ground · trampled mud

## Settings

Each setting has three sheets, plus the batch-2 extra sheets (`props-2`, `large-2` or `large-3`, `terrain-2`). Lists are in grid order (left to right, top to bottom).

### forest
- props: bush · fern clump · mushroom ring · tree stump · small rock · mossy log (short) · berry bush · flower patch · thorn bramble · hollow log · animal carcass · bird's nest on the ground · woodcutter's axe in a stump · signpost · small pond · rabbit burrow
- props-2: fox · deer · brown bear · owl perched on a stump · fallen branch · pile of pinecones · log with bracket fungus · ivy-covered stone · hunting snare · shed deer antlers · wild beehive in a hollow log · small druid standing stone · stepping stones in a stream · forest spring · wild garlic patch · woodland shrine with offerings
- large: oak tree · pine tree · birch tree · dead tree · giant mushroom · autumn maple tree · thick hedge · hunter's lean-to · ancient tree with roots
- large-2: weeping willow tree · ancient yew tree · elven tree-house platform · forest stream bend · archway of living branches · sapling thicket · druid stone circle · giant hollow stump with steps · woodcutter's log pile
- terrain: forest floor with leaves · moss · tall grass · muddy path
- terrain-2: pine needles · fern undergrowth · red autumn leaves · forest stream pebbles

### grassland and road
- props: milestone · wildflowers · haystack (small) · fence post · rock · shrub · wooden gate · scarecrow · beehive · trough · roadside shrine · grave marker · broken cart wheel · picnic blanket · rabbit · crow
- props-2: sheep · cow · pig · goose · sheaf of wheat · milk churn · pitchfork and rake · wheelbarrow · butter churn · sunflower patch · molehill · rectangular hay bale · hand water pump · cabbage patch · stone sundial · stone birdbath
- large: lone oak tree · haystack · windmill base · wooden bridge (two squares) · farmhouse corner · standing stones (pair) · watchtower base · orchard tree · stone wall section
- large-2: duck pond · windmill with sails · sheep pen · stone arch bridge over a brook · vineyard rows · ploughed field strip · granary · horse stable · ox-drawn plough
- terrain: meadow grass · dirt road · wheat field · trampled grass
- terrain-2: ploughed soil · clover meadow · flower meadow · cart-rutted road

### mountain and cliffs
- props: loose rocks · mountain goat · cairn · snowy rock · climbing rope with piton · cracked boulder · mountain shrub · eagle nest · old campsite · broken pickaxe · ice patch · crystal outcrop · bones of a climber · rope bridge anchor · lookout flag · tiny pine
- props-2: ram with curled horns · mountain lion · marmot · edelweiss patch · slate slab · dwarven rune stone · mine cart on rails · abandoned tent · climber's backpack · avalanche debris · lichen-covered rock · small waterfall pool · wind-bent juniper · dwarven lantern · hawk perched on a rock · line of prayer flags
- large: cliff edge rock · large boulder pair · rock spire · cave mouth · pine trees (pair) · rockslide · rope bridge (two squares) · stone stair · giant's skull
- large-2: dwarven mountain-pass gate · griffon nest · waterfall over a cliff · timber-framed mine entrance · giant eagle · hot spring pool · monastery wall corner · giant dwarven statue head · wooden scaffold walkway
- terrain: rocky ground · scree and gravel · bare granite · alpine grass
- terrain-2: slate ledge · mountain moss · rock with snow patches · frosty grass

### cave
- props: stalagmite · glowing mushroom cluster · cave crystal · rock pile · puddle · bat colony (hanging) · bones · old campfire · ore vein · spider web · small stalagmite pair · fungus patch · cave lizard · lost backpack · rock column (thin) · dripping water pool
- props-2: giant spider · giant centipede · kobold · goblin totem · pick and shovel · kobold snare trap · slab with cave paintings · glowworm cluster · small sinkhole · guano pile · rope ladder going down · miner's helmet with a candle · broken lantern · geode cut open · fallen stalactite · cave moth
- large: rock column · underground pool · giant crystal cluster · chasm crack · giant spider web · rock wall chunk · mushroom grove · collapsed tunnel · ancient altar stone
- large-2: goblin camp · mine-cart track junction · stone ledge over a chasm · cave bear den · underground waterfall · dwarven door in the rock · cave troll · giant stalactite cluster · giant worm burrow
- terrain: cave floor stone · wet cave rock · cave gravel · underground water (shallow)
- terrain-2: muddy cave floor · limestone flowstone · crystal-flecked rock · bat guano ground

### dungeon
- props: stone pillar (small) · iron cage · chains on the floor · lever · pressure plate · wooden door (closed) · portcullis section · torture rack · prisoner bench · trapdoor · spike trap · broken shackles · rat · candle cluster · urn · bloodstain
- props-2: mimic chest with teeth · key ring on a hook · iron ball and chain · executioner's block with axe · stocks · straw pile · poison dart trap · glowing glyph trap · collapsed skeleton · wooden door (open) · wall manacles · guards' dice table · cauldron of gruel · rat swarm · dripping slime puddle · iron floor grating
- large: thick stone pillar · iron maiden · cell with bars · throne · stone sarcophagus · collapsed wall · large pit · stone stair down · altar with candles
- large-2: gelatinous cube · minotaur · guard-room table with chairs · torture wheel · spiked pit trap · round vault door · stone golem · row of three prison cells · spiral staircase
- terrain: dungeon flagstones · mossy stone floor · cracked stone · dirt and straw floor
- terrain-2: wet flagstones · bloodstained stone · iron grating floor · rubble-strewn floor

### crypt and graveyard
- props: gravestone · cracked gravestone · candle cluster · skull pile · urn · coffin (closed) · coffin (open) · wilted flowers · lantern on a post · spiderweb · bones · grave mound · broken statue head · holy symbol · iron fence section · raven
- props-2: zombie · skeleton rising from the ground · ghost · gravedigger's shovel and pick · memorial wreath · celtic cross headstone · small obelisk headstone · wooden grave marker · cracked tomb slab · black cat · canopic jars · shrouded corpse on a bier · ghostly blue candle · coffin lid on the ground · iron grave cage · offering of coins
- large: mausoleum corner · stone sarcophagus · open grave · dead tree · angel statue · crypt gate · bone pile · ossuary shelf · catacomb niche wall
- large-2: small mausoleum (whole roof) · necromancer's altar · bone throne · gravedigger's hut · wraith · row of headstones · embalming table · crypt staircase going down · cracked-open tomb
- terrain: crypt flagstones · graveyard grass · grave dirt · dusty tomb floor
- terrain-2: bone-strewn floor · overgrown graveyard path · ash and dust · dead grass

### castle interior
- props: banner stand · suit of armour · candelabra · ornate chair · small table with goblet · rug (small) · fireplace grate · weapon display · tapestry rolled · footstool · chest · chamber pot · map table (small) · harp · statue bust · floor brazier
- props-2: hunting hound · heraldic shield · chess table · wash basin on a stand · small writing desk · globe on a stand · wine rack · folding dressing screen · birdcage · potted fern · spinning wheel · crown on a velvet cushion · serving trolley with food · wooden bathing tub · wardrobe · reading chair with a candle
- large: throne on a dais · long dining table · four-poster bed · grand fireplace · great rug · staircase · stone column · armoury rack · library desk
- large-2: copper bathtub with a screen · kitchen hearth with a roasting spit · war table with a campaign map · pipe organ · gatehouse portcullis · pair of knight statues · ballista · treasury strongboxes · battlement wall with crenellations
- terrain: polished stone floor · red carpet · wooden floorboards · marble tiles
- terrain-2: blue royal carpet · rush-strewn flagstones · oak parquet · battlement stone

### tavern
- props: tavern table with mugs · stool · barrel tap · keg · chair · plate of food · tankard tray · broom · card game table · candle · coat rack · bard's lute · drunk patron asleep · cat · bucket · notice board
- props-2: arm-wrestling table · dice game on a barrelhead · cheese wheel · bread basket · broken chair · spittoon · chopping board with a cleaver · pot of stew · washtub of dishes · sack of potatoes · crate of wine bottles · overturned table · hearth rug · bard's hand drum · small round table for two · crock of pickles
- large: bar counter (two squares) · hearth fireplace · long bench table · stage platform · stair up · kitchen stove · storeroom shelves · booth with benches · bed (inn room)
- large-2: wine cellar rack · brewing copper and vats · large round table with chairs · gambling table · guest bathtub · pair of fireside armchairs · inn stable stall with a horse · cellar trapdoor with stairs · back-bar shelves with bottles
- terrain: tavern floorboards · worn planks · kitchen tiles · stone hearth floor
- terrain-2: stone cellar floor · straw-covered floor · sawdust floor · dark oak planks

### town street and market
- props: market crate of apples · fish barrel · vegetable stall basket · street lamp · well bucket · bench · cart (handcart) · crate stack · pottery jars · bolt of cloth · sign post · trash pile · chicken · dog · rain barrel · flower box
- props-2: hitching post · street vendor's tray · laundry line · spice sacks · flock of pigeons · cobbler's bench · beggar's bowl and mat · lamplighter's ladder · topiary bush · flower cart · rolled rugs · caged songbirds · street drain · baker's display table · market scales · town crier's bell
- large: market stall with awning · fountain · town well · statue on a plinth · house corner · blacksmith forge · wagon · large tree in a planter · guard post
- large-3: townhouse (whole roof) · shop with an awning (whole building) · town gate with two towers · clock tower · covered market hall · stable block · tannery vats · gallows platform · canal with a footbridge
- large-2: thatched cottage · stone cottage · timber barn · wooden fence section · wooden fence gate · vegetable garden plot · haystack · woodpile with chopping block · chicken coop with fenced run
- terrain: cobblestones · town square flagstones · muddy street · market plaza tiles
- terrain-2: brick road · dirt alley · mossy cobblestones · canal water

### temple
- props: candle stand · offering bowl · prayer mat · incense burner · holy book on a lectern · bell · small statue · flower offering · font of holy water · pew (short) · relic box · banner of the faith · gong · prayer beads · urn of ashes · kneeler
- props-2: kneeling monk · hanging censer · scroll shelf · prayer wheel · votive candle rack · alms box · eternal flame bowl · ceremonial dagger on a cushion · golden chalice · guardian lion statue · lotus bowl · meditation cushion · ritual drum · crystal orb on a stand · small sword in a stone · tithe chest
- large: altar · great statue of a god · pew row · stone column · sacred pool · bell tower base · stained-glass light pattern · reliquary · priest's dais
- large-2: cloister garden · lotus pond · choir stalls · temple entrance steps · great brass bell · raked sand garden · oracle's smoking tripod · sun-disc altar · colonnade
- terrain: temple marble · mosaic floor · stone tiles with runes · polished wood
- terrain-2: gold-inlaid floor · purple prayer carpet · sandstone temple floor · white gravel

### swamp
- props: reeds · lily pads · rotten stump · bog mushroom · will-o'-wisp light · frog · mossy rock · bones in mud · sunken barrel · hanging moss · cattails · snake · broken boat plank · witch's charm totem · insect swarm · bubbling mud
- props-2: alligator · giant leech · heron · turtle on a log · crayfish trap · fishing pole in the mud · skull lantern on a stick · stack of peat bricks · mooring post with rope · carnivorous plant · sunken statue head · wicker eel trap · hand reaching from the mud · swamp orchid · dead fish · half-sunken chest
- large: mangrove tree · dead swamp tree · stilt hut corner · sunken rowboat · bog pool · giant lily pad · rotting log · witch's cauldron · broken boardwalk (two squares)
- large-2: witch's hut on stilts (whole) · swamp troll · boardwalk junction · flat-bottomed punt · cypress tree with knees · skull shrine · giant carnivorous plant · sunken stone arch · bubbling tar pit
- terrain: swamp mud · murky shallow water · bog grass · rotting boardwalk planks
- terrain-2: duckweed water · peat bog · wet reed bed · algae-green mud

### snow and tundra
- props: snowy rock · ice chunk · snowman · frozen bush · animal tracks · snowy log · ice spike · campfire in snow · fur bedroll · sled · frozen corpse · wolf · snowdrift · broken spear in ice · snowy signpost · icicle cluster
- props-2: arctic fox · snowy owl · seal · ice-fishing hole with a rod · frozen treasure chest · pair of snowshoes · sword frozen in ice · frost crystal · frozen lantern · wooden skis · dropped fur cloak · mammoth tusk · frosted barrel · ice sculpture · snow hare · small frozen pond
- large: snowy pine tree · frozen lake hole · ice formation · igloo · snowy boulder · mammoth skeleton · frozen waterfall base · snow-covered tent · ice cave mouth
- large-2: polar bear · yeti · reindeer · longhouse (whole roof) · dog sled team · frozen ship's bow · ice bridge · glacier crevasse · frost giant frozen in ice
- terrain: fresh snow · packed snow · ice · frozen tundra grass
- terrain-2: blue glacier ice · wind-swept snow · slush · frozen gravel

### desert
- props: cactus · desert rock · sun-bleached skull · dry bush · scorpion · clay jar · rug · water skin · sand dune ripple · bones · broken pottery · palm sapling · tent stake and rope · campfire · desert snake · ancient tablet
- props-2: vulture · scarab beetle · jackal · tumbleweed · prickly pear cactus · basket of dates · hookah · brass oil lamp · half-buried helmet · amphora · spice pile · weathered idol · quicksand patch · wind-carved rock · snake charmer's basket · saddle bags
- large: palm tree · oasis pool · sandstone pillar · desert tent · camel · ruined obelisk · giant skeleton ribs · sand dune · merchant's caravan wagon
- large-2: sphinx statue · mummy · giant sandworm emerging · bazaar pavilion · acacia tree · mesa rock · sunken tomb entrance · half-buried colossus head · desert shrine with pillars
- terrain: desert sand · cracked dry earth · sandstone floor · rocky desert
- terrain-2: red sand · salt flat · wind-rippled dunes · desert pebbles

### coast and beach
- props: seashell · crab · driftwood · rowboat oar · fishing net · rock with seaweed · tide pool · sandcastle · seagull · rope post · barrel washed ashore · anchor · message bottle · beach grass · starfish · broken crate
- props-2: lobster pot · fishing rod and tackle box · jellyfish · sea turtle · pelican · stranded octopus · coconut pile · fish drying rack · basket of clams · wooden buoy · seaweed pile · conch shell · open pearl oyster · coral chunk · sea urchins · tar bucket and brush
- large: rowboat · wooden pier section · palm tree · large sea rock · shipwreck piece · fishing hut corner · lighthouse base · sea cave mouth · beached whale bones
- large-2: boathouse · sea serpent coils · giant crab · sailing fishing boat · stone breakwater · dockside crane · mermaid on a rock · salt evaporation pans · sea-stack rock arch
- terrain: beach sand · wet sand · shallow sea water · rocky shore
- terrain-2: pebble beach · seaweed-covered rocks · coral reef shallows · tidal mudflat

### ship deck
- props: deck cannon · coil of rope · barrel · crate · ship's wheel · anchor · bucket and mop · cargo net · hatch (closed) · hatch (open) · lantern on a hook · sea chest · rigging pulley · parrot · cannonballs pile · harpoon
- props-2: spyglass on a chart · compass binnacle · ship's bell · hammock · powder keg · belaying-pin rack · bundle of signal flags · grappling hook with rope · crossed cutlasses · pile of caught fish · small galley stove · bilge pump · crate of rum bottles · folded pirate flag · swivel gun · tar barrel
- large: mast with sail shadow · captain's table · capstan · lifeboat · cargo stack · stairs below deck · cannon pair · ship's bow · ship's stern cabin corner
- large-2: crow's nest · kraken tentacles · ship's galley · mermaid figurehead · gangplank · rowing benches with oars · captain's cabin bed · grain heap in the cargo hold · brig cell
- terrain: deck planks · wet deck planks · below-deck floor · dark sea water
- terrain-2: tarred planks · sun-bleached deck · canvas sail laid flat · stormy sea water

### sewers
- props: grate · rat · sewage puddle · pipe outlet · broken crate · ladder up · lost dagger · fungus patch · bones · rusty chain · valve wheel · sludge pile · candle stub · bucket · torn sack · eel
- props-2: wererat · giant cockroach · green slime blob · lost boot · floating debris · rusted key · chalked thieves' mark · beggar's cooking pot · rag bedroll · open drain cover · pipe junction · mould on bricks · caged rat trap · dead rat · coins in the muck · smuggled bundle
- large: sewer channel crossing · arched tunnel mouth · cistern · collapsed pipe · rat nest · stone bridge over channel · thieves' hideout corner · iron gate · flooded chamber
- large-2: outflow waterfall · ooze pool · thieves' guild meeting table · forgotten shrine · sluice gate · smugglers' canal boat · pair of brick pillars · refuse heap · wererat den
- terrain: wet sewer stone · sewage water · slimy brick floor · mossy drainage stone
- terrain-2: rusty iron grating · algae-slick brick · murky green water · wet cobbled tunnel floor

### ruins
- props: broken column piece · fallen statue hand · cracked tile · vine-covered rock · ancient urn · rubble · crumbled wall stub · mossy brick pile · old coin pile · rusted helmet · bones · overgrown shrub · broken arch stone · torn banner · ritual circle stone · lizard
- props-2: giant snail · stone face carving · fallen shield · rusted sword in rubble · toppled brazier · scroll case · mosaic fragment · fallen roof beam · crumbling pedestal · fallen gargoyle · skeletal adventurer · explorer's camp kit · rotted chest · rune-carved stone shard · stone frog idol · wildflowers in cracks
- large: broken column · fallen arch · overgrown statue · ruined wall corner · collapsed tower base · ancient altar · tree growing through stone · broken fountain · stone stairs leading nowhere
- large-2: collapsed dome · amphitheatre seating section · giant stone hand · ruined library shelves · overgrown courtyard well · crumbling bridge · roofless chapel corner · ancient guardian construct · sunken plaza
- terrain: cracked ancient flagstones · overgrown stone · mossy rubble ground · sand-covered tiles
- terrain-2: cracked marble · root-split paving · vine-covered ground · weathered terracotta

### mushroom cavern (underdark)
- props: glowing blue mushroom · glowing purple mushroom · spore puff · luminous moss · crystal shard · underground beetle · rock · mushroom stump · silk cocoon · dark pool · bones · fungal spike · glowing lichen · strange egg · drow lantern · cave fish
- props-2: mushroom-folk sprout · glowing moth · giant slug · glowing fern · puffball cluster · rock with shelf fungus · glowing seed pods · mushroom stool · crystal flower · cave crab · dark elf crossbow · web-wrapped body · glowing water lily · fungal vine · orange ember-cap mushroom · spore pile
- large: giant glowing mushroom · mushroom cluster · giant crystal · underground lake · fungal tree · spider silk wall · obsidian rock · chasm · ancient drow statue
- large-2: mushroom house · circle of mushroom folk · underground river bend · giant fungus bridge · dark elf tent · crystal throne · giant puffball · curtain of glowing vines · spider-goddess shrine
- terrain: dark cave floor · glowing moss floor · fungal carpet · black underground water
- terrain-2: violet glowing moss · crystal-studded floor · spore-dust ground · wet obsidian

### volcanic
- props: lava rock · steam vent · obsidian shard · fire salamander · scorched bones · sulphur crystal · ember pile · cracked basalt · smoking crater · charred stump · magma bubble · fire opal · ash pile · burning brazier · broken chain · heat-cracked shield
- props-2: fire imp · lava crab · fire beetle · small lava stream · pumice rocks · puddle of molten gold · dragon egg · obsidian dagger · smouldering backpack · ash-covered body · smoking fissure · small fire elemental · red crystal cluster · slag heap · fire rune stone · burning bush
- large: lava pool · obsidian spire · volcanic boulder · fire geyser · basalt column cluster · scorched tree · lava bridge · dragon bones · forge of the fire giants
- large-2: sleeping red dragon · fire giant's throne · magma fall · obsidian archway · island in a lava lake · salamander nest · ash-buried house · giant brass brazier · lava tube opening
- terrain: black volcanic rock · glowing lava · ash ground · cracked basalt
- terrain-2: cooled ropy lava · red-hot cracked ground · sulphur crust · obsidian glass

## Your own uploads

GMs will be able to upload sheets and single sprites too: the same rules apply (top-down, flat magenta or
transparent background, one object per cell). The upload screen cuts the sheet, lets you name each sprite,
set its size in squares and say whether it blocks sight, is cover or gives light.
