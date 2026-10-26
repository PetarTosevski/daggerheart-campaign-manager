// Tier 1 starting weapons and armor, class starting suggestions, Experience examples.
// Extracted verbatim from the Party design board (reference/designs/project/Party.dc.html).
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { Armor, ClassId, ExperienceSuggestionGroup, StartingSuggestion, Weapon } from "./types";

export const WEAPONS: readonly Weapon[] = [
  // Combat wheelchairs (Core Book, Tier 1 primary weapons; missing from the design board).
  {
    id: "light-frame-wheelchair",
    name: "Light-Frame Wheelchair",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: { name: "Quick", text: "When you make an attack, you can mark a Stress to target another creature within range." },
    source: "core",
  },
  {
    id: "heavy-frame-wheelchair",
    name: "Heavy-Frame Wheelchair",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d12+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: { name: "Heavy", text: "−1 to Evasion" },
    source: "core",
  },
  {
    id: "arcane-frame-wheelchair",
    name: "Arcane-Frame Wheelchair",
    slot: "primary",
    category: "magic",
    tier: 1,
    // Printed trait is "Spellcast" (the wielder's subclass trait); "choice" is the closest TraitId.
    trait: "choice",
    range: "Far",
    damage: "d6 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: { name: "Reliable", text: "+1 to attack rolls" },
    source: "core",
  },
  {
    id: "arcane-gauntlets",
    name: "Arcane Gauntlets",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d10+3 mag",
    damageType: "magic",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "battleaxe",
    name: "Battleaxe",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d10+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "broadsword",
    name: "Broadsword",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Reliable",
      text: "+1 to attack rolls"
    },
    source: "core"
  },
  {
    id: "crossbow",
    name: "Crossbow",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Far",
    damage: "d6+1 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "cutlass",
    name: "Cutlass",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "presence",
    range: "Melee",
    damage: "d8+1 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "dagger",
    name: "Dagger",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Melee",
    damage: "d8+1 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "dualstaff",
    name: "Dualstaff",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "instinct",
    range: "Far",
    damage: "d6+3 mag",
    damageType: "magic",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "glowing-rings",
    name: "Glowing Rings",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "agility",
    range: "Very Close",
    damage: "d10+2 mag",
    damageType: "magic",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "grappler",
    name: "Grappler",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Close",
    damage: "d6 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Hooked",
      text: "On a successful attack, you can pull the target into Melee range."
    },
    source: "core"
  },
  {
    id: "greatstaff",
    name: "Greatstaff",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "knowledge",
    range: "Very Far",
    damage: "d6 mag",
    damageType: "magic",
    burden: "two-handed",
    feature: {
      name: "Powerful",
      text: "On a successful attack, roll an additional damage die and discard the lowest result."
    },
    source: "core"
  },
  {
    id: "greatsword",
    name: "Greatsword",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d10+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: {
      name: "Massive",
      text: "-1 to Evasion; on a successful attack, roll an additional damage die and discard the lowest result."
    },
    source: "core"
  },
  {
    id: "halberd",
    name: "Halberd",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Very Close",
    damage: "d10+2 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: {
      name: "Cumbersome",
      text: "-1 to Finesse"
    },
    source: "core"
  },
  {
    id: "hallowed-axe",
    name: "Hallowed Axe",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d8+1 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "hand-crossbow",
    name: "Hand Crossbow",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Far",
    damage: "d6+1 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "hand-runes",
    name: "Hand Runes",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "instinct",
    range: "Very Close",
    damage: "d10 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "longbow",
    name: "Longbow",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Very Far",
    damage: "d8+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: {
      name: "Cumbersome",
      text: "-1 to Finesse"
    },
    source: "core"
  },
  {
    id: "longsword",
    name: "Longsword",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Melee",
    damage: "d10+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "mace",
    name: "Mace",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d8+1 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "quarterstaff",
    name: "Quarterstaff",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "instinct",
    range: "Melee",
    damage: "d10+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "rapier",
    name: "Rapier",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "presence",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Quick",
      text: "When you make an attack, you can mark a Stress to target another creature within range."
    },
    source: "core"
  },
  {
    id: "returning-blade",
    name: "Returning Blade",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "finesse",
    range: "Close",
    damage: "d8 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: {
      name: "Returning",
      text: "When this weapon is thrown within its range, it appears in your hand immediately after the attack."
    },
    source: "core"
  },
  {
    id: "round-shield",
    name: "Round Shield",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d4 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Protective",
      text: "+1 to Armor Score"
    },
    source: "core"
  },
  {
    id: "scepter",
    name: "Scepter",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "presence",
    range: "Far",
    damage: "d6 mag",
    damageType: "magic",
    burden: "two-handed",
    feature: {
      name: "Versatile",
      text: "This weapon can also be used with these statistics—Presence, Melee, d8."
    },
    source: "core"
  },
  {
    id: "shortbow",
    name: "Shortbow",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Far",
    damage: "d6+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "shortstaff",
    name: "Shortstaff",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "instinct",
    range: "Close",
    damage: "d8+1 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "shortsword",
    name: "Shortsword",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Paired",
      text: "+2 to primary weapon damage to targets within Melee range"
    },
    source: "core"
  },
  {
    id: "small-dagger",
    name: "Small Dagger",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Paired",
      text: "+2 to primary weapon damage to targets within Melee range"
    },
    source: "core"
  },
  {
    id: "spear",
    name: "Spear",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Very Close",
    damage: "d8+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: null,
    source: "core"
  },
  {
    id: "tower-shield",
    name: "Tower Shield",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d6 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Barrier",
      text: "+2 to Armor Score; -1 to Evasion"
    },
    source: "core"
  },
  {
    id: "wand",
    name: "Wand",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "knowledge",
    range: "Far",
    damage: "d6+1 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: null,
    source: "core"
  },
  {
    id: "warhammer",
    name: "Warhammer",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d12+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: {
      name: "Heavy",
      text: "-1 to Evasion"
    },
    source: "core"
  },
  {
    id: "whip",
    name: "Whip",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "presence",
    range: "Very Close",
    damage: "d6 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Startling",
      text: "Mark a Stress to crack the whip and force all adversaries within Melee range back to Close range."
    },
    source: "core"
  },
  {
    id: "brawler-s-strike",
    name: "Brawler’s Strike",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "choice",
    range: "Melee",
    damage: "d8+d6 phy",
    damageType: "physical",
    burden: "barehanded",
    feature: {
      name: "I Am the Weapon",
      text: "Equipped while you have no other Active Weapons; both dice scale with your Proficiency. +1 to Evasion while it’s active."
    },
    source: "hope-and-fear",
    classId: "brawler"
  },
  {
    id: "katana",
    name: "Katana",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Melee",
    damage: "d10+3 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: {
      name: "Quick",
      text: "When you make an attack, you can mark a Stress to target another creature within range."
    },
    source: "hope-and-fear"
  },
  {
    id: "brass-knuckles",
    name: "Brass Knuckles",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d8+1 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: null,
    source: "hope-and-fear"
  },
  {
    id: "scimitar",
    name: "Scimitar",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "presence",
    range: "Melee",
    damage: "d8+1 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: null,
    source: "hope-and-fear"
  },
  {
    id: "twisted-dagger",
    name: "Twisted Dagger",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "knowledge",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Piercing",
      text: "Damage dealt with this weapon treats the target’s Major threshold as having a −2 penalty."
    },
    source: "hope-and-fear"
  },
  {
    id: "whipsword",
    name: "Whipsword",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Very Close",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Versatile",
      text: "This weapon can also be used with these statistics—Finesse, Melee, d10."
    },
    source: "hope-and-fear"
  },
  {
    id: "rope-dart",
    name: "Rope Dart",
    slot: "primary",
    category: "physical",
    tier: 1,
    trait: "instinct",
    range: "Close",
    damage: "d6+1 phy",
    damageType: "physical",
    burden: "two-handed",
    feature: null,
    source: "hope-and-fear"
  },
  {
    id: "brightsword",
    name: "Brightsword",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d10+3 mag",
    damageType: "magic",
    burden: "two-handed",
    feature: null,
    source: "hope-and-fear"
  },
  {
    id: "shadowblade",
    name: "Shadowblade",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "presence",
    range: "Melee",
    damage: "d8 phy/mag",
    damageType: "either",
    burden: "one-handed",
    feature: {
      name: "Otherworldly",
      text: "On a successful attack, you can deal physical or magic damage."
    },
    source: "hope-and-fear"
  },
  {
    id: "enchanted-chakram",
    name: "Enchanted Chakram",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "finesse",
    range: "Close",
    damage: "d6+1 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: {
      name: "Ricochet",
      text: "When you throw this weapon, it returns to your hand. When you make an attack, you can mark a Stress to target another creature within Very Close range of the first target with that attack."
    },
    source: "hope-and-fear"
  },
  {
    id: "casting-dagger",
    name: "Casting Dagger",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "instinct",
    range: "Close",
    damage: "d6 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: {
      name: "Versatile",
      text: "This weapon can also be used with these statistics—Instinct, Melee, d8."
    },
    source: "hope-and-fear"
  },
  {
    id: "runelock-pistol",
    name: "Runelock Pistol",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "knowledge",
    range: "Far",
    damage: "d6+3 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: {
      name: "Reloading",
      text: "After you make an attack, roll a d6. On a result of 1, you must mark a Stress to reload this weapon before you can fire it again."
    },
    source: "hope-and-fear"
  },
  {
    id: "arcane-rifle",
    name: "Arcane Rifle",
    slot: "primary",
    category: "magic",
    tier: 1,
    trait: "agility",
    range: "Very Far",
    damage: "d10+3 mag",
    damageType: "magic",
    burden: "two-handed",
    feature: {
      name: "Aimed",
      text: "Your attack has disadvantage if the target is within Very Close range of you or within Melee range of one of your allies. You can mark a Stress to ignore this penalty."
    },
    source: "hope-and-fear"
  },
  {
    id: "hatchet",
    name: "Hatchet",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "agility",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Follow-Up",
      text: "On a successful attack with your primary weapon within Melee range, you can mark a Stress to gain a +1 bonus to your Proficiency for this attack."
    },
    source: "hope-and-fear"
  },
  {
    id: "offhand-brass-knuckles",
    name: "Offhand Brass Knuckles",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "strength",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Paired",
      text: "+2 to primary weapon damage to targets within Melee range"
    },
    source: "hope-and-fear"
  },
  {
    id: "throwing-knives",
    name: "Throwing Knives",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "finesse",
    range: "Melee",
    damage: "d8 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Stockpiled",
      text: "You can throw this weapon within Close range by making an attack roll using Finesse. You don’t have to retrieve it, as you always have another on hand."
    },
    source: "hope-and-fear"
  },
  {
    id: "fighting-cloak",
    name: "Fighting Cloak",
    slot: "secondary",
    category: "physical",
    tier: 1,
    trait: "presence",
    range: "Melee",
    damage: "d4 phy",
    damageType: "physical",
    burden: "one-handed",
    feature: {
      name: "Padded",
      text: "+2 to damage thresholds"
    },
    source: "hope-and-fear"
  },
  {
    id: "rune-shield",
    name: "Rune Shield",
    slot: "secondary",
    category: "magic",
    tier: 1,
    trait: "knowledge",
    range: "Melee",
    damage: "d4 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: {
      name: "Protective",
      text: "+1 to Armor Score"
    },
    source: "hope-and-fear"
  },
  {
    id: "focus-runes",
    name: "Focus Runes",
    slot: "secondary",
    category: "magic",
    tier: 1,
    trait: "instinct",
    range: "Very Close",
    damage: "d6 mag",
    damageType: "magic",
    burden: "one-handed",
    feature: {
      name: "Focused",
      text: "+1 to primary weapon damage to targets within Very Close range"
    },
    source: "hope-and-fear"
  }
];

export const ARMOR: readonly Armor[] = [
  {
    id: "chainmail-armor",
    name: "Chainmail Armor",
    tier: 1,
    baseThresholds: {
      major: 7,
      severe: 15
    },
    baseScore: 4,
    feature: {
      name: "Heavy",
      text: "-1 to Evasion"
    },
    source: "core"
  },
  {
    id: "full-plate-armor",
    name: "Full Plate Armor",
    tier: 1,
    baseThresholds: {
      major: 8,
      severe: 17
    },
    baseScore: 4,
    feature: {
      name: "Very Heavy",
      text: "-2 to Evasion; -1 to Agility"
    },
    source: "core"
  },
  {
    id: "gambeson-armor",
    name: "Gambeson Armor",
    tier: 1,
    baseThresholds: {
      major: 5,
      severe: 11
    },
    baseScore: 3,
    feature: {
      name: "Flexible",
      text: "+1 to Evasion"
    },
    source: "core"
  },
  {
    id: "leather-armor",
    name: "Leather Armor",
    tier: 1,
    baseThresholds: {
      major: 6,
      severe: 13
    },
    baseScore: 3,
    feature: null,
    source: "core"
  },
  {
    id: "mage-robes",
    name: "Mage Robes",
    tier: 1,
    baseThresholds: {
      major: 4,
      severe: 10
    },
    baseScore: 2,
    feature: {
      name: "Enchanted",
      text: "Gain a bonus to your damage thresholds equal to your Spellcast trait."
    },
    source: "hope-and-fear"
  },
  {
    id: "brigandine-armor",
    name: "Brigandine Armor",
    tier: 1,
    baseThresholds: {
      major: 6,
      severe: 12
    },
    baseScore: 3,
    feature: {
      name: "Lined",
      text: "Mark a Stress to negate Minor damage."
    },
    source: "hope-and-fear"
  },
  {
    id: "scale-mail-armor",
    name: "Scale Mail Armor",
    tier: 1,
    baseThresholds: {
      major: 7,
      severe: 14
    },
    baseScore: 3,
    feature: {
      name: "Cumbersome",
      text: "−1 to Finesse"
    },
    source: "hope-and-fear"
  },
  {
    id: "banded-armor",
    name: "Banded Armor",
    tier: 1,
    baseThresholds: {
      major: 8,
      severe: 16
    },
    baseScore: 4,
    feature: {
      name: "Bulky",
      text: "−1 to Evasion; when you take Severe damage, you must mark a Stress."
    },
    source: "hope-and-fear"
  }
];

export const STARTING_SUGGESTIONS: Readonly<Record<ClassId, StartingSuggestion>> = {
  bard: {
    traits: {
      agility: 0,
      strength: -1,
      finesse: 1,
      instinct: 0,
      presence: 2,
      knowledge: 1
    },
    primaryWeapon: "rapier",
    secondaryWeapon: "small-dagger",
    armor: "gambeson-armor"
  },
  druid: {
    traits: {
      agility: 1,
      strength: 0,
      finesse: 1,
      instinct: 2,
      presence: -1,
      knowledge: 0
    },
    primaryWeapon: "shortstaff",
    secondaryWeapon: "round-shield",
    armor: "leather-armor"
  },
  guardian: {
    traits: {
      agility: 1,
      strength: 2,
      finesse: -1,
      instinct: 0,
      presence: 1,
      knowledge: 0
    },
    primaryWeapon: "battleaxe",
    secondaryWeapon: null,
    armor: "chainmail-armor"
  },
  ranger: {
    traits: {
      agility: 2,
      strength: 0,
      finesse: 1,
      instinct: 1,
      presence: -1,
      knowledge: 0
    },
    primaryWeapon: "shortbow",
    secondaryWeapon: null,
    armor: "leather-armor"
  },
  rogue: {
    traits: {
      agility: 1,
      strength: -1,
      finesse: 2,
      instinct: 0,
      presence: 1,
      knowledge: 0
    },
    primaryWeapon: "dagger",
    secondaryWeapon: "small-dagger",
    armor: "gambeson-armor"
  },
  seraph: {
    traits: {
      agility: 0,
      strength: 2,
      finesse: 0,
      instinct: 1,
      presence: 1,
      knowledge: -1
    },
    primaryWeapon: "hallowed-axe",
    secondaryWeapon: "round-shield",
    armor: "chainmail-armor"
  },
  sorcerer: {
    traits: {
      agility: 0,
      strength: -1,
      finesse: 1,
      instinct: 2,
      presence: 1,
      knowledge: 0
    },
    primaryWeapon: "dualstaff",
    secondaryWeapon: null,
    armor: "gambeson-armor"
  },
  warrior: {
    traits: {
      agility: 2,
      strength: 1,
      finesse: 0,
      instinct: 1,
      presence: -1,
      knowledge: 0
    },
    primaryWeapon: "longsword",
    secondaryWeapon: null,
    armor: "chainmail-armor"
  },
  wizard: {
    traits: {
      agility: -1,
      strength: 0,
      finesse: 0,
      instinct: 1,
      presence: 1,
      knowledge: 2
    },
    primaryWeapon: "greatstaff",
    secondaryWeapon: null,
    armor: "leather-armor"
  },
  assassin: {
    traits: {
      agility: 2,
      strength: -1,
      finesse: 1,
      instinct: 0,
      presence: 0,
      knowledge: 1
    },
    primaryWeapon: "katana",
    secondaryWeapon: null,
    armor: "brigandine-armor"
  },
  brawler: {
    traits: {
      agility: 1,
      strength: 1,
      finesse: 0,
      instinct: 2,
      presence: 0,
      knowledge: -1
    },
    primaryWeapon: "brawler-s-strike",
    secondaryWeapon: null,
    armor: "brigandine-armor"
  },
  warlock: {
    traits: {
      agility: 1,
      strength: -1,
      finesse: 0,
      instinct: 1,
      presence: 2,
      knowledge: 0
    },
    primaryWeapon: "scimitar",
    secondaryWeapon: "fighting-cloak",
    armor: "mage-robes"
  },
  witch: {
    traits: {
      agility: 0,
      strength: -1,
      finesse: 0,
      instinct: 2,
      presence: 1,
      knowledge: 1
    },
    primaryWeapon: "casting-dagger",
    secondaryWeapon: "rune-shield",
    armor: "mage-robes"
  }
};

export const EXPERIENCE_SUGGESTIONS: readonly ExperienceSuggestionGroup[] = [
  {
    category: "Backgrounds",
    examples: [
      "Assassin",
      "Blacksmith",
      "Bodyguard",
      "Bounty Hunter",
      "Chef to the Royal Family",
      "Circus Performer",
      "Con Artist",
      "Fallen Monarch",
      "Field Medic",
      "High Priestess",
      "Merchant",
      "Noble",
      "Pirate",
      "Politician",
      "Runaway",
      "Scholar",
      "Sellsword",
      "Soldier",
      "Storyteller",
      "Thief",
      "World Traveler"
    ]
  },
  {
    category: "Characteristics",
    examples: [
      "Affable",
      "Battle-Hardened",
      "Bookworm",
      "Charming",
      "Cowardly",
      "Friend to All",
      "Helpful",
      "Intimidating Presence",
      "Leader",
      "Lone Wolf",
      "Loyal",
      "Observant",
      "Prankster",
      "Silver Tongue",
      "Sticky Fingers",
      "Stubborn to a Fault",
      "Survivor",
      "Young and Naive"
    ]
  },
  {
    category: "Specialties",
    examples: [
      "Acrobat",
      "Gambler",
      "Healer",
      "Inventor",
      "Magical Historian",
      "Mapmaker",
      "Master of Disguise",
      "Navigator",
      "Sharpshooter",
      "Survivalist",
      "Swashbuckler",
      "Tactician"
    ]
  },
  {
    category: "Skills",
    examples: [
      "Animal Whisperer",
      "Barter",
      "Deadly Aim",
      "Fast Learner",
      "Incredible Strength",
      "Liar",
      "Light Feet",
      "Negotiator",
      "Photographic Memory",
      "Quick Hands",
      "Repair",
      "Scavenger",
      "Tracker"
    ]
  },
  {
    category: "Phrases",
    examples: [
      "Catch Me If You Can",
      "Fake It Till You Make It",
      "First Time’s the Charm",
      "Hold the Line",
      "I Won’t Let You Down",
      "I’ll Catch You",
      "I’ve Got Your Back",
      "Knowledge Is Power",
      "Nature’s Friend",
      "Never Again",
      "No One Left Behind",
      "Pick on Someone Your Own Size",
      "The Show Must Go On",
      "This Is Not a Negotiation",
      "Wolf in Sheep’s Clothing"
    ]
  }
];
