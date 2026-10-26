// Card effects of the Dread domain (plan combat-actions, tracer CE-dread). Pure data: no framework imports, relative
// imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (all 21 Dread cards). Each entry quotes its
// card text (HF p.180-181, Domain Card Reference: Blighting Strike to Darkfire on p.180, Jump Scare to Invoke Torment on
// p.181); what the vocabulary (src/lib/domain/card-effects/types.ts) cannot express is a `manual` step with the card's
// words, never a vocabulary change. Readings and every manual step: docs/tasks/TASK-CA-CE-dread.md.

import type { CardEffect, DiceExpr, NumberSource, Step } from "../../domain/card-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: NumberSource, sides: DiceExpr["sides"], plus?: number): DiceExpr =>
  plus === undefined ? { count, sides } : { count, sides, plus: n(plus) };
const prof: NumberSource = { kind: "proficiency" };
const spellcast: NumberSource = { kind: "spellcast" };
const dreadTouched = [{ kind: "loadoutDomainCount", domain: "dread", min: 4 }] as const;

/** Darkfire: d8+6 magic damage using your Spellcast trait (rolled once for every target, CB p.104). */
const darkfireDamage = (half: boolean): Step => ({
  kind: "damage",
  to: "targets",
  roll: { kind: "dice", dice: dice(spellcast, 8, 6) },
  type: "magic",
  ...(half ? { scale: "half" as const } : {}),
});

export const DREAD_EFFECTS: readonly CardEffect[] = [
  // Blighting Strike (L1): "Make a Spellcast Roll against a target within Far range. On a success: • On a roll with Hope,
  // deal d6+1 magic damage using your Proficiency. On a roll with Fear, deal d10+1 magic damage using your Proficiency.
  // • The target's next successful attack deals half damage. On a failure, you must spend a Hope or mark a Stress."
  {
    cardId: "blighting-strike",
    uses: [
      {
        id: "main",
        name: "Blighting Strike",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit", "withHope"], roll: { kind: "dice", dice: dice(prof, 6, 1) }, type: "magic" },
          { kind: "damage", to: "targets", when: ["hit", "withFear"], roll: { kind: "dice", dice: dice(prof, 10, 1) }, type: "magic" },
          {
            kind: "effect",
            to: "targets",
            when: ["hit"],
            label: "Blighted: next successful attack deals half damage",
            mods: [{ kind: "flag", flag: "halfDamage" }],
            duration: "hit",
          },
          {
            kind: "pay",
            when: ["failure"],
            costs: [{ kind: "either", options: [[{ kind: "hope", amount: n(1) }], [{ kind: "stress", amount: n(1) }]] }],
            note: "On a failure, you must spend a Hope or mark a Stress.",
          },
        ],
      },
    ],
  },

  // Umbral Veil (L1): "Once per rest, you can mark a Stress to encase yourself in shadowy energy. When you do, place a
  // number of tokens on this card equal to the number of Fear in the GM's pool. After an attack roll is made against you,
  // you can spend any number of tokens to give the result a −1 penalty per token spent. At the end of the scene, clear
  // all unspent tokens."
  {
    cardId: "umbral-veil",
    uses: [
      {
        id: "main",
        name: "Umbral Veil",
        activation: { kind: "action" },
        limit: { per: "rest" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [
          { kind: "tokens", to: "self", op: "set", amount: { kind: "gmFear" } },
          { kind: "effect", to: "self", label: "Umbral Veil: shadowy energy", mods: [], duration: "scene" },
        ],
      },
      {
        id: "spend",
        name: "Umbral Veil: penalty to an attack roll",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "rolled" } },
        requires: [{ kind: "effectActive", cardId: "umbral-veil" }],
        choices: [{ id: "tokens", label: "Tokens to spend", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        targets: { side: "trigger", who: "source" },
        steps: [
          {
            kind: "modifyRoll",
            to: "triggerSource",
            change: { kind: "add", amount: { kind: "calc", of: { kind: "spent", resource: "tokens" }, times: -1 } },
            note: "A −1 penalty to the attack roll per token spent.",
          },
        ],
      },
      {
        id: "scene-end",
        name: "Umbral Veil: clear tokens at the end of the scene",
        activation: { kind: "auto", trigger: { kind: "timing", at: "sceneEnd" } },
        steps: [{ kind: "tokens", to: "self", op: "clear" }],
      },
    ],
  },

  // Voice of Dread (L1): "You can magically speak to a creature you can see, tormenting them with your words. Make a
  // Spellcast Roll against them. On a success, they must mark a Stress and are frozen with terror, making them
  // temporarily Restrained."
  {
    cardId: "voice-of-dread",
    uses: [
      {
        id: "main",
        name: "Voice of Dread",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "unlimited", count: { kind: "one" }, sight: true },
        steps: [
          { kind: "markStress", to: "targets", when: ["hit"], amount: n(1) },
          { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "restrained" }, duration: "temporary" },
        ],
      },
    ],
  },

  // Hideous Retribution (L2): "When an ally within Close range takes damage from a target you can see, you can make a
  // reaction roll against the target using your Spellcast trait. On a success, mark a Stress to deal d6 magic damage
  // using your Proficiency."
  {
    cardId: "hideous-retribution",
    uses: [
      {
        id: "main",
        name: "Hideous Retribution",
        activation: { kind: "reaction", trigger: { kind: "whenAllyTakesDamage", range: "close", sourceInSight: true } },
        roll: { kind: "reaction", trait: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "trigger", who: "source" },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "stress", amount: n(1) }] },
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(prof, 6) }, type: "magic" },
        ],
      },
    ],
  },

  // Siphon Essence (L2): "Make a Spellcast Roll against a target within Very Close range. Once per long rest on a
  // success, the target takes d12+4 magic damage using your Proficiency. On a success with Fear, you gain a +1 bonus to
  // your Proficiency for this attack. You clear a number of Hit Points equal to the number of Hit Points the target
  // marked from this attack."
  {
    cardId: "siphon-essence",
    uses: [
      {
        id: "main",
        name: "Siphon Essence",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "veryClose", count: { kind: "one" } },
        steps: [
          // The +1 Proficiency on a success with Fear is a second expression: `modifyDamage proficiency` only changes
          // weapon dice in the runner, and a critical counts as Hope (CB p.90), so it keeps the plain Proficiency.
          { kind: "damage", to: "targets", when: ["hit", "withHope"], roll: { kind: "dice", dice: dice(prof, 12, 4) }, type: "magic" },
          {
            kind: "damage",
            to: "targets",
            when: ["hit", "withFear"],
            roll: { kind: "dice", dice: dice({ kind: "calc", of: prof, plus: 1 }, 12, 4) },
            type: "magic",
            note: "On a success with Fear, +1 Proficiency for this attack.",
          },
          {
            kind: "manual",
            to: "self",
            when: ["targetMarkedHp"],
            text: "You clear a number of Hit Points equal to the number of Hit Points the target marked from this attack.",
          },
        ],
      },
    ],
  },

  // Shared Trauma (L3): "You can transfer suffering from one creature to another. Once per rest, mark any number of Hit
  // Points on a willing creature within Melee range to clear an equal number of Hit Points on another willing creature
  // within Melee range."
  {
    cardId: "shared-trauma",
    uses: [
      {
        id: "main",
        name: "Shared Trauma",
        activation: { kind: "action" },
        limit: { per: "rest" },
        choices: [{ id: "hp", label: "Hit Points to transfer", min: 1 }],
        // The use's target is the creature that clears; the step's `pick` is the one that marks.
        targets: { side: "any", range: "melee", count: { kind: "one" }, willing: true },
        steps: [
          {
            kind: "markHp",
            to: "picked",
            pick: { side: "any", range: "melee", count: { kind: "one" }, willing: true },
            amount: { kind: "chosen", choice: "hp" },
            note: "A willing creature within Melee range marks the Hit Points.",
          },
          { kind: "clear", to: "targets", track: "hp", amount: { kind: "chosen", choice: "hp" }, note: "Another willing creature within Melee range clears as many." },
        ],
      },
    ],
  },

  // Terrify (L3): "Make a Spellcast Roll against a target within Close range. On a success, the target marks 1d4 Stress,
  // and you can make the target flee one range away from you (such as Very Close to Close or Close to Far). On a success
  // with Fear, the target also becomes temporarily Vulnerable."
  {
    cardId: "terrify",
    uses: [
      {
        id: "main",
        name: "Terrify",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [
          { kind: "markStress", to: "targets", when: ["hit"], amount: { kind: "dice", dice: dice(n(1), 4) } },
          {
            kind: "optional",
            id: "flee",
            label: "Make the target flee one range away from you",
            when: ["success"],
            steps: [{ kind: "move", to: "targets", when: ["hit"], mode: "flee", relativeTo: "self", note: "The target flees one range away from you." }],
          },
          { kind: "condition", to: "targets", when: ["hit", "withFear"], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" },
        ],
      },
    ],
  },

  // Summon Horror (L4): "Mark a Stress to summon an otherworldly creature that deals d8+1 magic damage using your
  // Spellcast trait to a target within Far range. If the target marks any Hit Points from this attack, they must succeed
  // on a Reaction Roll (12) to steel themselves against the horror or mark an equal number of Stress. After making the
  // attack, the creature dissipates."
  {
    cardId: "summon-horror",
    uses: [
      {
        id: "main",
        name: "Summon Horror",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(spellcast, 8, 1) }, type: "magic" },
          {
            kind: "save",
            to: "targets",
            when: ["targetMarkedHp"],
            difficulty: { kind: "fixed", value: 12 },
            onFail: [{ kind: "markStress", to: "targets", amount: { kind: "markedThisMove", who: "target", track: "hp" } }],
            onSuccess: [],
          },
        ],
      },
    ],
  },

  // Chains of Affliction (L4): "Mark 2 Stress to temporarily Chain a target within Close range. When a Chained creature
  // deals damage, the target of their attack marks one fewer Hit Point than they normally would. You can't have more
  // than one creature Chained at a time."
  {
    cardId: "chains-of-affliction",
    uses: [
      {
        id: "main",
        name: "Chains of Affliction",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(2) }],
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        exclusive: true,
        steps: [
          { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Chained" }, duration: "temporary" },
          {
            kind: "effect",
            to: "targets",
            label: "Chained: the target of their attack marks one fewer Hit Point",
            mods: [{ kind: "stat", stat: "hpMarked", delta: n(-1) }],
            duration: "temporary",
          },
        ],
      },
    ],
  },

  // Dire Strike (L5): "When a target marks any number of Hit Points from an attack you make, you can spend a Hope to
  // drain power from them. The GM loses a Fear."
  {
    cardId: "dire-strike",
    uses: [
      {
        id: "main",
        name: "Dire Strike",
        activation: { kind: "reaction", trigger: { kind: "whenTargetMarksHp" } },
        costs: [{ kind: "hope", amount: n(1) }],
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "fear", to: "self", change: "lose", amount: n(1), note: "You drain power from them: the GM loses a Fear." }],
      },
    ],
  },

  // Spectral Mist (L5): "Spend 2 Hope to conjure an eerie mist that turns you and allies of your choice within Close
  // range momentarily incorporeal. While a creature is incorporeal, they can move through solid objects and are immune to
  // physical damage. They become corporeal again after they pass through a solid object or make an action roll.
  // Otherwise, this effect lasts until the end of the scene."
  {
    cardId: "spectral-mist",
    uses: [
      {
        id: "main",
        name: "Spectral Mist",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(2) }],
        steps: [
          {
            kind: "effect",
            to: "selfAndAllies",
            pick: { side: "ally", range: "close", count: { kind: "any" } },
            label: "Incorporeal: moves through solid objects, immune to physical damage",
            mods: [{ kind: "resistance", type: "physical", level: "immune" }],
            duration: "nextRoll",
            endsWhen: "they pass through a solid object, or the scene ends",
          },
        ],
      },
    ],
  },

  // Darkfire (L6): "Spend any number of Hope to target an equal number of adversaries within Close range. Each target
  // makes a Reaction Roll (15). Targets who fail take d8+6 magic damage using your Spellcast trait as they are engulfed in
  // dark fire. Targets who succeed take half damage."
  {
    cardId: "darkfire",
    uses: [
      {
        id: "main",
        name: "Darkfire",
        activation: { kind: "action" },
        choices: [{ id: "hope", label: "Hope to spend (one target each)", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        targets: { side: "enemy", range: "close", count: { kind: "any", max: { kind: "chosen", choice: "hope" } } },
        steps: [
          {
            kind: "save",
            to: "targets",
            difficulty: { kind: "fixed", value: 15 },
            onFail: [darkfireDamage(false)],
            onSuccess: [darkfireDamage(true)],
          },
        ],
      },
    ],
  },

  // Jump Scare (L6): "When you deal magic damage to a target, you can mark a Stress to teleport into Melee range with
  // them. When you do, they are Vulnerable until they mark 1 or more Hit Points."
  {
    cardId: "jump-scare",
    uses: [
      {
        id: "main",
        name: "Jump Scare",
        activation: { kind: "reaction", trigger: { kind: "whenYouDealDamage", damageType: "magic" } },
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "move", to: "self", mode: "teleport", range: "melee", relativeTo: "target", note: "Teleport into Melee range with the target." },
          {
            kind: "condition",
            to: "targets",
            condition: { kind: "standard", condition: "vulnerable" },
            duration: "manual",
            endsWhen: "they mark 1 or more Hit Points",
          },
        ],
      },
    ],
  },

  // Dread-Touched (L7): "When 4 or more of the domain cards in your loadout are from the Dread domain, gain the following
  // benefits: • When you succeed with Fear, you can mark 2 Stress to prevent the GM from gaining a Fear. • Once per rest
  // when making an action roll, you can gain a bonus to the roll equal to the number of Fear in the GM's pool."
  {
    cardId: "dread-touched",
    uses: [
      {
        id: "prevent",
        name: "Dread-Touched: stop the GM's Fear",
        activation: { kind: "reaction", trigger: { kind: "gmWouldGainFear" } },
        // No trigger tells a success with Fear from a failure with Fear; the player confirms it.
        requires: [...dreadTouched, { kind: "situation", text: "You succeeded with Fear on this roll" }],
        costs: [{ kind: "stress", amount: n(2) }],
        steps: [{ kind: "negate", to: "self", what: "effect", note: "The GM doesn't gain the Fear from this roll." }],
      },
      {
        id: "bonus",
        name: "Dread-Touched: add the GM's Fear",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: dreadTouched,
        limit: { per: "rest" },
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: { kind: "gmFear" } } }],
      },
    ],
  },

  // Wall of Hunger (L7): "Make a Spellcast Roll (10). On a success, you can spend a Hope to create a visible wall of
  // writhing necrotic energy between two points within Far range. The wall lasts until you mark a Hit Point or cast this
  // spell again. A creature inside the wall when it appears or that passes through it must mark 2 Stress."
  {
    cardId: "wall-of-hunger",
    uses: [
      {
        id: "main",
        name: "Wall of Hunger",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 10 } },
        exclusive: true,
        steps: [
          {
            kind: "optional",
            id: "wall",
            label: "Spend a Hope to create the wall",
            when: ["success"],
            costs: [{ kind: "hope", amount: n(1) }],
            steps: [
              {
                kind: "effect",
                to: "self",
                label: "Wall of Hunger",
                mods: [],
                duration: "manual",
                endsWhen: "you mark a Hit Point or cast this spell again",
              },
              {
                kind: "markStress",
                to: "picked",
                pick: { side: "any", range: "far", count: { kind: "any" }, area: "line" },
                amount: n(2),
                note: "Every creature inside the wall when it appears marks 2 Stress.",
              },
              {
                kind: "manual",
                to: "self",
                text: "The wall stands between two points within Far range. A creature that passes through it must mark 2 Stress. The wall lasts until you mark a Hit Point or cast this spell again.",
              },
            ],
          },
        ],
      },
    ],
  },

  // Dark Army (L8): "Make a Spellcast Roll (14). Once per long rest on a success, you can summon fiends that surround and
  // move with you. Place 8 tokens on this card. When you deal damage to a target within Very Close range, you can spend
  // any number of tokens to add 1d8 for each token spent to your damage roll. Additionally, when you take damage, you can
  // spend any number of tokens to reduce the damage by 1d8 for each token spent. Each time you spend a token, a fiend acts
  // on your behalf, then disappears. When you take a rest, clear all unspent tokens."
  {
    cardId: "dark-army",
    uses: [
      {
        id: "main",
        name: "Dark Army",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 14 } },
        steps: [
          { kind: "tokens", to: "self", when: ["success"], op: "set", amount: n(8) },
          { kind: "effect", to: "self", when: ["success"], label: "Dark Army: fiends surround and move with you", mods: [], duration: "rest" },
        ],
      },
      {
        id: "strike",
        name: "Dark Army: fiends add to your damage",
        activation: { kind: "rider", trigger: { kind: "whenYouDealDamage" } },
        requires: [{ kind: "situation", text: "The target is within Very Close range" }],
        choices: [{ id: "tokens", label: "Tokens to spend", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            change: { kind: "add", amount: { kind: "dice", dice: dice({ kind: "spent", resource: "tokens" }, 8) } },
          },
        ],
      },
      {
        id: "guard",
        name: "Dark Army: fiends reduce your damage",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        choices: [{ id: "tokens", label: "Tokens to spend", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        steps: [{ kind: "reduceDamage", to: "self", amount: { kind: "dice", dice: dice({ kind: "spent", resource: "tokens" }, 8) } }],
      },
      {
        id: "rest",
        name: "Dark Army: clear tokens on a rest",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterRest" } },
        steps: [{ kind: "tokens", to: "self", op: "clear" }],
      },
    ],
  },

  // Eldritch Flesh (L8): "Gain a +1 bonus to your damage thresholds for each Stress you have marked. Additionally, when
  // you roll with Fear, you can spend 2 Hope to clear an Armor Slot."
  {
    cardId: "eldritch-flesh",
    uses: [
      {
        id: "armor",
        name: "Eldritch Flesh: clear an Armor Slot",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "withFear" } },
        costs: [{ kind: "hope", amount: n(2) }],
        steps: [{ kind: "clear", to: "self", track: "armor", amount: n(1) }],
      },
      {
        id: "passive",
        name: "Eldritch Flesh: thresholds",
        activation: { kind: "passive" },
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: { kind: "marked", who: "self", track: "stress" } },
          { kind: "stat", stat: "severeThreshold", delta: { kind: "marked", who: "self", track: "stress" } },
        ],
        steps: [],
      },
    ],
  },

  // Damnation (L9): "Make a Spellcast Roll against a target within Far range. On a success, mark any number of Stress to
  // roll an equal number of d20s, dealing magic damage equal to the total result. If this attack defeats the target, all
  // adversaries within Far range of the target must mark a Stress."
  {
    cardId: "damnation",
    uses: [
      {
        id: "main",
        name: "Damnation",
        activation: { kind: "action" },
        choices: [{ id: "stress", label: "Stress to mark (one d20 each)", min: 1 }],
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "stress", amount: { kind: "chosen", choice: "stress" } }] },
          {
            kind: "damage",
            to: "targets",
            when: ["hit"],
            roll: { kind: "dice", dice: dice({ kind: "chosen", choice: "stress" }, 20) },
            type: "magic",
          },
          {
            kind: "markStress",
            to: "picked",
            when: ["targetDefeated"],
            pick: { side: "enemy", range: "far", count: { kind: "all" }, area: "aroundTarget", areaRange: "far" },
            amount: n(1),
            note: "The attack defeated the target: all adversaries within Far range of it mark a Stress.",
          },
        ],
      },
    ],
  },

  // Savor the Anguish (L9): "When an adversary within Close range takes Severe damage, you can clear a Stress."
  {
    cardId: "savor-the-anguish",
    uses: [
      {
        id: "main",
        name: "Savor the Anguish",
        activation: { kind: "auto", trigger: { kind: "whenEnemyTakesDamage", range: "close", severity: "severe" } },
        steps: [{ kind: "clear", to: "self", track: "stress", amount: n(1) }],
      },
    ],
  },

  // Avatar of Terror (L10): "Mark a Stress to transform into a creature fueled by fear. While in this form, you gain a
  // 1d6 bonus to your damage rolls for each Fear in the GM's pool. Additionally, you gain a Hope when the GM spends a Fear
  // to spotlight an adversary within Very Close range. Before you make an action roll, you must spend a Hope. If you
  // can't, you revert to your normal form."
  {
    cardId: "avatar-of-terror",
    uses: [
      {
        id: "main",
        name: "Avatar of Terror",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        exclusive: true,
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Avatar of Terror: a creature fueled by fear",
            mods: [],
            duration: "manual",
            endsWhen: "you can't spend a Hope before an action roll",
          },
        ],
      },
      {
        id: "damage",
        name: "Avatar of Terror: 1d6 per Fear",
        activation: { kind: "auto", trigger: { kind: "whenYouDealDamage" } },
        requires: [{ kind: "effectActive", cardId: "avatar-of-terror" }],
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            change: { kind: "add", amount: { kind: "dice", dice: dice({ kind: "gmFear" }, 6) } },
          },
        ],
      },
      {
        id: "spotlight",
        name: "Avatar of Terror: Hope from the GM's spotlight",
        activation: { kind: "auto", trigger: { kind: "gmSpendsFear", purpose: "spotlight", range: "veryClose" } },
        requires: [{ kind: "effectActive", cardId: "avatar-of-terror" }],
        steps: [{ kind: "hope", to: "self", change: "gain", amount: n(1) }],
      },
      {
        id: "upkeep",
        name: "Avatar of Terror: a Hope before each action roll",
        activation: { kind: "auto", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [{ kind: "effectActive", cardId: "avatar-of-terror" }],
        steps: [
          {
            kind: "manual",
            to: "self",
            when: [{ kind: "requires", requirement: { kind: "hopeAtMost", value: 0 } }],
            text: "You can't spend a Hope: you revert to your normal form (end Avatar of Terror).",
          },
          { kind: "pay", costs: [{ kind: "hope", amount: n(1) }], note: "Before you make an action roll, you must spend a Hope." },
        ],
      },
    ],
  },

  // Invoke Torment (L10): "You deal double damage to targets that have all their Stress marked. Additionally, when an
  // adversary within Close range is defeated with all its Stress marked, you gain a Hope."
  {
    cardId: "invoke-torment",
    uses: [
      {
        id: "double",
        name: "Invoke Torment: double damage",
        activation: { kind: "auto", trigger: { kind: "whenYouDealDamage" } },
        steps: [{ kind: "modifyDamage", to: "targets", when: ["targetStressFull"], change: { kind: "multiply", factor: 2 } }],
      },
      {
        id: "hope",
        name: "Invoke Torment: a Hope from a tormented defeat",
        activation: { kind: "auto", trigger: { kind: "whenEnemyDefeated", byYou: false, range: "close", fullStress: true } },
        steps: [{ kind: "hope", to: "self", change: "gain", amount: n(1) }],
      },
    ],
  },
];
