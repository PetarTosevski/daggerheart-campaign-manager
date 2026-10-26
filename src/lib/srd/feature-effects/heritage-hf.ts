// Feature effects of the Hope & Fear ancestries and every community (FE-heritage-hf) (plan sheet-drawer).
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page and uses only the vocabulary of src/lib/domain/card-effects/types.ts (a gap is a `manual` step plus a bead).
//
// What is here (docs/tasks/TASK-SD-FE-heritage-hf.md):
// - Every Hope & Fear ancestry feature and every community feature the classification marks combat or passive.
// - The social advantages (Q13, Q15 b): Privilege, Well-Read, Steady, Scoundrel, Low-Light Living, Lightfoot, and the
//   Core Book's Dread Visage (Infernis) and Natural Climber (Simiah), as roll options: passive advantage gated by a
//   `situation` the player ticks in the dice box.
// - The rest-time features (Q15 b): Hardy, Oasis, and the Core Book's Efficient (Clank) and Celestial Trance (Elf), as
//   rest-trigger entries (`timing` triggers) that tracer SD-R runs in the rest flow.
// Not here: Immovable and Amphibious (narrative), Nomadic Pack (out of combat, not a roll option or rest move), and
// Luckbringer (a Core ancestry feature classified passive, so FE-ancestry-core's table holds it).
//
// Vocabulary gaps (manual text or a player check box instead): Ignition's bonus only "with that weapon" (no weapon filter
// on a damage rider), Eye of the Storm on an ally ending when YOU take Severe damage (`endsOn` reads the bearer), Know the
// Tide's spend delegated to session features (the delegate handler reaches only D5's registry), Efficient and Oasis
// "during a short rest" (no short-rest timing), and the downtime-move steps of the rest-time features.

import type { CardUse, NumberSource, Requirement, RollFilter } from "../../domain/card-effects/types";
import type { FeatureEffect } from "../../domain/feature-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });

/** Q16: "while flying" is the drawer's Flying toggle (a sheet effect with the `flying` flag), read by the engine. */
const FLYING: Requirement = { kind: "situation", text: "You are flying", check: { kind: "flying" } };

/** The situation texts the player confirms (Q13). Exported so the dice box and the tests use the same words. */
export const HERITAGE_SITUATIONS = {
  privilege: "The roll is to consort with nobles, negotiate prices, or leverage your reputation to get what you want",
  wellRead: "The roll involves the history, culture, or politics of a prominent person or place",
  steady: "The roll is to traverse dangerous cliffs and ledges, navigate harsh environments, or use your survival knowledge",
  scoundrel: "The roll is to negotiate with criminals, detect lies, or find a safe place to hide",
  lowLight: "You're in an area with low light or heavy shadow, and the roll is to hide, investigate, or perceive details within that area",
  lightfoot: "The roll is to move without being heard",
  dreadVisage: "The roll is to intimidate hostile creatures",
  naturalClimber: "The Agility Roll involves balancing or climbing",
  dedicated: "You describe how you're embodying one of your three recorded principles through your current action",
  lifespring: "You have access to a small amount of water",
  fireproof: "The incoming damage is from magical or mundane flame",
  ignitionWeapon: "The damage roll is with your primary weapon, which Ignition set ablaze",
  shortRest: "This is a short rest",
} as const;

/**
 * A social advantage as a roll option (Q13, Q15 b): always available while the player confirms the situation, it gives
 * advantage on the roll (CB p.20 advantage: roll a d6 and add it).
 */
function rollOption(featureId: string, source: "ancestry" | "community", owner: string, name: string, situation: string, on: RollFilter = "action"): FeatureEffect {
  return {
    featureId,
    source,
    owner,
    uses: [{ id: "main", name, activation: { kind: "passive" }, requires: [{ kind: "situation", text: situation }], mods: [{ kind: "advantage", on }], steps: [] }],
  };
}

/** A rest-time feature (Q15 b): a `timing` trigger at the rest; SD-R's rest flow carries out the downtime-move part. */
function restUse(name: string, text: string, requires?: readonly Requirement[]): CardUse {
  return {
    id: "main",
    name,
    activation: { kind: "reaction", trigger: { kind: "timing", at: "afterRest" } },
    ...(requires ? { requires } : {}),
    steps: [{ kind: "manual", to: "self", text }],
  };
}

export const HERITAGE_HF_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Hope & Fear ancestries

  // Hallowed Aura (Aetheris, HF p.19): "Once per long rest when an ally within Close range rolls with Fear, you can
  // change it into a roll with Hope instead." Q1: offered in the ally's after-roll step.
  {
    featureId: "ancestry:aetheris:hallowed-aura",
    source: "ancestry",
    owner: "aetheris",
    uses: [
      {
        id: "main",
        name: "Hallowed Aura",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", range: "close", result: "withFear" } },
        limit: { per: "longRest" },
        steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "withHope" } }],
      },
    ],
  },

  // Celestial Wings (Aetheris, HF p.19): "You have wings that allow you to fly. Once per scene while flying, you can
  // spend a Hope instead of marking an Armor Slot." Flying is the drawer's toggle (Q16, SD3 setFlying); the scene limit is
  // Q7. When you mark an Armor Slot to reduce incoming damage (CB p.114), the mark is paid with a Hope instead (the convert
  // spends the Hope, as Splendor-Touched's "spend that much Hope instead", CB p.341).
  {
    featureId: "ancestry:aetheris:celestial-wings",
    source: "ancestry",
    owner: "aetheris",
    uses: [
      {
        id: "main",
        name: "Celestial Wings",
        activation: { kind: "reaction", trigger: { kind: "whenArmorSlotMarked", who: "self" } },
        requires: [FLYING],
        limit: { per: "scene" },
        steps: [{ kind: "convertMarks", to: "self", from: "armor", into: "hope", note: "Spend a Hope instead of marking the Armor Slot" }],
      },
    ],
  },

  // Stoneskin (Earthkin, HF p.21): "Gain a permanent +1 bonus to your Armor Score and damage thresholds at character
  // creation." Passive: SD2's passiveMods adds it to the derived stats.
  {
    featureId: "ancestry:earthkin:stoneskin",
    source: "ancestry",
    owner: "earthkin",
    uses: [
      {
        id: "main",
        name: "Stoneskin",
        activation: { kind: "passive" },
        mods: [
          { kind: "stat", stat: "armorScore", delta: n(1) },
          { kind: "stat", stat: "majorThreshold", delta: n(1) },
          { kind: "stat", stat: "severeThreshold", delta: n(1) },
        ],
        steps: [],
      },
    ],
  },

  // Fireproof (Emberkin, HF p.22): "You are immune to damage from magical or mundane flame." CB p.99: "If a target is
  // immune to a damage type, they ignore incoming damage of that type." Damage has no fire keyword (bead dcm-dv6), so the
  // player confirms the flame in the reaction window (Q13) and the damage is negated.
  {
    featureId: "ancestry:emberkin:fireproof",
    source: "ancestry",
    owner: "emberkin",
    uses: [
      {
        id: "main",
        name: "Fireproof",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        requires: [{ kind: "situation", text: HERITAGE_SITUATIONS.fireproof }],
        steps: [{ kind: "negate", to: "self", what: "damage", note: "Immune to flame (HF p.22)" }],
      },
    ],
  },

  // Ignition (Emberkin, HF p.22): "Mark a Stress to wreathe your primary weapon in flame until the end of the scene. While
  // the weapon is ablaze, it gives off a bright light, and you gain a 1d6 bonus to damage rolls with that weapon."
  // The Use marks the Stress and sets the scene-long effect (Q7); the 1d6 is a damage rider while the effect is active,
  // rolled with each damage roll (a stat mod would roll it once). "With that weapon": the player confirms (no weapon filter).
  {
    featureId: "ancestry:emberkin:ignition",
    source: "ancestry",
    owner: "emberkin",
    uses: [
      {
        id: "main",
        name: "Ignition",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "effect", to: "self", label: "Ignition: primary weapon ablaze (bright light, +1d6 damage with it)", mods: [], duration: "scene" }],
      },
      {
        id: "ablaze",
        name: "Ignition: +1d6 damage",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        requires: [
          { kind: "situation", text: "Your primary weapon is ablaze (Ignition)", check: { kind: "featureEffect", featureId: "ancestry:emberkin:ignition" } },
          { kind: "situation", text: HERITAGE_SITUATIONS.ignitionWeapon },
        ],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: { count: n(1), sides: 6 } } } }],
      },
    ],
  },

  // Nimble Fingers (Gnome, HF p.25): "When you make a Finesse Roll, you can spend 2 Hope to reroll your Hope Die."
  // Offered after the roll (Q1, CB p.107: the new result stands).
  {
    featureId: "ancestry:gnome:nimble-fingers",
    source: "ancestry",
    owner: "gnome",
    uses: [
      {
        id: "main",
        name: "Nimble Fingers",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "finesse" } },
        costs: [{ kind: "hope", amount: n(2) }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "reroll", dice: "hope" } }],
      },
    ],
  },

  // Flicker Step (Gnome, HF p.25): "Once per scene, you can teleport to another point you can see within Far range."
  // Movement is a prompt (Q9); the scene limit is Q7.
  {
    featureId: "ancestry:gnome:flicker-step",
    source: "ancestry",
    owner: "gnome",
    uses: [
      {
        id: "main",
        name: "Flicker Step",
        activation: { kind: "action" },
        limit: { per: "scene" },
        steps: [{ kind: "move", to: "self", mode: "teleport", range: "far", relativeTo: "self", note: "To another point you can see within Far range" }],
      },
    ],
  },

  // Gale Force (Skykin, HF p.23): "Mark a Stress to conjure a gust of wind that carries you or a Very Close ally up to
  // Very Far range. Additionally, you can always control the speed at which you fall." The carry is a move prompt (Q9);
  // controlling your fall is fiction.
  {
    featureId: "ancestry:skykin:gale-force",
    source: "ancestry",
    owner: "skykin",
    uses: [
      {
        id: "main",
        name: "Gale Force",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "selfOrAlly", range: "veryClose", count: { kind: "one" } },
        steps: [{ kind: "move", to: "targets", mode: "move", range: "veryFar", relativeTo: "self", note: "A gust of wind carries them up to Very Far range" }],
      },
    ],
  },

  // Eye of the Storm (Skykin, HF p.23): "Spend 2 Hope to grant you or an ally within Melee range a +1 bonus to Evasion
  // until you take Severe damage or you use this feature again." On yourself both events end it (`endsOn`); on an ally,
  // `takeSevere` would read the ally, so "you take Severe damage" is the effect's `endsWhen` (ended by hand; gap bead).
  {
    featureId: "ancestry:skykin:eye-of-the-storm",
    source: "ancestry",
    owner: "skykin",
    uses: [
      {
        id: "main",
        name: "Eye of the Storm (you)",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(2) }],
        targets: { side: "self", range: "melee", count: { kind: "one" } },
        exclusive: true,
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Eye of the Storm: +1 Evasion",
            mods: [{ kind: "stat", stat: "evasion", delta: n(1) }],
            duration: "manual",
            endsOn: ["takeSevere", "usedAgain"],
            endsWhen: "You take Severe damage or use Eye of the Storm again",
          },
        ],
      },
      {
        id: "ally",
        name: "Eye of the Storm (an ally)",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(2) }],
        targets: { side: "ally", range: "melee", count: { kind: "one" }, excludeSelf: true },
        exclusive: true,
        steps: [
          {
            kind: "effect",
            to: "targets",
            label: "Eye of the Storm: +1 Evasion",
            mods: [{ kind: "stat", stat: "evasion", delta: n(1) }],
            duration: "manual",
            endsOn: ["usedAgain"],
            endsWhen: "The skykin who granted it takes Severe damage or uses Eye of the Storm again",
          },
        ],
      },
    ],
  },

  // Lifespring (Tidekin, HF p.24): "Once per rest when you have access to a small amount of water, you can mark a Stress
  // to clear a Hit Point on yourself or an ally within Very Close range." The water is the player's check box (Q13).
  {
    featureId: "ancestry:tidekin:lifespring",
    source: "ancestry",
    owner: "tidekin",
    uses: [
      {
        id: "main",
        name: "Lifespring",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: HERITAGE_SITUATIONS.lifespring }],
        limit: { per: "rest" },
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "selfOrAlly", range: "veryClose", count: { kind: "one" } },
        steps: [{ kind: "clear", to: "targets", track: "hp", amount: n(1) }],
      },
    ],
  },

  // ---------------------------------------------------------------- Core ancestries: roll options and rest time (Q15 b)

  // Dread Visage (Infernis, CB p.66): "You have advantage on rolls to intimidate hostile creatures."
  rollOption("ancestry:infernis:dread-visage", "ancestry", "infernis", "Dread Visage", HERITAGE_SITUATIONS.dreadVisage),
  // Natural Climber (Simiah, CB p.70): "You have advantage on Agility Rolls that involve balancing and climbing."
  rollOption("ancestry:simiah:natural-climber", "ancestry", "simiah", "Natural Climber", HERITAGE_SITUATIONS.naturalClimber, "agility"),

  // Efficient (Clank, CB p.53): "When you take a short rest, you can choose a long rest move instead of a short rest
  // move." SD-R offers the long rest moves in the short rest picker.
  {
    featureId: "ancestry:clank:efficient",
    source: "ancestry",
    owner: "clank",
    uses: [restUse("Efficient", "Choose a long rest move instead of a short rest move.", [{ kind: "situation", text: HERITAGE_SITUATIONS.shortRest }])],
  },
  // Celestial Trance (Elf, CB p.56): "During a rest, you can drop into a trance to choose an additional downtime move."
  // SD-R adds one downtime move slot on any rest.
  {
    featureId: "ancestry:elf:celestial-trance",
    source: "ancestry",
    owner: "elf",
    uses: [restUse("Celestial Trance", "Drop into a trance to choose an additional downtime move.")],
  },

  // ---------------------------------------------------------------- Core communities

  // Privilege (Highborne, CB p.73): "You have advantage on rolls to consort with nobles, negotiate prices, or leverage
  // your reputation to get what you want."
  rollOption("community:highborne:privilege", "community", "highborne", "Privilege", HERITAGE_SITUATIONS.privilege),
  // Well-Read (Loreborne, CB p.74): "You have advantage on rolls that involve the history, culture, or politics of a
  // prominent person or place."
  rollOption("community:loreborne:well-read", "community", "loreborne", "Well-Read", HERITAGE_SITUATIONS.wellRead),

  // Dedicated (Orderborne, CB p.75): "Record three sayings or values your upbringing instilled in you. Once per rest, when
  // you describe how you're embodying one of these principles through your current action, you can roll a d20 as your
  // Hope Die." Only Orderborne characters hold it (the user's note on Q13; owned() reads `communityId`); the player
  // confirms the principle (Q13). A toggle before the action roll.
  {
    featureId: "community:orderborne:dedicated",
    source: "community",
    owner: "orderborne",
    uses: [
      {
        id: "main",
        name: "Dedicated",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [{ kind: "situation", text: HERITAGE_SITUATIONS.dedicated }],
        limit: { per: "rest" },
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "hopeDie", sides: 20 } }],
      },
    ],
  },

  // Steady (Ridgeborne, CB p.76): "You have advantage on rolls to traverse dangerous cliffs and ledges, navigate harsh
  // environments, and use your survival knowledge."
  rollOption("community:ridgeborne:steady", "community", "ridgeborne", "Steady", HERITAGE_SITUATIONS.steady),

  // Know the Tide (Seaborne, CB p.77): "You can sense the ebb and flow of life. When you roll with Fear, place a token on
  // your community card. You can hold a number of tokens equal to your level. Before you make an action roll, you can
  // spend any number of these tokens to gain a +1 bonus to the roll for each token spent. At the end of each session,
  // clear all unspent tokens."
  // The tokens are the session features' record (`sessionFeatures.tideTokens`, src/lib/domain/session-features/tide.ts):
  // the dice path already places a token after an action roll with Fear and clears them at session end. This rider spends
  // them before an action roll: the `delegate` step names the session feature's spend (`spendTideTokens`, which checks the
  // tokens held), and the roll gains +1 per token spent.
  {
    featureId: "community:seaborne:know-the-tide",
    source: "community",
    owner: "seaborne",
    uses: [
      {
        id: "main",
        name: "Know the Tide",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        choices: [{ id: "tokens", label: "Tide tokens to spend", min: 1, max: { kind: "level" } }],
        steps: [
          { kind: "delegate", to: "self", feature: "knowTheTide", params: { amount: { kind: "chosen", choice: "tokens" } }, note: "Spend the Tide tokens (session features)" },
          { kind: "modifyRoll", to: "self", change: { kind: "add", amount: { kind: "chosen", choice: "tokens" } } },
        ],
      },
    ],
  },

  // Scoundrel (Slyborne, CB p.78): "You have advantage on rolls to negotiate with criminals, detect lies, or find a safe
  // place to hide."
  rollOption("community:slyborne:scoundrel", "community", "slyborne", "Scoundrel", HERITAGE_SITUATIONS.scoundrel),
  // Low-Light Living (Underborne, CB p.79): "When you're in an area with low light or heavy shadow, you have advantage on
  // rolls to hide, investigate, or perceive details within that area."
  rollOption("community:underborne:low-light-living", "community", "underborne", "Low-Light Living", HERITAGE_SITUATIONS.lowLight),
  // Lightfoot (Wildborne, CB p.81): "Your movement is naturally silent. You have advantage on rolls to move without being
  // heard."
  rollOption("community:wildborne:lightfoot", "community", "wildborne", "Lightfoot", HERITAGE_SITUATIONS.lightfoot),

  // ---------------------------------------------------------------- Hope & Fear communities

  // Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take
  // the higher result." SD-R offers the reroll on a rolled downtime die of the holder or an ally.
  {
    featureId: "community:duneborne:oasis",
    source: "community",
    owner: "duneborne",
    uses: [restUse("Oasis", "You or an ally can reroll a die used for a downtime move and take the higher result.", [{ kind: "situation", text: HERITAGE_SITUATIONS.shortRest }])],
  },

  // Unbound (Freeborne, HF p.28): "Once per session when you roll with Fear, you can change it into a roll with Hope
  // instead." Q1: the after-roll step on your own roll.
  {
    featureId: "community:freeborne:unbound",
    source: "community",
    owner: "freeborne",
    uses: [
      {
        id: "main",
        name: "Unbound",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "any", result: "withFear" } },
        limit: { per: "session" },
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "withHope" } }],
      },
    ],
  },

  // Hardy (Frostborne, HF p.29): "When you take a rest, you clear a Hit Point." Any rest (CB p.105); SD-R runs it.
  {
    featureId: "community:frostborne:hardy",
    source: "community",
    owner: "frostborne",
    uses: [
      {
        id: "main",
        name: "Hardy",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterRest" } },
        steps: [{ kind: "clear", to: "self", track: "hp", amount: n(1) }],
      },
    ],
  },

  // Close-Knit (Hearthborne, HF p.30): "Once per long rest, you can spend any number of Hope to grant an ally within Far
  // range an equal number of Hope."
  {
    featureId: "community:hearthborne:close-knit",
    source: "community",
    owner: "hearthborne",
    uses: [
      {
        id: "main",
        name: "Close-Knit",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        choices: [{ id: "hope", label: "Hope to give", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        targets: { side: "ally", range: "far", count: { kind: "one" }, excludeSelf: true },
        steps: [{ kind: "hope", to: "targets", change: "gain", amount: { kind: "spent", resource: "hope" } }],
      },
    ],
  },

  // Found Family (Reborne, HF p.31): "Once per rest, you can spend a Hope to use an ally's Experience as if it were your
  // own. When you do so, describe how your time with that ally prepared you for this moment. When you join a new
  // community or rediscover your old one, you can permanently trade this card for that one instead."
  // A toggle before your action roll; the ally's Experience is picked in the roll dialog (SD5). Trading the card is a
  // sheet edit.
  {
    featureId: "community:reborne:found-family",
    source: "community",
    owner: "reborne",
    uses: [
      {
        id: "main",
        name: "Found Family",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        limit: { per: "rest" },
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "experience", change: "borrowAlly" } }],
      },
    ],
  },

  // Brave Face (Warborne, HF p.32): "Once per session when you would be forced to mark a Stress, you can spend a Hope
  // instead." The Stress becomes a Hope spent (the convert spends it, as Celestial Wings).
  {
    featureId: "community:warborne:brave-face",
    source: "community",
    owner: "warborne",
    uses: [
      {
        id: "main",
        name: "Brave Face",
        activation: { kind: "reaction", trigger: { kind: "wouldMarkStress", forced: true } },
        limit: { per: "session" },
        steps: [{ kind: "convertMarks", to: "self", from: "stress", into: "hope", note: "Spend a Hope instead of marking the Stress" }],
      },
    ],
  },
];
