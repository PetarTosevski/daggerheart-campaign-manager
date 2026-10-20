# Sprite sheet prompts (for Nano Banana)

Sprite packs replace the combat map painter's drawn objects and terrain with images. Instead of one prompt per
sprite, each prompt asks for a **sheet**: a grid of separate sprites on one image. A script cuts a sheet into
single sprites (by finding each object on the flat background, so a slightly uneven grid is fine) and names
them in the order the prompt lists them. The upload screen shows every cut sprite with its name, so a wrong one
can be fixed by hand.

Status: prompts only. The cutter, the pack format, GM uploads and the painter using the sprites are planned
work (bd: sprite packs), not built yet.

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

## Settings

Each setting has three sheets. Lists are in grid order (left to right, top to bottom).

### forest
- props: bush · fern clump · mushroom ring · tree stump · small rock · mossy log (short) · berry bush · flower patch · thorn bramble · hollow log · animal carcass · bird's nest on the ground · woodcutter's axe in a stump · signpost · small pond · rabbit burrow
- large: oak tree · pine tree · birch tree · dead tree · giant mushroom · autumn maple tree · thick hedge · hunter's lean-to · ancient tree with roots
- terrain: forest floor with leaves · moss · tall grass · muddy path

### grassland and road
- props: milestone · wildflowers · haystack (small) · fence post · rock · shrub · wooden gate · scarecrow · beehive · trough · roadside shrine · grave marker · broken cart wheel · picnic blanket · rabbit · crow
- large: lone oak tree · haystack · windmill base · wooden bridge (two squares) · farmhouse corner · standing stones (pair) · watchtower base · orchard tree · stone wall section
- terrain: meadow grass · dirt road · wheat field · trampled grass

### mountain and cliffs
- props: loose rocks · mountain goat · cairn · snowy rock · climbing rope with piton · cracked boulder · mountain shrub · eagle nest · old campsite · broken pickaxe · ice patch · crystal outcrop · bones of a climber · rope bridge anchor · lookout flag · tiny pine
- large: cliff edge rock · large boulder pair · rock spire · cave mouth · pine trees (pair) · rockslide · rope bridge (two squares) · stone stair · giant's skull
- terrain: rocky ground · scree and gravel · bare granite · alpine grass

### cave
- props: stalagmite · glowing mushroom cluster · cave crystal · rock pile · puddle · bat colony (hanging) · bones · old campfire · ore vein · spider web · small stalagmite pair · fungus patch · cave lizard · lost backpack · rock column (thin) · dripping water pool
- large: rock column · underground pool · giant crystal cluster · chasm crack · giant spider web · rock wall chunk · mushroom grove · collapsed tunnel · ancient altar stone
- terrain: cave floor stone · wet cave rock · cave gravel · underground water (shallow)

### dungeon
- props: stone pillar (small) · iron cage · chains on the floor · lever · pressure plate · wooden door (closed) · portcullis section · torture rack · prisoner bench · trapdoor · spike trap · broken shackles · rat · candle cluster · urn · bloodstain
- large: thick stone pillar · iron maiden · cell with bars · throne · stone sarcophagus · collapsed wall · large pit · stone stair down · altar with candles
- terrain: dungeon flagstones · mossy stone floor · cracked stone · dirt and straw floor

### crypt and graveyard
- props: gravestone · cracked gravestone · candle cluster · skull pile · urn · coffin (closed) · coffin (open) · wilted flowers · lantern on a post · spiderweb · bones · grave mound · broken statue head · holy symbol · iron fence section · raven
- large: mausoleum corner · stone sarcophagus · open grave · dead tree · angel statue · crypt gate · bone pile · ossuary shelf · catacomb niche wall
- terrain: crypt flagstones · graveyard grass · grave dirt · dusty tomb floor

### castle interior
- props: banner stand · suit of armour · candelabra · ornate chair · small table with goblet · rug (small) · fireplace grate · weapon display · tapestry rolled · footstool · chest · chamber pot · map table (small) · harp · statue bust · floor brazier
- large: throne on a dais · long dining table · four-poster bed · grand fireplace · great rug · staircase · stone column · armoury rack · library desk
- terrain: polished stone floor · red carpet · wooden floorboards · marble tiles

### tavern
- props: tavern table with mugs · stool · barrel tap · keg · chair · plate of food · tankard tray · broom · card game table · candle · coat rack · bard's lute · drunk patron asleep · cat · bucket · notice board
- large: bar counter (two squares) · hearth fireplace · long bench table · stage platform · stair up · kitchen stove · storeroom shelves · booth with benches · bed (inn room)
- terrain: tavern floorboards · worn planks · kitchen tiles · stone hearth floor

### town street and market
- props: market crate of apples · fish barrel · vegetable stall basket · street lamp · well bucket · bench · cart (handcart) · crate stack · pottery jars · bolt of cloth · sign post · trash pile · chicken · dog · rain barrel · flower box
- large: market stall with awning · fountain · town well · statue on a plinth · house corner · blacksmith forge · wagon · large tree in a planter · guard post
- terrain: cobblestones · town square flagstones · muddy street · market plaza tiles

### temple
- props: candle stand · offering bowl · prayer mat · incense burner · holy book on a lectern · bell · small statue · flower offering · font of holy water · pew (short) · relic box · banner of the faith · gong · prayer beads · urn of ashes · kneeler
- large: altar · great statue of a god · pew row · stone column · sacred pool · bell tower base · stained-glass light pattern · reliquary · priest's dais
- terrain: temple marble · mosaic floor · stone tiles with runes · polished wood

### swamp
- props: reeds · lily pads · rotten stump · bog mushroom · will-o'-wisp light · frog · mossy rock · bones in mud · sunken barrel · hanging moss · cattails · snake · broken boat plank · witch's charm totem · insect swarm · bubbling mud
- large: mangrove tree · dead swamp tree · stilt hut corner · sunken rowboat · bog pool · giant lily pad · rotting log · witch's cauldron · broken boardwalk (two squares)
- terrain: swamp mud · murky shallow water · bog grass · rotting boardwalk planks

### snow and tundra
- props: snowy rock · ice chunk · snowman · frozen bush · animal tracks · snowy log · ice spike · campfire in snow · fur bedroll · sled · frozen corpse · wolf · snowdrift · broken spear in ice · snowy signpost · icicle cluster
- large: snowy pine tree · frozen lake hole · ice formation · igloo · snowy boulder · mammoth skeleton · frozen waterfall base · snow-covered tent · ice cave mouth
- terrain: fresh snow · packed snow · ice · frozen tundra grass

### desert
- props: cactus · desert rock · sun-bleached skull · dry bush · scorpion · clay jar · rug · water skin · sand dune ripple · bones · broken pottery · palm sapling · tent stake and rope · campfire · desert snake · ancient tablet
- large: palm tree · oasis pool · sandstone pillar · desert tent · camel · ruined obelisk · giant skeleton ribs · sand dune · merchant's caravan wagon
- terrain: desert sand · cracked dry earth · sandstone floor · rocky desert

### coast and beach
- props: seashell · crab · driftwood · rowboat oar · fishing net · rock with seaweed · tide pool · sandcastle · seagull · rope post · barrel washed ashore · anchor · message bottle · beach grass · starfish · broken crate
- large: rowboat · wooden pier section · palm tree · large sea rock · shipwreck piece · fishing hut corner · lighthouse base · sea cave mouth · beached whale bones
- terrain: beach sand · wet sand · shallow sea water · rocky shore

### ship deck
- props: deck cannon · coil of rope · barrel · crate · ship's wheel · anchor · bucket and mop · cargo net · hatch (closed) · hatch (open) · lantern on a hook · sea chest · rigging pulley · parrot · cannonballs pile · harpoon
- large: mast with sail shadow · captain's table · capstan · lifeboat · cargo stack · stairs below deck · cannon pair · ship's bow · ship's stern cabin corner
- terrain: deck planks · wet deck planks · below-deck floor · dark sea water

### sewers
- props: grate · rat · sewage puddle · pipe outlet · broken crate · ladder up · lost dagger · fungus patch · bones · rusty chain · valve wheel · sludge pile · candle stub · bucket · torn sack · eel
- large: sewer channel (two squares) · arched tunnel mouth · cistern · collapsed pipe · rat nest · stone bridge over channel · thieves' hideout corner · iron gate · flooded chamber
- terrain: wet sewer stone · sewage water · slimy brick floor · mossy drainage stone

### ruins
- props: broken column piece · fallen statue hand · cracked tile · vine-covered rock · ancient urn · rubble · crumbled wall stub · mossy brick pile · old coin pile · rusted helmet · bones · overgrown shrub · broken arch stone · torn banner · ritual circle stone · lizard
- large: broken column · fallen arch · overgrown statue · ruined wall corner · collapsed tower base · ancient altar · tree growing through stone · broken fountain · stone stairs leading nowhere
- terrain: cracked ancient flagstones · overgrown stone · mossy rubble ground · sand-covered tiles

### mushroom cavern (underdark)
- props: glowing blue mushroom · glowing purple mushroom · spore puff · luminous moss · crystal shard · underground beetle · rock · mushroom stump · silk cocoon · dark pool · bones · fungal spike · glowing lichen · strange egg · drow lantern · cave fish
- large: giant glowing mushroom · mushroom cluster · giant crystal · underground lake · fungal tree · spider silk wall · obsidian rock · chasm · ancient drow statue
- terrain: dark cave floor · glowing moss floor · fungal carpet · black underground water

### volcanic
- props: lava rock · steam vent · obsidian shard · fire salamander · scorched bones · sulphur crystal · ember pile · cracked basalt · smoking crater · charred stump · magma bubble · fire opal · ash pile · burning brazier · broken chain · heat-cracked shield
- large: lava pool · obsidian spire · volcanic boulder · fire geyser · basalt column cluster · scorched tree · lava bridge · dragon bones · forge of the fire giants
- terrain: black volcanic rock · glowing lava · ash ground · cracked basalt

## Your own uploads

GMs will be able to upload sheets and single sprites too: the same rules apply (top-down, flat magenta or
transparent background, one object per cell). The upload screen cuts the sheet, lets you name each sprite,
set its size in squares and say whether it blocks sight, is cover or gives light.
