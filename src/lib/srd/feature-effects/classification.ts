// How every feature is used in combat (plan sheet-drawer, tracer SD0; analysis section 2). Pure data: no framework
// imports, relative imports only (bundled into Convex).
//
// - combat: a Use button in the drawer (an action), a Use / Pass answer (a reaction: the reaction window, the before-roll
//   prompt of Q2, the after-roll step of Q1), a toggle inside the actor's own roll (a rider), or an automatic trigger
//   that matters in combat (auto). Gets an effect entry from its FE-* tracer.
// - passive: always on, or on while a state holds; no button. The engine applies it (derived stats, roll and damage
//   modifiers, defences). Gets an effect entry too; the drawer shows it without a Use button.
// - outOfCombat: social, travel, downtime, rest or build-time. Text in the drawer plus any existing D5 Use; the social
//   advantages become roll options and the rest-time ones run in the rest flow (Q15 b, SD-R). Using one from the map is
//   refused with FEATURE_NOT_COMBAT.
// - narrative: pure fiction, text only (also refused with FEATURE_NOT_COMBAT).
//
// `how` is the activation the FE tracer is expected to use (src/lib/domain/card-effects/types.ts, `Activation`; `text`
// for none); it guides the entry and is not enforced. `why` is the analysis' reading. The 217 features of the data
// (CLASSES, SUBCLASSES, ANCESTRIES, COMMUNITIES) carry the analysis readings verbatim; the 45 Beastform features (Q10), 12
// transformation features (Q11) and 16 martial stances (Q5, HF p.12) are classified here. The list is for the user's
// review: docs/tasks/TASK-SD-SD0.md.

import type { FeatureUsage } from "../../domain/feature-effects/types";

export type FeatureHow = "action" | "reaction" | "rider" | "auto" | "passive" | "text";

export interface FeatureClass {
  usage: FeatureUsage;
  how: FeatureHow;
  /** Why, in a few words (the analysis' reading). */
  why: string;
}

const c = (how: FeatureHow, why: string): FeatureClass => ({ usage: "combat", how, why });
const p = (how: FeatureHow, why: string): FeatureClass => ({ usage: "passive", how, why });
const o = (how: FeatureHow, why: string): FeatureClass => ({ usage: "outOfCombat", how, why });
const n = (how: FeatureHow, why: string): FeatureClass => ({ usage: "narrative", how, why });

/**
 * The 16 martial stances of HF p.12, four per tier, as `stance:martial-artist:<slug>` slugs. The stance rule data is
 * tracer SD-ST's (src/lib/srd/stances.ts); a unit test keeps the two lists equal once both are merged.
 */
export const MARTIAL_STANCE_SLUGS: readonly (readonly [string, string, string, string])[] = [
  ["favored", "invigorating", "quick", "reliable"],
  ["aggressive", "anchored", "defensive", "otherworldly"],
  ["grappling", "scary", "stable", "vigilant"],
  ["crushing", "exacting", "honed", "isolating"],
];

/**
 * Every feature by feature id (src/lib/domain/feature-effects/ids.ts). A unit test keeps it equal to the data: every
 * feature of CLASSES (Hope and class features), SUBCLASSES, ANCESTRIES, COMMUNITIES, BEASTFORMS and TRANSFORMATIONS has
 * one row, every row names a feature, and the stance rows match `MARTIAL_STANCE_SLUGS`.
 */
export const FEATURE_CLASSIFICATION: Readonly<Record<string, FeatureClass>> = {
  // Bard
  "hope:bard": c("action", "Distracted (temporary) + Difficulty -2 on one enemy in Close; dcm-bxp.47"),
  "class:bard:rally": c("action", "Once per session; Rally Dice for self + allies (held dice); spent from roll options; d8 at level 5 (NV3)"),
  "subclass:troubadour:gifted-performer": c("action", "Three songs, each once per long rest (one use each); Virtuoso makes it twice"),
  "subclass:troubadour:maestro": c("auto", "When you give a Rally Die, each ally picks +1 Hope or clear 1 Stress (per-recipient choice)"),
  "subclass:troubadour:virtuoso": p("passive", "Upgrade: Gifted Performer songs twice per long rest"),
  "subclass:wordsmith:rousing-speech": c("action", "Once per long rest; all allies within Far clear 2 Stress"),
  "subclass:wordsmith:heart-of-a-poet": o("rider", "After a social action roll: spend a Hope, +d4 (situation confirm)"),
  "subclass:wordsmith:eloquent": c("action", "Once per session; options: mundane object (text), Help without Hope, extra downtime move (rest)"),
  "subclass:wordsmith:epic-poetry": p("passive", "Rally Die d10; Help an Ally rolls a d10 advantage die"),
  // Druid
  "hope:druid": c("action", "3 Hope: Beastform without Stress, +1 to a chosen trait while transformed"),
  "class:druid:beastform": c("action", "Mark a Stress: transform; weapons and domain spells blocked; form attack and features (Q10)"),
  "class:druid:wildtouch": n("text", "Harmless nature effects at will"),
  "subclass:warden-of-the-elements:elemental-incarnation": c("action", "Mark a Stress: Channel Fire/Earth/Water/Air until Severe damage or next rest; each element a lasting rider"),
  "subclass:warden-of-the-elements:elemental-aura": c("action", "Once per rest while Channeling: aura in Close matching the element"),
  "subclass:warden-of-the-elements:elemental-dominion": p("passive", "While Channeling: Fire +1 Proficiency; Earth d6 per HP; Water reaction Vulnerable; Air +1 Evasion, fly"),
  "subclass:warden-of-renewal:clarity-of-nature": o("action", "Once per long rest; a few minutes resting: clear Stress = Instinct, split among party"),
  "subclass:warden-of-renewal:regeneration": c("action", "Touch, 3 Hope: target clears 1d4 HP (Very Close with Regenerative Reach)"),
  "subclass:warden-of-renewal:regenerative-reach": p("passive", "Upgrade: Regeneration reaches Very Close"),
  "subclass:warden-of-renewal:wardens-protection": c("action", "Once per long rest, 2 Hope: 1d4 allies within Close clear 2 HP"),
  "subclass:warden-of-renewal:defender": c("reaction", "In Beastform: ally within Close marks 2+ HP, mark a Stress, they mark 1 fewer"),
  // Guardian
  "hope:guardian": c("action", "3 Hope: clear 2 Armor Slots; repeatable (CB p.107)"),
  "class:guardian:unstoppable": c("action", "Once per long rest; Unstoppable Die, physical severity -1, +die to damage, no Restrained/Vulnerable; scene end"),
  "subclass:stalwart:unwavering": p("passive", "+1 thresholds (done)"),
  "subclass:stalwart:iron-will": c("reaction", "Physical damage: one extra Armor Slot (reaction window)"),
  "subclass:stalwart:unrelenting": p("passive", "+2 thresholds (done)"),
  "subclass:stalwart:partners-in-arms": c("reaction", "Ally within Very Close takes damage: mark an Armor Slot, their severity -1"),
  "subclass:stalwart:undaunted": p("passive", "+3 thresholds (done)"),
  "subclass:stalwart:loyal-protector": c("reaction", "Ally within Close with 2 or fewer HP unmarked would take damage: mark a Stress, take it instead"),
  "subclass:vengeance:at-ease": p("passive", "+1 Stress slot (done)"),
  "subclass:vengeance:revenge": c("reaction", "Adversary in Melee hits you: mark 2 Stress, it marks 1 HP"),
  "subclass:vengeance:act-of-reprisal": c("auto", "Adversary damages an ally within Melee: +1 Proficiency on your next successful attack on it (Q8)"),
  "subclass:vengeance:nemesis": c("action", "2 Hope: Prioritize one adversary until next rest; may swap Hope/Fear dice on attacks vs it"),
  // Ranger
  "hope:ranger": c("rider", "3 Hope after a successful weapon attack: same roll vs two more adversaries in range; dcm-bxp.47"),
  "class:ranger:rangers-focus": c("action", "Hope + attack; Focus tag on the target: its damage marks Stress, end Focus to reroll a failed attack"),
  "subclass:beastbound:companion": c("action", "Animal companion with its own attack (Spellcast Roll to command, Proficiency + its die); Q4"),
  "subclass:beastbound:expert-training": p("passive", "Companion level-up option (companion sheet)"),
  "subclass:beastbound:battle-bonded": p("passive", "+2 Evasion vs an adversary inside the companion's Melee range"),
  "subclass:beastbound:advanced-training": p("passive", "Two companion level-up options"),
  "subclass:beastbound:loyal-friend": c("reaction", "Once per long rest: take the damage for your companion or vice versa"),
  "subclass:wayfinder:ruthless-predator": c("rider", "Mark a Stress for +1 Proficiency on a damage roll; your Severe damage makes the adversary mark a Stress"),
  "subclass:wayfinder:path-forward": n("text", "Shortest path to a known place"),
  "subclass:wayfinder:elusive-predator": p("passive", "+2 Evasion vs attacks by your Focus"),
  "subclass:wayfinder:apex-predator": c("rider", "Spend a Hope before attacking your Focus; on a success the GM loses a Fear"),
  // Rogue
  "hope:rogue": c("action", "3 Hope: +2 Evasion until an attack succeeds against you, else until next rest"),
  "class:rogue:cloaked": p("passive", "Hidden becomes Cloaked; ends after an attack or a move ending in an adversary's line of sight (Q9)"),
  "class:rogue:sneak-attack": c("rider", "+tier d6 damage while Cloaked or with an ally in Melee of the target (Q9)"),
  "subclass:nightwalker:shadow-stepper": c("action", "In darkness: mark a Stress, reappear in a shadow within Far, Cloaked (move prompt)"),
  "subclass:nightwalker:dark-cloud": c("action", "Spellcast (15): a dark cloud in Close blocks sight in and out; Cloaked from those it blocks"),
  "subclass:nightwalker:adrenaline": p("passive", "While Vulnerable: + level to damage rolls"),
  "subclass:nightwalker:fleeting-shadow": p("passive", "+1 Evasion (done); Shadow Stepper reaches Very Far"),
  "subclass:nightwalker:vanishing-act": c("action", "Mark a Stress: Cloaked, clear Restrained, until you roll with Fear or next rest"),
  "subclass:syndicate:well-connected": n("text", "Know somebody in each prominent town"),
  "subclass:syndicate:contacts-everywhere": c("action", "Once per session: gold/tool, +3 to your Hope or Fear Die on the next action roll, or +2d8 on the next damage"),
  "subclass:syndicate:reliable-backup": p("passive", "Contacts Everywhere 3x per session; adds: 1 fewer HP marked, d20 Hope Die on a Presence Roll in conversation"),
  // Seraph
  "hope:seraph": c("action", "3 Hope: an ally within Close clears 1 HP"),
  "class:seraph:prayer-dice": c("reaction", "Session d4s = Spellcast; spend on any PC within Far: reduce incoming damage, add to a roll after it, or gain Hope"),
  "subclass:divine-wielder:spirit-weapon": c("rider", "Melee/Very Close weapon attacks within Close; mark a Stress for one more target, same roll"),
  "subclass:divine-wielder:sparing-touch": c("action", "Once per long rest (twice with Devout): touch, clear 2 HP or 2 Stress"),
  "subclass:divine-wielder:devout": p("passive", "Prayer Dice: roll one extra, drop the lowest; Sparing Touch twice"),
  "subclass:divine-wielder:sacred-resonance": p("passive", "Spirit Weapon damage: matching dice are doubled"),
  "subclass:winged-sentinel:wings-of-light": c("rider", "Fly; mark a Stress to carry a creature; while flying spend a Hope for +1d8 damage on a successful attack"),
  "subclass:winged-sentinel:ethereal-visage": p("passive", "While flying advantage on Presence Rolls; success with Hope on a Presence Roll may remove a Fear instead of gaining Hope"),
  "subclass:winged-sentinel:ascendant": p("passive", "+4 Severe threshold (done)"),
  "subclass:winged-sentinel:power-of-the-gods": p("passive", "Upgrade: Wings of Light deals 1d12"),
  // Sorcerer
  "hope:sorcerer": c("reaction", "3 Hope: reroll any damage dice of a magic attack (after-roll window, Q1)"),
  "class:sorcerer:arcane-sense": n("text", "Sense magic within Close"),
  "class:sorcerer:minor-illusion": n("action", "Spellcast (10): a minor illusion (roll only)"),
  "class:sorcerer:channel-raw-power": c("action", "Once per long rest: vault a loadout card for Hope = level or +2x level damage on a spell"),
  "subclass:elemental-origin:elementalist": c("rider", "Spend a Hope before an action roll: +2 to the roll or +3 to its damage"),
  "subclass:elemental-origin:natural-evasion": c("reaction", "An attack roll against you succeeds: mark a Stress, +d6 Evasion vs it"),
  "subclass:elemental-origin:transcendence": c("action", "Once per long rest: two of +4 Severe, +1 trait (choice), +1 Proficiency, +2 Evasion until next rest"),
  "subclass:primal-origin:manipulate-magic": c("rider", "After a magic spell or attack, mark a Stress: +1 range, +2 to the roll, double a damage die, or one more target"),
  "subclass:primal-origin:enchanted-aid": c("reaction", "Help with a Spellcast Roll: d8 advantage die; once per long rest swap that ally's Duality Dice"),
  "subclass:primal-origin:arcane-charge": c("auto", "Charged by taking magic damage or 2 Hope; spend Charge for +10 damage or +3 to a reaction roll's Difficulty"),
  // Warrior
  "hope:warrior": c("action", "3 Hope: +1 to attack rolls until next rest"),
  "class:warrior:attack-of-opportunity": c("reaction", "Adversary in Melee tries to leave: reaction roll vs its Difficulty, 1 effect (2 on a crit)"),
  "class:warrior:combat-training": p("passive", "Ignore burden; + level to physical damage (done as an auto roll option)"),
  "subclass:call-of-the-brave:courage": c("auto", "Fail a roll with Fear: gain a Hope"),
  "subclass:call-of-the-brave:battle-ritual": c("action", "Once per long rest before something dangerous: clear 2 Stress, gain 2 Hope"),
  "subclass:call-of-the-brave:rise-to-the-challenge": p("passive", "2 or fewer HP unmarked: d20 Hope Die"),
  "subclass:call-of-the-brave:camaraderie": p("passive", "One more Tag Team per session; allies pay 2 Hope to Tag Team with you"),
  "subclass:call-of-the-slayer:slayer": c("rider", "Slayer Dice pool (done in session features); spend on attack or damage rolls"),
  "subclass:call-of-the-slayer:weapon-specialist": c("rider", "On a success spend a Hope: + one secondary weapon damage die; once per long rest reroll Slayer 1s"),
  "subclass:call-of-the-slayer:martial-preparation": o("action", "Downtime move: each participant gains a d6 Slayer Die"),
  // Wizard
  "hope:wizard": c("reaction", "3 Hope: an adversary within Far rerolls an attack or damage roll (Q3); dcm-bxp.47"),
  "class:wizard:prestidigitation": n("text", "Harmless magic at will"),
  "class:wizard:strange-patterns": c("auto", "Your number on a Duality Die: +1 Hope or clear 1 Stress (prompt, done)"),
  "subclass:school-of-knowledge:prepared": o("passive", "Build: one extra domain card"),
  "subclass:school-of-knowledge:adept": c("rider", "Utilize an Experience with a Stress instead of a Hope: double the modifier"),
  "subclass:school-of-knowledge:accomplished": o("passive", "Build: one extra domain card"),
  "subclass:school-of-knowledge:perfect-recall": c("rider", "Once per rest: Recall Cost -1 when recalling a vault card (map Hand recall)"),
  "subclass:school-of-knowledge:brilliant": o("passive", "Build: one extra domain card"),
  "subclass:school-of-knowledge:honed-expertise": c("auto", "Using an Experience: d6, on 5+ no Hope spent"),
  "subclass:school-of-war:battlemage": p("passive", "+1 HP slot (done)"),
  "subclass:school-of-war:face-your-fear": c("auto", "Success with Fear on an attack: +1d10 magic damage (2d10, 3d10 with upgrades)"),
  "subclass:school-of-war:conjure-shield": p("passive", "With at least 2 Hope: + Proficiency to Evasion"),
  "subclass:school-of-war:fueled-by-fear": p("passive", "Upgrade: Face Your Fear 2d10"),
  "subclass:school-of-war:thrive-in-chaos": c("rider", "On a success, after damage: mark a Stress, the target marks one more HP"),
  "subclass:school-of-war:have-no-fear": p("passive", "Upgrade: Face Your Fear 3d10"),
  // Assassin
  "hope:assassin": c("action", "3 Hope: clear 2 Stress"),
  "class:assassin:marked-for-death": c("rider", "Successful weapon attack, mark a Stress: Marked for Death (one at a time), +tier d4 damage vs it"),
  "class:assassin:get-in-get-out": o("action", "Spend a Hope: ask for a way in/out; next roll on it has advantage"),
  "subclass:executioners-guild:first-strike": c("auto", "First successful attack in a scene: double damage"),
  "subclass:executioners-guild:ambush": p("passive", "Marked for Death uses d6s"),
  "subclass:executioners-guild:death-strike": c("rider", "You deal Severe damage: mark a Stress, the target marks one more HP"),
  "subclass:executioners-guild:scorpions-poise": p("passive", "+2 Evasion vs attacks by your Marked for Death target"),
  "subclass:executioners-guild:true-strike": c("reaction", "Once per long rest a failed attack: spend a Hope, it succeeds"),
  "subclass:executioners-guild:backstab": p("passive", "Marked for Death uses d8s"),
  "subclass:poisoners-guild:toxic-concoctions": c("rider", "Mark a Stress for 1d4+1 tokens; spend one on a successful weapon attack for a poison (lists grow with rank)"),
  "subclass:poisoners-guild:poison-compendium": p("passive", "Adds Midnight Vine, Gorgon Root"),
  "subclass:poisoners-guild:twin-fang": c("rider", "Poisoning a Marked target: one more token for a second poison"),
  "subclass:poisoners-guild:venomancer": p("passive", "Adds Blight Seed, Fear Leaf, Corpse Thorn"),
  "subclass:poisoners-guild:adders-blessing": n("passive", "Immune to poisons and toxins (no poison damage type in the app)"),
  // Brawler
  "hope:brawler": c("action", "3 Hope: a target within Close is temporarily Vulnerable; dcm-bxp.47"),
  "class:brawler:i-am-the-weapon": p("passive", "Brawler's Strike weapon override, +1 Evasion (done)"),
  "class:brawler:combo-strike": c("rider", "After damage on a Melee success, mark a Stress: Combo Die chain"),
  "subclass:juggernaut:rugged": p("passive", "+3 Severe threshold (done)"),
  "subclass:juggernaut:overwhelm": c("rider", "On a success spend a Hope: throw the target within Close or it marks a Stress"),
  "subclass:juggernaut:surrounded": c("rider", "Melee attack: spend any Hope for that many extra targets in Melee"),
  "subclass:juggernaut:eye-for-an-eye": c("reaction", "Once per rest an adversary in Melee makes you mark HP: mark a Stress, it marks as many"),
  "subclass:juggernaut:pummeljoy": c("auto", "Melee weapon crit: +1 Hope, clear 1 Stress, +1 Proficiency on that attack"),
  "subclass:juggernaut:not-done-yet": c("reaction", "Take Severe damage: gain a Hope or clear a Stress"),
  "subclass:martial-artist:stance-fighter": c("action", "Martial Stances sheet (16 stances, Focus); the data is not in the codebase (Q5)"),
  "subclass:martial-artist:keen-defenses": c("reaction", "Targeted by an attack: spend a Focus, + tier Evasion"),
  "subclass:martial-artist:focus-cannon": c("action", "Spend a Focus: Instinct Roll vs an adversary within Far, d20+3 magic using Proficiency"),
  "subclass:martial-artist:limit-breaker": o("action", "Once per rest: an athletic feat without rolling, +1 Hope, clear a Stress"),
  "subclass:martial-artist:flow-state": p("passive", "Stress instead of Focus to shift stance; Focus instead of Stress for a combo strike"),
  // Warlock
  "hope:warlock": c("reaction", "Fail a roll: 3 Hope, reroll with advantage (after-roll window, Q1)"),
  "class:warlock:patrons-pact": c("rider", "Spend a Favor before an action roll in your patron's sphere: + Patron Die"),
  "class:warlock:favor": c("auto", "3 Favor; tribute downtime move; success with Hope may take a Favor instead of Hope"),
  "subclass:pact-of-the-endless:patrons-mantle": c("action", "Spend a Favor: + tier thresholds and advantage to intimidate until Severe damage or scene end"),
  "subclass:pact-of-the-endless:deathless-embrace": c("action", "Once per rest: spend Favor, roll that many Patron Dice, clear 1 HP per 4+"),
  "subclass:pact-of-the-endless:harrowing-invocation": c("reaction", "Adversary targets you or an ally within Very Close: spend a Favor, disadvantage; on a miss it marks a Stress (Q2)"),
  "subclass:pact-of-the-endless:damage-sink": c("reaction", "Once per rest: spend a Favor, halve incoming damage (Q6)"),
  "subclass:pact-of-the-endless:dark-aegis": c("reaction", "Once per long rest: spend a Favor instead of marking Hit Points"),
  "subclass:pact-of-the-endless:draining-bane": c("reaction", "Adversary targets you or an ally within Very Close: spend a Favor, it marks a Stress, you clear one, it rolls d12 until it fails"),
  "subclass:pact-of-the-wrathful:patrons-fury": c("action", "Spend a Favor: + tier Patron Dice to damage until you deal Severe damage or scene end"),
  "subclass:pact-of-the-wrathful:deadly-vengeance": c("reaction", "You mark HP from an attack: spend a Favor, Patron Dice per HP, attacker marks 1 HP per 4+"),
  "subclass:pact-of-the-wrathful:menacing-reach": c("action", "Spend a Favor: primary weapon range +1 step until a successful attack with it"),
  "subclass:pact-of-the-wrathful:diminish-my-foes": c("rider", "Success with Hope vs a target: spend any Favor, it marks that many Stress"),
  "subclass:pact-of-the-wrathful:fearsome-attack": c("rider", "Spend a Favor to reroll any damage dice, repeatable"),
  "subclass:pact-of-the-wrathful:otherworldly-ire": c("reaction", "Once per rest when you take damage: spend Favor, Patron Dice, the highest = targets within Close that mark 1 HP"),
  // Witch
  "hope:witch": c("reaction", "You or an ally within Far fails an action roll: 3 Hope, success with Fear (after-roll window, Q1)"),
  "class:witch:hex": c("action", "Mark a Stress: Hex a target within Far, - tier to its damage rolls and Difficulty; up to Spellcast targets"),
  "class:witch:commune": o("action", "Once per long rest in calm: ask a question, roll Spellcast d6s"),
  "subclass:hedge:herbal-remedies": p("passive", "Consumables clear 1 more HP or Stress (consumable use is not on the map)"),
  "subclass:hedge:enchanted-talisman": c("reaction", "Once per rest: Hope into tokens; the holder spends one to mark 1 fewer HP"),
  "subclass:hedge:walk-between-worlds": o("action", "Spellcast (13) in calm: talk to spirits (tokens)"),
  "subclass:hedge:vexing-malison": p("passive", "Advantage on attacks against Hexed creatures"),
  "subclass:hedge:circle-of-power": c("action", "Once per rest: Very Close circle, tokens = Spellcast; +2 thresholds, attack, Evasion inside; a token per roll or evade"),
  "subclass:moon:nights-glamour": c("action", "Spellcast (13): Glamoured; adversaries within Close mark a Stress to attack you; drops on HP marked or damage dealt"),
  "subclass:moon:moonbeam": c("action", "Once per session: Close moonlight until scene end, +1 Spellcast Rolls inside"),
  "subclass:moon:ire-of-pale-light": c("auto", "A Hexed creature within Very Far fails an attack: it marks a Stress"),
  "subclass:moon:lunar-phases": p("passive", "Session d6 phase effects (done in session features); once per rest a Hope bumps the die"),
  // Ancestries
  "ancestry:clank:purposeful-design": p("passive", "Build: +1 to one Experience"),
  "ancestry:clank:efficient": o("passive", "Short rest: take a long rest move"),
  "ancestry:drakona:scales": c("reaction", "Would take Severe damage: mark a Stress, mark 1 fewer HP"),
  "ancestry:drakona:elemental-breath": c("action", "Instinct weapon, Very Close, a target or group, d8 magic using Proficiency"),
  "ancestry:dwarf:thick-skin": c("reaction", "Take Minor damage: mark 2 Stress instead of 1 HP"),
  "ancestry:dwarf:increased-fortitude": c("reaction", "3 Hope: halve incoming physical damage (Q6)"),
  "ancestry:elf:quick-reactions": c("rider", "Mark a Stress: advantage on a reaction roll"),
  "ancestry:elf:celestial-trance": o("passive", "Rest: one more downtime move"),
  "ancestry:faerie:luckbender": c("reaction", "Once per session after you or an ally within Close rolls: 3 Hope, reroll the Duality Dice (Q1)"),
  "ancestry:faerie:wings": c("reaction", "Fly; after an adversary attacks you while flying, mark a Stress for +2 Evasion (Q2)"),
  "ancestry:faun:caprine-leap": n("passive", "Leap within Close as normal movement"),
  "ancestry:faun:kick": c("rider", "Melee success, mark a Stress: +2d6 damage, knock yourself or the target to Very Close"),
  "ancestry:firbolg:charge": c("action", "Agility Roll to move from Far into Melee, mark a Stress: 1d12 physical to all in Melee"),
  "ancestry:firbolg:unshakable": c("auto", "Would mark a Stress: d6, on 6 don't"),
  "ancestry:fungril:fungril-network": o("action", "Instinct Roll (12): talk to other fungril at any distance"),
  "ancestry:fungril:death-connection": n("action", "Mark a Stress: a memory from a corpse"),
  "ancestry:galapa:shell": p("passive", "+ Proficiency to thresholds (not in derived stats yet)"),
  "ancestry:galapa:retract": c("action", "Mark a Stress: physical resistance, disadvantage on action rolls, can't move, until you come out"),
  "ancestry:giant:endurance": p("passive", "+1 HP slot (done)"),
  "ancestry:giant:reach": p("passive", "Melee features count as Very Close"),
  "ancestry:goblin:surefooted": p("passive", "Ignore disadvantage on Agility Rolls"),
  "ancestry:goblin:danger-sense": c("reaction", "Once per rest: mark a Stress, an adversary rerolls an attack vs you or an ally within Very Close"),
  "ancestry:halfling:luckbringer": p("auto", "Session start: the party gains a Hope (done)"),
  "ancestry:halfling:internal-compass": c("auto", "Roll a 1 on the Hope Die: reroll it"),
  "ancestry:human:high-stamina": p("passive", "+1 Stress slot (done)"),
  "ancestry:human:adaptability": c("reaction", "Fail a roll that used an Experience: mark a Stress, reroll"),
  "ancestry:infernis:fearless": c("reaction", "Roll with Fear: mark 2 Stress, it is with Hope (Q1)"),
  "ancestry:infernis:dread-visage": o("passive", "Advantage to intimidate hostile creatures (roll option)"),
  "ancestry:katari:feline-instincts": c("rider", "Agility Roll: 2 Hope, reroll the Hope Die"),
  "ancestry:katari:retracting-claws": c("action", "Agility Roll vs a Melee target: temporarily Vulnerable"),
  "ancestry:orc:sturdy": p("passive", "1 HP left: attacks against you have disadvantage (adversary engine reads it)"),
  "ancestry:orc:tusks": c("rider", "Melee success, spend a Hope: +1d6 damage"),
  "ancestry:ribbet:amphibious": n("passive", "Breathe and move underwater"),
  "ancestry:ribbet:long-tongue": c("action", "Mark a Stress: Finesse Close weapon, d12 physical using Proficiency"),
  "ancestry:simiah:natural-climber": o("passive", "Advantage on balancing and climbing"),
  "ancestry:simiah:nimble": p("passive", "+1 Evasion (not in derived stats yet)"),
  "ancestry:aetheris:hallowed-aura": c("reaction", "Once per long rest an ally within Close rolls with Fear: it is with Hope"),
  "ancestry:aetheris:celestial-wings": c("reaction", "Fly; once per scene while flying spend a Hope instead of marking an Armor Slot"),
  "ancestry:earthkin:stoneskin": p("passive", "+1 Armor Score and thresholds (not in derived stats yet)"),
  "ancestry:earthkin:immovable": n("passive", "Can't be moved against your will while touching the ground (movement is a prompt)"),
  "ancestry:emberkin:fireproof": p("passive", "Immune to flame damage (no fire keyword)"),
  "ancestry:emberkin:ignition": c("action", "Mark a Stress: primary weapon +1d6 damage until scene end"),
  "ancestry:gnome:nimble-fingers": c("rider", "Finesse Roll: 2 Hope, reroll the Hope Die"),
  "ancestry:gnome:flicker-step": c("action", "Once per scene: teleport within Far (move prompt)"),
  "ancestry:skykin:gale-force": c("action", "Mark a Stress: carry you or a Very Close ally up to Very Far (move prompt)"),
  "ancestry:skykin:eye-of-the-storm": c("action", "2 Hope: you or a Melee ally +1 Evasion until you take Severe damage or use it again"),
  "ancestry:tidekin:amphibious": n("passive", "Breathe and move underwater"),
  "ancestry:tidekin:lifespring": c("action", "Once per rest with water: mark a Stress, you or a Very Close ally clears 1 HP"),
  // Communities
  "community:highborne:privilege": o("passive", "Advantage with nobles, prices, reputation (roll option)"),
  "community:loreborne:well-read": o("passive", "Advantage on history, culture, politics (roll option)"),
  "community:orderborne:dedicated": c("rider", "Once per rest embodying a principle: d20 Hope Die"),
  "community:ridgeborne:steady": o("passive", "Advantage on cliffs, harsh environments, survival (roll option)"),
  "community:seaborne:know-the-tide": c("rider", "Tokens on rolls with Fear, +1 per token spent (done in session features)"),
  "community:slyborne:scoundrel": o("passive", "Advantage with criminals, lies, hiding places (roll option)"),
  "community:underborne:low-light-living": o("passive", "Advantage to hide, investigate, perceive in low light (roll option)"),
  "community:wanderborne:nomadic-pack": o("action", "Once per session, a Hope: pull a mundane item"),
  "community:wildborne:lightfoot": o("passive", "Advantage to move unheard (roll option)"),
  "community:duneborne:oasis": o("passive", "Short rest: reroll a downtime die"),
  "community:freeborne:unbound": c("reaction", "Once per session a roll with Fear: it is with Hope (Q1)"),
  "community:frostborne:hardy": o("auto", "Any rest: clear 1 HP (rest flow)"),
  "community:hearthborne:close-knit": c("action", "Once per long rest: spend any Hope, an ally within Far gains as much"),
  "community:reborne:found-family": c("rider", "Once per rest, a Hope: use an ally's Experience"),
  "community:warborne:brave-face": c("auto", "Once per session forced to mark a Stress: spend a Hope instead"),
  // Beastforms (Q10; CB p.32 Tier 1, p.33 Tier 2, p.34 Tier 3, p.35 Tier 4). The form's attack is its own entry
  // (`beastformAttackId`), not a row here.
  "beastform:agile-scout:agile": c("action", "Spend a Hope: move up to Far without rolling (move prompt); silent movement is text"),
  "beastform:agile-scout:fragile": c("auto", "Take Major or greater damage: drop out of Beastform"),
  "beastform:aquatic-scout:aquatic": n("passive", "Breathe and move underwater"),
  "beastform:aquatic-scout:fragile": c("auto", "Take Major or greater damage: drop out of Beastform"),
  "beastform:household-friend:companion": p("passive", "Help an Ally rolls a d8 advantage die (named Help, Q12)"),
  "beastform:household-friend:fragile": c("auto", "Take Major or greater damage: drop out of Beastform"),
  "beastform:nimble-grazer:elusive-prey": c("reaction", "An attack would succeed against you: mark a Stress, +d4 Evasion against it"),
  "beastform:nimble-grazer:fragile": c("auto", "Take Major or greater damage: drop out of Beastform"),
  "beastform:pack-predator:hobbling-strike": c("rider", "Succeed on a Melee attack, mark a Stress: the target is temporarily Vulnerable"),
  "beastform:pack-predator:pack-hunting": c("rider", "Succeed against the target of the ally who acted just before you: +d8 damage (situation confirm)"),
  "beastform:stalking-arachnid:venomous-bite": c("auto", "Succeed on a Melee attack: the target is temporarily Poisoned (1d10 direct physical each time it acts)"),
  "beastform:stalking-arachnid:webslinger": c("action", "Finesse Roll against a target within Close: temporarily Restrained; web utility is text"),
  "beastform:armored-sentry:armored-shell": c("action", "Physical resistance (passive); mark an Armor Slot to retract: physical damage reduced by Armor Score, no other actions"),
  "beastform:armored-sentry:cannonball": c("action", "Mark a Stress: an ally's attack roll launches you, d12+2 physical with their Proficiency; a Hope for a second target at half"),
  "beastform:mighty-strider:carrier": n("passive", "Carry up to two willing allies when you move"),
  "beastform:mighty-strider:trample": c("action", "Mark a Stress: move Close in a line, attack all in Melee of it, d8+1 physical, temporarily Vulnerable"),
  "beastform:pouncing-predator:fleet": c("action", "Spend a Hope: move up to Far without rolling (move prompt)"),
  "beastform:pouncing-predator:takedown": c("action", "Mark a Stress: move into Melee and attack; on a success +2 Proficiency and the target marks a Stress"),
  "beastform:powerful-beast:rampage": c("rider", "A damage die rolls 1: add a d10; before an attack mark a Stress for +1 Proficiency"),
  "beastform:powerful-beast:thick-hide": p("passive", "+2 damage thresholds"),
  "beastform:striking-serpent:venomous-strike": c("action", "Attack any number of targets within Very Close; on a success temporarily Poisoned"),
  "beastform:striking-serpent:warning-hiss": c("action", "Mark a Stress: any targets within Melee move back to Very Close (move prompt)"),
  "beastform:winged-beast:birds-eye-view": p("passive", "Fly at will (the Flying toggle, Q16); once per rest airborne, a question about the scene below (text)"),
  "beastform:winged-beast:hollow-bones": p("passive", "-2 damage thresholds"),
  "beastform:aquatic-predator:aquatic": n("passive", "Breathe and move underwater"),
  "beastform:aquatic-predator:vicious-maul": c("rider", "Succeed on an attack, spend a Hope: the target is Vulnerable and +1 Proficiency on this attack"),
  "beastform:great-predator:carrier": n("passive", "Carry up to two willing allies when you move"),
  "beastform:great-predator:vicious-maul": c("rider", "Succeed on an attack, spend a Hope: temporarily Vulnerable and +1 Proficiency on this attack"),
  "beastform:great-winged-beast:birds-eye-view": p("passive", "Fly at will (the Flying toggle, Q16); once per rest airborne, a question about the scene below (text)"),
  "beastform:great-winged-beast:carrier": n("passive", "Carry up to two willing allies when you move"),
  "beastform:legendary-beast:evolved": p("passive", "A larger Tier 1 form: keeps its features, +6 damage rolls, +1 to its trait, +2 Evasion"),
  "beastform:legendary-hybrid:hybrid-features": p("passive", "One more Stress to transform; two Tier 1-2 forms: four advantages and two features from them"),
  "beastform:mighty-lizard:physical-defense": p("passive", "+3 damage thresholds"),
  "beastform:mighty-lizard:snapping-strike": c("rider", "Succeed on a Melee attack, spend a Hope: temporarily Restrained and Vulnerable"),
  "beastform:epic-aquatic-beast:ocean-master": c("rider", "Underwater (text); succeed on a Melee attack: temporarily Restrain the target"),
  "beastform:epic-aquatic-beast:unyielding": c("auto", "Would mark an Armor Slot: d6, on 5+ reduce the severity by one without marking it"),
  "beastform:massive-behemoth:carrier": n("passive", "Carry up to four willing allies when you move"),
  "beastform:massive-behemoth:demolish": c("action", "Spend a Hope: move Far in a line, attack all in Melee of it, d8+10 physical, temporarily Vulnerable"),
  "beastform:massive-behemoth:undaunted": p("passive", "+2 damage thresholds"),
  "beastform:mythic-aerial-hunter:carrier": n("passive", "Carry up to three willing allies when you move"),
  "beastform:mythic-aerial-hunter:deadly-raptor": c("rider", "Fly at will; a straight-line charge from Close into Melee and attack: reroll damage dice below your Proficiency"),
  "beastform:mythic-beast:evolved": p("passive", "A larger Tier 1-2 form: keeps its features, +9 damage rolls, +2 to its trait, +3 Evasion, damage die one size up"),
  "beastform:mythic-hybrid:hybrid-features": p("passive", "Two more Stress to transform; three Tier 1-3 forms: five advantages and three features from them"),
  "beastform:terrible-lizard:devastating-strikes": c("rider", "Deal Severe damage in Melee, mark a Stress: the target marks one more HP"),
  "beastform:terrible-lizard:massive-stride": n("passive", "Move up to Far without rolling, ignore rough terrain (movement is a prompt)"),
  // Transformations (Q11; HF p.35 demigod, p.36 ghost, p.37 reanimated, p.38 shapeshifter, p.39 vampire, p.40 werewolf)
  "transformation:demigod:gifted": p("passive", "+1 to action, reaction and damage rolls"),
  "transformation:demigod:weight-of-divinity": c("auto", "Fail a roll: mark a Stress or the GM gains a Fear (the player picks)"),
  "transformation:ghost:unfinished-business": n("text", "The purpose that binds you to the Mortal Realm"),
  "transformation:ghost:ephemeral": p("passive", "Physical resistance, double magic damage; mark 2 Stress to pass through a solid object (text)"),
  "transformation:reanimated:corpse": o("passive", "During a rest, clear HP only with remains of a recently deceased creature (rest flow)"),
  "transformation:reanimated:wont-stay-dead": o("reaction", "Risk It All failed: permanently mark a Hit Point to succeed (death move flow)"),
  "transformation:shapeshifter:change-shape": o("action", "A downtime move during a rest: swap your current ancestry"),
  "transformation:shapeshifter:only-skin-deep": o("passive", "Only one chosen ancestry feature (build; owned() reads the sheet's ancestry.feature)"),
  "transformation:vampire:fangs": c("action", "Attack with a trait of your choice in Melee: d6 physical using Proficiency"),
  "transformation:vampire:feed": c("rider", "Fangs success, mark a Stress: tokens = HP marked (max 6); a token before an action roll: d20 Fear Die; no tokens: disadvantage"),
  "transformation:werewolf:wolf-form": c("reaction", "Mark 1+ HP: mark a Stress to enter Wolf Form, +1d10 attack and damage; gaining Hope marks a Stress"),
  "transformation:werewolf:howling-rampage": c("auto", "Mark your last Stress in Wolf Form: tier d20s physical to all within Very Close, then drop out"),
  // Martial stances (Q5, HF p.12): each holds while it is the active stance
  "stance:martial-artist:favored": p("passive", "Bonus to damage rolls equal to a trait of your choice"),
  "stance:martial-artist:invigorating": c("auto", "Successful attack: d4, on a 4 gain a Focus"),
  "stance:martial-artist:quick": c("rider", "When you attack, spend a Focus or mark a Stress to target another creature within range"),
  "stance:martial-artist:reliable": p("passive", "+1 to attack rolls"),
  "stance:martial-artist:aggressive": p("passive", "-1 Evasion; on a successful attack an extra damage die, drop the lowest"),
  "stance:martial-artist:anchored": p("passive", "+2 damage thresholds; can't be moved against your will"),
  "stance:martial-artist:defensive": p("passive", "Attacks on you from Melee have disadvantage unless the attacker marks a Stress"),
  "stance:martial-artist:otherworldly": c("rider", "Successful attack: deal physical or magic damage (choice)"),
  "stance:martial-artist:grappling": c("rider", "Successful Melee attack, spend a Focus or mark a Stress: temporarily Restrain or throw within Close"),
  "stance:martial-artist:scary": c("auto", "Successful attack: the target marks a Stress"),
  "stance:martial-artist:stable": c("reaction", "Spend a Focus instead of an Armor Slot to reduce damage"),
  "stance:martial-artist:vigilant": c("reaction", "Targeted by an attack: mark a Stress, +d6 Evasion against it"),
  "stance:martial-artist:crushing": c("rider", "Deal Severe damage, spend a Hope: the target marks one more HP"),
  "stance:martial-artist:exacting": c("rider", "A damage die rolls 1: treat it as the die's highest value"),
  "stance:martial-artist:honed": c("rider", "Spend a Focus before an attack roll: +1 Proficiency for that attack"),
  "stance:martial-artist:isolating": p("passive", "Advantage on attacks when no other creature is within Very Close of you or your target"),
};

/** A feature's row, or undefined for an unknown id. */
export function featureClass(featureId: string): FeatureClass | undefined {
  return FEATURE_CLASSIFICATION[featureId];
}

/** How a feature is used; an unknown feature is out of combat (refused on the map with FEATURE_NOT_COMBAT). */
export function featureUsage(featureId: string): FeatureClass["usage"] {
  return FEATURE_CLASSIFICATION[featureId]?.usage ?? "outOfCombat";
}
