// Card effects of the Midnight domain (plan combat-actions, tracer CE-midnight).
// Pure data: no framework imports, relative imports only (bundled into Convex).
//
// One entry per card classified combat or passive in ./classification.ts (19 cards; Uncanny Disguise and Mass Disguise
// are out of combat). Each entry quotes its card text (CB = Core Book, printed pages: Pick and Pull to Mass Disguise on
// p.336, Midnight-Touched to Specter of the Dark on p.337). What the vocabulary (src/lib/domain/card-effects/types.ts)
// cannot express is a `manual` step with the card's words; every one is listed with its reason in
// docs/tasks/TASK-CA-CE-midnight.md.
//
// Readings used throughout (book pages are printed pages):
// - "Make a Spellcast Roll against a target" rolls against the target's Difficulty; "Spellcast Roll (13)" is a fixed
//   Difficulty (CB p.96). "On a success" against a target = the `hit` gate; against a fixed Difficulty = `success`.
// - "all targets" / "any targets" are adversaries (as in CE-arcana, QUESTIONS 1 there).
// - "temporarily" = duration `temporary` (CB p.102); card-specific conditions (Horrified, Silenced, Spectral) are tags
//   or effects with the card's end in `endsWhen` (duration `manual`).
// - "On a success, spend a Hope" is a `pay` step after the roll, so the roll's own Hope can pay (R8, CB p.90).
// - "Once per long rest on a success" = limit `consumedOn: success` (Q4).

import type { CardEffect, NumberSource, RollSpec, Step } from "../../domain/card-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const prof: NumberSource = { kind: "proficiency" };
const vsTarget: RollSpec = { kind: "spellcast", difficulty: { kind: "target" } };
const vsFixed = (value: number): RollSpec => ({ kind: "spellcast", difficulty: { kind: "fixed", value } });
const payHope: Step = { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: n(1) }] };

/** Situations the player confirms (check boxes); the engine cannot see light, positions behind a creature or stealth. */
export const MIDNIGHT_SITUATIONS = {
  pickAndPull: "The roll is to pick a nonmagical lock, disarm a nonmagical trap, or steal an item from a target",
  chokehold: "You're positioned behind a creature who's about your size",
  veilAttack: "You attack through the darkness of your Veil of Night",
  sneakSelf: "You're attempting to move unnoticed through a dangerous area",
  sneakAlly: "The ally is also attempting to move unnoticed through a dangerous area",
  darkWhispers: "You've made physical contact with them",
  shadowhunter: "You're shrouded in low light or darkness",
  twilightToll: "The roll was against your Twilight Toll target and doesn't result in a damage roll",
} as const;

const chokeholdTag = { kind: "tag", tag: "Chokehold", implies: ["vulnerable"] } as const;
const tollTag = { kind: "tag", tag: "Twilight Toll" } as const;
const horrified = { kind: "tag", tag: "Horrified", implies: ["vulnerable"] } as const;
/** Night Terror: "Steal a number of Fear from the GM equal to the number of targets that are Horrified (up to the number of Fear in the GM's pool)." */
const stolenFear: NumberSource = { kind: "calc", of: { kind: "targetCount", which: "failedSave" }, max: { kind: "gmFear" } };

export const MIDNIGHT_EFFECTS: readonly CardEffect[] = [
  // Pick and Pull (L1, CB p.336): "You have advantage on action rolls to pick nonmagical locks, disarm nonmagical traps,
  // or steal items from a target (either through stealth or by force)."
  {
    cardId: "pick-and-pull",
    uses: [
      {
        id: "main",
        name: "Pick and Pull",
        activation: { kind: "passive" },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.pickAndPull }],
        mods: [{ kind: "advantage", on: "action" }],
        steps: [],
      },
    ],
  },

  // Rain of Blades (L1, CB p.336): "Spend a Hope to make a Spellcast Roll and conjure throwing blades that strike out at
  // all targets within Very Close range. Targets you succeed against take d8+2 magic damage using your Proficiency.
  // If a target you hit is Vulnerable, they take an extra 1d8 damage."
  // The extra 1d8 is its own damage step (rolled once for every Vulnerable target, R9; a critical maximises it too) and
  // is totalled with the d8+2 before thresholds (CB p.98).
  {
    cardId: "rain-of-blades",
    uses: [
      {
        id: "main",
        name: "Rain of Blades",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        roll: vsTarget,
        targets: { side: "enemy", range: "veryClose", count: { kind: "all" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: prof, sides: 8, plus: n(2) } }, type: "magic" },
          {
            kind: "damage",
            to: "targets",
            when: ["hit", { kind: "targetHas", condition: { kind: "standard", condition: "vulnerable" } }],
            roll: { kind: "dice", dice: { count: n(1), sides: 8 } },
            type: "magic",
            note: "If a target you hit is Vulnerable, they take an extra 1d8 damage.",
          },
        ],
      },
    ],
  },

  // Midnight Spirit (L2, CB p.336): "Spend a Hope to summon a humanoid-sized spirit that can move or carry things for you
  // until your next rest. You can also send it to attack an adversary. When you do, make a Spellcast Roll against a
  // target within Very Far range. On a success, the spirit moves into Melee range with that target. Roll a number of d6s
  // equal to your Spellcast trait and deal that much magic damage to the target. The spirit then dissipates. You can only
  // have one spirit at a time."
  {
    cardId: "midnight-spirit",
    uses: [
      {
        id: "main",
        name: "Midnight Spirit",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        exclusive: true,
        steps: [
          { kind: "effect", to: "self", label: "Midnight Spirit", mods: [], duration: "rest" },
          { kind: "manual", to: "self", text: "A humanoid-sized spirit appears; it can move or carry things for you until your next rest." },
        ],
      },
      {
        id: "attack",
        name: "Midnight Spirit: send it to attack",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "midnight-spirit" }],
        roll: vsTarget,
        targets: { side: "enemy", range: "veryFar", count: { kind: "one" } },
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: { kind: "spellcast" }, sides: 6 } }, type: "magic" },
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "The spirit moves into Melee range with the target, strikes, then dissipates: end your Midnight Spirit effect.",
          },
        ],
      },
    ],
  },

  // Shadowbind (L2, CB p.336): "Make a Spellcast Roll against all adversaries within Very Close range. Targets you
  // succeed against are temporarily Restrained as their shadow binds them in place."
  {
    cardId: "shadowbind",
    uses: [
      {
        id: "main",
        name: "Shadowbind",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "veryClose", count: { kind: "all" } },
        steps: [{ kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "restrained" }, duration: "temporary" }],
      },
    ],
  },

  // Chokehold (L3, CB p.336): "When you position yourself behind a creature who's about your size, you can mark a Stress
  // to pull them into a chokehold, making them temporarily Vulnerable. When a creature attacks a target who is Vulnerable
  // in this way, they deal an extra 2d6 damage."
  // "Vulnerable in this way" is the tag "Chokehold" (implies Vulnerable). Your own successful attacks add the 2d6 by
  // themselves (`auto`); another creature's attack is a manual step (no trigger on someone else's attack).
  {
    cardId: "chokehold",
    uses: [
      {
        id: "main",
        name: "Chokehold",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.chokehold }],
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          { kind: "condition", to: "targets", condition: chokeholdTag, duration: "temporary" },
          {
            kind: "manual",
            to: "targets",
            text: "When a creature attacks a target who is Vulnerable in this way, they deal an extra 2d6 damage (add it to an ally's or adversary's damage roll while the Chokehold lasts).",
          },
        ],
      },
      {
        id: "extra-damage",
        name: "Chokehold: extra 2d6",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            when: ["hit", { kind: "targetHas", condition: chokeholdTag }],
            change: { kind: "add", amount: { kind: "dice", dice: { count: n(2), sides: 6 } } },
          },
        ],
      },
    ],
  },

  // Veil of Night (L3, CB p.336): "Make a Spellcast Roll (13). On a success, you can create a temporary curtain of
  // darkness between two points within Far range. Only you can see through this darkness. You're considered Hidden to
  // adversaries on the other side of the veil, and you have advantage on attacks you make through the darkness. The veil
  // remains until you cast another spell."
  {
    cardId: "veil-of-night",
    uses: [
      {
        id: "main",
        name: "Veil of Night",
        activation: { kind: "action" },
        roll: vsFixed(13),
        exclusive: true,
        steps: [
          { kind: "effect", to: "self", when: ["success"], label: "Veil of Night", mods: [], duration: "manual", endsWhen: "you cast another spell" },
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "Place a curtain of darkness between two points within Far range. Only you can see through it; you're Hidden to adversaries on the other side of the veil.",
          },
        ],
      },
      {
        id: "attack-through",
        name: "Veil of Night: attack through the darkness",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
        requires: [
          { kind: "effectActive", cardId: "veil-of-night" },
          { kind: "situation", text: MIDNIGHT_SITUATIONS.veilAttack },
        ],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "advantage" } }],
      },
    ],
  },

  // Glyph of Nightfall (L4, CB p.336): "Make a Spellcast Roll against a target within Very Close range. On a success,
  // spend a Hope to conjure a dark glyph upon their body that exposes their weak points, temporarily reducing the
  // target's Difficulty by a value equal to your Knowledge (minimum 1)."
  {
    cardId: "glyph-of-nightfall",
    uses: [
      {
        id: "main",
        name: "Glyph of Nightfall",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "veryClose", count: { kind: "one" } },
        steps: [
          payHope,
          {
            kind: "effect",
            to: "targets",
            when: ["hit"],
            label: "Glyph of Nightfall",
            mods: [{ kind: "stat", stat: "difficulty", delta: { kind: "calc", of: { kind: "calc", of: { kind: "trait", trait: "knowledge" }, min: 1 }, times: -1 } }],
            duration: "temporary",
          },
        ],
      },
    ],
  },

  // Stealth Expertise (L4, CB p.336): "When you roll with Fear while attempting to move unnoticed through a dangerous
  // area, you can mark a Stress to roll with Hope instead. If an ally within Close range is also attempting to move
  // unnoticed and rolls with Fear, you can mark a Stress to change their result to a roll with Hope."
  {
    cardId: "stealth-expertise",
    uses: [
      {
        id: "main",
        name: "Stealth Expertise",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "withFear" } },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.sneakSelf }],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "withHope" } }],
      },
      {
        id: "ally",
        name: "Stealth Expertise: an ally",
        activation: { kind: "reaction", trigger: { kind: "afterAllyRolls", range: "close", result: "withFear" } },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.sneakAlly }],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "modifyRoll", to: "triggerSubject", change: { kind: "withHope" } }],
      },
    ],
  },

  // Hush (L5, CB p.336): "Make a Spellcast Roll against a target within Close range. On a success, spend a Hope to
  // conjure suppressive magic around the target that encompasses everything within Very Close range of them and follows
  // them as they move. The target and anything within the area is Silenced until the GM spends a Fear on their turn to
  // clear this condition, you cast Hush again, or you take Major damage. While Silenced, they can't make noise and can't
  // cast spells."
  // The roll is against the target only; the creatures within Very Close of it (`picked`, passed by the server) are
  // Silenced with it. Silenced is the tag plus the `silenced` flag (can't make noise or cast spells).
  {
    cardId: "hush",
    uses: [
      {
        id: "main",
        name: "Hush",
        activation: { kind: "action" },
        roll: vsTarget,
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        exclusive: true,
        steps: [
          payHope,
          {
            kind: "effect",
            to: "targets",
            when: ["hit"],
            label: "Silenced (Hush)",
            mods: [{ kind: "flag", flag: "silenced" }],
            duration: "manual",
            endsWhen: "the GM spends a Fear on their turn to clear it, you cast Hush again, or you take Major damage",
          },
          {
            kind: "effect",
            to: "picked",
            pick: { side: "any", range: "veryClose", count: { kind: "all" }, area: "aroundTarget", areaRange: "veryClose" },
            when: ["hit"],
            label: "Silenced (Hush)",
            mods: [{ kind: "flag", flag: "silenced" }],
            duration: "manual",
            endsWhen: "the GM spends a Fear on their turn to clear it, you cast Hush again, or you take Major damage",
          },
          {
            kind: "manual",
            to: "targets",
            when: ["hit"],
            text: "The silence follows the target as they move: anything that comes within Very Close range of them is Silenced too, and anything that leaves the area is not.",
          },
        ],
      },
    ],
  },

  // Phantom Retreat (L5, CB p.336): "Spend a Hope to activate Phantom Retreat where you're currently standing. Spend
  // another Hope at any time before your next rest to disappear from where you are and reappear where you were standing
  // when you activated Phantom Retreat. This spell ends after you reappear."
  {
    cardId: "phantom-retreat",
    uses: [
      {
        id: "main",
        name: "Phantom Retreat",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        exclusive: true,
        steps: [
          { kind: "effect", to: "self", label: "Phantom Retreat", mods: [], duration: "rest" },
          { kind: "manual", to: "self", text: "Note the square where you're standing: you reappear there when you return." },
        ],
      },
      {
        id: "return",
        name: "Phantom Retreat: reappear",
        activation: { kind: "action" },
        requires: [{ kind: "effectActive", cardId: "phantom-retreat" }],
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [
          { kind: "move", to: "self", mode: "teleport", note: "Reappear where you were standing when you activated Phantom Retreat" },
          { kind: "manual", to: "self", text: "This spell ends after you reappear: end your Phantom Retreat effect." },
        ],
      },
    ],
  },

  // Dark Whispers (L6, CB p.336): "You can speak into the mind of any person with whom you've made physical contact.
  // Once you've opened a channel with them, they can speak back into your mind. Additionally, you can mark a Stress to
  // make a Spellcast Roll against them. On a success, you can ask the GM one of the following questions and receive an
  // answer: • Where are they? • What are they doing? • What are they afraid of? • What do they cherish most in the world?"
  {
    cardId: "dark-whispers",
    uses: [
      {
        id: "main",
        name: "Dark Whispers: ask a question",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.darkWhispers }],
        costs: [{ kind: "stress", amount: n(1) }],
        roll: vsTarget,
        targets: { side: "any", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
        steps: [
          {
            kind: "choose",
            id: "question",
            label: "Ask the GM one question",
            when: ["hit"],
            options: [
              { id: "where", label: "Where are they?", steps: [{ kind: "manual", to: "self", text: "Ask the GM: Where are they?" }] },
              { id: "doing", label: "What are they doing?", steps: [{ kind: "manual", to: "self", text: "Ask the GM: What are they doing?" }] },
              { id: "afraid", label: "What are they afraid of?", steps: [{ kind: "manual", to: "self", text: "Ask the GM: What are they afraid of?" }] },
              {
                id: "cherish",
                label: "What do they cherish most in the world?",
                steps: [{ kind: "manual", to: "self", text: "Ask the GM: What do they cherish most in the world?" }],
              },
            ],
          },
        ],
      },
      {
        id: "channel",
        name: "Dark Whispers: speak into their mind",
        activation: { kind: "action" },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.darkWhispers }],
        targets: { side: "any", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
        steps: [{ kind: "manual", to: "targets", text: "Speak into their mind; once the channel is open, they can speak back into yours." }],
      },
    ],
  },

  // Midnight-Touched (L7, CB p.337): "When 4 or more of the domain cards in your loadout are from the Midnight domain,
  // gain the following benefits: • Once per rest, when you have 0 Hope and the GM would gain a Fear, you can gain a Hope
  // instead. • When you make a successful attack, you can mark a Stress to add the result of your Fear Die to your
  // damage roll."
  // The Fear Die's value is a dialog number (`fearDie`, 1-12) because no number source reads the host roll's dice.
  {
    cardId: "midnight-touched",
    uses: [
      {
        id: "hope",
        name: "Midnight-Touched: a Hope instead of the GM's Fear",
        activation: { kind: "reaction", trigger: { kind: "gmWouldGainFear" } },
        requires: [
          { kind: "loadoutDomainCount", domain: "midnight", min: 4 },
          { kind: "hopeAtMost", value: 0 },
        ],
        limit: { per: "rest" },
        steps: [
          { kind: "negate", to: "self", what: "effect", note: "The GM doesn't gain that Fear." },
          { kind: "hope", to: "self", change: "gain", amount: n(1) },
        ],
      },
      {
        id: "fear-die",
        name: "Midnight-Touched: add your Fear Die",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        requires: [{ kind: "loadoutDomainCount", domain: "midnight", min: 4 }],
        choices: [{ id: "fearDie", label: "Your Fear Die's result", min: 1, max: n(12) }],
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: { kind: "chosen", choice: "fearDie" } } }],
      },
    ],
  },

  // Vanishing Dodge (L7, CB p.337): "When an attack made against you that would deal physical damage fails, you can spend
  // a Hope to envelop yourself in shadow, becoming Hidden and teleporting to a point within Close range of the attacker.
  // You remain Hidden until the next time you make an action roll."
  {
    cardId: "vanishing-dodge",
    uses: [
      {
        id: "main",
        name: "Vanishing Dodge",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "failed", damageType: "physical" } },
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [
          { kind: "condition", to: "self", condition: { kind: "standard", condition: "hidden" }, duration: "nextRoll" },
          { kind: "move", to: "self", mode: "teleport", range: "close", relativeTo: "triggerSource", note: "Teleport to a point within Close range of the attacker" },
        ],
      },
    ],
  },

  // Shadowhunter (L8, CB p.337): "Your prowess is enhanced under the cover of shadow. While you're shrouded in low light
  // or darkness, you gain a +1 bonus to your Evasion and make attack rolls with advantage."
  {
    cardId: "shadowhunter",
    uses: [
      {
        id: "main",
        name: "Shadowhunter",
        activation: { kind: "passive" },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.shadowhunter }],
        mods: [
          { kind: "stat", stat: "evasion", delta: n(1) },
          { kind: "advantage", on: "attack" },
        ],
        steps: [],
      },
    ],
  },

  // Spellcharge (L8, CB p.337): "When you take magic damage, place tokens equal to the number of Hit Points you marked on
  // this card. You can store a number of tokens equal to your Spellcast trait. When you make a successful attack against
  // a target, you can spend any number of tokens to add a d6 for each token spent to your damage roll."
  // The trigger's amount is the HP you marked (types.ts `triggerAmount`).
  {
    cardId: "spellcharge",
    uses: [
      {
        id: "spend",
        name: "Spellcharge: spend tokens",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        choices: [{ id: "tokens", label: "Tokens to spend", min: 1, max: { kind: "cardTokens" } }],
        costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }],
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            when: ["hit"],
            change: { kind: "add", amount: { kind: "dice", dice: { count: { kind: "spent", resource: "tokens" }, sides: 6 } } },
          },
        ],
      },
      {
        id: "charge",
        name: "Spellcharge: store magic damage",
        activation: { kind: "auto", trigger: { kind: "whenYouTakeDamage", damageType: "magic" } },
        steps: [{ kind: "tokens", to: "self", op: "add", amount: { kind: "triggerAmount" }, max: { kind: "spellcast" } }],
      },
    ],
  },

  // Night Terror (L9, CB p.337): "Once per long rest, choose any targets within Very Close range to perceive you as a
  // nightmarish horror. The targets must succeed on a Reaction Roll (16) or become temporarily Horrified. While
  // Horrified, they're Vulnerable. Steal a number of Fear from the GM equal to the number of targets that are Horrified
  // (up to the number of Fear in the GM's pool). Roll a number of d6s equal to the number of stolen Fear and deal the
  // total damage to each Horrified target. Discard the stolen Fear."
  // The damage step comes before the Fear step so both read the GM's pool before the theft; the dice are rolled once and
  // dealt to each Horrified target (R9). The damage type isn't printed; it is magic (a spell).
  {
    cardId: "night-terror",
    uses: [
      {
        id: "main",
        name: "Night Terror",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        targets: { side: "enemy", range: "veryClose", count: { kind: "any" } },
        steps: [
          {
            kind: "save",
            to: "targets",
            difficulty: { kind: "fixed", value: 16 },
            onFail: [{ kind: "condition", to: "targets", condition: horrified, duration: "temporary" }],
            onSuccess: [],
          },
          {
            kind: "damage",
            to: "targets",
            when: [{ kind: "targetHas", condition: horrified }],
            roll: { kind: "dice", dice: { count: stolenFear, sides: 6 } },
            type: "magic",
          },
          { kind: "fear", to: "self", change: "lose", amount: stolenFear, note: "The stolen Fear is discarded." },
        ],
      },
    ],
  },

  // Twilight Toll (L9, CB p.337): "Choose a target within Far range. When you succeed on an action roll against them that
  // doesn't result in making a damage roll, place a token on this card. When you deal damage to this target, spend any
  // number of tokens to add a d12 for each token spent to your damage roll. You can only hold Twilight Toll on one
  // creature at a time. When you choose a new target or take a rest, clear all unspent tokens."
  {
    cardId: "twilight-toll",
    uses: [
      {
        id: "main",
        name: "Twilight Toll",
        activation: { kind: "action" },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        exclusive: true,
        steps: [
          { kind: "tokens", to: "self", op: "clear" },
          { kind: "condition", to: "targets", condition: tollTag, duration: "manual", endsWhen: "you choose a new target for Twilight Toll" },
        ],
      },
      {
        id: "toll",
        name: "Twilight Toll: place a token",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "action", result: "success" } },
        requires: [{ kind: "situation", text: MIDNIGHT_SITUATIONS.twilightToll }],
        steps: [{ kind: "tokens", to: "self", when: [{ kind: "targetHas", condition: tollTag }], op: "add", amount: n(1) }],
      },
      {
        id: "strike",
        name: "Twilight Toll: spend tokens",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        choices: [{ id: "tokens", label: "Tokens to spend", min: 1, max: { kind: "cardTokens" } }],
        steps: [
          { kind: "pay", when: ["hit", { kind: "targetHas", condition: tollTag }], costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "tokens" } }] },
          {
            kind: "modifyDamage",
            to: "targets",
            when: ["hit", { kind: "targetHas", condition: tollTag }],
            change: { kind: "add", amount: { kind: "dice", dice: { count: { kind: "spent", resource: "tokens" }, sides: 12 } } },
          },
        ],
      },
      {
        id: "rest",
        name: "Twilight Toll: clear tokens on a rest",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterRest" } },
        steps: [{ kind: "tokens", to: "self", op: "clear" }],
      },
    ],
  },

  // Eclipse (L10, CB p.337): "Make a Spellcast Roll (16). Once per long rest on a success, plunge the entire area within
  // Far range into complete darkness only you and your allies can see through. Attack rolls have disadvantage when
  // targeting you or an ally within this shadow. Additionally, when you or an ally succeeds with Hope against an
  // adversary within this shadow, the target must mark a Stress. This spell lasts until the GM spends a Fear on their
  // turn to clear this effect or you take Severe damage."
  // You and the allies within Far (`allies`, passed by the server) get the effect; your own successes with Hope mark the
  // Stress by themselves (`shadow`); an ally's is a manual step.
  {
    cardId: "eclipse",
    uses: [
      {
        id: "main",
        name: "Eclipse",
        activation: { kind: "action" },
        limit: { per: "longRest", consumedOn: "success" },
        roll: vsFixed(16),
        steps: [
          {
            kind: "effect",
            to: "selfAndAllies",
            pick: { side: "ally", range: "far", count: { kind: "all" } },
            when: ["success"],
            label: "Eclipse",
            mods: [{ kind: "disadvantageAgainst", on: "attack" }],
            duration: "manual",
            endsWhen: "the GM spends a Fear on their turn to clear it, or the caster takes Severe damage",
          },
          {
            kind: "manual",
            to: "self",
            when: ["success"],
            text: "The area within Far range is in complete darkness only you and your allies can see through. When an ally succeeds with Hope against an adversary within this shadow, the target must mark a Stress.",
          },
        ],
      },
      {
        id: "shadow",
        name: "Eclipse: success with Hope",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "successWithHope" } },
        requires: [{ kind: "effectActive", cardId: "eclipse" }],
        steps: [{ kind: "markStress", to: "targets", when: ["hit"], amount: n(1) }],
      },
    ],
  },

  // Specter of the Dark (L10, CB p.337): "Mark a Stress to become Spectral until you make an action roll targeting another
  // creature. While Spectral, you're immune to physical damage and can float and pass through solid objects. Other
  // creatures can still see you while you're in this form."
  {
    cardId: "specter-of-the-dark",
    uses: [
      {
        id: "main",
        name: "Specter of the Dark",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Spectral: float and pass through solid objects",
            mods: [{ kind: "resistance", type: "physical", level: "immune" }],
            duration: "manual",
            endsWhen: "you make an action roll targeting another creature",
          },
        ],
      },
    ],
  },
];
