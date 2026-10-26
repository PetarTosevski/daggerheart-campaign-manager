// Card effects of the Sage domain (plan combat-actions, tracer CE-sage). Pure data: no framework imports, relative
// imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (18 of the 21 Sage cards; Gifted Tracker,
// Nature's Tongue and Forager are out of combat). Each entry quotes its card text (CB p.338-339, Domain Card Reference);
// what the vocabulary (src/lib/domain/card-effects/types.ts) cannot express is a `manual` step with the card's words,
// never a vocabulary change. Readings and every manual step: docs/tasks/TASK-CA-CE-sage.md.
//
// Two patterns recur:
// - "Roll once, use for everyone": a `check` whose test always passes rolls the dice once, and later steps read
//   `lastRoll` (Rejuvenation Barrier's 1d4 for you and every ally).
// - "Compare a number": a `check` with zero dice and the number as `plus` tests it against a threshold (Wild Fortress'
//   15/30, the Wild Surge Die exceeding 6).

import type { CardEffect, DiceExpr, NumberSource, Step } from "../../domain/card-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: NumberSource, sides: DiceExpr["sides"], plus?: number): DiceExpr =>
  plus === undefined ? { count, sides } : { count, sides, plus: n(plus) };
const prof: NumberSource = { kind: "proficiency" };

/** A number compared against thresholds: zero dice, the number as the modifier. */
const value = (of: NumberSource): DiceExpr => ({ count: n(0), sides: 6, plus: of });

/** Wild Fortress: the dome marks 1, 2 or 3 HP (tokens) for damage at or above 1 / 15 / 30 (its thresholds 15/30). */
const domeMarks: Step[] = [
  {
    kind: "check",
    dice: value({ kind: "chosen", choice: "damage" }),
    test: { kind: "totalAtLeast", value: 30 },
    then: [{ kind: "tokens", to: "self", op: "add", amount: n(3), max: n(3), note: "Severe: the dome marks 3 Hit Points." }],
    otherwise: [
      {
        kind: "check",
        dice: value({ kind: "chosen", choice: "damage" }),
        test: { kind: "totalAtLeast", value: 15 },
        then: [{ kind: "tokens", to: "self", op: "add", amount: n(2), max: n(3), note: "Major: the dome marks 2 Hit Points." }],
        otherwise: [
          {
            kind: "check",
            dice: value({ kind: "chosen", choice: "damage" }),
            test: { kind: "totalAtLeast", value: 1 },
            then: [{ kind: "tokens", to: "self", op: "add", amount: n(1), max: n(3), note: "Minor: the dome marks 1 Hit Point." }],
            otherwise: [],
          },
        ],
      },
    ],
  },
  {
    kind: "check",
    dice: value({ kind: "cardTokens" }),
    test: { kind: "totalAtLeast", value: 3 },
    then: [
      { kind: "tokens", to: "self", op: "clear" },
      { kind: "manual", to: "self", text: "The dome has marked 3 Hit Points and falls: end Wild Fortress for everyone inside." },
    ],
    otherwise: [],
  },
];

export const SAGE_EFFECTS: readonly CardEffect[] = [
  // Vicious Entangle (L1, CB p.338): "Make a Spellcast Roll against a target within Far range. On a success, roots and
  // vines reach out from the ground, dealing 1d8+1 physical damage and temporarily Restraining the target. Additionally
  // on a success, you can spend a Hope to temporarily Restrain another adversary within Very Close range of your target."
  {
    cardId: "vicious-entangle",
    uses: [
      {
        id: "main",
        name: "Vicious Entangle",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(n(1), 8, 1) }, type: "physical" },
          { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "restrained" }, duration: "temporary" },
          {
            kind: "optional",
            id: "second",
            label: "Spend a Hope to Restrain another adversary within Very Close range of your target",
            when: ["hit"],
            costs: [{ kind: "hope", amount: n(1) }],
            steps: [
              {
                kind: "condition",
                to: "picked",
                pick: { side: "enemy", range: "far", count: { kind: "one" }, area: "aroundTarget", areaRange: "veryClose" },
                condition: { kind: "standard", condition: "restrained" },
                duration: "temporary",
              },
            ],
          },
        ],
      },
    ],
  },

  // Conjure Swarm (L2, CB p.338): "Tekaira Armored Beetles: Mark a Stress to conjure armored beetles that encircle you.
  // When you next take damage, reduce the severity by one threshold. You can spend a Hope to keep the beetles conjured
  // after taking damage.
  // Fire Flies: Make a Spellcast Roll against all adversaries within Close range. Spend a Hope to deal 2d8+3 magic damage
  // to targets you succeeded against."
  {
    cardId: "conjure-swarm",
    uses: [
      {
        id: "beetles",
        name: "Tekaira Armored Beetles",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        exclusive: true,
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Tekaira Armored Beetles",
            mods: [],
            duration: "manual",
            endsWhen: "you take damage and don't spend a Hope to keep the beetles",
          },
        ],
      },
      {
        id: "beetles-damage",
        name: "Tekaira Armored Beetles: you take damage",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        requires: [{ kind: "effectActive", cardId: "conjure-swarm" }],
        steps: [
          { kind: "reduceSeverity", to: "self", steps: 1 },
          {
            kind: "optional",
            id: "keep",
            label: "Spend a Hope to keep the beetles conjured",
            costs: [{ kind: "hope", amount: n(1) }],
            steps: [{ kind: "manual", to: "self", text: "The beetles stay conjured: keep Tekaira Armored Beetles active." }],
          },
          {
            kind: "manual",
            to: "self",
            text: "Unless you spent a Hope to keep them, the beetles disperse: end Tekaira Armored Beetles.",
          },
        ],
      },
      {
        id: "fire-flies",
        name: "Fire Flies",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "all" } },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: n(1) }] },
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(n(2), 8, 3) }, type: "magic" },
        ],
      },
    ],
  },

  // Natural Familiar (L2, CB p.338): "Spend a Hope to summon a small nature spirit or forest critter to your side until
  // your next rest, you cast Natural Familiar again, or the familiar is targeted by an attack. If you spend an additional
  // Hope, you can summon a familiar that flies. You can communicate with them, make a Spellcast Roll to command them to
  // perform simple tasks, and mark a Stress to see through their eyes.
  // When you deal damage to an adversary within Melee range of your familiar, you add a d6 to your damage roll."
  {
    cardId: "natural-familiar",
    uses: [
      {
        id: "main",
        name: "Natural Familiar",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        exclusive: true,
        steps: [
          { kind: "effect", to: "self", label: "Natural Familiar", mods: [], duration: "rest", endsWhen: "the familiar is targeted by an attack" },
          {
            kind: "optional",
            id: "flies",
            label: "Spend an additional Hope for a familiar that flies",
            costs: [{ kind: "hope", amount: n(1) }],
            steps: [{ kind: "manual", to: "self", text: "Your familiar can fly." }],
          },
          { kind: "manual", to: "self", text: "A small nature spirit or forest critter appears at your side; you can communicate with it." },
        ],
      },
      {
        id: "command",
        name: "Natural Familiar: command",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "natural-familiar" }],
        roll: { kind: "spellcast", difficulty: { kind: "gm" } },
        steps: [{ kind: "manual", to: "self", when: ["success"], text: "Your familiar performs the simple task you commanded." }],
      },
      {
        id: "see",
        name: "Natural Familiar: see through their eyes",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "natural-familiar" }],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "manual", to: "self", text: "You see through your familiar's eyes." }],
      },
      {
        id: "damage",
        name: "Natural Familiar: +d6 damage",
        activation: { kind: "rider", trigger: { kind: "whenYouDealDamage", toEnemy: true } },
        requires: [
          { kind: "effectActive", cardId: "natural-familiar" },
          { kind: "situation", text: "The adversary is within Melee range of your familiar" },
        ],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: dice(n(1), 6) } } }],
      },
    ],
  },

  // Corrosive Projectile (L3, CB p.338): "Make a Spellcast Roll against a target within Far range. On a success, deal
  // d6+4 magic damage using your Proficiency. Additionally, mark 2 or more Stress to make them permanently Corroded. While
  // a target is Corroded, they gain a -1 penalty to their Difficulty for every 2 Stress you spent. This condition can
  // stack."
  {
    cardId: "corrosive-projectile",
    uses: [
      {
        id: "main",
        name: "Corrosive Projectile",
        activation: { kind: "action" },
        choices: [{ id: "stress", label: "Stress to mark for Corroded (2 or more)", min: 2 }],
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(prof, 6, 4) }, type: "magic" },
          {
            kind: "optional",
            id: "corrode",
            label: "Mark 2 or more Stress to make them permanently Corroded",
            when: ["hit"],
            costs: [{ kind: "stress", amount: { kind: "chosen", choice: "stress" } }],
            steps: [
              { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Corroded" }, duration: "permanent" },
              {
                kind: "effect",
                to: "targets",
                label: "Corroded",
                mods: [
                  {
                    kind: "stat",
                    stat: "difficulty",
                    delta: { kind: "calc", of: { kind: "calc", of: { kind: "spent", resource: "stress" }, divide: 2, round: "down" }, times: -1 },
                  },
                ],
                duration: "permanent",
                note: "-1 Difficulty for every 2 Stress spent; stacks with earlier casts.",
              },
            ],
          },
        ],
      },
    ],
  },

  // Towering Stalk (L3, CB p.338): "Once per rest, you can conjure a thick, twisting stalk within Close range that can be
  // easily climbed. Its height can grow up to Far range.
  // Mark a Stress to use this spell as an attack. Make a Spellcast Roll against an adversary or group of adversaries
  // within Close range. The erupting stalk lifts targets you succeed against into the air and drops them, dealing d8
  // physical damage using your Proficiency."
  {
    cardId: "towering-stalk",
    uses: [
      {
        id: "stalk",
        name: "Towering Stalk: conjure the stalk",
        activation: { kind: "action" },
        limit: { per: "rest" },
        targets: { side: "point", range: "close", count: { kind: "one" } },
        steps: [
          { kind: "manual", to: "self", text: "A thick, twisting stalk that can be easily climbed rises at the chosen point; its height can grow up to Far range." },
        ],
      },
      {
        id: "attack",
        name: "Towering Stalk: attack",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "any" } },
        steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(prof, 8) }, type: "physical" }],
      },
    ],
  },

  // Death Grip (L4, CB p.338): "Make a Spellcast Roll against a target within Close range and choose one of the following
  // options:
  // • You pull the target into Melee range or pull yourself into Melee range of them.
  // • You constrict the target and force them to mark 2 Stress.
  // • All adversaries between you and the target must succeed on a Reaction Roll (13) or be hit by vines, taking 3d6+2
  //   physical damage.
  // On a success, vines reach out from your hands, causing the chosen effect and temporarily Restraining the target."
  {
    cardId: "death-grip",
    uses: [
      {
        id: "main",
        name: "Death Grip",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [
          {
            kind: "choose",
            id: "grip",
            label: "Choose the Death Grip effect",
            timing: "beforeRoll",
            options: [
              {
                id: "pull",
                label: "Pull the target into Melee range, or yourself into Melee range of them",
                steps: [
                  {
                    kind: "move",
                    to: "targets",
                    when: ["hit"],
                    mode: "pull",
                    range: "melee",
                    relativeTo: "self",
                    note: "Pull the target into Melee range, or pull yourself into Melee range of them",
                  },
                ],
              },
              {
                id: "constrict",
                label: "Constrict the target: they mark 2 Stress",
                steps: [{ kind: "markStress", to: "targets", when: ["hit"], amount: n(2) }],
              },
              {
                id: "vines",
                label: "Vines: all adversaries between you and the target make a Reaction Roll (13)",
                steps: [
                  {
                    kind: "save",
                    to: "picked",
                    when: ["hit"],
                    pick: { side: "enemy", range: "close", count: { kind: "all" }, area: "between" },
                    difficulty: { kind: "fixed", value: 13 },
                    onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(n(3), 6, 2) }, type: "physical" }],
                    onSuccess: [],
                  },
                ],
              },
            ],
          },
          { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "restrained" }, duration: "temporary" },
        ],
      },
    ],
  },

  // Healing Field (L4, CB p.338): "Once per long rest, you can conjure a field of healing plants around you. Everywhere
  // within Close range of you bursts to life with vibrant nature, allowing you and all allies in the area to clear a Hit
  // Point.
  // Spend 2 Hope to allow you and all allies to clear 2 Hit Points instead."
  {
    cardId: "healing-field",
    uses: [
      {
        id: "main",
        name: "Healing Field",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        steps: [
          {
            kind: "optional",
            id: "two",
            label: "Spend 2 Hope: everyone clears 2 Hit Points instead",
            timing: "beforeRoll",
            costs: [{ kind: "hope", amount: n(2) }],
            steps: [],
          },
          {
            kind: "clear",
            to: "selfAndAllies",
            pick: { side: "ally", range: "close", count: { kind: "all" }, area: "aroundSelf" },
            track: "hp",
            // 1, or 2 when the 2 Hope were spent.
            amount: { kind: "calc", of: { kind: "spent", resource: "hope" }, divide: 2, round: "down", plus: 1 },
          },
        ],
      },
    ],
  },

  // Thorn Skin (L5, CB p.338): "Once per rest, spend a Hope to sprout thorns all over your body. When you do, place a
  // number of tokens equal to your Spellcast trait on this card. When you take damage, you can spend any number of tokens
  // to roll that number of d6s. Add the results together and reduce the incoming damage by that amount. If you're within
  // Melee range of the attacker, deal that amount of damage back to them.
  // When you take a rest, clear all unspent tokens."
  {
    cardId: "thorn-skin",
    uses: [
      {
        id: "main",
        name: "Thorn Skin",
        activation: { kind: "action" },
        limit: { per: "rest" },
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [
          { kind: "tokens", to: "self", op: "set", amount: { kind: "spellcast" } },
          { kind: "effect", to: "self", label: "Thorn Skin", mods: [], duration: "rest" },
        ],
      },
      {
        id: "thorns",
        name: "Thorn Skin: reduce the damage",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        requires: [{ kind: "effectActive", cardId: "thorn-skin" }],
        targets: { side: "trigger", who: "source" },
        choices: [{ id: "tokens", label: "Tokens to spend (one d6 each)", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        steps: [
          { kind: "reduceDamage", to: "self", amount: { kind: "dice", dice: dice({ kind: "spent", resource: "tokens" }, 6) } },
          {
            kind: "damage",
            to: "triggerSource",
            when: [{ kind: "requires", requirement: { kind: "situation", text: "You're within Melee range of the attacker" } }],
            roll: { kind: "flat", amount: { kind: "lastRoll" } },
            type: "physical",
            note: "Deal that amount of damage back to the attacker.",
          },
        ],
      },
      {
        id: "rest",
        name: "Thorn Skin: clear tokens on a rest",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterRest" } },
        steps: [{ kind: "tokens", to: "self", op: "clear" }],
      },
    ],
  },

  // Wild Fortress (L5, CB p.339): "Make a Spellcast Roll (13). On a success, spend 2 Hope to grow a natural barricade in
  // the shape of a dome that you and one ally can take cover within. While inside the dome, a creature can't be targeted
  // by attacks and can't make attacks. Attacks made against the dome automatically succeed. The dome has the following
  // damage thresholds and lasts until it marks 3 Hit Points. Place tokens on this card to represent marking Hit Points.
  // Thresholds: 15/30"
  {
    cardId: "wild-fortress",
    uses: [
      {
        id: "main",
        name: "Wild Fortress",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 } },
        targets: { side: "ally", range: "veryClose", count: { kind: "upTo", n: n(1) }, excludeSelf: true },
        exclusive: true,
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: n(2) }] },
          { kind: "tokens", to: "self", when: ["success"], op: "set", amount: n(0), note: "The dome starts with no Hit Points marked." },
          {
            kind: "effect",
            to: "self",
            when: ["success"],
            label: "Inside Wild Fortress",
            mods: [
              { kind: "flag", flag: "cannotBeTargeted" },
              { kind: "flag", flag: "cannotAttack" },
            ],
            duration: "manual",
            endsWhen: "the dome marks 3 Hit Points or you leave it",
          },
          {
            kind: "effect",
            to: "targets",
            when: ["success"],
            label: "Inside Wild Fortress",
            mods: [
              { kind: "flag", flag: "cannotBeTargeted" },
              { kind: "flag", flag: "cannotAttack" },
            ],
            duration: "manual",
            endsWhen: "the dome marks 3 Hit Points or they leave it",
          },
        ],
      },
      {
        id: "dome-damage",
        name: "Wild Fortress: the dome takes damage",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "wild-fortress" }],
        choices: [{ id: "damage", label: "Damage dealt to the dome (attacks against it automatically succeed)", min: 0 }],
        steps: domeMarks,
      },
    ],
  },

  // Conjured Steeds (L6, CB p.339): "Spend any number of Hope to conjure that many magical steeds (such as horses, camels,
  // or elephants) that you and your allies can ride until your next long rest or the steeds take any damage. The steeds
  // double your land speed while traveling and, when in danger, allow you to move within Far range without having to
  // roll. Creatures riding a steed gain a -2 penalty to attack rolls and a +2 bonus to damage rolls."
  // Targets are the riders (you and your allies), one per steed.
  {
    cardId: "conjured-steeds",
    uses: [
      {
        id: "main",
        name: "Conjured Steeds",
        activation: { kind: "action" },
        choices: [{ id: "hope", label: "Hope to spend (one steed each)", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        targets: { side: "selfOrAlly", range: "close", count: { kind: "any", max: { kind: "chosen", choice: "hope" } } },
        steps: [
          {
            kind: "effect",
            to: "targets",
            label: "Riding a conjured steed",
            mods: [
              { kind: "stat", stat: "attack", delta: n(-2) },
              { kind: "stat", stat: "damage", delta: n(2) },
            ],
            duration: "longRest",
            endsWhen: "the steed takes any damage",
          },
          {
            kind: "manual",
            to: "targets",
            text: "The steeds double your land speed while traveling and, when in danger, let you move within Far range without having to roll.",
          },
        ],
      },
    ],
  },

  // Sage-Touched (L7, CB p.339): "When 4 or more of the domain cards in your loadout are from the Sage domain, gain the
  // following benefits:
  // • While you're in a natural environment, you gain a +2 bonus to your Spellcast Rolls.
  // • Once per rest, you can double your Agility or Instinct when making a roll that uses that trait. You must choose to
  //   do this before you roll."
  {
    cardId: "sage-touched",
    uses: [
      {
        id: "nature",
        name: "Sage-Touched: +2 Spellcast in nature",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "spellcast" } },
        requires: [
          { kind: "loadoutDomainCount", domain: "sage", min: 4 },
          { kind: "situation", text: "You're in a natural environment" },
        ],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: n(2) } }],
      },
      {
        id: "double",
        name: "Sage-Touched: double Agility or Instinct",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "any" } },
        requires: [{ kind: "loadoutDomainCount", domain: "sage", min: 4 }],
        limit: { per: "rest" },
        steps: [
          {
            kind: "choose",
            id: "trait",
            label: "Double which trait (the roll must use it)?",
            timing: "beforeRoll",
            options: [
              { id: "agility", label: "Agility", steps: [{ kind: "modifyRoll", to: "self", change: { kind: "doubleTrait", trait: "agility" } }] },
              { id: "instinct", label: "Instinct", steps: [{ kind: "modifyRoll", to: "self", change: { kind: "doubleTrait", trait: "instinct" } }] },
            ],
          },
        ],
      },
    ],
  },

  // Wild Surge (L7, CB p.339): "Once per long rest, mark a Stress to channel the natural world around you and enhance
  // yourself. Describe how your appearance changes, then place a d6 on this card with the 1 value facing up.
  // While the Wild Surge Die is active, you add its value to every action roll you make. After you add its value to a
  // roll, increase the Wild Surge Die's value by one. When the die's value would exceed 6 or you take a rest, this form
  // drops and you must mark an additional Stress."
  // The die's face is the card's token count (die 6).
  {
    cardId: "wild-surge",
    uses: [
      {
        id: "main",
        name: "Wild Surge",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [
          { kind: "tokens", to: "self", op: "set", amount: n(1), die: 6, note: "The Wild Surge Die starts at 1." },
          { kind: "effect", to: "self", label: "Wild Surge", mods: [], duration: "manual", endsWhen: "the Wild Surge Die would exceed 6, or you take a rest" },
          { kind: "manual", to: "self", text: "Describe how your appearance changes." },
        ],
      },
      {
        id: "surge",
        name: "Wild Surge: add the die",
        activation: { kind: "auto", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [{ kind: "effectActive", cardId: "wild-surge" }],
        steps: [
          { kind: "modifyRoll", to: "self", change: { kind: "add", amount: { kind: "cardTokens" } } },
          { kind: "tokens", to: "self", op: "add", amount: n(1), die: 6, note: "The Wild Surge Die's value goes up by one." },
          {
            kind: "check",
            dice: value({ kind: "cardTokens" }),
            test: { kind: "totalAtLeast", value: 7 },
            then: [
              { kind: "tokens", to: "self", op: "clear", die: 6 },
              { kind: "markStress", to: "self", amount: n(1), note: "The form drops: mark an additional Stress." },
              { kind: "manual", to: "self", text: "The Wild Surge Die would exceed 6: the form drops (end Wild Surge)." },
            ],
            otherwise: [],
          },
        ],
      },
      {
        id: "rest",
        name: "Wild Surge: the form drops on a rest",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterRest" } },
        requires: [{ kind: "effectActive", cardId: "wild-surge" }],
        steps: [
          { kind: "tokens", to: "self", op: "clear", die: 6 },
          { kind: "markStress", to: "self", amount: n(1), note: "The form drops: mark an additional Stress." },
          { kind: "manual", to: "self", text: "You take a rest: the form drops (end Wild Surge)." },
        ],
      },
    ],
  },

  // Forest Sprites (L8, CB p.339): "Make a Spellcast Roll (13). On a success, spend any number of Hope to create an equal
  // number of small forest sprites who appear at points you choose within Far range, providing the following benefits:
  // • Your allies gain a +3 bonus to attack rolls against adversaries within Melee range of a sprite.
  // • An ally who marks an Armor Slot while within Melee range of a sprite can mark an additional Armor Slot.
  // A sprite vanishes after granting a benefit or taking any damage."
  // The sprites are the card's tokens.
  {
    cardId: "forest-sprites",
    uses: [
      {
        id: "main",
        name: "Forest Sprites",
        activation: { kind: "action" },
        choices: [{ id: "hope", label: "Hope to spend (one sprite each)", min: 1 }],
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 } },
        targets: { side: "point", range: "far", count: { kind: "any", max: { kind: "chosen", choice: "hope" } } },
        exclusive: true,
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }] },
          { kind: "tokens", to: "self", when: ["success"], op: "set", amount: { kind: "spent", resource: "hope" }, note: "One token per sprite." },
          { kind: "effect", to: "self", when: ["success"], label: "Forest Sprites", mods: [], duration: "manual", endsWhen: "every sprite has vanished" },
          { kind: "manual", to: "self", when: ["success"], text: "Place the sprites at the points you chose within Far range." },
        ],
      },
      {
        id: "attack",
        name: "Forest Sprites: +3 to an ally's attack",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", range: "veryFar", result: "any" } },
        requires: [
          { kind: "effectActive", cardId: "forest-sprites" },
          { kind: "situation", text: "The ally's attack roll is against an adversary within Melee range of a sprite" },
        ],
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "modifyRoll", to: "triggerSubject", change: { kind: "add", amount: n(3) } },
          { kind: "tokens", to: "self", op: "spend", amount: n(1), note: "The sprite vanishes after granting the benefit." },
        ],
      },
      {
        id: "armor",
        name: "Forest Sprites: an extra Armor Slot",
        activation: { kind: "reaction", trigger: { kind: "whenArmorSlotMarked", who: "ally" } },
        requires: [
          { kind: "effectActive", cardId: "forest-sprites" },
          { kind: "situation", text: "The ally is within Melee range of a sprite" },
        ],
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "extraArmorSlots", to: "triggerSubject", max: n(1) },
          { kind: "tokens", to: "self", op: "spend", amount: n(1), note: "The sprite vanishes after granting the benefit." },
        ],
      },
      {
        id: "sprite-damaged",
        name: "Forest Sprites: a sprite takes damage",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "forest-sprites" }],
        steps: [{ kind: "tokens", to: "self", op: "spend", amount: n(1), note: "A sprite that takes any damage vanishes." }],
      },
    ],
  },

  // Rejuvenation Barrier (L8, CB p.339): "Make a Spellcast Roll (15). Once per rest on a success, create a temporary
  // barrier of protective energy around you at Very Close range. You and all allies within the barrier when this spell is
  // cast clear 1d4 Hit Points. While the barrier is up, you and all allies within have resistance to physical damage from
  // outside the barrier.
  // When you move, the barrier follows you."
  {
    cardId: "rejuvenation-barrier",
    uses: [
      {
        id: "main",
        name: "Rejuvenation Barrier",
        activation: { kind: "action" },
        limit: { per: "rest", consumedOn: "success" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 15 } },
        steps: [
          {
            kind: "check",
            when: ["success"],
            dice: dice(n(1), 4),
            test: { kind: "totalAtLeast", value: 1 },
            note: "The 1d4 is rolled once for everyone in the barrier.",
            then: [
              {
                kind: "clear",
                to: "selfAndAllies",
                pick: { side: "ally", range: "veryClose", count: { kind: "all" }, area: "aroundSelf" },
                track: "hp",
                amount: { kind: "lastRoll" },
              },
            ],
            otherwise: [],
          },
          {
            kind: "effect",
            to: "selfAndAllies",
            when: ["success"],
            pick: { side: "ally", range: "veryClose", count: { kind: "all" }, area: "aroundSelf" },
            label: "Rejuvenation Barrier",
            mods: [{ kind: "resistance", type: "physical", level: "resistant" }],
            duration: "temporary",
            endsWhen: "the barrier goes down",
          },
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "The resistance only covers physical damage from outside the barrier, and only while within it. When you move, the barrier follows you.",
          },
        ],
      },
    ],
  },

  // Fane of the Wilds (L9, CB p.339): "After a long rest, place a number of tokens equal to the number of Sage domain
  // cards in your loadout and vault on this card.
  // When you would make a Spellcast Roll, you can spend any number of tokens after the roll to gain a +1 bonus for each
  // token spent.
  // When you critically succeed on a Spellcast Roll for a Sage domain spell, gain a token.
  // When you take a long rest, clear all unspent tokens."
  {
    cardId: "fane-of-the-wilds",
    uses: [
      {
        id: "spend",
        name: "Fane of the Wilds: spend tokens",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "spellcast", result: "any" } },
        choices: [{ id: "tokens", label: "Tokens to spend (+1 each)", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: { kind: "spent", resource: "tokens" } } }],
      },
      {
        id: "long-rest",
        name: "Fane of the Wilds: tokens after a long rest",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } },
        // Setting the count also clears the unspent tokens of the long rest.
        steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "domainCards", domain: "sage", includeVault: true } }],
      },
      {
        id: "critical",
        name: "Fane of the Wilds: a token on a critical",
        activation: { kind: "auto", trigger: { kind: "afterYouRoll", roll: "spellcast", result: "critical" } },
        requires: [{ kind: "situation", text: "The Spellcast Roll was for a Sage domain spell" }],
        steps: [{ kind: "tokens", to: "self", op: "add", amount: n(1) }],
      },
    ],
  },

  // Plant Dominion (L9, CB p.339): "Make a Spellcast Roll (18). Once per long rest on a success, you reshape the natural
  // world, changing the surrounding plant life anywhere within Far range of you. For example, you can grow trees
  // instantly, clear a path through dense vines, or create a wall of roots."
  {
    cardId: "plant-dominion",
    uses: [
      {
        id: "main",
        name: "Plant Dominion",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 18 } },
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "Reshape the plant life anywhere within Far range of you: grow trees instantly, clear a path through dense vines, create a wall of roots, and so on.",
          },
        ],
      },
    ],
  },

  // Force of Nature (L10, CB p.339): "Mark a Stress to transform into a hulking nature spirit, gaining the following
  // benefits:
  // • When you succeed on an attack or Spellcast Roll, gain a +10 bonus to the damage roll.
  // • When you deal enough damage to defeat a creature within Close range, you absorb them and clear an Armor Slot.
  // • You can't be Restrained.
  // Before you make an action roll, you must spend a Hope. If you can't, you revert to your normal form."
  {
    cardId: "force-of-nature",
    uses: [
      {
        id: "main",
        name: "Force of Nature",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Force of Nature",
            mods: [{ kind: "flag", flag: "cannotBeRestrained" }],
            duration: "manual",
            endsWhen: "you can't spend a Hope before an action roll",
          },
          { kind: "clearCondition", to: "self", condition: { kind: "standard", condition: "restrained" }, note: "You can't be Restrained." },
        ],
      },
      {
        id: "damage",
        name: "Force of Nature: +10 damage",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
        requires: [{ kind: "effectActive", cardId: "force-of-nature" }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: n(10) } }],
      },
      {
        id: "absorb",
        name: "Force of Nature: absorb",
        activation: { kind: "auto", trigger: { kind: "whenEnemyDefeated", byYou: true, range: "close" } },
        requires: [{ kind: "effectActive", cardId: "force-of-nature" }],
        steps: [
          { kind: "clear", to: "self", track: "armor", amount: n(1) },
          { kind: "manual", to: "self", text: "You absorb the defeated creature." },
        ],
      },
      {
        id: "upkeep",
        name: "Force of Nature: a Hope before each action roll",
        activation: { kind: "auto", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [{ kind: "effectActive", cardId: "force-of-nature" }],
        steps: [
          {
            kind: "manual",
            to: "self",
            when: [{ kind: "requires", requirement: { kind: "hopeAtMost", value: 0 } }],
            text: "You can't spend a Hope: you revert to your normal form (end Force of Nature).",
          },
          { kind: "pay", costs: [{ kind: "hope", amount: n(1) }] },
        ],
      },
    ],
  },

  // Tempest (L10, CB p.339): "Choose one of the following tempests and make a Spellcast Roll against all targets within
  // Far range. Targets you succeed against experience its effects until the GM spends a Fear on their turn to end this
  // spell.
  // • Blizzard: Deal 2d20+8 magic damage and targets are temporarily Vulnerable.
  // • Hurricane: Deal 3d10+10 magic damage and choose a direction the wind is blowing. Targets can't move against the wind.
  // • Sandstorm: Deal 5d6+9 magic damage. Attacks made from beyond Melee range have disadvantage."
  {
    cardId: "tempest",
    uses: [
      {
        id: "main",
        name: "Tempest",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "all" } },
        steps: [
          {
            kind: "choose",
            id: "tempest",
            label: "Choose the tempest",
            timing: "beforeRoll",
            options: [
              {
                id: "blizzard",
                label: "Blizzard: 2d20+8 magic, temporarily Vulnerable",
                steps: [
                  { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(n(2), 20, 8) }, type: "magic" },
                  { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" },
                ],
              },
              {
                id: "hurricane",
                label: "Hurricane: 3d10+10 magic, targets can't move against the wind",
                steps: [
                  { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(n(3), 10, 10) }, type: "magic" },
                  {
                    kind: "condition",
                    to: "targets",
                    when: ["hit"],
                    condition: { kind: "tag", tag: "Hurricane" },
                    duration: "manual",
                    endsWhen: "the GM spends a Fear on their turn to end the spell",
                  },
                  { kind: "manual", to: "self", when: ["hit"], text: "Choose the direction the wind is blowing: affected targets can't move against the wind." },
                ],
              },
              {
                id: "sandstorm",
                label: "Sandstorm: 5d6+9 magic, attacks from beyond Melee range have disadvantage",
                steps: [
                  { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(n(5), 6, 9) }, type: "magic" },
                  {
                    kind: "condition",
                    to: "targets",
                    when: ["hit"],
                    condition: { kind: "tag", tag: "Sandstorm" },
                    duration: "manual",
                    endsWhen: "the GM spends a Fear on their turn to end the spell",
                  },
                  {
                    kind: "manual",
                    to: "self",
                    when: ["hit"],
                    text: "While the Sandstorm lasts, attacks made from beyond Melee range by the affected targets have disadvantage.",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
