// Adversary feature effects of tier 1 Core Book adversaries (plan combat-actions, tracer AE-t1-core; AA0 shipped it
// empty). Pure data: no framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 52
// adversaries, 140 features (CB p.210-219, printed pages). Each entry quotes its feature text in a comment; what the
// vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express is a `manual` step, never a vocabulary change.
// Readings, manual steps and open rulings: docs/tasks/TASK-CA-AE-t1-core.md.
//
// Reading conventions (the task doc gives the reasons):
// - A feature printed as an action is an `action` that needs the spotlight (CB p.194), unless it spotlights the
//   adversary itself ("Spend a Fear to … spotlight all Giant Rats", "spotlight the Head Guard and …").
// - A printed reaction is a `reaction` (a one-tap prompt, default No, Q19; CB p.195 "you can choose to immediately use
//   the reaction"), except a plain Fear gain (Momentum, Terrifying), which is `auto` (Q19).
// - A passive with a trigger ("Targets who mark HP from …", "When the X marks HP from physical damage …") is `auto`.
// - A passive that replaces the standard attack's damage or targets under a condition (Pack Tactics, From Above,
//   Backstab, Unseen Strike, Flailing Limbs, Ramp Up) is an extra `action` use: the GM picks it instead of the standard
//   attack when the condition holds.
// - "On a success, mark a Stress to …" is a `pay` step after the roll (the rest stops unpaid, CB p.90); "On a success,
//   spend a Fear to …" is an `optional` step the GM taps (Q19: Fear is spent only on the GM's tap).
// - A save against a PC is a `save` step: the runner returns a reaction-roll prompt for each PC (AR11, CB p.99); with no
//   printed Difficulty the adversary's own Difficulty is used (CB p.193).

import type {
  AdversaryCost,
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryRequirement,
} from "../../domain/adversary-effects/types";
import type { ConditionRef, DamageRoll, DieSides, NumberSource, RollSpec, TargetSpec } from "../../domain/card-effects/types";

// ---------------------------------------------------------------- helpers

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const dice = (count: number, sides: DieSides, plus?: number): NumberSource => ({
  kind: "dice",
  dice: { count: fixed(count), sides, ...(plus ? { plus: fixed(plus) } : {}) },
});
const roll = (count: number, sides: DieSides, plus?: number): DamageRoll => ({
  kind: "dice",
  dice: { count: fixed(count), sides, ...(plus ? { plus: fixed(plus) } : {}) },
});
const fear = (n: number): AdversaryCost => ({ kind: "fear", amount: fixed(n) });
const stress = (n: number): AdversaryCost => ({ kind: "stress", amount: fixed(n) });
const situation = (text: string): AdversaryRequirement => ({ kind: "situation", text });

/** d20 + ATK against Evasion (AR1); the runner adds the stat block's ATK. */
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };
const ATTACK_ADV: RollSpec = { ...ATTACK, advantage: true };

const one = (range: TargetSpec["range"]): TargetSpec => ({ side: "enemy", range, count: { kind: "one" } });
const allAround = (range: TargetSpec["range"], side: TargetSpec["side"] = "enemy"): TargetSpec => ({
  side,
  range,
  count: { kind: "all" },
  area: "aroundSelf",
});
const SUBJECT = { side: "trigger", who: "subject" } as const;
const SOURCE = { side: "trigger", who: "source" } as const;

const VULNERABLE: ConditionRef = { kind: "standard", condition: "vulnerable" };
const RESTRAINED: ConditionRef = { kind: "standard", condition: "restrained" };
const HIDDEN: ConditionRef = { kind: "standard", condition: "hidden" };
const tag = (name: string): ConditionRef => ({ kind: "tag", tag: name });

const main = (use: Omit<AdversaryFeatureUse, "id">): AdversaryFeatureUse => ({ id: "main", ...use });
const entry = (adversaryId: string, feature: string, ...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({
  adversaryId,
  feature,
  uses,
});

/** "Momentum - Reaction: When the X makes a successful attack against a PC, you gain a Fear." (CB p.195): automatic (Q19). */
const momentum = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Momentum",
    main({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }],
    }),
  );

/** "Relentless (X) - Passive: The X can be spotlighted up to X times per GM turn. Spend Fear as usual to spotlight them." */
const relentless = (adversaryId: string, times: number): AdversaryFeatureEffect =>
  entry(adversaryId, `Relentless (${times})`, main({ activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "relentless", times }], steps: [] }));

/**
 * "Minion (X) - Passive: The X is defeated when they take any damage. For every X damage a PC deals to the X, defeat an
 * additional Minion within range the attack would succeed against." (CB p.201)
 */
const minion = (adversaryId: string, threshold: number): AdversaryFeatureEffect =>
  entry(adversaryId, `Minion (${threshold})`, main({ activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "minion", threshold }], steps: [] }));

/**
 * "Group Attack - Action: Spend a Fear to choose a target and spotlight all Xs within Close range of them. Those Minions
 * move into Melee range of the target and make one shared attack roll. On a success, they deal N physical damage each.
 * Combine this damage." (AR9, CB p.201). The Fear brings the spotlight, so it needs no spotlight of its own; the target
 * has no range (the Minions move to it).
 */
const groupAttack = (adversaryId: string, perMinion: number): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Group Attack",
    main({
      activation: { kind: "action" },
      needsSpotlight: false,
      costs: [fear(1)],
      roll: ATTACK,
      targets: one("unlimited"),
      groupAttack: { within: "close" },
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "The Minions move into Melee range of the target" },
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "flat", amount: fixed(perMinion) }, type: "physical" },
      ],
    }),
  );

/** "Horde (X) - Passive: When the X have marked half or more of their HP, their standard attack deals X physical damage instead." (AR10, CB p.199) */
const horde = (adversaryId: string, count: number, sides: DieSides, plus: number): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    `Horde (${count}d${sides}+${plus})`,
    main({
      activation: { kind: "passive" },
      needsSpotlight: false,
      modifiers: [{ kind: "horde", damage: { kind: "dice", dice: { count: fixed(count), sides, plus: fixed(plus) } } }],
      steps: [],
    }),
  );

/**
 * "Slow - Passive: When you spotlight the X and they don't have a token on their stat block, they can't act yet. Place a
 * token on their stat block and describe what they're preparing to do. When you spotlight the X and they have a token on
 * their stat block, clear the token and they can act." Two automatic uses on being spotlighted, split by the token.
 */
const slow = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Slow",
    {
      id: "prepare",
      activation: { kind: "auto", trigger: { kind: "onSpotlight", noTokens: true } },
      needsSpotlight: false,
      requires: [{ kind: "tokens", atMost: 0 }],
      steps: [
        { kind: "tokens", to: "self", op: "add", amount: fixed(1) },
        { kind: "manual", to: "self", text: "They can't act yet: describe what they're preparing to do." },
      ],
    },
    {
      id: "act",
      activation: { kind: "auto", trigger: { kind: "onSpotlight" } },
      needsSpotlight: false,
      requires: [{ kind: "tokens", atLeast: 1 }],
      steps: [{ kind: "tokens", to: "self", op: "clear", note: "Clear the token: they can act" }],
    },
  );

/** "Swashbuckler - Passive: When the X marks 2 or fewer HP from an attack within Melee range, the attacker must mark a Stress." */
const swashbuckler = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Swashbuckler",
    main({
      activation: { kind: "auto", trigger: { kind: "onMarkHp", atMost: 2, fromAttack: true, attackerWithin: "melee" } },
      needsSpotlight: false,
      targets: SOURCE,
      steps: [{ kind: "markStress", to: "targets", amount: fixed(1) }],
    }),
  );

const NO_ARMOR_FALLBACK = "If they can't mark an Armor Slot, they must mark an additional HP.";
const HELD_UNTIL = "until they break free with a successful Strength Roll (clearing both) or the Kneebreaker takes Major or greater damage";
const BRAMBLE_UNTIL = "until the bramble tokens are removed (a Finesse Roll of 12 + tokens, or Major or greater damage to the Swarm)";

/**
 * "Acidic Form - Passive: When the Ooze makes a successful attack, the target must mark an Armor Slot without receiving
 * its benefits (they can still use armor to reduce the damage). If they can't mark an Armor Slot, they must mark an
 * additional HP." (CB p.215-216)
 */
const acidicForm = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Acidic Form",
    main({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [
        { kind: "markArmor", to: "targets", amount: fixed(1), noBenefit: true },
        { kind: "manual", to: "targets", text: NO_ARMOR_FALLBACK },
      ],
    }),
  );

/**
 * "Split - Reaction: When the Ooze has 3 or more HP marked, you can spend a Fear to split them into two Tiny X Oozes (with
 * no marked HP or Stress). Immediately spotlight both of them." (CB p.215-216). The original leaves the encounter.
 */
const split = (adversaryId: string, tinyId: string, tinyName: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Split",
    main({
      activation: { kind: "reaction", trigger: { kind: "onHpMarkedAtLeast", value: 3 } },
      needsSpotlight: false,
      requires: [{ kind: "hpMarkedAtLeast", value: 3 }],
      costs: [fear(1)],
      steps: [
        { kind: "defeat", to: "self", note: "The Ooze splits in two" },
        { kind: "summon", label: tinyName, count: fixed(2), adversaryId: tinyId, range: "melee" },
        { kind: "spotlight", who: "sameName", count: fixed(2), name: tinyName, note: "Immediately spotlight both of them" },
      ],
    }),
  );

/**
 * A passive that swaps the standard attack's damage (or targets) under a condition: an extra attack the GM picks instead
 * of the standard attack while the condition holds.
 */
const variantAttack = (
  use: Pick<AdversaryFeatureUse, "requires" | "targets"> & { roll?: RollSpec; damage: DamageRoll; type?: "physical" | "magic" | "weapon"; extra?: AdversaryFeatureUse["steps"] },
): AdversaryFeatureUse => ({
  id: "attack",
  activation: { kind: "action" },
  needsSpotlight: true,
  ...(use.requires ? { requires: use.requires } : {}),
  roll: use.roll ?? ATTACK,
  ...(use.targets ? { targets: use.targets } : {}),
  steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: use.damage, type: use.type ?? "physical" }, ...(use.extra ?? [])],
});

// ---------------------------------------------------------------- the table

export const T1_CORE_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ======== Acid Burrower (Solo, CB p.210)
  relentless("acid-burrower", 3),
  // Earth Eruption: "Mark a Stress to have the Burrower burst out of the ground. All creatures within Very Close range must
  // succeed on an Agility Reaction Roll or be knocked over, making them Vulnerable until they next act."
  entry(
    "acid-burrower",
    "Earth Eruption",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: allAround("veryClose", "any"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "actorDifficulty" },
          onFail: [{ kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "until they next act", note: "Knocked over" }],
          onSuccess: [],
        },
      ],
    }),
  ),
  // Spit Acid: "Make an attack against all targets in front of the Burrower within Close range. Targets the Burrower
  // succeeds against take 2d6 physical damage and must mark an Armor Slot without receiving its benefits (they can still
  // use armor to reduce the damage). If they can't mark an Armor Slot, they must mark an additional HP and you gain a Fear."
  entry(
    "acid-burrower",
    "Spit Acid",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: { side: "enemy", range: "close", count: { kind: "all" }, area: "front" },
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(2, 6), type: "physical" },
        { kind: "markArmor", to: "targets", when: ["hit"], amount: fixed(1), noBenefit: true },
        { kind: "manual", to: "targets", when: ["hit"], text: "If they can't mark an Armor Slot, they must mark an additional HP and you gain a Fear." },
      ],
    }),
  ),
  // Acid Bath: "When the Burrower takes Severe damage, all creatures within Close range are bathed in their acidic blood,
  // taking 1d10 physical damage. This splash covers the ground within Very Close range with blood, and all creatures other
  // than the Burrower who move through it take 1d6 physical damage."
  entry(
    "acid-burrower",
    "Acid Bath",
    main({
      activation: { kind: "reaction", trigger: { kind: "onDamaged", stage: "did", minSeverity: "severe" } },
      needsSpotlight: false,
      targets: allAround("close", "any"),
      steps: [
        { kind: "damage", to: "targets", roll: roll(1, 10), type: "physical" },
        { kind: "manual", to: "self", text: "Blood covers the ground within Very Close range: creatures other than the Burrower who move through it take 1d6 physical damage." },
      ],
    }),
  ),

  // ======== Archer Guard (Ranged, CB p.212)
  // Hobbling Shot: "Make an attack against a target within Far range. On a success, mark a Stress to deal 1d12+3 physical
  // damage. If the target marks HP from this attack, they have disadvantage on Agility Rolls until they clear at least 1 HP."
  entry(
    "archer-guard",
    "Hobbling Shot",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("far"),
      steps: [
        { kind: "pay", when: ["hit"], costs: [stress(1)] },
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 12, 3), type: "physical" },
        { kind: "manual", to: "targets", when: ["hit"], text: "If the target marks HP from this attack, they have disadvantage on Agility Rolls until they clear at least 1 HP." },
      ],
    }),
  ),

  // ======== Bear (Bruiser, CB p.210)
  // Overwhelming Force: "Targets who mark HP from the Bear's standard attack are knocked back to Very Close range."
  entry(
    "bear",
    "Overwhelming Force",
    main({
      activation: { kind: "auto", trigger: { kind: "onTargetMarksHp", attack: "standard" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "move", to: "targets", mode: "knockBack", range: "veryClose", relativeTo: "self" }],
    }),
  ),
  // Bite: "Mark a Stress to make an attack against a target within Melee range. On a success, deal 3d4+10 physical damage
  // and the target is Restrained until they break free with a successful Strength Roll."
  entry(
    "bear",
    "Bite",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: one("melee"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(3, 4, 10), type: "physical" },
        { kind: "condition", to: "targets", when: ["hit"], condition: RESTRAINED, duration: "manual", endsWhen: "until they break free with a successful Strength Roll" },
      ],
    }),
  ),
  momentum("bear"),

  // ======== Bladed Guard (Standard, CB p.212)
  // Shield Wall: "A creature who tries to move within Very Close range of the Guard must succeed on an Agility Roll. If
  // additional Bladed Guards are standing in a line alongside the first, and each is within Melee range of another guard
  // in the line, the Difficulty increases by the total number of guards in that line."
  entry(
    "bladed-guard",
    "Shield Wall",
    main({
      activation: { kind: "auto", trigger: { kind: "pcMoves", into: "veryClose" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [
        {
          kind: "manual",
          to: "self",
          text: "If additional Bladed Guards stand in a line alongside the first, each within Melee range of another, the Difficulty increases by the number of guards in the line.",
        },
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "actorDifficulty" },
          onFail: [{ kind: "manual", to: "targets", text: "They can't move within Very Close range of the Guard." }],
          onSuccess: [],
          note: "An Agility Roll against the Guard's Difficulty",
        },
      ],
    }),
  ),
  // Detain: "Make an attack against a target within Very Close range. On a success, mark a Stress to Restrain the target
  // until they break free with a successful attack, Finesse Roll, or Strength Roll."
  entry(
    "bladed-guard",
    "Detain",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("veryClose"),
      steps: [
        { kind: "pay", when: ["hit"], costs: [stress(1)] },
        {
          kind: "condition",
          to: "targets",
          when: ["hit"],
          condition: RESTRAINED,
          duration: "manual",
          endsWhen: "until they break free with a successful attack, Finesse Roll, or Strength Roll",
        },
      ],
    }),
  ),

  // ======== Brawny Zombie (Bruiser, CB p.219)
  slow("brawny-zombie"),
  // Rend Asunder: "Make a standard attack with advantage against a target the Zombie has Restrained. On a success, the
  // attack deals direct damage."
  entry(
    "brawny-zombie",
    "Rend Asunder",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK_ADV,
      targets: one("veryClose"),
      steps: [
        {
          kind: "damage",
          to: "targets",
          when: ["hit", { kind: "targetHas", condition: RESTRAINED }],
          roll: { kind: "standardAttack" },
          type: "weapon",
          direct: true,
          note: "Only against a target the Zombie has Restrained",
        },
      ],
    }),
  ),
  // Rip and Tear: "When the Zombies makes a successful standard attack, you can mark a Stress to temporarily Restrain the
  // target and force them to mark 2 Stress."
  entry(
    "brawny-zombie",
    "Rip and Tear",
    main({
      activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
      needsSpotlight: false,
      costs: [stress(1)],
      targets: SUBJECT,
      steps: [
        { kind: "condition", to: "targets", condition: RESTRAINED, duration: "temporary" },
        { kind: "markStress", to: "targets", amount: fixed(2) },
      ],
    }),
  ),

  // ======== Cave Ogre (Solo, CB p.210)
  // Ramp Up: "You must spend a Fear to spotlight the Ogre. While spotlighted, they can make their standard attack against
  // all targets within range."
  entry(
    "cave-ogre",
    "Ramp Up",
    { id: "main", activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "spotlightCostsFear" }], steps: [] },
    variantAttack({ targets: allAround("veryClose"), damage: { kind: "standardAttack" }, type: "weapon" }),
  ),
  // Bone Breaker: "The Ogre's attacks deal direct damage."
  entry("cave-ogre", "Bone Breaker", main({ activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "directAttacks" }], steps: [] })),
  // Hail of Boulders: "Mark a Stress to pick up heavy objects and throw them at all targets in front of the Ogre within Far
  // range. Make an attack against these targets. Targets the Ogre succeeds against take 1d10+2 physical damage. If they
  // succeed against more than one target, you gain a Fear."
  entry(
    "cave-ogre",
    "Hail of Boulders",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "front" },
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 10, 2), type: "physical" },
        {
          kind: "fear",
          to: "self",
          change: "gain",
          amount: { kind: "calc", of: { kind: "targetCount", which: "hit" }, plus: -1, min: 0, max: fixed(1) },
          note: "A Fear when more than one target was hit",
        },
      ],
    }),
  ),
  // Rampaging Fury: "When the Ogre marks 2 or more HP, they can rampage. Move the Ogre to a point within Close range and
  // deal 2d6+3 direct physical damage to all targets in their path."
  entry(
    "cave-ogre",
    "Rampaging Fury",
    main({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", atLeast: 2 } },
      needsSpotlight: false,
      targets: { side: "any", range: "close", count: { kind: "all" }, area: "path" },
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close", relativeTo: "self" },
        { kind: "damage", to: "targets", roll: roll(2, 6, 3), type: "physical", direct: true },
      ],
    }),
  ),

  // ======== Construct (Solo, CB p.210)
  relentless("construct", 2),
  // Weak Structure: "When the Construct marks HP from physical damage, they must mark an additional HP."
  entry(
    "construct",
    "Weak Structure",
    main({
      activation: { kind: "auto", trigger: { kind: "onMarkHp", damageType: "physical" } },
      needsSpotlight: false,
      steps: [{ kind: "markHp", to: "self", amount: fixed(1) }],
    }),
  ),
  // Trample: "Mark a Stress to make an attack against all targets in the Construct's path when they move. Targets the
  // Construct succeeds against take 1d8 physical damage."
  entry(
    "construct",
    "Trample",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: { side: "enemy", range: "close", count: { kind: "all" }, area: "path" },
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close", relativeTo: "self" },
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 8), type: "physical" },
      ],
    }),
  ),
  // Overload: "Before rolling damage for the Construct's attack, you can mark a Stress to gain a +10 bonus to the damage
  // roll. The Construct can then take the spotlight again."
  entry(
    "construct",
    "Overload",
    main({
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "beforeDamage", attack: "any" } },
      needsSpotlight: false,
      costs: [stress(1)],
      targets: SUBJECT,
      steps: [
        { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: fixed(10) } },
        { kind: "spotlight", who: "self", note: "The Construct can then take the spotlight again" },
      ],
    }),
  ),
  // Death Quake: "When the Construct marks their last HP, the magic powering them ruptures in an explosion of force. Make an
  // attack with advantage against all targets within Very Close range. Targets the Construct succeeds against take 1d12+2
  // magic damage."
  entry(
    "construct",
    "Death Quake",
    main({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", last: true } },
      needsSpotlight: false,
      roll: ATTACK_ADV,
      targets: allAround("veryClose"),
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 12, 2), type: "magic" }],
    }),
  ),

  // ======== Courtier (Social, CB p.211)
  // Mockery: "Mark a Stress to say something mocking and force a target within Close range to make a Presence Reaction Roll
  // (14) to see if they can save face. On a failure, the target must mark 2 Stress and is Vulnerable until the scene ends."
  entry(
    "courtier",
    "Mockery",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: one("close"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "presence",
          difficulty: { kind: "fixed", value: 14 },
          onFail: [
            { kind: "markStress", to: "targets", amount: fixed(2) },
            { kind: "condition", to: "targets", condition: VULNERABLE, duration: "scene" },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // Scapegoat: "Spend a Fear and target a PC. The Courtier convinces a crowd or prominent individual that the target is the
  // cause of their current conflict or misfortune."
  entry(
    "courtier",
    "Scapegoat",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: one("unlimited"),
      steps: [{ kind: "manual", to: "targets", text: "The Courtier convinces a crowd or prominent individual that the target is the cause of their current conflict or misfortune." }],
    }),
  ),

  // ======== Deeproot Defender (Bruiser, CB p.211)
  // Ground Slam: "Slam the ground, knocking all targets within Very Close range back to Far range. Each target knocked back
  // this way must mark a Stress."
  entry(
    "deeproot-defender",
    "Ground Slam",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      targets: allAround("veryClose"),
      steps: [
        { kind: "move", to: "targets", mode: "knockBack", range: "far", relativeTo: "self" },
        { kind: "markStress", to: "targets", amount: fixed(1) },
      ],
    }),
  ),
  // Grab and Drag: "Make an attack against a target within Close range. On a success, spend a Fear to pull them into Melee
  // range, deal 1d6+2 physical damage, and Restrain them until the Defender takes Severe damage."
  entry(
    "deeproot-defender",
    "Grab and Drag",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("close"),
      steps: [
        {
          kind: "optional",
          id: "drag",
          label: "Spend a Fear to pull them in, deal 1d6+2 physical damage and Restrain them",
          when: ["hit"],
          costs: [fear(1)],
          steps: [
            { kind: "move", to: "targets", when: ["hit"], mode: "pull", range: "melee", relativeTo: "self" },
            { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 6, 2), type: "physical" },
            { kind: "condition", to: "targets", when: ["hit"], condition: RESTRAINED, duration: "manual", endsWhen: "until the Defender takes Severe damage" },
          ],
        },
      ],
    }),
  ),

  // ======== Dire Wolf (Skulk, CB p.211)
  // Pack Tactics: "If the Wolf makes a successful standard attack and another Dire Wolf is within Melee range of the target,
  // deal 1d6+5 physical damage instead of their standard damage and you gain a Fear."
  entry(
    "dire-wolf",
    "Pack Tactics",
    variantAttack({
      requires: [{ kind: "allyWithin", range: "melee", of: "target", name: "Dire Wolf" }],
      targets: one("melee"),
      damage: roll(1, 6, 5),
      extra: [{ kind: "fear", to: "self", when: ["hit"], change: "gain", amount: fixed(1) }],
    }),
  ),
  // Hobbling Strike: "Mark a Stress to make an attack against a target within Melee range. On a success, deal 3d4+10 direct
  // physical damage and make them Vulnerable until they clear at least 1 HP."
  entry(
    "dire-wolf",
    "Hobbling Strike",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: one("melee"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(3, 4, 10), type: "physical", direct: true },
        { kind: "condition", to: "targets", when: ["hit"], condition: VULNERABLE, duration: "manual", endsWhen: "until they clear at least 1 HP" },
      ],
    }),
  ),

  // ======== Giant Mosquitoes (Horde, CB p.211)
  horde("giant-mosquitoes", 1, 4, 1),
  // Flying: "While flying, the Mosquitoes have a +2 bonus to their Difficulty."
  entry(
    "giant-mosquitoes",
    "Flying",
    main({
      activation: { kind: "passive" },
      needsSpotlight: false,
      requires: [situation("While flying")],
      modifiers: [
        { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(2) } },
        { kind: "mod", mod: { kind: "flag", flag: "flying" } },
      ],
      steps: [],
    }),
  ),
  // Bloodsucker: "When the Mosquitoes' attack causes a target to mark HP, you can mark a Stress to force the target to mark
  // an additional HP."
  entry(
    "giant-mosquitoes",
    "Bloodsucker",
    main({
      activation: { kind: "reaction", trigger: { kind: "onTargetMarksHp", attack: "any" } },
      needsSpotlight: false,
      costs: [stress(1)],
      targets: SUBJECT,
      steps: [{ kind: "markHp", to: "targets", amount: fixed(1) }],
    }),
  ),

  // ======== Giant Rat (Minion, CB p.211)
  minion("giant-rat", 3),
  groupAttack("giant-rat", 1),

  // ======== Giant Scorpion (Bruiser, CB p.211)
  // Double Strike: "Mark a Stress to make a standard attack against two targets within Melee range." One roll for both (AR7).
  entry(
    "giant-scorpion",
    "Double Strike",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: { side: "enemy", range: "melee", count: { kind: "upTo", n: fixed(2) } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" }],
    }),
  ),
  // Venomous Stinger: "Make an attack against a target within Very Close range. On a success, spend a Fear to deal 1d4+4
  // physical damage and Poison them until their next rest or they succeed on a Knowledge Roll (16). While Poisoned, the
  // target must roll a d6 before they make an action roll. On a result of 4 or lower, they must mark a Stress."
  entry(
    "giant-scorpion",
    "Venomous Stinger",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("veryClose"),
      steps: [
        {
          kind: "optional",
          id: "poison",
          label: "Spend a Fear to deal 1d4+4 physical damage and Poison them",
          when: ["hit"],
          costs: [fear(1)],
          steps: [
            { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 4, 4), type: "physical" },
            { kind: "condition", to: "targets", when: ["hit"], condition: tag("Poisoned"), duration: "rest", endsWhen: "or until they succeed on a Knowledge Roll (16)" },
            { kind: "manual", to: "targets", when: ["hit"], text: "While Poisoned, the target rolls a d6 before each action roll; on a result of 4 or lower, they must mark a Stress." },
          ],
        },
      ],
    }),
  ),
  momentum("giant-scorpion"),

  // ======== Glass Snake (Standard, CB p.212)
  // Armor-Shredding Shards: "After a successful attack against the Snake within Melee range, the attacker must mark an Armor
  // Slot. If they can't mark an Armor Slot, they must mark an HP."
  entry(
    "glass-snake",
    "Armor-Shredding Shards",
    main({
      activation: { kind: "auto", trigger: { kind: "onAttacked", stage: "succeeded", attackerWithin: "melee" } },
      needsSpotlight: false,
      targets: SOURCE,
      steps: [
        { kind: "markArmor", to: "targets", amount: fixed(1) },
        { kind: "manual", to: "targets", text: "If they can't mark an Armor Slot, they must mark an HP." },
      ],
    }),
  ),
  // Spinning Serpent: "Mark a Stress to make an attack against all targets within Very Close range. Targets the Snake
  // succeeds against take 1d6+1 physical damage."
  entry(
    "glass-snake",
    "Spinning Serpent",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 6, 1), type: "physical" }],
    }),
  ),
  // Spitter: "Spend a Fear to introduce a d6 Spitter Die. When the Snake is in the spotlight, roll this die. On a result of
  // 5 or higher, all targets in front of the Snake within Far range must succeed on an Agility Reaction Roll or take 1d4
  // physical damage. The Snake can take the spotlight a second time this GM turn." The die is a token on the stat block.
  entry(
    "glass-snake",
    "Spitter",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      steps: [
        { kind: "tokens", to: "self", op: "set", amount: fixed(1), note: "The Spitter Die is in play" },
        { kind: "spotlight", who: "self", note: "The Snake can take the spotlight a second time this GM turn" },
      ],
    }),
    {
      id: "spit",
      activation: { kind: "auto", trigger: { kind: "onSpotlight" } },
      needsSpotlight: false,
      requires: [{ kind: "tokens", atLeast: 1 }],
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "front" },
      steps: [
        {
          kind: "check",
          dice: { count: fixed(1), sides: 6 },
          test: { kind: "anyAtLeast", value: 5 },
          then: [
            {
              kind: "save",
              to: "targets",
              trait: "agility",
              difficulty: { kind: "actorDifficulty" },
              onFail: [{ kind: "damage", to: "targets", roll: roll(1, 4), type: "physical" }],
              onSuccess: [],
            },
          ],
          otherwise: [],
          note: "Roll the Spitter Die",
        },
      ],
    },
  ),

  // ======== Green Ooze (Skulk, CB p.215)
  slow("green-ooze"),
  acidicForm("green-ooze"),
  // Envelop: "Make a standard attack against a target within Melee range. On a success, the Ooze envelops them and the
  // target must mark 2 Stress. The target must mark an additional Stress when they make an action roll. If the Ooze takes
  // Severe damage, the target is freed."
  entry(
    "green-ooze",
    "Envelop",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("melee"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" },
        { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(2) },
        { kind: "condition", to: "targets", when: ["hit"], condition: tag("Enveloped"), duration: "manual", endsWhen: "until the Ooze takes Severe damage" },
        { kind: "manual", to: "targets", when: ["hit"], text: "While enveloped, the target must mark an additional Stress when they make an action roll." },
      ],
    }),
  ),
  split("green-ooze", "tiny-green-ooze", "Tiny Green Ooze"),

  // ======== Harrier (Standard, CB p.212)
  // Maintain Distance: "After making a standard attack, the Harrier can move anywhere within Far range."
  entry(
    "harrier",
    "Maintain Distance",
    main({
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "after", attack: "standard" } },
      needsSpotlight: false,
      steps: [{ kind: "move", to: "self", mode: "move", range: "far", relativeTo: "self" }],
    }),
  ),
  // Fall Back: "When a creature moves into Melee range to make an attack, you can mark a Stress before the attack roll to
  // move anywhere within Close range and make an attack against that creature. On a success, deal 1d10+2 physical damage."
  entry(
    "harrier",
    "Fall Back",
    main({
      activation: { kind: "reaction", trigger: { kind: "onAttacked", stage: "targeted", attackerWithin: "melee" } },
      needsSpotlight: false,
      costs: [stress(1)],
      roll: ATTACK,
      targets: SOURCE,
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close", relativeTo: "self" },
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 10, 2), type: "physical" },
      ],
    }),
  ),

  // ======== Head Guard (Leader, CB p.212)
  // Rally Guards: "Spend 2 Fear to spotlight the Head Guard and up to 2d4 allies within Far range."
  entry(
    "head-guard",
    "Rally Guards",
    main({
      activation: { kind: "action" },
      needsSpotlight: false,
      costs: [fear(2)],
      steps: [
        { kind: "spotlight", who: "self" },
        { kind: "spotlight", who: "allies", count: dice(2, 4), within: "far", note: "Up to 2d4 allies" },
      ],
    }),
  ),
  // On My Signal (Countdown (5)): "When the Head Guard is in the spotlight for the first time, activate the countdown. It
  // ticks down when a PC makes an attack roll. When it triggers, all Archer Guards within Far range make a standard attack
  // with advantage against the nearest target within their range. If any attacks succeed on the same target, combine their
  // damage."
  entry(
    "head-guard",
    "On My Signal",
    main({
      activation: { kind: "reaction", trigger: { kind: "onSpotlight", first: "scene" } },
      needsSpotlight: false,
      steps: [
        {
          kind: "countdown",
          op: "start",
          label: "On My Signal",
          start: fixed(5),
          onTrigger: "All Archer Guards within Far range make a standard attack with advantage against the nearest target within their range.",
        },
      ],
    }),
    {
      id: "tick",
      activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "attack" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "tick", label: "On My Signal" }],
    },
    {
      id: "signal",
      activation: { kind: "action" },
      needsSpotlight: false,
      steps: [
        { kind: "spotlight", who: "sameName", name: "Archer Guard", within: "far" },
        {
          kind: "manual",
          to: "self",
          text: "Each Archer Guard makes a standard attack with advantage against the nearest target within its range; combine the damage of attacks that succeed on the same target.",
        },
      ],
    },
  ),
  momentum("head-guard"),

  // ======== Jagged Knife Bandit (Standard, CB p.213)
  // Climber: "The Bandit climbs just as easily as they run." (No rule to apply: a reminder.)
  entry(
    "jagged-knife-bandit",
    "Climber",
    main({ activation: { kind: "passive" }, needsSpotlight: false, steps: [{ kind: "manual", to: "self", text: "The Bandit climbs just as easily as they run." }] }),
  ),
  // From Above: "When the Bandit succeeds on a standard attack from above a target, they deal 1d10+1 physical damage instead
  // of their standard damage."
  entry(
    "jagged-knife-bandit",
    "From Above",
    variantAttack({ requires: [situation("The Bandit attacks from above the target")], targets: one("melee"), damage: roll(1, 10, 1) }),
  ),

  // ======== Jagged Knife Hexer (Support, CB p.213)
  // Curse: "Choose a target within Far range and temporarily Curse them. While the target is Cursed, you can mark a Stress
  // when that target rolls with Hope to make the roll be with Fear instead."
  entry(
    "jagged-knife-hexer",
    "Curse",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      targets: one("far"),
      steps: [{ kind: "condition", to: "targets", condition: tag("Cursed"), duration: "temporary" }],
    }),
    {
      id: "hex",
      activation: { kind: "reaction", trigger: { kind: "pcRolls", result: "withHope" } },
      needsSpotlight: false,
      costs: [stress(1)],
      targets: SUBJECT,
      steps: [
        {
          kind: "modifyRoll",
          to: "targets",
          when: [{ kind: "targetHas", condition: tag("Cursed") }],
          change: { kind: "swapDuality" },
          note: "The roll is with Fear instead",
        },
      ],
    },
  ),
  // Chaotic Flux: "Make an attack against up to three targets within Very Close range. Mark a Stress to deal 2d6+3 magic
  // damage to targets the Hexer succeeded against."
  entry(
    "jagged-knife-hexer",
    "Chaotic Flux",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: { side: "enemy", range: "veryClose", count: { kind: "upTo", n: fixed(3) } },
      steps: [
        { kind: "pay", when: ["hit"], costs: [stress(1)] },
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(2, 6, 3), type: "magic" },
      ],
    }),
  ),

  // ======== Jagged Knife Kneebreaker (Bruiser, CB p.213)
  // I've Got 'Em: "Creatures Restrained by the Kneebreaker take double damage from attacks by other adversaries."
  entry(
    "jagged-knife-kneebreaker",
    "I've Got 'Em",
    main({
      activation: { kind: "passive" },
      needsSpotlight: false,
      steps: [{ kind: "manual", to: "self", text: "Creatures Restrained by the Kneebreaker take double damage from attacks by other adversaries." }],
    }),
  ),
  // Hold Them Down: "Make an attack against a target within Melee range. On a success, the target takes no damage but is
  // Restrained and Vulnerable. The target can break free, clearing both conditions, with a successful Strength Roll or is
  // freed automatically if the Kneebreaker takes Major or greater damage."
  entry(
    "jagged-knife-kneebreaker",
    "Hold Them Down",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("melee"),
      steps: [
        { kind: "condition", to: "targets", when: ["hit"], condition: RESTRAINED, duration: "manual", endsWhen: HELD_UNTIL },
        { kind: "condition", to: "targets", when: ["hit"], condition: VULNERABLE, duration: "manual", endsWhen: HELD_UNTIL },
      ],
    }),
  ),

  // ======== Jagged Knife Lackey (Minion, CB p.213)
  minion("jagged-knife-lackey", 3),
  groupAttack("jagged-knife-lackey", 2),

  // ======== Jagged Knife Lieutenant (Leader, CB p.213)
  // Tactician: "When you spotlight the Lieutenant, mark a Stress to also spotlight two allies within Close range."
  entry(
    "jagged-knife-lieutenant",
    "Tactician",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      steps: [{ kind: "spotlight", who: "allies", count: fixed(2), within: "close" }],
    }),
  ),
  // More Where That Came From: "Summon three Jagged Knife Lackeys, who appear at Far range."
  entry(
    "jagged-knife-lieutenant",
    "More Where That Came From",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      steps: [{ kind: "summon", label: "Jagged Knife Lackey", count: fixed(3), adversaryId: "jagged-knife-lackey", range: "far" }],
    }),
  ),
  // Coup de Grace: "Spend a Fear to make an attack against a Vulnerable target within Close range. On a success, deal 2d6+12
  // physical damage and the target must mark a Stress."
  entry(
    "jagged-knife-lieutenant",
    "Coup de Grace",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      roll: ATTACK,
      targets: one("close"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit", { kind: "targetHas", condition: VULNERABLE }], roll: roll(2, 6, 12), type: "physical", note: "Only against a Vulnerable target" },
        { kind: "markStress", to: "targets", when: ["hit", { kind: "targetHas", condition: VULNERABLE }], amount: fixed(1) },
      ],
    }),
  ),
  momentum("jagged-knife-lieutenant"),

  // ======== Jagged Knife Shadow (Skulk, CB p.214)
  // Backstab: "When the Shadow succeeds on a standard attack that has advantage, they deal 1d6+6 physical damage instead of
  // their standard damage."
  entry(
    "jagged-knife-shadow",
    "Backstab",
    variantAttack({ requires: [situation("The attack has advantage")], roll: ATTACK_ADV, targets: one("melee"), damage: roll(1, 6, 6) }),
  ),
  // Cloaked: "Become Hidden until after the Shadow's next attack. Attacks made while Hidden from this feature have advantage."
  entry(
    "jagged-knife-shadow",
    "Cloaked",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      steps: [
        { kind: "condition", to: "self", condition: HIDDEN, duration: "manual", endsWhen: "until after the Shadow's next attack" },
        { kind: "effect", to: "self", label: "Cloaked", mods: [{ kind: "advantage", on: "attack" }], duration: "manual", endsWhen: "until after the Shadow's next attack" },
      ],
    }),
  ),

  // ======== Jagged Knife Sniper (Ranged, CB p.214)
  // Unseen Strike: "If the Sniper is Hidden when they make a successful standard attack against a target, they deal 1d10+4
  // physical damage instead of their standard damage."
  entry(
    "jagged-knife-sniper",
    "Unseen Strike",
    variantAttack({ requires: [{ kind: "hasCondition", condition: HIDDEN }], targets: one("far"), damage: roll(1, 10, 4) }),
  ),

  // ======== Merchant (Social, CB p.214)
  // Preferential Treatment: "A PC who succeeds on a Presence Roll against the Merchant gains a discount on purchases. A PC
  // who fails on a Presence Roll against the Merchant must pay more and has disadvantage on future Presence Rolls against
  // the Merchant."
  entry(
    "merchant",
    "Preferential Treatment",
    {
      id: "discount",
      activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "presence", result: "success", againstSelf: true } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "manual", to: "targets", text: "The PC gains a discount on purchases." }],
    },
    {
      id: "markup",
      activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "presence", result: "failure", againstSelf: true } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [
        { kind: "condition", to: "targets", condition: tag("Out of Favor"), duration: "manual", endsWhen: "while dealing with this Merchant" },
        { kind: "manual", to: "targets", text: "The PC must pay more and has disadvantage on future Presence Rolls against the Merchant." },
      ],
    },
  ),
  // The Runaround: "When a PC rolls a 14 or lower on a Presence Roll made against the Merchant, they must mark a Stress."
  entry(
    "merchant",
    "The Runaround",
    main({
      activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "presence", againstSelf: true, totalAtMost: 14 } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "markStress", to: "targets", amount: fixed(1) }],
    }),
  ),

  // ======== Minor Chaos Elemental (Solo, CB p.214)
  // Arcane Form: "The Elemental is resistant to magic damage."
  entry(
    "minor-chaos-elemental",
    "Arcane Form",
    main({ activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "magic", level: "resistant" } }], steps: [] }),
  ),
  // Sickening Flux: "Mark a HP to force all targets within Close range to mark a Stress and become Vulnerable until their
  // next rest or they clear a HP."
  entry(
    "minor-chaos-elemental",
    "Sickening Flux",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [{ kind: "hp", amount: fixed(1) }],
      targets: allAround("close"),
      steps: [
        { kind: "markStress", to: "targets", amount: fixed(1) },
        { kind: "condition", to: "targets", condition: VULNERABLE, duration: "rest", endsWhen: "or until they clear a HP" },
      ],
    }),
  ),
  // Remake Reality: "Spend a Fear to transform the area within Very Close range into a different biome. All targets within
  // this area take 2d6+3 direct magic damage."
  entry(
    "minor-chaos-elemental",
    "Remake Reality",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: allAround("veryClose", "any"),
      steps: [{ kind: "damage", to: "targets", roll: roll(2, 6, 3), type: "magic", direct: true, note: "The area becomes a different biome" }],
    }),
  ),
  // Magical Reflection: "When the Elemental takes damage from an attack within Close range, deal an amount of damage to the
  // attacker equal to half the damage they dealt."
  entry(
    "minor-chaos-elemental",
    "Magical Reflection",
    main({
      activation: { kind: "reaction", trigger: { kind: "onDamaged", stage: "did", fromAttack: true, attackerWithin: "close" } },
      needsSpotlight: false,
      targets: SOURCE,
      steps: [
        {
          kind: "damage",
          to: "targets",
          roll: { kind: "flat", amount: { kind: "calc", of: { kind: "triggerAmount" }, divide: 2 } },
          type: "magic",
          note: "Half the damage the attacker dealt (rounded up, CB p.107)",
        },
      ],
    }),
  ),
  momentum("minor-chaos-elemental"),

  // ======== Minor Demon (Solo, CB p.215)
  relentless("minor-demon", 2),
  // All Must Fall: "When a PC rolls a failure with Fear while within Close range of the Demon, they lose a Hope."
  entry(
    "minor-demon",
    "All Must Fall",
    main({
      activation: { kind: "auto", trigger: { kind: "pcRolls", result: "failureWithFear", within: "close" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "hope", to: "targets", change: "lose", amount: fixed(1) }],
    }),
  ),
  // Hellfire: "Spend a Fear to rain down hellfire within Far range. All targets within the area must make an Agility
  // Reaction Roll. Targets who fail take 1d20+3 magic damage. Targets who succeed take half damage."
  entry(
    "minor-demon",
    "Hellfire",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: allAround("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "actorDifficulty" },
          onFail: [{ kind: "damage", to: "targets", roll: roll(1, 20, 3), type: "magic" }],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(1, 20, 3), type: "magic", scale: "half" }],
        },
      ],
    }),
  ),
  // Reaper: "Before rolling damage for the Demon's attack, you can mark a Stress to gain a bonus to the damage roll equal to
  // the Demon's current number of marked HP."
  entry(
    "minor-demon",
    "Reaper",
    main({
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "beforeDamage", attack: "any" } },
      needsSpotlight: false,
      costs: [stress(1)],
      targets: SUBJECT,
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "marked", who: "self", track: "hp" } } }],
    }),
  ),
  momentum("minor-demon"),

  // ======== Minor Fire Elemental (Solo, CB p.214)
  relentless("minor-fire-elemental", 2),
  // Scorched Earth: "Mark a Stress to choose a point within Far range. The ground within Very Close range of that point
  // immediately bursts into flames. All creatures within this area must make an Agility Reaction Roll. Targets who fail take
  // 2d8 magic damage from the flames. Targets who succeed take half damage."
  entry(
    "minor-fire-elemental",
    "Scorched Earth",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: { side: "any", range: "far", count: { kind: "all" }, area: "aroundPoint", areaRange: "veryClose" },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "actorDifficulty" },
          onFail: [{ kind: "damage", to: "targets", roll: roll(2, 8), type: "magic" }],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(2, 8), type: "magic", scale: "half" }],
        },
      ],
    }),
  ),
  // Explosion: "Spend a Fear to erupt in a fiery explosion. Make an attack against all targets within Close range. Targets
  // the Elemental succeeds against take 1d8 magic damage and are knocked back to Far range."
  entry(
    "minor-fire-elemental",
    "Explosion",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      roll: ATTACK,
      targets: allAround("close"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 8), type: "magic" },
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "far", relativeTo: "self" },
      ],
    }),
  ),
  // Consume Kindling: "Three times per scene, when the Elemental moves onto objects that are highly flammable, consume them
  // to clear a HP or a Stress."
  entry(
    "minor-fire-elemental",
    "Consume Kindling",
    main({
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Elemental moves onto highly flammable objects" } },
      needsSpotlight: false,
      limit: { per: "scene", times: 3 },
      steps: [
        {
          kind: "choose",
          id: "consume",
          label: "Clear a HP or a Stress",
          options: [
            { id: "hp", label: "Clear a HP", steps: [{ kind: "clear", to: "self", track: "hp", amount: fixed(1) }] },
            { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: fixed(1) }] },
          ],
        },
      ],
    }),
  ),
  momentum("minor-fire-elemental"),

  // ======== Minor Treant (Minion, CB p.215)
  minion("minor-treant", 5),
  groupAttack("minor-treant", 4),

  // ======== Patchwork Zombie Hulk (Solo, CB p.219)
  // Destructible: "When the Zombie takes Major or greater damage, they mark an additional HP."
  entry(
    "patchwork-zombie-hulk",
    "Destructible",
    main({
      activation: { kind: "auto", trigger: { kind: "onDamaged", stage: "did", minSeverity: "major" } },
      needsSpotlight: false,
      steps: [{ kind: "markHp", to: "self", amount: fixed(1) }],
    }),
  ),
  // Flailing Limbs: "When the Zombie makes a standard attack, they can attack all targets within Very Close range."
  entry(
    "patchwork-zombie-hulk",
    "Flailing Limbs",
    variantAttack({ targets: allAround("veryClose"), damage: { kind: "standardAttack" }, type: "weapon" }),
  ),
  // Another for the Pile: "When the Zombie is within Very Close range of a corpse, they can incorporate it into themselves,
  // clearing a HP and a Stress."
  entry(
    "patchwork-zombie-hulk",
    "Another for the Pile",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      requires: [situation("The Zombie is within Very Close range of a corpse")],
      steps: [
        { kind: "clear", to: "self", track: "hp", amount: fixed(1) },
        { kind: "clear", to: "self", track: "stress", amount: fixed(1) },
      ],
    }),
  ),
  // Tormented Screams: "Mark a Stress to cause all PCs within Far range to make a Presence Reaction Roll (13). Targets who
  // fail lose a Hope and you gain a Fear for each. Targets who succeed must mark a Stress."
  entry(
    "patchwork-zombie-hulk",
    "Tormented Screams",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: allAround("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "presence",
          difficulty: { kind: "fixed", value: 13 },
          onFail: [
            { kind: "hope", to: "targets", change: "lose", amount: fixed(1) },
            { kind: "fear", to: "self", change: "gain", amount: fixed(1) },
          ],
          onSuccess: [{ kind: "markStress", to: "targets", amount: fixed(1) }],
        },
      ],
    }),
  ),

  // ======== Petty Noble (Social, CB p.216)
  // My Land, My Rules: "All social actions made against the Noble on their land have disadvantage."
  entry(
    "petty-noble",
    "My Land, My Rules",
    main({
      activation: { kind: "passive" },
      needsSpotlight: false,
      requires: [situation("The Noble is on their land")],
      modifiers: [{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "presence" } }],
      steps: [{ kind: "manual", to: "self", text: "All social actions made against the Noble on their land have disadvantage." }],
    }),
  ),
  // Guards, Seize Them!: "Once per scene, mark a Stress to summon 1d4 Bladed Guards, who appear at Far range to enforce the
  // Noble's will."
  entry(
    "petty-noble",
    "Guards, Seize Them!",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      limit: { per: "scene" },
      costs: [stress(1)],
      steps: [{ kind: "summon", label: "Bladed Guard", count: dice(1, 4), adversaryId: "bladed-guard", range: "far" }],
    }),
  ),
  // Exile: "Spend a Fear and target a PC. The Noble proclaims that the target and their allies are exiled from the noble's
  // territory. While exiled, the target and their allies have disadvantage during social situations within the Noble's
  // domain."
  entry(
    "petty-noble",
    "Exile",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: one("unlimited"),
      steps: [
        { kind: "condition", to: "targets", condition: tag("Exiled"), duration: "manual", endsWhen: "until the Noble lifts the exile" },
        { kind: "manual", to: "targets", text: "The target and their allies are exiled: they have disadvantage during social situations within the Noble's domain." },
      ],
    }),
  ),

  // ======== Pirate Captain (Leader, CB p.216)
  swashbuckler("pirate-captain"),
  // Reinforcements: "Once per scene, mark a Stress to summon a Pirate Raiders Horde, which appears at Far range."
  entry(
    "pirate-captain",
    "Reinforcements",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      limit: { per: "scene" },
      costs: [stress(1)],
      steps: [{ kind: "summon", label: "Pirate Raiders", count: fixed(1), adversaryId: "pirate-raiders", range: "far" }],
    }),
  ),
  // No Quarter: "Spend a Fear to choose a target who has three or more Pirates within Melee range of them. The Captain leads
  // the Pirates in hurling threats and promises of a watery grave. The target must make a Presence Reaction Roll. On a
  // failure, the target marks 1d4+1 Stress. On a success, they must mark a Stress."
  entry(
    "pirate-captain",
    "No Quarter",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      requires: [situation("The target has three or more Pirates within Melee range")],
      costs: [fear(1)],
      targets: one("unlimited"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "presence",
          difficulty: { kind: "actorDifficulty" },
          onFail: [{ kind: "markStress", to: "targets", amount: dice(1, 4, 1) }],
          onSuccess: [{ kind: "markStress", to: "targets", amount: fixed(1) }],
        },
      ],
    }),
  ),
  momentum("pirate-captain"),

  // ======== Pirate Raiders (Horde, CB p.216)
  horde("pirate-raiders", 1, 4, 1),
  swashbuckler("pirate-raiders"),

  // ======== Pirate Tough (Bruiser, CB p.216)
  swashbuckler("pirate-tough"),
  // Clear the Decks: "Make an attack against a target within Very Close range. On a success, mark a Stress to move into
  // Melee range of the target, dealing 3d4 physical damage and knocking the target back to Close range."
  entry(
    "pirate-tough",
    "Clear the Decks",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("veryClose"),
      steps: [
        { kind: "pay", when: ["hit"], costs: [stress(1)] },
        { kind: "move", to: "self", when: ["hit"], mode: "move", range: "melee", relativeTo: "target" },
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(3, 4), type: "physical" },
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "close", relativeTo: "self" },
      ],
    }),
  ),

  // ======== Red Ooze (Skulk, CB p.216)
  // Creeping Fire: "The Ooze can only move within Very Close range as their normal movement. They light any flammable object
  // they touch on fire."
  entry(
    "red-ooze",
    "Creeping Fire",
    main({
      activation: { kind: "passive" },
      needsSpotlight: false,
      steps: [{ kind: "manual", to: "self", text: "The Ooze can only move within Very Close range as their normal movement. They light any flammable object they touch on fire." }],
    }),
  ),
  // Ignite: "Make an attack against a target within Very Close range. On a success, the target takes 1d8 magic damage and is
  // Ignited until they're extinguished with a successful Finesse Roll (14). While Ignited, the target takes 1d4 magic damage
  // when they make an action roll."
  entry(
    "red-ooze",
    "Ignite",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 8), type: "magic" },
        { kind: "condition", to: "targets", when: ["hit"], condition: tag("Ignited"), duration: "manual", endsWhen: "until extinguished with a successful Finesse Roll (14)" },
        { kind: "manual", to: "targets", when: ["hit"], text: "While Ignited, the target takes 1d4 magic damage when they make an action roll." },
      ],
    }),
  ),
  split("red-ooze", "tiny-red-ooze", "Tiny Red Ooze"),

  // ======== Rotted Zombie (Minion, CB p.219)
  minion("rotted-zombie", 3),
  groupAttack("rotted-zombie", 2),

  // ======== Sellsword (Minion, CB p.217)
  minion("sellsword", 4),
  groupAttack("sellsword", 3),

  // ======== Shambling Zombie (Standard, CB p.219)
  // Too Many to Handle: "When the Zombie is within Melee range of a creature and at least one other Zombie is within Close
  // range, all attacks against that creature have advantage." Read as Vulnerable on that creature (CB p.102: rolls
  // targeting a Vulnerable creature have advantage) while the GM confirms the second Zombie.
  entry(
    "shambling-zombie",
    "Too Many to Handle",
    main({
      activation: { kind: "passive" },
      needsSpotlight: false,
      requires: [situation("At least one other Zombie is within Close range")],
      modifiers: [{ kind: "conditionAura", condition: VULNERABLE, to: "all", within: "melee" }],
      steps: [],
    }),
  ),
  // Horrifying: "Targets who mark HP from the Zombie's attacks must also mark a Stress."
  entry(
    "shambling-zombie",
    "Horrifying",
    main({
      activation: { kind: "auto", trigger: { kind: "onTargetMarksHp", attack: "any" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "markStress", to: "targets", amount: fixed(1) }],
    }),
  ),

  // ======== Skeleton Archer (Ranged, CB p.217)
  // Opportunist: "When two or more adversaries are within Very Close range of a creature, all damage the Archer deals to
  // that creature is doubled."
  entry(
    "skeleton-archer",
    "Opportunist",
    main({
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "beforeDamage", attack: "any" } },
      needsSpotlight: false,
      requires: [situation("Two or more adversaries are within Very Close range of the target")],
      targets: SUBJECT,
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "multiply", factor: 2 } }],
    }),
  ),
  // Deadly Shot: "Make an attack against a Vulnerable target within Far range. On a success, mark a Stress to deal 3d4+8
  // physical damage."
  entry(
    "skeleton-archer",
    "Deadly Shot",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("far"),
      steps: [
        { kind: "pay", when: ["hit", { kind: "targetHas", condition: VULNERABLE }], costs: [stress(1)] },
        { kind: "damage", to: "targets", when: ["hit", { kind: "targetHas", condition: VULNERABLE }], roll: roll(3, 4, 8), type: "physical", note: "Only against a Vulnerable target" },
      ],
    }),
  ),

  // ======== Skeleton Dredge (Minion, CB p.217)
  minion("skeleton-dredge", 4),
  groupAttack("skeleton-dredge", 1),

  // ======== Skeleton Knight (Bruiser, CB p.217)
  // Terrifying: "When the Knight makes a successful attack, all PCs within Close range lose a Hope and you gain a Fear."
  entry(
    "skeleton-knight",
    "Terrifying",
    main({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      targets: allAround("close"),
      steps: [
        { kind: "hope", to: "targets", change: "lose", amount: fixed(1) },
        { kind: "fear", to: "self", change: "gain", amount: fixed(1) },
      ],
    }),
  ),
  // Cut to the Bone: "Mark a Stress to make an attack against all targets within Very Close range. Targets the Knight
  // succeeds against take 1d8+2 physical damage and must mark a Stress."
  entry(
    "skeleton-knight",
    "Cut to the Bone",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 8, 2), type: "physical" },
        { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(1) },
      ],
    }),
  ),
  // Dig Two Graves: "When the Knight is defeated, they make an attack against a target within Very Close range (prioritizing
  // the creature who killed them). On a success, the target takes 1d4+8 physical damage and loses 1d4 Hope."
  entry(
    "skeleton-knight",
    "Dig Two Graves",
    main({
      activation: { kind: "reaction", trigger: { kind: "onDefeated" } },
      needsSpotlight: false,
      roll: ATTACK,
      targets: one("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(1, 4, 8), type: "physical" },
        { kind: "hope", to: "targets", when: ["hit"], change: "lose", amount: dice(1, 4) },
      ],
    }),
  ),

  // ======== Skeleton Warrior (Standard, CB p.217)
  // Only Bones: "The Warrior is resistant to physical damage."
  entry(
    "skeleton-warrior",
    "Only Bones",
    main({ activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }], steps: [] }),
  ),
  // Won't Stay Dead: "When the Warrior is defeated, you can spotlight them and roll a d6. On a result of 6, if there are
  // other adversaries on the battlefield, the Warrior re-forms with no marked HP."
  entry(
    "skeleton-warrior",
    "Won't Stay Dead",
    main({
      activation: { kind: "reaction", trigger: { kind: "onDefeated" } },
      needsSpotlight: false,
      requires: [situation("There are other adversaries on the battlefield")],
      steps: [
        { kind: "spotlight", who: "self" },
        {
          kind: "check",
          dice: { count: fixed(1), sides: 6 },
          test: { kind: "anyAtLeast", value: 6 },
          then: [
            { kind: "clear", to: "self", track: "hp", amount: { kind: "marked", who: "self", track: "hp" } },
            { kind: "manual", to: "self", text: "The Warrior re-forms with no marked HP: return them to the fight." },
          ],
          otherwise: [],
        },
      ],
    }),
  ),

  // ======== Spellblade (Leader, CB p.217)
  // Arcane Steel: "Damage dealt by the Spellblade's standard attack is considered both physical and magic." The printed
  // damage already reads "phy/mag", which the runner types as both (CB p.99); nothing more to apply.
  entry("spellblade", "Arcane Steel", main({ activation: { kind: "passive" }, needsSpotlight: false, steps: [] })),
  // Suppressing Blast: "Mark a Stress and target a group within Far range. All targets must succeed on an Agility Reaction
  // Roll or take 1d8+2 magic damage. You gain a Fear for each target who marked HP from this attack."
  entry(
    "spellblade",
    "Suppressing Blast",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "aroundPoint", areaRange: "veryClose" },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "actorDifficulty" },
          onFail: [{ kind: "damage", to: "targets", roll: roll(1, 8, 2), type: "magic" }],
          onSuccess: [],
        },
        { kind: "manual", to: "self", text: "You gain a Fear for each target who marked HP from this attack." },
      ],
    }),
  ),
  // Move as a Unit: "Spend 2 Fear to spotlight up to five allies within Far range."
  entry(
    "spellblade",
    "Move as a Unit",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(2)],
      steps: [{ kind: "spotlight", who: "allies", count: fixed(5), within: "far", note: "Up to five allies" }],
    }),
  ),
  momentum("spellblade"),

  // ======== Swarm of Rats (Horde, CB p.218)
  horde("swarm-of-rats", 1, 4, 1),
  // In Your Face: "All targets within Melee range have disadvantage on attacks against targets other than the Swarm."
  entry(
    "swarm-of-rats",
    "In Your Face",
    main({
      activation: { kind: "passive" },
      needsSpotlight: false,
      modifiers: [{ kind: "conditionAura", condition: tag("In Your Face"), to: "pcs", within: "melee" }],
      steps: [{ kind: "manual", to: "self", text: "All targets within Melee range have disadvantage on attacks against targets other than the Swarm." }],
    }),
  ),

  // ======== Sylvan Soldier (Standard, CB p.218)
  // Pack Tactics: "If the Soldier makes a standard attack and another Sylvan Soldier is within Melee range of the target,
  // deal 1d8+5 physical damage instead of their standard damage."
  entry(
    "sylvan-soldier",
    "Pack Tactics",
    variantAttack({ requires: [{ kind: "allyWithin", range: "melee", of: "target", name: "Sylvan Soldier" }], targets: one("melee"), damage: roll(1, 8, 5) }),
  ),
  // Forest Control: "Spend a Fear to pull down a tree within Close range. A creature hit by the tree must succeed on an
  // Agility Reaction Roll (15) or take 1d10 physical damage."
  entry(
    "sylvan-soldier",
    "Forest Control",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: { side: "any", range: "close", count: { kind: "one" } },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "fixed", value: 15 },
          onFail: [{ kind: "damage", to: "targets", roll: roll(1, 10), type: "physical" }],
          onSuccess: [],
        },
      ],
    }),
  ),
  // Blend In: "When the Soldier makes a successful attack, you can mark a Stress to become Hidden until the Soldier's next
  // attack or a PC succeeds on an Instinct Roll (14) to find them."
  entry(
    "sylvan-soldier",
    "Blend In",
    main({
      activation: { kind: "reaction", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      costs: [stress(1)],
      steps: [
        {
          kind: "condition",
          to: "self",
          condition: HIDDEN,
          duration: "manual",
          endsWhen: "until the Soldier's next attack or a PC succeeds on an Instinct Roll (14) to find them",
        },
      ],
    }),
  ),

  // ======== Tangle Bramble (Minion, CB p.218)
  minion("tangle-bramble", 4),
  groupAttack("tangle-bramble", 2),
  // Drain and Multiply: "When an attack from the Bramble causes a target to mark HP and there are three or more Tangle
  // Bramble Minions within Close range, you can combine the Minions into a Tangle Bramble Swarm Horde. The Horde's HP is
  // equal to the number of Minions combined."
  entry(
    "tangle-bramble",
    "Drain and Multiply",
    main({
      activation: { kind: "reaction", trigger: { kind: "onTargetMarksHp", attack: "any" } },
      needsSpotlight: false,
      requires: [situation("Three or more Tangle Bramble Minions are within Close range")],
      steps: [
        { kind: "summon", label: "Tangle Bramble Swarm", count: fixed(1), adversaryId: "tangle-bramble-swarm", range: "close" },
        { kind: "manual", to: "self", text: "Remove the combined Minions; the Horde's HP equals the number of Minions combined." },
      ],
    }),
  ),

  // ======== Tangle Bramble Swarm (Horde, CB p.218)
  horde("tangle-bramble-swarm", 1, 4, 2),
  // Crush: "Mark a Stress to deal 2d6+8 direct physical damage to a target with 3 or more bramble tokens."
  entry(
    "tangle-bramble-swarm",
    "Crush",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      requires: [situation("The target has 3 or more bramble tokens")],
      costs: [stress(1)],
      targets: one("unlimited"),
      steps: [{ kind: "damage", to: "targets", roll: roll(2, 6, 8), type: "physical", direct: true }],
    }),
  ),
  // Encumber: "When the Swarm succeeds on an attack, give the target a bramble token. If a target has any bramble tokens,
  // they are Restrained. If a target has 3 or more bramble tokens, they are also Vulnerable. All bramble tokens can be
  // removed by succeeding on a Finesse Roll (12 + the number of bramble tokens) or dealing Major or greater damage to the
  // Swarm. If bramble tokens are removed from a target using a Finesse Roll, a number of Tangle Bramble Minions spawn within
  // Melee range equal to the number of tokens removed."
  entry(
    "tangle-bramble-swarm",
    "Encumber",
    main({
      activation: { kind: "reaction", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [
        { kind: "condition", to: "targets", condition: tag("Bramble tokens"), duration: "manual", endsWhen: BRAMBLE_UNTIL },
        { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: BRAMBLE_UNTIL },
        {
          kind: "manual",
          to: "targets",
          text: "Give the target a bramble token. With 3 or more tokens they are also Vulnerable. Removing tokens with a Finesse Roll (12 + tokens) spawns that many Tangle Bramble Minions within Melee range.",
        },
      ],
    }),
  ),

  // ======== Tiny Green Ooze (Skulk, CB p.215)
  acidicForm("tiny-green-ooze"),

  // ======== Tiny Red Ooze (Skulk, CB p.216)
  // Burning: "When a creature within Melee range deals damage to the Ooze, they take 1d6 direct magic damage."
  entry(
    "tiny-red-ooze",
    "Burning",
    main({
      activation: { kind: "reaction", trigger: { kind: "onDamaged", stage: "did", attackerWithin: "melee" } },
      needsSpotlight: false,
      targets: SOURCE,
      steps: [{ kind: "damage", to: "targets", roll: roll(1, 6), type: "magic", direct: true }],
    }),
  ),

  // ======== Weaponmaster (Bruiser, CB p.218)
  // Goading Strike: "Make a standard attack against a target. On a success, mark a Stress to Taunt the target until their
  // next successful attack. The next time the Taunted target attacks, they have disadvantage against targets other than the
  // Weaponmaster."
  entry(
    "weaponmaster",
    "Goading Strike",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" },
        { kind: "pay", when: ["hit"], costs: [stress(1)] },
        { kind: "condition", to: "targets", when: ["hit"], condition: tag("Taunted"), duration: "manual", endsWhen: "until their next successful attack" },
        { kind: "manual", to: "targets", when: ["hit"], text: "The next time the Taunted target attacks, they have disadvantage against targets other than the Weaponmaster." },
      ],
    }),
  ),
  // Adrenaline Burst: "Once per scene, spend a Fear to clear 2 HP and 2 Stress."
  entry(
    "weaponmaster",
    "Adrenaline Burst",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      limit: { per: "scene" },
      costs: [fear(1)],
      steps: [
        { kind: "clear", to: "self", track: "hp", amount: fixed(2) },
        { kind: "clear", to: "self", track: "stress", amount: fixed(2) },
      ],
    }),
  ),
  momentum("weaponmaster"),

  // ======== Young Dryad (Leader, CB p.218)
  // Voice of the Forest: "Mark a Stress to spotlight 1d4 allies within range of a target they can attack without moving. On
  // a success, their attacks deal half damage." Read as printed: the spotlighted allies' next successful attack deals half
  // damage (an instance effect, `halfDamage` until their next hit).
  entry(
    "young-dryad",
    "Voice of the Forest",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      steps: [
        { kind: "spotlight", who: "allies", count: dice(1, 4), note: "Allies within range of a target they can attack without moving" },
        { kind: "effect", to: "allies", label: "Voice of the Forest", mods: [{ kind: "flag", flag: "halfDamage" }], duration: "hit" },
      ],
    }),
  ),
  // Thorny Cage: "Spend a Fear to form a cage around a target within Very Close range and Restrain them until they're freed
  // with a successful Strength Roll. When a creature makes an action roll against the cage, they must mark a Stress."
  entry(
    "young-dryad",
    "Thorny Cage",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: one("veryClose"),
      steps: [
        { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "until they're freed with a successful Strength Roll" },
        { kind: "manual", to: "targets", text: "When a creature makes an action roll against the cage, they must mark a Stress." },
      ],
    }),
  ),
  momentum("young-dryad"),

  // ======== Zombie Pack (Horde, CB p.219)
  horde("zombie-pack", 1, 4, 2),
  // Overwhelm: "When the Zombies mark HP from an attack within Melee range, you can mark a Stress to make a standard attack
  // against the attacker."
  entry(
    "zombie-pack",
    "Overwhelm",
    main({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", fromAttack: true, attackerWithin: "melee" } },
      needsSpotlight: false,
      costs: [stress(1)],
      roll: ATTACK,
      targets: SOURCE,
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" }],
    }),
  ),
];
