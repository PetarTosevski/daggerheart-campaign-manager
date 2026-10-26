// Campaign frames ship in code. Copy and art come from the Claude Design
// boards (reference/designs/project/FrameSelect.dc.html and the per-frame intro
// boards). Pure module: bundled into Convex functions, so no framework imports.

export const PUBLISHED_FRAME_IDS = [
  "witherwild",
  "five-banners-burning",
  "beast-feast",
  "age-of-umbra",
  "motherboard",
  "colossus-of-the-drylands",
  "castle-high",
  "reign-of-the-weredragon",
  "dark-heart-of-andaluria",
  "journey-to-horizon"
] as const;

export type PublishedFrameId = (typeof PUBLISHED_FRAME_IDS)[number];
export type FrameId = PublishedFrameId | "custom";

export const FRAME_IDS: readonly FrameId[] = [...PUBLISHED_FRAME_IDS, "custom"];

/**
 * Mechanics a frame can switch on beyond the core ones every campaign has.
 * `witherTokens` (D5): Wither tokens from Withered sources, converted to Fear at session end (CB 261).
 */
export type ExclusiveMechanic = "campaignTime" | "witherTokens";

export type ArtRef = {
  /** Design asset id (see `src/lib/design-assets.ts`). */
  asset: string;
  /** CSS `background-position` used by the boards. */
  position: string;
};

export type PublishedFrame = {
  id: PublishedFrameId;
  name: string;
  source: "Core Rulebook" | "Expansion";
  expansion: boolean;
  /** 1–4, shown as diamonds. */
  complexity: 1 | 2 | 3 | 4;
  /** One-line pitch shown in the frame picker. */
  tagline: string;
  designers: string;
  /** Full pitch paragraphs shown on the frame intro page. */
  pitch: string[];
  tones: string[];
  themes: string;
  touchstones: string;
  /** Label of the frame's special mechanics chapter. */
  mechanics: string;
  /** Label of the frame's inciting incident chapter. */
  incident: string;
  /** Key art in the picker. */
  art: ArtRef;
  /** Full-bleed background of the intro page and dashboard. */
  intro: ArtRef & { background: string; dim: number };
};

export const PUBLISHED_FRAMES = [
  {
    id: "witherwild",
    name: "The Witherwild",
    source: "Core Rulebook",
    expansion: false,
    complexity: 1,
    tagline: "When an invading nation attacks an ancient forest deity, a virulent overgrowth spreads throughout the land.",
    designers: "Carlos Cisco, Rowan Hall & Spenser Starke",
    pitch: [
      "Fanewick was once a place of great abundance and peace—dangerous to those unfamiliar with the land, but a cornucopia to those who respected its ways. When Haven invaded the wilds and forced the land into eternal spring, a dangerous bloom known as the Witherwild took hold and now threatens the lives of all who live there.",
      "In a Witherwild campaign, you’ll play unlikely heroes from humble beginnings who are reckoning with their newfound duty to save Fanewick’s people from dangerous corruption."
    ],
    tones: [
      "Adventurous",
      "Dynamic",
      "Epic",
      "Heroic",
      "Thrilling",
      "Uncanny",
      "Whimsical"
    ],
    themes: "Cultural Clash, Ends Justify Means, Grief, People vs. Nature, Transformation and Change, Survival",
    touchstones: "Princess Mononoke, The Legend of Zelda, The Dark Crystal, Nausicaä of the Valley of the Wind",
    mechanics: "Corruption from the Witherwild",
    incident: "The hunt for the Fanewraith",
    art: {
      asset: "d69136bf0c8eddbad10c2eb636b1b5ca",
      position: "60% 45%"
    },
    intro: {
      asset: "d69136bf0c8eddbad10c2eb636b1b5ca",
      position: "60% center",
      background: "#0a1416",
      dim: 20
    }
  },
  {
    id: "five-banners-burning",
    name: "Five Banners Burning",
    source: "Core Rulebook",
    expansion: false,
    complexity: 2,
    tagline: "Long-brewing tensions between rival nations boil over, threatening all-out war.",
    designers: "Mike Underwood",
    pitch: [
      "Five years into an armistice that ended a decade of warfare, the threat of renewed conflict looms over the continent of Althas. Five nations in a delicate web of alliances and rivalries seek to exploit the opportunities granted by this period of rapid magical, political, and social change. All five nations deploy agents to strengthen alliances, sabotage foes, and tip the balance of power in their favor.",
      "In a Five Banners Burning campaign, you’ll play heroes caught up in the twisting and ever-escalating conflict between nations, contending with competing loyalties, generational grudges, and opportunistic villains."
    ],
    tones: [
      "Adventurous",
      "Dramatic",
      "Intimate",
      "Political",
      "Serious",
      "Sweeping"
    ],
    themes: "Divided Loyalties, The Nature of Power, The Price of Ambition, Tradition vs. Innovation",
    touchstones: "A Song of Ice & Fire, Avatar: The Last Airbender, Babylon 5, Friends at the Table’s PARTIZAN, Born to the Blade, Court of Blades, Dragon Age: Inquisition, Eberron: Rising from the Last War",
    mechanics: "Faction relationships & objective countdowns",
    incident: "The disappearance of Clover of Towers",
    art: {
      asset: "5273dcaa00f81a748be4d8404ef72b6e",
      position: "50% 40%"
    },
    intro: {
      asset: "5273dcaa00f81a748be4d8404ef72b6e",
      position: "60% 40%",
      background: "#1a0d08",
      dim: 15
    }
  },
  {
    id: "beast-feast",
    name: "Beast Feast",
    source: "Core Rulebook",
    expansion: false,
    complexity: 2,
    tagline: "When a small village’s monster defense system fails, the local heroes must venture into the endless caverns below to fix it—and cook up trouble for the creatures that stand in their way!",
    designers: "Banana Chan, Rowan Hall & Spenser Starke",
    pitch: [
      "The rustic, peaceful village of Elmore sits atop the Plover Caves, a labyrinthine system of caverns full of dangerous and delectable creatures. When the powerful magic keeping the villagers safe begins to fail, the bravest among them must descend into the caves to save the day.",
      "In a Beast Feast campaign, you’ll play everyday heroes diving into the Plover Caves to reignite the magic lure that lies in its depths—and cook up delicious meals. Welcome to a culinary world of zoophagous delight, where the beasts you fight become the food you eat!"
    ],
    tones: [
      "Absurd",
      "Comedic",
      "Creepy",
      "Fun",
      "Lighthearted",
      "Silly"
    ],
    themes: "Circle of Life, Friendship & Loyalty, Nature’s Bounty, Overcoming Fear, Violence & Peace",
    touchstones: "Delicious in Dungeon, Monster Hunter World, One Piece",
    mechanics: "Hunting, gathering & cooking feasts",
    incident: "Ghost scorpion venom for Carat",
    art: {
      asset: "9ad463b1fc72771176578d77da20984f",
      position: "50% 50%"
    },
    intro: {
      asset: "9ad463b1fc72771176578d77da20984f",
      position: "30% center",
      background: "#12121e",
      dim: 15
    }
  },
  {
    id: "age-of-umbra",
    name: "The Age of Umbra",
    source: "Core Rulebook",
    expansion: false,
    complexity: 3,
    tagline: "In a dying world immersed in relentless shadow and nightmarish monsters, small communities hold fast to the light, hoping those who endure can find a way to save this broken realm before all is lost to darkness.",
    designers: "Matthew Mercer",
    pitch: [
      "A century has passed since the God-King Othedias betrayed the Pantheon, provoking divine punishment and abandonment by the gods that left the realm of the Halcyon Domain shattered, desolate, and eternally cursed. Throughout this shadow-choked land of decaying fortresses and dreadful monstrosities, surviving communities cling to hope in the face of lightless oblivion.",
      "In an Age of Umbra campaign, you’ll play heroic survivors who protect their community from the terrors beyond their walls, venture out into the unknown to hunt the nightmares that twist and grow with each fallen soul, seek answers to the curses that corrupt this world, and perhaps even discover a way to change its fate."
    ],
    tones: [
      "Ancient",
      "Daunting",
      "Epic",
      "Grim",
      "Ominous",
      "Terrifying",
      "Tragic"
    ],
    themes: "Apocalypse, Corruption, Darkness vs Light, Hope, Redemption, Survival",
    touchstones: "Dark Souls, Kingdom Death: Monster, Berserk, The Seventh Seal, Blasphemous",
    mechanics: "The Strength of Hate & Lurking Darkness",
    incident: "The temple in Shalk Chasm",
    art: {
      asset: "53d3e7877e8e687107b1d80149685979",
      position: "55% 60%"
    },
    intro: {
      asset: "53d3e7877e8e687107b1d80149685979",
      position: "70% center",
      background: "#16151d",
      dim: 20
    }
  },
  {
    id: "motherboard",
    name: "Motherboard",
    source: "Core Rulebook",
    expansion: false,
    complexity: 3,
    tagline: "In a world where magic takes the form of the technology left behind by a long-fallen civilization, a new threat rises as a malicious virus spreads through the machines that wander the Wastes.",
    designers: "Meguey Baker, Rowan Hall & Spenser Starke",
    pitch: [
      "Among the ancient ruins of the fallen world, the great walled cities of the Echo Vale sit as bastions of hope in an otherwise hostile land. Utilizing technology powered by a mysterious language that runs through metal threads tethered high above the valley, these citadels insulate their citizens from the Wastes, where autonomous machines roam wild and massive wandering cities scour the land for scrap. But when a malicious virus infects the machine beasts that work alongside the people of the valley, the once-docile creations turn violent.",
      "In a Motherboard campaign, you’ll use technology instead of magic as you play extraordinary heroes leaving the safety of the walled cities to travel the Wastes and bring peace to the Vale once more."
    ],
    tones: [
      "Adventurous",
      "Epic",
      "Innovative",
      "Mysterious",
      "Post-Post-Apocalyptic",
      "Technological"
    ],
    themes: "Artificial Intelligence, Identity & Personhood, Innovation, Technology vs. Humanity",
    touchstones: "Horizon Zero Dawn, Mortal Engines, Mad Max: Fury Road, The Final Fantasy Series, Fullmetal Alchemist, Slugblaster",
    mechanics: "Tech damage, augments & the quantum economy",
    incident: "Infected machines in Argent",
    art: {
      asset: "0b895f62874c5481f3b92d0cd284d3e9",
      position: "50% 45%"
    },
    intro: {
      asset: "0b895f62874c5481f3b92d0cd284d3e9",
      position: "center",
      background: "#0e1a22",
      dim: 15
    }
  },
  {
    id: "colossus-of-the-drylands",
    name: "Colossus of the Drylands",
    source: "Core Rulebook",
    expansion: false,
    complexity: 4,
    tagline: "A prosperous region of gunslingers and outlaws has fallen into terror as colossal creatures awaken from beneath the earth.",
    designers: "Carlos Cisco, Rowan Hall, Spenser Starke & Mike Underwood",
    pitch: [
      "The Drylands were a place that put the old stories aside. While superstitious miners have long said that the crystals growing wild in this desert are made from the very life-essence of Forgotten Gods, the folk around here had real work to do, and actual deities were left for campfire stories. That is, until a massive colossus answered the call of something ancient and apocalyptic, rising from the earth and devastating the lands.",
      "The bold prospectors, tired laborers, and born-again worshippers in the dusty town of Wyllin’s Gulch were thrown from their routine of industry and exploitation, forced to raise scattered armies and watch them die to the behemoth’s strength. And this is only the first of many titanic beasts poised to terrorize the land.",
      "In a Colossus of the Drylands campaign, you’ll play a heroic posse of mavericks who must save their home from a legion of colossi and a primordial god seeking vengeance."
    ],
    tones: [
      "Awe-Inspiring",
      "Dusty",
      "Eerie",
      "Gritty",
      "Larger than Life",
      "Terrifying"
    ],
    themes: "Breaking Cycles, The Burden of Heroism, Faith vs. Doubt, Greed, Ordinary People Accomplishing the Extraordinary",
    touchstones: "Shadow of the Colossus, Red Dead Redemption, Deadlands, On the Shoulders of Colossus",
    mechanics: "Hunts, interludes & colossus fights",
    incident: "The first colossus at Wyllin’s Gulch",
    art: {
      asset: "bf68d5cb6c5931e18f23260203309a75",
      position: "40% 35%"
    },
    intro: {
      asset: "bf68d5cb6c5931e18f23260203309a75",
      position: "center",
      background: "#1d130c",
      dim: 15
    }
  },
  {
    id: "castle-high",
    name: "Castle High",
    source: "Expansion",
    expansion: true,
    complexity: 1,
    tagline: "In a modern fantasy world, teenagers attend a boarding school in the clouds—sneaking out of class to fly brooms, explore floating islands, and save their friends.",
    designers: "Rowan Hall, Mikey Hamm, Cass Rea & Spenser Starke",
    pitch: [
      "In a modern world of knights and cars, wands and flip phones, there’s no better place to study magic than the floating school known as Castle High. Drifting among the mysterious ruins of the ancient world and modern settlements that populate the clouds, this school and its surroundings hold secrets, danger, and something more sinister. A string of disappearances has recently plagued the school, and no one knows who or what is behind it—or who will disappear next.",
      "In a Castle High campaign, you’ll play adventurous high schoolers who take magic classes, explore sky islands, and search for their missing classmates."
    ],
    tones: [
      "Adventurous",
      "Dreamy",
      "Full-Hearted",
      "Melodramatic",
      "Modern",
      "Playful",
      "Thrilling"
    ],
    themes: "Coming of Age, Curiosity & Rebellion, Friendship & Loyalty, Magical vs. Modern",
    touchstones: "Kids on Brooms, Kiki’s Delivery Service, The Legend of Zelda: Skyward Sword, Little Witch Academia, Onward, The Owl House, She-Ra and the Princesses of Power, Slugblaster",
    mechanics: "Flight & a less lethal campaign",
    incident: "The crash in the courtyard",
    art: {
      asset: "3514a8aae6b8c0148b3c1df43a1999dd",
      position: "50% 40%"
    },
    intro: {
      asset: "3514a8aae6b8c0148b3c1df43a1999dd",
      position: "center",
      background: "#122027",
      dim: 20
    }
  },
  {
    id: "reign-of-the-weredragon",
    name: "Reign of the Weredragon",
    source: "Expansion",
    expansion: true,
    complexity: 2,
    tagline: "In a land ruled by a violent weredragon tyrant, heroes ordained by the stars to defeat her must rise to the challenge and defend their people.",
    designers: "Jeremy Crawford, Rowan Hall, Christopher Perkins & Spenser Starke",
    pitch: [
      "Once upon a time, in the peaceful land of Whelvia, a powerful sorceress named Forlorne Lykona deceived the country’s great dragon warden to absorb his power and rule the kingdom herself. Transformed into a weredragon by the powerful ritual that fused the warden’s power with her cold heart, Forlorne now takes to the skies, feasting on all who challenge her and cursing innocent villagers to become ravenous weredrakes. The people called on the brave defenders of the realm, the Knights of Whelvia, to protect them—but the knights instead bent the knee to the draconic tyrant, allowing her to command their forces and leaving the land without protectors.",
      "In a Reign of the Weredragon campaign, you play destined heroes of Whelvia, rising up against Forlorne Lykona and her knights to save this once-idyllic land from the jaws of tyranny."
    ],
    tones: [
      "Epic",
      "Fairy Tale-Like",
      "Grim",
      "Hopeful"
    ],
    themes: "Astrology, Fate Written in the Stars, Swords & Sorcery, Tyranny’s Rise and Fall",
    touchstones: "The Black Cauldron, Conan the Barbarian, For the Queen, The Little Mermaid, Sleeping Beauty, The Sword and the Sorcerer, The Wolfman",
    mechanics: "Curses, revelations & Keys to Victory",
    incident: "A gull with a map to Heaven’s Eye",
    art: {
      asset: "4b69baa5c3ea604607e14579c982c9e9",
      position: "40% 30%"
    },
    intro: {
      asset: "4b69baa5c3ea604607e14579c982c9e9",
      position: "center",
      background: "#16121e",
      dim: 15
    }
  },
  {
    id: "dark-heart-of-andaluria",
    name: "Dark Heart of Andaluria",
    source: "Expansion",
    expansion: true,
    complexity: 3,
    tagline: "As the nights grow long in a land of rich wine and ancient superstitions, a band of monster hunters battles the creatures that stalk the shadows.",
    designers: "Carlos Cisco, Rue Dickey, Rowan Hall & Rob Hebert",
    pitch: [
      "Andaluria is a land of sweeping vineyards where beauty and dread intertwine. By day, the streets and valleys are alive with festivals, music, and the scent of wine—but when the sun sets, monsters come out to feast. For generations, the old superstitions and folk rites kept the beasts at bay, but of late the nights have grown unnaturally long, and the citizens of Andaluria live in fear of increasingly terrifying monsters.",
      "In a Dark Heart of Andaluria campaign, you’ll play monster hunters who must investigate horrific crimes, navigate political strife, and slay supernatural creatures to protect the people from eternal darkness."
    ],
    tones: [
      "Gothic",
      "Grim",
      "Heroic",
      "Intriguing",
      "Monstrous",
      "Mysterious",
      "Romantic",
      "Spooky",
      "Thrilling"
    ],
    themes: "Battle Not with Monsters Lest Ye Become One, Dangerous Secrets, Driving Back the Darkness, Faith & Tradition, The Nature of Evil, Power & Politics",
    touchstones: "Bloodborne, Castlevania, Curse of Strahd, Hellboy, John Constantine: Hellblazer, Monster of the Week, Night’s Black Agents, Slayers, Supernatural, Vaesen, Vampire Hunter D, Van Helsing, The Witcher, World of Darkness",
    mechanics: "Monster hunts & transformations",
    incident: "The tainted wine festival",
    art: {
      asset: "b05e2883f26c65020e038349a2ba07ba",
      position: "60% 40%"
    },
    intro: {
      asset: "b05e2883f26c65020e038349a2ba07ba",
      position: "center",
      background: "#171214",
      dim: 10
    }
  },
  {
    id: "journey-to-horizon",
    name: "Journey to Horizon",
    source: "Expansion",
    expansion: true,
    complexity: 4,
    tagline: "After a thousand-year cataclysm, a fellowship of heroes embarks from their magically protected sanctuary to journey across a broken continent and resurrect the fallen goddess who can heal their world.",
    designers: "James Haeck, Rob Hebert, James Introcaso & Spenser Starke",
    pitch: [
      "Long ago, the vast continent of Valloren was home to wondrous landscapes shaped by the goddess Aurelia, wielder of the elemental essence called terrana. But when her disciples’ betrayal threatened to extinguish magic forever, Aurelia sacrificed her own life to call down the stars and purge the land of corruption. To protect her people from annihilation, Aurelia raised magical barriers that would last a thousand years.",
      "In a Journey to Horizon campaign, you play heroes chosen by fate to leave their recently unsealed sanctuary and travel across a turbulent and hostile world on a quest to resurrect the goddess."
    ],
    tones: [
      "Adventurous",
      "Epic",
      "Hopeful",
      "Magical",
      "Mysterious",
      "Sprawling",
      "Wondrous"
    ],
    themes: "Faith in Friendship, Growing Shadows, Hope Rekindled, New Beginnings, Pathways Long & Winding, Points of Light in a Ruined World",
    touchstones: "The Dragon Prince, Fallout, Final Fantasy VII, Kipo and the Age of the Wonderbeasts, The Legend of Zelda: Breath of the Wild, The Lord of the Rings Trilogy, Lunar, Willow",
    mechanics: "The hex crawl & the Doom Track",
    incident: "Aurelia’s Soul Echo at Marrogate",
    art: {
      asset: "b0cd8d347b032b78f2c527ddcce21f51",
      position: "45% 55%"
    },
    intro: {
      asset: "b0cd8d347b032b78f2c527ddcce21f51",
      position: "center",
      background: "#121a1c",
      dim: 20
    }
  }
] as const satisfies readonly PublishedFrame[];

/** Exclusive mechanics per frame. Only Witherwild has any until the user specifies others. */
const EXCLUSIVE_MECHANICS: Record<FrameId, readonly ExclusiveMechanic[]> = {
  ...(Object.fromEntries(PUBLISHED_FRAME_IDS.map((id) => [id, []])) as unknown as Record<
    PublishedFrameId,
    readonly ExclusiveMechanic[]
  >),
  witherwild: ["campaignTime", "witherTokens"],
  custom: [],
};

export function isFrameId(value: string): value is FrameId {
  return (FRAME_IDS as readonly string[]).includes(value);
}

export function getPublishedFrame(id: string): PublishedFrame | undefined {
  return PUBLISHED_FRAMES.find((frame) => frame.id === id);
}

export function frameHasMechanic(id: FrameId, mechanic: ExclusiveMechanic): boolean {
  return EXCLUSIVE_MECHANICS[id].includes(mechanic);
}

/** Background choices for a custom campaign's dashboard (FrameSelect "Dashboard background"). */
export const CUSTOM_BACKGROUNDS = [
  { id: "custom", label: "Cartographer's Desk", art: { asset: "f3205851cb5f0694dec14556bfd1988e", position: "center 40%" } },
  ...PUBLISHED_FRAMES.map((frame) => ({ id: frame.id, label: shortName(frame.name), art: frame.art })),
] as const satisfies readonly { id: string; label: string; art: ArtRef }[];

export type CustomBackgroundId = (typeof CUSTOM_BACKGROUNDS)[number]["id"];

/** Tone choices offered for a custom frame. */
export const CUSTOM_TONES = [
  "Adventurous",
  "Heroic",
  "Dark",
  "Whimsical",
  "Mysterious",
  "Political",
  "Epic",
  "Cozy",
] as const;

function shortName(name: string): string {
  const short: Record<string, string> = {
    "Five Banners Burning": "Five Banners",
    "The Age of Umbra": "Age of Umbra",
    "Colossus of the Drylands": "Colossus",
    "Reign of the Weredragon": "Weredragon",
    "Dark Heart of Andaluria": "Andaluria",
    "Journey to Horizon": "Horizon",
  };
  return short[name] ?? name;
}

export function complexityDiamonds(complexity: number): string {
  return "◆".repeat(complexity) + "◇".repeat(4 - complexity);
}
