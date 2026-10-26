// Feature effects of the transformations (plan sheet-drawer, tracer FE-transformations; user answer Q11 (a)).
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page (HF = Hope & Fear) and uses only the vocabulary of src/lib/domain/card-effects/types.ts; a gap is a
// `manual` step (or a player-confirmed `situation`) plus a bead labelled feature-effects vocabulary-gap.
//
// HF p.34: "Transformations provide both a mechanical benefit and a drawback." Drawbacks are entries too (Weight of
// Divinity, Ephemeral's double magic damage, Feed with no tokens, Wolf Form's Stress on Hope).
//
// Seven of the twelve features are classified combat or passive (./classification.ts) and have an entry here. The other
// five are not run from the map: Unfinished Business (narrative), Corpse and Won't Stay Dead (rest and death-move flows),
// Change Shape and Only Skin Deep (downtime and build). Readings and open points: docs/tasks/TASK-SD-FE-transformations.md.

import type { FeatureEffect } from "../../domain/feature-effects/types";
import type { NumberSource, Requirement } from "../../domain/card-effects/types";
import { TRAIT_IDS } from "../types";

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const ONE = fixed(1);

const WOLF_FORM = "transformation:werewolf:wolf-form";

/** "While in this form" (HF p.40): the Wolf Form sheet effect the Wolf Form use creates is active. */
const IN_WOLF_FORM: Requirement = {
  kind: "situation",
  text: "You are in Wolf Form",
  check: { kind: "featureEffect", featureId: WOLF_FORM },
};

export const TRANSFORMATION_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Demigod (HF p.35)

  // Gifted (HF p.35): "You gain a +1 bonus to action, reaction, and damage rolls."
  // The passive carries the action-roll and damage-roll bonuses (`actionRoll`, `damage`). The vocabulary has no
  // reaction-roll stat, so the reaction-roll +1 is an automatic +1 before each of your reaction rolls (no prompt).
  {
    featureId: "transformation:demigod:gifted",
    source: "transformation",
    owner: "demigod",
    uses: [
      {
        id: "main",
        name: "Gifted",
        activation: { kind: "passive" },
        mods: [
          { kind: "stat", stat: "actionRoll", delta: ONE },
          { kind: "stat", stat: "damage", delta: ONE },
        ],
        steps: [],
      },
      {
        id: "reaction",
        name: "Gifted (reaction rolls)",
        activation: { kind: "auto", trigger: { kind: "beforeYouRoll", roll: "reaction" } },
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: ONE }, note: "+1 to the reaction roll" }],
      },
    ],
  },

  // Weight of Divinity (HF p.35): "When you fail a roll, you must mark a Stress or the GM gains a Fear."
  // Reading (SD0 classification): the player picks one of the two; any failed roll (action or reaction) sets it off.
  {
    featureId: "transformation:demigod:weight-of-divinity",
    source: "transformation",
    owner: "demigod",
    uses: [
      {
        id: "main",
        name: "Weight of Divinity",
        activation: { kind: "auto", trigger: { kind: "afterYouRoll", roll: "any", result: "failure" } },
        steps: [
          {
            kind: "choose",
            id: "weight",
            label: "Mark a Stress or the GM gains a Fear",
            options: [
              { id: "stress", label: "Mark a Stress", steps: [{ kind: "markStress", to: "self", amount: ONE }] },
              { id: "fear", label: "The GM gains a Fear", steps: [{ kind: "fear", to: "self", change: "gain", amount: ONE }] },
            ],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Ghost (HF p.36)

  // Ephemeral (HF p.36): "Your body wavers in and out of being corporeal. You are resistant to physical damage, take
  // double magic damage, and can mark 2 Stress to momentarily pass through a solid object."
  // Resistance halves physical damage (CB p.99; Q6: rounded up); passing through an object is the table's (Q9 prompt).
  {
    featureId: "transformation:ghost:ephemeral",
    source: "transformation",
    owner: "ghost",
    uses: [
      {
        id: "main",
        name: "Ephemeral",
        activation: { kind: "passive" },
        mods: [
          { kind: "resistance", type: "physical", level: "resistant" },
          { kind: "flag", flag: "doubleMagicDamage" },
        ],
        steps: [],
      },
      {
        id: "pass-through",
        name: "Ephemeral: pass through a solid object",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: fixed(2) }],
        steps: [{ kind: "manual", to: "self", text: "You momentarily pass through a solid object." }],
      },
    ],
  },

  // ---------------------------------------------------------------- Vampire (HF p.39)

  // Fangs (HF p.39): "Make an attack using a trait of your choice to bite a target within Melee range. On a success,
  // deal d6 physical damage using your Proficiency."
  // A trait roll (the player picks any of the six traits) against the target's Difficulty; Proficiency d6 physical.
  {
    featureId: "transformation:vampire:fangs",
    source: "transformation",
    owner: "vampire",
    uses: [
      {
        id: "main",
        name: "Fangs",
        activation: { kind: "action" },
        roll: { kind: "trait", trait: TRAIT_IDS, difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          {
            kind: "damage",
            to: "targets",
            when: ["hit"],
            roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 6 } },
            type: "physical",
          },
        ],
      },
    ],
  },

  // Feed (HF p.39): "On a successful “Fangs” attack against a creature that can bleed, you can mark a Stress to feed.
  // Place a number of tokens on this card equal to the number of Hit Points the target marks. You can hold up to 6
  // tokens at a time. Before you make an action roll, you can spend a token to make your Fear Die a d20. When you take a
  // long rest, remove a token. While there are no tokens on this card, you make action and reaction rolls with
  // disadvantage."
  // Tokens are this feature's (`feat:transformation:vampire:feed`). "A Fangs attack" and "a creature that can bleed" are
  // confirmed by the player (Q13); "no tokens" too, until the vocabulary can read a feature's own tokens (bead).
  {
    featureId: "transformation:vampire:feed",
    source: "transformation",
    owner: "vampire",
    uses: [
      {
        id: "main",
        name: "Feed",
        activation: { kind: "rider", trigger: { kind: "whenTargetMarksHp" } },
        requires: [{ kind: "situation", text: "A successful Fangs attack against a creature that can bleed" }],
        costs: [{ kind: "stress", amount: ONE }],
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "tokens", to: "self", op: "add", amount: { kind: "triggerAmount" }, max: fixed(6), note: "A token per Hit Point the target marked (up to 6)" }],
      },
      {
        id: "fear-die",
        name: "Feed: Fear Die a d20",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } },
        costs: [{ kind: "tokens", amount: ONE }],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "fearDie", sides: 20 } }],
      },
      {
        id: "long-rest",
        name: "Feed: remove a token",
        activation: { kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } },
        steps: [{ kind: "tokens", to: "self", op: "spend", amount: ONE }],
      },
      {
        id: "hunger",
        name: "Feed: no tokens",
        activation: { kind: "passive" },
        requires: [{ kind: "situation", text: "There are no tokens on Feed" }],
        mods: [
          { kind: "flag", flag: "actionDisadvantage" },
          { kind: "flag", flag: "reactionDisadvantage" },
        ],
        steps: [],
      },
    ],
  },

  // ---------------------------------------------------------------- Werewolf (HF p.40)

  // Wolf Form (HF p.40): "When you mark 1 or more Hit Points, you can mark a Stress to enter your Wolf Form. While in
  // this form, you gain a 1d10 bonus to attack and damage rolls. When you gain a Hope while in Wolf Form, you must also
  // mark a Stress. Your Wolf Form lasts until you go into your “Howling Rampage” or take a rest."
  // The form is a sheet effect until the next rest; the d10s are rolled on each attack and damage roll (automatic while
  // the effect is active). Howling Rampage's drop-out is a manual step (no step ends another feature's effect; bead).
  {
    featureId: WOLF_FORM,
    source: "transformation",
    owner: "werewolf",
    uses: [
      {
        id: "main",
        name: "Wolf Form",
        activation: { kind: "reaction", trigger: { kind: "whenYouMarkHp" } },
        costs: [{ kind: "stress", amount: ONE }],
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Wolf Form",
            mods: [],
            duration: "rest",
            endsWhen: "you go into your Howling Rampage",
          },
        ],
      },
      {
        id: "attack",
        name: "Wolf Form: +1d10 to the attack roll",
        activation: { kind: "auto", trigger: { kind: "beforeYouRoll", roll: "attack" } },
        requires: [IN_WOLF_FORM],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "add", amount: { kind: "dice", dice: { count: ONE, sides: 10 } } } }],
      },
      {
        id: "damage",
        name: "Wolf Form: +1d10 to the damage roll",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
        requires: [IN_WOLF_FORM],
        steps: [
          { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: { kind: "dice", dice: { count: ONE, sides: 10 } } } },
        ],
      },
      {
        id: "hope",
        name: "Wolf Form: a Stress with each Hope",
        activation: { kind: "auto", trigger: { kind: "whenYouGainHope" } },
        requires: [IN_WOLF_FORM],
        steps: [{ kind: "markStress", to: "self", amount: ONE }],
      },
    ],
  },

  // Howling Rampage (HF p.40): "When you mark your last Stress while in Wolf Form, you go into a rampage. Roll a number of
  // d20s equal to your tier and deal that much physical damage to all creatures within Very Close range, then drop out
  // of Wolf Form."
  // "All creatures": allies too (side `any`, the actor excluded); the server passes every creature within Very Close.
  {
    featureId: "transformation:werewolf:howling-rampage",
    source: "transformation",
    owner: "werewolf",
    uses: [
      {
        id: "main",
        name: "Howling Rampage",
        activation: { kind: "auto", trigger: { kind: "whenYouMarkStress", last: true } },
        requires: [IN_WOLF_FORM],
        targets: { side: "any", range: "veryClose", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true },
        steps: [
          {
            kind: "damage",
            to: "targets",
            roll: { kind: "dice", dice: { count: { kind: "byTier", values: [1, 2, 3, 4] }, sides: 20 } },
            type: "physical",
          },
          { kind: "manual", to: "self", text: "Drop out of Wolf Form (end the Wolf Form effect)." },
        ],
      },
    ],
  },
];
