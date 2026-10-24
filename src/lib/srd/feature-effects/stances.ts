// Feature effects of the martial stances (FE-stances, Q5) (plan sheet-drawer, bead dcm-bxp.99.19).
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page and uses only the vocabulary of src/lib/domain/card-effects/types.ts (a gap is a `manual` step plus a bead).
//
// Rules (HF p.12, Martial Stances; the sheet on HF p.13 says the same):
// - Stances: "Each stance grants your character a different ability, bonus, or feature while active." Every use of
//   every stance entry requires that stance to be the active stance (`activeStance` state check, the sheet's
//   `classState.martial.active`); the engine decides it from `facts.activeStance`.
// - Shifting: "You can spend a Focus to shift into a martial stance and gain its effects. You can shift only into stances
//   you've marked as known. … You can't shift into or have more than one active stance at a time. Until you shift into a
//   stance, you are not considered to be in a stance or to have an active stance." (`SHIFT_STANCE_EFFECT`,
//   `shiftRefusal`.) HF p.11, Flow State: "You can mark a Stress instead of spending a Focus to shift into a different
//   stance." (the `flow-state` use.)
// - Dropping out: "If you are already in a stance when you shift into a different stance, you automatically drop out of
//   the previously active stance. You also drop out of your active stance when you take Severe damage or mark your last
//   Hit Point. Otherwise, you drop out of your active stance at the end of the scene. When you drop out of a stance, you
//   lose any ongoing benefits it provides." (`STANCE_DURATION`, `STANCE_ENDS_ON`, `dropsActiveStance`; Q7: the scene
//   ends with the encounter, the GM's End scene or the session.)
// - Focus: "Once per rest during a moment of calm, you can clear your mind and refocus your martial instincts. Clear
//   your Focus track, then roll a number of d6s equal to your Instinct and gain Focus equal to the highest result
//   rolled. You can hold a maximum of 6 Focus." (`REFOCUS_EFFECT`; user answer 2026-10-23: an Instinct of 0 or less
//   rolls no dice and gains 0 Focus.)
//
// Shift stance and Refocus are rules of the Martial Stances sheet, not stance features: they are exported beside the
// table (not in `STANCE_EFFECTS`, which holds the 16 classified stance features) for SD3's `combatFeatures.shiftStance`
// and `combatFeatures.refocus` intents to run through `runFeature`.

import type { CardUse, Cost, Duration, EndEvent, Requirement, Step } from "../../domain/card-effects/types";
import type { TraitId } from "../types";
import type { FeatureEffect } from "../../domain/feature-effects/types";
import { REFOCUS, SHIFT_FOCUS_COST, stanceById, type StanceDropTrigger, type StanceId } from "../stances";

const fixed = (value: number) => ({ kind: "fixed" as const, value });

/** The owner of every stance feature id (`stance:martial-artist:<slug>`). */
export const STANCE_OWNER = "martial-artist";

/** "spend a Focus" (HF p.12): one Focus from `classState.martial.focus`. */
const focusCost = (n: number): Cost => ({ kind: "tokens", amount: fixed(n), pool: "focus" });

/** "spend a Focus or mark a Stress" (Quick, Grappling, HF p.12): the payer picks. */
const focusOrStress: Cost = { kind: "either", options: [[focusCost(1)], [{ kind: "stress", amount: fixed(1) }]] };

/** The gate of every stance use: this stance is the active stance (HF p.12, Q5). */
export function activeStanceRequirement(slug: StanceId): Requirement {
  const name = stanceById(slug)?.name ?? slug;
  return { kind: "situation", text: `While in the ${name} stance`, check: { kind: "activeStance", stance: slug } };
}

/** A stance's entry: every use gated on the stance being active. The use names are the stance's printed name. */
function stance(slug: StanceId, uses: readonly Omit<CardUse, "name">[]): FeatureEffect {
  const def = stanceById(slug);
  if (!def) throw new Error(`Unknown stance ${slug}.`);
  return {
    featureId: `stance:${STANCE_OWNER}:${slug}`,
    source: "stance",
    owner: STANCE_OWNER,
    uses: uses.map((u) => ({ ...u, name: def.name, requires: [activeStanceRequirement(slug), ...(u.requires ?? [])] })),
  };
}

const TRAITS: readonly { id: TraitId; label: string }[] = [
  { id: "agility", label: "Agility" },
  { id: "strength", label: "Strength" },
  { id: "finesse", label: "Finesse" },
  { id: "instinct", label: "Instinct" },
  { id: "presence", label: "Presence" },
  { id: "knowledge", label: "Knowledge" },
];

export const STANCE_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Tier 1 (HF p.12)

  // Favored (HF p.12): "Gain a bonus to damage rolls equal to a trait of your choice." The trait is picked on each damage
  // roll (the sheet stores no pick; see the task doc's question 1).
  stance("favored", [
    {
      id: "main",
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "damage" } },
      steps: [
        {
          kind: "choose",
          id: "trait",
          label: "Add a trait of your choice to the damage roll",
          timing: "beforeRoll",
          options: TRAITS.map((t) => ({
            id: t.id,
            label: t.label,
            steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "trait", trait: t.id } }, note: `+ your ${t.label}` }],
          })),
        },
      ],
    },
  ]),

  // Invigorating (HF p.12): "On a successful attack, roll a d4. On a result of 4, gain a Focus."
  stance("invigorating", [
    {
      id: "main",
      activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
      steps: [
        {
          kind: "check",
          dice: { count: fixed(1), sides: 4 },
          test: { kind: "anyAtLeast", value: 4 },
          then: [{ kind: "resource", to: "self", resource: "focus", change: "gain", amount: fixed(1), note: "On a 4, gain a Focus" }],
          otherwise: [],
        },
      ],
    },
  ]),

  // Quick (HF p.12): "When you make an attack, you can spend a Focus or mark a Stress to target another creature within
  // range with that attack." The same roll is used against the extra target (NV18); "within range" is the attack's.
  stance("quick", [
    {
      id: "main",
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
      costs: [focusOrStress],
      steps: [
        {
          kind: "addTargets",
          to: "self",
          count: fixed(1),
          targets: { side: "any", range: "weapon", count: { kind: "one" }, excludeSelf: true },
          note: "Target another creature within range with that attack",
        },
      ],
    },
  ]),

  // Reliable (HF p.12): "Gain a +1 bonus to your attack rolls."
  stance("reliable", [{ id: "main", activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "attack", delta: fixed(1) }], steps: [] }]),

  // ---------------------------------------------------------------- Tier 2 (HF p.12)

  // Aggressive (HF p.12): "Gain a −1 penalty to your Evasion. On a successful attack, roll an additional damage die and
  // discard the lowest result."
  stance("aggressive", [
    { id: "main", activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "evasion", delta: fixed(-1) }], steps: [] },
    {
      id: "extra-die",
      activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "extraDie", drop: "lowest" }, note: "Roll an additional damage die and discard the lowest" }],
    },
  ]),

  // Anchored (HF p.12): "Gain a +2 bonus to your damage thresholds. While in this stance, you can't be moved against your
  // will."
  stance("anchored", [
    {
      id: "main",
      activation: { kind: "passive" },
      mods: [
        { kind: "stat", stat: "majorThreshold", delta: fixed(2) },
        { kind: "stat", stat: "severeThreshold", delta: fixed(2) },
        { kind: "flag", flag: "cannotBeMoved" },
      ],
      steps: [],
    },
  ]),

  // Defensive (HF p.12): "Attack rolls targeting you from within Melee range have disadvantage unless the attacker marks a
  // Stress to negate the disadvantage." The vocabulary has no disadvantage the attacker can buy off with a Stress (nor a
  // passive disadvantage narrowed to Melee attackers): a manual step on each Melee attack (bead dcm-eut, see
  // the task doc).
  stance("defensive", [
    {
      id: "main",
      activation: { kind: "auto", trigger: { kind: "whenAttacked", stage: "targeted", from: "melee" } },
      steps: [
        {
          kind: "manual",
          to: "triggerSource",
          text: "Defensive stance: this attack roll from within Melee range has disadvantage unless the attacker marks a Stress to negate the disadvantage.",
        },
      ],
    },
  ]),

  // Otherworldly (HF p.12): "On a successful attack, you can deal physical or magic damage."
  stance("otherworldly", [
    {
      id: "main",
      activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
      steps: [
        {
          kind: "choose",
          id: "type",
          label: "Deal physical or magic damage",
          options: [
            { id: "physical", label: "Physical", steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "type", type: "physical" } }] },
            { id: "magic", label: "Magic", steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "type", type: "magic" } }] },
          ],
        },
      ],
    },
  ]),

  // ---------------------------------------------------------------- Tier 3 (HF p.12)

  // Grappling (HF p.12): "On a successful attack within Melee range, you can spend a Focus or mark a Stress to
  // temporarily Restrain the target or throw the target up to Close range."
  stance("grappling", [
    {
      id: "main",
      activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } },
      requires: [{ kind: "situation", text: "The attack was within Melee range" }],
      costs: [focusOrStress],
      steps: [
        {
          kind: "choose",
          id: "grapple",
          label: "Restrain the target or throw them",
          options: [
            {
              id: "restrain",
              label: "Temporarily Restrain the target",
              steps: [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" }],
            },
            {
              id: "throw",
              label: "Throw the target up to Close range",
              steps: [{ kind: "move", to: "targets", mode: "move", range: "close", note: "Throw the target up to Close range" }],
            },
          ],
        },
      ],
    },
  ]),

  // Scary (HF p.12): "On a successful attack, the target must mark a Stress."
  stance("scary", [
    {
      id: "main",
      activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
      steps: [{ kind: "markStress", to: "targets", amount: fixed(1), note: "The target must mark a Stress" }],
    },
  ]),

  // Stable (HF p.12): "You can spend a Focus instead of an Armor Slot to reduce damage." An Armor Slot reduces the
  // severity by one threshold (CB p.114), so the Focus does that.
  stance("stable", [
    {
      id: "main",
      activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
      costs: [focusCost(1)],
      steps: [{ kind: "reduceSeverity", to: "self", steps: 1, note: "Spend a Focus instead of an Armor Slot to reduce the damage" }],
    },
  ]),

  // Vigilant (HF p.12): "When you are targeted by an attack, you can mark a Stress to gain a d6 bonus to your Evasion
  // against the attack." Before the roll (Q2).
  stance("vigilant", [
    {
      id: "main",
      activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "targeted" } },
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "evasion", amount: { kind: "dice", dice: { count: fixed(1), sides: 6 } } }, note: "+d6 Evasion against the attack" }],
    },
  ]),

  // ---------------------------------------------------------------- Tier 4 (HF p.12)

  // Crushing (HF p.12): "When you deal Severe damage, you can spend a Hope to force the target to mark an additional Hit
  // Point."
  stance("crushing", [
    {
      id: "main",
      activation: { kind: "rider", trigger: { kind: "whenTargetMarksHp", severity: "severe" } },
      costs: [{ kind: "hope", amount: fixed(1) }],
      steps: [{ kind: "markHp", to: "targets", amount: fixed(1), note: "The target marks an additional Hit Point" }],
    },
  ]),

  // Exacting (HF p.12): "When you roll a 1 on a damage die, you can treat it as the highest value on the die instead."
  stance("exacting", [
    {
      id: "main",
      activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "damage" } },
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "ones", asMax: true }, note: "A 1 on a damage die counts as the die's highest value" }],
    },
  ]),

  // Honed (HF p.12): "Spend a Focus before you make an attack roll to gain a +1 bonus to your Proficiency for that attack."
  stance("honed", [
    {
      id: "main",
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
      costs: [focusCost(1)],
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "proficiency", delta: 1 }, note: "+1 Proficiency for that attack" }],
    },
  ]),

  // Isolating (HF p.12): "Gain advantage on attack rolls when there are no other creatures within Very Close range of you
  // or your target."
  stance("isolating", [
    {
      id: "main",
      activation: { kind: "passive" },
      requires: [
        {
          kind: "situation",
          text: "No other creatures within Very Close range of you or your target",
          check: { kind: "isolated", range: "veryClose", who: "selfOrTarget" },
        },
      ],
      mods: [{ kind: "advantage", on: "attack" }],
      steps: [],
    },
  ]),
];

// ---------------------------------------------------------------- shifting, dropping out, refocusing (HF p.12)

/** "you drop out of your active stance at the end of the scene" (HF p.12; Q7). */
export const STANCE_DURATION: Duration = "scene";

/** "You also drop out of your active stance when you take Severe damage or mark your last Hit Point." (HF p.12) */
export const STANCE_ENDS_ON: readonly EndEvent[] = ["takeSevere", "lastHp"];

/** The rule data's drop triggers (src/lib/srd/stances.ts) as the engine's events. */
export const STANCE_DROP_EVENTS: Readonly<Record<StanceDropTrigger, EndEvent | "sceneEnd" | "shift">> = {
  shift: "shift",
  "severe-damage": "takeSevere",
  "last-hit-point": "lastHp",
  "scene-end": "sceneEnd",
};

/** Whether an event drops the active stance (HF p.12): shifting into another stance, Severe damage, the last HP, scene end. */
export function dropsActiveStance(event: EndEvent | "sceneEnd" | "shift"): boolean {
  return event === "shift" || event === "sceneEnd" || STANCE_ENDS_ON.includes(event);
}

/** The Martial Artist's sheet state (`classState.martial`). */
export interface MartialState {
  readonly known: readonly string[];
  readonly active?: string;
  readonly focus: number;
}

/**
 * Why a shift is refused, or null when it may go ahead: `unknown` ("You can shift only into stances you've marked as
 * known", HF p.12) or `active` (it is already the active stance: "you can't shift into or have more than one active
 * stance at a time"). The cost is the use's (`SHIFT_STANCE_EFFECT`).
 */
export function shiftRefusal(martial: MartialState | undefined, slug: string): "unknown" | "active" | null {
  if (!martial || !martial.known.includes(slug) || !stanceById(slug)) return "unknown";
  if (martial.active === slug) return "active";
  return null;
}

/** The Martial Artist's state after the active stance drops (HF p.12: "you lose any ongoing benefits it provides"). */
export function dropStance(martial: MartialState): MartialState {
  return { known: martial.known, focus: martial.focus };
}

/**
 * The vocabulary has no step that sets `classState.martial.active`: the shift intent (SD3) checks `shiftRefusal`, runs
 * the use for its price and then sets the active stance (the previous one drops). The use has no steps of its own.
 */
const shiftSteps: readonly Step[] = [];

/**
 * Shift stance (HF p.12): "You can spend a Focus to shift into a martial stance and gain its effects." `flow-state` is
 * Flow State's other price (HF p.11, Martial Artist mastery: "You can mark a Stress instead of spending a Focus to shift
 * into a different stance"); SD3 offers it only when the sheet holds `subclass:martial-artist:flow-state`.
 */
export const SHIFT_STANCE_EFFECT: FeatureEffect = {
  featureId: `stance:${STANCE_OWNER}:shift`,
  source: "stance",
  owner: STANCE_OWNER,
  uses: [
    { id: "main", name: "Shift stance", activation: { kind: "action" }, costs: [focusCost(SHIFT_FOCUS_COST)], steps: shiftSteps },
    { id: "flow-state", name: "Shift stance (Flow State)", activation: { kind: "action" }, costs: [{ kind: "stress", amount: fixed(1) }], steps: shiftSteps },
  ],
};

/**
 * Refocus (HF p.12): "Once per rest during a moment of calm, you can clear your mind and refocus your martial instincts.
 * Clear your Focus track, then roll a number of d6s equal to your Instinct and gain Focus equal to the highest result
 * rolled. You can hold a maximum of 6 Focus." The runner caps Focus at 6; an Instinct of 0 or less rolls no dice and
 * gains 0 Focus (user answer 2026-10-23).
 */
export const REFOCUS_EFFECT: FeatureEffect = {
  featureId: `stance:${STANCE_OWNER}:refocus`,
  source: "stance",
  owner: STANCE_OWNER,
  uses: [
    {
      id: "main",
      name: "Refocus",
      activation: { kind: "action" },
      requires: [{ kind: "situation", text: "During a moment of calm" }],
      limit: { per: REFOCUS.per },
      steps: [
        { kind: "resource", to: "self", resource: "focus", change: "set", amount: fixed(0), note: "Clear your Focus track" },
        {
          kind: "resource",
          to: "self",
          resource: "focus",
          change: "gain",
          amount: { kind: "dice", dice: { count: { kind: "trait", trait: REFOCUS.trait }, sides: REFOCUS.die }, keep: REFOCUS.keep },
          note: "Roll d6s equal to your Instinct; gain Focus equal to the highest",
        },
      ],
    },
  ],
};
