// Feature effects of the Core Book ancestries (plan sheet-drawer, tracer FE-ancestry-core; SD0 shipped it empty).
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page and uses only the vocabulary of src/lib/domain/card-effects/types.ts (a gap is a `manual` step plus a bead).
//
// One entry per core ancestry feature classified combat or passive in ./classification.ts. Luckbringer (halfling, CB p.64)
// is a session-start use delegated to the session features. The out-of-combat ones (Efficient, Celestial Trance,
// Dread Visage, Natural Climber, Fungril Network) are FE-heritage-hf's roll-option and rest-trigger entries; the narrative
// ones (Caprine Leap, Death Connection, Amphibious) have no entry. Mixed ancestries need nothing here: `owned()` (CB p.71)
// picks the features and each keeps its own entry. Readings, manual steps and open rulings:
// docs/tasks/TASK-SD-FE-ancestry-core.md.

import type { FeatureEffect } from "../../domain/feature-effects/types";
import type { NumberSource, Requirement } from "../../domain/card-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: number, sides: 6 | 8 | 12): NumberSource => ({ kind: "dice", dice: { count: fixed(count), sides } });
const proficiency: NumberSource = { kind: "proficiency" };
const situation = (text: string): Requirement => ({ kind: "situation", text });
/** Kick and Tusks: the engine has no state check for a target's distance, so the player confirms it (Q13). */
const TARGET_IN_MELEE = "The target is within Melee range";

const ancestry = (owner: string, slug: string, uses: FeatureEffect["uses"]): FeatureEffect => ({
  featureId: `ancestry:${owner}:${slug}`,
  source: "ancestry",
  owner,
  uses,
});

export const ANCESTRY_CORE_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Clank (CB p.53)
  // Purposeful Design (CB p.53): "Decide who made you and for what purpose. At character creation, choose one of your
  // Experiences that best aligns with this purpose and gain a permanent +1 bonus to it." No Mod raises one Experience:
  // a manual note (bead, task doc).
  ancestry("clank", "purposeful-design", [
    {
      id: "main",
      name: "Purposeful Design",
      activation: { kind: "passive" },
      mods: [],
      steps: [{ kind: "manual", to: "self", text: "+1 to the Experience you chose at character creation that best aligns with your purpose" }],
    },
  ]),

  // ---------------------------------------------------------------- Drakona (CB p.54)
  // Scales (CB p.54): "Your scales act as natural protection. When you would take Severe damage, you can mark a Stress to
  // mark 1 fewer Hit Points." NV4: after the thresholds, not a severity step. Offered in the hit's reaction window (SD4).
  ancestry("drakona", "scales", [
    {
      id: "main",
      name: "Scales",
      activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "severe" } },
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [{ kind: "adjustHpMarked", to: "self", change: "fewer", amount: fixed(1), note: "Mark 1 fewer Hit Points" }],
    },
  ]),
  // Elemental Breath (CB p.54): "Choose an element for your breath (such as electricity, fire, or ice). You can use this
  // breath against a target or group of targets within Very Close range, treating it as an Instinct weapon that deals d8
  // magic damage using your Proficiency." One Instinct Roll against every target's Difficulty, damage rolled once (CB
  // p.104). The element is flavour (no damage keyword).
  ancestry("drakona", "elemental-breath", [
    {
      id: "main",
      name: "Elemental Breath",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "instinct", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "veryClose", count: { kind: "any" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: proficiency, sides: 8 } }, type: "magic" }],
    },
  ]),

  // ---------------------------------------------------------------- Dwarf (CB p.55)
  // Thick Skin (CB p.55): "When you take Minor damage, you can mark 2 Stress instead of marking a Hit Point." Minor damage
  // marks 1 Hit Point (CB p.91), so the answer pays 2 Stress and marks that Hit Point fewer.
  ancestry("dwarf", "thick-skin", [
    {
      id: "main",
      name: "Thick Skin",
      activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "minor" } },
      costs: [{ kind: "stress", amount: fixed(2) }],
      steps: [{ kind: "adjustHpMarked", to: "self", change: "fewer", amount: fixed(1), note: "Mark 2 Stress instead of a Hit Point" }],
    },
  ]),
  // Increased Fortitude (CB p.55): "Spend 3 Hope to halve incoming physical damage." CB p.107: the player hears the
  // incoming damage and "can then decide to spend 3 Hope to take half as much damage instead"; halving rounds up (Q6).
  ancestry("dwarf", "increased-fortitude", [
    {
      id: "main",
      name: "Increased Fortitude",
      activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", damageType: "physical" } },
      costs: [{ kind: "hope", amount: fixed(3) }],
      steps: [{ kind: "modifyDamage", to: "self", change: { kind: "halve" }, note: "Halve the incoming physical damage (rounded up)" }],
    },
  ]),

  // ---------------------------------------------------------------- Elf (CB p.56)
  // Quick Reactions (CB p.56): "Mark a Stress to gain advantage on a reaction roll."
  ancestry("elf", "quick-reactions", [
    {
      id: "main",
      name: "Quick Reactions",
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "reaction" } },
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "advantage" }, note: "Advantage on this reaction roll" }],
    },
  ]),

  // ---------------------------------------------------------------- Faerie (CB p.57)
  // Luckbender (CB p.57): "Once per session, after you or a willing ally within Close range makes an action roll, you can
  // spend 3 Hope to reroll the Duality Dice." The after-roll step (Q1); the new result stands (CB p.107).
  ancestry("faerie", "luckbender", [
    {
      id: "main",
      name: "Luckbender",
      activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", range: "close", result: "any", includeSelf: true } },
      limit: { per: "session" },
      costs: [{ kind: "hope", amount: fixed(3) }],
      steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "reroll", dice: "all" }, note: "Reroll the Duality Dice" }],
    },
  ]),
  // Wings (CB p.57): "You can fly. While flying, you can mark a Stress after an adversary makes an attack against you to
  // gain a +2 bonus to your Evasion against that attack." After the roll, in the reaction window (Q2); flying is the
  // drawer's Flying toggle (Q16).
  ancestry("faerie", "wings", [
    {
      id: "main",
      name: "Wings",
      activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "rolled" } },
      requires: [{ kind: "situation", text: "You are flying", check: { kind: "flying" } }],
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "evasion", amount: fixed(2) }, note: "+2 Evasion against this attack" }],
    },
  ]),

  // ---------------------------------------------------------------- Faun (CB p.58)
  // Kick (CB p.58): "When you succeed on an attack against a target within Melee range, you can mark a Stress to kick
  // yourself off them, dealing an extra 2d6 damage and knocking back either yourself or the target to Very Close range."
  ancestry("faun", "kick", [
    {
      id: "main",
      name: "Kick",
      activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
      requires: [situation(TARGET_IN_MELEE)],
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [
        { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: dice(2, 6) }, note: "An extra 2d6 damage" },
        {
          kind: "choose",
          id: "knock",
          label: "Knock back yourself or the target to Very Close range",
          options: [
            { id: "self", label: "Yourself", steps: [{ kind: "move", to: "self", mode: "knockBack", range: "veryClose", relativeTo: "target", note: "Knock yourself back to Very Close range" }] },
            { id: "target", label: "The target", steps: [{ kind: "move", to: "targets", mode: "knockBack", range: "veryClose", relativeTo: "self", note: "Knock the target back to Very Close range" }] },
          ],
        },
      ],
    },
  ]),

  // ---------------------------------------------------------------- Firbolg (CB p.59)
  // Charge (CB p.59): "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or
  // more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range." The Agility Roll
  // is the move (Difficulty from the GM); the player confirms the run in and the token is moved by prompt (Q9). The
  // targets are every enemy within Melee where the token stands when Charge is used (open ruling in the task doc).
  ancestry("firbolg", "charge", [
    {
      id: "main",
      name: "Charge",
      activation: { kind: "action" },
      requires: [situation("You move from Far or Very Far range into Melee range with one or more targets")],
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "gm" } },
      targets: { side: "enemy", range: "melee", count: { kind: "all" } },
      steps: [
        {
          kind: "optional",
          id: "stress",
          label: "Mark a Stress to deal 1d12 physical damage to all targets within Melee range",
          when: ["success"],
          costs: [{ kind: "stress", amount: fixed(1) }],
          steps: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: fixed(1), sides: 12 } }, type: "physical" }],
        },
      ],
    },
  ]),
  // Unshakable (CB p.59): "When you would mark a Stress, roll a d6. On a result of 6, don't mark it." The d6 rolls by
  // itself; no outcome step says "don't mark this Stress" (`negate` has no Stress), so a 6 is a manual step (bead).
  ancestry("firbolg", "unshakable", [
    {
      id: "main",
      name: "Unshakable",
      activation: { kind: "auto", trigger: { kind: "wouldMarkStress" } },
      steps: [
        {
          kind: "check",
          dice: { count: fixed(1), sides: 6 },
          test: { kind: "anyAtLeast", value: 6 },
          then: [{ kind: "manual", to: "self", text: "Unshakable rolled a 6: don't mark that Stress" }],
          otherwise: [],
        },
      ],
    },
  ]),

  // ---------------------------------------------------------------- Galapa (CB p.61)
  // Shell (CB p.61): "Gain a bonus to your damage thresholds equal to your Proficiency." Both thresholds (SD2 sums it).
  ancestry("galapa", "shell", [
    {
      id: "main",
      name: "Shell",
      activation: { kind: "passive" },
      mods: [
        { kind: "stat", stat: "majorThreshold", delta: proficiency },
        { kind: "stat", stat: "severeThreshold", delta: proficiency },
      ],
      steps: [],
    },
  ]),
  // Retract (CB p.61): "Mark a Stress to retract into your shell. While in your shell, you have resistance to physical
  // damage, you have disadvantage on action rolls, and you can't move." The book gives no end: you come out when you
  // choose (the effect's End button).
  ancestry("galapa", "retract", [
    {
      id: "main",
      name: "Retract",
      activation: { kind: "action" },
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [
        {
          kind: "effect",
          to: "self",
          label: "Retracted into your shell",
          mods: [
            { kind: "resistance", type: "physical", level: "resistant" },
            { kind: "flag", flag: "actionDisadvantage" },
            { kind: "flag", flag: "cannotMove" },
          ],
          duration: "manual",
          endsWhen: "You come out of your shell",
        },
      ],
    },
  ]),

  // ---------------------------------------------------------------- Giant (CB p.62)
  // Endurance (CB p.62): "Gain an additional Hit Point slot at character creation." Applied once to `hpMax` by
  // src/lib/domain/characters/slots.ts (`ancestry:giant:0`); nothing to run.
  ancestry("giant", "endurance", [{ id: "main", name: "Endurance", activation: { kind: "passive" }, mods: [], steps: [] }]),
  // Reach (CB p.62): "Treat any weapon, ability, spell, or other feature that has a Melee range as though it has a Very
  // Close range instead." NV10 `meleeRange` set to Very Close (step 1).
  ancestry("giant", "reach", [
    { id: "main", name: "Reach", activation: { kind: "passive" }, mods: [{ kind: "set", stat: "meleeRange", to: fixed(1) }], steps: [] },
  ]),

  // ---------------------------------------------------------------- Goblin (CB p.63)
  // Surefooted (CB p.63): "You ignore disadvantage on Agility Rolls."
  ancestry("goblin", "surefooted", [
    { id: "main", name: "Surefooted", activation: { kind: "passive" }, mods: [{ kind: "flag", flag: "ignoreAgilityDisadvantage" }], steps: [] },
  ]),
  // Danger Sense (CB p.63): "Once per rest, mark a Stress to force an adversary to reroll an attack against you or an ally
  // within Very Close range." After the attack roll, in the reaction window (Q2); the new roll stands (CB p.107).
  ancestry("goblin", "danger-sense", [
    {
      id: "main",
      name: "Danger Sense",
      activation: { kind: "reaction", trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", subjectWithin: "veryClose", stage: "rolled" } },
      limit: { per: "rest" },
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [{ kind: "modifyRoll", to: "triggerSource", change: { kind: "reroll", dice: "all" }, note: "The adversary rerolls the attack" }],
    },
  ]),

  // ---------------------------------------------------------------- Halfling (CB p.64)
  // Luckbringer (CB p.64): "At the start of each session, everyone in your party gains a Hope." The party's Hope is the
  // session features' record (src/lib/domain/session-features/luckbringer.ts: `applyLuckbringer` at `sessions.start`, capped
  // at each Hope maximum), so this use is a session-start timing that only names the delegate.
  ancestry("halfling", "luckbringer", [
    {
      id: "main",
      name: "Luckbringer",
      activation: { kind: "auto", trigger: { kind: "timing", at: "sessionStart" } },
      steps: [{ kind: "delegate", to: "self", feature: "luckbringer", note: "Everyone in your party gains a Hope (session features)" }],
    },
  ]),

  // Internal Compass (CB p.64): "When you roll a 1 on your Hope Die, you can reroll it." A choice ("you can"), so a
  // Use / Pass answer in the after-roll step (Q1), not automatic: a 1 on both dice is a critical the player may keep.
  ancestry("halfling", "internal-compass", [
    {
      id: "main",
      name: "Internal Compass",
      activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "any" } },
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "reroll", dice: "hope", ifAtMost: 1 }, note: "Reroll the Hope Die that rolled a 1" }],
    },
  ]),

  // ---------------------------------------------------------------- Human (CB p.65)
  // High Stamina (CB p.65): "Gain an additional Stress slot at character creation." Applied once to `stressMax` by
  // src/lib/domain/characters/slots.ts (`ancestry:human:0`); nothing to run.
  ancestry("human", "high-stamina", [{ id: "main", name: "High Stamina", activation: { kind: "passive" }, mods: [], steps: [] }]),
  // Adaptability (CB p.65): "When you fail a roll that utilized one of your Experiences, you can mark a Stress to reroll."
  ancestry("human", "adaptability", [
    {
      id: "main",
      name: "Adaptability",
      activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "failure" } },
      requires: [{ kind: "situation", text: "The roll used one of your Experiences", check: { kind: "rollUsedExperience" } }],
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "reroll", dice: "all" }, note: "Reroll" }],
    },
  ]),

  // ---------------------------------------------------------------- Infernis (CB p.66)
  // Fearless (CB p.66): "When you roll with Fear, you can mark 2 Stress to change it into a roll with Hope instead."
  ancestry("infernis", "fearless", [
    {
      id: "main",
      name: "Fearless",
      activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "withFear" } },
      costs: [{ kind: "stress", amount: fixed(2) }],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "withHope" }, note: "The roll is with Hope instead" }],
    },
  ]),

  // ---------------------------------------------------------------- Katari (CB p.67)
  // Feline Instincts (CB p.67): "When you make an Agility Roll, you can spend 2 Hope to reroll your Hope Die." Offered on
  // the actor's own Agility Roll once its dice are known.
  ancestry("katari", "feline-instincts", [
    {
      id: "main",
      name: "Feline Instincts",
      activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "agility", result: "any" } },
      costs: [{ kind: "hope", amount: fixed(2) }],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "reroll", dice: "hope" }, note: "Reroll your Hope Die" }],
    },
  ]),
  // Retracting Claws (CB p.67): "Make an Agility Roll to scratch a target within Melee range. On a success, they become
  // temporarily Vulnerable."
  ancestry("katari", "retracting-claws", [
    {
      id: "main",
      name: "Retracting Claws",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "melee", count: { kind: "one" } },
      steps: [{ kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }],
    },
  ]),

  // ---------------------------------------------------------------- Orc (CB p.68)
  // Sturdy (CB p.68): "When you have 1 Hit Point remaining, attacks against you have disadvantage." The adversary attack
  // engine reads it (SD2).
  ancestry("orc", "sturdy", [
    {
      id: "main",
      name: "Sturdy",
      activation: { kind: "passive" },
      requires: [{ kind: "hpUnmarkedAtMost", value: 1 }],
      mods: [{ kind: "disadvantageAgainst", on: "attack" }],
      steps: [],
    },
  ]),
  // Tusks (CB p.68): "When you succeed on an attack against a target within Melee range, you can spend a Hope to gore the
  // target with your tusks, dealing an extra 1d6 damage."
  ancestry("orc", "tusks", [
    {
      id: "main",
      name: "Tusks",
      activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
      requires: [situation(TARGET_IN_MELEE)],
      costs: [{ kind: "hope", amount: fixed(1) }],
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: dice(1, 6) }, note: "An extra 1d6 damage" }],
    },
  ]),

  // ---------------------------------------------------------------- Ribbet (CB p.69)
  // Long Tongue (CB p.69): "You can use your long tongue to grab onto things within Close range. Mark a Stress to use your
  // tongue as a Finesse Close weapon that deals d12 physical damage using your Proficiency." Grabbing things is fiction.
  ancestry("ribbet", "long-tongue", [
    {
      id: "main",
      name: "Long Tongue",
      activation: { kind: "action" },
      costs: [{ kind: "stress", amount: fixed(1) }],
      roll: { kind: "trait", trait: "finesse", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "close", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: proficiency, sides: 12 } }, type: "physical" }],
    },
  ]),

  // ---------------------------------------------------------------- Simiah (CB p.70)
  // Nimble (CB p.70): "Gain a permanent +1 bonus to your Evasion at character creation." SD2 adds it in derived stats.
  ancestry("simiah", "nimble", [
    { id: "main", name: "Nimble", activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "evasion", delta: fixed(1) }], steps: [] },
  ]),
];
