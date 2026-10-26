// Card effects of the Bone domain (plan combat-actions, tracer CE-bone; CA0 shipped it empty).
// Pure data: no framework imports, relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (20 cards; Recovery is out of combat). Each
// entry quotes its card text (CB p.331-332, printed pages); what the vocabulary (src/lib/domain/card-effects/types.ts)
// cannot express is a `manual` step, never a vocabulary change. Readings and manual steps: docs/tasks/TASK-CA-CE-bone.md.

import type { CardEffect, NumberSource, Requirement } from "../../domain/card-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: number, sides: 4 | 6 | 8 | 10 | 12 | 20): NumberSource => ({ kind: "dice", dice: { count: fixed(count), sides } });
const situation = (text: string): Requirement => ({ kind: "situation", text });
const boneTouched: Requirement = { kind: "loadoutDomainCount", domain: "bone", min: 4 };
const BREAKING_BLOW = { kind: "tag", tag: "Breaking Blow" } as const;

export const BONE_EFFECTS: readonly CardEffect[] = [
  // Deft Maneuvers (Bone 1, CB p.331): "Once per rest, mark a Stress to sprint anywhere within Far range without making
  // an Agility Roll to get there. If you end this movement within Melee range of an adversary and immediately make an
  // attack against them, gain a +1 bonus to the attack roll."
  {
    cardId: "deft-maneuvers",
    uses: [
      {
        id: "main",
        name: "Deft Maneuvers",
        activation: { kind: "action" },
        limit: { per: "rest" },
        costs: [{ kind: "stress", amount: fixed(1) }],
        steps: [
          { kind: "move", to: "self", mode: "move", range: "far", note: "Sprint anywhere within Far range (no Agility Roll)" },
          {
            kind: "effect",
            to: "self",
            label: "Deft Maneuvers: +1 to the attack",
            mods: [{ kind: "stat", stat: "attack", delta: fixed(1) }],
            duration: "nextRoll",
            endsWhen: "Only for an attack made right after the sprint against an adversary within Melee range",
          },
        ],
      },
    ],
  },

  // I See It Coming (Bone 1, CB p.331): "When you're targeted by an attack made from beyond Melee range, you can mark a
  // Stress to roll a d4 and gain a bonus to your Evasion equal to the result against the attack."
  {
    cardId: "i-see-it-coming",
    uses: [
      {
        id: "main",
        name: "I See It Coming",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "targeted", from: "beyondMelee" } },
        costs: [{ kind: "stress", amount: fixed(1) }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "evasion", amount: dice(1, 4) }, note: "+d4 Evasion against this attack" }],
      },
    ],
  },

  // Untouchable (Bone 1, CB p.331): "Gain a bonus to your Evasion equal to half your Agility." Half rounds up (CB p.107).
  {
    cardId: "untouchable",
    uses: [
      {
        id: "main",
        name: "Untouchable",
        activation: { kind: "passive" },
        mods: [{ kind: "stat", stat: "evasion", delta: { kind: "calc", of: { kind: "trait", trait: "agility" }, divide: 2 } }],
        steps: [],
      },
    ],
  },

  // Ferocity (Bone 2, CB p.331): "When you cause an adversary to mark 1 or more Hit Points, you can spend 2 Hope to
  // increase your Evasion by the number of Hit Points they marked. This bonus lasts until after the next attack made
  // against you." The trigger's amount is the HP the adversary marked.
  {
    cardId: "ferocity",
    uses: [
      {
        id: "main",
        name: "Ferocity",
        activation: { kind: "reaction", trigger: { kind: "whenTargetMarksHp" } },
        costs: [{ kind: "hope", amount: fixed(2) }],
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Ferocity",
            mods: [{ kind: "stat", stat: "evasion", delta: { kind: "triggerAmount" } }],
            duration: "hit",
            endsWhen: "After the next attack made against you",
          },
        ],
      },
    ],
  },

  // Strategic Approach (Bone 2, CB p.331): "After a long rest, place a number of tokens equal to your Knowledge on this
  // card (minimum 1). The first time you move within Close range of an adversary and make an attack against them, you
  // can spend one token to choose one of the following options: • You make the attack with advantage. • You clear a
  // Stress on an ally within Melee range of the adversary. • You add a d8 to your damage roll. When you take a long rest,
  // clear all unspent tokens." Setting the tokens after a long rest also clears the unspent ones.
  {
    cardId: "strategic-approach",
    uses: [
      {
        id: "main",
        name: "Strategic Approach",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
        requires: [situation("This is the first time you moved within Close range of this adversary and attack them")],
        costs: [{ kind: "tokens", amount: fixed(1) }],
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [
          {
            kind: "choose",
            id: "approach",
            label: "Choose one option",
            timing: "beforeRoll",
            options: [
              { id: "advantage", label: "Make the attack with advantage", steps: [{ kind: "modifyRoll", to: "self", change: { kind: "advantage" } }] },
              {
                id: "stress",
                label: "Clear a Stress on an ally within Melee range of the adversary",
                steps: [
                  {
                    kind: "clear",
                    to: "picked",
                    pick: { side: "ally", range: "unlimited", count: { kind: "one" }, area: "aroundTarget", areaRange: "melee" },
                    track: "stress",
                    amount: fixed(1),
                  },
                ],
              },
              { id: "d8", label: "Add a d8 to the damage roll", steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: dice(1, 8) } }] },
            ],
          },
        ],
      },
      {
        id: "tokens",
        name: "Strategic Approach (tokens)",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } },
        steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "calc", of: { kind: "trait", trait: "knowledge" }, min: 1 } }],
      },
    ],
  },

  // Brace (Bone 3, CB p.331): "When you mark an Armor Slot to reduce incoming damage, you can mark a Stress to mark an
  // additional Armor Slot."
  {
    cardId: "brace",
    uses: [
      {
        id: "main",
        name: "Brace",
        activation: { kind: "reaction", trigger: { kind: "whenArmorSlotMarked", who: "self" } },
        costs: [{ kind: "stress", amount: fixed(1) }],
        steps: [{ kind: "extraArmorSlots", to: "self", max: fixed(1) }],
      },
    ],
  },

  // Tactician (Bone 3, CB p.331): "When you Help an Ally, they can spend a Hope to add one of your Experiences to their
  // roll alongside your advantage die. When making a Tag Team Roll, you can roll a d20 as your Hope Die."
  {
    cardId: "tactician",
    uses: [
      {
        id: "help",
        name: "Tactician (Help an Ally)",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", result: "any" } },
        requires: [situation("You helped this ally's roll (Help an Ally) and they agree to spend a Hope")],
        choices: [{ id: "experience", label: "The modifier of the Experience you add", min: 1 }],
        steps: [
          { kind: "hope", to: "triggerSubject", change: "lose", amount: fixed(1), note: "The helped ally spends a Hope" },
          { kind: "modifyRoll", to: "triggerSubject", change: { kind: "add", amount: { kind: "chosen", choice: "experience" } } },
        ],
      },
      {
        id: "tag-team",
        name: "Tactician (Tag Team Roll)",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [situation("This is a Tag Team Roll")],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "hopeDie", sides: 20 } }],
      },
    ],
  },

  // Boost (Bone 4, CB p.331): "Mark a Stress to boost off a willing ally within Close range, fling yourself into the air,
  // and perform an aerial attack against a target within Far range. You have advantage on the attack, add a d10 to the
  // damage roll, and end your move within Melee range of the target."
  {
    cardId: "boost",
    uses: [
      {
        id: "main",
        name: "Boost",
        activation: { kind: "action" },
        requires: [situation("A willing ally within Close range lets you boost off them")],
        costs: [{ kind: "stress", amount: fixed(1) }],
        roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" }, advantage: true },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "either" }, type: "weapon" },
          { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: dice(1, 10) } },
          { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "End your move within Melee range of the target" },
        ],
      },
    ],
  },

  // Redirect (Bone 4, CB p.331): "When an attack made against you from beyond Melee range fails, roll a number of d6s
  // equal to your Proficiency. If any roll a 6, you can mark a Stress to redirect the attack to damage an adversary
  // within Very Close range instead."
  {
    cardId: "redirect",
    uses: [
      {
        id: "main",
        name: "Redirect",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "failed", from: "beyondMelee" } },
        steps: [
          {
            kind: "check",
            dice: { count: { kind: "proficiency" }, sides: 6 },
            test: { kind: "anyAtLeast", value: 6 },
            then: [
              {
                kind: "optional",
                id: "redirect",
                label: "Mark a Stress to redirect the attack",
                costs: [{ kind: "stress", amount: fixed(1) }],
                steps: [
                  {
                    kind: "redirectDamage",
                    to: "picked",
                    pick: { side: "enemy", range: "veryClose", count: { kind: "one" } },
                    target: "picked",
                    note: "The attack damages an adversary within Very Close range instead",
                  },
                ],
              },
            ],
            otherwise: [],
          },
        ],
      },
    ],
  },

  // Know Thy Enemy (Bone 5, CB p.331): "When observing a creature, you can make an Instinct Roll against them. On a
  // success, spend a Hope and ask the GM for one set of information about the target from the following options:
  // • Their unmarked Hit Points and Stress. • Their Difficulty and damage thresholds. • Their tactics and standard attack
  // damage dice. • Their features and Experiences. Additionally on a success, you can mark a Stress to remove a Fear from
  // the GM's Fear Pool." The Stress option comes first so an unpaid Hope (which stops its list, CB p.90) can't block it.
  {
    cardId: "know-thy-enemy",
    uses: [
      {
        id: "main",
        name: "Know Thy Enemy",
        activation: { kind: "action" },
        roll: { kind: "trait", trait: "instinct", difficulty: { kind: "target" } },
        targets: { side: "any", range: "unlimited", count: { kind: "one" }, sight: true },
        steps: [
          {
            kind: "optional",
            id: "fear",
            label: "Mark a Stress to remove a Fear from the GM's Fear Pool",
            when: ["success"],
            costs: [{ kind: "stress", amount: fixed(1) }],
            steps: [{ kind: "fear", to: "self", change: "lose", amount: fixed(1) }],
          },
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: fixed(1) }] },
          {
            kind: "manual",
            to: "targets",
            when: ["success"],
            text: "Ask the GM for one set of information about the target: their unmarked Hit Points and Stress; their Difficulty and damage thresholds; their tactics and standard attack damage dice; or their features and Experiences.",
          },
        ],
      },
    ],
  },

  // Signature Move (Bone 5, CB p.331): "Name and describe your signature combat move. Once per rest, when you perform
  // this signature move as part of an action you're taking, you can roll a d20 as your Hope Die. On a success, clear a
  // Stress." Two riders: the d20 before the roll (the limit) and the Stress after a success of that same roll.
  {
    cardId: "signature-move",
    uses: [
      {
        id: "main",
        name: "Signature Move",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [situation("This action performs your named signature move")],
        limit: { per: "rest" },
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "hopeDie", sides: 20 } }],
      },
      {
        id: "clear",
        name: "Signature Move (success)",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "action", result: "success" } },
        requires: [situation("This roll used Signature Move's d20 Hope Die")],
        steps: [{ kind: "clear", to: "self", track: "stress", amount: fixed(1) }],
      },
    ],
  },

  // Rapid Riposte (Bone 6, CB p.331): "When an attack made against you from within Melee range fails, you can mark a
  // Stress and seize the opportunity to deal the weapon damage of one of your active weapons to the attacker."
  {
    cardId: "rapid-riposte",
    uses: [
      {
        id: "main",
        name: "Rapid Riposte",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "failed", from: "melee" } },
        costs: [{ kind: "stress", amount: fixed(1) }],
        targets: { side: "trigger", who: "source" },
        steps: [{ kind: "damage", to: "targets", roll: { kind: "weapon", weapon: "either" }, type: "weapon" }],
      },
    ],
  },

  // Bone-Touched (Bone 7, CB p.331): "When 4 or more of the domain cards in your loadout are from the Bone domain, gain
  // the following benefits: • +1 bonus to Agility • Once per rest, you can spend 3 Hope to cause an attack that
  // succeeded against you to fail instead."
  {
    cardId: "bone-touched",
    uses: [
      {
        id: "main",
        name: "Bone-Touched",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "succeeded" } },
        requires: [boneTouched],
        limit: { per: "rest" },
        costs: [{ kind: "hope", amount: fixed(3) }],
        steps: [{ kind: "modifyRoll", to: "triggerSource", change: { kind: "fail" }, note: "The attack that succeeded against you fails instead" }],
      },
      {
        id: "agility",
        name: "Bone-Touched (+1 Agility)",
        activation: { kind: "passive" },
        requires: [boneTouched],
        mods: [{ kind: "trait", trait: "agility", delta: fixed(1) }],
        steps: [],
      },
    ],
  },

  // Cruel Precision (Bone 7, CB p.331): "When you make a successful attack with a weapon, gain a bonus to your damage
  // roll equal to either your Finesse or Agility." No choice to make: always the better of the two.
  {
    cardId: "cruel-precision",
    uses: [
      {
        id: "main",
        name: "Cruel Precision",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            change: { kind: "add", amount: { kind: "max", of: [{ kind: "trait", trait: "finesse" }, { kind: "trait", trait: "agility" }] } },
          },
        ],
      },
    ],
  },

  // Breaking Blow (Bone 8, CB p.331): "When you make a successful attack, you can mark a Stress to make the next
  // successful attack against that same target deal an extra 2d12 damage." The mark is a tag on the target until it is
  // next hit; your own next successful attack adds the 2d12 by itself, anyone else's is added by hand.
  {
    cardId: "breaking-blow",
    uses: [
      {
        id: "main",
        name: "Breaking Blow",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        costs: [{ kind: "stress", amount: fixed(1) }],
        steps: [
          {
            kind: "condition",
            to: "targets",
            condition: BREAKING_BLOW,
            duration: "hit",
            endsWhen: "The next successful attack against this target deals an extra 2d12 damage",
          },
          {
            kind: "manual",
            to: "targets",
            text: "If another character makes the next successful attack against this target, that attack deals an extra 2d12 damage: add it by hand.",
          },
        ],
      },
      {
        id: "extra",
        name: "Breaking Blow (extra 2d12)",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
        steps: [
          { kind: "modifyDamage", to: "targets", when: [{ kind: "targetHas", condition: BREAKING_BLOW }], change: { kind: "add", amount: dice(2, 12) } },
          { kind: "clearCondition", to: "targets", when: [{ kind: "targetHas", condition: BREAKING_BLOW }], condition: BREAKING_BLOW },
        ],
      },
    ],
  },

  // Wrangle (Bone 8, CB p.331): "Make an Agility Roll against all targets within Close range. Spend a Hope to move
  // targets you succeed against, and any willing allies within Close range, to another point within Close range."
  {
    cardId: "wrangle",
    uses: [
      {
        id: "main",
        name: "Wrangle",
        activation: { kind: "action" },
        roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "all" } },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: fixed(1) }] },
          { kind: "move", to: "targets", when: ["hit"], mode: "move", range: "close", relativeTo: "point", note: "Move the targets you succeeded against to another point within Close range" },
          {
            kind: "move",
            to: "allies",
            when: ["success"],
            pick: { side: "ally", range: "close", count: { kind: "any" }, willing: true },
            mode: "move",
            range: "close",
            relativeTo: "point",
            note: "Willing allies within Close range move to that point too",
          },
        ],
      },
    ],
  },

  // On the Brink (Bone 9, CB p.331): "When you have 2 or fewer Hit Points unmarked, you don't take Minor damage."
  {
    cardId: "on-the-brink",
    uses: [
      {
        id: "main",
        name: "On the Brink",
        activation: { kind: "passive" },
        requires: [{ kind: "hpUnmarkedAtMost", value: 2 }],
        mods: [{ kind: "flag", flag: "noMinorDamage" }],
        steps: [],
      },
    ],
  },

  // Splintering Strike (Bone 9, CB p.332): "Spend a Hope and make an attack against all adversaries within your weapon's
  // range. Once per long rest, on a success against any targets, roll your weapon's damage and distribute that damage
  // however you wish between the targets you succeeded against. Before you deal damage to each target, roll an
  // additional damage die and add its result to the damage you deal to them."
  {
    cardId: "splintering-strike",
    uses: [
      {
        id: "main",
        name: "Splintering Strike",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        costs: [{ kind: "hope", amount: fixed(1) }],
        roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "weapon", count: { kind: "all" } },
        steps: [
          {
            kind: "damage",
            to: "targets",
            when: ["hit"],
            roll: { kind: "weapon", weapon: "either" },
            type: "weapon",
            distribution: "split",
            extraDiePerTarget: true,
          },
        ],
      },
    ],
  },

  // Deathrun (Bone 10, CB p.332): "Spend 3 Hope to run a straight path through the battlefield to a point within Far
  // range, making an attack against all adversaries within your weapon's range along that path. Choose the order in
  // which you deal damage to the targets you succeeded against. For the first, roll your weapon damage with a +1 bonus to
  // your Proficiency. Then remove a die from your damage roll and deal the remaining damage to the next target. Continue
  // to remove a die for each subsequent target until you have no more damage dice or adversaries. You can't target the
  // same adversary more than once per attack." The targets come in the order the player chose.
  {
    cardId: "deathrun",
    uses: [
      {
        id: "main",
        name: "Deathrun",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(3) }],
        roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "weapon", count: { kind: "all" }, area: "path" },
        steps: [
          { kind: "move", to: "self", mode: "move", range: "far", relativeTo: "point", note: "Run a straight path to a point within Far range" },
          {
            kind: "damage",
            to: "targets",
            when: ["hit"],
            roll: { kind: "weapon", weapon: "either", proficiency: { delta: 1 } },
            type: "weapon",
            distribution: "dropDiePerTarget",
          },
        ],
      },
    ],
  },

  // Swift Step (Bone 10, CB p.332): "When an attack made against you fails, clear a Stress. If you can't clear a Stress,
  // gain a Hope." The Hope step comes first, so clearing your last Stress doesn't also gain a Hope.
  {
    cardId: "swift-step",
    uses: [
      {
        id: "main",
        name: "Swift Step",
        activation: { kind: "auto", trigger: { kind: "whenAttacked", stage: "failed" } },
        steps: [
          { kind: "hope", to: "self", when: [{ kind: "requires", requirement: { kind: "trackMarked", track: "stress", atMost: 0 } }], change: "gain", amount: fixed(1) },
          { kind: "clear", to: "self", when: [{ kind: "requires", requirement: { kind: "trackMarked", track: "stress", atLeast: 1 } }], track: "stress", amount: fixed(1) },
        ],
      },
    ],
  },
];
