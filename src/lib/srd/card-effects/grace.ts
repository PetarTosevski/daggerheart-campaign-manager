// Card effects of the Grace domain (plan combat-actions; tracer CE-grace fills it, CA0 ships it empty).
// Pure data: no framework imports, relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts. Each entry quotes its card text in a comment;
// what the vocabulary (src/lib/domain/card-effects/types.ts) cannot express is a `manual` step, never a vocabulary change.
// Readings, manual steps and open rulings: docs/tasks/TASK-CA-CE-grace.md. Card texts: CB p.334 (levels 1-3) and
// CB p.335 (levels 4-10). Out of combat (no entry): Deft Deceiver, Soothing Speech, Endless Charisma, Master of the
// Craft, Notorious.

import type { CardEffect, ConditionRef, NumberSource } from "../../domain/card-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const ONE = fixed(1);

/** Enraptured (Enrapture, Mass Enrapture): a card condition, so a tag the GM clears (temporary, CB p.102). */
const ENRAPTURED: ConditionRef = { kind: "tag", tag: "Enraptured" };
const STUNNED: ConditionRef = { kind: "tag", tag: "Stunned" };
const CANT_LIE: ConditionRef = { kind: "tag", tag: "Can't lie (Tell No Lies)" };

/** "When 4 or more of the domain cards in your loadout are from the Grace domain" (Grace-Touched). */
const GRACE_TOUCHED = { kind: "loadoutDomainCount", domain: "grace", min: 4 } as const;

export const GRACE_EFFECTS: readonly CardEffect[] = [
  // Enrapture (Grace 1, CB p.334): "Make a Spellcast Roll against a target within Close range. On a success, they become
  // temporarily Enraptured. While Enraptured, a target's attention is fixed on you, narrowing their field of view and
  // drowning out any sound but your voice. Once per rest on a success, you can mark a Stress to force the Enraptured
  // target to mark a Stress as well."
  {
    cardId: "enrapture",
    uses: [
      {
        id: "main",
        name: "Enrapture",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [
          { kind: "condition", to: "targets", when: ["hit"], condition: ENRAPTURED, duration: "temporary" },
          {
            kind: "optional",
            id: "stress",
            label: "Mark a Stress: the Enraptured target marks a Stress too (once per rest)",
            when: ["success"],
            costs: [{ kind: "stress", amount: ONE }],
            limit: { per: "rest", consumedOn: "success" },
            steps: [{ kind: "markStress", to: "targets", when: ["hit", { kind: "targetHas", condition: ENRAPTURED }], amount: ONE }],
          },
        ],
      },
    ],
  },

  // Inspirational Words (Grace 1, CB p.334): "Your speech is imbued with power. After a long rest, place a number of
  // tokens on this card equal to your Presence. When you speak with an ally, you can spend a token from this card to give
  // them one benefit from the following options: • Your ally clears a Stress. • Your ally clears a Hit Point. • Your ally
  // gains a Hope. When you take a long rest, clear all unspent tokens."
  {
    cardId: "inspirational-words",
    uses: [
      {
        id: "main",
        name: "Inspirational Words",
        activation: { kind: "action" },
        costs: [{ kind: "tokens", amount: ONE }],
        targets: { side: "ally", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
        steps: [
          {
            kind: "choose",
            id: "benefit",
            label: "Give your ally one benefit",
            options: [
              { id: "stress", label: "Your ally clears a Stress", steps: [{ kind: "clear", to: "targets", track: "stress", amount: ONE }] },
              { id: "hp", label: "Your ally clears a Hit Point", steps: [{ kind: "clear", to: "targets", track: "hp", amount: ONE }] },
              { id: "hope", label: "Your ally gains a Hope", steps: [{ kind: "hope", to: "targets", change: "gain", amount: ONE }] },
            ],
          },
        ],
      },
      {
        // Unspent tokens are cleared on the long rest and Presence many are placed after it: one `set`.
        id: "tokens",
        name: "Inspirational Words: tokens",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } },
        steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "trait", trait: "presence" } }],
      },
    ],
  },

  // Tell No Lies (Grace 2, CB p.334): "Make a Spellcast Roll against a target within Very Close range. On a success, they
  // can't lie to you while they remain within Close range, but they are not compelled to speak. If you ask them a question
  // and they refuse to answer, they must mark a Stress and the effect ends. The target is typically unaware this spell has
  // been cast on them until it causes them to utter the truth."
  {
    cardId: "tell-no-lies",
    uses: [
      {
        id: "main",
        name: "Tell No Lies",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "veryClose", count: { kind: "one" } },
        steps: [
          {
            kind: "condition",
            to: "targets",
            when: ["hit"],
            condition: CANT_LIE,
            duration: "manual",
            endsWhen: "they leave Close range, or refuse to answer a question",
          },
        ],
      },
      {
        id: "refuses",
        name: "Tell No Lies: they refuse to answer",
        activation: { kind: "action" },
        targets: { side: "enemy", range: "unlimited", count: { kind: "one" } },
        steps: [
          { kind: "markStress", to: "targets", when: [{ kind: "targetHas", condition: CANT_LIE }], amount: ONE },
          { kind: "clearCondition", to: "targets", condition: CANT_LIE },
        ],
      },
    ],
  },

  // Troublemaker (Grace 2, CB p.334): "When you taunt or provoke a target within Far range, make a Presence Roll against
  // them. Once per rest on a success, roll a number of d4s equal to your Proficiency. The target must mark Stress equal to
  // the highest result rolled."
  {
    cardId: "troublemaker",
    uses: [
      {
        id: "main",
        name: "Troublemaker",
        activation: { kind: "action" },
        limit: { per: "rest", consumedOn: "success" },
        roll: { kind: "trait", trait: "presence", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          {
            kind: "markStress",
            to: "targets",
            when: ["hit"],
            amount: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 4 }, keep: "highest" },
          },
        ],
      },
    ],
  },

  // Hypnotic Shimmer (Grace 3, CB p.334): "Make a Spellcast Roll against all adversaries in front of you within Close
  // range. Once per rest on a success, create an illusion of flashing colors and lights that temporarily Stuns targets you
  // succeed against and forces them to mark a Stress. While Stunned, they can't use reactions and can't take any other
  // actions until they clear this condition."
  {
    cardId: "hypnotic-shimmer",
    uses: [
      {
        id: "main",
        name: "Hypnotic Shimmer",
        activation: { kind: "action" },
        limit: { per: "rest", consumedOn: "success" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "close", count: { kind: "all" }, area: "front" },
        steps: [
          { kind: "condition", to: "targets", when: ["hit"], condition: STUNNED, duration: "temporary", note: "Stunned: no reactions, no other actions" },
          { kind: "effect", to: "targets", when: ["hit"], label: "Stunned", mods: [{ kind: "flag", flag: "cannotReact" }, { kind: "flag", flag: "cannotAct" }], duration: "temporary" },
          { kind: "markStress", to: "targets", when: ["hit"], amount: ONE },
        ],
      },
    ],
  },

  // Invisibility (Grace 3, CB p.334): "Make a Spellcast Roll (10). On a success, mark a Stress and choose yourself or an
  // ally within Melee range to become Invisible. An Invisible creature can't be seen except through magical means and
  // attack rolls against them are made with disadvantage. Place a number of tokens on this card equal to your Spellcast
  // trait. When the Invisible creature takes an action, spend a token from this card. After the action that spends the
  // last token is resolved, the effect ends. You can only hold Invisibility on one creature at a time."
  {
    cardId: "invisibility",
    uses: [
      {
        id: "main",
        name: "Invisibility",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 10 } },
        targets: { side: "selfOrAlly", range: "melee", count: { kind: "one" } },
        exclusive: true,
        steps: [
          { kind: "pay", when: ["success"], costs: [{ kind: "stress", amount: ONE }] },
          {
            kind: "effect",
            to: "targets",
            when: ["success"],
            label: "Invisible",
            mods: [{ kind: "disadvantageAgainst", on: "attack" }],
            duration: "manual",
            endsWhen: "the action that spends the last Invisibility token is resolved",
          },
          { kind: "tokens", to: "self", when: ["success"], op: "set", amount: { kind: "spellcast" } },
        ],
      },
      {
        id: "spend-token",
        name: "Invisibility: the Invisible creature acts",
        activation: { kind: "action" },
        costs: [{ kind: "tokens", amount: ONE }],
        steps: [
          {
            kind: "manual",
            to: "self",
            text: "If that was the last token, Invisibility ends once this action is resolved.",
          },
        ],
      },
    ],
  },

  // Through Your Eyes (Grace 4, CB p.335): "Choose a target within Very Far range. You can see through their eyes and
  // hear through their ears. You can transition between using your own senses or the target's freely until you cast
  // another spell or until your next rest."
  {
    cardId: "through-your-eyes",
    uses: [
      {
        id: "main",
        name: "Through Your Eyes",
        activation: { kind: "action" },
        targets: { side: "any", range: "veryFar", count: { kind: "one" }, excludeSelf: true },
        steps: [
          { kind: "effect", to: "self", label: "Through Your Eyes", mods: [], duration: "rest", endsWhen: "you cast another spell" },
          { kind: "manual", to: "targets", text: "You can see through the target's eyes and hear through their ears (the GM describes it)." },
        ],
      },
    ],
  },

  // Thought Delver (Grace 5, CB p.335): "You can peek into the minds of others. Spend a Hope to read the vague surface
  // thoughts of a target within Far range. Make a Spellcast Roll against the target to delve for deeper, more hidden
  // thoughts. On a roll with Fear, the target might, at the GM's discretion, become aware that you're reading their
  // thoughts."
  {
    cardId: "thought-delver",
    uses: [
      {
        id: "main",
        name: "Thought Delver: surface thoughts",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: ONE }],
        targets: { side: "any", range: "far", count: { kind: "one" }, excludeSelf: true },
        steps: [{ kind: "manual", to: "targets", text: "The GM tells you the target's vague surface thoughts." }],
      },
      {
        id: "delve",
        name: "Thought Delver: delve deeper",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "any", range: "far", count: { kind: "one" }, excludeSelf: true },
        steps: [
          { kind: "manual", to: "targets", when: ["hit"], text: "The GM tells you the target's deeper, more hidden thoughts." },
          { kind: "manual", to: "targets", when: ["withFear"], text: "At the GM's discretion, the target becomes aware you're reading their thoughts." },
        ],
      },
    ],
  },

  // Words of Discord (Grace 5, CB p.335): "Whisper words of discord to an adversary within Melee range and make a
  // Spellcast Roll (13). On a success, the target must mark a Stress and make an attack against another adversary instead
  // of against you or your allies. Once this attack is over, the target realizes what happened. The next time you cast
  // Words of Discord on them, gain a -5 penalty to the Spellcast Roll."
  {
    cardId: "words-of-discord",
    uses: [
      {
        id: "main",
        name: "Words of Discord",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 } },
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "markStress", to: "targets", when: ["success"], amount: ONE },
          {
            kind: "manual",
            to: "targets",
            when: ["success"],
            text: "The target makes an attack against another adversary instead of against you or your allies (the GM runs it). Once it is over, the target realizes what happened.",
          },
        ],
      },
      {
        // The -5 on a repeat cast: the player confirms the target has been affected before.
        id: "again",
        name: "Words of Discord (again on the same target)",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: "You have cast Words of Discord on this target before" }],
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 }, modifier: fixed(-5) },
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "markStress", to: "targets", when: ["success"], amount: ONE },
          {
            kind: "manual",
            to: "targets",
            when: ["success"],
            text: "The target makes an attack against another adversary instead of against you or your allies (the GM runs it). Once it is over, the target realizes what happened.",
          },
        ],
      },
    ],
  },

  // Never Upstaged (Grace 6, CB p.335): "When you mark 1 or more Hit Points from an attack, you can mark a Stress to place
  // a number of tokens equal to the number of Hit Points you marked on this card. On your next successful attack, gain a
  // +5 bonus to your damage roll for each token on this card, then clear all tokens."
  {
    cardId: "never-upstaged",
    uses: [
      {
        id: "main",
        name: "Never Upstaged",
        activation: { kind: "reaction", trigger: { kind: "whenYouMarkHp", fromAttack: true } },
        costs: [{ kind: "stress", amount: ONE }],
        steps: [{ kind: "tokens", to: "self", op: "add", amount: { kind: "triggerAmount" } }],
      },
      {
        id: "bonus",
        name: "Never Upstaged: +5 damage per token",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "calc", of: { kind: "cardTokens" }, times: 5 } } },
          { kind: "tokens", to: "self", op: "clear" },
        ],
      },
    ],
  },

  // Share the Burden (Grace 6, CB p.335): "Once per rest, take on the Stress from a willing creature within Melee range.
  // The target describes what intimate knowledge or emotions telepathically leak from their mind in this moment between
  // you. Transfer any number of their marked Stress to you, then gain a Hope for each Stress transferred."
  {
    cardId: "share-the-burden",
    uses: [
      {
        id: "main",
        name: "Share the Burden",
        activation: { kind: "action" },
        limit: { per: "rest" },
        choices: [{ id: "stress", label: "Stress to transfer (at most the target's marked Stress)", min: 1 }],
        targets: { side: "ally", range: "melee", count: { kind: "one" }, willing: true, excludeSelf: true },
        steps: [
          { kind: "clear", to: "targets", track: "stress", amount: { kind: "chosen", choice: "stress" } },
          { kind: "markStress", to: "self", amount: { kind: "chosen", choice: "stress" } },
          { kind: "hope", to: "self", change: "gain", amount: { kind: "chosen", choice: "stress" } },
        ],
      },
    ],
  },

  // Grace-Touched (Grace 7, CB p.335): "When 4 or more of the domain cards in your loadout are from the Grace domain, gain
  // the following benefits: • You can mark an Armor Slot instead of marking a Stress. • When you would force a target to
  // mark a number of Hit Points, you can choose instead to force them to mark that number of Stress."
  {
    cardId: "grace-touched",
    uses: [
      {
        // The vocabulary has no "you would mark Stress" trigger (bead filed): an always-available swap the server folds
        // into any Stress the actor marks.
        id: "armor-for-stress",
        name: "Grace-Touched: Armor Slot instead of Stress",
        activation: { kind: "passive" },
        requires: [GRACE_TOUCHED],
        steps: [{ kind: "convertMarks", to: "self", from: "stress", into: "armor" }],
      },
      {
        id: "stress-for-hp",
        name: "Grace-Touched: Stress instead of Hit Points",
        activation: { kind: "rider", trigger: { kind: "whenTargetMarksHp" } },
        requires: [GRACE_TOUCHED],
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "convertMarks", to: "targets", from: "hp", into: "stress" }],
      },
    ],
  },

  // Astral Projection (Grace 8, CB p.335): "Once per long rest, mark a Stress to create a projected copy of yourself that
  // can appear anywhere you've been before. You can see and hear through the projection as though it were you and affect
  // the world as though you were there. A creature investigating the projection can tell it's of magical origin. This
  // effect lasts until your next rest or your projection takes any damage."
  {
    cardId: "astral-projection",
    uses: [
      {
        id: "main",
        name: "Astral Projection",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        costs: [{ kind: "stress", amount: ONE }],
        steps: [
          { kind: "effect", to: "self", label: "Astral Projection", mods: [], duration: "rest", endsWhen: "your projection takes any damage" },
          {
            kind: "manual",
            to: "self",
            text: "Your projected copy appears anywhere you've been before; you see, hear and act through it. It ends at your next rest or when it takes any damage.",
          },
        ],
      },
    ],
  },

  // Mass Enrapture (Grace 8, CB p.335): "Make a Spellcast Roll against all targets within Far range. Targets you succeed
  // against become temporarily Enraptured. While Enraptured, a target's attention is fixed on you, narrowing their field
  // of view and drowning out any sound but your voice. Mark a Stress to force all Enraptured targets to mark a Stress,
  // ending this spell."
  {
    cardId: "mass-enrapture",
    uses: [
      {
        id: "main",
        name: "Mass Enrapture",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "all" } },
        steps: [{ kind: "condition", to: "targets", when: ["hit"], condition: ENRAPTURED, duration: "temporary" }],
      },
      {
        id: "release",
        name: "Mass Enrapture: every Enraptured target marks a Stress",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: ONE }],
        targets: { side: "enemy", range: "unlimited", count: { kind: "all" } },
        steps: [
          { kind: "markStress", to: "targets", when: [{ kind: "targetHas", condition: ENRAPTURED }], amount: ONE },
          { kind: "clearCondition", to: "targets", when: [{ kind: "targetHas", condition: ENRAPTURED }], condition: ENRAPTURED },
        ],
      },
    ],
  },

  // Copycat (Grace 9, CB p.335): "Once per long rest, this card can mimic the features of another domain card of level 8
  // or lower in another player's loadout. Spend Hope equal to half the card's level to gain access to the feature. It
  // lasts until your next rest or they place the card in their vault."
  {
    cardId: "copycat",
    uses: [
      {
        id: "main",
        name: "Copycat",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        choices: [{ id: "level", label: "Level of the copied card (8 or lower)", min: 1, max: fixed(8) }],
        costs: [{ kind: "hope", amount: { kind: "calc", of: { kind: "chosen", choice: "level" }, divide: 2 } }],
        targets: { side: "ally", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
        steps: [
          { kind: "effect", to: "self", label: "Copycat", mods: [], duration: "rest", endsWhen: "they place the copied card in their vault" },
          {
            kind: "manual",
            to: "targets",
            text: "Pick a domain card of level 8 or lower in this player's loadout; until your next rest you can use its feature as written (from their card).",
          },
        ],
      },
    ],
  },

  // Encore (Grace 10, CB p.335): "When an ally within Close range deals damage to an adversary, you can make a Spellcast
  // Roll against that same target. On a success, you deal the same damage to the target that your ally dealt. If your
  // Spellcast Roll succeeds with Fear, place this card in your vault."
  {
    cardId: "encore",
    uses: [
      {
        id: "main",
        name: "Encore",
        activation: { kind: "reaction", trigger: { kind: "whenAllyDealsDamage", range: "close" } },
        roll: { kind: "spellcast", difficulty: { kind: "target" } },
        targets: { side: "trigger", who: "subject" },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "sameAsTrigger" }, type: "magic" },
          { kind: "toVault", to: "self", when: ["success", "withFear"] },
        ],
      },
    ],
  },
];
