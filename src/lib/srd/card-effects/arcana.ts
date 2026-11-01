// Card effects of the Arcana domain (plan combat-actions, tracer CE-arcana). Pure data: no framework imports, relative
// imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (all 21 Arcana cards). Each entry quotes its
// card text (CB p.328-329, Domain Card Reference); what the vocabulary (src/lib/domain/card-effects/types.ts) cannot
// express is a `manual` step with the card's words, never a vocabulary change. Readings and every manual step:
// docs/tasks/TASK-CA-CE-arcana.md.

import type { CardEffect, DiceExpr, NumberSource, Step } from "../../domain/card-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: NumberSource, sides: DiceExpr["sides"], plus?: number): DiceExpr =>
  plus === undefined ? { count, sides } : { count, sides, plus: n(plus) };

/**
 * Rune Ward: the Ward Die (1d8) reduces the holder's damage; on an 8 the ward's power ends until your next rest.
 * Lanes SRD-C1 (dcm-war): an 8 spends both uses of the ward (one ward, whoever holds it) until your next rest.
 */
const WARD_ENDS = "The Ward Die rolled 8: the ward's power ends after it reduces damage this turn. It can be recharged for free on your next rest.";
const runeWard = (holder: "self" | "triggerSubject"): Step[] => [
  {
    kind: "check",
    dice: dice(n(1), 8),
    test: { kind: "totalAtLeast", value: 8 },
    then: [
      { kind: "reduceDamage", to: holder, amount: { kind: "lastRoll" } },
      { kind: "exhaust", to: "self", per: "rest", useId: "main", note: WARD_ENDS },
      { kind: "exhaust", to: "self", per: "rest", useId: "ally", note: "The ward is spent whoever holds it." },
    ],
    otherwise: [{ kind: "reduceDamage", to: holder, amount: { kind: "lastRoll" } }],
  },
];

export const ARCANA_EFFECTS: readonly CardEffect[] = [
  // Rune Ward (L1): "You have a deeply personal trinket that can be infused with protective magic and held as a ward by
  // you or an ally. Describe what it is and why it's important to you. The ward's holder can spend a Hope to reduce
  // incoming damage by 1d8. If the Ward Die result is 8, the ward's power ends after it reduces damage this turn. It can
  // be recharged for free on your next rest."
  {
    cardId: "rune-ward",
    uses: [
      {
        id: "main",
        name: "Rune Ward (you hold it)",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        costs: [{ kind: "hope", amount: n(1) }],
        steps: runeWard("self"),
      },
      {
        // The holder is an ally: the ally spends their own Hope. Lanes-2 S1 (dcm-uj0, dcm-a9c): the use's cost is paid
        // by the trigger's subject (`paidBy`; run.ts charges them and refuses when their known Hope is short). Lanes-2
        // S1.4: cardRunner passes the holder's Hope (`hopeOf`, dcm-q40t), so the reminder is gone. Lanes SRD-C1
        // (dcm-uj0): the ward works at any range (`unlimited`); `range` stays for a reader that doesn't know it (dcm-ofo).
        id: "ally",
        name: "Rune Ward (an ally holds it)",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryFar", unlimited: true } },
        targets: { side: "trigger", who: "subject" },
        costs: [{ kind: "hope", amount: n(1) }],
        paidBy: "triggerSubject",
        steps: runeWard("triggerSubject"),
      },
    ],
  },

  // Unleash Chaos (L1): "At the beginning of a session, place a number of tokens equal to your Spellcast trait on this
  // card. Make a Spellcast Roll against a target within Far range and spend any number of tokens to channel raw energy
  // from within yourself to unleash against them. On a success, roll a number of d10s equal to the tokens you spent and
  // deal that much magic damage to the target. Mark a Stress to replenish this card with tokens (up to your Spellcast
  // trait). At the end of each session, clear all unspent tokens."
  {
    cardId: "unleash-chaos",
    uses: [
      {
        id: "main",
        name: "Unleash Chaos",
        activation: { kind: "action" },
        choices: [{ id: "tokens", label: "Tokens to spend", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice({ kind: "spent", resource: "tokens" }, 10) }, type: "magic" },
        ],
      },
      {
        id: "replenish",
        name: "Replenish Unleash Chaos",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "spellcast" }, max: { kind: "spellcast" } }],
      },
      {
        id: "session-start",
        name: "Unleash Chaos: tokens at the start of a session",
        activation: { kind: "auto", trigger: { kind: "timing", at: "sessionStart" } },
        steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "spellcast" } }],
      },
      {
        id: "session-end",
        name: "Unleash Chaos: clear tokens at the end of a session",
        activation: { kind: "auto", trigger: { kind: "timing", at: "sessionEnd" } },
        steps: [{ kind: "tokens", to: "self", op: "clear" }],
      },
    ],
  },

  // Wall Walk (L1): "Spend a Hope to allow a creature you can touch to climb on walls and ceilings as easily as walking
  // on the ground. This lasts until the end of the scene or you cast Wall Walk again."
  {
    cardId: "wall-walk",
    uses: [
      {
        id: "main",
        name: "Wall Walk",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        targets: { side: "any", range: "melee", count: { kind: "one" } },
        exclusive: true,
        steps: [
          { kind: "effect", to: "targets", label: "Wall Walk: climbs walls and ceilings as easily as walking", mods: [], duration: "scene" },
        ],
      },
    ],
  },

  // Cinder Grasp (L2): "Make a Spellcast Roll against a target within Melee range. On a success, the target instantly
  // bursts into flames, takes 1d20+3 magic damage, and is temporarily lit On Fire. When a creature acts while On Fire,
  // they must take an extra 2d6 magic damage if they are still On Fire at the end of their action."
  {
    cardId: "cinder-grasp",
    uses: [
      {
        id: "main",
        name: "Cinder Grasp",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice(n(1), 20, 3) }, type: "magic" },
          {
            kind: "condition",
            to: "targets",
            when: ["hit"],
            condition: { kind: "tag", tag: "On Fire" },
            duration: "temporary",
            // Lanes SRD-C1 (dcm-f0m): each time the bearer acts, after the action (only while still On Fire: the rider
            // goes with the condition), the bearer (`self` in a rider) takes 2d6 magic damage.
            mods: [
              {
                kind: "bearerRider",
                rider: {
                  on: "acts",
                  timing: "after",
                  steps: [
                    {
                      kind: "damage",
                      to: "self",
                      roll: { kind: "dice", dice: dice(n(2), 6) },
                      type: "magic",
                      note: "When a creature acts while On Fire, they must take an extra 2d6 magic damage if they are still On Fire at the end of their action.",
                    },
                  ],
                },
              },
            ],
          },
          // Kept until bearer riders run on the server (dcm-0wj1): nothing else tells the table about the 2d6 today.
          {
            kind: "manual",
            to: "targets",
            when: ["hit"],
            text: "When a creature acts while On Fire, they must take an extra 2d6 magic damage if they are still On Fire at the end of their action.",
          },
        ],
      },
    ],
  },

  // Floating Eye (L2): "Spend a Hope to create a single, small floating orb that you can move anywhere within Very Far
  // range. While this spell is active, you can see through the orb as though you're looking out from its position. You
  // can transition between using your own senses and seeing through the orb freely. If the orb takes damage or moves out
  // of range, the spell ends."
  {
    cardId: "floating-eye",
    uses: [
      {
        id: "main",
        name: "Floating Eye",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        exclusive: true,
        steps: [
          { kind: "effect", to: "self", label: "Floating Eye", mods: [], duration: "manual", endsWhen: "the orb takes damage or moves out of Very Far range" },
          {
            kind: "manual",
            to: "self",
            text: "Create a small floating orb you can move anywhere within Very Far range; you can see through it as though looking out from its position and switch between your senses and the orb freely.",
          },
        ],
      },
    ],
  },

  // Counterspell (L3): "You can interrupt a magical effect taking place by making a reaction roll using your Spellcast
  // trait. On a success, the effect stops and any consequences are avoided, and this card is placed in your vault."
  {
    cardId: "counterspell",
    uses: [
      {
        id: "main",
        name: "Counterspell",
        activation: { kind: "reaction", trigger: { kind: "magicalEffect" } },
        roll: { kind: "reaction", trait: "spellcast", difficulty: { kind: "gm" } },
        steps: [
          { kind: "negate", to: "self", when: ["success"], what: "effect", note: "The effect stops and any consequences are avoided." },
          { kind: "toVault", to: "self", when: ["success"] },
        ],
      },
    ],
  },

  // Flight (L3): "Make a Spellcast Roll (15). On a success, place a number of tokens equal to your Agility on this card
  // (minimum 1). When you make an action roll while flying, spend a token from this card. After the action that spends
  // the last token is resolved, you descend to the ground directly below you."
  {
    cardId: "flight",
    uses: [
      {
        id: "main",
        name: "Flight",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 15 } },
        steps: [
          { kind: "tokens", to: "self", when: ["success"], op: "set", amount: { kind: "calc", of: { kind: "trait", trait: "agility" }, min: 1 } },
          {
            kind: "effect",
            to: "self",
            when: ["success"],
            label: "Flying",
            mods: [{ kind: "flag", flag: "flying" }],
            duration: "manual",
            endsWhen: "the action that spends the last Flight token is resolved",
            // Lanes SRD-C1 (dcm-7n7): spending the last token ends Flying: you descend to the ground below you.
            endsOn: ["tokensGone"],
          },
        ],
      },
      {
        id: "spend",
        name: "Flight: a token per action roll",
        activation: { kind: "auto", trigger: { kind: "afterYouRoll", roll: "action" } },
        requires: [{ kind: "effectActive", cardId: "flight" }],
        steps: [
          { kind: "tokens", to: "self", op: "spend", amount: n(1), note: "The last token ends Flying: you descend to the ground directly below you." },
          // Lanes-2 R1 (dcm-s9md): the table's reminder (the token step's note isn't shown) until the server ends Flying
          // on `tokensGone`; remove it when dcm-erhv merges. Card: "After the action that spends the last token is
          // resolved, you descend to the ground directly below you."
          {
            kind: "manual",
            to: "self",
            text: "If that was the last Flight token: after the action that spends the last token is resolved, you descend to the ground directly below you (end Flying).",
          },
        ],
      },
    ],
  },

  // Blink Out (L4): "Make a Spellcast Roll (12). On a success, spend a Hope to teleport to another point you can see
  // within Far range. If any willing creatures are within Very Close range, spend an additional Hope for each creature to
  // bring them with you."
  // Targets are the willing passengers (none for a solo blink).
  {
    cardId: "blink-out",
    uses: [
      {
        id: "main",
        name: "Blink Out",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 12 } },
        targets: { side: "any", range: "veryClose", count: { kind: "any" }, willing: true, excludeSelf: true },
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: n(1) }] },
          { kind: "move", to: "self", when: ["success"], mode: "teleport", range: "far", relativeTo: "self", note: "Teleport to a point you can see within Far range" },
          { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: { kind: "targetCount", which: "picked" } }], note: "An additional Hope for each willing creature brought along." },
          { kind: "move", to: "targets", when: ["success"], mode: "teleport", relativeTo: "self", note: "Teleports with you" },
        ],
      },
    ],
  },

  // Preservation Blast (L4): "Make a Spellcast Roll against all targets within Melee range. Targets you succeed against
  // are forced back to Far range and take d8+3 magic damage using your Spellcast trait."
  {
    cardId: "preservation-blast",
    uses: [
      {
        id: "main",
        name: "Preservation Blast",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "melee", count: { kind: "all" } },
        steps: [
          { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "far", relativeTo: "self" },
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice({ kind: "spellcast" }, 8, 3) }, type: "magic" },
        ],
      },
    ],
  },

  // Chain Lightning (L5): "Mark 2 Stress to make a Spellcast Roll, unleashing lightning on all targets within Close range.
  // Targets you succeed against must make a reaction roll with a Difficulty equal to the result of your Spellcast Roll.
  // Targets who fail take 2d8+4 magic damage. Additional adversaries not already targeted by Chain Lightning and within
  // Close range of previous targets who took damage must also make the reaction roll. Targets who fail take 2d8+4 magic
  // damage. This chain continues until there are no more adversaries within range."
  // `followUp` is the chain. Lanes SRD-C1 (dcm-rou): it repeats until a link finds no one (`until: "noTargets"`), each
  // link measured from the earlier ones (`origin: "chain"`); the runner drops creatures already targeted. User answer
  // 2026-10-31 (dcm-q13x): every new link rolls its own 2d8+4; that is run.ts's change (E3.3), the data stays as is.
  {
    cardId: "chain-lightning",
    uses: [
      {
        id: "main",
        name: "Chain Lightning",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(2) }],
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "all" } },
        steps: [
          {
            kind: "save",
            to: "targets",
            when: ["hit"],
            difficulty: { kind: "rollTotal" },
            onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(n(2), 8, 4) }, type: "magic" }],
            onSuccess: [],
          },
          {
            kind: "followUp",
            targets: { side: "enemy", range: "close", count: { kind: "all" }, area: "aroundTarget", areaRange: "close", origin: "chain" },
            repeat: { until: "noTargets" },
            note: "Adversaries not already targeted, within Close range of a target who took damage.",
            steps: [
              {
                kind: "save",
                to: "targets",
                difficulty: { kind: "rollTotal" },
                onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(n(2), 8, 4) }, type: "magic" }],
                onSuccess: [],
              },
            ],
          },
        ],
      },
    ],
  },

  // Premonition (L5): "You can channel arcane energy to have visions of the future. Once per long rest, immediately after
  // the GM conveys the consequences of a roll you made, you can rescind the move and consequences like they never
  // happened and make another move instead."
  {
    cardId: "premonition",
    uses: [
      {
        id: "main",
        name: "Premonition",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "any", result: "any" } },
        limit: { per: "longRest" },
        steps: [
          { kind: "modifyRoll", to: "self", change: { kind: "rescind" } },
          { kind: "manual", to: "self", text: "Rescind the move and its consequences like they never happened, and make another move instead." },
        ],
      },
    ],
  },

  // Rift Walker (L6): "Make a Spellcast Roll (15). On a success, you place an arcane marking on the ground where you
  // currently stand. The next time you successfully cast Rift Walker, a rift in space opens up, providing safe passage
  // back to the exact spot where the marking was placed. This rift stays open until you choose to close it or you cast
  // another spell. You can drop the spell at any time to cast Rift Walker again and place the marking somewhere new."
  {
    cardId: "rift-walker",
    uses: [
      {
        id: "main",
        name: "Rift Walker: place the marking",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 15 } },
        exclusive: true,
        steps: [
          { kind: "effect", to: "self", when: ["success"], label: "Rift Walker marking", mods: [], duration: "manual", endsWhen: "you drop the spell or the rift closes" },
          { kind: "manual", to: "self", when: ["success"], text: "Note where you stand: an arcane marking is placed on the ground there." },
        ],
      },
      {
        id: "open",
        name: "Rift Walker: open the rift",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "rift-walker" }],
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 15 } },
        steps: [
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "A rift opens, giving safe passage back to the exact spot of the marking. It stays open until you close it or cast another spell.",
          },
        ],
      },
    ],
  },

  // Telekinesis (L6): "Make a Spellcast Roll against a target within Far range. On a success, you can use your mind to
  // move them anywhere within Far range of their original position. You can throw the lifted target as an attack by
  // making an additional Spellcast Roll against the second target you're trying to attack. On a success, deal d12+4
  // physical damage to the second target using your Proficiency. This spell then ends."
  {
    cardId: "telekinesis",
    uses: [
      {
        id: "main",
        name: "Telekinesis",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "any", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "move", to: "targets", when: ["hit"], mode: "move", range: "far", relativeTo: "target", note: "Move them anywhere within Far range of their original position" },
          {
            kind: "optional",
            id: "throw",
            label: "Throw the lifted target at a second target",
            when: ["success"],
            steps: [
              {
                kind: "followUp",
                roll: { kind: "spellcast", difficulty: { kind: "target" } },
                targets: { side: "enemy", range: "far", count: { kind: "one" } },
                steps: [
                  { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: dice({ kind: "proficiency" }, 12, 4) }, type: "physical" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // Arcana-Touched (L7): "When 4 or more of the domain cards in your loadout are from the Arcana domain, gain the
  // following benefits: • +1 bonus to your Spellcast Rolls • Once per rest, you can switch the results of your Hope and
  // Fear Dice."
  {
    cardId: "arcana-touched",
    uses: [
      {
        id: "swap",
        name: "Arcana-Touched: switch Hope and Fear",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "any" } },
        requires: [{ kind: "loadoutDomainCount", domain: "arcana", min: 4 }],
        limit: { per: "rest" },
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "swapDuality" } }],
      },
      {
        id: "passive",
        name: "Arcana-Touched: +1 Spellcast",
        activation: { kind: "passive" },
        requires: [{ kind: "loadoutDomainCount", domain: "arcana", min: 4 }],
        mods: [{ kind: "stat", stat: "spellcast", delta: n(1) }],
        steps: [],
      },
    ],
  },

  // Cloaking Blast (L7): "When you make a successful Spellcast Roll to cast a different spell, you can spend a Hope to
  // become Cloaked. While Cloaked, you remain unseen if you are stationary when an adversary moves to where they would
  // normally see you. When you move into or within an adversary's line of sight or make an attack, you are no longer
  // Cloaked."
  {
    cardId: "cloaking-blast",
    uses: [
      {
        id: "main",
        name: "Cloaking Blast",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "spellcast", result: "success" } },
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [
          {
            kind: "condition",
            to: "self",
            condition: { kind: "standard", condition: "cloaked" },
            duration: "manual",
            endsWhen: "you move into or within an adversary's line of sight or make an attack",
          },
        ],
      },
    ],
  },

  // Arcane Reflection (L8): "When you would take magic damage, you can spend any number of Hope to roll that many d6s. If
  // any roll a 6, the attack is reflected back to the caster, dealing the damage to them instead."
  {
    cardId: "arcane-reflection",
    uses: [
      {
        id: "main",
        name: "Arcane Reflection",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", damageType: "magic" } },
        choices: [{ id: "hope", label: "Hope to spend (one d6 each)", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        steps: [
          {
            kind: "check",
            dice: dice({ kind: "spent", resource: "hope" }, 6),
            test: { kind: "anyAtLeast", value: 6 },
            then: [{ kind: "redirectDamage", to: "triggerSource", target: "triggerSource", note: "The attack is reflected back to the caster, dealing the damage to them instead." }],
            otherwise: [],
          },
        ],
      },
    ],
  },

  // Confusing Aura (L8): "Make a Spellcast Roll (14). Once per long rest on a success, you create a layer of illusion over
  // your body that makes it hard to tell exactly where you are. Mark any number of Stress to make that many additional
  // layers. When an adversary makes an attack against you, roll a number of d6s equal to the number of layers currently
  // active. If any roll a 5 or higher, one layer of the aura is destroyed and the attack fails. If all the results are 4
  // or lower, you take the damage and this spell ends."
  // Layers are tokens on the card.
  {
    cardId: "confusing-aura",
    uses: [
      {
        id: "main",
        name: "Confusing Aura",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        // Lanes SRD-C1 (dcm-8x8): at most your unmarked Stress ("mark any number of Stress").
        choices: [{ id: "layers", label: "Stress to mark (one extra layer each)", min: 0, max: { kind: "free", who: "self", track: "stress" } }],
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 14 } },
        exclusive: true,
        steps: [
          { kind: "tokens", to: "self", when: ["success"], op: "set", amount: n(1), note: "The first layer." },
          { kind: "effect", to: "self", when: ["success"], label: "Confusing Aura", mods: [], duration: "manual", endsWhen: "every layer is destroyed or an attack's dice all roll 4 or lower" },
          { kind: "pay", when: ["success"], costs: [{ kind: "stress", amount: { kind: "chosen", choice: "layers" } }] },
          { kind: "tokens", to: "self", when: ["success"], op: "add", amount: { kind: "chosen", choice: "layers" }, note: "One additional layer per Stress marked." },
        ],
      },
      {
        id: "attacked",
        name: "Confusing Aura: an attack against you",
        activation: { kind: "auto", trigger: { kind: "whenAttacked", stage: "succeeded" } },
        requires: [{ kind: "effectActive", cardId: "confusing-aura" }],
        steps: [
          {
            kind: "check",
            dice: dice({ kind: "cardTokens" }, 6),
            test: { kind: "anyAtLeast", value: 5 },
            then: [
              { kind: "tokens", to: "self", op: "spend", amount: n(1), note: "One layer of the aura is destroyed." },
              { kind: "negate", to: "self", what: "attack", note: "The attack fails." },
            ],
            otherwise: [
              { kind: "tokens", to: "self", op: "clear" },
              // Lanes SRD-C1 (dcm-8x8): "you take the damage and this spell ends".
              // Lanes-2 S1.4: the card path applies `endEffect` (cardRows `applyUseEnds`, dcm-m48i), so the reminder is gone.
              { kind: "endEffect", to: "self", note: "All the results are 4 or lower: you take the damage and Confusing Aura ends." },
            ],
          },
        ],
      },
    ],
  },

  // Earthquake (L9): "Make a Spellcast Roll (16). Once per rest on a success, all targets within Very Far range who aren't
  // flying must make a Reaction Roll (18). Targets who fail take 3d10+8 physical damage and are temporarily Vulnerable.
  // Targets who succeed take half damage. Additionally, when you succeed on the Spellcast Roll, all terrain within Very
  // Far range becomes difficult to move through and structures within this range might sustain damage or crumble."
  {
    cardId: "earthquake",
    uses: [
      {
        id: "main",
        name: "Earthquake",
        activation: { kind: "action" },
        limit: { per: "rest", consumedOn: "success" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 16 } },
        targets: { side: "enemy", range: "veryFar", count: { kind: "all" }, excludeFlying: true },
        steps: [
          {
            kind: "save",
            to: "targets",
            when: ["success"],
            difficulty: { kind: "fixed", value: 18 },
            onFail: [
              { kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(n(3), 10, 8) }, type: "physical" },
              { kind: "condition", to: "targets", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" },
            ],
            onSuccess: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: dice(n(3), 10, 8) }, type: "physical", scale: "half" }],
          },
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "All terrain within Very Far range becomes difficult to move through, and structures within this range might sustain damage or crumble.",
          },
        ],
      },
    ],
  },

  // Sensory Projection (L9): "Once per rest, make a Spellcast Roll (15). On a success, drop into a vision that lets you
  // clearly see and hear any place you have been before as though you are standing there in this moment. You can move
  // freely in this vision and are not constrained by the physics or impediments of a physical body. This spell cannot be
  // detected by mundane or magical means. You drop out of this vision upon taking damage or casting another spell."
  {
    cardId: "sensory-projection",
    uses: [
      {
        id: "main",
        name: "Sensory Projection",
        activation: { kind: "action" },
        limit: { per: "rest" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 15 } },
        steps: [
          {
            kind: "effect",
            to: "self",
            when: ["success"],
            label: "Sensory Projection",
            mods: [],
            duration: "manual",
            endsWhen: "you take damage or cast another spell",
            // Lanes SRD-C1 (dcm-utu): taking damage ends it by itself. Lanes-2 S1.4: casting another spell ends it too
            // (the card path's `endSpellCast`, dcm-m48i).
            endsOn: ["takeDamage", "castsSpell"],
          },
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "Drop into a vision of any place you have been before: see and hear it as though standing there, move freely, undetectable by mundane or magical means.",
          },
        ],
      },
    ],
  },

  // Adjust Reality (L10): "After you or a willing ally make any roll, you can spend 5 Hope to change the numerical result
  // of that roll to a result of your choice instead. The result must be plausible within the range of the dice."
  // Lanes SRD-C1 (dcm-3ft): the reaction covers any roll (`roll: "any"`: action, reaction and damage rolls), so the
  // former "other" use with its manual step is gone. Offering it on another player's roll is dcm-cfpv.
  {
    cardId: "adjust-reality",
    uses: [
      {
        id: "main",
        name: "Adjust Reality",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", result: "any", includeSelf: true, roll: "any" } },
        costs: [{ kind: "hope", amount: n(5) }],
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "modifyRoll", to: "triggerSubject", change: { kind: "setResult" }, note: "The result must be plausible within the range of the dice." },
        ],
      },
    ],
  },

  // Falling Sky (L10): "Make a Spellcast Roll against all adversaries within Far range. Mark any number of Stress to make
  // shards of arcana rain down from above. Targets you succeed against take 1d20+2 magic damage for each Stress marked."
  {
    cardId: "falling-sky",
    uses: [
      {
        id: "main",
        name: "Falling Sky",
        activation: { kind: "action" },
        choices: [{ id: "stress", label: "Stress to mark (1d20+2 each)", min: 1 }],
        costs: [{ kind: "stress", amount: { kind: "chosen", choice: "stress" } }],
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "all" } },
        steps: [
          {
            kind: "damage",
            to: "targets",
            when: ["hit"],
            roll: { kind: "dice", dice: dice(n(1), 20, 2) },
            type: "magic",
            repeat: { kind: "spent", resource: "stress" },
          },
        ],
      },
    ],
  },
];
