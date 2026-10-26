// Feature effects of Bard and Wizard (FE-bard-wizard) (plan sheet-drawer). SD0 shipped the table empty; this tracer fills it.
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page and uses only the vocabulary of src/lib/domain/card-effects/types.ts (a gap is a `manual` step plus a bead).
//
// One entry per Bard and Wizard feature classified combat or passive in ./classification.ts (19). Out of combat or
// narrative (no entry): Heart of a Poet (social, Q15 b roll option), Prestidigitation, Prepared, Accomplished, Brilliant
// (build-time domain cards). Readings, manual steps and open rulings: docs/tasks/TASK-SD-FE-bard-wizard.md.
// Book: CB p.28 (Bard, Troubadour), CB p.29 (Wordsmith), CB p.50 (Wizard, School of Knowledge), CB p.51 (School of War).

import type { CardUse, Cost, NumberSource, TargetSpec } from "../../domain/card-effects/types";
import type { FeatureEffect } from "../../domain/feature-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const ONE = fixed(1);
const HOPE_FEATURE_COST: readonly Cost[] = [{ kind: "hope", amount: fixed(3) }];

/** "You and all allies within Close range" (Relaxing Song, Heartbreaking Song): the server passes the allies in range. */
const ALLIES_CLOSE: TargetSpec = { side: "ally", range: "close", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true };

const VIRTUOSO = "subclass:troubadour:virtuoso";
const EPIC_POETRY = "subclass:wordsmith:epic-poetry";
const FUELED_BY_FEAR = "subclass:school-of-war:fueled-by-fear";
const HAVE_NO_FEAR = "subclass:school-of-war:have-no-fear";

/** A passive feature with no use of its own: an upgrade of another entry, or a stat the sheet already derives. */
const marker = (name: string): CardUse => ({ id: "main", name, activation: { kind: "passive" }, mods: [], steps: [] });

/** A Gifted Performer song: "You can play each song once per long rest" (CB p.28); one limit per song. */
const song = (id: string, name: string, rest: Omit<CardUse, "id" | "name" | "activation" | "limit">): CardUse => ({
  id,
  name,
  activation: { kind: "action" },
  limit: { per: "longRest" },
  ...rest,
});

export const BARD_WIZARD_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Bard (CB p.28)

  // Make a Scene (Bard's Hope feature, CB p.28): "Spend 3 Hope to temporarily Distract a target within Close range, giving
  // them a -2 penalty to their Difficulty." No roll: the condition and the penalty land at once; both are temporary
  // (CB p.102), so the GM clears them in the tracker. D5's `makeAScene` is an assist with no state, so no delegate.
  {
    featureId: "hope:bard",
    source: "hope",
    owner: "bard",
    uses: [
      {
        id: "main",
        name: "Make a Scene",
        activation: { kind: "action" },
        costs: HOPE_FEATURE_COST,
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [
          { kind: "condition", to: "targets", condition: { kind: "standard", condition: "distracted" }, duration: "temporary" },
          {
            kind: "effect",
            to: "targets",
            label: "Distracted (Make a Scene)",
            mods: [{ kind: "stat", stat: "difficulty", delta: fixed(-2) }],
            duration: "temporary",
            note: "-2 to their Difficulty while Distracted",
          },
        ],
      },
    ],
  },

  // Rally (Bard class feature, CB p.28): "Once per session, describe how you rally the party and give yourself and each
  // of your allies a Rally Die. At level 1, your Rally Die is a d6. A PC can spend their Rally Die to roll it, adding the
  // result to their action roll, reaction roll, damage roll, or to clear a number of Stress equal to the result. At the
  // end of each session, clear all unspent Rally Dice. At level 5, your Rally Die increases to a d8."
  // Epic Poetry (CB p.29): "Your Rally Die increases to a d10."
  // D5's `rally` gives the dice and writes its own once-per-session key (no `limit` here, so it is not counted twice);
  // spending a Rally Die is the roll options' job (held dice, D5).
  {
    featureId: "class:bard:rally",
    source: "class",
    owner: "bard",
    uses: [{ id: "main", name: "Rally", activation: { kind: "action" }, steps: [{ kind: "delegate", to: "self", feature: "rally" }] }],
    upgrades: [
      { when: { kind: "level", atLeast: 5 }, patch: { dieSides: 8 }, note: "level 5" },
      { when: { kind: "feature", featureId: EPIC_POETRY }, patch: { dieSides: 10 }, note: "Epic Poetry" },
    ],
  },

  // Gifted Performer (Troubadour foundation, CB p.28): "Describe how you perform for others. You can play each song once
  // per long rest: • Relaxing Song: You and all allies within Close range clear a Hit Point. • Epic Song: Make a target
  // within Close range temporarily Vulnerable. • Heartbreaking Song: You and all allies within Close range gain a Hope."
  // Virtuoso (Troubadour mastery, CB p.28): "You can perform each of your 'Gifted Performer' feature's songs twice instead
  // of once per long rest."
  {
    featureId: "subclass:troubadour:gifted-performer",
    source: "subclass",
    owner: "troubadour",
    card: "foundation",
    uses: [
      song("relaxing", "Relaxing Song", {
        steps: [{ kind: "clear", to: "selfAndAllies", pick: ALLIES_CLOSE, track: "hp", amount: ONE }],
      }),
      song("epic", "Epic Song", {
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }],
      }),
      song("heartbreaking", "Heartbreaking Song", {
        steps: [{ kind: "hope", to: "selfAndAllies", pick: ALLIES_CLOSE, change: "gain", amount: ONE }],
      }),
    ],
    upgrades: [{ when: { kind: "feature", featureId: VIRTUOSO }, patch: { limitTimes: 2 }, note: "Virtuoso" }],
  },

  // Maestro (Troubadour specialization, CB p.28): "Your rallying songs steel the courage of those who listen. When you give
  // a Rally Die to an ally, they can gain a Hope or clear a Stress."
  // Runs once per ally given a die (the trigger's subject); the ally picks (dcm-bz8, per-recipient choice).
  {
    featureId: "subclass:troubadour:maestro",
    source: "subclass",
    owner: "troubadour",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Maestro",
        activation: { kind: "auto", trigger: { kind: "whenYouGiveDie", die: "rally" } },
        targets: { side: "trigger", who: "subject" },
        steps: [
          {
            kind: "choose",
            id: "benefit",
            label: "Your ally gains a Hope or clears a Stress",
            options: [
              { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "triggerSubject", change: "gain", amount: ONE }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "triggerSubject", track: "stress", amount: ONE }] },
            ],
          },
        ],
      },
    ],
  },

  // Virtuoso (Troubadour mastery, CB p.28): "You can perform each of your 'Gifted Performer' feature's songs twice instead
  // of once per long rest." The upgrade lives on Gifted Performer; this entry is the badge.
  { featureId: VIRTUOSO, source: "subclass", owner: "troubadour", card: "mastery", uses: [marker("Virtuoso")] },

  // ---------------------------------------------------------------- Wordsmith (CB p.29)

  // Rousing Speech (Wordsmith foundation, CB p.29): "Once per long rest, you can give a heartfelt, inspiring speech. All
  // allies within Far range clear 2 Stress."
  {
    featureId: "subclass:wordsmith:rousing-speech",
    source: "subclass",
    owner: "wordsmith",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Rousing Speech",
        activation: { kind: "action" },
        limit: { per: "longRest" },
        steps: [
          {
            kind: "clear",
            to: "allies",
            pick: { side: "ally", range: "far", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true },
            track: "stress",
            amount: fixed(2),
          },
        ],
      },
    ],
  },

  // Eloquent (Wordsmith specialization, CB p.29): "Your moving words boost morale. Once per session, when you encourage an
  // ally, you can do one of the following: • Allow them to find a mundane object or tool they need. • Help an Ally without
  // spending Hope. • Give them an additional downtime move during their next rest."
  // Help an Ally is the named help of Q12 (CB p.90: "roll a d6 advantage die"); with Epic Poetry it is a d10 (CB p.29).
  {
    featureId: "subclass:wordsmith:eloquent",
    source: "subclass",
    owner: "wordsmith",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Eloquent",
        activation: { kind: "action" },
        limit: { per: "session" },
        targets: { side: "ally", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
        steps: [
          {
            kind: "choose",
            id: "option",
            label: "Encourage your ally",
            options: [
              {
                id: "object",
                label: "They find a mundane object or tool they need",
                steps: [{ kind: "manual", to: "targets", text: "Your ally finds a mundane object or tool they need." }],
              },
              { id: "help", label: "Help an Ally without spending Hope", steps: [{ kind: "help", to: "targets", die: 6, free: true }] },
              {
                id: "downtime",
                label: "An additional downtime move during their next rest",
                // Vocabulary gap dcm-bxp.99.19.2: no step grants an extra downtime move in the rest flow.
                steps: [{ kind: "manual", to: "targets", text: "Your ally takes an additional downtime move during their next rest." }],
              },
            ],
          },
        ],
      },
    ],
    upgrades: [{ when: { kind: "feature", featureId: EPIC_POETRY }, patch: { dieSides: 10 }, note: "Epic Poetry" }],
  },

  // Epic Poetry (Wordsmith mastery, CB p.29): "Your Rally Die increases to a d10. Additionally, when you Help an Ally, you
  // can narrate the moment as if you were writing the tale of their heroism in a memoir. When you do, roll a d10 as your
  // advantage die." The Rally Die is an upgrade on Rally; the Help die is this passive mod (Q12, SD-H reads it).
  {
    featureId: EPIC_POETRY,
    source: "subclass",
    owner: "wordsmith",
    card: "mastery",
    uses: [{ id: "main", name: "Epic Poetry", activation: { kind: "passive" }, mods: [{ kind: "set", stat: "helpDie", to: fixed(10) }], steps: [] }],
  },

  // ---------------------------------------------------------------- Wizard (CB p.50)

  // Not This Time (Wizard's Hope feature, CB p.50): "Spend 3 Hope to force an adversary within Far range to reroll an
  // attack or damage roll." Q3 (a): offered in the reaction window of any adversary hit on any PC when the attacker is
  // within Far of the wizard; the new result stands (CB p.107). Both rerolls are folds the window applies to the
  // attacker's roll: the attack roll's d20, or every damage die (a reroll of any die up to 20 is the whole roll).
  {
    featureId: "hope:wizard",
    source: "hope",
    owner: "wizard",
    uses: [
      {
        id: "main",
        name: "Not This Time",
        activation: { kind: "reaction", trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", attackerWithin: "far", stage: "succeeded" } },
        costs: HOPE_FEATURE_COST,
        targets: { side: "trigger", who: "source" },
        steps: [
          {
            kind: "choose",
            id: "reroll",
            label: "Force the adversary to reroll",
            options: [
              {
                id: "attack",
                label: "The attack roll",
                steps: [{ kind: "modifyRoll", to: "triggerSource", change: { kind: "reroll", dice: "all" }, note: "The adversary rerolls the attack roll" }],
              },
              {
                id: "damage",
                label: "The damage roll",
                steps: [{ kind: "modifyDamage", to: "triggerSource", change: { kind: "reroll", atMost: 20 }, note: "The adversary rerolls every damage die" }],
              },
            ],
          },
        ],
      },
    ],
  },

  // Strange Patterns (Wizard class feature, CB p.50): "Choose a number between 1 and 12. When you roll that number on a
  // Duality Die, gain a Hope or clear a Stress. You can change this number when you take a long rest."
  // D5 keeps the number (`classState.strangeNumber`, set on the sheet: out of combat) and the one-benefit-per-roll mark;
  // the benefit delegates to D5's `strangePatternsBenefit`, which reads the roll (`delegateRoll`) and refuses a roll
  // without the number.
  {
    featureId: "class:wizard:strange-patterns",
    source: "class",
    owner: "wizard",
    uses: [
      {
        id: "main",
        name: "Strange Patterns",
        activation: { kind: "auto", trigger: { kind: "afterYouRoll", roll: "any" } },
        steps: [
          {
            kind: "choose",
            id: "benefit",
            label: "Your number on a Duality Die: gain a Hope or clear a Stress",
            options: [
              { id: "hope", label: "Gain a Hope", steps: [{ kind: "delegate", to: "self", feature: "strangePatternsBenefit", params: { choice: "hope" } }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "delegate", to: "self", feature: "strangePatternsBenefit", params: { choice: "stress" } }] },
            ],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- School of Knowledge (CB p.50)

  // Adept (School of Knowledge foundation, CB p.50): "When you Utilize an Experience, you can mark a Stress instead of
  // spending a Hope. If you do, double your Experience modifier for that roll." The Stress is this rider's cost; the fold
  // tells the roll to spend no Hope for the Experience and to double its modifier.
  {
    featureId: "subclass:school-of-knowledge:adept",
    source: "subclass",
    owner: "school-of-knowledge",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Adept",
        activation: { kind: "rider", trigger: { kind: "whenYouUseExperience" } },
        costs: [{ kind: "stress", amount: ONE }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "experience", change: "payWithStress", double: true } }],
      },
    ],
  },

  // Perfect Recall (School of Knowledge specialization, CB p.50): "Once per rest, when you recall a domain card in your
  // vault, you can reduce its Recall Cost by 1." Vocabulary gap dcm-bxp.99.19.1: no recall trigger and no Recall Cost change, so
  // the use records the limit and leaves the discount to the table.
  {
    featureId: "subclass:school-of-knowledge:perfect-recall",
    source: "subclass",
    owner: "school-of-knowledge",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Perfect Recall",
        activation: { kind: "action" },
        limit: { per: "rest" },
        steps: [{ kind: "manual", to: "self", text: "Reduce the Recall Cost of the domain card you recall from your vault by 1 (mark 1 fewer Stress)." }],
      },
    ],
  },

  // Honed Expertise (School of Knowledge mastery, CB p.50): "When you use an Experience, roll a d6. On a result of 5 or
  // higher, you can use it without spending Hope." The d6 is rolled here; on 5+ the fold tells the roll to spend no Hope.
  {
    featureId: "subclass:school-of-knowledge:honed-expertise",
    source: "subclass",
    owner: "school-of-knowledge",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Honed Expertise",
        activation: { kind: "auto", trigger: { kind: "whenYouUseExperience" } },
        steps: [
          {
            kind: "check",
            dice: { count: ONE, sides: 6 },
            test: { kind: "totalAtLeast", value: 5 },
            then: [{ kind: "modifyRoll", to: "self", change: { kind: "experience", change: "freeOnCheck" }, note: "Use the Experience without spending Hope" }],
            otherwise: [],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- School of War (CB p.51)

  // Battlemage (School of War foundation, CB p.51): "You've focused your studies on becoming an unconquerable force on the
  // battlefield. Gain an additional Hit Point slot." The slot is already derived (src/lib/domain/characters/slots.ts), so
  // the entry carries no mod (it would count twice).
  { featureId: "subclass:school-of-war:battlemage", source: "subclass", owner: "school-of-war", card: "foundation", uses: [marker("Battlemage")] },

  // Face Your Fear (School of War foundation, CB p.51): "When you succeed with Fear on an attack roll, you deal an extra
  // 1d10 magic damage." Fueled by Fear (specialization, CB p.51): "The extra magic damage from your 'Face Your Fear'
  // feature increases to 2d10." Have No Fear (mastery, CB p.51): "… increases to 3d10."
  {
    featureId: "subclass:school-of-war:face-your-fear",
    source: "subclass",
    owner: "school-of-war",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Face Your Fear",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "successWithFear" } },
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: { count: ONE, sides: 10 } }, type: "magic" } }],
      },
    ],
    upgrades: [
      { when: { kind: "feature", featureId: FUELED_BY_FEAR }, patch: { diceCount: fixed(2) }, note: "Fueled by Fear" },
      { when: { kind: "feature", featureId: HAVE_NO_FEAR }, patch: { diceCount: fixed(3) }, note: "Have No Fear" },
    ],
  },

  // Conjure Shield (School of War specialization, CB p.51): "You can maintain a protective barrier of magic. While you have
  // at least 2 Hope, you add your Proficiency to your Evasion."
  {
    featureId: "subclass:school-of-war:conjure-shield",
    source: "subclass",
    owner: "school-of-war",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Conjure Shield",
        activation: { kind: "passive" },
        requires: [{ kind: "situation", text: "While you have at least 2 Hope", check: { kind: "hopeAtLeast", value: 2 } }],
        mods: [{ kind: "stat", stat: "evasion", delta: { kind: "proficiency" } }],
        steps: [],
      },
    ],
  },

  // Fueled by Fear (School of War specialization, CB p.51): "The extra magic damage from your 'Face Your Fear' feature
  // increases to 2d10." The upgrade lives on Face Your Fear.
  { featureId: FUELED_BY_FEAR, source: "subclass", owner: "school-of-war", card: "specialization", uses: [marker("Fueled by Fear")] },

  // Thrive in Chaos (School of War mastery, CB p.51): "When you succeed on an attack, you can mark a Stress after rolling
  // damage to force the target to mark an additional Hit Point." Offered after the damage roll (Q1's after-roll step);
  // one more Hit Point after the thresholds (NV4).
  {
    featureId: "subclass:school-of-war:thrive-in-chaos",
    source: "subclass",
    owner: "school-of-war",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Thrive in Chaos",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        costs: [{ kind: "stress", amount: ONE }],
        steps: [{ kind: "adjustHpMarked", to: "targets", change: "more", amount: ONE }],
      },
    ],
  },

  // Have No Fear (School of War mastery, CB p.51): "The extra magic damage from your 'Face Your Fear' feature increases to
  // 3d10." The upgrade lives on Face Your Fear.
  { featureId: HAVE_NO_FEAR, source: "subclass", owner: "school-of-war", card: "mastery", uses: [marker("Have No Fear")] },
];
