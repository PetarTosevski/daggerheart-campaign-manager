// Ancestries, communities and transformations.
// Extracted verbatim from the Party design board (reference/designs/project/Party.dc.html).
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { Ancestry, Community, Transformation } from "./types";

export const ANCESTRIES: readonly Ancestry[] = [
  {
    id: "clank",
    name: "Clank",
    source: "core",
    features: [
      {
        name: "Purposeful Design",
        text: "Decide who made you and for what purpose. At character creation, choose one of your Experiences that best aligns with this purpose and gain a permanent +1 bonus to it."
      },
      {
        name: "Efficient",
        text: "When you take a short rest, you can choose a long rest move instead of a short rest move."
      }
    ]
  },
  {
    id: "drakona",
    name: "Drakona",
    source: "core",
    features: [
      {
        name: "Scales",
        text: "Your scales act as natural protection. When you would take Severe damage, you can mark a Stress to mark 1 fewer Hit Points."
      },
      {
        name: "Elemental Breath",
        text: "Choose an element for your breath (such as electricity, fire, or ice). You can use this breath against a target or group of targets within Very Close range, treating it as an Instinct weapon that deals d8 magic damage using your Proficiency."
      }
    ]
  },
  {
    id: "dwarf",
    name: "Dwarf",
    source: "core",
    features: [
      {
        name: "Thick Skin",
        text: "When you take Minor damage, you can mark 2 Stress instead of marking a Hit Point."
      },
      {
        name: "Increased Fortitude",
        text: "Spend 3 Hope to halve incoming physical damage."
      }
    ]
  },
  {
    id: "elf",
    name: "Elf",
    source: "core",
    features: [
      {
        name: "Quick Reactions",
        text: "Mark a Stress to gain advantage on a reaction roll."
      },
      {
        name: "Celestial Trance",
        text: "During a rest, you can drop into a trance to choose an additional downtime move."
      }
    ]
  },
  {
    id: "faerie",
    name: "Faerie",
    source: "core",
    features: [
      {
        name: "Luckbender",
        text: "Once per session, after you or a willing ally within Close range makes an action roll, you can spend 3 Hope to reroll the Duality Dice."
      },
      {
        name: "Wings",
        text: "You can fly. While flying, you can mark a Stress after an adversary makes an attack against you to gain a +2 bonus to your Evasion against that attack."
      }
    ]
  },
  {
    id: "faun",
    name: "Faun",
    source: "core",
    features: [
      {
        name: "Caprine Leap",
        text: "You can leap anywhere within Close range as though you were using normal movement, allowing you to vault obstacles, jump across gaps, or scale barriers with ease."
      },
      {
        name: "Kick",
        text: "When you succeed on an attack against a target within Melee range, you can mark a Stress to kick yourself off them, dealing an extra 2d6 damage and knocking back either yourself or the target to Very Close range."
      }
    ]
  },
  {
    id: "firbolg",
    name: "Firbolg",
    source: "core",
    features: [
      {
        name: "Charge",
        text: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."
      },
      {
        name: "Unshakable",
        text: "When you would mark a Stress, roll a d6. On a result of 6, don't mark it."
      }
    ]
  },
  {
    id: "fungril",
    name: "Fungril",
    source: "core",
    features: [
      {
        name: "Fungril Network",
        text: "Make an Instinct Roll (12) to use your mycelial array to speak with others of your ancestry. On a success, you can communicate across any distance."
      },
      {
        name: "Death Connection",
        text: "While touching a corpse that died recently, you can mark a Stress to extract one memory from the corpse related to a specific emotion or sensation of your choice."
      }
    ]
  },
  {
    id: "galapa",
    name: "Galapa",
    source: "core",
    features: [
      {
        name: "Shell",
        text: "Gain a bonus to your damage thresholds equal to your Proficiency."
      },
      {
        name: "Retract",
        text: "Mark a Stress to retract into your shell. While in your shell, you have resistance to physical damage, you have disadvantage on action rolls, and you can't move."
      }
    ]
  },
  {
    id: "giant",
    name: "Giant",
    source: "core",
    features: [
      {
        name: "Endurance",
        text: "Gain an additional Hit Point slot at character creation."
      },
      {
        name: "Reach",
        text: "Treat any weapon, ability, spell, or other feature that has a Melee range as though it has a Very Close range instead."
      }
    ]
  },
  {
    id: "goblin",
    name: "Goblin",
    source: "core",
    features: [
      {
        name: "Surefooted",
        text: "You ignore disadvantage on Agility Rolls."
      },
      {
        name: "Danger Sense",
        text: "Once per rest, mark a Stress to force an adversary to reroll an attack against you or an ally within Very Close range."
      }
    ]
  },
  {
    id: "halfling",
    name: "Halfling",
    source: "core",
    features: [
      {
        name: "Luckbringer",
        text: "At the start of each session, everyone in your party gains a Hope."
      },
      {
        name: "Internal Compass",
        text: "When you roll a 1 on your Hope Die, you can reroll it."
      }
    ]
  },
  {
    id: "human",
    name: "Human",
    source: "core",
    features: [
      {
        name: "High Stamina",
        text: "Gain an additional Stress slot at character creation."
      },
      {
        name: "Adaptability",
        text: "When you fail a roll that utilized one of your Experiences, you can mark a Stress to reroll."
      }
    ]
  },
  {
    id: "infernis",
    name: "Infernis",
    source: "core",
    features: [
      {
        name: "Fearless",
        text: "When you roll with Fear, you can mark 2 Stress to change it into a roll with Hope instead."
      },
      {
        name: "Dread Visage",
        text: "You have advantage on rolls to intimidate hostile creatures."
      }
    ]
  },
  {
    id: "katari",
    name: "Katari",
    source: "core",
    features: [
      {
        name: "Feline Instincts",
        text: "When you make an Agility Roll, you can spend 2 Hope to reroll your Hope Die."
      },
      {
        name: "Retracting Claws",
        text: "Make an Agility Roll to scratch a target within Melee range. On a success, they become temporarily Vulnerable."
      }
    ]
  },
  {
    id: "orc",
    name: "Orc",
    source: "core",
    features: [
      {
        name: "Sturdy",
        text: "When you have 1 Hit Point remaining, attacks against you have disadvantage."
      },
      {
        name: "Tusks",
        text: "When you succeed on an attack against a target within Melee range, you can spend a Hope to gore the target with your tusks, dealing an extra 1d6 damage."
      }
    ]
  },
  {
    id: "ribbet",
    name: "Ribbet",
    source: "core",
    features: [
      {
        name: "Amphibious",
        text: "You can breathe and move naturally underwater."
      },
      {
        name: "Long Tongue",
        text: "You can use your long tongue to grab onto things within Close range. Mark a Stress to use your tongue as a Finesse Close weapon that deals d12 physical damage using your Proficiency."
      }
    ]
  },
  {
    id: "simiah",
    name: "Simiah",
    source: "core",
    features: [
      {
        name: "Natural Climber",
        text: "You have advantage on Agility Rolls that involve balancing and climbing."
      },
      {
        name: "Nimble",
        text: "Gain a permanent +1 bonus to your Evasion at character creation."
      }
    ]
  },
  {
    id: "aetheris",
    name: "Aetheris",
    source: "hope-and-fear",
    features: [
      {
        name: "Hallowed Aura",
        text: "Once per long rest when an ally within Close range rolls with Fear, you can change it into a roll with Hope instead."
      },
      {
        name: "Celestial Wings",
        text: "You have wings that allow you to fly. Once per scene while flying, you can spend a Hope instead of marking an Armor Slot."
      }
    ]
  },
  {
    id: "earthkin",
    name: "Earthkin",
    source: "hope-and-fear",
    features: [
      {
        name: "Stoneskin",
        text: "Gain a permanent +1 bonus to your Armor Score and damage thresholds at character creation."
      },
      {
        name: "Immovable",
        text: "While you’re touching the ground, you can’t be lifted or moved against your will."
      }
    ]
  },
  {
    id: "emberkin",
    name: "Emberkin",
    source: "hope-and-fear",
    features: [
      {
        name: "Fireproof",
        text: "You are immune to damage from magical or mundane flame."
      },
      {
        name: "Ignition",
        text: "Mark a Stress to wreathe your primary weapon in flame until the end of the scene. While the weapon is ablaze, it gives off a bright light, and you gain a 1d6 bonus to damage rolls with that weapon."
      }
    ]
  },
  {
    id: "gnome",
    name: "Gnome",
    source: "hope-and-fear",
    features: [
      {
        name: "Nimble Fingers",
        text: "When you make a Finesse Roll, you can spend 2 Hope to reroll your Hope Die."
      },
      {
        name: "Flicker Step",
        text: "Once per scene, you can teleport to another point you can see within Far range."
      }
    ]
  },
  {
    id: "skykin",
    name: "Skykin",
    source: "hope-and-fear",
    features: [
      {
        name: "Gale Force",
        text: "Mark a Stress to conjure a gust of wind that carries you or a Very Close ally up to Very Far range. Additionally, you can always control the speed at which you fall."
      },
      {
        name: "Eye of the Storm",
        text: "Spend 2 Hope to grant you or an ally within Melee range a +1 bonus to Evasion until you take Severe damage or you use this feature again."
      }
    ]
  },
  {
    id: "tidekin",
    name: "Tidekin",
    source: "hope-and-fear",
    features: [
      {
        name: "Amphibious",
        text: "You can breathe and move naturally underwater."
      },
      {
        name: "Lifespring",
        text: "Once per rest when you have access to a small amount of water, you can mark a Stress to clear a Hit Point on yourself or an ally within Very Close range."
      }
    ]
  }
];

export const COMMUNITIES: readonly Community[] = [
  {
    id: "highborne",
    name: "Highborne",
    source: "core",
    feature: {
      name: "Privilege",
      text: "You have advantage on rolls to consort with nobles, negotiate prices, or leverage your reputation to get what you want."
    },
    often: "amiable, candid, conniving, enterprising, ostentatious, and unflappable"
  },
  {
    id: "loreborne",
    name: "Loreborne",
    source: "core",
    feature: {
      name: "Well-Read",
      text: "You have advantage on rolls that involve the history, culture, or politics of a prominent person or place."
    },
    often: "direct, eloquent, inquisitive, patient, rhapsodic, and witty"
  },
  {
    id: "orderborne",
    name: "Orderborne",
    source: "core",
    feature: {
      name: "Dedicated",
      text: "Record three sayings or values your upbringing instilled in you. Once per rest, when you describe how you're embodying one of these principles through your current action, you can roll a d20 as your Hope Die."
    },
    often: "ambitious, benevolent, pensive, prudent, sardonic, and stoic"
  },
  {
    id: "ridgeborne",
    name: "Ridgeborne",
    source: "core",
    feature: {
      name: "Steady",
      text: "You have advantage on rolls to traverse dangerous cliffs and ledges, navigate harsh environments, and use your survival knowledge."
    },
    often: "bold, hardy, indomitable, loyal, reserved, and stubborn"
  },
  {
    id: "seaborne",
    name: "Seaborne",
    source: "core",
    feature: {
      name: "Know the Tide",
      text: "You can sense the ebb and flow of life. When you roll with Fear, place a token on your community card. You can hold a number of tokens equal to your level. Before you make an action roll, you can spend any number of these tokens to gain a +1 bonus to the roll for each token spent. At the end of each session, clear all unspent tokens."
    },
    often: "candid, cooperative, exuberant, fierce, resolute, and weathered"
  },
  {
    id: "slyborne",
    name: "Slyborne",
    source: "core",
    feature: {
      name: "Scoundrel",
      text: "You have advantage on rolls to negotiate with criminals, detect lies, or find a safe place to hide."
    },
    often: "calculating, clever, formidable, perceptive, shrewd, and tenacious"
  },
  {
    id: "underborne",
    name: "Underborne",
    source: "core",
    feature: {
      name: "Low-Light Living",
      text: "When you're in an area with low light or heavy shadow, you have advantage on rolls to hide, investigate, or perceive details within that area."
    },
    often: "composed, elusive, indomitable, innovative, resourceful, and unpretentious"
  },
  {
    id: "wanderborne",
    name: "Wanderborne",
    source: "core",
    feature: {
      name: "Nomadic Pack",
      text: "Add a Nomadic Pack to your inventory. Once per session, you can spend a Hope to reach into this pack and pull out a mundane item that's useful to your situation. Work with the GM to figure out what item you take out."
    },
    often: "inscrutable, magnanimous, mirthful, reliable, savvy, and unorthodox"
  },
  {
    id: "wildborne",
    name: "Wildborne",
    source: "core",
    feature: {
      name: "Lightfoot",
      text: "Your movement is naturally silent. You have advantage on rolls to move without being heard."
    },
    often: "hardy, loyal, nurturing, reclusive, sagacious, and vibrant"
  },
  {
    id: "duneborne",
    name: "Duneborne",
    source: "hope-and-fear",
    feature: {
      name: "Oasis",
      text: "During a short rest, you or an ally can reroll a die used for a downtime move and take the higher result."
    },
    often: "adaptable, centered, collaborative, devoted, cheerful, and observant"
  },
  {
    id: "freeborne",
    name: "Freeborne",
    source: "hope-and-fear",
    feature: {
      name: "Unbound",
      text: "Once per session when you roll with Fear, you can change it into a roll with Hope instead."
    },
    often: "optimistic, guarded, courageous, joyful, subversive, and traumatized"
  },
  {
    id: "frostborne",
    name: "Frostborne",
    source: "hope-and-fear",
    feature: {
      name: "Hardy",
      text: "When you take a rest, you clear a Hit Point."
    },
    often: "cunning, gregarious, intrepid, purposeful, quiet, and warm"
  },
  {
    id: "hearthborne",
    name: "Hearthborne",
    source: "hope-and-fear",
    feature: {
      name: "Close-Knit",
      text: "Once per long rest, you can spend any number of Hope to grant an ally within Far range an equal number of Hope."
    },
    often: "careful, generous, insular, loquacious, smiley, and traditional"
  },
  {
    id: "reborne",
    name: "Reborne",
    source: "hope-and-fear",
    feature: {
      name: "Found Family",
      text: "Once per rest, you can spend a Hope to use an ally’s Experience as if it were your own. When you do so, describe how your time with that ally prepared you for this moment. When you join a new community or rediscover your old one, you can permanently trade this card for that one instead."
    },
    often: "curious, hopeful, innocent, isolated, mournful, and uncanny"
  },
  {
    id: "warborne",
    name: "Warborne",
    source: "hope-and-fear",
    feature: {
      name: "Brave Face",
      text: "Once per session when you would be forced to mark a Stress, you can spend a Hope instead."
    },
    often: "strategic, devastated, determined, calculating, unwavering, and devoted"
  }
];

export const TRANSFORMATIONS: readonly Transformation[] = [
  {
    id: "demigod",
    name: "Demigod",
    source: "hope-and-fear",
    tagline: "Blood of the gods",
    description: "Demigods are mortal creatures whose veins flow with the blood of the gods. They typically gain their power from divine parentage, accomplishing an incredible feat, or receiving a gift from a god. Not everything a demigod inherits is a blessing: the expectations set upon them are often difficult and costly to live up to.",
    features: [
      {
        name: "Gifted",
        text: "You gain a +1 bonus to action, reaction, and damage rolls."
      },
      {
        name: "Weight of Divinity",
        text: "When you fail a roll, you must mark a Stress or the GM gains a Fear."
      }
    ],
    questions: [
      "Your divinity has affected an aspect of your appearance. In what way do you look different from others?",
      "Who bestowed demigod status upon you, and what trial did you complete to earn this gift?",
      "You were made fun of as a child for your divine parentage. Why?",
      "Why was the knowledge that you are a demigod kept from you for many years? Who kept this secret?",
      "You have an obligation you must fulfill due to the immortal blood that runs in your veins. What is this duty?",
      "In what way did your divinity initially manifest? Why did it surprise you?"
    ]
  },
  {
    id: "ghost",
    name: "Ghost",
    source: "hope-and-fear",
    tagline: "Bound to the Mortal Realm",
    description: "Ghosts are the spirits of the once-living who are bound to the Mortal Realm. Because they occupy the space between life and death, a ghost can shift between the physical and the spectral and, at times, pass through solid objects. When they complete the goal that binds them, they pass beyond the veil of death.",
    features: [
      {
        name: "Unfinished Business",
        text: "Work with your GM to decide what purpose or desire keeps you bound to the Mortal Realm. When you fulfill it, you cross through the veil of death."
      },
      {
        name: "Ephemeral",
        text: "Your body wavers in and out of being corporeal. You are resistant to physical damage, take double magic damage, and can mark 2 Stress to momentarily pass through a solid object."
      }
    ],
    questions: [
      "How did you die, and what fear has your death instilled in you?",
      "What brought you back from beyond the veil of death?",
      "In life, you loved someone dearly. Why do you need to find them again?",
      "What must you accomplish now that you’ve returned to the Mortal Realm? How will you meet your goal?",
      "Who harmed you in your first life? How do you plan to deal with them now that you’ve returned?",
      "You had to sacrifice something dear to you in order to come back to the Mortal Realm. What did you give up, and who did you give it to?"
    ]
  },
  {
    id: "reanimated",
    name: "Reanimated",
    source: "hope-and-fear",
    tagline: "A corpse brought back",
    description: "Reanimated are corpses who have been brought back to life through a spell, a holy ritual, arcane experimentation, or other unnatural methods. Bound to their decaying bodies, they must patch and repair themselves with bones, flesh, and other materials harvested from the recently deceased.",
    features: [
      {
        name: "Corpse",
        text: "During a rest, you can clear Hit Points only if you have access to remains from a recently deceased creature. Describe how you use these materials to maintain your corpse."
      },
      {
        name: "Won’t Stay Dead",
        text: "When you choose the Risk It All death move and fail, you can permanently mark a Hit Point to succeed instead. When you do, you still use the Hope Die’s value to clear Hit Points and Stress. When you permanently mark your last Hit Point, you pass through the veil of death."
      }
    ],
    questions: [
      "How did you first die, and how has that death affected your view on life?",
      "A fragment of memory from your first life haunts you. What is the memory, and why do you think it’s important?",
      "You had a dream for your life that you now believe you can never reach. What was your dream, and why do you think being reanimated makes it impossible to fulfill?",
      "How were you brought back from the dead, and how did the process change your body?",
      "Someone brought you back from death. Who were they, and how do you feel about this person and what they did to you?",
      "In the brief time you passed through the veil of death, you saw something that changed you forever. What was it?"
    ]
  },
  {
    id: "shapeshifter",
    name: "Shapeshifter",
    source: "hope-and-fear",
    tagline: "Any form, one constant",
    description: "Shapeshifters are creatures who can change their physical form into any ancestry. Each shapeshifter keeps one characteristic that never changes, such as their eyes, their coloring, or a unique birthmark, and they can’t mimic a specific person’s appearance.",
    features: [
      {
        name: "Change Shape",
        text: "During a rest, you can use a downtime move to swap your current ancestry with another. When you do, describe how your appearance changes."
      },
      {
        name: "Only Skin Deep",
        text: "You gain the benefit of only one of your chosen ancestry’s features, which you select when you choose the ancestry. You can use a downtime move to choose a different feature from that ancestry."
      }
    ],
    questions: [
      "You believe you have a “true form,” but you haven’t seen it. What do you think it is, and how do you know it’s there?",
      "What trick have you developed to identify other shapeshifters?",
      "Someone you loved dearly abandoned you when they found out about your ability to change shape. Who was it, and what happened?",
      "What is one form you’ve vowed to never take, and why?",
      "Which ancestry do you live as more than others? Why do you spend so much time in this form?",
      "Someone you know can instantly recognize you, no matter your form. How do they claim to identify you and what does their familiarity mean to you?"
    ]
  },
  {
    id: "vampire",
    name: "Vampire",
    source: "hope-and-fear",
    tagline: "Undead, hungry for blood",
    description: "Vampires are undead creatures with sharp fangs who feed on the blood of the living. They aren’t born, but created: sired by another vampire, transformed through an occult ritual, or changed through other mysterious methods. All vampires possess enhanced abilities that can result in a terrifying end for their targets.",
    features: [
      {
        name: "Fangs",
        text: "Make an attack using a trait of your choice to bite a target within Melee range. On a success, deal d6 physical damage using your Proficiency."
      },
      {
        name: "Feed",
        text: "On a successful “Fangs” attack against a creature that can bleed, you can mark a Stress to feed. Place a number of tokens on this card equal to the number of Hit Points the target marks. You can hold up to 6 tokens at a time. Before you make an action roll, you can spend a token to make your Fear Die a d20. When you take a long rest, remove a token. While there are no tokens on this card, you make action and reaction rolls with disadvantage."
      }
    ],
    questions: [
      "Who did you have to leave behind when you became a vampire, and why was it so hard to let them go?",
      "You once killed an innocent for their blood. What characteristic of theirs do you notice most in others?",
      "What does your vampirism make you particularly vulnerable to?",
      "Who were you able to save using your vampiric power? What happened, and how do they feel about you now?",
      "How does your hunger for blood change you?",
      "The vampire who sired you still has a hold over you. What’s their name, and what do they want you to do for them?"
    ]
  },
  {
    id: "werewolf",
    name: "Werewolf",
    source: "hope-and-fear",
    tagline: "The wolf within",
    description: "Werewolves are creatures who transform into large supernatural wolves, whether born to it, cursed, or infected by another werewolf’s bite. They often struggle to control their hunting instinct and violence while in their wolf form, and must have immense self-discipline to avoid harming their loved ones.",
    features: [
      {
        name: "Wolf Form",
        text: "When you mark 1 or more Hit Points, you can mark a Stress to enter your Wolf Form. While in this form, you gain a 1d10 bonus to attack and damage rolls. When you gain a Hope while in Wolf Form, you must also mark a Stress. Your Wolf Form lasts until you go into your “Howling Rampage” or take a rest."
      },
      {
        name: "Howling Rampage",
        text: "When you mark your last Stress while in Wolf Form, you go into a rampage. Roll a number of d20s equal to your tier and deal that much physical damage to all creatures within Very Close range, then drop out of Wolf Form."
      }
    ],
    questions: [
      "Someone is hunting you. Who is it, and why do they want you dead?",
      "What were you afraid of before you became a werewolf, and how has your new power changed that fear?",
      "You hear your wolf form in your head as if it were another entity. What lie does it tell you about yourself, and why are you beginning to believe it?",
      "What led you to kill someone you love during your rampage?",
      "Who cursed you to become a werewolf?",
      "You were once entreated to join a pack of other werewolves. How did you respond?"
    ]
  }
];
