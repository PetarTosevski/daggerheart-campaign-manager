/**
 * dcm-bxp.129: the Scene card's suggestion chips. A chip's `text` fills the whole description box (the GM can edit it).
 * - Per setting: approved by the user 2026-10-30, used verbatim from .omc/plans/scene-chips.md (four per setting).
 * - Per frame: user 2026-10-30 asked for 4-6 per frame drafted from each frame's chapter (Core Book ch. 5, Hope &
 *   Fear ch. 4: named places, threats, set pieces), no further approval needed. Written in our own words; only the
 *   place and threat names come from the books. Shown only in that frame's campaigns, after the setting chips.
 */

import type { PublishedFrameId } from "@/lib/frames";
import type { SettingId } from "@/lib/sprite-packs/settings";

export type SceneChip = { readonly label: string; readonly text: string };

export const SETTING_CHIPS: Readonly<Record<SettingId, readonly SceneChip[]>> = {
  forest: [
    { label: "Bandit ambush", text: "a narrow trail through dense trees with archers hidden in the undergrowth." },
    { label: "Woodland clearing", text: "an open glade ringed by old oaks with a fallen trunk for cover." },
    { label: "Hunter's camp", text: "tents, a campfire and drying racks beside a stream." },
    { label: "Overgrown shrine", text: "a moss-covered stone shrine with roots breaking the floor." },
  ],
  "grassland-and-road": [
    { label: "Caravan raid", text: "wagons circled on a dirt road with raiders closing in from the tall grass." },
    { label: "Crossroads inn yard", text: "a fenced yard at a crossroads with a well and hay carts." },
    { label: "Bridge crossing", text: "a wooden bridge over a shallow river with reeds on both banks." },
    { label: "Standing stones", text: "a ring of standing stones on a windswept hill." },
  ],
  "mountain-and-cliffs": [
    { label: "Mountain pass", text: "a narrow pass between cliffs with loose boulders above." },
    { label: "Cliffside ledge", text: "a ledge path along a sheer drop with a rope bridge." },
    { label: "Watchtower ruin", text: "a broken watchtower on a rocky outcrop." },
    { label: "Eyrie", text: "a high nest of a great beast with bones scattered on the rocks." },
  ],
  cave: [
    { label: "Goblin warren", text: "twisting tunnels opening into a firelit chamber." },
    { label: "Underground lake", text: "a dark cavern around a still lake with stepping stones." },
    { label: "Collapsed tunnel", text: "a passage half blocked by rubble with a crawlspace." },
    { label: "Beast's den", text: "a wide cave littered with bones and a nest at the back." },
  ],
  dungeon: [
    { label: "Guard room", text: "a barracks with tables, bunks and a locked door." },
    { label: "Trap corridor", text: "a long hall with pressure plates and arrow slits." },
    { label: "Prison cells", text: "a row of cells around a jailer's desk." },
    { label: "Throne of the warlord", text: "a pillared hall with a raised dais." },
  ],
  "crypt-and-graveyard": [
    { label: "Crypt ambush", text: "stone sarcophagi in a low vault, lids ajar." },
    { label: "Midnight graveyard", text: "leaning headstones, a mausoleum and an iron fence." },
    { label: "Ossuary", text: "walls of stacked skulls around a ritual circle." },
    { label: "Fresh grave", text: "a gravedigger's shed beside an open grave." },
  ],
  "castle-interior": [
    { label: "Great hall feast", text: "long tables, a hearth and a minstrel gallery." },
    { label: "Throne room", text: "a pillared hall with banners and a raised throne." },
    { label: "Armory", text: "weapon racks and armor stands in a guarded room." },
    { label: "Library", text: "tall shelves, reading desks and a spiral stair." },
  ],
  tavern: [
    { label: "Tavern brawl", text: "a crowded common room with tables, a bar and a stage." },
    { label: "Back-room deal", text: "a private room with a card table and a hidden exit." },
    { label: "Cellar", text: "casks, crates and a trapdoor in a low cellar." },
    { label: "Burning inn", text: "the common room with fire spreading from the kitchen." },
  ],
  "town-street-and-market": [
    { label: "Market chase", text: "a busy square with stalls, carts and alleys." },
    { label: "Rooftop pursuit", text: "tight streets with low roofs and washing lines." },
    { label: "Town gate", text: "a gatehouse with a portcullis and a queue of wagons." },
    { label: "Riot in the square", text: "an overturned cart and a fountain in a crowded plaza." },
  ],
  temple: [
    { label: "Desecrated altar", text: "a nave with toppled pews and a defiled altar." },
    { label: "Cloister garden", text: "a covered walkway around a herb garden." },
    { label: "Reliquary vault", text: "a sealed chamber of relics behind warded doors." },
    { label: "Bell tower", text: "a narrow tower with the great bell and ladders." },
  ],
  swamp: [
    { label: "Bog crossing", text: "plank walkways over black water and reeds." },
    { label: "Witch's hut", text: "a stilted hut with lanterns and a rickety dock." },
    { label: "Sunken ruins", text: "half-drowned stone walls in murky shallows." },
    { label: "Hag's grove", text: "twisted cypresses around a mist-covered pool." },
  ],
  "snow-and-tundra": [
    { label: "Frozen lake", text: "cracking ice with snowdrifts on the shore." },
    { label: "Blizzard camp", text: "tents and a dying fire in a snowstorm." },
    { label: "Ice cave", text: "blue ice tunnels with icicles overhead." },
    { label: "Avalanche slope", text: "a steep slope with a buried caravan." },
  ],
  desert: [
    { label: "Oasis ambush", text: "palms around a pool with raiders in the dunes." },
    { label: "Buried temple", text: "sand-swept pillars of a half-buried temple." },
    { label: "Caravan camp", text: "tents and camels behind a rocky outcrop." },
    { label: "Sandstorm", text: "dunes with low visibility and a wrecked wagon." },
  ],
  "coast-and-beach": [
    { label: "Smugglers' cove", text: "a hidden beach with crates and a rowboat." },
    { label: "Shipwreck", text: "a broken hull on the rocks at low tide." },
    { label: "Lighthouse", text: "a lighthouse on a rocky point." },
    { label: "Tidal caves", text: "sea caves that flood with the tide." },
  ],
  "ship-deck": [
    { label: "Boarding action", text: "two ships lashed together with planks between." },
    { label: "Storm at sea", text: "a pitching deck with torn sails." },
    { label: "Kraken attack", text: "tentacles over the rails of a merchant ship." },
    { label: "Below decks", text: "the cargo hold with crates and hammocks." },
  ],
  sewers: [
    { label: "Sewer junction", text: "a crossing of tunnels with a central drain." },
    { label: "Thieves' hideout", text: "a dry chamber with bedrolls and loot." },
    { label: "Flooded tunnel", text: "waist-deep water with a walkway." },
    { label: "Ratfolk nest", text: "a chamber of refuse and scurrying swarms." },
  ],
  ruins: [
    { label: "Ruined fort", text: "crumbling walls and a broken keep." },
    { label: "Overgrown plaza", text: "a cracked plaza with fallen statues and vines." },
    { label: "Collapsed library", text: "shelves and rubble in a roofless hall." },
    { label: "Haunted manor", text: "a gutted house with a broken staircase." },
  ],
  "mushroom-cavern": [
    { label: "Glowing grove", text: "giant luminous mushrooms around a spore pool." },
    { label: "Myconid village", text: "mushroom huts linked by fungal bridges." },
    { label: "Chasm bridge", text: "a fungal bridge over a deep chasm." },
    { label: "Spore cloud", text: "a cavern filled with drifting toxic spores." },
  ],
  volcanic: [
    { label: "Lava bridge", text: "a stone bridge over a river of lava." },
    { label: "Fire temple", text: "an obsidian shrine with braziers." },
    { label: "Collapsing crater", text: "a crater rim with vents and falling rock." },
    { label: "Forge of the deep", text: "a dwarven forge built into a magma chamber." },
  ],
};

export const FRAME_CHIPS: Readonly<Record<PublishedFrameId, readonly SceneChip[]>> = {
  witherwild: [
    { label: "Withered grove", text: "a forest clearing choked by thorned, blooming overgrowth, with swollen roots and vine walls for cover." },
    { label: "Haven outpost", text: "an invader palisade cut into the wood, with a watchtower, soldiers' tents and stacked lumber." },
    { label: "Corrupted shrine", text: "a Faint Divinity's stone shrine pulsing with wither blooms, its floor split by grasping roots." },
    { label: "Haven flower fields", text: "rows of white blossoms on Haven's farmland, with a farmhouse, a cart and low stone walls." },
    { label: "Vault under the tower", text: "a warded stone vault beneath the central tower of Haven's wizarding school, with pillars and a sealed reliquary." },
    { label: "The Great Owl's tree", text: "a vast ancient tree on a hill where Nikta perches, its roots and branches strewn with feathers." },
  ],
  "five-banners-burning": [
    { label: "Border skirmish", text: "a contested ford between two armies' banners, with shallow water, reeds and abandoned barricades." },
    { label: "Siege breach", text: "a broken city wall with a siege tower, rubble piles and a burning gatehouse." },
    { label: "Lightning Valley", text: "a border town square ringed by giant lightning rods under a magical storm, with scorched cobbles." },
    { label: "Talks gone wrong", text: "a negotiation hall with a long table, toppled chairs and the banners of rival nations." },
    { label: "Armada harbor", text: "a crowded merchant harbor with moored ships, cranes and stacked cargo crates." },
    { label: "Hilltop chapel", text: "a walled temple of the Hilltop theocracy on a rise, with a courtyard and a bell tower." },
  ],
  "beast-feast": [
    { label: "Cavern kitchen", text: "a monster hunters' campsite deep underground, with a cooking fire, bedrolls and a ring of stalagmites." },
    { label: "Fading Lure", text: "the heart of the Plover Caves where Hylaeus's old ward-spell flickers among cracked crystals, with tunnels on every side." },
    { label: "Ghost scorpion nest", text: "tall cave grass of the Overgrowth flattened into circles, with burrows and a ridge of rock." },
    { label: "The Catacombs", text: "a deep cavern floor carpeted in bones, with ledges where beasts drag their prey." },
    { label: "Brilliance", text: "a cavern lit by a blazing geodesic dome, with a garden of edible blooms and shallow pools." },
    { label: "Stewpot Festival", text: "Elmore's village green with cooking stalls, giant stewpots and bunting between the cottages." },
  ],
  "age-of-umbra": [
    { label: "Last lantern", text: "a fort village of melted-shield walls around a towering Sacred Pyre, with swamp beyond the gate." },
    { label: "Shadow-swallowed road", text: "a road where the dark presses in beyond the torchlight, with dead trees and a broken cart." },
    { label: "Temple in the Shalk Chasm", text: "an eroded temple to a Veiled God at the bottom of a sinkhole, with fallen columns and a stair into the dark." },
    { label: "Celsian Athenaeum", text: "a grand library turned stronghold, with barricaded stacks, reading galleries and a guarded door." },
    { label: "Fallen Amber Reach", text: "haunted gothic city streets under looming gates and towers, with rubble and empty houses." },
    { label: "Idol Hollows", text: "a swampy floodplain of reeds and black water, with half-sunken statues and hummocks of firm ground." },
  ],
  motherboard: [
    { label: "Rogue machine", text: "a hulking infected remnant prowling the Wastes among rusted wrecks and scrap mounds." },
    { label: "Ancient server hall", text: "ruined tech vaults with flickering consoles, toppled racks and cables across the floor." },
    { label: "Scrap factory", text: "a factory floor in Argent's Build Sector, with conveyor belts, presses and heaps of scrap." },
    { label: "Data well", text: "a glowing data well among ruins where wild remnants gather, with broken pylons for cover." },
    { label: "Walking city", text: "the deck of Carrowcroft Walkaway, buildings crowded on a giant walking machine with guns at every edge." },
    { label: "Network tower", text: "a cliff-top tower peak with wires strung to distant towers and Tower Watch platforms." },
  ],
  "colossus-of-the-drylands": [
    { label: "High-noon showdown", text: "Wyllin's Gulch main street, with a saloon, hitching posts, water troughs and a fissure torn down the middle." },
    { label: "Colossus waking", text: "a canyon splitting as a giant creature rises, with falling rock and a fleeing wagon." },
    { label: "Essentia mine", text: "a mine shaft with glowing crystal veins, ore carts on rails and timber supports." },
    { label: "Train heist", text: "a steam train on the western line between high mesas, with flatcars, a water tower and a trestle." },
    { label: "Destry's factory", text: "an essentia processing factory with furnaces, catwalks and crates of crystals under guard." },
    { label: "On the colossus", text: "the back of a walking giant, with stone ridges, cracks and handholds between its segments." },
  ],
  "castle-high": [
    { label: "Floating island", text: "a broom-race course over drifting sky islands, with hoops, gusts and rocky spires." },
    { label: "Lock Tower", text: "the sealed portside tower after curfew, a spiral stair and the room whose window lights at midnight." },
    { label: "Orientation courtyard", text: "the castle courtyard at night, with a fountain, benches and a crash-landed broomstick." },
    { label: "Roost village", text: "winged huts perched across a small sky island, with ladders and rope walkways." },
    { label: "Skyland collision", text: "floating debris where two sky islands crashed, with broken rock and tilted ground." },
    { label: "Old skyway", text: "ancient ruins on a sky island with a crumbling stone bridge to the next island." },
  ],
  "reign-of-the-weredragon": [
    { label: "Tyrant's patrol", text: "weredrake soldiers raiding a village, with burning thatch, a well and an overturned market cart." },
    { label: "Heaven's Eye", text: "a hidden observatory with a great telescope on a dais, star charts and a domed ceiling." },
    { label: "Whelvewood skirmish", text: "a forest encampment of knights' militia, with a palisade, tents and rebels in the trees." },
    { label: "Red Leaf Inn", text: "a small inn deep in the Whelvewood, with a common room, a hearth and a stable yard." },
    { label: "Vexstone Abbey", text: "a haunted clifftop ruin over the sea, with broken arches, a cloister and a sheer drop." },
    { label: "Knightstead", text: "an old knight's manor and garden, with kennels and a sealed obelisk in the courtyard." },
  ],
  "dark-heart-of-andaluria": [
    { label: "Vineyard at dusk", text: "rows of vines with something stalking among them, a press house and stacked casks." },
    { label: "Vampire's chapel", text: "a candlelit chapel crypt with coffins, a stained-glass window and a hidden stair." },
    { label: "Santavio festival", text: "a village square of burst wine casks, lanterns and abandoned stalls, with cottages barricaded all around." },
    { label: "Plaza del Sol", text: "Jesaña's grand plaza at the Midsummer Festival, with fountains, balconies and crowds." },
    { label: "Serracorte slopes", text: "terraced vines on black volcanic slopes, with stone walls and a shepherd's hut." },
    { label: "Necromancer's laboratory", text: "a hidden laboratory beneath the city, with slabs, shelves of jars and a sealed door." },
  ],
  "journey-to-horizon": [
    { label: "Sanctuary gate", text: "the broken edge of a warded sanctuary facing the wild lands, with rubble and a fallen gatehouse." },
    { label: "Starfall crater", text: "a cratered plain of fallen-star debris and floating rock, glowing with shadowblight." },
    { label: "Marrogate shrine", text: "the shrine at the heart of Marrogate, with an altar, pillars and templars at the doors." },
    { label: "Shadowblighted wood", text: "a grey, drained forest where everything has lost its color, with dead trees and hollow logs." },
    { label: "Old Valloren road", text: "an overgrown road through toppled ruins, with strange mutated plants among the stones." },
    { label: "Cliffs of Horizon", text: "a windswept clifftop at the edge of the continent, with a great shrine and a sheer drop to the sea." },
  ],
};

/** The chips for a setting (none for an unknown id) followed by the frame's (none outside a published frame). */
export function sceneChips(setting: string | null, frameId: string | null | undefined): readonly SceneChip[] {
  const forSetting = setting !== null && Object.hasOwn(SETTING_CHIPS, setting) ? SETTING_CHIPS[setting as SettingId] : [];
  const forFrame = frameId && Object.hasOwn(FRAME_CHIPS, frameId) ? FRAME_CHIPS[frameId as PublishedFrameId] : [];
  return [...forSetting, ...forFrame];
}
