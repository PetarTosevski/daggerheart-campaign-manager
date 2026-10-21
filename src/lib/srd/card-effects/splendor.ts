// Card effects of the Splendor domain (plan combat-actions, tracer CE-splendor). Pure data: no framework imports,
// relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (20 of the 21 Splendor cards; Divination is out
// of combat). Each entry quotes its card text (CB p.340-341, Domain Card Reference); what the vocabulary
// (src/lib/domain/card-effects/types.ts) cannot express is a `manual` step with the card's words, never a vocabulary
// change. Readings and every manual step: docs/tasks/TASK-CA-CE-splendor.md.

import type { CardEffect, ConditionRef, DiceExpr, NumberSource, Step, TargetSpec } from "../../domain/card-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: NumberSource, sides: DiceExpr["sides"], plus?: number): DiceExpr =>
  plus === undefined ? { count, sides } : { count, sides, plus: n(plus) };

/** "clear N Hit Points or N Stress" on `to`: a choose step (Q9: choices in a dialog). */
const hpOrStress = (id: string, amount: number, to: "targets" | "self" | "picked", when?: Step["when"]): Step => ({
  kind: "choose",
  id,
  label: amount === 1 ? "Clear a Hit Point or a Stress" : `Clear ${amount} Hit Points or ${amount} Stress`,
  ...(when ? { when } : {}),
  options: [
    { id: "hp", label: amount === 1 ? "A Hit Point" : `${amount} Hit Points`, steps: [{ kind: "clear", to, track: "hp", amount: n(amount) }] },
    { id: "stress", label: amount === 1 ? "A Stress" : `${amount} Stress`, steps: [{ kind: "clear", to, track: "stress", amount: n(amount) }] },
  ],
});

/** Second Wind: "clear 3 Stress or a Hit Point". */
const stressOrHp = (id: string, to: "self" | "picked", when?: Step["when"], pick?: TargetSpec): Step => ({
  kind: "choose",
  id,
  label: "Clear 3 Stress or a Hit Point",
  ...(when ? { when } : {}),
  options: [
    { id: "stress", label: "3 Stress", steps: [{ kind: "clear", to, ...(pick ? { pick } : {}), track: "stress", amount: n(3) }] },
    { id: "hp", label: "A Hit Point", steps: [{ kind: "clear", to, ...(pick ? { pick } : {}), track: "hp", amount: n(1) }] },
  ],
});

/** Second Wind's ally: "an ally within Close range of you". */
const ALLY_IN_CLOSE: TargetSpec = { side: "ally", range: "close", count: { kind: "one" }, excludeSelf: true };
const SUCCESS_WITH_HOPE = "The attack succeeded with Hope";

const LIFE_WARD: ConditionRef = { kind: "tag", tag: "Life Ward" };
const SHIELD_AURA: ConditionRef = { kind: "tag", tag: "Shield Aura" };
const STUNNED: ConditionRef = { kind: "tag", tag: "Stunned" };
const SPLENDOR_TOUCHED = { kind: "loadoutDomainCount", domain: "splendor", min: 4 } as const;

export const SPLENDOR_EFFECTS: readonly CardEffect[] = [
  // Bolt Beacon (L1): "Make a Spellcast Roll against a target within Far range. On a success, spend a Hope to send a bolt
  // of shimmering light toward them, dealing d8+2 magic damage using your Proficiency. The target becomes temporarily
  // Vulnerable and glows brightly until this condition is cleared."
  {
    cardId: "bolt-beacon",
    uses: [
      {
        id: "main",
        name: "Bolt Beacon",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: n(1) }], note: "On a success, spend a Hope (the roll's own Hope may pay, CB p.90)." },
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice({ kind: "proficiency" }, 8, 2) }, type: "magic" },
          { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary", note: "Glows brightly until Vulnerable is cleared." },
        ],
      },
    ],
  },

  // Mending Touch (L1): "You lay your hands upon a creature and channel healing magic to close their wounds. When you can
  // take a few minutes to focus on the target you're helping, you can spend 2 Hope to clear a Hit Point or a Stress on
  // them. Once per long rest, when you spend this healing time learning something new about them or revealing something
  // about yourself, you can clear 2 Hit Points or 2 Stress on them instead."
  {
    cardId: "mending-touch",
    uses: [
      {
        id: "main",
        name: "Mending Touch",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: "You can take a few minutes to focus on the target" }],
        costs: [{ kind: "hope", amount: n(2) }],
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        steps: [hpOrStress("heal", 1, "targets")],
      },
      {
        id: "bond",
        name: "Mending Touch (learning something new)",
        activation: { kind: "action" },
        requires: [
          { kind: "situation", text: "You can take a few minutes to focus on the target" },
          { kind: "situation", text: "You spend the healing time learning something new about them or revealing something about yourself" },
        ],
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: n(2) }],
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        steps: [hpOrStress("heal", 2, "targets")],
      },
    ],
  },

  // Reassurance (L1): "Once per rest, after an ally attempts an action roll but before the consequences take place, you
  // can offer assistance or words of support. When you do, your ally can reroll their dice."
  {
    cardId: "reassurance",
    uses: [
      {
        id: "main",
        name: "Reassurance",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", result: "any" } },
        limit: { per: "rest" },
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "reroll", dice: "all" } }],
      },
    ],
  },

  // Final Words (L2): "You can infuse a corpse with a moment of life to speak with it. Make a Spellcast Roll (13). On a
  // success with Hope, the corpse answers up to three questions. On a success with Fear, the corpse answers one question.
  // The corpse answers truthfully, but it can't impart information it didn't know in life. On a failure, or once the
  // corpse has finished answering your questions, the body turns to dust."
  {
    cardId: "final-words",
    uses: [
      {
        id: "main",
        name: "Final Words",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 } },
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success", "withHope"],
            text: "The corpse answers up to three questions, truthfully, but it can't impart information it didn't know in life. Then the body turns to dust.",
          },
          {
            kind: "manual",
            to: "self",
            when: ["success", "withFear"],
            text: "The corpse answers one question, truthfully, but it can't impart information it didn't know in life. Then the body turns to dust.",
          },
          { kind: "manual", to: "self", when: ["failure"], text: "The body turns to dust." },
        ],
      },
    ],
  },

  // Healing Hands (L2): "Make a Spellcast Roll (13) and target a creature other than yourself within Melee range. On a
  // success, mark a Stress to clear 2 Hit Points or 2 Stress on the target. On a failure, mark a Stress to clear a Hit
  // Point or a Stress on the target. You can't heal the same target again until your next long rest."
  {
    cardId: "healing-hands",
    uses: [
      {
        id: "main",
        name: "Healing Hands",
        activation: { kind: "action" },
        limit: { per: "longRest", perTarget: true },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 } },
        targets: { side: "any", range: "melee", count: { kind: "one" }, excludeSelf: true },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "stress", amount: n(1) }] },
          hpOrStress("heal", 2, "targets", ["success"]),
          { kind: "pay", when: ["failure"], costs: [{ kind: "stress", amount: n(1) }] },
          hpOrStress("heal-failure", 1, "targets", ["failure"]),
        ],
      },
    ],
  },

  // Second Wind (L3): "Once per rest, when you succeed on an attack against an adversary, you can clear 3 Stress or a Hit
  // Point. On a success with Hope, you also clear 3 Stress or a Hit Point on an ally within Close range of you."
  {
    cardId: "second-wind",
    uses: [
      {
        id: "main",
        name: "Second Wind",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        limit: { per: "rest" },
        steps: [
          stressOrHp("self", "self"),
          // A rider has no roll of its own, so "with Hope" is the host roll's result, confirmed as a situation (gap dcm-jx6).
          stressOrHp("ally", "picked", [{ kind: "requires", requirement: { kind: "situation", text: SUCCESS_WITH_HOPE } }], ALLY_IN_CLOSE),
        ],
      },
    ],
  },

  // Voice of Reason (L3): "You speak with an unmatched power and authority. You have advantage on action rolls to
  // de-escalate violent situations or convince someone to follow your lead. Additionally, you're emboldened in moments
  // of duress. When all of your Stress slots are marked, you gain a +1 bonus to your Proficiency for damage rolls."
  {
    cardId: "voice-of-reason",
    uses: [
      {
        id: "main",
        name: "Voice of Reason: emboldened",
        activation: { kind: "passive" },
        requires: [{ kind: "stressFull" }],
        mods: [{ kind: "stat", stat: "proficiency", delta: n(1) }],
        steps: [],
      },
      {
        id: "authority",
        name: "Voice of Reason: authority",
        activation: { kind: "passive" },
        requires: [{ kind: "situation", text: "The action roll is to de-escalate a violent situation or convince someone to follow your lead" }],
        mods: [{ kind: "advantage", on: "action" }],
        steps: [],
      },
    ],
  },

  // Life Ward (L4): "Spend 3 Hope and choose an ally within Close range. They are marked with a glowing sigil of
  // protection. When this ally would make a death move, they clear a Hit Point instead. This effect ends when it saves
  // the target from a death move, you cast Life Ward on another target, or you take a long rest."
  {
    cardId: "life-ward",
    uses: [
      {
        id: "main",
        name: "Life Ward",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(3) }],
        targets: { side: "ally", range: "close", count: { kind: "one" }, excludeSelf: true },
        exclusive: true,
        steps: [
          {
            kind: "condition",
            to: "targets",
            condition: LIFE_WARD,
            duration: "longRest",
            endsWhen: "It saves them from a death move, or you cast Life Ward on another target.",
          },
        ],
      },
      {
        id: "save",
        name: "Life Ward: saved from a death move",
        activation: { kind: "auto", trigger: { kind: "wouldMakeDeathMove", who: "ally" } },
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "negate", to: "triggerSubject", when: [{ kind: "targetHas", condition: LIFE_WARD }], what: "deathMove" },
          { kind: "clear", to: "triggerSubject", when: [{ kind: "targetHas", condition: LIFE_WARD }], track: "hp", amount: n(1) },
          { kind: "clearCondition", to: "triggerSubject", when: [{ kind: "targetHas", condition: LIFE_WARD }], condition: LIFE_WARD },
        ],
      },
    ],
  },

  // Shape Material (L5): "Spend a Hope to shape a section of natural material you're touching (such as stone, ice, or
  // wood) to suit your purpose. The area of the material can be no larger than you. For example, you can form a
  // rudimentary tool or create a door. You can only affect the material within Close range of where you're touching it."
  {
    cardId: "shape-material",
    uses: [
      {
        id: "main",
        name: "Shape Material",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        targets: { side: "object", range: "melee", count: { kind: "one" } },
        steps: [
          {
            kind: "manual",
            to: "self",
            text: "Shape a section of natural material you're touching (stone, ice, wood), no larger than you and within Close range of where you touch it: a rudimentary tool, a door.",
          },
        ],
      },
    ],
  },

  // Smite (L5): "Once per rest, spend 3 Hope to charge your powerful smite. When you next successfully attack with a
  // weapon, double the result of your damage roll. This attack deals magic damage regardless of the weapon's damage type."
  {
    cardId: "smite",
    uses: [
      {
        id: "main",
        name: "Smite: charge",
        activation: { kind: "action" },
        limit: { per: "rest" },
        costs: [{ kind: "hope", amount: n(3) }],
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Smite charged: your next successful weapon attack deals double magic damage",
            mods: [],
            duration: "manual",
            endsWhen: "You next successfully attack with a weapon.",
          },
        ],
      },
      {
        id: "strike",
        name: "Smite: strike",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        requires: [{ kind: "effectActive", cardId: "smite" }],
        steps: [
          { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "multiply", factor: 2 } },
          { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "type", type: "magic" } },
          // No step ends a card's own sheet effect (gap dcm-8x8).
          { kind: "manual", to: "self", text: "Smite is spent: end its charge (Smite charged) on your sheet." },
        ],
      },
    ],
  },

  // Restoration (L6): "After a long rest, place a number of tokens equal to your Spellcast trait on this card. Touch a
  // creature and spend any number of tokens to clear 2 Hit Points or 2 Stress for each token spent. You can also spend a
  // token from this card when touching a creature to clear the Vulnerable condition or heal a physical or magical ailment
  // (the GM might require additional tokens depending on the strength of the ailment). When you take a long rest, clear
  // all unspent tokens."
  {
    cardId: "restoration",
    uses: [
      {
        id: "main",
        name: "Restoration",
        activation: { kind: "action" },
        choices: [{ id: "tokens", label: "Tokens to spend", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        steps: [
          {
            kind: "choose",
            id: "heal",
            label: "For each token: clear 2 Hit Points or 2 Stress",
            count: { kind: "spent", resource: "tokens" },
            options: [
              { id: "hp", label: "2 Hit Points", steps: [{ kind: "clear", to: "targets", track: "hp", amount: n(2) }] },
              { id: "stress", label: "2 Stress", steps: [{ kind: "clear", to: "targets", track: "stress", amount: n(2) }] },
            ],
          },
        ],
      },
      {
        id: "cure",
        name: "Restoration: cure",
        activation: { kind: "action" },
        costs: [{ kind: "tokens", amount: n(1) }],
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        steps: [
          {
            kind: "choose",
            id: "cure",
            label: "Clear Vulnerable or heal an ailment",
            options: [
              { id: "vulnerable", label: "Clear Vulnerable", steps: [{ kind: "clearCondition", to: "targets", condition: { kind: "standard", condition: "vulnerable" } }] },
              {
                id: "ailment",
                label: "Heal a physical or magical ailment",
                steps: [
                  {
                    kind: "manual",
                    to: "targets",
                    text: "Heal a physical or magical ailment. The GM might require additional tokens depending on the strength of the ailment.",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "long-rest",
        name: "Restoration: tokens after a long rest",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } },
        steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "spellcast" }, note: "Unspent tokens are cleared; then place tokens equal to your Spellcast trait." }],
      },
    ],
  },

  // Zone of Protection (L6): "Make a Spellcast Roll (16). Once per long rest on a success, choose a point within Far range
  // and create a visible zone of protection there for all allies within Very Close range of that point. When you do,
  // place a d6 on this card with the 1 value facing up. When an ally in this zone takes damage, they reduce it by the
  // die's value. You then increase the die's value by one. When the die's value would exceed 6, this effect ends."
  {
    cardId: "zone-of-protection",
    uses: [
      {
        id: "main",
        name: "Zone of Protection",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 16 } },
        targets: { side: "selfOrAlly", range: "far", count: { kind: "all" }, area: "aroundPoint", areaRange: "veryClose" },
        steps: [
          { kind: "tokens", to: "self", when: ["success"], op: "set", amount: n(1), die: 6, note: "Place a d6 on this card with the 1 facing up." },
          {
            kind: "effect",
            to: "targets",
            when: ["success"],
            label: "Zone of Protection: reduce damage taken by the zone's die",
            mods: [],
            duration: "manual",
            endsWhen: "The zone's die would exceed 6.",
          },
        ],
      },
      {
        id: "reduce",
        name: "Zone of Protection: reduce damage",
        activation: { kind: "auto", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryFar", includeSelf: true } },
        requires: [{ kind: "situation", text: "The creature taking damage is inside your zone of protection" }],
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "reduceDamage", to: "triggerSubject", amount: { kind: "cardTokens" } },
          { kind: "tokens", to: "self", op: "add", amount: n(1), die: 6, note: "Increase the die's value by one." },
          // No gate on card tokens (gap dcm-7n7); the zone itself is not on the map (gap dcm-cma).
          {
            kind: "manual",
            to: "self",
            text: "If the die's value would now exceed 6 (it shows 7), the zone of protection ends: clear the die and end the zone.",
          },
        ],
      },
    ],
  },

  // Healing Strike (L7): "When you deal damage to an adversary, you can spend 2 Hope to clear a Hit Point on an ally
  // within Close range."
  {
    cardId: "healing-strike",
    uses: [
      {
        id: "main",
        name: "Healing Strike",
        activation: { kind: "reaction", trigger: { kind: "whenYouDealDamage", toEnemy: true } },
        costs: [{ kind: "hope", amount: n(2) }],
        steps: [{ kind: "clear", to: "picked", pick: { side: "ally", range: "close", count: { kind: "one" }, excludeSelf: true }, track: "hp", amount: n(1) }],
      },
    ],
  },

  // Splendor-Touched (L7): "When 4 or more of the domain cards in your loadout are from the Splendor domain, gain the
  // following benefits: • +3 bonus to your Severe damage threshold • Once per long rest, when incoming damage would
  // require you to mark a number of Hit Points, you can choose to mark that much Stress or spend that much Hope instead."
  {
    cardId: "splendor-touched",
    uses: [
      {
        id: "main",
        name: "Splendor-Touched: Severe threshold",
        activation: { kind: "passive" },
        requires: [SPLENDOR_TOUCHED],
        mods: [{ kind: "stat", stat: "severeThreshold", delta: n(3) }],
        steps: [],
      },
      {
        id: "convert",
        name: "Splendor-Touched: Stress or Hope instead of Hit Points",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        requires: [SPLENDOR_TOUCHED],
        limit: { per: "longRest" },
        steps: [
          {
            kind: "choose",
            id: "into",
            label: "Mark that much Stress or spend that much Hope instead",
            options: [
              { id: "stress", label: "Mark Stress instead", steps: [{ kind: "convertMarks", to: "self", from: "hp", into: "stress" }] },
              { id: "hope", label: "Spend Hope instead", steps: [{ kind: "convertMarks", to: "self", from: "hp", into: "hope" }] },
            ],
          },
        ],
      },
    ],
  },

  // Shield Aura (L8): "Mark a Stress to cast a protective aura on a target within Very Close range. When the target marks
  // an Armor Slot, they reduce the severity of the attack by an additional threshold. If this spell causes a creature who
  // would be damaged to instead mark no Hit Points, the effect ends. You can only hold Shield Aura on one creature at a
  // time."
  {
    cardId: "shield-aura",
    uses: [
      {
        id: "main",
        name: "Shield Aura",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "selfOrAlly", range: "veryClose", count: { kind: "one" } },
        exclusive: true,
        steps: [
          {
            kind: "condition",
            to: "targets",
            condition: SHIELD_AURA,
            duration: "manual",
            endsWhen: "The aura makes them mark no Hit Points from damage, or you cast Shield Aura on another creature.",
          },
        ],
      },
      {
        id: "aura-ally",
        name: "Shield Aura: an ally marks an Armor Slot",
        activation: { kind: "auto", trigger: { kind: "whenArmorSlotMarked", who: "ally" } },
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "reduceSeverity", to: "triggerSubject", when: [{ kind: "targetHas", condition: SHIELD_AURA }], steps: 1 },
          // No gate on the damage result after Armor Slots (gap dcm-sim).
          {
            kind: "manual",
            to: "triggerSubject",
            when: [{ kind: "targetHas", condition: SHIELD_AURA }],
            text: "If the aura made them mark no Hit Points, Shield Aura ends: clear its tag.",
          },
        ],
      },
      {
        id: "aura-self",
        name: "Shield Aura: you mark an Armor Slot",
        activation: { kind: "auto", trigger: { kind: "whenArmorSlotMarked", who: "self" } },
        // No requirement on a tag the actor carries (gap dcm-qdm): the player confirms it.
        requires: [{ kind: "situation", text: "You hold your own Shield Aura" }],
        steps: [
          { kind: "reduceSeverity", to: "self", steps: 1 },
          { kind: "manual", to: "self", text: "If the aura made you mark no Hit Points, Shield Aura ends: clear its tag." },
        ],
      },
    ],
  },

  // Stunning Sunlight (L8): "Make a Spellcast Roll to unleash powerful rays of burning sunlight against all adversaries
  // in front of you within Far range. On a success, spend any number of Hope and force that many targets you succeeded
  // against to make a Reaction Roll (14). Targets who succeed take 3d20+3 magic damage. Targets who fail take 4d20+5 magic
  // damage and are temporarily Stunned. While Stunned, they can't use reactions and can't take any other actions until
  // they clear this condition."
  {
    cardId: "stunning-sunlight",
    uses: [
      {
        id: "main",
        name: "Stunning Sunlight",
        activation: { kind: "action" },
        choices: [{ id: "hope", label: "Hope to spend (one target per Hope)", min: 1 }],
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "front" },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }] },
          // The picked targets must be ones the roll hit; the pick can't say so (gap dcm-y45), CA4 offers only hit targets.
          {
            kind: "save",
            to: "picked",
            when: ["success"],
            pick: { side: "enemy", range: "far", count: { kind: "any", max: { kind: "chosen", choice: "hope" } } },
            difficulty: { kind: "fixed", value: 14 },
            onSuccess: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(n(3), 20, 3) }, type: "magic" }],
            onFail: [
              { kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(n(4), 20, 5) }, type: "magic" },
              {
                kind: "condition",
                to: "targets",
                condition: STUNNED,
                duration: "temporary",
                note: "While Stunned, they can't use reactions and can't take any other actions until they clear this condition.",
              },
              { kind: "effect", to: "targets", label: "Stunned", mods: [{ kind: "flag", flag: "cannotReact" }, { kind: "flag", flag: "cannotAct" }], duration: "temporary" },
            ],
          },
        ],
      },
    ],
  },

  // Overwhelming Aura (L9): "Make a Spellcast Roll (15) to magically empower your aura. On a success, spend 2 Hope to make
  // your Presence equal to your Spellcast trait until your next long rest. While this spell is active, an adversary must
  // mark a Stress when they target you with an attack."
  {
    cardId: "overwhelming-aura",
    uses: [
      {
        id: "main",
        name: "Overwhelming Aura",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 15 } },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: n(2) }] },
          {
            kind: "effect",
            to: "self",
            when: ["success"],
            label: "Overwhelming Aura: Presence equals your Spellcast trait; attackers mark a Stress",
            mods: [{ kind: "set", stat: "presence", to: { kind: "spellcast" } }],
            duration: "longRest",
          },
        ],
      },
      {
        id: "attacked",
        name: "Overwhelming Aura: an adversary targets you",
        activation: { kind: "auto", trigger: { kind: "whenAttacked", stage: "targeted" } },
        requires: [{ kind: "effectActive", cardId: "overwhelming-aura" }],
        targets: { side: "trigger", who: "source" },
        steps: [{ kind: "markStress", to: "triggerSource", amount: n(1) }],
      },
    ],
  },

  // Salvation Beam (L9): "Make a Spellcast Roll (16). On a success, mark any number of Stress to target a line of allies
  // within Far range. You can clear Hit Points on the targets equal to the number of Stress marked, divided among them
  // however you'd like."
  {
    cardId: "salvation-beam",
    uses: [
      {
        id: "main",
        name: "Salvation Beam",
        activation: { kind: "action" },
        choices: [{ id: "stress", label: "Stress to mark", min: 1 }],
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 16 } },
        targets: { side: "ally", range: "far", count: { kind: "any" }, area: "line", excludeSelf: true },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "stress", amount: { kind: "chosen", choice: "stress" } }] },
          { kind: "clear", to: "targets", when: ["success"], track: "hp", amount: { kind: "spent", resource: "stress" }, distribution: "split" },
        ],
      },
    ],
  },

  // Invigoration (L10): "When you or an ally within Close range has used a feature that has an exhaustion limit (such as
  // once per rest or once per session), you can spend any number of Hope and roll that many d6s. If any roll a 6, the
  // feature can be used again."
  {
    cardId: "invigoration",
    uses: [
      {
        id: "main",
        name: "Invigoration",
        activation: { kind: "reaction", trigger: { kind: "featureExhausted", range: "close" } },
        choices: [{ id: "hope", label: "Hope to spend (one d6 each)", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        targets: { side: "trigger", who: "subject" },
        steps: [
          {
            kind: "check",
            dice: dice({ kind: "spent", resource: "hope" }, 6),
            test: { kind: "anyAtLeast", value: 6 },
            then: [{ kind: "refreshFeature", to: "triggerSubject" }],
            otherwise: [],
          },
        ],
      },
    ],
  },

  // Resurrection (L10): "Make a Spellcast Roll (20). On a success, restore one creature who has been dead no longer than
  // 100 years to full strength. Then roll a d6. On a result of 5 or lower, place this card in your vault permanently. On a
  // failure, you can't cast Resurrection again for a week."
  {
    cardId: "resurrection",
    uses: [
      {
        id: "main",
        name: "Resurrection",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 20 } },
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "Restore one creature who has been dead no longer than 100 years to full strength.",
          },
          {
            kind: "check",
            when: ["success"],
            dice: dice(n(1), 6),
            test: { kind: "totalAtMost", value: 5 },
            then: [{ kind: "toVault", to: "self", permanent: true }],
            otherwise: [],
          },
          // No limit longer than a long rest (gap dcm-aym).
          { kind: "manual", to: "self", when: ["failure"], text: "You can't cast Resurrection again for a week." },
        ],
      },
    ],
  },
];
