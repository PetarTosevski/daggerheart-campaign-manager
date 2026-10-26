// Feature effects of Guardian and Warrior (FE-guardian-warrior) (plan sheet-drawer). SD0 shipped the table empty.
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page and uses only the vocabulary of src/lib/domain/card-effects/types.ts (a gap is a `manual` step plus a bead).
//
// One entry per Guardian and Warrior feature classified combat or passive in ./classification.ts (21 of 22; Martial
// Preparation is out of combat, a downtime move). Guardian: CB p.36. Warrior: CB p.48. Readings, manual steps and open
// points: docs/tasks/TASK-SD-FE-guardian-warrior.md.

import type { CardUse, ChooseOption, ConditionRef, NumberSource, Requirement, StateCheck } from "../../domain/card-effects/types";
import type { FeatureEffect } from "../../domain/feature-effects/types";
import { TRAIT_IDS } from "../types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const level: NumberSource = { kind: "level" };
const situation = (text: string, check?: StateCheck): Requirement => (check ? { kind: "situation", text, check } : { kind: "situation", text });

/** Nemesis (CB p.36): the one adversary you Prioritize (a tag on the instance, ended by your next rest or a new Prioritize). */
const PRIORITIZED: ConditionRef = { kind: "tag", tag: "Prioritized" };
/** The Unstoppable sheet effect this table's Unstoppable use creates; its other uses gate on it. */
const UNSTOPPABLE_ID = "class:guardian:unstoppable";
const whileUnstoppable = situation("While you are Unstoppable", { kind: "featureEffect", featureId: UNSTOPPABLE_ID });

/** Attack of Opportunity's three effects (CB p.48). Movement is a prompt (Q9 of combat-actions). */
const AOO_OPTIONS: readonly ChooseOption[] = [
  { id: "hold", label: "They can't move from where they are", steps: [{ kind: "manual", to: "targets", text: "They can't move from where they are." }] },
  { id: "damage", label: "Deal your primary weapon's damage", steps: [{ kind: "damage", to: "targets", roll: { kind: "weapon", weapon: "primary" }, type: "weapon" }] },
  { id: "follow", label: "You move with them", steps: [{ kind: "move", to: "self", mode: "move", relativeTo: "triggerSource", note: "You move with them" }] },
];

export const GUARDIAN_WARRIOR_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Guardian (CB p.36)

  // Frontline Tank (Guardian's Hope Feature, CB p.36): "Spend 3 Hope to clear 2 Armor Slots." Repeatable: CB p.107, "you
  // can spend 6 Hope to clear 4 Armor Slots" (`times`).
  {
    featureId: "hope:guardian",
    source: "hope",
    owner: "guardian",
    uses: [
      {
        id: "main",
        name: "Frontline Tank",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(3) }],
        steps: [{ kind: "clear", to: "self", track: "armor", amount: fixed(2), note: "Clear 2 Armor Slots" }],
      },
    ],
  },

  // Unstoppable (Guardian class feature, CB p.36): "Once per long rest, you can become Unstoppable. You gain an
  // Unstoppable Die. At level 1, your Unstoppable Die is a d4. Place it on your character sheet in the space provided,
  // starting with the 1 value facing up. After you make a damage roll that deals 1 or more Hit Points to a target,
  // increase the Unstoppable Die value by one. When the die's value would exceed its maximum value or when the scene
  // ends, remove the die and drop out of Unstoppable. At level 5, your Unstoppable Die increases to a d6. While
  // Unstoppable, you gain the following benefits: • You reduce the severity of physical damage by one threshold (Severe
  // to Major, Major to Minor, Minor to None). • You add the current value of the Unstoppable Die to your damage roll.
  // • You can't be Restrained or Vulnerable."
  // D5 keeps the die (`classState.unstoppable`, its d4 / d6 by level), its once-per-long-rest key `unstoppable`, the
  // "+die" damage roll option and the session-end drop (NV2); this entry adds the sheet effect the other uses gate on.
  {
    featureId: UNSTOPPABLE_ID,
    source: "class",
    owner: "guardian",
    uses: [
      {
        id: "main",
        name: "Unstoppable",
        activation: { kind: "action" },
        steps: [
          { kind: "delegate", to: "self", feature: "unstoppable", note: "Gain the Unstoppable Die at 1; Restrained and Vulnerable clear" },
          {
            kind: "effect",
            to: "self",
            label: "Unstoppable",
            mods: [{ kind: "flag", flag: "cannotBeRestrained" }],
            duration: "scene",
            endsWhen: "The Unstoppable Die's value would exceed its maximum",
            note: "Physical damage one threshold lower; the die's value added to damage rolls; can't be Restrained or Vulnerable",
          },
          { kind: "manual", to: "self", text: "While Unstoppable you can't be Vulnerable." },
        ],
      },
      {
        id: "severity",
        name: "Unstoppable: physical severity",
        activation: { kind: "auto", trigger: { kind: "whenYouWouldTakeDamage", damageType: "physical" } },
        requires: [whileUnstoppable],
        steps: [{ kind: "reduceSeverity", to: "self", steps: 1, note: "Severe to Major, Major to Minor, Minor to None" }],
      },
      {
        id: "grow",
        name: "Unstoppable: dealt Hit Points",
        activation: { kind: "auto", trigger: { kind: "whenTargetMarksHp" } },
        requires: [whileUnstoppable],
        steps: [{ kind: "delegate", to: "self", feature: "unstoppableHit", note: "Raise the Unstoppable Die by one; past its maximum, drop out" }],
      },
    ],
  },

  // Unwavering (Stalwart foundation, CB p.36): "Gain a permanent +1 bonus to your damage thresholds."
  {
    featureId: "subclass:stalwart:unwavering",
    source: "subclass",
    owner: "stalwart",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Unwavering",
        activation: { kind: "passive" },
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: fixed(1) },
          { kind: "stat", stat: "severeThreshold", delta: fixed(1) },
        ],
        steps: [],
      },
    ],
  },

  // Iron Will (Stalwart foundation, CB p.36): "When you take physical damage, you can mark an additional Armor Slot to
  // reduce the severity." Answered in the reaction window of the hit (Q13 / Q17 of combat-actions).
  {
    featureId: "subclass:stalwart:iron-will",
    source: "subclass",
    owner: "stalwart",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Iron Will",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", damageType: "physical" } },
        steps: [{ kind: "extraArmorSlots", to: "self", max: fixed(1), note: "Mark one additional Armor Slot against this damage" }],
      },
    ],
  },

  // Unrelenting (Stalwart specialization, CB p.36): "Gain a permanent +2 bonus to your damage thresholds."
  {
    featureId: "subclass:stalwart:unrelenting",
    source: "subclass",
    owner: "stalwart",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Unrelenting",
        activation: { kind: "passive" },
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: fixed(2) },
          { kind: "stat", stat: "severeThreshold", delta: fixed(2) },
        ],
        steps: [],
      },
    ],
  },

  // Partners-in-Arms (Stalwart specialization, CB p.36): "When an ally within Very Close range takes damage, you can mark
  // an Armor Slot to reduce the severity by one threshold." Offered to the Guardian in the ally's reaction window.
  {
    featureId: "subclass:stalwart:partners-in-arms",
    source: "subclass",
    owner: "stalwart",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Partners-in-Arms",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose" } },
        costs: [{ kind: "armor", amount: fixed(1) }],
        steps: [{ kind: "reduceSeverity", to: "triggerSubject", steps: 1, note: "The ally's damage is one threshold lower" }],
      },
    ],
  },

  // Undaunted (Stalwart mastery, CB p.36): "Gain a permanent +3 bonus to your damage thresholds."
  {
    featureId: "subclass:stalwart:undaunted",
    source: "subclass",
    owner: "stalwart",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Undaunted",
        activation: { kind: "passive" },
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: fixed(3) },
          { kind: "stat", stat: "severeThreshold", delta: fixed(3) },
        ],
        steps: [],
      },
    ],
  },

  // Loyal Protector (Stalwart mastery, CB p.36): "When an ally within Close range has 2 or fewer Hit Points and would
  // take damage, you can mark a Stress to sprint to their side and take the damage instead." "2 or fewer Hit Points" is
  // read as unmarked HP (the analysis reading; the engine decides it from the ally's track).
  {
    featureId: "subclass:stalwart:loyal-protector",
    source: "subclass",
    owner: "stalwart",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Loyal Protector",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "close" } },
        requires: [situation("The ally has 2 or fewer Hit Points unmarked", { kind: "hpUnmarkedAtMost", value: 2, who: "subject" })],
        costs: [{ kind: "stress", amount: fixed(1) }],
        steps: [
          { kind: "move", to: "self", mode: "move", note: "Sprint to the ally's side" },
          { kind: "redirectDamage", to: "triggerSubject", target: "self", note: "You take the damage instead" },
        ],
      },
    ],
  },

  // At Ease (Vengeance foundation, CB p.36): "Gain an additional Stress slot." No `ModStat` moves Stress slots; the
  // sheet's slots already add it (src/lib/domain/characters/slots.ts, "subclass:vengeance"). Passive, no mods.
  {
    featureId: "subclass:vengeance:at-ease",
    source: "subclass",
    owner: "vengeance",
    card: "foundation",
    uses: [{ id: "main", name: "At Ease", activation: { kind: "passive" }, mods: [], steps: [] }],
  },

  // Revenge (Vengeance foundation, CB p.36): "When an adversary within Melee range succeeds on an attack against you,
  // you can mark 2 Stress to force the attacker to mark a Hit Point."
  {
    featureId: "subclass:vengeance:revenge",
    source: "subclass",
    owner: "vengeance",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Revenge",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "succeeded", from: "melee" } },
        targets: { side: "trigger", who: "source" },
        costs: [{ kind: "stress", amount: fixed(2) }],
        steps: [{ kind: "markHp", to: "triggerSource", amount: fixed(1), note: "The attacker marks a Hit Point" }],
      },
    ],
  },

  // Act of Reprisal (Vengeance specialization, CB p.36): "When an adversary damages an ally within Melee range, you gain
  // a +1 bonus to your Proficiency for the next successful attack you make against that adversary." Q8 (a): the damaged
  // ally is within Melee range of you. The bonus is keyed to that adversary (NV9 `damagedAlly`).
  {
    featureId: "subclass:vengeance:act-of-reprisal",
    source: "subclass",
    owner: "vengeance",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Act of Reprisal",
        activation: { kind: "auto", trigger: { kind: "whenAllyTakesDamage", range: "melee" } },
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Act of Reprisal",
            mods: [{ kind: "stat", stat: "proficiency", delta: fixed(1), versus: { creature: { kind: "damagedAlly", range: "melee" }, on: "attacksAgainstThem" } }],
            duration: "manual",
            endsOn: ["attackSucceeds"],
            endsWhen: "Your next successful attack against that adversary",
            note: "+1 Proficiency on your next successful attack against the adversary that damaged the ally",
          },
        ],
      },
    ],
  },

  // Nemesis (Vengeance mastery, CB p.36): "Spend 2 Hope to Prioritize an adversary until your next rest. When you make an
  // attack against your Prioritized adversary, you can swap the results of your Hope and Fear Dice. You can only
  // Prioritize one adversary at a time."
  {
    featureId: "subclass:vengeance:nemesis",
    source: "subclass",
    owner: "vengeance",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Nemesis",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(2) }],
        targets: { side: "enemy", range: "unlimited", count: { kind: "one" } },
        exclusive: true,
        steps: [{ kind: "condition", to: "targets", condition: PRIORITIZED, duration: "rest", note: "Prioritized until your next rest" }],
      },
      {
        id: "swap",
        name: "Nemesis: swap Hope and Fear",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "attack", result: "any" } },
        requires: [situation("The attack is against your Prioritized adversary", { kind: "hasCondition", condition: PRIORITIZED, who: "target" })],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "swapDuality" }, note: "Swap the results of your Hope and Fear Dice" }],
      },
    ],
  },

  // ---------------------------------------------------------------- Warrior (CB p.48)

  // No Mercy (Warrior's Hope Feature, CB p.48): "Spend 3 Hope to gain a +1 bonus to your attack rolls until your next rest."
  {
    featureId: "hope:warrior",
    source: "hope",
    owner: "warrior",
    uses: [
      {
        id: "main",
        name: "No Mercy",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(3) }],
        steps: [{ kind: "effect", to: "self", label: "No Mercy", mods: [{ kind: "stat", stat: "attack", delta: fixed(1) }], duration: "rest", note: "+1 to attack rolls until your next rest" }],
      },
    ],
  },

  // Attack of Opportunity (Warrior class feature, CB p.48): "If an adversary within Melee range attempts to leave that
  // range, make a reaction roll using a trait of your choice against their Difficulty. Choose one effect on a success, or
  // two if you critically succeed: • They can't move from where they are. • You deal damage to them equal to your primary
  // weapon's damage. • You move with them." A reaction roll takes one trait (CB p.99: no Hope or Fear), so "a trait of
  // your choice" is one use per trait: the player picks the use. The critical's second pick is a second `choose` step
  // (open point 2).
  {
    featureId: "class:warrior:attack-of-opportunity",
    source: "class",
    owner: "warrior",
    uses: TRAIT_IDS.map((trait): CardUse => ({
      id: trait,
      name: `Attack of Opportunity (${trait[0]!.toUpperCase()}${trait.slice(1)})`,
      activation: { kind: "reaction", trigger: { kind: "whenEnemyLeavesRange", range: "melee" } },
      targets: { side: "trigger", who: "source" },
      roll: { kind: "reaction", trait, difficulty: { kind: "target" } },
      steps: [
        { kind: "choose", id: "effect", label: "Choose one effect", when: ["success"], options: AOO_OPTIONS },
        { kind: "choose", id: "critical", label: "Critical success: choose a second, different effect", when: ["critical"], options: AOO_OPTIONS },
      ],
    })),
  },

  // Combat Training (Warrior class feature, CB p.48): "You ignore burden when equipping weapons. When you deal physical
  // damage, you gain a bonus to your damage roll equal to your level." Burden is an equipping rule (no combat step). The
  // damage bonus is also D5's auto roll option `combatTraining` today (open point 3).
  {
    featureId: "class:warrior:combat-training",
    source: "class",
    owner: "warrior",
    uses: [
      {
        id: "main",
        name: "Combat Training",
        activation: { kind: "auto", trigger: { kind: "whenYouDealDamage", damageType: "physical" } },
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: level }, note: "+your level to the physical damage roll" }],
      },
    ],
  },

  // Courage (Call of the Brave foundation, CB p.48): "When you fail a roll with Fear, you gain a Hope." The trigger has no
  // "failure with Fear" result: it is the failure, and "with Fear" is a situation the server decides (open point 4).
  {
    featureId: "subclass:call-of-the-brave:courage",
    source: "subclass",
    owner: "call-of-the-brave",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Courage",
        activation: { kind: "auto", trigger: { kind: "afterYouRoll", roll: "action", result: "failure" } },
        requires: [situation("The roll was with Fear")],
        steps: [{ kind: "hope", to: "self", change: "gain", amount: fixed(1), note: "Gain a Hope" }],
      },
    ],
  },

  // Battle Ritual (Call of the Brave foundation, CB p.48): "Once per long rest, before you attempt something incredibly
  // dangerous or face off against a foe who clearly outmatches you, describe what ritual you perform or preparations you
  // make. When you do, clear 2 Stress and gain 2 Hope." The situation is the player's check box (Q13).
  {
    featureId: "subclass:call-of-the-brave:battle-ritual",
    source: "subclass",
    owner: "call-of-the-brave",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Battle Ritual",
        activation: { kind: "action" },
        requires: [situation("You are about to attempt something incredibly dangerous or face a foe who clearly outmatches you, and you describe your ritual or preparations")],
        limit: { per: "longRest" },
        steps: [
          { kind: "clear", to: "self", track: "stress", amount: fixed(2), note: "Clear 2 Stress" },
          { kind: "hope", to: "self", change: "gain", amount: fixed(2), note: "Gain 2 Hope" },
        ],
      },
    ],
  },

  // Rise to the Challenge (Call of the Brave specialization, CB p.48): "You are vigilant in the face of mounting danger.
  // While you have 2 or fewer Hit Points unmarked, you can roll a d20 as your Hope Die." "Can": a toggle on your roll.
  {
    featureId: "subclass:call-of-the-brave:rise-to-the-challenge",
    source: "subclass",
    owner: "call-of-the-brave",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Rise to the Challenge",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [{ kind: "hpUnmarkedAtMost", value: 2 }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "hopeDie", sides: 20 }, note: "Roll a d20 as your Hope Die" }],
      },
    ],
  },

  // Camaraderie (Call of the Brave mastery, CB p.48): "Your unwavering bravery is a rallying point for your allies. You can
  // initiate a Tag Team Roll one additional time per session. Additionally, when an ally initiates a Tag Team Roll with
  // you, they only need to spend 2 Hope to do so."
  {
    featureId: "subclass:call-of-the-brave:camaraderie",
    source: "subclass",
    owner: "call-of-the-brave",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Camaraderie",
        activation: { kind: "passive" },
        mods: [
          { kind: "stat", stat: "tagTeamUses", delta: fixed(1) },
          { kind: "set", stat: "tagTeamAllyCost", to: fixed(2) },
        ],
        steps: [],
      },
    ],
  },

  // Slayer (Call of the Slayer foundation, CB p.48): "You gain a pool of dice called Slayer Dice. On a roll with Hope, you
  // can place a d6 on this card instead of gaining a Hope, adding the die to the pool. You can store a number of Slayer
  // Dice equal to your Proficiency. When you make an attack roll or damage roll, you can spend any number of these Slayer
  // Dice, rolling them and adding their result to the roll. At the end of each session, clear any unspent Slayer Dice on
  // this card and gain a Hope per die cleared."
  // Storing (the dice-box prompt `slayerStore`), the Proficiency cap and the session-end Hope stay with the session
  // features (src/lib/domain/session-features/slayer.ts); these riders spend the pool (NV1 `slayer`).
  {
    featureId: "subclass:call-of-the-slayer:slayer",
    source: "subclass",
    owner: "call-of-the-slayer",
    card: "foundation",
    uses: [
      {
        id: "attack",
        name: "Slayer Dice: attack roll",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
        choices: [{ id: "dice", label: "Slayer Dice to spend", min: 1 }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "dice" }, pool: "slayer" }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: { kind: "spent", resource: "heldDie" } }, note: "Add the Slayer Dice rolled" }],
      },
      {
        id: "damage",
        name: "Slayer Dice: damage roll",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "damage" } },
        choices: [{ id: "dice", label: "Slayer Dice to spend", min: 1 }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "dice" }, pool: "slayer" }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "spent", resource: "heldDie" } }, note: "Add the Slayer Dice rolled" }],
      },
    ],
  },

  // Weapon Specialist (Call of the Slayer specialization, CB p.48): "You can wield multiple weapons with dangerous ease.
  // When you succeed on an attack, you can spend a Hope to add one of the damage dice from your secondary weapon to the
  // damage roll. Additionally, once per long rest when you roll your Slayer Dice, reroll any 1s." The reroll has no step
  // (no reroll of spent held dice): a manual Use, once per long rest (open point 5).
  {
    featureId: "subclass:call-of-the-slayer:weapon-specialist",
    source: "subclass",
    owner: "call-of-the-slayer",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Weapon Specialist",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        costs: [{ kind: "hope", amount: fixed(1) }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "addWeaponDie", weapon: "secondary" }, note: "Add a damage die of your secondary weapon" }],
      },
      {
        id: "slayer-ones",
        name: "Weapon Specialist: reroll Slayer 1s",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        steps: [{ kind: "manual", to: "self", text: "Reroll any 1s on the Slayer Dice you just rolled; the new results stand (CB p.107)." }],
      },
    ],
  },
];
