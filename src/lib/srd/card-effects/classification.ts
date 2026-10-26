// How every domain card is used in combat (plan combat-actions, tracer CA0; U3). Pure data: no framework imports,
// relative imports only (bundled into Convex).
//
// - combat: has a Use button on the Hand (an action), a Use / Pass prompt (a reaction), or a toggle inside the
//   actor's own roll (a rider). Gets an effect entry from its domain tracer (CE-*).
// - passive: always on, or happens by itself with no choice to make (Untouchable, Swift Step). Gets an effect entry
//   too; the Hand shows it without a Use button.
// - outOfCombat: only social, travel, downtime or level-up use. No effect entry; using it on the map is refused with
//   CARD_NOT_COMBAT.
//
// `how` is the activation the CE tracer is expected to use (see src/lib/domain/card-effects/types.ts, `Activation`);
// it guides the entry and is not enforced. The list is for the user's review: docs/tasks/TASK-CA-CA0.md.

import type { CardUsage } from "../../domain/card-effects/types";
import type { DomainId } from "../types";

export type CardHow = "action" | "reaction" | "rider" | "auto" | "passive" | "mixed" | "none";

export interface CardClass {
  usage: CardUsage;
  how: CardHow;
  /** Why, in a few words. */
  why: string;
}

const c = (how: CardHow, why: string): CardClass => ({ usage: "combat", how, why });
const p = (how: "passive" | "auto", why: string): CardClass => ({ usage: "passive", how, why });
const o = (why: string): CardClass => ({ usage: "outOfCombat", how: "none", why });

/** Every card id of `DOMAIN_CARDS`, by domain. A unit test keeps it equal to the card list. */
export const CARD_CLASSIFICATION: Readonly<Record<DomainId, Readonly<Record<string, CardClass>>>> = {
  arcana: {
    "adjust-reality": c("reaction", "after you or an ally roll: spend 5 Hope to set the result"),
    "arcana-touched": c("mixed", "+1 Spellcast (passive) and a once-per-rest Hope/Fear swap"),
    "arcane-reflection": c("reaction", "when you would take magic damage: d6s per Hope, reflect on a 6"),
    "blink-out": c("action", "Spellcast (12), teleport within Far, Hope per passenger"),
    "chain-lightning": c("action", "2 Stress, all within Close, reaction roll vs your total, 2d8+4"),
    "cinder-grasp": c("action", "Melee spell, 1d20+3 magic, On Fire"),
    "cloaking-blast": c("rider", "after another successful spell: spend a Hope to become Cloaked"),
    "confusing-aura": c("action", "once per long rest layers; attacks against you may fail"),
    counterspell: c("reaction", "interrupt a magical effect with a Spellcast reaction roll"),
    earthquake: c("action", "Spellcast (16), all within Very Far save (18), 3d10+8, Vulnerable"),
    "falling-sky": c("action", "all adversaries within Far, 1d20+2 per Stress marked"),
    flight: c("action", "Spellcast (15), tokens = Agility, spent per action roll while flying"),
    "floating-eye": c("action", "spend a Hope for a scouting orb within Very Far"),
    premonition: c("reaction", "once per long rest, rescind a roll's move and consequences"),
    "preservation-blast": c("action", "all within Melee, d8+3 magic using Spellcast, knocked back to Far"),
    "rift-walker": c("action", "Spellcast (15), place or open a rift for escape"),
    "rune-ward": c("reaction", "the ward's holder spends a Hope to reduce damage by 1d8"),
    "sensory-projection": c("action", "once per rest Spellcast (15) vision of a known place"),
    telekinesis: c("action", "move a target within Far, throw it at a second target for d12+4"),
    "unleash-chaos": c("action", "session tokens, d10 magic per token spent"),
    "wall-walk": c("action", "spend a Hope: a creature climbs walls until the end of the scene"),
  },
  blade: {
    "a-soldier-s-bond": o("compliment or ask someone: both gain 3 Hope (social)"),
    "battle-cry": c("action", "once per long rest, allies clear a Stress, gain a Hope, advantage on attacks"),
    "battle-monster": c("rider", "on a successful attack, mark 4 Stress: target marks HP = your marked HP"),
    "battle-hardened": c("reaction", "once per long rest, instead of a Death Move spend a Hope to clear a HP"),
    "blade-touched": p("passive", "4+ Blade cards: +2 attack rolls, +4 Severe threshold"),
    "champion-s-edge": c("rider", "on a critical attack, up to 3 Hope for distinct options"),
    "deadly-focus": c("action", "once per rest, +1 Proficiency against one target"),
    "fortified-armor": p("passive", "while wearing armor, +2 damage thresholds"),
    frenzy: c("action", "once per long rest Frenzy: +10 damage, +8 Severe, no Armor Slots"),
    "get-back-up": c("reaction", "when you take Severe damage, mark a Stress to reduce one threshold"),
    "glancing-blow": c("reaction", "when you fail an attack, mark a Stress for half-Proficiency damage"),
    "gore-and-glory": c("rider", "on a critical weapon attack or a defeat, gain a Hope or clear a Stress"),
    "not-good-enough": c("rider", "reroll 1s and 2s on your damage dice"),
    onslaught: c("mixed", "damage never below Major (passive) and a Stress reaction when an ally is hit"),
    "rage-up": c("rider", "before an attack, mark a Stress (up to twice) for +2x Strength damage"),
    "reaper-s-strike": c("action", "once per long rest, a Hope: one target hit marks 5 HP"),
    reckless: c("rider", "mark a Stress for advantage on an attack"),
    scramble: c("reaction", "once per rest, avoid a Melee attack and move out of Melee"),
    "versatile-fighter": c("rider", "another trait for a weapon; a Stress to max one damage die"),
    vitality: p("passive", "permanent HP / Stress slot / threshold picks, then vaulted"),
    whirlwind: c("rider", "on a Very Close hit, a Hope: same attack on all others, half damage"),
  },
  bone: {
    "bone-touched": c("mixed", "+1 Agility (passive); once per rest 3 Hope to make an attack fail"),
    boost: c("action", "mark a Stress, aerial attack within Far with advantage, +d10 damage"),
    brace: c("reaction", "when you mark an Armor Slot, a Stress marks one more"),
    "breaking-blow": c("rider", "on a successful attack, a Stress: next hit on that target +2d12"),
    "cruel-precision": p("passive", "successful weapon attacks add Finesse or Agility to damage"),
    deathrun: c("action", "3 Hope, attack all along a path, one damage die fewer per target"),
    "deft-maneuvers": c("action", "once per rest, sprint within Far, +1 to the next attack"),
    ferocity: c("reaction", "when you make an adversary mark HP, 2 Hope for Evasion"),
    "i-see-it-coming": c("reaction", "targeted from beyond Melee: a Stress for +d4 Evasion"),
    "know-thy-enemy": c("action", "Instinct Roll vs a creature, a Hope for information, a Stress to remove a Fear"),
    "on-the-brink": p("passive", "with 2 or fewer HP unmarked, no Minor damage"),
    "rapid-riposte": c("reaction", "a Melee attack against you fails: a Stress for weapon damage back"),
    recovery: o("short rest: take a long rest downtime move (downtime)"),
    redirect: c("reaction", "an attack from beyond Melee fails: d6s, on a 6 redirect it"),
    "signature-move": c("rider", "once per rest, roll a d20 as your Hope Die"),
    "splintering-strike": c("action", "a Hope, attack all in weapon range, split the damage"),
    "strategic-approach": c("rider", "long-rest tokens: advantage, clear an ally's Stress or +d8 damage"),
    "swift-step": p("auto", "an attack against you fails: clear a Stress or gain a Hope"),
    tactician: c("rider", "Help an Ally adds an Experience; Tag Team with a d20 Hope Die"),
    untouchable: p("passive", "+half Agility to Evasion"),
    wrangle: c("action", "Agility Roll vs all within Close, a Hope to move them"),
  },
  codex: {
    banish: c("action", "Spellcast vs Close, d20s set the reaction roll, banished on a failure"),
    "book-of-ava": c("action", "Power Push, Tava's Armor, Ice Spike"),
    "book-of-exota": c("mixed", "Repudiate (reaction) and Create Construct"),
    "book-of-grynn": c("mixed", "Arcane Deflection (reaction), Time Lock, Wall of Flame"),
    "book-of-homet": c("action", "Pass Through and Plane Gate (escape)"),
    "book-of-illiat": c("action", "Slumber, Arcane Barrage, Telepathy"),
    "book-of-korvax": c("action", "Levitation, Recant, Rune Circle"),
    "book-of-norai": c("action", "Mystic Tether, Fireball"),
    "book-of-ronin": c("action", "Transform, Eternal Enervation"),
    "book-of-sitil": c("action", "Adjust Appearance, Parallela, Illusion"),
    "book-of-tyfar": c("action", "Wild Flame, Magic Hand, Mysterious Mist"),
    "book-of-vagras": c("action", "Runic Lock, Arcane Door, Reveal (Runic Lock is out of combat)"),
    "book-of-vyola": c("action", "Memory Delve, Shared Clarity"),
    "book-of-yarrow": c("action", "Timejammer, Magic Immunity"),
    "codex-touched": c("rider", "a Stress to add Proficiency to a Spellcast Roll; once-per-rest free swap"),
    "disintegration-wave": c("action", "once per long rest, Stress per adversary with Difficulty 18 or lower"),
    "manifest-wall": c("action", "Spellcast (15), a Hope, a wall within Far"),
    "safe-haven": o("summon an interdimensional home to rest in (downtime)"),
    "sigil-of-retribution": c("action", "mark an adversary; d8s gathered when it deals damage, added to your hit"),
    teleport: c("action", "once per long rest, Spellcast (16) teleport to a known place (escape)"),
    "transcendent-union": c("action", "once per long rest, 5 Hope: linked creatures share Stress and HP"),
  },
  grace: {
    "astral-projection": c("action", "once per long rest, a Stress for a projected copy"),
    copycat: c("action", "once per long rest, mimic another player's card"),
    "deft-deceiver": o("a Hope for advantage to deceive (social)"),
    encore: c("reaction", "an ally within Close deals damage: Spellcast to deal the same"),
    "endless-charisma": o("after a roll to persuade or lie, a Hope to reroll a die (social)"),
    enrapture: c("action", "Spellcast vs Close, Enraptured, once per rest a Stress for a Stress"),
    "grace-touched": c("mixed", "Armor Slot instead of Stress; HP marks turned into Stress"),
    "hypnotic-shimmer": c("action", "all in front within Close, once per rest Stunned and a Stress"),
    "inspirational-words": c("action", "long-rest tokens: an ally clears a Stress or HP or gains a Hope"),
    invisibility: c("action", "Spellcast (10), a Stress, Invisible with tokens"),
    "mass-enrapture": c("action", "all within Far Enraptured; a Stress makes them all mark a Stress"),
    "master-of-the-craft": o("permanent Experience bonus, then vaulted (level-up)"),
    "never-upstaged": c("reaction", "when you mark HP from an attack, a Stress for damage tokens"),
    notorious: o("leverage notoriety: a Stress for +10 (social)"),
    "share-the-burden": c("action", "once per rest, take a willing creature's Stress and gain Hope"),
    "soothing-speech": o("short rest Tend to Wounds bonus (downtime)"),
    "tell-no-lies": c("action", "Spellcast vs Very Close; a refusal makes them mark a Stress"),
    "thought-delver": c("action", "a Hope to read a target's thoughts within Far"),
    "through-your-eyes": c("action", "see through a target's eyes within Very Far"),
    troublemaker: c("action", "Presence Roll vs Far, once per rest d4s, Stress = the highest"),
    "words-of-discord": c("action", "Spellcast (13) in Melee: a Stress and it attacks another adversary"),
  },
  midnight: {
    chokehold: c("action", "behind a creature, a Stress: Vulnerable, attacks on it +2d6"),
    "dark-whispers": c("action", "speak into a touched mind; a Stress and Spellcast for answers"),
    eclipse: c("action", "Spellcast (16), once per long rest darkness: disadvantage against you, Stress on Hope"),
    "glyph-of-nightfall": c("action", "Spellcast vs Very Close, a Hope: Difficulty minus Knowledge"),
    hush: c("action", "Spellcast vs Close, a Hope: Silenced area"),
    "mass-disguise": o("a few minutes of silence: disguise willing creatures (social)"),
    "midnight-spirit": c("action", "a Hope, a spirit; send it: Spellcast vs Very Far, d6s per Spellcast"),
    "midnight-touched": c("mixed", "Hope instead of a GM Fear at 0 Hope; a Stress to add the Fear Die"),
    "night-terror": c("action", "once per long rest, save (16) or Horrified; stolen Fear as d6 damage"),
    "phantom-retreat": c("action", "a Hope to mark a spot, another to return to it"),
    "pick-and-pull": p("passive", "advantage to pick locks, disarm traps or steal"),
    "rain-of-blades": c("action", "a Hope, all within Very Close, d8+2 using Proficiency, +1d8 if Vulnerable"),
    shadowbind: c("action", "all adversaries within Very Close Restrained"),
    shadowhunter: p("passive", "in low light: +1 Evasion and advantage on attacks"),
    "specter-of-the-dark": c("action", "a Stress: Spectral, immune to physical damage"),
    spellcharge: c("mixed", "tokens from magic damage taken (auto); spend for d6s on a hit"),
    "stealth-expertise": c("reaction", "a Stress to turn a sneaking roll with Fear into Hope"),
    "twilight-toll": c("action", "choose a target; tokens from non-damage successes add d12s"),
    "uncanny-disguise": o("a few minutes to prepare: a humanoid disguise (social)"),
    "vanishing-dodge": c("reaction", "a physical attack against you fails: a Hope to become Hidden and teleport"),
    "veil-of-night": c("action", "Spellcast (13), a curtain of darkness within Far"),
  },
  sage: {
    "conjure-swarm": c("action", "Armored Beetles (reduce severity) or Fire Flies (2d8+3)"),
    "conjured-steeds": c("action", "Hope per steed: -2 attack, +2 damage while riding"),
    "corrosive-projectile": c("action", "Spellcast vs Far, d6+4 using Proficiency, Stress for Corroded"),
    "death-grip": c("action", "Spellcast vs Close, pick pull / 2 Stress / vines, Restrained"),
    "fane-of-the-wilds": c("rider", "long-rest tokens spent for +1 each after a Spellcast Roll"),
    forager: o("extra downtime move: roll a d6 for a consumable (downtime)"),
    "force-of-nature": c("action", "a Stress to transform: +10 damage, can't be Restrained, Hope upkeep"),
    "forest-sprites": c("action", "Spellcast (13), Hope per sprite: +3 attack, extra Armor Slot"),
    "gifted-tracker": o("Hope for tracking questions (exploration)"),
    "healing-field": c("action", "once per long rest, you and allies within Close clear 1 (or 2) HP"),
    "natural-familiar": c("action", "a Hope for a familiar; +d6 damage near it"),
    "nature-s-tongue": o("speak with plants and animals; Hope for +2 Spellcast in nature (exploration)"),
    "plant-dominion": c("action", "Spellcast (18), once per long rest reshape plants within Far"),
    "rejuvenation-barrier": c("action", "Spellcast (15), once per rest clear 1d4 HP, physical resistance"),
    "sage-touched": c("rider", "+2 Spellcast in nature; once per rest double Agility or Instinct"),
    tempest: c("action", "choose Blizzard, Hurricane or Sandstorm, all within Far"),
    "thorn-skin": c("reaction", "once per rest tokens; reduce damage by d6s and deal it back"),
    "towering-stalk": c("action", "once per rest stalk; a Stress to attack a group within Close for d8"),
    "vicious-entangle": c("action", "Spellcast vs Far, 1d8+1 physical, Restrained, a Hope for a second"),
    "wild-fortress": c("action", "Spellcast (13), 2 Hope, a dome with thresholds 15/30"),
    "wild-surge": c("action", "once per long rest, a Stress: the Wild Surge Die adds to action rolls"),
  },
  splendor: {
    "bolt-beacon": c("action", "Spellcast vs Far, a Hope, d8+2 magic using Proficiency, Vulnerable"),
    divination: o("once per long rest, 3 Hope for a yes-or-no question (exploration)"),
    "final-words": c("action", "Spellcast (13), question a corpse"),
    "healing-hands": c("action", "Spellcast (13) in Melee, a Stress to clear 2 HP or 2 Stress"),
    "healing-strike": c("reaction", "when you deal damage, 2 Hope to clear an ally's HP"),
    invigoration: c("reaction", "an exhausted feature nearby: Hope as d6s, a 6 refreshes it"),
    "life-ward": c("action", "3 Hope: an ally clears a HP instead of a death move"),
    "mending-touch": c("action", "a few minutes: 2 Hope to clear a HP or a Stress"),
    "overwhelming-aura": c("action", "Spellcast (15), 2 Hope: Presence = Spellcast, attackers mark a Stress"),
    reassurance: c("reaction", "once per rest, an ally rerolls an action roll"),
    restoration: c("action", "long-rest tokens: clear 2 HP or 2 Stress per token, clear Vulnerable"),
    resurrection: c("action", "Spellcast (20), restore a dead creature"),
    "salvation-beam": c("action", "Spellcast (16), Stress as HP cleared along a line of allies"),
    "second-wind": c("rider", "once per rest on a hit, clear 3 Stress or a HP (and an ally's on Hope)"),
    "shape-material": c("action", "a Hope to shape natural material"),
    "shield-aura": c("action", "a Stress: an Armor Slot reduces one more threshold"),
    smite: c("action", "once per rest, 3 Hope: the next weapon hit deals double magic damage"),
    "splendor-touched": c("mixed", "+3 Severe threshold; once per long rest HP as Stress or Hope"),
    "stunning-sunlight": c("action", "all in front within Far, Hope picks who saves (14), 3d20+3 / 4d20+5"),
    "voice-of-reason": p("passive", "social advantage; +1 Proficiency on damage with full Stress"),
    "zone-of-protection": c("action", "Spellcast (16), once per long rest zone: allies reduce damage by the die"),
  },
  valor: {
    armorer: p("passive", "+1 Armor Score while armored; allies clear an Armor Slot on repair"),
    "bare-bones": p("passive", "no armor: Armor Score 3 + Strength and tier thresholds"),
    "body-basher": p("passive", "a successful Melee weapon attack adds Strength to damage"),
    "bold-presence": c("mixed", "a Hope to add Strength to Presence; once per rest avoid a condition"),
    "critical-inspiration": c("rider", "once per rest on a critical attack, allies clear a Stress or gain a Hope"),
    "forceful-push": c("action", "primary weapon attack in Melee, knock back to Close, +d6 on Hope, Vulnerable"),
    "full-surge": c("action", "once per long rest, 3 Stress: +2 to all traits until a rest"),
    "goad-them-on": c("action", "Presence Roll vs Close: a Stress, it must attack you with disadvantage"),
    "ground-pound": c("action", "2 Hope, Strength Roll vs Very Close, thrown to Far, save (17) 4d10+8"),
    "hold-the-line": c("action", "a Hope: adversaries entering Very Close are pulled in and Restrained"),
    "i-am-your-shield": c("reaction", "an ally within Very Close would take damage: a Stress, become the target"),
    inevitable: p("auto", "after a failed action roll, the next one has advantage"),
    "lead-by-example": c("reaction", "when you deal damage, a Stress: the next attacker clears a Stress or gains a Hope"),
    "lean-on-me": c("reaction", "once per long rest, an ally failed: both clear 2 Stress"),
    "rise-up": p("auto", "+Proficiency Severe threshold; marking HP from an attack clears a Stress"),
    "rousing-strike": c("rider", "once per rest on a critical attack, everyone clears a HP or 1d4 Stress"),
    "shrug-it-off": c("reaction", "when you would take damage, a Stress to reduce one threshold; d6 or vault"),
    "support-tank": c("reaction", "an ally within Close fails: 2 Hope to reroll a duality die"),
    unbreakable: c("reaction", "on your last HP, roll a d6 and clear that many HP instead of a death move"),
    "unyielding-armor": p("auto", "marking an Armor Slot: Proficiency d6s, a 6 reduces it for free"),
    "valor-touched": p("passive", "+1 Armor Score; marking HP without armor clears an Armor Slot"),
  },
  dread: {
    "blighting-strike": c("action", "Spellcast vs Far, d6+1 (Hope) or d10+1 (Fear) using Proficiency"),
    "umbral-veil": c("mixed", "once per rest, tokens = GM Fear; spend them as penalties to attacks on you"),
    "voice-of-dread": c("action", "Spellcast vs a creature you see: a Stress and Restrained"),
    "hideous-retribution": c("reaction", "an ally within Close takes damage: reaction roll, d6 magic back"),
    "siphon-essence": c("action", "Spellcast vs Very Close, once per long rest d12+4, heal what it marks"),
    "shared-trauma": c("action", "once per rest, move HP from one willing creature to another"),
    terrify: c("action", "Spellcast vs Close: 1d4 Stress, flee, Vulnerable with Fear"),
    "summon-horror": c("action", "a Stress, d8+1 magic using Spellcast, save (12) or Stress"),
    "chains-of-affliction": c("action", "2 Stress: a Chained target's hits mark one fewer HP"),
    "dire-strike": c("reaction", "a target marks HP from your attack: a Hope, the GM loses a Fear"),
    "spectral-mist": c("action", "2 Hope: you and allies incorporeal, immune to physical damage"),
    darkfire: c("action", "Hope per target within Close, save (15), d8+6 using Spellcast"),
    "jump-scare": c("reaction", "when you deal magic damage, a Stress to teleport in: Vulnerable"),
    "dread-touched": c("mixed", "2 Stress to stop a GM Fear; once per rest + GM Fear to a roll"),
    "wall-of-hunger": c("action", "Spellcast (10), a Hope, a wall: creatures inside mark 2 Stress"),
    "dark-army": c("action", "Spellcast (14), once per long rest 8 tokens: +1d8 damage or -1d8 taken"),
    "eldritch-flesh": c("mixed", "+1 thresholds per marked Stress; on Fear, 2 Hope to clear an Armor Slot"),
    damnation: c("action", "Spellcast vs Far, Stress as d20s of magic damage"),
    "savor-the-anguish": p("auto", "an adversary within Close takes Severe damage: clear a Stress"),
    "avatar-of-terror": c("action", "a Stress to transform: 1d6 damage per GM Fear, Hope upkeep"),
    "invoke-torment": p("auto", "double damage on full-Stress targets; Hope when one is defeated"),
  },
};

/** The classification of one card, or undefined for an unknown id. */
export function cardClass(cardId: string): CardClass | undefined {
  for (const domain of Object.values(CARD_CLASSIFICATION)) {
    const found = domain[cardId];
    if (found) return found;
  }
  return undefined;
}

/** "combat" | "passive" | "outOfCombat"; unknown cards count as out of combat (refused, never guessed). */
export function cardUsage(cardId: string): CardUsage {
  return cardClass(cardId)?.usage ?? "outOfCombat";
}
