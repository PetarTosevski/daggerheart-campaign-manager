// Card effects of the Blade domain (plan combat-actions, tracer CE-blade).
// Pure data: no framework imports, relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (20 of the 21 Blade cards; A Soldier's Bond is
// out of combat). Each entry quotes its card text (CB p.329-330, as in ../domain-cards.ts). What the vocabulary
// (src/lib/domain/card-effects/types.ts) cannot express is a `manual` step, never a vocabulary change. Readings and
// manual steps, with their reasons: docs/tasks/TASK-CA-CE-blade.md.

import type { CardEffect, NumberSource } from "../../domain/card-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const one = fixed(1);

export const BLADE_EFFECTS: readonly CardEffect[] = [
  // Get Back Up (Level 1, CB p.329): "When you take Severe damage, you can mark a Stress to reduce the severity by one
  // threshold." Offered before the damage is marked, in the reaction window (Q13).
  {
    cardId: "get-back-up",
    uses: [
      {
        id: "main",
        name: "Get Back Up",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "severe" } },
        costs: [{ kind: "stress", amount: one }],
        steps: [{ kind: "reduceSeverity", to: "self", steps: 1 }],
      },
    ],
  },

  // Not Good Enough (Level 1, CB p.329): "When you roll your damage dice, you can reroll any 1s or 2s."
  // Reading: every 1 and 2 is rerolled once; the new result stands.
  {
    cardId: "not-good-enough",
    uses: [
      {
        id: "main",
        name: "Not Good Enough",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "damage" } },
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "reroll", atMost: 2 } }],
      },
    ],
  },

  // Whirlwind (Level 1, CB p.329): "When you make a successful attack against a target within Very Close range, you can
  // spend a Hope to use the attack against all other targets within Very Close range. All additional adversaries you
  // succeed against with this ability take half damage."
  // Written as the attack itself (a Use button), because the runner can only compare the same roll against the other
  // targets inside one use: the weapon attack, then the optional Hope (the roll's own Hope may pay, CB p.90) that reuses
  // the roll and the damage (one damage roll, CB p.104) against every other enemy within Very Close, halved.
  {
    cardId: "whirlwind",
    uses: [
      {
        id: "main",
        name: "Whirlwind",
        activation: { kind: "action" },
        roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "veryClose", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "either" }, type: "weapon" },
          {
            kind: "optional",
            id: "whirlwind",
            label: "Spend a Hope to use the attack against all other targets within Very Close range",
            when: ["success"],
            costs: [{ kind: "hope", amount: one }],
            steps: [
              {
                kind: "followUp",
                targets: { side: "enemy", range: "veryClose", count: { kind: "all" }, area: "aroundSelf" },
                steps: [
                  // The same roll record (cached by expression, R9), halved per additional adversary.
                  { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "either" }, type: "weapon", scale: "half" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // Reckless (Level 2, CB p.330): "Mark a Stress to gain advantage on an attack."
  {
    cardId: "reckless",
    uses: [
      {
        id: "main",
        name: "Reckless",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
        costs: [{ kind: "stress", amount: one }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "advantage" } }],
      },
    ],
  },

  // Scramble (Level 3, CB p.330): "Once per rest, when a creature within Melee range would deal damage to you, you can
  // avoid the attack and safely move out of Melee range of the enemy."
  {
    cardId: "scramble",
    uses: [
      {
        id: "main",
        name: "Scramble",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", from: "melee" } },
        limit: { per: "rest" },
        steps: [
          { kind: "negate", to: "self", what: "attack" },
          {
            kind: "move",
            to: "self",
            mode: "move",
            range: "veryClose",
            relativeTo: "triggerSource",
            note: "Move safely out of Melee range of the enemy",
          },
        ],
      },
    ],
  },

  // Versatile Fighter (Level 3, CB p.330): "You can use a different character trait for an equipped weapon, rather than
  // the trait the weapon calls for. When you deal damage, you can mark a Stress to use the maximum result of one of your
  // damage dice instead of rolling it."
  {
    cardId: "versatile-fighter",
    uses: [
      {
        // Gap: no vocabulary part changes the trait a weapon attack rolls (RollSpec `attack` always uses the weapon's).
        id: "trait",
        name: "Versatile Fighter: different trait",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "weaponAttack" } },
        steps: [
          {
            kind: "manual",
            to: "self",
            text: "You can use a different character trait for an equipped weapon, rather than the trait the weapon calls for.",
          },
        ],
      },
      {
        // The runner maxes the lowest die, which is the player's best pick.
        id: "max-die",
        name: "Versatile Fighter: maximum die",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "damage" } },
        costs: [{ kind: "stress", amount: one }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "maxDice", count: 1 } }],
      },
    ],
  },

  // Deadly Focus (Level 4, CB p.330): "Once per rest, you can apply all your focus toward a target of your choice. Until
  // you attack another creature, you defeat the target, or the battle ends, gain a +1 bonus to your Proficiency."
  {
    cardId: "deadly-focus",
    uses: [
      {
        id: "main",
        name: "Deadly Focus",
        activation: { kind: "action" },
        limit: { per: "rest" },
        targets: { side: "enemy", range: "unlimited", count: { kind: "one" } },
        exclusive: true,
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Deadly Focus",
            mods: [{ kind: "stat", stat: "proficiency", delta: one }],
            duration: "manual",
            endsWhen: "you attack another creature, you defeat the target, or the battle ends",
          },
          {
            kind: "condition",
            to: "targets",
            condition: { kind: "tag", tag: "Focused" },
            duration: "manual",
            endsWhen: "the focused PC attacks another creature, defeats this target, or the battle ends",
            note: "Marks the focus target so the table can see whom Deadly Focus is on",
          },
        ],
      },
    ],
  },

  // Fortified Armor (Level 4, CB p.330): "While you are wearing armor, gain a +2 bonus to your damage thresholds."
  {
    cardId: "fortified-armor",
    uses: [
      {
        id: "main",
        name: "Fortified Armor",
        activation: { kind: "passive" },
        requires: [{ kind: "armor", worn: true }],
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: fixed(2) },
          { kind: "stat", stat: "severeThreshold", delta: fixed(2) },
        ],
        steps: [],
      },
    ],
  },

  // Champion's Edge (Level 5, CB p.330): "When you critically succeed on an attack, you can spend up to 3 Hope and choose
  // one of the following options for each Hope spent: • You clear a Hit Point. • You clear an Armor Slot. • The target
  // must mark an additional Hit Point. You can't choose the same option more than once."
  {
    cardId: "champion-s-edge",
    uses: [
      {
        id: "main",
        name: "Champion's Edge",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "critical" } },
        choices: [{ id: "hope", label: "Hope to spend (one option each)", min: 1, max: fixed(3) }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        steps: [
          {
            kind: "choose",
            id: "edge",
            label: "Choose one option for each Hope spent",
            count: { kind: "spent", resource: "hope" },
            distinct: true,
            options: [
              { id: "clear-hp", label: "You clear a Hit Point", steps: [{ kind: "clear", to: "self", track: "hp", amount: one }] },
              { id: "clear-armor", label: "You clear an Armor Slot", steps: [{ kind: "clear", to: "self", track: "armor", amount: one }] },
              { id: "mark-hp", label: "The target must mark an additional Hit Point", steps: [{ kind: "markHp", to: "targets", when: ["hit"], amount: one }] },
            ],
          },
        ],
      },
    ],
  },

  // Vitality (Level 5, CB p.330): "When you choose this card, permanently gain two of the following benefits: • One Stress
  // slot • One Hit Point slot • +2 bonus to your damage thresholds Then place this card in your vault permanently."
  // A level-up pick the sheet applies; nothing happens on the map. Gap: no ModStat for Hit Point or Stress slots.
  {
    cardId: "vitality",
    uses: [
      {
        id: "main",
        name: "Vitality",
        activation: { kind: "passive" },
        steps: [
          {
            kind: "manual",
            to: "self",
            text: "When you choose this card, permanently gain two of the following benefits: one Stress slot, one Hit Point slot, +2 bonus to your damage thresholds. Then place this card in your vault permanently.",
          },
        ],
      },
    ],
  },

  // Battle-Hardened (Level 6, CB p.330): "Once per long rest when you would make a Death Move, you can spend a Hope to
  // clear a Hit Point instead."
  {
    cardId: "battle-hardened",
    uses: [
      {
        id: "main",
        name: "Battle-Hardened",
        activation: { kind: "reaction", trigger: { kind: "wouldMakeDeathMove", who: "self" } },
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: one }],
        steps: [
          { kind: "negate", to: "self", what: "deathMove" },
          { kind: "clear", to: "self", track: "hp", amount: one },
        ],
      },
    ],
  },

  // Rage Up (Level 6, CB p.330): "Before you make an attack, you can mark a Stress to gain a bonus to your damage roll
  // equal to twice your Strength. You can Rage Up twice per attack."
  {
    cardId: "rage-up",
    uses: [
      {
        id: "main",
        name: "Rage Up",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
        choices: [{ id: "times", label: "Times to Rage Up (a Stress each)", min: 1, max: fixed(2) }],
        costs: [{ kind: "stress", amount: { kind: "chosen", choice: "times" } }],
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            change: { kind: "add", amount: { kind: "product", of: [fixed(2), { kind: "trait", trait: "strength" }, { kind: "spent", resource: "stress" }] } },
          },
        ],
      },
    ],
  },

  // Blade-Touched (Level 7, CB p.330): "When 4 or more of the domain cards in your loadout are from the Blade domain, gain
  // the following benefits: • +2 bonus to your attack rolls • +4 bonus to your Severe damage threshold"
  {
    cardId: "blade-touched",
    uses: [
      {
        id: "main",
        name: "Blade-Touched",
        activation: { kind: "passive" },
        requires: [{ kind: "loadoutDomainCount", domain: "blade", min: 4 }],
        mods: [
          { kind: "stat", stat: "attack", delta: fixed(2) },
          { kind: "stat", stat: "severeThreshold", delta: fixed(4) },
        ],
        steps: [],
      },
    ],
  },

  // Glancing Blow (Level 7, CB p.330): "When you fail an attack, you can mark a Stress to deal weapon damage using half
  // your Proficiency." Half rounds up (CB p.107); the damage goes to the failed attack's targets, no new roll.
  {
    cardId: "glancing-blow",
    uses: [
      {
        id: "main",
        name: "Glancing Blow",
        activation: { kind: "reaction", trigger: { kind: "whenYouAttack", result: "failure", weapon: true } },
        costs: [{ kind: "stress", amount: one }],
        steps: [{ kind: "damage", to: "targets", roll: { kind: "weapon", weapon: "either", proficiency: "half" }, type: "weapon" }],
      },
    ],
  },

  // Battle Cry (Level 8, CB p.330): "Once per long rest, while you're charging into danger, you can muster a rousing call
  // that inspires your allies. All allies who can hear you each clear a Stress and gain a Hope. Additionally, your allies
  // gain advantage on attack rolls until you or an ally rolls a failure with Fear."
  {
    cardId: "battle-cry",
    uses: [
      {
        id: "main",
        name: "Battle Cry",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        requires: [{ kind: "situation", text: "You're charging into danger" }],
        steps: [
          { kind: "clear", to: "allies", pick: { side: "ally", range: "unlimited", count: { kind: "all" }, excludeSelf: true }, track: "stress", amount: one, note: "All allies who can hear you" },
          { kind: "hope", to: "allies", pick: { side: "ally", range: "unlimited", count: { kind: "all" }, excludeSelf: true }, change: "gain", amount: one },
          {
            kind: "effect",
            to: "allies",
            pick: { side: "ally", range: "unlimited", count: { kind: "all" }, excludeSelf: true },
            label: "Battle Cry",
            mods: [{ kind: "advantage", on: "attack" }],
            duration: "manual",
            endsWhen: "you or an ally rolls a failure with Fear",
          },
        ],
      },
    ],
  },

  // Frenzy (Level 8, CB p.330): "Once per long rest, you can go into a Frenzy until there are no more adversaries within
  // sight. While Frenzied, you can't use Armor Slots, and you gain a +10 bonus to your damage rolls and a +8 bonus to your
  // Severe damage threshold."
  {
    cardId: "frenzy",
    uses: [
      {
        id: "main",
        name: "Frenzy",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Frenzied",
            mods: [
              { kind: "flag", flag: "noArmorSlots" },
              { kind: "stat", stat: "damage", delta: fixed(10) },
              { kind: "stat", stat: "severeThreshold", delta: fixed(8) },
            ],
            duration: "manual",
            endsWhen: "there are no more adversaries within sight",
          },
        ],
      },
    ],
  },

  // Gore and Glory (Level 9, CB p.330): "When you critically succeed on a weapon attack, gain an additional Hope or clear
  // an additional Stress. Additionally, when you deal enough damage to defeat an enemy, gain a Hope or clear a Stress."
  {
    cardId: "gore-and-glory",
    uses: [
      {
        id: "critical",
        name: "Gore and Glory: critical",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "critical", weapon: true } },
        steps: [
          {
            kind: "choose",
            id: "glory",
            label: "Gain an additional Hope or clear an additional Stress",
            options: [
              { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "self", change: "gain", amount: one }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] },
            ],
          },
        ],
      },
      {
        id: "defeat",
        name: "Gore and Glory: defeat",
        activation: { kind: "rider", trigger: { kind: "whenEnemyDefeated", byYou: true } },
        steps: [
          {
            kind: "choose",
            id: "glory",
            label: "Gain a Hope or clear a Stress",
            options: [
              { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "self", change: "gain", amount: one }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] },
            ],
          },
        ],
      },
    ],
  },

  // Reaper's Strike (Level 9, CB p.330): "Once per long rest, spend a Hope to make an attack roll. The GM tells you which
  // targets within range it would succeed against. Choose one of these targets and force them to mark 5 Hit Points."
  // One roll against every enemy in weapon range (R9); the player learns hit or miss per target (U1) and picks one hit
  // target (`picked`; the server checks that the roll hit it). No damage roll: 5 HP are forced.
  {
    cardId: "reaper-s-strike",
    uses: [
      {
        id: "main",
        name: "Reaper's Strike",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: one }],
        roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "weapon", count: { kind: "all" } },
        steps: [
          {
            kind: "markHp",
            to: "picked",
            pick: { side: "enemy", range: "weapon", count: { kind: "one" } },
            when: ["hit"],
            amount: fixed(5),
            note: "Choose one of the targets the attack succeeded against",
          },
        ],
      },
    ],
  },

  // Battle Monster (Level 10, CB p.330): "When you make a successful attack against an adversary, you can mark 4 Stress
  // to force the target to mark a number of Hit Points equal to the number of Hit Points you currently have marked
  // instead of rolling for damage." The count is read before the damage roll.
  {
    cardId: "battle-monster",
    uses: [
      {
        id: "main",
        name: "Battle Monster",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        costs: [{ kind: "stress", amount: fixed(4) }],
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            when: ["hit"],
            change: { kind: "replaceWithHp", amount: { kind: "marked", who: "self", track: "hp" } },
          },
        ],
      },
    ],
  },

  // Onslaught (Level 10, CB p.330): "When you successfully make an attack with your weapon, you never deal damage beneath
  // a target's Major damage threshold (the target always marks a minimum of 2 Hit Points). Additionally, when a creature
  // within your weapon's range deals damage to an ally with an attack that doesn't include you, you can mark a Stress to
  // force them to make a Reaction Roll (15). On a failure, the target must mark a Hit Point."
  {
    cardId: "onslaught",
    uses: [
      {
        id: "floor",
        name: "Onslaught: never beneath Major",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        steps: [{ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "minimumSeverity", severity: "major" } }],
      },
      {
        id: "reaction",
        name: "Onslaught: reaction roll",
        activation: { kind: "reaction", trigger: { kind: "whenAllyTakesDamage", range: "veryFar", sourceWithin: "weapon" } },
        requires: [{ kind: "situation", text: "The attack doesn't include you" }],
        costs: [{ kind: "stress", amount: one }],
        targets: { side: "trigger", who: "source" },
        steps: [
          {
            kind: "save",
            to: "targets",
            difficulty: { kind: "fixed", value: 15 },
            onFail: [{ kind: "markHp", to: "targets", amount: one }],
            onSuccess: [],
          },
        ],
      },
    ],
  },
];
