// Feature effects of Assassin and Brawler (plan sheet-drawer, tracer FE-assassin-brawler).
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page (HF = Hope & Fear: Assassin p.8-9, Brawler p.10-11) and uses only the vocabulary of
// src/lib/domain/card-effects/types.ts; a gap is a `manual` step plus a bead (docs/tasks/TASK-SD-FE-assassin-brawler.md).
//
// One entry per feature classified combat or passive (25 of the 28). Not here: Get In & Get Out and Limit Breaker (out of
// combat) and Adder's Blessing (narrative), as classified in ./classification.ts.
//
// Shared readings:
// - "Marked for Death" is a tag on the adversary's instance (`MARKED`); Scorpion's Poise and Twin Fang read it.
// - A feature that only changes another feature (Ambush, Backstab, Poison Compendium, Twin Fang, Venomancer, Flow State)
//   is a passive entry with no mods; the change is an `upgrade` on the feature it changes (NV3), keyed to its id.
// - Flow State changes what Combo Strike and Stance Fighter cost. An upgrade cannot change a use's costs, so both uses pay
//   inside a `choose` step ("cost"), and Flow State adds the other way to pay as an extra option.

import type { ChooseOption, ConditionRef, NumberSource, Step } from "../../domain/card-effects/types";
import type { FeatureEffect } from "../../domain/feature-effects/types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const one = fixed(1);
/** "equal to your tier" (NumberSource has no tier; one value per tier). */
const TIER: NumberSource = { kind: "byTier", values: [1, 2, 3, 4] };

/** The Marked for Death tag on the target (HF p.8). */
export const MARKED_FOR_DEATH = "Marked for Death";
const MARKED: ConditionRef = { kind: "tag", tag: MARKED_FOR_DEATH };

const FLOW_STATE = "subclass:martial-artist:flow-state";
const focus = (amount: NumberSource = one) => ({ kind: "tokens" as const, amount, pool: "focus" as const });

// ---------------------------------------------------------------- poisons (HF p.9)

/** Ghost Petal, Grave Spore, Leech Weed: the poisons Toxic Concoctions knows. */
const BASE_POISONS: readonly ChooseOption[] = [
  {
    id: "ghost-petal",
    label: "Ghost Petal: the target becomes temporarily Vulnerable",
    steps: [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }],
  },
  {
    id: "grave-spore",
    label: "Grave Spore: the target must also mark a Stress",
    steps: [{ kind: "markStress", to: "targets", amount: one }],
  },
  {
    id: "leech-weed",
    label: "Leech Weed: you deal an extra 1d6 damage on this attack",
    steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: { count: one, sides: 6 } } } }],
  },
];

/** Midnight Vine, Gorgon Root (Poison Compendium). */
const COMPENDIUM_POISONS: readonly ChooseOption[] = [
  {
    id: "midnight-vine",
    label: "Midnight Vine: disadvantage on attack rolls until it marks a Stress",
    steps: [
      {
        kind: "effect",
        to: "targets",
        label: "Midnight Vine",
        mods: [{ kind: "flag", flag: "attackDisadvantage" }],
        duration: "manual",
        endsWhen: "Until it marks a Stress to clear this condition",
        endsOn: ["bearerMarksStress"],
      },
    ],
  },
  {
    id: "gorgon-root",
    label: "Gorgon Root: the target becomes temporarily Restrained",
    steps: [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" }],
  },
];

/** Blight Seed, Fear Leaf, Corpse Thorn (Venomancer). */
const VENOMANCER_POISONS: readonly ChooseOption[] = [
  {
    id: "blight-seed",
    label: "Blight Seed: −3 to its damage thresholds until the end of the scene",
    steps: [
      {
        kind: "effect",
        to: "targets",
        label: "Blight Seed",
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: fixed(-3) },
          { kind: "stat", stat: "severeThreshold", delta: fixed(-3) },
        ],
        duration: "scene",
        // Gap (bead): no field says an effect can't stack; the label names it and the GM keeps one.
        note: "This effect can't stack.",
      },
    ],
  },
  {
    id: "fear-leaf",
    label: "Fear Leaf: extra damage equal to your Fear Die",
    // Gap (dcm-d1b, as Midnight-Touched): no number source reads the host roll's Fear Die, so the dialog asks for it.
    steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "chosen", choice: "fearDie" } } }],
  },
  {
    id: "corpse-thorn",
    label: "Corpse Thorn: disadvantage on reaction rolls until the end of the scene",
    steps: [{ kind: "effect", to: "targets", label: "Corpse Thorn", mods: [{ kind: "flag", flag: "reactionDisadvantage" }], duration: "scene" }],
  },
];

/** Twin Fang's second poison: a second `choose` with the base poisons (the upgrades add the rest). */
const TWIN_FANG_STEP: Step = {
  kind: "optional",
  id: "twin-fang",
  label: "Twin Fang: spend another token to also inflict a second poison you know",
  when: [{ kind: "targetHas", condition: MARKED }],
  costs: [{ kind: "tokens", amount: one }],
  // "a second poison": a different one; two choose steps can't be kept distinct (bead), the dialog offers the others.
  steps: [{ kind: "choose", id: "second-poison", label: "Second poison", options: BASE_POISONS }],
};

// ---------------------------------------------------------------- the table

export const ASSASSIN_BRAWLER_EFFECTS: readonly FeatureEffect[] = [
  // ======================================================== Assassin (HF p.8)

  // Deadly Determination (Assassin's Hope feature, HF p.8): "Spend 3 Hope to clear 2 Stress."
  // No roll, so it can be activated more than once (CB p.107, `times`).
  {
    featureId: "hope:assassin",
    source: "hope",
    owner: "assassin",
    uses: [
      {
        id: "main",
        name: "Deadly Determination",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(3) }],
        steps: [{ kind: "clear", to: "self", track: "stress", amount: fixed(2) }],
      },
    ],
  },

  // Marked for Death (Assassin class feature, HF p.8): "On a successful weapon attack, you can mark a Stress to make the
  // target Marked for Death. When you deal damage to a target you've Marked for Death, add a number of d4s equal to your
  // tier to the damage roll. You can have only one adversary Marked for Death at a time. This condition lasts until you
  // take a rest, the current adversary Marked for Death is defeated, or the GM spends a number of Fear equal to your tier
  // to clear it."
  // - mark: a rider on the successful weapon attack; the tag goes on the target's instance, and D5's `markedForDeath`
  //   keeps its sheet effect (the Party sheet's dice-box option) as the one record (NV2). `exclusive`: one at a time.
  // - damage: automatic ("add"), on damage dealt to the tagged target. Ambush d6s, Backstab d8s (HF p.8, NV3).
  {
    featureId: "class:assassin:marked-for-death",
    source: "class",
    owner: "assassin",
    uses: [
      {
        id: "main",
        name: "Marked for Death",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
        costs: [{ kind: "stress", amount: one }],
        exclusive: true,
        steps: [
          {
            kind: "condition",
            to: "targets",
            condition: MARKED,
            duration: "rest",
            endsWhen: "Until you take a rest, the target is defeated, or the GM spends Fear equal to your tier to clear it",
          },
          { kind: "delegate", to: "self", feature: "markedForDeath" },
        ],
      },
      {
        id: "damage",
        name: "Marked for Death: extra damage",
        activation: { kind: "auto", trigger: { kind: "whenYouDealDamage", toEnemy: true } },
        steps: [
          {
            kind: "modifyDamage",
            to: "targets",
            when: [{ kind: "targetHas", condition: MARKED }],
            change: { kind: "add", amount: { kind: "dice", dice: { count: TIER, sides: 4 } } },
          },
        ],
      },
    ],
    upgrades: [
      { when: { kind: "feature", featureId: "subclass:executioners-guild:ambush" }, useId: "damage", patch: { dieSides: 6 }, note: "Ambush" },
      { when: { kind: "feature", featureId: "subclass:executioners-guild:backstab" }, useId: "damage", patch: { dieSides: 8 }, note: "Backstab" },
    ],
  },

  // ---------------------------------------------------------------- Executioners Guild (HF p.8)

  // First Strike (foundation, HF p.8): "The first time in a scene you succeed on an attack, you deal double damage."
  // Once per scene (Q7: the scene ends with the encounter, the GM's End scene or the session).
  {
    featureId: "subclass:executioners-guild:first-strike",
    source: "subclass",
    owner: "executioners-guild",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "First Strike",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success", firstInScene: true } },
        limit: { per: "scene" },
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "multiply", factor: 2 } }],
      },
    ],
  },

  // Ambush (foundation, HF p.8): "Your 'Marked for Death' feature uses d6s instead of d4s." The upgrade is on Marked for Death.
  {
    featureId: "subclass:executioners-guild:ambush",
    source: "subclass",
    owner: "executioners-guild",
    card: "foundation",
    uses: [{ id: "main", name: "Ambush", activation: { kind: "passive" }, steps: [] }],
  },

  // Death Strike (specialization, HF p.8): "When you deal Severe damage to a creature, you can mark a Stress to force them
  // to mark an additional Hit Point."
  {
    featureId: "subclass:executioners-guild:death-strike",
    source: "subclass",
    owner: "executioners-guild",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Death Strike",
        activation: { kind: "rider", trigger: { kind: "whenTargetMarksHp", severity: "severe" } },
        targets: { side: "trigger", who: "subject" },
        costs: [{ kind: "stress", amount: one }],
        steps: [{ kind: "markHp", to: "targets", amount: one }],
      },
    ],
  },

  // Scorpion's Poise (specialization, HF p.8): "You gain a +2 bonus to your Evasion against attacks made by a creature
  // you've Marked for Death." (NV9)
  {
    featureId: "subclass:executioners-guild:scorpions-poise",
    source: "subclass",
    owner: "executioners-guild",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Scorpion’s Poise",
        activation: { kind: "passive" },
        mods: [{ kind: "stat", stat: "evasion", delta: fixed(2), versus: { creature: { kind: "tagged", tag: MARKED_FOR_DEATH }, on: "attacksByThem" } }],
        steps: [],
      },
    ],
  },

  // True Strike (mastery, HF p.8): "Once per long rest when you fail an attack, you can spend a Hope to make it a success
  // instead." The after-roll step on your own map roll (Q1, CB p.107).
  {
    featureId: "subclass:executioners-guild:true-strike",
    source: "subclass",
    owner: "executioners-guild",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "True Strike",
        activation: { kind: "reaction", trigger: { kind: "afterYouRoll", roll: "attack", result: "failure" } },
        limit: { per: "longRest" },
        costs: [{ kind: "hope", amount: one }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "setOutcome", outcome: "success" } }],
      },
    ],
  },

  // Backstab (mastery, HF p.8): "Your 'Marked for Death' feature uses d8s instead of d6s." The upgrade is on Marked for Death.
  {
    featureId: "subclass:executioners-guild:backstab",
    source: "subclass",
    owner: "executioners-guild",
    card: "mastery",
    uses: [{ id: "main", name: "Backstab", activation: { kind: "passive" }, steps: [] }],
  },

  // ---------------------------------------------------------------- Poisoners Guild (HF p.9)

  // Toxic Concoctions (foundation, HF p.9): "Mark a Stress to place 1d4+1 tokens on this card. When you make a successful
  // weapon attack, you can spend a token to afflict the target with a poison. You know these poisons: • Ghost Petal: The
  // target becomes temporarily Vulnerable. • Grave Spore: The target must also mark a Stress. • Leech Weed: You deal an
  // extra 1d6 damage on this attack. When you take a long rest, clear all unspent tokens."
  // - brew: the tokens are this feature's (`cardTokens` `feat:<featureId>`); "place" adds to any left.
  // - poison: a rider on the successful weapon attack. Poison Compendium and Venomancer add poisons (NV3); Twin Fang adds
  //   the second poison for a Marked for Death target, paid from these tokens.
  // - long-rest: the unspent tokens are cleared.
  {
    featureId: "subclass:poisoners-guild:toxic-concoctions",
    source: "subclass",
    owner: "poisoners-guild",
    card: "foundation",
    uses: [
      {
        id: "brew",
        name: "Toxic Concoctions: brew",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: one }],
        steps: [{ kind: "tokens", to: "self", op: "add", amount: { kind: "dice", dice: { count: one, sides: 4, plus: one } } }],
      },
      {
        id: "poison",
        name: "Toxic Concoctions: poison",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
        // Fear Leaf only (Venomancer): the dialog's number for the Fear Die (dcm-d1b); 0 when unused.
        choices: [{ id: "fearDie", label: "Fear Leaf: your Fear Die's result", min: 0, max: fixed(12) }],
        costs: [{ kind: "tokens", amount: one }],
        steps: [{ kind: "choose", id: "poison", label: "Poison", options: BASE_POISONS }],
      },
      {
        id: "long-rest",
        name: "Toxic Concoctions: clear unspent tokens",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } },
        steps: [{ kind: "tokens", to: "self", op: "clear" }],
      },
    ],
    // In this order: Twin Fang's step first, so the poison lists reach both choose steps.
    upgrades: [
      { when: { kind: "feature", featureId: "subclass:poisoners-guild:twin-fang" }, useId: "poison", patch: { extraSteps: [TWIN_FANG_STEP] }, note: "Twin Fang" },
      { when: { kind: "feature", featureId: "subclass:poisoners-guild:poison-compendium" }, useId: "poison", patch: { chooseId: "poison", extraOptions: COMPENDIUM_POISONS }, note: "Poison Compendium" },
      { when: { kind: "feature", featureId: "subclass:poisoners-guild:poison-compendium" }, useId: "poison", patch: { chooseId: "second-poison", extraOptions: COMPENDIUM_POISONS } },
      { when: { kind: "feature", featureId: "subclass:poisoners-guild:venomancer" }, useId: "poison", patch: { chooseId: "poison", extraOptions: VENOMANCER_POISONS }, note: "Venomancer" },
      { when: { kind: "feature", featureId: "subclass:poisoners-guild:venomancer" }, useId: "poison", patch: { chooseId: "second-poison", extraOptions: VENOMANCER_POISONS } },
    ],
  },

  // Poison Compendium (specialization, HF p.9): "You also know these poisons: • Midnight Vine: The target has disadvantage
  // on attack rolls until it marks a Stress to clear this condition. • Gorgon Root: The target becomes temporarily
  // Restrained." The poisons are an upgrade on Toxic Concoctions.
  {
    featureId: "subclass:poisoners-guild:poison-compendium",
    source: "subclass",
    owner: "poisoners-guild",
    card: "specialization",
    uses: [{ id: "main", name: "Poison Compendium", activation: { kind: "passive" }, steps: [] }],
  },

  // Twin Fang (specialization, HF p.9): "When you afflict a target Marked for Death with a poison you know, you can spend an
  // additional token to also inflict the effect of a second poison you know." The tokens are Toxic Concoctions', so the
  // rider is an upgrade on its poison use (an optional step gated on the target's Marked for Death tag).
  {
    featureId: "subclass:poisoners-guild:twin-fang",
    source: "subclass",
    owner: "poisoners-guild",
    card: "specialization",
    uses: [{ id: "main", name: "Twin Fang", activation: { kind: "passive" }, steps: [] }],
  },

  // Venomancer (mastery, HF p.9): "You also know these poisons: • Blight Seed: The target gains a −3 penalty to their
  // damage thresholds until the end of the scene. This effect can't stack. • Fear Leaf: You deal extra damage equal to the
  // result of your Fear Die on this attack. • Corpse Thorn: The target gains disadvantage on reaction rolls until the end
  // of the scene." The poisons are an upgrade on Toxic Concoctions.
  {
    featureId: "subclass:poisoners-guild:venomancer",
    source: "subclass",
    owner: "poisoners-guild",
    card: "mastery",
    uses: [{ id: "main", name: "Venomancer", activation: { kind: "passive" }, steps: [] }],
  },

  // ======================================================== Brawler (HF p.10)

  // Square Up (Brawler's Hope feature, HF p.10): "Spend 3 Hope to intimidate a target within Close range, making them
  // temporarily Vulnerable."
  {
    featureId: "hope:brawler",
    source: "hope",
    owner: "brawler",
    uses: [
      {
        id: "main",
        name: "Square Up",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: fixed(3) }],
        targets: { side: "enemy", range: "close", count: { kind: "one" } },
        steps: [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }],
      },
    ],
  },

  // I Am the Weapon (Brawler class feature, HF p.10): "Your barehanded attacks are as strong as any blade. You have a
  // primary weapon called Brawler's Strike equipped while you have no other Active Weapons. It uses a trait of your
  // choice, has Melee range, and deals d8+d6 physical damage using your Proficiency (both the d8 and d6 scale off your
  // Proficiency). While this weapon is active, you gain a +1 bonus to your Evasion."
  // D5's weapon override (class-features/classes/brawler.ts, `brawlersStrike`) is the one record of the weapon and its
  // +1 Evasion, which derived stats already apply; the entry carries no mods so SD2 does not count the Evasion twice.
  {
    featureId: "class:brawler:i-am-the-weapon",
    source: "class",
    owner: "brawler",
    uses: [{ id: "main", name: "I Am the Weapon", activation: { kind: "passive" }, steps: [] }],
  },

  // Combo Strike (Brawler class feature, HF p.10): "After rolling damage on a successful attack with a Melee weapon, you
  // can mark a Stress to start a combo strike. When you do, roll your Combo Die and note the result, then continue
  // rolling your Combo Die until the result of your latest roll is lower than the roll that preceded it. You deal extra
  // damage equal to the total of all rolled Combo Die results on this attack. The results can't be modified by any means.
  // Your Combo Die starts as a d4. Once per tier, you can increase your Combo Die by one step as a level advancement
  // option."
  // D5's `comboStrike` rolls the chain on the damage roll (NV2, `delegateRoll`). The price is paid in the "cost" choice:
  // a Stress, or a Focus with Flow State (HF p.11).
  {
    featureId: "class:brawler:combo-strike",
    source: "class",
    owner: "brawler",
    uses: [
      {
        id: "main",
        name: "Combo Strike",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true, weaponRange: "melee" } },
        steps: [
          {
            kind: "choose",
            id: "cost",
            label: "Start a combo strike",
            options: [
              {
                id: "stress",
                label: "Mark a Stress",
                steps: [
                  { kind: "pay", costs: [{ kind: "stress", amount: one }] },
                  { kind: "delegate", to: "self", feature: "comboStrike" },
                ],
              },
            ],
          },
        ],
      },
    ],
    upgrades: [
      {
        when: { kind: "feature", featureId: FLOW_STATE },
        patch: {
          chooseId: "cost",
          extraOptions: [
            {
              id: "focus",
              label: "Spend a Focus (Flow State)",
              steps: [
                { kind: "pay", costs: [focus()] },
                { kind: "delegate", to: "self", feature: "comboStrike" },
              ],
            },
          ],
        },
        note: "Flow State",
      },
    ],
  },

  // ---------------------------------------------------------------- Juggernaut (HF p.10)

  // Rugged (foundation, HF p.10): "Gain a permanent +3 bonus to your Severe damage threshold."
  {
    featureId: "subclass:juggernaut:rugged",
    source: "subclass",
    owner: "juggernaut",
    card: "foundation",
    uses: [{ id: "main", name: "Rugged", activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "severeThreshold", delta: fixed(3) }], steps: [] }],
  },

  // Overwhelm (foundation, HF p.10): "When you succeed on an attack against a target, you can spend a Hope to throw the
  // target within Close range or to force them to mark a Stress." The throw is a movement prompt (Q9).
  {
    featureId: "subclass:juggernaut:overwhelm",
    source: "subclass",
    owner: "juggernaut",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Overwhelm",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
        targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
        costs: [{ kind: "hope", amount: one }],
        steps: [
          {
            kind: "choose",
            id: "overwhelm",
            label: "Overwhelm",
            options: [
              {
                id: "throw",
                label: "Throw the target within Close range",
                steps: [{ kind: "move", to: "targets", mode: "move", range: "close", relativeTo: "self", note: "Throw the target within Close range" }],
              },
              { id: "stress", label: "The target marks a Stress", steps: [{ kind: "markStress", to: "targets", amount: one }] },
            ],
          },
        ],
      },
    ],
  },

  // Surrounded (specialization, HF p.10): "When you make an attack with a Melee weapon, you can spend any number of Hope to
  // target an equal number of additional creatures within Melee range." (NV18: the same roll against them.)
  // "spend any number of Hope" says otherwise to CB p.107, so the Hope is a number the player picks.
  // Gap (bead): no requirement reads the weapon's range before the roll, so "a Melee weapon" is the player's check box.
  {
    featureId: "subclass:juggernaut:surrounded",
    source: "subclass",
    owner: "juggernaut",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Surrounded",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "weaponAttack" } },
        requires: [{ kind: "situation", text: "You make this attack with a Melee weapon" }],
        choices: [{ id: "hope", label: "Hope to spend (one more target each)", min: 1 }],
        costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
        steps: [
          {
            kind: "addTargets",
            to: "self",
            count: { kind: "chosen", choice: "hope" },
            targets: { side: "any", range: "melee", count: { kind: "any", max: { kind: "chosen", choice: "hope" } }, excludeSelf: true },
          },
        ],
      },
    ],
  },

  // Eye for an Eye (specialization, HF p.10): "Once per rest when an adversary within Melee range forces you to mark any
  // number of Hit Points, you can mark a Stress to force them to mark the same number of Hit Points."
  {
    featureId: "subclass:juggernaut:eye-for-an-eye",
    source: "subclass",
    owner: "juggernaut",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Eye for an Eye",
        activation: { kind: "reaction", trigger: { kind: "whenYouMarkHp", sourceWithin: "melee" } },
        limit: { per: "rest" },
        targets: { side: "trigger", who: "source" },
        costs: [{ kind: "stress", amount: one }],
        steps: [{ kind: "markHp", to: "targets", amount: { kind: "triggerAmount" } }],
      },
    ],
  },

  // Pummeljoy (mastery, HF p.10): "When you critically succeed on a Melee weapon attack, you gain an additional Hope, clear
  // an additional Stress, and gain a +1 bonus to your Proficiency for that attack." On top of the critical's own Hope and
  // Stress (CB p.90).
  {
    featureId: "subclass:juggernaut:pummeljoy",
    source: "subclass",
    owner: "juggernaut",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Pummeljoy",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "critical", weapon: true, weaponRange: "melee" } },
        steps: [
          { kind: "hope", to: "self", change: "gain", amount: one },
          { kind: "clear", to: "self", track: "stress", amount: one },
          { kind: "modifyDamage", to: "targets", change: { kind: "proficiency", delta: 1 } },
        ],
      },
    ],
  },

  // Not Done Yet (mastery, HF p.10): "When you take Severe damage, you can gain a Hope or clear a Stress."
  {
    featureId: "subclass:juggernaut:not-done-yet",
    source: "subclass",
    owner: "juggernaut",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Not Done Yet",
        activation: { kind: "reaction", trigger: { kind: "whenYouTakeDamage", severity: "severe" } },
        steps: [
          {
            kind: "choose",
            id: "not-done-yet",
            label: "Not Done Yet",
            options: [
              { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "self", change: "gain", amount: one }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] },
            ],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Martial Artist (HF p.11-12)

  // Stance Fighter (foundation, HF p.11): "You can channel your inner resolve to shift into martial stances that grant you
  // special benefits in combat. Take the Martial Stances sheet and choose two martial stances from Tier 1. Each time you
  // level up your character, choose an additional stance from your tier or lower."
  // HF p.12, Shifting into Stances: "You can spend a Focus to shift into a martial stance and gain its effects. You can
  // shift only into stances you've marked as known." Flow State (HF p.11): "mark a Stress instead of spending a Focus".
  // The use pays the shift (the "cost" choice); the stance itself is set by SD3's `shiftStance` intent
  // (`classState.martial.active`), because no step sets the active stance (gap, bead). The stance effects are FE-stances'.
  {
    featureId: "subclass:martial-artist:stance-fighter",
    source: "subclass",
    owner: "martial-artist",
    card: "foundation",
    uses: [
      {
        id: "shift",
        name: "Shift stance",
        activation: { kind: "action" },
        steps: [
          {
            kind: "choose",
            id: "cost",
            label: "Shift into a stance you know",
            options: [
              {
                id: "focus",
                label: "Spend a Focus",
                steps: [
                  { kind: "pay", costs: [focus()] },
                  { kind: "manual", to: "self", text: "Shift into a martial stance you know; it is your active stance until you drop out of it." },
                ],
              },
            ],
          },
        ],
      },
    ],
    upgrades: [
      {
        when: { kind: "feature", featureId: FLOW_STATE },
        useId: "shift",
        patch: {
          chooseId: "cost",
          extraOptions: [
            {
              id: "stress",
              label: "Mark a Stress (Flow State)",
              steps: [
                { kind: "pay", costs: [{ kind: "stress", amount: one }] },
                { kind: "manual", to: "self", text: "Shift into a martial stance you know; it is your active stance until you drop out of it." },
              ],
            },
          ],
        },
        note: "Flow State",
      },
    ],
  },

  // Keen Defenses (specialization, HF p.11): "When you're targeted by an attack, you can spend a Focus to gain a bonus to
  // your Evasion equal to your tier against the attack." A before-roll answer (Q2).
  {
    featureId: "subclass:martial-artist:keen-defenses",
    source: "subclass",
    owner: "martial-artist",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Keen Defenses",
        activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "targeted" } },
        costs: [focus()],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "evasion", amount: TIER } }],
      },
    ],
  },

  // Focus Cannon (specialization, HF p.11): "Spend a Focus to make an Instinct Roll against an adversary within Far range.
  // On a success, deal d20+3 magic damage using your Proficiency."
  {
    featureId: "subclass:martial-artist:focus-cannon",
    source: "subclass",
    owner: "martial-artist",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Focus Cannon",
        activation: { kind: "action" },
        costs: [focus()],
        roll: { kind: "trait", trait: "instinct", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [
          {
            kind: "damage",
            to: "targets",
            when: ["hit"],
            roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 20, plus: fixed(3) } },
            type: "magic",
          },
        ],
      },
    ],
  },

  // Flow State (mastery, HF p.11): "You can mark a Stress instead of spending a Focus to shift into a different stance.
  // Additionally, you can spend a Focus instead of marking a Stress to start a combo strike." The two ways to pay are
  // upgrades on Stance Fighter and Combo Strike.
  {
    featureId: FLOW_STATE,
    source: "subclass",
    owner: "martial-artist",
    card: "mastery",
    uses: [{ id: "main", name: "Flow State", activation: { kind: "passive" }, steps: [] }],
  },
];
