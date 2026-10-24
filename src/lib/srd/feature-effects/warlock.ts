// Feature effects of Warlock (FE-warlock) (plan sheet-drawer). Pure data: no framework imports, relative imports only
// (bundled into Convex). Each entry quotes its feature with the printed page and uses only the vocabulary of
// src/lib/domain/card-effects/types.ts (a gap is a `manual` step plus a bead).
//
// All 15 Warlock features are classified combat (./classification.ts), so each has exactly one entry. Book: HF p.14
// (Warlock: Patron's Boon, Patron's Pact, Favor; Pact of the Endless) and HF p.15 (Pact of the Wrathful). Readings,
// manual steps and open rulings: docs/tasks/TASK-SD-FE-warlock.md.
//
// - A Favor cost is a `tokens` cost from the `favor` pool (NV1); "spend any number of Favor" is a `chosen` amount, and
//   "an equal number" reads it back as `spent: favor`.
// - Patron Dice are the class die (`sidesOf: "patron"`): "Your Patron Die starts at a d6 and increases to a d8 at level
//   5" (HF p.14), read from `actor.dieSides` (feature-effects/run.ts `actorExtras`), so no upgrade entry is needed.
// - "Your tier" is `byTier` [1, 2, 3, 4].
// - Every halving rounds up (Q6, CB p.107); "until … the scene ends" is the `scene` duration (Q7).
// - Before-roll answers to an adversary's attack (Harrowing Invocation, Draining Bane) use the `targeted` stage (Q2).

import type { ConditionRef, Cost, DiceExpr, NumberSource, Requirement } from "../../domain/card-effects/types";
import type { FeatureEffect } from "../../domain/feature-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const tier: NumberSource = { kind: "byTier", values: [1, 2, 3, 4] };
/** "spend a Favor" (NV1). */
const aFavor: Cost = { kind: "tokens", amount: n(1), pool: "favor" };
/** "spend any number of Favor": the player's number in the `favor` choice. */
const anyFavor: Cost = { kind: "tokens", amount: { kind: "chosen", choice: "favor" }, pool: "favor" };
const favorChoice = { id: "favor", label: "Favor to spend", min: 1 } as const;
/** `count` Patron Dice (d6, d8 from level 5; HF p.14). */
const patronDice = (count: NumberSource): DiceExpr => ({ count, sides: 6, sidesOf: "patron" });
/** "For each result of 4 or higher" (NV12). */
const fourOrHigher = (count: NumberSource): NumberSource => ({ kind: "dice", dice: patronDice(count), keep: "countAtLeast", atLeast: 4 });
const situation = (text: string): Requirement => ({ kind: "situation", text });

/** The tag Harrowing Invocation leaves on the attacker for its one attack, so the failed-attack use knows it. */
export const HARROWED: ConditionRef = { kind: "tag", tag: "Harrowing Invocation" };

const ENDLESS = "pact-of-the-endless";
const WRATHFUL = "pact-of-the-wrathful";

export const WARLOCK_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Hope feature and class features (HF p.14)

  // Patron's Boon (Warlock's Hope Feature, HF p.14): "When you fail a roll, you can spend 3 Hope to reroll with advantage."
  // Q1: an after-roll answer on the warlock's own failed roll; the reroll (all the roll's dice, with one more advantage)
  // is a fold the after-roll step (SD5) applies, and the new result stands (CB p.107).
  {
    featureId: "hope:warlock",
    source: "hope",
    owner: "warlock",
    uses: [
      {
        id: "main",
        name: "Patron’s Boon",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "any", result: "failure" } },
        costs: [{ kind: "hope", amount: n(3) }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "reroll", dice: "all", advantage: true }, note: "Reroll with advantage." }],
      },
    ],
  },

  // Patron's Pact (class feature, HF p.14): "… work with your GM to determine their sphere of influence … Before making an
  // action roll that relates to your patron's sphere of influence, you can spend a Favor to call upon their aid, rolling
  // your Patron Die and adding its result to the total. Your Patron Die starts at a d6 and increases to a d8 at level 5."
  // A rider before the action roll; the sphere is the player's check box (Q13). The die is rolled and added to this roll
  // (a fold), so no held die is left over. The Party sheet's D5 class action (`patronsPact`) spends the same Favor.
  {
    featureId: "class:warlock:patrons-pact",
    source: "class",
    owner: "warlock",
    uses: [
      {
        id: "main",
        name: "Patron’s Pact",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        requires: [situation("This action roll relates to your patron’s sphere of influence")],
        costs: [aFavor],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: { kind: "dice", dice: patronDice(n(1)) } }, note: "Add your Patron Die to the total." }],
      },
    ],
  },

  // Favor (class feature, HF p.14): "You start with 3 Favor. You can use a downtime move to show tribute to your patron.
  // Describe how and gain Favor equal to your Spellcast trait. Additionally, when you succeed on an action roll with
  // Hope, you can choose to gain a Favor instead of a Hope."
  // The start (D5 session start) and the tribute (the rest move, convex/lib/restHooks.ts) stay out of combat. In combat:
  // "you can choose" is a Use / Pass after the roll (Q1), so the entry is a reaction, not the classification's `auto`.
  // The trigger cannot say "success with Hope" (vocabulary gap), so "with Hope" is the player's check box (Q13); on a
  // roll that gave no Hope the server's fold takes nothing.
  {
    featureId: "class:warlock:favor",
    source: "class",
    owner: "warlock",
    uses: [
      {
        id: "main",
        name: "Favor instead of Hope",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "success" } },
        requires: [situation("The action roll succeeded with Hope")],
        steps: [{ kind: "replaceHopeGain", to: "self", with: "favor", note: "Gain a Favor instead of a Hope." }],
      },
    ],
  },

  // ---------------------------------------------------------------- Pact of the Endless (HF p.14)

  // Patron's Mantle (foundation, HF p.14): "Spend a Favor to cloak yourself in a terrifying aspect of your Patron that
  // lasts until you take Severe damage or the scene ends. While this effect is active, you gain a bonus to your damage
  // thresholds equal to your tier and have advantage on action rolls to intimidate a target."
  // Thresholds are mods; the advantage only on intimidation has no roll filter (vocabulary gap): it is in the effect's
  // label and a manual step.
  {
    featureId: `subclass:${ENDLESS}:patrons-mantle`,
    source: "subclass",
    owner: ENDLESS,
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Patron’s Mantle",
        activation: { kind: "action" },
        costs: [aFavor],
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Patron’s Mantle: +tier to damage thresholds, advantage on action rolls to intimidate",
            mods: [
              { kind: "stat", stat: "majorThreshold", delta: tier },
              { kind: "stat", stat: "severeThreshold", delta: tier },
            ],
            duration: "scene",
            endsOn: ["takeSevere"],
          },
          { kind: "manual", to: "self", text: "While Patron’s Mantle lasts, you have advantage on action rolls to intimidate a target." },
        ],
      },
    ],
  },

  // Deathless Embrace (foundation, HF p.14): "Once per rest, spend any number of Favor to roll an equal number of Patron
  // Dice. For each result of 4 or higher, clear a Hit Point."
  {
    featureId: `subclass:${ENDLESS}:deathless-embrace`,
    source: "subclass",
    owner: ENDLESS,
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Deathless Embrace",
        activation: { kind: "action" },
        limit: { per: "rest" },
        choices: [favorChoice],
        costs: [anyFavor],
        steps: [{ kind: "clear", to: "self", track: "hp", amount: fourOrHigher({ kind: "spent", resource: "favor" }) }],
      },
    ],
  },

  // Harrowing Invocation (specialization, HF p.14): "When an adversary targets you or an ally within Very Close range with
  // an attack, you can spend a Favor to give them disadvantage on the roll. If the adversary fails the roll, they must
  // also mark a Stress."
  // Q2: a before-roll answer (`targeted`). The disadvantage is a one-roll effect on the attacker; the attacker also carries
  // the feature's tag for that roll, and the `failed` use marks its Stress when that attack fails (no Favor: it is the
  // same activation). SD4 must match `failed` triggers before the roll's `nextRoll` effects end.
  {
    featureId: `subclass:${ENDLESS}:harrowing-invocation`,
    source: "subclass",
    owner: ENDLESS,
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Harrowing Invocation",
        activation: {
          kind: "reaction",
          trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", subjectWithin: "veryClose", stage: "targeted" },
        },
        costs: [aFavor],
        targets: { side: "trigger", who: "source" },
        steps: [
          { kind: "effect", to: "targets", label: "Harrowing Invocation: disadvantage on this attack", mods: [{ kind: "flag", flag: "attackDisadvantage" }], duration: "nextRoll" },
          { kind: "condition", to: "targets", condition: HARROWED, duration: "nextRoll" },
        ],
      },
      {
        id: "failed",
        name: "Harrowing Invocation: the attack failed",
        activation: {
          kind: "auto",
          trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", subjectWithin: "veryClose", stage: "failed" },
        },
        targets: { side: "trigger", who: "source" },
        steps: [{ kind: "markStress", to: "targets", when: [{ kind: "targetHas", condition: HARROWED }], amount: n(1), note: "If the adversary fails the roll, they must also mark a Stress." }],
      },
    ],
  },

  // Damage Sink (specialization, HF p.14): "Once per rest, you can spend a Favor to halve incoming damage."
  // Incoming damage is the amount the PC is receiving now (CB p.107): the reaction window of the hit; halving rounds up (Q6).
  {
    featureId: `subclass:${ENDLESS}:damage-sink`,
    source: "subclass",
    owner: ENDLESS,
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Damage Sink",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        limit: { per: "rest" },
        costs: [aFavor],
        steps: [{ kind: "modifyDamage", to: "self", change: { kind: "halve" } }],
      },
    ],
  },

  // Dark Aegis (mastery, HF p.14): "Once per long rest when you would take damage, you can spend a Favor instead of
  // marking Hit Points."
  // The damage is still taken (its severity counts for "until you take Severe damage"); no Hit Points are marked. One hit
  // marks at most 4 Hit Points (Massive damage, CB p.91), so "4 fewer" marks none.
  {
    featureId: `subclass:${ENDLESS}:dark-aegis`,
    source: "subclass",
    owner: ENDLESS,
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Dark Aegis",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        limit: { per: "longRest" },
        costs: [aFavor],
        steps: [{ kind: "adjustHpMarked", to: "self", change: "fewer", amount: n(4), note: "Spend a Favor instead of marking Hit Points." }],
      },
    ],
  },

  // Draining Bane (mastery, HF p.14): "When an adversary targets you or an ally within Very Close range with an attack, you
  // can spend a Favor to Drain them. When you do, they must mark a Stress, and you can clear a Stress. While Drained, the
  // target uses a d12 instead of a d20 for attack rolls (including for advantage or disadvantage) until they fail a roll."
  // Q2: a before-roll answer, so the d12 applies to this attack too. "You can clear a Stress" is an optional step.
  {
    featureId: `subclass:${ENDLESS}:draining-bane`,
    source: "subclass",
    owner: ENDLESS,
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Draining Bane",
        activation: {
          kind: "reaction",
          trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", subjectWithin: "veryClose", stage: "targeted" },
        },
        costs: [aFavor],
        targets: { side: "trigger", who: "source" },
        steps: [
          { kind: "markStress", to: "targets", amount: n(1) },
          { kind: "optional", id: "clear-stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: n(1) }] },
          {
            kind: "effect",
            to: "targets",
            label: "Drained: d12 instead of d20 for attack rolls (also for advantage or disadvantage)",
            mods: [{ kind: "set", stat: "attackDie", to: n(12) }],
            duration: "manual",
            endsWhen: "until they fail a roll",
            endsOn: ["bearerFails"],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Pact of the Wrathful (HF p.15)

  // Patron's Fury (foundation, HF p.15): "Spend a Favor to imbue your attacks with your Patron's power until you deal Severe
  // damage or the scene ends. When you roll damage while this effect is active, you also roll a number of Patron Dice
  // equal to your tier and add their total to the damage dealt."
  // `main` starts the effect; `damage` adds the dice by itself on each damage roll while it is active ("you also roll").
  {
    featureId: `subclass:${WRATHFUL}:patrons-fury`,
    source: "subclass",
    owner: WRATHFUL,
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Patron’s Fury",
        activation: { kind: "action" },
        costs: [aFavor],
        steps: [{ kind: "effect", to: "self", label: "Patron’s Fury: +tier Patron Dice to your damage rolls", mods: [], duration: "scene", endsOn: ["dealSevere"] }],
      },
      {
        id: "damage",
        name: "Patron’s Fury: Patron Dice",
        activation: { kind: "auto", trigger: { kind: "beforeYouRoll", roll: "damage" } },
        requires: [
          {
            kind: "situation",
            text: "Patron’s Fury is active",
            check: { kind: "featureEffect", featureId: `subclass:${WRATHFUL}:patrons-fury` },
          },
        ],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: patronDice(tier) } } }],
      },
    ],
  },

  // Deadly Vengeance (foundation, HF p.15): "When you mark any number of Hit Points from an attack, you can spend a Favor to
  // roll an equal number of Patron Dice. For each result of 4 or higher, the attacker marks a Hit Point."
  // The trigger's amount is the Hit Points marked.
  {
    featureId: `subclass:${WRATHFUL}:deadly-vengeance`,
    source: "subclass",
    owner: WRATHFUL,
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Deadly Vengeance",
        activation: { kind: "reaction", trigger: { kind: "whenYouMarkHp", fromAttack: true } },
        costs: [aFavor],
        targets: { side: "trigger", who: "source" },
        steps: [{ kind: "markHp", to: "targets", amount: fourOrHigher({ kind: "triggerAmount" }) }],
      },
    ],
  },

  // Menacing Reach (specialization, HF p.15): "Spend a Favor to increase the range of your primary weapon by one step (such
  // as Melee to Very Close or Very Close to Close) to a maximum of Very Far range. This effect ends when you make a
  // successful attack with that weapon."
  // No other end is printed (no scene end). The cap at Very Far is the range engine's (the last Defined Range, CB p.103).
  {
    featureId: `subclass:${WRATHFUL}:menacing-reach`,
    source: "subclass",
    owner: WRATHFUL,
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Menacing Reach",
        activation: { kind: "action" },
        costs: [aFavor],
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Menacing Reach: primary weapon range +1 step (at most Very Far)",
            mods: [{ kind: "stat", stat: "primaryRange", delta: n(1) }],
            duration: "manual",
            endsWhen: "when you make a successful attack with your primary weapon",
            endsOn: ["attackSucceeds"],
          },
        ],
      },
    ],
  },

  // Diminish My Foes (specialization, HF p.15): "When you succeed with Hope on an action roll against a target, you can
  // spend any number of Favor to force the target to mark an equal number of Stress."
  // A rider after the warlock's own roll on the move's target. As with Favor, "with Hope" is the player's check box.
  {
    featureId: `subclass:${WRATHFUL}:diminish-my-foes`,
    source: "subclass",
    owner: WRATHFUL,
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Diminish My Foes",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "action", result: "success" } },
        requires: [situation("The action roll against a target succeeded with Hope")],
        choices: [favorChoice],
        costs: [anyFavor],
        steps: [{ kind: "markStress", to: "targets", amount: { kind: "spent", resource: "favor" } }],
      },
    ],
  },

  // Fearsome Attack (mastery, HF p.15): "Spend a Favor to reroll any number of your damage dice. You can continue spending
  // Favor to use this feature on the same damage roll."
  // A rider after the damage roll; the player picks the dice (`damageDice.reroll`) and the new results stand (CB p.107).
  // It has no limit, so each further Favor is another use on the same damage roll.
  {
    featureId: `subclass:${WRATHFUL}:fearsome-attack`,
    source: "subclass",
    owner: WRATHFUL,
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Fearsome Attack",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "damage" } },
        costs: [aFavor],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "rerollChosen" } }],
      },
    ],
  },

  // Otherworldly Ire (mastery, HF p.15): "Once per rest when you take damage, you can spend any number of Favor to roll that
  // many Patron Dice and target a number of creatures within Close range equal to the highest result. Each target must
  // mark a Hit Point."
  // The targets are picked after the dice show how many, which one use cannot do (vocabulary gap): the Favor and the dice
  // are automated (the check step shows the results), the targets and their Hit Points are a manual step.
  {
    featureId: `subclass:${WRATHFUL}:otherworldly-ire`,
    source: "subclass",
    owner: WRATHFUL,
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Otherworldly Ire",
        activation: { kind: "reaction", trigger: { kind: "whenYouTakeDamage" } },
        limit: { per: "rest" },
        choices: [favorChoice],
        costs: [anyFavor],
        steps: [
          {
            kind: "check",
            dice: patronDice({ kind: "spent", resource: "favor" }),
            test: { kind: "anyAtLeast", value: 1 },
            note: "Roll that many Patron Dice.",
            then: [
              {
                kind: "manual",
                to: "self",
                text: "Target a number of creatures within Close range equal to the highest Patron Die result. Each target must mark a Hit Point.",
              },
            ],
            otherwise: [],
          },
        ],
      },
    ],
  },
];
