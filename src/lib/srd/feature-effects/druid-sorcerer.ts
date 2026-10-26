// Feature effects of Druid and Sorcerer (FE-druid-sorcerer) (plan sheet-drawer). Pure data: no framework imports, relative
// imports only (bundled into Convex). Each entry quotes its feature with the printed page and uses only the vocabulary of
// src/lib/domain/card-effects/types.ts (a gap is a `manual` step plus a bead).
//
// One entry per feature classified combat or passive in ./classification.ts: 17 of the 21 Druid and Sorcerer features
// (Wildtouch, Arcane Sense and Minor Illusion are narrative; Clarity of Nature is out of combat). Book: CB p.30 (Druid,
// Warden of the Elements), p.31 (Warden of Renewal), p.46 (Sorcerer, Elemental Origin), p.47 (Primal Origin); printed
// pages. Readings, manual steps and open rulings: docs/tasks/TASK-SD-FE-druid-sorcerer.md.
//
// - D5 keeps its records (NV2): Evolution and Beastform delegate to D5's `beastform` / `evolution` (the sheet's
//   `beastform` effect), Channel Raw Power to `channelRawPower` (D5's once-per-long-rest key). The entry pays the price.
// - "While Channeling <element>" is a `featureEffect` state check on Elemental Incarnation's effect and its `option`
//   (`fire`, `earth`, `water`, `air`); the aura's uses add an `inArea` check on the actor's own Elemental Aura.
// - What the engine cannot see is a `situation` the player confirms (Q13): "an attack that deals magic damage".

import type { FeatureEffect } from "../../domain/feature-effects/types";
import type { DiceExpr, NumberSource, Requirement, Step } from "../../domain/card-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const d = (count: number, sides: DiceExpr["sides"]): DiceExpr => ({ count: n(count), sides });

const INCARNATION = "subclass:warden-of-the-elements:elemental-incarnation";
const AURA = "subclass:warden-of-the-elements:elemental-aura";
type Element = "fire" | "earth" | "water" | "air";
const ELEMENT_LABEL: Record<Element, string> = { fire: "Fire", earth: "Earth", water: "Water", air: "Air" };

/** "While Channeling" (any element) or "while Channeling <element>". */
const channeling = (element?: Element): Requirement => ({
  kind: "situation",
  text: element ? `You are Channeling ${ELEMENT_LABEL[element]}` : "You are Channeling an element",
  check: element ? { kind: "featureEffect", featureId: INCARNATION, option: element } : { kind: "featureEffect", featureId: INCARNATION },
});

/** Inside your own Elemental Aura (it is centred on you, so this holds while the aura is up). */
const inOwnAura: Requirement = { kind: "situation", text: "Your Elemental Aura is active", check: { kind: "inArea", featureId: AURA, owner: "self" } };

const magicDamage: Requirement = { kind: "situation", text: "The attack deals magic damage" };

/** Channeling ends "until you take Severe damage or until your next rest" (CB p.30). */
const CHANNEL_DURATION = { duration: "rest", endsOn: ["takeSevere"] } as const;

/** Elemental Incarnation's channel effect for one element. */
const channel = (element: Element, mods: Extract<Step, { kind: "effect" }>["mods"]): Step => ({
  kind: "effect",
  to: "self",
  label: `Channeling ${ELEMENT_LABEL[element]}`,
  mods,
  ...CHANNEL_DURATION,
  option: element,
});

/** Elemental Aura's map area for one element (only when Channeling that element). */
const aura = (element: Element, mods?: Extract<Step, { kind: "area" }>["area"]["mods"]): Step => ({
  kind: "area",
  to: "self",
  when: [{ kind: "requires", requirement: channeling(element) }],
  area: {
    label: `Elemental Aura (${ELEMENT_LABEL[element]})`,
    centre: "self",
    radius: "close",
    side: element === "earth" ? "allies" : element === "fire" || element === "water" ? "enemies" : "selfAndAllies",
    ...(mods ? { mods } : {}),
    ...CHANNEL_DURATION,
  },
});

export const DRUID_SORCERER_EFFECTS: readonly FeatureEffect[] = [
  // ------------------------------------------------------------------ Druid (CB p.30)

  // Evolution (Druid's Hope feature, CB p.30): "Spend 3 Hope to transform into a Beastform without marking a Stress. When
  // you do, choose one trait to raise by +1 until you drop out of that Beastform."
  {
    featureId: "hope:druid",
    source: "hope",
    owner: "druid",
    uses: [
      {
        id: "main",
        name: "Evolution",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(3) }],
        steps: [
          // D5's Beastform without its Stress (the delegate pays no Hope or Stress; the entry's 3 Hope is the price).
          { kind: "delegate", to: "self", feature: "beastform", params: { choiceFrom: "form" }, note: "Transform into a Beastform without marking a Stress" },
          { kind: "delegate", to: "self", feature: "evolution", params: { choiceFrom: "trait" }, note: "+1 to the chosen trait until you drop out of that Beastform" },
        ],
      },
    ],
  },

  // Beastform (Druid class feature, CB p.30): "Mark a Stress to magically transform into a creature of your tier or lower
  // from the Beastform list. You can drop out of this form at any time. While transformed, you can't use weapons or cast
  // spells from domain cards, but you can still use other features or abilities you have access to. … you gain the
  // Beastform's features, add their Evasion bonus to your Evasion, and use the trait specified in their statistics for
  // your attack. … If you mark your last Hit Point, you automatically drop out of this form."
  {
    featureId: "class:druid:beastform",
    source: "class",
    owner: "druid",
    uses: [
      {
        id: "main",
        name: "Beastform",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "delegate", to: "self", feature: "beastform", params: { choiceFrom: "form" } }],
      },
    ],
  },

  // Elemental Incarnation (Warden of the Elements foundation, CB p.30): "Mark a Stress to Channel one of the following
  // elements until you take Severe damage or until your next rest:
  // • Fire: When an adversary within Melee range deals damage to you, they take 1d10 magic damage.
  // • Earth: Gain a bonus to your damage thresholds equal to your Proficiency.
  // • Water: When you deal damage to an adversary within Melee range, all other adversaries within Very Close range must
  //   mark a Stress.
  // • Air: You can hover, gaining advantage on Agility Rolls."
  {
    featureId: INCARNATION,
    source: "subclass",
    owner: "warden-of-the-elements",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Elemental Incarnation",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        // One element at a time: Channeling again replaces the current element.
        exclusive: true,
        steps: [
          {
            kind: "choose",
            id: "element",
            label: "Channel an element",
            options: [
              { id: "fire", label: "Fire", steps: [channel("fire", [])] },
              {
                id: "earth",
                label: "Earth",
                steps: [
                  channel("earth", [
                    { kind: "stat", stat: "majorThreshold", delta: { kind: "proficiency" } },
                    { kind: "stat", stat: "severeThreshold", delta: { kind: "proficiency" } },
                  ]),
                ],
              },
              { id: "water", label: "Water", steps: [channel("water", [])] },
              { id: "air", label: "Air", steps: [channel("air", [{ kind: "advantage", on: "agility" }])] },
            ],
          },
        ],
      },
      {
        id: "fire",
        name: "Elemental Incarnation: Fire",
        activation: { kind: "auto", trigger: { kind: "whenYouMarkHp", sourceWithin: "melee" } },
        requires: [channeling("fire")],
        steps: [{ kind: "damage", to: "triggerSource", roll: { kind: "dice", dice: d(1, 10) }, type: "magic" }],
      },
      {
        id: "water",
        name: "Elemental Incarnation: Water",
        activation: { kind: "auto", trigger: { kind: "whenYouDealDamage", toEnemy: true } },
        requires: [channeling("water")],
        // Vocabulary gap: the trigger carries no range and a pick can't leave out the damaged adversary ("all other").
        steps: [
          {
            kind: "manual",
            to: "self",
            text: "If the adversary you damaged is within Melee range: all other adversaries within Very Close range must mark a Stress.",
          },
        ],
      },
    ],
  },

  // Elemental Aura (Warden of the Elements specialization, CB p.30): "Once per rest while Channeling, you can assume an
  // aura matching your element. The aura affects targets within Close range until your Channeling ends.
  // • Fire: When an adversary marks 1 or more Hit Points, they must also mark a Stress.
  // • Earth: Your allies gain a +1 bonus to Strength.
  // • Water: When an adversary deals damage to you, you can mark a Stress to move them anywhere within Very Close range of
  //   where they are.
  // • Air: When you or an ally takes damage from an attack beyond Melee range, reduce the damage by 1d8."
  {
    featureId: AURA,
    source: "subclass",
    owner: "warden-of-the-elements",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Elemental Aura",
        activation: { kind: "action" },
        requires: [channeling()],
        limit: { per: "rest" },
        steps: [
          {
            kind: "choose",
            id: "element",
            label: "The aura of the element you are Channeling",
            options: [
              { id: "fire", label: "Fire", steps: [aura("fire")] },
              { id: "earth", label: "Earth", steps: [aura("earth", [{ kind: "trait", trait: "strength", delta: n(1) }])] },
              { id: "water", label: "Water", steps: [aura("water")] },
              { id: "air", label: "Air", steps: [aura("air")] },
            ],
          },
        ],
      },
      {
        id: "fire",
        name: "Elemental Aura: Fire",
        activation: { kind: "auto", trigger: { kind: "whenEnemyTakesDamage", range: "close" } },
        requires: [channeling("fire"), inOwnAura],
        steps: [{ kind: "markStress", to: "triggerSubject", amount: n(1) }],
      },
      {
        id: "water",
        name: "Elemental Aura: Water",
        activation: { kind: "reaction", trigger: { kind: "whenYouTakeDamage" } },
        requires: [channeling("water"), inOwnAura, { kind: "situation", text: "The adversary that damaged you is within Close range" }],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "move", to: "triggerSource", mode: "move", range: "veryClose", relativeTo: "triggerSource" }],
      },
      {
        id: "air-self",
        name: "Elemental Aura: Air",
        activation: { kind: "auto", trigger: { kind: "whenYouWouldTakeDamage", from: "beyondMelee" } },
        requires: [channeling("air"), inOwnAura],
        steps: [{ kind: "reduceDamage", to: "self", amount: { kind: "dice", dice: d(1, 8) } }],
      },
      {
        id: "air-ally",
        name: "Elemental Aura: Air (ally)",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "close" } },
        requires: [channeling("air"), inOwnAura, { kind: "situation", text: "The damage is from an attack beyond Melee range" }],
        steps: [{ kind: "reduceDamage", to: "triggerSubject", amount: { kind: "dice", dice: d(1, 8) } }],
      },
    ],
  },

  // Elemental Dominion (Warden of the Elements mastery, CB p.30): "You further embody your element. While Channeling, you
  // gain the following benefit:
  // • Fire: You gain a +1 bonus to your Proficiency for attacks and spells that deal damage.
  // • Earth: When you would mark Hit Points, roll a d6 per Hit Point marked. For each result of 6, reduce the number of
  //   Hit Points you mark by 1.
  // • Water: When an attack against you succeeds, you can mark a Stress to make the attacker temporarily Vulnerable.
  // • Air: You gain a +1 bonus to your Evasion and can fly."
  {
    featureId: "subclass:warden-of-the-elements:elemental-dominion",
    source: "subclass",
    owner: "warden-of-the-elements",
    card: "mastery",
    uses: [
      {
        id: "fire",
        name: "Elemental Dominion: Fire",
        activation: { kind: "passive" },
        requires: [channeling("fire")],
        mods: [{ kind: "stat", stat: "proficiency", delta: n(1) }],
        steps: [],
      },
      {
        id: "earth",
        name: "Elemental Dominion: Earth",
        activation: { kind: "auto", trigger: { kind: "whenYouMarkHp" } },
        requires: [channeling("earth")],
        steps: [
          {
            kind: "adjustHpMarked",
            to: "self",
            change: "fewer",
            // A d6 per Hit Point marked (the trigger's amount); each 6 is one fewer.
            amount: { kind: "dice", dice: { count: { kind: "triggerAmount" }, sides: 6 }, keep: "countAtLeast", atLeast: 6 },
          },
        ],
      },
      {
        id: "water",
        name: "Elemental Dominion: Water",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "succeeded" } },
        requires: [channeling("water")],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "condition", to: "triggerSource", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }],
      },
      {
        id: "air",
        name: "Elemental Dominion: Air",
        activation: { kind: "passive" },
        requires: [channeling("air")],
        // "and can fly": the drawer's Flying toggle (Q16) says when you are flying.
        mods: [{ kind: "stat", stat: "evasion", delta: n(1) }],
        steps: [],
      },
    ],
  },

  // Regeneration (Warden of Renewal foundation, CB p.31): "Touch a creature and spend 3 Hope. That creature clears 1d4 Hit
  // Points." Regenerative Reach (specialization, CB p.31): "You can target creatures within Very Close range with your
  // 'Regeneration' feature."
  {
    featureId: "subclass:warden-of-renewal:regeneration",
    source: "subclass",
    owner: "warden-of-renewal",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Regeneration",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(3) }],
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        steps: [{ kind: "clear", to: "targets", track: "hp", amount: { kind: "dice", dice: d(1, 4) } }],
      },
    ],
    upgrades: [{ when: { kind: "feature", featureId: "subclass:warden-of-renewal:regenerative-reach" }, useId: "main", patch: { range: "veryClose" }, note: "Regenerative Reach" }],
  },

  // Regenerative Reach (Warden of Renewal specialization, CB p.31): "You can target creatures within Very Close range with
  // your 'Regeneration' feature." No effect of its own: it is Regeneration's upgrade (above).
  {
    featureId: "subclass:warden-of-renewal:regenerative-reach",
    source: "subclass",
    owner: "warden-of-renewal",
    card: "specialization",
    uses: [{ id: "main", name: "Regenerative Reach", activation: { kind: "passive" }, mods: [], steps: [] }],
  },

  // Warden's Protection (Warden of Renewal specialization, CB p.31): "Once per long rest, spend 2 Hope to clear 2 Hit
  // Points on 1d4 allies within Close range."
  {
    featureId: "subclass:warden-of-renewal:wardens-protection",
    source: "subclass",
    owner: "warden-of-renewal",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Warden's Protection",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: n(2) }],
        // The 1d4 is rolled when the use resolves; more picked allies than it shows refuses the use (open ruling Q-C).
        targets: { side: "ally", range: "close", count: { kind: "upTo", n: { kind: "dice", dice: d(1, 4) } } },
        steps: [{ kind: "clear", to: "targets", track: "hp", amount: n(2) }],
      },
    ],
  },

  // Defender (Warden of Renewal mastery, CB p.31): "Your animal transformation embodies a healing guardian spirit. When
  // you're in Beastform and an ally within Close range marks 2 or more Hit Points, you can mark a Stress to reduce the
  // number of Hit Points they mark by 1."
  {
    featureId: "subclass:warden-of-renewal:defender",
    source: "subclass",
    owner: "warden-of-renewal",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Defender",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "close" } },
        requires: [
          { kind: "situation", text: "You are in Beastform", check: { kind: "inBeastform" } },
          { kind: "situation", text: "The ally marks 2 or more Hit Points" },
        ],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "adjustHpMarked", to: "triggerSubject", change: "fewer", amount: n(1) }],
      },
    ],
  },

  // ------------------------------------------------------------------ Sorcerer (CB p.46)

  // Volatile Magic (Sorcerer's Hope feature, CB p.46): "Spend 3 Hope to reroll any number of your damage dice on an attack
  // that deals magic damage." After the damage roll, before it is applied (Q1; CB p.107: "you always take the new result").
  {
    featureId: "hope:sorcerer",
    source: "hope",
    owner: "sorcerer",
    uses: [
      {
        id: "main",
        name: "Volatile Magic",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "damage" } },
        requires: [magicDamage],
        costs: [{ kind: "hope", amount: n(3) }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "rerollChosen" } }],
      },
    ],
  },

  // Channel Raw Power (Sorcerer class feature, CB p.46): "Once per long rest, you can place a domain card from your loadout
  // into your vault and choose to either: • Gain Hope equal to the level of the card. • Enhance a spell that deals damage,
  // gaining a bonus to your damage roll equal to twice the level of the card." D5 keeps the once-per-long-rest key
  // (`channelRawPower`); the `card` pick is D5's `hope:<cardId>` or `damage:<cardId>`.
  {
    featureId: "class:sorcerer:channel-raw-power",
    source: "class",
    owner: "sorcerer",
    uses: [
      {
        id: "main",
        name: "Channel Raw Power",
        activation: { kind: "action" },
        steps: [{ kind: "delegate", to: "self", feature: "channelRawPower", params: { choiceFrom: "card" } }],
      },
    ],
  },

  // Elementalist (Elemental Origin foundation, CB p.46): "Choose one of the following elements at character creation: air,
  // earth, fire, lightning, water. You can shape this element into harmless effects. Additionally, spend a Hope and
  // describe how your control over this element helps an action roll you're about to make, then either gain a +2 bonus to
  // the roll or a +3 bonus to the roll's damage."
  {
    featureId: "subclass:elemental-origin:elementalist",
    source: "subclass",
    owner: "elemental-origin",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Elementalist",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [
          {
            kind: "choose",
            id: "bonus",
            label: "+2 to the roll or +3 to its damage",
            timing: "beforeRoll",
            options: [
              { id: "roll", label: "+2 to the roll", steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: n(2) } }] },
              { id: "damage", label: "+3 to the roll's damage", steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: n(3) } }] },
            ],
          },
        ],
      },
    ],
  },

  // Natural Evasion (Elemental Origin specialization, CB p.46): "When an attack roll against you succeeds, you can mark a
  // Stress and describe how you use your element to defend you. When you do, roll a d6 and add its result to your Evasion
  // against the attack."
  {
    featureId: "subclass:elemental-origin:natural-evasion",
    source: "subclass",
    owner: "elemental-origin",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Natural Evasion",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "succeeded" } },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "evasion", amount: { kind: "dice", dice: d(1, 6) } } }],
      },
    ],
  },

  // Transcendence (Elemental Origin mastery, CB p.46): "Once per long rest, you can transform into a physical manifestation
  // of your element. When you do, describe your transformation and choose two of the following benefits to gain until
  // your next rest: • +4 bonus to your Severe threshold • +1 bonus to a character trait of your choice • +1 bonus to your
  // Proficiency • +2 bonus to your Evasion"
  {
    featureId: "subclass:elemental-origin:transcendence",
    source: "subclass",
    owner: "elemental-origin",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Transcendence",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        steps: [
          {
            kind: "choose",
            id: "benefits",
            label: "Choose two benefits",
            count: n(2),
            distinct: true,
            options: [
              { id: "severe", label: "+4 Severe threshold", steps: [{ kind: "effect", to: "self", label: "Transcendence: +4 Severe threshold", mods: [{ kind: "stat", stat: "severeThreshold", delta: n(4) }], duration: "rest" }] },
              // The trait is the player's pick in `trait` (a trait id); Agility is only the default shown before it.
              { id: "trait", label: "+1 to a trait of your choice", steps: [{ kind: "effect", to: "self", label: "Transcendence: +1 trait", mods: [{ kind: "trait", trait: "agility", delta: n(1), choice: "trait" }], duration: "rest" }] },
              { id: "proficiency", label: "+1 Proficiency", steps: [{ kind: "effect", to: "self", label: "Transcendence: +1 Proficiency", mods: [{ kind: "stat", stat: "proficiency", delta: n(1) }], duration: "rest" }] },
              { id: "evasion", label: "+2 Evasion", steps: [{ kind: "effect", to: "self", label: "Transcendence: +2 Evasion", mods: [{ kind: "stat", stat: "evasion", delta: n(2) }], duration: "rest" }] },
            ],
          },
        ],
      },
    ],
  },

  // Manipulate Magic (Primal Origin foundation, CB p.47): "After you cast a spell or make an attack using a weapon that
  // deals magic damage, you can mark a Stress to do one of the following: • Extend the spell or attack's reach by one range
  // • Gain a +2 bonus to the action roll's result • Double a damage die of your choice • Hit an additional target within
  // range"
  {
    featureId: "subclass:primal-origin:manipulate-magic",
    source: "subclass",
    owner: "primal-origin",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Manipulate Magic",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "any" } },
        requires: [{ kind: "situation", text: "You cast a spell, or attacked with a weapon that deals magic damage" }],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [
          {
            kind: "choose",
            id: "option",
            label: "Do one of the following",
            options: [
              // Vocabulary gap: a rider can't extend its host move's range (rangeSteps lives on a TargetSpec only).
              { id: "reach", label: "Extend the reach by one range", steps: [{ kind: "manual", to: "self", text: "Extend the spell or attack's reach by one range." }] },
              { id: "roll", label: "+2 to the action roll's result", steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: n(2) } }] },
              { id: "double", label: "Double a damage die of your choice", steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "doubleDice", which: "chosen", count: 1 } }] },
              {
                id: "target",
                label: "Hit an additional target within range",
                // "within range": the host move's range; `weapon` stands for it (the gap bead covers a spell's range).
                steps: [{ kind: "addTargets", to: "self", count: n(1), targets: { side: "enemy", range: "weapon", count: { kind: "one" } }, damage: "same" }],
              },
            ],
          },
        ],
      },
    ],
  },

  // Enchanted Aid (Primal Origin specialization, CB p.47): "When you Help an Ally with a Spellcast Roll, you can roll a d8
  // as your advantage die. Once per long rest, after an ally has made a Spellcast Roll with your help, you can swap the
  // results of their Duality Dice." Named Help (Q12).
  {
    featureId: "subclass:primal-origin:enchanted-aid",
    source: "subclass",
    owner: "primal-origin",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Enchanted Aid",
        activation: { kind: "rider", trigger: { kind: "whenHelping", roll: "spellcast" } },
        // The d8 is this Help's advantage die, in place of the d6 (CB p.90).
        steps: [{ kind: "help", to: "triggerSubject", die: 8 }],
      },
      {
        id: "swap",
        name: "Enchanted Aid: swap",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls" } },
        requires: [{ kind: "situation", text: "The ally made a Spellcast Roll with your help" }],
        limit: { per: "longRest" },
        steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "swapDuality" } }],
      },
    ],
  },

  // Arcane Charge (Primal Origin mastery, CB p.47): "When you take magic damage, you become Charged. Alternatively, you can
  // spend 2 Hope to become Charged. When you successfully make an attack that deals magic damage while Charged, you can
  // clear your Charge to either gain a +10 bonus to the damage roll or gain a +3 bonus to the Difficulty of a reaction roll
  // the spell causes the target to make. You stop being Charged at your next long rest."
  {
    featureId: "subclass:primal-origin:arcane-charge",
    source: "subclass",
    owner: "primal-origin",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Arcane Charge",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(2) }],
        steps: [{ kind: "condition", to: "self", condition: { kind: "tag", tag: "Charged" }, duration: "longRest" }],
      },
      {
        id: "charged",
        name: "Arcane Charge: Charged",
        activation: { kind: "auto", trigger: { kind: "whenYouTakeDamage", damageType: "magic" } },
        steps: [{ kind: "condition", to: "self", condition: { kind: "tag", tag: "Charged" }, duration: "longRest" }],
      },
      {
        id: "release",
        name: "Arcane Charge: clear your Charge",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        requires: [{ kind: "situation", text: "You are Charged", check: { kind: "hasCondition", condition: { kind: "tag", tag: "Charged" } } }, magicDamage],
        steps: [
          {
            kind: "choose",
            id: "bonus",
            label: "+10 to the damage roll or +3 to the Difficulty of the reaction roll",
            options: [
              { id: "damage", label: "+10 to the damage roll", steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: n(10) } }] },
              {
                id: "difficulty",
                label: "+3 to the Difficulty of a reaction roll the spell causes",
                steps: [{ kind: "effect", to: "targets", label: "Arcane Charge: +3 reaction roll Difficulty", mods: [{ kind: "stat", stat: "reactionDifficulty", delta: n(3) }], duration: "nextRoll" }],
              },
            ],
          },
          { kind: "clearCondition", to: "self", condition: { kind: "tag", tag: "Charged" } },
        ],
      },
    ],
  },
];
