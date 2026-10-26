// Classes (Core Rulebook + Hope & Fear).
// Extracted verbatim from the Party design board (reference/designs/project/Party.dc.html).
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { ClassDef } from "./types";

export const CLASSES: readonly ClassDef[] = [
  {
    id: "bard",
    name: "Bard",
    source: "core",
    domains: [
      "grace",
      "codex"
    ],
    startingEvasion: 10,
    startingHp: 5,
    hopeFeature: {
      name: "Make a Scene",
      text: "Spend 3 Hope to temporarily Distract a target within Close range, giving them a −2 penalty to their Difficulty."
    },
    classFeatures: [
      {
        name: "Rally",
        text: "Once per session, describe how you rally the party and give yourself and each of your allies a Rally Die. At level 1, your Rally Die is a d6. A PC can spend their Rally Die to roll it, adding the result to their action roll, reaction roll, damage roll, or to clear a number of Stress equal to the result. At the end of each session, clear all unspent Rally Dice.\n\nAt level 5, your Rally Die increases to a d8."
      }
    ],
    subclasses: [
      "troubadour",
      "wordsmith"
    ],
    classItems: "a romance novel OR a letter never opened. Then decide what you carry your spells in: songbook, journal, etc.",
    clothes: "sleek, extravagant, wild, fancy, loud, oversize, ragged",
    attitude: "a ringmaster, a magician, a barkeep, a rockstar, a swashbuckler",
    backgroundQuestions: [
      "Who from your community taught you to have such confidence in yourself?",
      "You were in love once. Who was it with, and how did they hurt you?",
      "You’ve always looked up to another bard. Who are they and why do you idolize them?"
    ],
    connectionQuestions: [
      "What made you realize we were going to be such good friends?",
      "What do I do that annoys you?",
      "Why do you grab my hand at night?"
    ]
  },
  {
    id: "druid",
    name: "Druid",
    source: "core",
    domains: [
      "sage",
      "arcana"
    ],
    startingEvasion: 10,
    startingHp: 6,
    hopeFeature: {
      name: "Evolution",
      text: "Spend 3 Hope to transform into a Beastform without marking a Stress. When you do, choose one trait to raise by +1 until you drop out of that Beastform."
    },
    classFeatures: [
      {
        name: "Beastform",
        text: "Mark a Stress to magically transform into a creature of your tier or lower from the Beastform list. You can drop out of this form at any time. While transformed, you can’t use weapons or cast spells from domain cards, but you can still use other features or abilities you have access to. Spells you cast before you transform stay active and last for their normal duration, and you can talk and communicate as normal. Additionally, you gain the Beastform’s features, add their Evasion bonus to your Evasion, and use the trait specified in their statistics for your attack. While you’re in a Beastform, your armor becomes part of your body and you mark Armor Slots as usual; when you drop out of a Beastform, those marked Armor Slots remain marked. If you mark your last Hit Point, you automatically drop out of this form."
      },
      {
        name: "Wildtouch",
        text: "You can perform harmless, subtle effects that involve nature—such as causing a flower to rapidly grow, summoning a slight gust of wind, or starting a campfire—at will."
      }
    ],
    subclasses: [
      "warden-of-the-elements",
      "warden-of-renewal"
    ],
    classItems: "a small bag of rocks & bones OR a strange pendant found in the dirt.",
    clothes: "natural, grown, scraps, regal, patchwork, loose, camouflaged",
    attitude: "a guide, a hippie, a dog, a firecracker, a witch",
    backgroundQuestions: [
      "Why was the community you grew up in so reliant on nature and its creatures?",
      "What was the first bond you made with a wild animal? Why did it end?",
      "Who has been trying to hunt you down? What do you think they want from you?"
    ],
    connectionQuestions: [
      "What did you confess to me that makes me leap out into danger for you every time?",
      "What animal do I tell you that you remind me of?",
      "What affectionate nickname have you given me?"
    ]
  },
  {
    id: "guardian",
    name: "Guardian",
    source: "core",
    domains: [
      "valor",
      "blade"
    ],
    startingEvasion: 9,
    startingHp: 7,
    hopeFeature: {
      name: "Frontline Tank",
      text: "Spend 3 Hope to clear 2 Armor Slots."
    },
    classFeatures: [
      {
        name: "Unstoppable",
        text: "Once per long rest, you can become Unstoppable. You gain an Unstoppable Die. At level 1, your Unstoppable Die is a d4. Place it on your character sheet in the space provided, starting with the 1 value facing up. After you make a damage roll that deals 1 or more Hit Points to a target, increase the Unstoppable Die value by one. When the die’s value would exceed its maximum value or when the scene ends, remove the die and drop out of Unstoppable. At level 5, your Unstoppable Die increases to a d6.\n\nWhile Unstoppable, you gain the following benefits:\n• You reduce the severity of physical damage by one threshold (Severe to Major, Major to Minor, Minor to None).\n• You add the current value of the Unstoppable Die to your damage roll.\n• You can’t be Restrained or Vulnerable."
      }
    ],
    subclasses: [
      "stalwart",
      "vengeance"
    ],
    classItems: "a totem from your mentor OR a secret key.",
    clothes: "weathered, casual, padded, tactical, loose, intricate, royal",
    attitude: "a general, a caretaker, a wrestler, an elephant, a captain",
    backgroundQuestions: [
      "Who from your community did you fail to protect, and why do you still think of them?",
      "You’ve recently been tasked with protecting something important, with the goal of delivering it somewhere dangerous. What is it and where does it need to go?",
      "You consider an aspect of yourself to be a “weakness.” What is it, and how has it affected you?"
    ],
    connectionQuestions: [
      "How did I save your life the first time we met?",
      "What small gift did you give me that you notice I always carry with me?",
      "What lie have you told me about yourself that I absolutely believe?"
    ]
  },
  {
    id: "ranger",
    name: "Ranger",
    source: "core",
    domains: [
      "bone",
      "sage"
    ],
    startingEvasion: 12,
    startingHp: 6,
    hopeFeature: {
      name: "Hold Them Off",
      text: "Spend 3 Hope when you succeed on an attack with a weapon to use that same roll against two additional adversaries within range of the attack."
    },
    classFeatures: [
      {
        name: "Ranger’s Focus",
        text: "Spend a Hope and make an attack against a target. On a success, deal your attack’s normal damage and temporarily make the attack’s target your Focus.\n\nUntil this feature ends or you make a different creature your Focus, you gain the following benefits against your Focus:\n• You know precisely what direction they are in.\n• When you deal damage to them, they must mark a Stress.\n• When you fail an attack against them, you can end your Ranger’s Focus feature to reroll your Duality Dice."
      }
    ],
    subclasses: [
      "beastbound",
      "wayfinder"
    ],
    classItems: "a trophy from your first kill OR a seemingly-broken compass.",
    clothes: "natural, muted, tactical, tight, woven, flowing, stained",
    attitude: "a watchdog, a teacher, a survivalist, a ghost, a child",
    backgroundQuestions: [
      "A terrible creature hurt your community, and you’ve vowed to hunt them down. What are they, and what unique trail or sign do they leave behind anywhere they go?",
      "Your first kill almost killed you too. What was it, and what part of you was never the same after this event?",
      "You’ve traveled many dangerous lands, but what is the one place you refuse to go?"
    ],
    connectionQuestions: [
      "What friendly competition do we have?",
      "Why do you act differently when we’re alone than when others are around?",
      "What have you asked me to keep an eye out for, and why are you worried about it?"
    ]
  },
  {
    id: "rogue",
    name: "Rogue",
    source: "core",
    domains: [
      "midnight",
      "grace"
    ],
    startingEvasion: 12,
    startingHp: 6,
    hopeFeature: {
      name: "Rogue’s Dodge",
      text: "Spend 3 Hope to gain a +2 bonus to your Evasion until the next time an attack succeeds against you. Otherwise, this bonus lasts until your next rest."
    },
    classFeatures: [
      {
        name: "Cloaked",
        text: "Any time you would be Hidden, you are instead Cloaked. In addition to the benefits of the Hidden condition, while Cloaked you remain unseen if you are stationary when an adversary moves to where they would normally see you. After you make an attack or end a move within line of sight of an adversary, you are no longer Cloaked."
      },
      {
        name: "Sneak Attack",
        text: "When you succeed on an attack while Cloaked or while an ally is within Melee range of your target, add a number of d6s equal to your tier to your damage roll.\nLevel 1 = Tier 1\nLevels 2–4 = Tier 2\nLevels 5–7 = Tier 3\nLevels 8–10 = Tier 4"
      }
    ],
    subclasses: [
      "nightwalker",
      "syndicate"
    ],
    classItems: "forgery tools OR a grappling hook.",
    clothes: "dark, tight, clean, tactical, inconspicuous, leather, scary",
    attitude: "a conman, a bandit, a mob boss, a gambler, a pirate",
    backgroundQuestions: [
      "What did you get caught doing that had you exiled from your home community?",
      "You used to have a different life, but you’ve tried to leave it behind you. Who from that time is still chasing you?",
      "Who from that other life were you most sad to say goodbye to?"
    ],
    connectionQuestions: [
      "What did I recently convince you to do that got us both in trouble?",
      "What have I discovered about your past that I hold secret from the others?",
      "Who do you know from my past, and how have they affected your feelings about me?"
    ]
  },
  {
    id: "seraph",
    name: "Seraph",
    source: "core",
    domains: [
      "splendor",
      "valor"
    ],
    startingEvasion: 9,
    startingHp: 7,
    hopeFeature: {
      name: "Life Support",
      text: "Spend 3 Hope to clear a Hit Point on an ally within Close range."
    },
    classFeatures: [
      {
        name: "Prayer Dice",
        text: "At the beginning of each session, roll a number of d4s equal to your subclass’s Spellcast trait and place them on your character sheet in the space provided. These are your Prayer Dice. You can spend any number of Prayer Dice to aid yourself or an ally within Far range. You can use a spent die’s value to reduce incoming damage, add to a roll’s result after the roll is made, or gain Hope equal to the result. At the end of each session, clear all unspent Prayer Dice."
      }
    ],
    subclasses: [
      "divine-wielder",
      "winged-sentinel"
    ],
    classItems: "a bundle of offerings OR a sigil of your god.",
    clothes: "glowing, rippling, ornate, tight, modest, strange, natural",
    attitude: "a monk, an evangelist, a doctor, an angel, a priest",
    backgroundQuestions: [
      "Who is the god you have devoted yourself to, and in your moment of desperation, what incredible feat did they perform for you that made you indebted to them?",
      "How did your own appearance change after taking your oath?",
      "In what strange or unique way do you communicate with your god?"
    ],
    connectionQuestions: [
      "What promise did you make me agree to, should you die on the battlefield?",
      "Why do you ask me so many questions about my god?",
      "You’ve told me to protect one member of our party above all others, even yourself. Who is it and why?"
    ]
  },
  {
    id: "sorcerer",
    name: "Sorcerer",
    source: "core",
    domains: [
      "arcana",
      "midnight"
    ],
    startingEvasion: 10,
    startingHp: 6,
    hopeFeature: {
      name: "Volatile Magic",
      text: "Spend 3 Hope to reroll any number of your damage dice on an attack that deals magic damage."
    },
    classFeatures: [
      {
        name: "Arcane Sense",
        text: "You can sense the presence of magical people and objects within Close range."
      },
      {
        name: "Minor Illusion",
        text: "Make a Spellcast Roll (10). On a success, you create a minor visual illusion no larger than yourself within Close range. This illusion is convincing to anyone at Close range or farther."
      },
      {
        name: "Channel Raw Power",
        text: "Once per long rest, you can place a domain card from your loadout into your vault and choose to either:\n• Gain Hope equal to the level of the card.\n• Enhance a spell that deals damage, gaining a bonus to your damage roll equal to twice the level of the card."
      }
    ],
    subclasses: [
      "elemental-origin",
      "primal-origin"
    ],
    classItems: "a whispering orb OR a family heirloom.",
    clothes: "ornate, flamboyant, always moving, inconspicuous, layered, tight",
    attitude: "a celebrity, a commander, a politician, a prankster, a wolf in sheep’s clothing",
    backgroundQuestions: [
      "What did you do that made the people in your community wary of you?",
      "What mentor taught you to control your untamed magic, and why are they no longer able to guide you?",
      "You have a deep fear you hide from everyone. What is it, and why does it scare you?"
    ],
    connectionQuestions: [
      "Why do you trust me so deeply?",
      "What did I do that makes you cautious around me?",
      "Why do we keep our shared past a secret?"
    ]
  },
  {
    id: "warrior",
    name: "Warrior",
    source: "core",
    domains: [
      "blade",
      "bone"
    ],
    startingEvasion: 11,
    startingHp: 6,
    hopeFeature: {
      name: "No Mercy",
      text: "Spend 3 Hope to gain a +1 bonus to your attack rolls until your next rest."
    },
    classFeatures: [
      {
        name: "Attack of Opportunity",
        text: "If an adversary within Melee range attempts to leave that range, make a reaction roll using a trait of your choice against their Difficulty. Choose one effect on a success, or two if you critically succeed:\n• They can’t move from where they are.\n• You deal damage to them equal to your primary weapon’s damage.\n• You move with them."
      },
      {
        name: "Combat Training",
        text: "You ignore burden when equipping weapons. When you deal physical damage, you gain a bonus to your damage roll equal to your level."
      }
    ],
    subclasses: [
      "call-of-the-brave",
      "call-of-the-slayer"
    ],
    classItems: "the drawing of a lover OR a sharpening stone.",
    clothes: "reinforced, weathered, patched, sleek, royal, bold, sparing",
    attitude: "a gladiator, a hired hand, a dedicated soldier, a bull, a hero",
    backgroundQuestions: [
      "Who taught you to fight, and why did they stay behind when you left home?",
      "Somebody defeated you in battle years ago and left you to die. Who was it, and why did it feel like such a betrayal?",
      "What legendary place have you always wanted to visit, and why is it so special?"
    ],
    connectionQuestions: [
      "We knew each other long before this party came together. How?",
      "What mundane thing off the battlefield do you usually help me with?",
      "What fear am I helping you to overcome?"
    ]
  },
  {
    id: "wizard",
    name: "Wizard",
    source: "core",
    domains: [
      "codex",
      "splendor"
    ],
    startingEvasion: 11,
    startingHp: 5,
    hopeFeature: {
      name: "Not This Time",
      text: "Spend 3 Hope to force an adversary within Far range to reroll an attack or damage roll."
    },
    classFeatures: [
      {
        name: "Prestidigitation",
        text: "You can perform harmless, subtle magical effects at will. For example, you can change an object’s color, create a smell, light a candle, cause a tiny object to float, illuminate a room, or repair a small object."
      },
      {
        name: "Strange Patterns",
        text: "Choose a number between 1 and 12. When you roll that number on a Duality Die, gain a Hope or clear a Stress. You can change this number when you take a long rest."
      }
    ],
    subclasses: [
      "school-of-knowledge",
      "school-of-war"
    ],
    classItems: "a book you’re trying to translate OR a tiny & harmless elemental pet. Then decide what you carry your spells in: large tomes, tarot cards, etc.",
    clothes: "beautiful, clean, layered, patchwork, tight, common, flowing",
    attitude: "a librarian, a madhatter, a professor, a lit fuse, a philosopher",
    backgroundQuestions: [
      "What did your community once count on you for? How did you let them down?",
      "You’ve spent your life searching for an object or book of great significance. What is it and why is it so important to you?",
      "You have a powerful rival. Who are they, and why are you so determined to be their end?"
    ],
    connectionQuestions: [
      "What favor have I asked of you that you’re not sure you can fulfill?",
      "What weird hobby or strange fascination do we both share?",
      "What secret about yourself have you entrusted with only me?"
    ]
  },
  {
    id: "assassin",
    name: "Assassin",
    source: "hope-and-fear",
    domains: [
      "blade",
      "midnight"
    ],
    startingEvasion: 12,
    startingHp: 5,
    hopeFeature: {
      name: "Deadly Determination",
      text: "Spend 3 Hope to clear 2 Stress."
    },
    classFeatures: [
      {
        name: "Marked for Death",
        text: "On a successful weapon attack, you can mark a Stress to make the target Marked for Death. When you deal damage to a target you’ve Marked for Death, add a number of d4s equal to your tier to the damage roll.\nYou can have only one adversary Marked for Death at a time. This condition lasts until you take a rest, the current adversary Marked for Death is defeated, or the GM spends a number of Fear equal to your tier to clear it."
      },
      {
        name: "Get In & Get Out",
        text: "Spend a Hope to ask the GM for a quick or inconspicuous way into or out of a place you can see. The next roll you make that acts on this information has advantage."
      }
    ],
    subclasses: [
      "executioners-guild",
      "poisoners-guild"
    ],
    classItems: "a list of names with several marked off OR a rusted blade inscribed with an insignia.",
    clothes: "",
    attitude: "",
    backgroundQuestions: [
      "You once killed someone you were close to. What happened, and how did it change you?",
      "What organization trained you in the art of killing, and how did you become a member?",
      "Throughout your career, one target has eluded you. Who are they, and how have they slipped through your fingers?"
    ],
    connectionQuestions: [
      "I’ve killed someone for you. Who were they?",
      "How did you save me when I was on the brink of death? What have I promised you as repayment?",
      "What secret about myself did I tell you, and how did it change your view of me?"
    ]
  },
  {
    id: "brawler",
    name: "Brawler",
    source: "hope-and-fear",
    domains: [
      "valor",
      "bone"
    ],
    startingEvasion: 10,
    startingHp: 6,
    hopeFeature: {
      name: "Square Up",
      text: "Spend 3 Hope to intimidate a target within Close range, making them temporarily Vulnerable."
    },
    classFeatures: [
      {
        name: "I Am the Weapon",
        text: "Your barehanded attacks are as strong as any blade. You have a primary weapon called Brawler’s Strike equipped while you have no other Active Weapons. It uses a trait of your choice, has Melee range, and deals d8+d6 physical damage using your Proficiency (both the d8 and d6 scale off your Proficiency). While this weapon is active, you gain a +1 bonus to your Evasion."
      },
      {
        name: "Combo Strike",
        text: "After rolling damage on a successful attack with a Melee weapon, you can mark a Stress to start a combo strike. When you do, roll your Combo Die and note the result, then continue rolling your Combo Die until the result of your latest roll is lower than the roll that preceded it. You deal extra damage equal to the total of all rolled Combo Die results on this attack. The results can’t be modified by any means.\nYour Combo Die starts as a d4. Once per tier, you can increase your Combo Die by one step as a level advancement option."
      }
    ],
    subclasses: [
      "juggernaut",
      "martial-artist"
    ],
    classItems: "hand wraps from a mentor OR a book about your secret hobby.",
    clothes: "",
    attitude: "",
    backgroundQuestions: [
      "Where did you spend time during your formative years that taught you, directly or indirectly, how to fight in the style you use?",
      "What organization has vowed to kill you on sight, and what did you do to invoke their ire?",
      "Who did you recently lose a fight to that you’re desperate for a rematch against?"
    ],
    connectionQuestions: [
      "What is one thing we’re both afraid of?",
      "What do I rely on you for during our travels? How do you feel about it?",
      "I still haven’t forgiven you for something you said to me. What was it, and why did you say it?"
    ]
  },
  {
    id: "warlock",
    name: "Warlock",
    source: "hope-and-fear",
    domains: [
      "dread",
      "grace"
    ],
    startingEvasion: 11,
    startingHp: 5,
    hopeFeature: {
      name: "Patron’s Boon",
      text: "When you fail a roll, you can spend 3 Hope to reroll with advantage."
    },
    classFeatures: [
      {
        name: "Patron’s Pact",
        text: "You have committed yourself to a supernatural entity—such as a god, fae, or demon—in exchange for power. Write their name on your character sheet, then work with your GM to determine their sphere of influence (such as Nature, Chaos, Wisdom, Mischief, Love, War, Justice, or Death). Before making an action roll that relates to your patron’s sphere of influence, you can spend a Favor to call upon their aid, rolling your Patron Die and adding its result to the total. Your Patron Die starts at a d6 and increases to a d8 at level 5."
      },
      {
        name: "Favor",
        text: "You start with 3 Favor. You can use a downtime move to show tribute to your patron. Describe how and gain Favor equal to your Spellcast trait. Additionally, when you succeed on an action roll with Hope, you can choose to gain a Favor instead of a Hope."
      }
    ],
    subclasses: [
      "pact-of-the-endless",
      "pact-of-the-wrathful"
    ],
    classItems: "a carving that symbolizes your patron OR a ring you can’t remove.",
    clothes: "",
    attitude: "",
    backgroundQuestions: [
      "Who from your community shunned you after you made a pact with your patron?",
      "What desperate situation led you to pledge your life to your patron?",
      "Your patron has given you one task you must accomplish above all else. What is it, and why does it worry you?"
    ],
    connectionQuestions: [
      "Why do you think I confide in you about what my patron says and does?",
      "Our relationship has changed since you saw me show tribute to my patron. What did you see, and how has it affected you?",
      "I once did something very foolish, and you’ve never let me live it down. What was it?"
    ]
  },
  {
    id: "witch",
    name: "Witch",
    source: "hope-and-fear",
    domains: [
      "sage",
      "dread"
    ],
    startingEvasion: 10,
    startingHp: 6,
    hopeFeature: {
      name: "Witch’s Charm",
      text: "When you or an ally within Far range fails an action roll, you can spend 3 Hope to change it into a success with Fear instead."
    },
    classFeatures: [
      {
        name: "Hex",
        text: "Mark a Stress to temporarily Hex a target within Far range. While Hexed, the target gains a penalty to their damage rolls and Difficulty equal to your tier. The maximum number of creatures you can Hex at one time is equal to your Spellcast trait."
      },
      {
        name: "Commune",
        text: "Once per long rest during a moment of calm, you can commune with an ancestor, a deity, a spirit, or an otherworldly being. Ask them a question, then roll a number of d6s equal to your Spellcast trait. Choose one of the results and reference the chart below for the effect.\n• 1–3: You taste a flavor, smell a scent, or feel a sensation relevant to the answer.\n• 4–5: You hear sounds or see a vision relevant to the answer.\n• 6: You psychically experience a scene relevant to the answer as if you were there."
      }
    ],
    subclasses: [
      "hedge",
      "moon"
    ],
    classItems: "a small, harmless pet OR a scrying stone.",
    clothes: "",
    attitude: "",
    backgroundQuestions: [
      "Who from your community feared your magical craft? What rumor did they spread about you, and what truth did it contain?",
      "You once used your power to help someone in a dire situation. Who were they, and why did they come to you?",
      "Your magic once opened a door best left closed. Who or what was on the other side?"
    ],
    connectionQuestions: [
      "What unique ritual or practice have I taught you that we now perform together?",
      "I once appeared to you in a dream and shared a vision of the future. What did I tell you?",
      "What do you typically come to me for advice about?"
    ]
  }
];
