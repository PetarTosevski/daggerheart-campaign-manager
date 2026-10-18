import { describe, expect, it } from "vitest";

import { featureFearCost, hordeDamage, minionValue } from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { ADVERSARY_TYPES, type AdversaryDef } from "@/lib/srd/types";

// Adversaries by tier as the books index them: Core Rulebook p.209 and Hope & Fear p.61 (names only).
const CORE_INDEX: Record<1 | 2 | 3 | 4, string[]> = {
  1: [
    "Acid Burrower",
    "Bear",
    "Cave Ogre",
    "Construct",
    "Courtier",
    "Deeproot Defender",
    "Dire Wolf",
    "Giant Mosquitoes",
    "Giant Rat",
    "Giant Scorpion",
    "Glass Snake",
    "Harrier",
    "Archer Guard",
    "Bladed Guard",
    "Head Guard",
    "Jagged Knife Bandit",
    "Jagged Knife Hexer",
    "Jagged Knife Kneebreaker",
    "Jagged Knife Lackey",
    "Jagged Knife Lieutenant",
    "Jagged Knife Shadow",
    "Jagged Knife Sniper",
    "Merchant",
    "Minor Chaos Elemental",
    "Minor Fire Elemental",
    "Minor Demon",
    "Minor Treant",
    "Green Ooze",
    "Tiny Green Ooze",
    "Red Ooze",
    "Tiny Red Ooze",
    "Petty Noble",
    "Pirate Captain",
    "Pirate Raiders",
    "Pirate Tough",
    "Sellsword",
    "Skeleton Archer",
    "Skeleton Dredge",
    "Skeleton Knight",
    "Skeleton Warrior",
    "Spellblade",
    "Swarm of Rats",
    "Sylvan Soldier",
    "Tangle Bramble Swarm",
    "Tangle Bramble",
    "Weaponmaster",
    "Young Dryad",
    "Brawny Zombie",
    "Patchwork Zombie Hulk",
    "Rotted Zombie",
    "Shambling Zombie",
    "Zombie Pack",
  ],
  2: [
    "Archer Squadron",
    "Apprentice Assassin",
    "Assassin Poisoner",
    "Master Assassin",
    "Battle Box",
    "Chaos Skull",
    "Conscript",
    "Courtesan",
    "Cult Adept",
    "Cult Fang",
    "Cult Initiate",
    "Demonic Hound Pack",
    "Electric Eels",
    "Elite Soldier",
    "Failed Experiment",
    "Giant Beastmaster",
    "Giant Brawler",
    "Giant Recruit",
    "Giant Eagle",
    "Gorgon",
    "Juvenile Flickerfly",
    "Knight of the Realm",
    "Masked Thief",
    "Merchant Baron",
    "Minotaur Wrecker",
    "Mortal Hunter",
    "Royal Advisor",
    "Secret-Keeper",
    "Shark",
    "Siren",
    "Spectral Archer",
    "Spectral Captain",
    "Spectral Guardian",
    "Spy",
    "Stonewraith",
    "War Wizard",
  ],
  3: [
    "Adult Flickerfly",
    "Demon of Avarice",
    "Demon of Despair",
    "Demon of Hubris",
    "Demon of Jealousy",
    "Demon of Wrath",
    "Dire Bat",
    "Dryad",
    "Elemental Spark",
    "Greater Earth Elemental",
    "Greater Water Elemental",
    "Huge Green Ooze",
    "Hydra",
    "Monarch",
    "Stag Knight",
    "Oak Treant",
    "Treant Sapling",
    "Head Vampire",
    "Vampire",
    "Vault Guardian Gaoler",
    "Vault Guardian Sentinel",
    "Vault Guardian Turret",
    "Young Ice Dragon",
  ],
  4: [
    "Arch-Necromancer",
    "Fallen Shock Troop",
    "Fallen Sorcerer",
    "Fallen Warlord: Realm-Breaker",
    "Fallen Warlord: Undefeated Champion",
    "Hallowed Archer",
    "Hallowed Soldier",
    "High Seraph",
    "Kraken",
    "Oracle of Doom",
    "Outer Realms Abomination",
    "Outer Realms Corruptor",
    "Outer Realms Thrall",
    "Volcanic Dragon: Obsidian Predator",
    "Volcanic Dragon: Molten Scourge",
    "Volcanic Dragon: Ashen Tyrant",
    "Perfected Zombie",
    "Zombie Legion",
  ],
};

const HOPE_AND_FEAR_INDEX: Record<1 | 2 | 3 | 4, string[]> = {
  1: [
    "Ahuizotl",
    "Atototl",
    "Bugboar",
    "Common Ruffian",
    "Darkweave Crawler",
    "Darkweave Queen",
    "Darkweave Spinner",
    "Darkweave Swarmlings",
    "Elk",
    "Falcon",
    "Grimmling Warband",
    "Harpy",
    "Kelpie",
    "Masque Muerte",
    "Mechanorb",
    "Mountain Troll",
    "Octopus",
    "Panther",
    "Phantom",
    "Poltergeist",
    "Rabble Mawb",
    "Redcap Biters",
    "Redcap Breaker",
    "Redcap Butcher",
    "Redcap Candlemaker",
    "Redcap Skinner",
    "Rugaru",
    "Sawtoothed Gillbeast",
    "Soul-Shattered Mage",
    "Spellbound Armor",
    "Viper",
    "Waxwork Creation",
    "Will-o’-the-Wisps",
    "Yufo",
  ],
  2: [
    "Banshee",
    "Basilisk",
    "Berserker Alpha",
    "Berserker Initiate",
    "Centaur Warden",
    "Chicken-Foot Hut",
    "Dire Pangolati",
    "Doppelhound",
    "Dragon Knight",
    "Elephant",
    "Entombed Cat Beast",
    "Entombed Elite Guard",
    "Entombed Empress",
    "Entombed Necropriest",
    "Entombed Skin Beetles",
    "Entombed Stonemason",
    "Flock of Feather Fiends",
    "Fowlbear",
    "Fungispunj Sporeling",
    "Fungispunj Sporophore",
    "Gargoyle",
    "Giant Octopus",
    "Gobstalker",
    "Guahalan Alebrujo",
    "Guahalan Fang Lord",
    "Guahalan Shifter",
    "Guahalan Spirit Beast",
    "Guahalan Spirit Singer",
    "Hill Titan",
    "Hive Walker",
    "Jack-o’-Lantern",
    "Landshark",
    "Landshark Behemoth",
    "Ravenous Mockery",
    "Rust Eater",
    "Scarecrow",
    "Sprite",
    "Stone Titan",
    "Triceratops",
    "Tyrannosaurus",
    "Urco",
    "Valdenhax",
  ],
  3: [
    "Archmage",
    "Catrin",
    "Chimera",
    "Crimson Lepus",
    "Cryptimoth",
    "Cursed Merfolk",
    "Deep Dweller",
    "Drake",
    "Dullahan",
    "Fellmounted Shadow King",
    "Fire Titan",
    "Frost Titan",
    "Gargantuan Sea Turtle",
    "Lamia",
    "Lamplight Beguiler",
    "Manticore",
    "Night Children",
    "Pain Priest",
    "Phoenix",
    "Plesiosaurus",
    "Roc",
    "Sandwyrm",
    "Shapeshifting Fiend",
    "Shapeshifting Fiend Revealed",
    "Storm Titan",
    "Unicorn",
    "Vampire Bat Swarm",
    "Vampire Lord",
    "Viscera Sucker",
    "Whisper Wraith",
    "Wyvern",
    "Young Fire Dragon",
  ],
  4: [
    "Cephilith Abomination",
    "Cephilith Hatchling",
    "Cephilith Novitiate",
    "Cephilith Priest",
    "Cephilith Titan",
    "Cipactli",
    "Cloud Titan",
    "Demon Lord Berzug",
    "Dragon Mother Mitera",
    "Fire Titan Warlord",
    "Gargantuan War Machine",
    "Ghastly Legion",
    "Griffin",
    "Hallowed Choir",
    "Harbinger of Death",
    "Harbinger of Famine",
    "Harbinger of Pestilence",
    "Harbinger of War",
    "Owl Witch",
    "Ruby Dragon",
    "Severed Shadow",
    "Supreme Demiurge Adonix",
    "Temporal Enforcer",
    "Water Mother",
    "Wyrmfiend",
    "Wyrmlings",
    "Xero the Castle Killer",
  ],
};

const TIERS = [1, 2, 3, 4] as const;
const core = ADVERSARIES.filter((a) => a.source === "core");
const hopeAndFear = ADVERSARIES.filter((a) => a.source === "hope-and-fear");
const countBy = (list: readonly AdversaryDef[], key: (a: AdversaryDef) => string | number) =>
  list.reduce<Record<string, number>>((m, a) => ({ ...m, [key(a)]: (m[key(a)] ?? 0) + 1 }), {});
const allTexts = ADVERSARIES.flatMap((a) => [
  a.name,
  a.description,
  a.motives,
  a.attack.name,
  ...a.experiences.map((e) => e.name),
  ...a.features.flatMap((f) => [f.name, f.text]),
]);

describe("SRD adversary catalogue (src/lib/srd/adversaries.ts)", () => {
  it("holds 267 adversaries: 129 Core, 135 Hope & Fear and 3 Reign of the Weredragon", () => {
    expect(ADVERSARIES).toHaveLength(267);
    expect(core).toHaveLength(129);
    expect(hopeAndFear.filter((a) => !a.frameId)).toHaveLength(135);
    expect(ADVERSARIES.filter((a) => a.frameId === "reign-of-the-weredragon").map((a) => a.name)).toEqual([
      "Weredrake",
      "Forlorne Lykona (Dragon Form)",
      "Forlorne Lykona (Faun Form)",
    ]);
  });

  it("has unique slug ids", () => {
    expect(new Set(ADVERSARIES.map((a) => a.id)).size).toBe(ADVERSARIES.length);
    for (const a of ADVERSARIES) expect(a.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("counts Core 52/36/23/18 and Hope & Fear (with the frame) 35/42/32/29 by tier", () => {
    expect(countBy(core, (a) => a.tier)).toEqual({ 1: 52, 2: 36, 3: 23, 4: 18 });
    expect(countBy(hopeAndFear, (a) => a.tier)).toEqual({ 1: 35, 2: 42, 3: 32, 4: 29 });
  });

  it("counts the Core types as the Core Rulebook does", () => {
    expect(countBy(core, (a) => a.type)).toEqual({
      Bruiser: 17,
      Horde: 9,
      Leader: 16,
      Minion: 16,
      Ranged: 9,
      Skulk: 15,
      Social: 8,
      Solo: 20,
      Standard: 12,
      Support: 7,
    });
  });

  it("matches the books' indexes name for name, tier by tier (CB p.209, HF p.61)", () => {
    for (const tier of TIERS) {
      const coreNames = core.filter((a) => a.tier === tier).map((a) => a.name);
      const hfNames = hopeAndFear.filter((a) => a.tier === tier && !a.frameId).map((a) => a.name);
      expect(new Set(coreNames)).toEqual(new Set(CORE_INDEX[tier]));
      expect(new Set(hfNames)).toEqual(new Set(HOPE_AND_FEAR_INDEX[tier]));
    }
  });

  it("gives every entry a difficulty, HP, an attack and at least one feature", () => {
    for (const a of ADVERSARIES) {
      expect(Number.isInteger(a.difficulty), a.name).toBe(true);
      expect(a.hp, a.name).toBeGreaterThan(0);
      expect(a.attack.name, a.name).not.toBe("");
      expect(a.attack.damage, a.name).toMatch(/^(\d*d\d+([+-]\d+)?|\d+) (direct )?(phy|mag|phy\/mag)$/);
      expect(a.features.length, a.name).toBeGreaterThan(0);
      expect(ADVERSARY_TYPES).toContain(a.type);
      for (const f of a.features) expect(f.text, `${a.name}: ${f.name}`).not.toBe("");
    }
  });

  it("gives every Minion null thresholds and a Minion (X) value", () => {
    const minions = ADVERSARIES.filter((a) => a.type === "Minion");
    expect(minions.length).toBeGreaterThan(0);
    for (const a of minions) {
      expect(a.thresholds, a.name).toEqual({ major: null, severe: null });
      expect(minionValue(a), a.name).toBeGreaterThan(0);
    }
  });

  it("gives every Horde a creatures-per-HP value and a Horde (X) damage", () => {
    const hordes = ADVERSARIES.filter((a) => a.type === "Horde");
    expect(hordes.length).toBeGreaterThan(0);
    for (const a of hordes) {
      expect(a.hordePerHp, a.name).toBeGreaterThan(0);
      expect(hordeDamage(a), a.name).toMatch(/^\d*d\d+([+-]\d+)?$/);
    }
    expect(ADVERSARIES.filter((a) => a.hordePerHp !== undefined).every((a) => a.type === "Horde")).toBe(true);
  });

  it("carries the board patches checked against the books", () => {
    const byName = (name: string) => ADVERSARIES.find((a) => a.name === name)!;
    expect(byName("Zombie Legion").attack.range).toBe("Melee");
    expect(byName("Swarm of Rats").hordePerHp).toBe(10);
    expect(byName("Electric Eels").hordePerHp).toBe(2);
    expect(byName("Head Guard").features.find((f) => f.name === "On My Signal")).toMatchObject({
      kind: "reaction",
      countdown: "Countdown (5)",
    });
    expect(byName("Ghastly Legion").hordePerHp).toBe(10);
  });

  it("stores the fear cost the domain rule reads from each feature text", () => {
    for (const a of ADVERSARIES) {
      for (const f of a.features) expect(f.fearCost ?? null, `${a.name}: ${f.name}`).toBe(featureFearCost(f.text));
    }
  });

  it("keeps Hope & Fear text verbatim with page numbers (HF p.62: Ahuizotl)", () => {
    const ahuizotl = ADVERSARIES.find((a) => a.name === "Ahuizotl")!;
    expect(ahuizotl.page).toBe(62);
    expect(ahuizotl.features[0]).toEqual({
      name: "Aquatic Attacker",
      kind: "passive",
      text: "When the Ahuizotl attacks from the water, it has advantage on the attack and deals an extra 1d6 damage.",
    });
    for (const a of hopeAndFear) expect(a.page, a.name).toBeGreaterThan(0);
  });

  it("has no split ligatures, private-use digits or stray line breaks in any text", () => {
    for (const s of allTexts) {
      expect(s, s).not.toMatch(/\b(fi|fl) [a-z]/);
      expect(s, s).not.toMatch(/[-]/);
      expect(s, s).not.toMatch(/\n(?!\n- |- )/);
    }
  });
});
