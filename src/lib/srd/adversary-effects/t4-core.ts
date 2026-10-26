// Adversary feature effects of tier 4 Core Book adversaries (plan combat-actions, tracer AE-t4-core; AA0 shipped it
// empty). Pure data: no framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 18
// adversaries, 82 features (CB p.234-239, printed pages). Each entry quotes its feature text in a comment; what the
// vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express is a `manual` step, never a vocabulary change.
// Readings, manual steps and open rulings: docs/tasks/TASK-CA-AE-t4-core.md.
//
// Reading conventions (as in t1-core / t2-core; the task doc gives the reasons):
// - A feature printed as an action is an `action` that needs the spotlight (CB p.194), unless it is what spotlights the
//   adversary (Group Attack, Cornered).
// - A printed reaction is a `reaction` (a one-tap prompt, default No, Q19), also without "you can"; a plain Fear gain
//   (Momentum, Terrifying, Unreal Form's Fear) is `auto` (Q19). A passive with a trigger is `auto`.
// - A passive that changes the standard attack's targets under a condition (Many Tentacles) is an extra `action` use
//   with id `attack` that the GM picks instead of the standard attack.
// - "On a success, mark a Stress to …" is a `pay` step after the roll (unpaid: the rest stops, CB p.90).
// - A save against a PC is a `save` step: a reaction-roll prompt per PC (AR11, CB p.99); with no printed Difficulty the
//   adversary's own Difficulty is used (CB p.193). "Targets who succeed take half damage" reuses the rolled damage (R9).
// - Countdowns (CB p.162-163) have one use per part: `activate` (the printed trigger), `tick` (a standard countdown
//   "ticks down every time a player makes an action roll", CB p.162, unless the text names another trigger) and the
//   effect when it triggers (a `situation` reaction: the GM's button).
// - "Phase Change": the adversary leaves (`defeat`), the next form is summoned and spotlighted (as Split in t1-core).
// - "When the X takes damage, reduce it by NdM" is `auto` on `onDamaged would` with a `reduceDamage` fold on itself
//   (as Heavily Armored in t2-core).

import type {
  AdversaryCost,
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryRequirement,
  AdversaryStep,
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
const OWN_DIFFICULTY = { kind: "actorDifficulty" } as const;

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
const tag = (name: string): ConditionRef => ({ kind: "tag", tag: name });
const GUILTY = tag("Guilty");
const FLYING = situation("While flying");

const main = (use: Omit<AdversaryFeatureUse, "id">): AdversaryFeatureUse => ({ id: "main", ...use });
const entry = (adversaryId: string, feature: string, ...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({
  adversaryId,
  feature,
  uses,
});
const passive = (adversaryId: string, feature: string, use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight" | "steps"> & { steps?: readonly AdversaryStep[] }) =>
  entry(adversaryId, feature, main({ activation: { kind: "passive" }, needsSpotlight: false, ...use, steps: use.steps ?? [] }));

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
  passive(adversaryId, `Relentless (${times})`, { modifiers: [{ kind: "relentless", times }] });

/**
 * "Minion (X) - Passive: The X is defeated when they take any damage. For every X damage a PC deals to the X, defeat an
 * additional Minion within range the attack would succeed against." (CB p.201)
 */
const minion = (adversaryId: string, threshold: number): AdversaryFeatureEffect =>
  passive(adversaryId, `Minion (${threshold})`, { modifiers: [{ kind: "minion", threshold }] });

/**
 * "Group Attack - Action: Spend a Fear to choose a target and spotlight all Xs within Close range of them. Those Minions
 * move into Melee range of the target and make one shared attack roll. On a success, they deal N physical damage each.
 * Combine this damage." (AR9, CB p.201). The Fear brings the spotlight (as in t1-core), so it needs none of its own.
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

/** "Terrifying - Passive: When the X makes a successful attack, all PCs within Far range lose a Hope and you gain a Fear." */
const terrifying = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Terrifying",
    main({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      targets: allAround("far"),
      steps: [
        { kind: "hope", to: "targets", change: "lose", amount: fixed(1) },
        { kind: "fear", to: "self", change: "gain", amount: fixed(1) },
      ],
    }),
  );

/**
 * "Doombringer - Reaction: When a target marks HP from an attack by the X, all PCs within Far range of the target (must)
 * lose a Hope." The PCs within Far range of the hit target (the target included) are the use's targets.
 */
const doombringer = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Doombringer",
    main({
      activation: { kind: "reaction", trigger: { kind: "onTargetMarksHp", attack: "any" } },
      needsSpotlight: false,
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "aroundTarget", areaRange: "far" },
      steps: [{ kind: "hope", to: "targets", change: "lose", amount: fixed(1) }],
    }),
  );

/**
 * "(Phase Change) - Reaction: When the X marks their last HP, replace them with the Y and immediately spotlight them."
 * The old form leaves the encounter, the GM adds the new one (preselected) and it takes the spotlight.
 */
const phaseChange = (adversaryId: string, feature: string, nextId: string, nextName: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    feature,
    main({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", last: true } },
      needsSpotlight: false,
      steps: [
        { kind: "defeat", to: "self", note: `Replaced by the ${nextName}` },
        { kind: "summon", label: nextName, count: fixed(1), adversaryId: nextId },
        { kind: "spotlight", who: "sameName", count: fixed(1), name: nextName, note: "Immediately spotlight them" },
      ],
    }),
  );

/**
 * "Divine Flight - Passive: While the X is flying, spend a Fear to move up to Far range instead of Close range before
 * taking an action." Part of the adversary's spotlight (CB p.153: a spotlighted adversary moves, then acts), so it needs
 * the spotlight.
 */
const divineFlight = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Divine Flight",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      requires: [FLYING],
      costs: [fear(1)],
      steps: [{ kind: "move", to: "self", mode: "move", range: "far", relativeTo: "self", note: "Up to Far range instead of Close before taking an action" }],
    }),
  );

/** "Flying" / "Injured Wings" - Passive: "While flying, the X gains a +N bonus to their Difficulty." */
const flyingDifficulty = (adversaryId: string, feature: string, bonus: number): AdversaryFeatureEffect =>
  passive(adversaryId, feature, {
    requires: [FLYING],
    modifiers: [
      { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(bonus) } },
      { kind: "mod", mod: { kind: "flag", flag: "flying" } },
    ],
  });

/** "When the X takes damage, reduce it by NdM." (Firespite Plate Armor, Faltering Armor): a fold on the incoming damage. */
const armorReduction = (adversaryId: string, feature: string, count: number, sides: DieSides): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    feature,
    main({
      activation: { kind: "auto", trigger: { kind: "onDamaged", stage: "would" } },
      needsSpotlight: false,
      steps: [{ kind: "reduceDamage", to: "self", amount: dice(count, sides) }],
    }),
  );

/** "Attacks they make while spotlighted in this way deal half damage" (Blighting Strike's flag on the spotlit allies). */
const HALF_DAMAGE_EFFECT: AdversaryStep = {
  kind: "effect",
  to: "allies",
  label: "Half damage while spotlighted this way",
  mods: [{ kind: "flag", flag: "halfDamage" }],
  duration: "manual",
  endsWhen: "the spotlight moves on",
};

/** A standard countdown's tick: "ticks down every time a player makes an action roll" (CB p.162). */
const actionRollTick = (label: string): AdversaryFeatureUse => ({
  id: "tick",
  activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "action" } },
  needsSpotlight: false,
  steps: [{ kind: "countdown", op: "tick", label }],
});

/** "Make a standard attack against all targets within Very Close range" (one roll, AR7; the printed damage). */
const STANDARD_DAMAGE: AdversaryStep = { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" };

// ---------------------------------------------------------------- the table

export const T4_CORE_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ======== Arch-Necromancer (Leader, CB p.234)
  // Dance of Death: "Mark a Stress to spotlight 1d4 allies. Attacks they make while spotlighted in this way deal half
  // damage, or full damage if you spend a Fear." The GM picks half damage, or full damage for a Fear (the pick is the tap).
  entry(
    "arch-necromancer",
    "Dance of Death",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      steps: [
        { kind: "spotlight", who: "allies", count: dice(1, 4) },
        {
          kind: "choose",
          id: "damage",
          label: "Their attacks deal half damage, or full damage for a Fear",
          options: [
            { id: "half", label: "Half damage", steps: [HALF_DAMAGE_EFFECT] },
            { id: "full", label: "Spend a Fear: full damage", steps: [{ kind: "pay", costs: [fear(1)] }] },
          ],
        },
      ],
    }),
  ),
  // Beam of Decay: "Mark 2 Stress to cause all targets within Far range to make a Strength Reaction Roll. Targets who fail
  // take 2d20+12 magic damage and you gain a Fear. Targets who succeed take half damage. A target who marks 2 or more HP
  // must also mark 2 Stress and becomes Vulnerable until they roll with Hope."
  entry(
    "arch-necromancer",
    "Beam of Decay",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(2)],
      targets: allAround("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "strength",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "damage", to: "targets", roll: roll(2, 20, 12), type: "magic" },
            { kind: "fear", to: "self", change: "gain", amount: fixed(1), note: "A Fear for each target who fails" },
          ],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(2, 20, 12), type: "magic", scale: "half" }],
        },
        { kind: "manual", to: "targets", text: "A target who marks 2 or more HP from this must also mark 2 Stress and becomes Vulnerable until they roll with Hope." },
      ],
    }),
  ),
  // Open the Gates of Death: "Spend a Fear to summon a Zombie Legion, which appears at Close range and immediately takes
  // the spotlight."
  entry(
    "arch-necromancer",
    "Open the Gates of Death",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      steps: [
        { kind: "summon", label: "Zombie Legion", count: fixed(1), adversaryId: "zombie-legion", range: "close" },
        { kind: "spotlight", who: "sameName", count: fixed(1), name: "Zombie Legion", note: "It immediately takes the spotlight" },
      ],
    }),
  ),
  // Not Today, My Dears: "When the Necromancer has marked 7 or more of their HP, you can spend a Fear to have them teleport
  // away to a safe location to recover. A PC who succeeds on an Instinct Roll can trace the teleportation magic to their
  // destination."
  entry(
    "arch-necromancer",
    "Not Today, My Dears",
    main({
      activation: { kind: "reaction", trigger: { kind: "onHpMarkedAtLeast", value: 7 } },
      needsSpotlight: false,
      requires: [{ kind: "hpMarkedAtLeast", value: 7 }],
      costs: [fear(1)],
      steps: [
        { kind: "move", to: "self", mode: "teleport", note: "Away to a safe location to recover" },
        {
          kind: "manual",
          to: "self",
          text: "The Necromancer leaves the scene to recover. A PC who succeeds on an Instinct Roll can trace the teleportation magic to their destination.",
        },
      ],
    }),
  ),
  // Your Life Is Mine (Countdown (Loop 2d6)): "When the Necromancer has marked 6 or more of their HP, activate the
  // countdown. When it triggers, deal 2d10+6 direct magic damage to a target within Close range. The Necromancer then
  // clears a number of Stress or HP equal to the number of HP marked by the target from this attack."
  entry(
    "arch-necromancer",
    "Your Life Is Mine",
    {
      id: "activate",
      activation: { kind: "reaction", trigger: { kind: "onHpMarkedAtLeast", value: 6 } },
      needsSpotlight: false,
      requires: [{ kind: "hpMarkedAtLeast", value: 6 }],
      steps: [{ kind: "countdown", op: "start", label: "Your Life Is Mine", start: dice(2, 6), loop: true, onTrigger: "Deal 2d10+6 direct magic damage to a target within Close range." }],
    },
    actionRollTick("Your Life Is Mine"),
    {
      id: "drain",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Your Life Is Mine countdown triggers" } },
      needsSpotlight: false,
      targets: one("close"),
      steps: [
        { kind: "damage", to: "targets", roll: roll(2, 10, 6), type: "magic", direct: true },
        { kind: "manual", to: "self", text: "The Necromancer clears a number of Stress or HP equal to the number of HP the target marked from this attack." },
      ],
    },
  ),

  // ======== Fallen Shock Troop (Minion, CB p.234)
  minion("fallen-shock-troop", 12),
  // Aura of Doom: "When a PC marks HP from an attack by the Shock Troop, they lose a Hope."
  entry(
    "fallen-shock-troop",
    "Aura of Doom",
    main({
      activation: { kind: "auto", trigger: { kind: "onTargetMarksHp", attack: "any" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "hope", to: "targets", change: "lose", amount: fixed(1) }],
    }),
  ),
  groupAttack("fallen-shock-troop", 12),

  // ======== Fallen Sorcerer (Support, CB p.234)
  // Conflagration: "Spend a Fear to unleash an all-consuming firestorm and make an attack against all targets within Close
  // range. Targets the Sorcerer succeeds against take 2d10+6 direct magic damage."
  entry(
    "fallen-sorcerer",
    "Conflagration",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      roll: ATTACK,
      targets: allAround("close"),
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: roll(2, 10, 6), type: "magic", direct: true }],
    }),
  ),
  // Nightmare Tableau: "Mark a Stress to trap a target within Far range in a powerful illusion of their worst fears. While
  // trapped, the target is Restrained and Vulnerable until they break free, ending both conditions, with a successful
  // Instinct Roll."
  entry(
    "fallen-sorcerer",
    "Nightmare Tableau",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: one("far"),
      steps: [
        { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "until they break free with a successful Instinct Roll" },
        { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "until they break free with a successful Instinct Roll" },
      ],
    }),
  ),
  // Slippery: "When the Sorcerer takes damage from an attack, they can teleport up to Far range."
  entry(
    "fallen-sorcerer",
    "Slippery",
    main({
      activation: { kind: "reaction", trigger: { kind: "onDamaged", stage: "did", fromAttack: true } },
      needsSpotlight: false,
      steps: [{ kind: "move", to: "self", mode: "teleport", range: "far", relativeTo: "self" }],
    }),
  ),
  // Shackles of Guilt (Countdown (Loop 2d6)): "When the Sorcerer is in the spotlight for the first time, activate the
  // countdown. When it triggers, all targets within Far range become Vulnerable and must mark a Stress as they relive their
  // greatest regrets. A target can break free from their regret with a successful Presence or Strength Roll. When a PC
  // fails to break free, they lose a Hope."
  entry(
    "fallen-sorcerer",
    "Shackles of Guilt",
    {
      id: "activate",
      activation: { kind: "reaction", trigger: { kind: "onSpotlight", first: "scene" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "start", label: "Shackles of Guilt", start: dice(2, 6), loop: true, onTrigger: "All targets within Far range relive their greatest regrets." }],
    },
    actionRollTick("Shackles of Guilt"),
    {
      id: "regret",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Shackles of Guilt countdown triggers" } },
      needsSpotlight: false,
      targets: allAround("far"),
      steps: [
        { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "until they break free with a successful Presence or Strength Roll" },
        { kind: "markStress", to: "targets", amount: fixed(1) },
        { kind: "manual", to: "targets", text: "When a PC fails to break free from their regret, they lose a Hope." },
      ],
    },
  ),

  // ======== Fallen Warlord: Realm-Breaker (Solo, CB p.235)
  relentless("fallen-warlord-realm-breaker", 2),
  // Firespite Plate Armor: "When the Realm-Breaker takes damage, reduce it by 2d10."
  armorReduction("fallen-warlord-realm-breaker", "Firespite Plate Armor", 2, 10),
  // Tormenting Lash: "Mark a Stress to make a standard attack against all targets within Very Close range. When a target
  // uses armor to reduce damage from this attack, they must mark 2 Armor Slots."
  entry(
    "fallen-warlord-realm-breaker",
    "Tormenting Lash",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [STANDARD_DAMAGE, { kind: "manual", to: "targets", when: ["hit"], text: "A target who uses armor to reduce this damage must mark 2 Armor Slots." }],
    }),
  ),
  // All-Consuming Rage (Countdown (Decreasing 8)): "When the Realm-Breaker is in the spotlight for the first time, activate
  // the countdown. When it triggers, create a torrent of incarnate rage that rends flesh from bone. All targets within Far
  // range must make a Presence Reaction Roll. Targets who fail take 2d6+10 direct magic damage. Targets who succeed take
  // half damage. For each HP marked from this damage, summon a Fallen Shock Troop within Very Close range of the target who
  // marked that HP. If the countdown ever decreases its maximum value to 0, the Realm-Breaker marks their remaining HP and
  // all targets within Far range must mark all remaining HP and make a death move."
  // A decreasing countdown resets one lower after each trigger (CB p.163): a GM prompt on each trigger.
  entry(
    "fallen-warlord-realm-breaker",
    "All-Consuming Rage",
    {
      id: "activate",
      activation: { kind: "reaction", trigger: { kind: "onSpotlight", first: "scene" } },
      needsSpotlight: false,
      steps: [
        {
          kind: "countdown",
          op: "start",
          label: "All-Consuming Rage",
          start: fixed(8),
          loop: true,
          onTrigger: "A torrent of incarnate rage: Presence Reaction Rolls within Far range. Decreasing: it resets one lower each time.",
        },
      ],
    },
    actionRollTick("All-Consuming Rage"),
    {
      id: "rage",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The All-Consuming Rage countdown triggers" } },
      needsSpotlight: false,
      targets: allAround("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "presence",
          difficulty: OWN_DIFFICULTY,
          onFail: [{ kind: "damage", to: "targets", roll: roll(2, 6, 10), type: "magic", direct: true }],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(2, 6, 10), type: "magic", direct: true, scale: "half" }],
        },
        { kind: "manual", to: "targets", text: "For each HP marked from this damage, summon a Fallen Shock Troop within Very Close range of the target who marked that HP." },
        { kind: "countdown", op: "prompt", label: "All-Consuming Rage", note: "Decreasing: reset the countdown one lower than its last starting value" },
      ],
    },
    {
      id: "doom",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The All-Consuming Rage countdown's maximum decreases to 0" } },
      needsSpotlight: false,
      targets: allAround("far"),
      steps: [
        { kind: "defeat", to: "self", note: "The Realm-Breaker marks their remaining HP" },
        { kind: "manual", to: "targets", text: "All targets within Far range must mark all remaining HP and make a death move." },
      ],
    },
  ),
  doombringer("fallen-warlord-realm-breaker"),
  phaseChange("fallen-warlord-realm-breaker", "I Have Never Known Defeat (Phase Change)", "fallen-warlord-undefeated-champion", "Fallen Warlord: Undefeated Champion"),

  // ======== Fallen Warlord: Undefeated Champion (Solo, CB p.235)
  relentless("fallen-warlord-undefeated-champion", 3),
  // Faltering Armor: "When the Undefeated Champion takes damage, reduce it by 1d10."
  armorReduction("fallen-warlord-undefeated-champion", "Faltering Armor", 1, 10),
  // Shattering Strike: "Mark a Stress to make a standard attack against all targets within Very Close range. PCs the
  // Champion succeeds against lose a number of Hope equal to the HP they marked from this attack."
  entry(
    "fallen-warlord-undefeated-champion",
    "Shattering Strike",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [STANDARD_DAMAGE, { kind: "manual", to: "targets", when: ["hit"], text: "The PC loses a number of Hope equal to the HP they marked from this attack." }],
    }),
  ),
  // Endless Legions: "Spend a Fear to summon a number of Fallen Shock Troops equal to twice the number of PCs. The Shock
  // Troops appear at Far range." The PCs are the use's targets (with no map: the party, Q18); the count is twice them.
  entry(
    "fallen-warlord-undefeated-champion",
    "Endless Legions",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: { side: "enemy", range: "unlimited", count: { kind: "all" } },
      steps: [
        {
          kind: "summon",
          label: "Fallen Shock Troop",
          count: { kind: "calc", of: { kind: "targetCount", which: "picked" }, times: 2 },
          adversaryId: "fallen-shock-troop",
          range: "far",
          note: "Twice the number of PCs",
        },
      ],
    }),
  ),
  // Circle of Defilement (Countdown (1d8)): "When the Undefeated Champion is in the spotlight for the first time, activate
  // the countdown. When it triggers, activate a magical circle covering an area within Far range of the Champion. A target
  // within that area is Vulnerable until they leave the circle. The circle can be removed by dealing Severe damage to the
  // Undefeated Champion."
  entry(
    "fallen-warlord-undefeated-champion",
    "Circle of Defilement",
    {
      id: "activate",
      activation: { kind: "reaction", trigger: { kind: "onSpotlight", first: "scene" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "start", label: "Circle of Defilement", start: dice(1, 8), onTrigger: "A magical circle covers an area within Far range of the Champion." }],
    },
    actionRollTick("Circle of Defilement"),
    {
      id: "circle",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Circle of Defilement countdown triggers" } },
      needsSpotlight: false,
      targets: allAround("far", "any"),
      steps: [
        { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "until they leave the circle (or the circle is removed)" },
        { kind: "manual", to: "self", text: "The circle stays: a target who enters it is Vulnerable until they leave it." },
      ],
    },
    {
      id: "break",
      activation: { kind: "auto", trigger: { kind: "onDamaged", stage: "did", minSeverity: "severe" } },
      needsSpotlight: false,
      requires: [situation("The Circle of Defilement is active")],
      steps: [{ kind: "manual", to: "self", text: "Severe damage to the Champion removes the circle: targets Vulnerable from it are no longer Vulnerable." }],
    },
  ),
  momentum("fallen-warlord-undefeated-champion"),
  doombringer("fallen-warlord-undefeated-champion"),

  // ======== Hallowed Archer (Ranged, CB p.236)
  // Punish the Guilty: "The Archer deals double damage to targets marked Guilty by a High Seraph." Doubles the damage of
  // a hit on a Guilty target (a fold on that attack).
  entry(
    "hallowed-archer",
    "Punish the Guilty",
    main({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any", targetHas: GUILTY } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "modifyDamage", to: "targets", when: [{ kind: "targetHas", condition: GUILTY }], change: { kind: "multiply", factor: 2 } }],
    }),
  ),
  // Divine Volley: "Mark a Stress to make a standard attack against up to three targets."
  entry(
    "hallowed-archer",
    "Divine Volley",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: { side: "enemy", range: "far", count: { kind: "upTo", n: fixed(3) } },
      steps: [STANDARD_DAMAGE],
    }),
  ),

  // ======== Hallowed Soldier (Minion, CB p.236)
  minion("hallowed-soldier", 13),
  divineFlight("hallowed-soldier"),
  groupAttack("hallowed-soldier", 10),

  // ======== High Seraph (Leader, CB p.236)
  relentless("high-seraph", 3),
  divineFlight("high-seraph"),
  // Judgment: "Spend a Fear to make a target Guilty in the eyes of the Seraph's god until the Seraph is defeated. While
  // Guilty, the target doesn't gain Hope on a result with Hope. When the Seraph succeeds on a standard attack against a
  // Guilty target, they deal Severe damage instead of their standard damage. The Seraph can only mark one target at a
  // time." Two uses: marking the target, and the Severe damage on a standard hit against a Guilty target (a fold).
  entry(
    "high-seraph",
    "Judgment",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: one("unlimited"),
      steps: [
        { kind: "condition", to: "targets", condition: GUILTY, duration: "manual", endsWhen: "until the Seraph is defeated" },
        { kind: "manual", to: "targets", text: "While Guilty, the target doesn't gain Hope on a result with Hope. The Seraph can only mark one target at a time: clear Guilty from any other target." },
      ],
    }),
    {
      id: "severe",
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "standard", targetHas: GUILTY } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "minimumSeverity", severity: "severe" }, note: "Severe damage instead of the standard damage" }],
    },
  ),
  // God Rays: "Mark a Stress to reflect a sliver of divinity as a searing beam of light that hits up to twenty targets
  // within Very Far range. Targets must make a Presence Reaction Roll, with disadvantage if they are marked Guilty. Targets
  // who fail take 4d6+12 magic damage. Targets who succeed take half damage."
  entry(
    "high-seraph",
    "God Rays",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: { side: "enemy", range: "veryFar", count: { kind: "upTo", n: fixed(20) } },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "presence",
          difficulty: OWN_DIFFICULTY,
          note: "With disadvantage for targets marked Guilty",
          onFail: [{ kind: "damage", to: "targets", roll: roll(4, 6, 12), type: "magic" }],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(4, 6, 12), type: "magic", scale: "half" }],
        },
      ],
    }),
  ),
  // We Are One: "Once per scene, spend a Fear to spotlight all other adversaries within Far range. Attacks they make while
  // spotlighted in this way deal half damage."
  entry(
    "high-seraph",
    "We Are One",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      limit: { per: "scene" },
      costs: [fear(1)],
      steps: [{ kind: "spotlight", who: "allies", within: "far", note: "All other adversaries within Far range" }, HALF_DAMAGE_EFFECT],
    }),
  ),

  // ======== Kraken (Solo, CB p.236)
  relentless("kraken", 3),
  // Many Tentacles: "While the Kraken has 7 or fewer marked HP, they can make their standard attack against two targets
  // within range." An extra standard attack against up to two targets while the requirement holds.
  entry(
    "kraken",
    "Many Tentacles",
    {
      id: "attack",
      activation: { kind: "action" },
      needsSpotlight: true,
      requires: [{ kind: "hpMarkedAtMost", value: 7 }],
      roll: ATTACK,
      targets: { side: "enemy", range: "close", count: { kind: "upTo", n: fixed(2) } },
      steps: [STANDARD_DAMAGE],
    },
  ),
  // Grapple and Drown: "Make an attack roll against a target within Close range. On a success, mark a Stress to grab them
  // with a tentacle and drag them beneath the water. The target is Restrained and Vulnerable until they break free with a
  // successful Strength Roll or the Kraken takes Major or greater damage. While Restrained and Vulnerable in this way, a
  // target must mark a Stress when they make an action roll."
  entry(
    "kraken",
    "Grapple and Drown",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      roll: ATTACK,
      targets: one("close"),
      steps: [
        { kind: "pay", when: ["hit"], costs: [stress(1)] },
        {
          kind: "condition",
          to: "targets",
          when: ["hit"],
          condition: RESTRAINED,
          duration: "manual",
          endsWhen: "until they break free with a successful Strength Roll or the Kraken takes Major or greater damage",
        },
        {
          kind: "condition",
          to: "targets",
          when: ["hit"],
          condition: VULNERABLE,
          duration: "manual",
          endsWhen: "until they break free with a successful Strength Roll or the Kraken takes Major or greater damage",
        },
        { kind: "manual", to: "targets", when: ["hit"], text: "While Restrained and Vulnerable this way, the target must mark a Stress when they make an action roll." },
      ],
    }),
  ),
  // Boiling Blast: "Spend a Fear to spew a line of boiling water at any number of targets in a line up to Far range. All
  // targets must succeed on an Agility Reaction Roll or take 4d6+9 physical damage. If a target marks an Armor Slot to
  // reduce the damage, they must also mark a Stress."
  entry(
    "kraken",
    "Boiling Blast",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: { side: "enemy", range: "far", count: { kind: "any" }, area: "line" },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "damage", to: "targets", roll: roll(4, 6, 9), type: "physical" },
            { kind: "manual", to: "targets", text: "If the target marks an Armor Slot to reduce the damage, they must also mark a Stress." },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  momentum("kraken"),

  // ======== Oracle of Doom (Solo, CB p.237)
  terrifying("oracle-of-doom"),
  // Walls Closing In: "When a creature rolls a failure while within Very Far range of the Oracle, they must mark a Stress."
  entry(
    "oracle-of-doom",
    "Walls Closing In",
    main({
      activation: { kind: "auto", trigger: { kind: "pcRolls", result: "failure", within: "veryFar" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "markStress", to: "targets", amount: fixed(1) }],
    }),
  ),
  // Pronounce Fate: "Spend a Fear to present a target within Far range with a vision of their personal nightmare. The
  // target must make a Knowledge Reaction Roll. On a failure, they lose all Hope and take 2d20+4 direct magic damage. On a
  // success, they take half damage and lose a Hope." "All Hope" is the Hope maximum (6, CB p.90); the server clamps at 0.
  entry(
    "oracle-of-doom",
    "Pronounce Fate",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: one("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "knowledge",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "hope", to: "targets", change: "lose", amount: fixed(6), note: "They lose all Hope" },
            { kind: "damage", to: "targets", roll: roll(2, 20, 4), type: "magic", direct: true },
          ],
          onSuccess: [
            { kind: "damage", to: "targets", roll: roll(2, 20, 4), type: "magic", direct: true, scale: "half" },
            { kind: "hope", to: "targets", change: "lose", amount: fixed(1) },
          ],
        },
      ],
    }),
  ),
  // Summon Tormentors: "Once per day, spend 2 Fear to summon 2d4 Tier 2 or below Minions relevant to one of the PC's
  // personal nightmares. They appear at Close range relative to that PC." "Once per day" is kept as once per session (the
  // longest limit the vocabulary has).
  entry(
    "oracle-of-doom",
    "Summon Tormentors",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      limit: { per: "session" },
      costs: [fear(2)],
      targets: one("unlimited"),
      steps: [{ kind: "summon", label: "Tier 2 or below Minions from the PC's personal nightmare", count: dice(2, 4), range: "close", note: "At Close range of that PC" }],
    }),
  ),
  // Ominous Knowledge: "When the Oracle sees a mortal creature, they instantly know one of their personal nightmares."
  entry(
    "oracle-of-doom",
    "Ominous Knowledge",
    main({
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Oracle sees a mortal creature" } },
      needsSpotlight: false,
      steps: [{ kind: "manual", to: "self", text: "The Oracle instantly knows one of the creature's personal nightmares." }],
    }),
  ),
  // Vengeful Fate: "When the Oracle marks HP from an attack within Very Close range, you can mark a Stress to knock the
  // attacker back to Far range and deal 2d10+4 physical damage."
  entry(
    "oracle-of-doom",
    "Vengeful Fate",
    main({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", fromAttack: true, attackerWithin: "veryClose" } },
      needsSpotlight: false,
      costs: [stress(1)],
      targets: SOURCE,
      steps: [
        { kind: "move", to: "targets", mode: "knockBack", range: "far", relativeTo: "self" },
        { kind: "damage", to: "targets", roll: roll(2, 10, 4), type: "physical" },
      ],
    }),
  ),

  // ======== Outer Realms Abomination (Bruiser, CB p.237)
  // Chaotic Form: "When the Abomination attacks, roll 2d4 and use the result as their attack modifier." The printed ATK is
  // "+2d4", which the runner rolls on every attack (parseAttackModifier); nothing more to apply.
  passive("outer-realms-abomination", "Chaotic Form", {}),
  // Disorienting Presence: "When a target takes damage from the Abomination, they must make an Instinct Reaction Roll. On
  // a failure, they gain disadvantage on their next action roll and you gain a Fear."
  entry(
    "outer-realms-abomination",
    "Disorienting Presence",
    main({
      activation: { kind: "auto", trigger: { kind: "onDealDamage", toPc: true } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "condition", to: "targets", condition: tag("Disoriented"), duration: "nextRoll" },
            { kind: "manual", to: "targets", text: "Disadvantage on their next action roll." },
            { kind: "fear", to: "self", change: "gain", amount: fixed(1) },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // Reality Quake: "Spend a Fear to rattle the edges of reality within Far range of the Abomination. All targets within
  // that area must succeed on a Knowledge Reaction Roll or become Unstuck from reality until the end of the scene. When an
  // Unstuck target spends Hope or marks Armor Slots, HP, or Stress, they must double the amount spent or marked."
  entry(
    "outer-realms-abomination",
    "Reality Quake",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: allAround("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "knowledge",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "condition", to: "targets", condition: tag("Unstuck"), duration: "scene" },
            { kind: "manual", to: "targets", text: "While Unstuck, when they spend Hope or mark Armor Slots, HP, or Stress, they must double the amount spent or marked." },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // Unreal Form: "When the Abomination takes damage, reduce it by 1d20. If the Abomination marks 1 or fewer Hit Points
  // from a successful attack against them, you gain a Fear." The reduction is the printed reaction; the Fear gain is
  // automatic (Q19).
  entry(
    "outer-realms-abomination",
    "Unreal Form",
    {
      id: "reduce",
      activation: { kind: "reaction", trigger: { kind: "onDamaged", stage: "would" } },
      needsSpotlight: false,
      steps: [{ kind: "reduceDamage", to: "self", amount: dice(1, 20) }],
    },
    {
      id: "fear",
      activation: { kind: "auto", trigger: { kind: "onMarkHp", atMost: 1, fromAttack: true } },
      needsSpotlight: false,
      steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }],
    },
  ),

  // ======== Outer Realms Corruptor (Support, CB p.237)
  // Will-Shattering Touch: "When a PC takes damage from the Corruptor, they lose a Hope."
  entry(
    "outer-realms-corruptor",
    "Will-Shattering Touch",
    main({
      activation: { kind: "auto", trigger: { kind: "onDealDamage", toPc: true } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [{ kind: "hope", to: "targets", change: "lose", amount: fixed(1) }],
    }),
  ),
  // Disgorge Reality Flotsam: "Mark a Stress to spew partially digested portions of consumed realities at all targets
  // within Close range. Targets must succeed on a Knowledge Reaction Roll or mark 2 Stress."
  entry(
    "outer-realms-corruptor",
    "Disgorge Reality Flotsam",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      targets: allAround("close"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "knowledge",
          difficulty: OWN_DIFFICULTY,
          onFail: [{ kind: "markStress", to: "targets", amount: fixed(2) }],
          onSuccess: [],
        },
      ],
    }),
  ),

  // ======== Outer Realms Thrall (Minion, CB p.237)
  minion("outer-realms-thrall", 13),
  groupAttack("outer-realms-thrall", 11),

  // ======== Perfected Zombie (Bruiser, CB p.239)
  terrifying("perfected-zombie"),
  // Fearsome Presence: "PCs can't spend Hope to use features against the Zombie." No modifier forbids a PC's Hope costs.
  passive("perfected-zombie", "Fearsome Presence", {
    steps: [{ kind: "manual", to: "self", text: "PCs can't spend Hope to use features against the Zombie." }],
  }),
  // Perfect Strike: "Mark a Stress to make a standard attack against all targets within Very Close range. Targets the
  // Zombie succeeds against are Vulnerable until their next rest."
  entry(
    "perfected-zombie",
    "Perfect Strike",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [STANDARD_DAMAGE, { kind: "condition", to: "targets", when: ["hit"], condition: VULNERABLE, duration: "rest" }],
    }),
  ),
  // Skilled Opportunist: "When another adversary deals damage to a target within Very Close range of the Zombie, you can
  // spend a Fear to add the Zombie's standard attack damage to the damage roll." The target's distance is the GM's
  // confirmation; the Zombie's 4d12+15 is rolled and folded into the ally's damage.
  entry(
    "perfected-zombie",
    "Skilled Opportunist",
    main({
      activation: { kind: "reaction", trigger: { kind: "allyDealtDamage" } },
      needsSpotlight: false,
      requires: [situation("The target is within Very Close range of the Zombie")],
      costs: [fear(1)],
      targets: SUBJECT,
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: dice(4, 12, 15) }, note: "The Zombie's standard attack damage (4d12+15)" }],
    }),
  ),

  // ======== Volcanic Dragon: Ashen Tyrant (Solo, CB p.239)
  relentless("volcanic-dragon-ashen-tyrant", 4),
  // Cornered: "Mark a Stress instead of spending a Fear to spotlight the Ashen Tyrant." A button that spotlights it for a
  // Stress (no spotlight of its own, no Fear).
  entry(
    "volcanic-dragon-ashen-tyrant",
    "Cornered",
    main({
      activation: { kind: "action" },
      needsSpotlight: false,
      costs: [stress(1)],
      steps: [{ kind: "spotlight", who: "self", note: "Spotlighted for a Stress instead of a Fear" }],
    }),
  ),
  // Injured Wings: "While flying, the Ashen Tyrant gains a +1 bonus to their Difficulty."
  flyingDifficulty("volcanic-dragon-ashen-tyrant", "Injured Wings", 1),
  // Ashes to Ashes: "When a PC rolls a failure while within Close range of the Ashen Tyrant, they lose a Hope and you gain
  // a Fear. If the PC can't lose a Hope, they must mark a HP."
  entry(
    "volcanic-dragon-ashen-tyrant",
    "Ashes to Ashes",
    main({
      activation: { kind: "auto", trigger: { kind: "pcRolls", result: "failure", within: "close" } },
      needsSpotlight: false,
      targets: SUBJECT,
      steps: [
        { kind: "hope", to: "targets", change: "lose", amount: fixed(1) },
        { kind: "fear", to: "self", change: "gain", amount: fixed(1) },
        { kind: "manual", to: "targets", text: "If the PC can't lose a Hope, they must mark a HP." },
      ],
    }),
  ),
  // Desperate Rampage: "Mark a Stress to make an attack against all targets within Close range. Targets the Ashen Tyrant
  // succeeds against take 2d20+2 physical damage, are knocked back to Close range of where they were, and must mark a
  // Stress."
  entry(
    "volcanic-dragon-ashen-tyrant",
    "Desperate Rampage",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: allAround("close"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(2, 20, 2), type: "physical" },
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "close", relativeTo: "target", note: "To Close range of where they were" },
        { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(1) },
      ],
    }),
  ),
  // Ashen Cloud: "Spend a Fear to smash the ground and kick up ash within Far range. While within the ash cloud, a target
  // has disadvantage on action rolls. The ash cloud clears the next time an adversary is spotlighted."
  entry(
    "volcanic-dragon-ashen-tyrant",
    "Ashen Cloud",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: allAround("far", "any"),
      steps: [
        { kind: "condition", to: "targets", condition: tag("In the ash cloud"), duration: "manual", endsWhen: "the next time an adversary is spotlighted (or they leave the cloud)" },
        { kind: "manual", to: "targets", text: "While within the ash cloud, a target has disadvantage on action rolls; the cloud clears the next time an adversary is spotlighted." },
      ],
    }),
  ),
  // Apocalyptic Thrashing (Countdown (1d12)): "Spend a Fear to activate. It ticks down when a PC rolls with Fear. When it
  // triggers, the Ashen Tyrant thrashes about, causing environmental damage (such as an earthquake, avalanche, or
  // collapsing walls). All targets within Far range must make a Strength Reaction Roll. Targets who fail take 2d10+10
  // physical damage and are Restrained by the rubble until they break free with a successful Strength Roll. Targets who
  // succeed take half damage. If the Ashen Tyrant is defeated while this countdown is active, trigger the countdown
  // immediately as the destruction caused by their death throes."
  entry(
    "volcanic-dragon-ashen-tyrant",
    "Apocalyptic Thrashing",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      steps: [{ kind: "countdown", op: "start", label: "Apocalyptic Thrashing", start: dice(1, 12), onTrigger: "The Ashen Tyrant thrashes about: Strength Reaction Rolls within Far range." }],
    }),
    {
      id: "tick",
      activation: { kind: "auto", trigger: { kind: "pcRolls", result: "withFear" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "tick", label: "Apocalyptic Thrashing" }],
    },
    {
      id: "thrash",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Apocalyptic Thrashing countdown triggers" } },
      needsSpotlight: false,
      targets: allAround("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "strength",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "damage", to: "targets", roll: roll(2, 10, 10), type: "physical" },
            { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "until they break free with a successful Strength Roll" },
          ],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(2, 10, 10), type: "physical", scale: "half" }],
        },
      ],
    },
    {
      id: "death-throes",
      activation: { kind: "auto", trigger: { kind: "onDefeated" } },
      needsSpotlight: false,
      requires: [situation("The Apocalyptic Thrashing countdown is active")],
      steps: [{ kind: "countdown", op: "prompt", label: "Apocalyptic Thrashing", note: "Trigger the countdown immediately: the death throes" }],
    },
  ),

  // ======== Volcanic Dragon: Molten Scourge (Solo, CB p.238)
  relentless("volcanic-dragon-molten-scourge", 3),
  // Cracked Scales: "When the Molten Scourge takes damage, roll a number of d6s equal to HP marked. For each result of 4
  // or higher, you gain a Fear." The d6s are rolled; the first 4+ gains a Fear, the others are counted by hand.
  entry(
    "volcanic-dragon-molten-scourge",
    "Cracked Scales",
    main({
      activation: { kind: "auto", trigger: { kind: "onDamaged", stage: "did" } },
      needsSpotlight: false,
      steps: [
        {
          kind: "check",
          dice: { count: { kind: "marked", who: "self", track: "hp" }, sides: 6 },
          test: { kind: "anyAtLeast", value: 4 },
          note: "A d6 for each HP marked",
          then: [
            { kind: "fear", to: "self", change: "gain", amount: fixed(1) },
            { kind: "manual", to: "self", text: "Gain one more Fear for each further result of 4 or higher." },
          ],
          otherwise: [],
        },
      ],
    }),
  ),
  // Shattering Might: "Mark a Stress to make an attack against a target within Very Close range. On a success, the target
  // takes 4d8+1 physical damage, loses a Hope, and is knocked back to Close range. The Molten Scourge clears a Stress."
  // The Stress is cleared on a success (see the task doc's questions).
  entry(
    "volcanic-dragon-molten-scourge",
    "Shattering Might",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: one("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(4, 8, 1), type: "physical" },
        { kind: "hope", to: "targets", when: ["hit"], change: "lose", amount: fixed(1) },
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "close", relativeTo: "self" },
        { kind: "clear", to: "self", when: ["hit"], track: "stress", amount: fixed(1) },
      ],
    }),
  ),
  // Eruption: "Spend a Fear to erupt lava from beneath the Molten Scourge's scales, filling the area within Very Close
  // range with molten lava. All targets in that area must succeed on an Agility Reaction Roll or take 4d6+6 physical
  // damage and be knocked back to Close range. This area remains lava. When a creature other than the Molten Scourge
  // enters that area or acts while inside of it, they must mark 6 HP."
  entry(
    "volcanic-dragon-molten-scourge",
    "Eruption",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear(1)],
      targets: allAround("veryClose"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "damage", to: "targets", roll: roll(4, 6, 6), type: "physical" },
            { kind: "move", to: "targets", mode: "knockBack", range: "close", relativeTo: "self" },
          ],
          onSuccess: [],
        },
        { kind: "manual", to: "self", text: "The area within Very Close range remains lava: a creature other than the Molten Scourge who enters it or acts while inside it must mark 6 HP." },
      ],
    }),
  ),
  // Volcanic Breath: "When the Molten Scourge takes Major damage, roll a d10. On a result of 8 or higher, the Molten
  // Scourge breathes a flow of lava in front of them within Far range. All targets in that area must make an Agility
  // Reaction Roll. Targets who fail take 2d10+4 physical damage, mark 1d4 Stress, and are Vulnerable until they clear a
  // Stress. Targets who succeed take half damage and must mark a Stress." Major damage marks exactly 2 HP on an adversary
  // (CB p.193), which is how the trigger tells it from Severe.
  entry(
    "volcanic-dragon-molten-scourge",
    "Volcanic Breath",
    main({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", atLeast: 2, atMost: 2 } },
      needsSpotlight: false,
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "front" },
      steps: [
        {
          kind: "check",
          dice: { count: fixed(1), sides: 10 },
          test: { kind: "anyAtLeast", value: 8 },
          then: [
            {
              kind: "save",
              to: "targets",
              trait: "agility",
              difficulty: OWN_DIFFICULTY,
              onFail: [
                { kind: "damage", to: "targets", roll: roll(2, 10, 4), type: "physical" },
                { kind: "markStress", to: "targets", amount: dice(1, 4) },
                { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "until they clear a Stress" },
              ],
              onSuccess: [
                { kind: "damage", to: "targets", roll: roll(2, 10, 4), type: "physical", scale: "half" },
                { kind: "markStress", to: "targets", amount: fixed(1) },
              ],
            },
          ],
          otherwise: [],
        },
      ],
    }),
  ),
  // Lava Splash: "When the Molten Scourge takes Severe damage from an attack within Very Close range, molten blood gushes
  // from the wound and deals 2d10+4 direct physical damage to the attacker."
  entry(
    "volcanic-dragon-molten-scourge",
    "Lava Splash",
    main({
      activation: { kind: "reaction", trigger: { kind: "onDamaged", stage: "did", minSeverity: "severe", fromAttack: true, attackerWithin: "veryClose" } },
      needsSpotlight: false,
      targets: SOURCE,
      steps: [{ kind: "damage", to: "targets", roll: roll(2, 10, 4), type: "physical", direct: true }],
    }),
  ),
  phaseChange("volcanic-dragon-molten-scourge", "Ashen Vengeance (Phase Change)", "volcanic-dragon-ashen-tyrant", "Volcanic Dragon: Ashen Tyrant"),

  // ======== Volcanic Dragon: Obsidian Predator (Solo, CB p.238)
  relentless("volcanic-dragon-obsidian-predator", 2),
  // Flying: "While flying, the Obsidian Predator gains a +3 bonus to their Difficulty."
  flyingDifficulty("volcanic-dragon-obsidian-predator", "Flying", 3),
  // Obsidian Scales: "The Obsidian Predator is resistant to physical damage."
  passive("volcanic-dragon-obsidian-predator", "Obsidian Scales", { modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }] }),
  // Avalanche Tail: "Mark a Stress to make an attack against all targets within Close range. Targets the Obsidian Predator
  // succeeds against take 4d6+4 physical damage and are knocked back to Far range and Vulnerable until their next roll with
  // Hope."
  entry(
    "volcanic-dragon-obsidian-predator",
    "Avalanche Tail",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress(1)],
      roll: ATTACK,
      targets: allAround("close"),
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(4, 6, 4), type: "physical" },
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "far", relativeTo: "self" },
        { kind: "condition", to: "targets", when: ["hit"], condition: VULNERABLE, duration: "manual", endsWhen: "until their next roll with Hope" },
      ],
    }),
  ),
  // Dive-Bomb: "If the Obsidian Predator is flying, mark a Stress to choose a point within Far range. Move to that point and
  // make an attack against all targets within Very Close range. Targets the Obsidian Predator succeeds against take 2d10+6
  // physical damage and must mark a Stress and lose a Hope."
  entry(
    "volcanic-dragon-obsidian-predator",
    "Dive-Bomb",
    main({
      activation: { kind: "action" },
      needsSpotlight: true,
      requires: [FLYING],
      costs: [stress(1)],
      roll: ATTACK,
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "aroundPoint", areaRange: "veryClose" },
      steps: [
        { kind: "move", to: "self", mode: "move", range: "far", relativeTo: "point", note: "Move to a point within Far range" },
        { kind: "damage", to: "targets", when: ["hit"], roll: roll(2, 10, 6), type: "physical" },
        { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(1) },
        { kind: "hope", to: "targets", when: ["hit"], change: "lose", amount: fixed(1) },
      ],
    }),
  ),
  phaseChange("volcanic-dragon-obsidian-predator", "Erupting Rage (Phase Change)", "volcanic-dragon-molten-scourge", "Volcanic Dragon: Molten Scourge"),

  // ======== Zombie Legion (Horde, CB p.239)
  // Horde (2d6+5): "When the Legion has marked half or more of their HP, their standard attack deals 2d6+5 physical damage
  // instead." (AR10, CB p.199)
  passive("zombie-legion", "Horde (2d6+5)", {
    modifiers: [{ kind: "horde", damage: { kind: "dice", dice: { count: fixed(2), sides: 6, plus: fixed(5) } } }],
  }),
  // Unyielding: "The Legion has resistance to physical damage."
  passive("zombie-legion", "Unyielding", { modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }] }),
  relentless("zombie-legion", 2),
  // Overwhelm: "When the Legion takes Minor damage from an attack within Melee range, you can mark a Stress to make a
  // standard attack with advantage against the attacker." Minor damage marks exactly 1 HP on an adversary (CB p.193).
  entry(
    "zombie-legion",
    "Overwhelm",
    main({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", atMost: 1, fromAttack: true, attackerWithin: "melee" } },
      needsSpotlight: false,
      costs: [stress(1)],
      roll: ATTACK_ADV,
      targets: SOURCE,
      steps: [STANDARD_DAMAGE],
    }),
  ),
];
