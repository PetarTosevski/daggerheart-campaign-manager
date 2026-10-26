// Adversary feature effects of tier 2 Hope & Fear adversaries (plan combat-actions, tracer AE-t2-hf). Pure data: no
// framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 42 adversaries,
// 138 features, HF p.70-80. Each entry quotes its feature text in a comment (as in ../adversaries.ts); what the vocabulary
// (src/lib/domain/adversary-effects/types.ts) cannot express is a `manual` step, never a vocabulary change. Readings,
// manual steps and their reasons: docs/tasks/TASK-CA-AE-t2-hf.md.
//
// Conventions used below:
// - Printed actions are `action` uses that need the spotlight (CB p.194). Printed reactions are `reaction` uses (a
//   one-tap prompt, default No, Q19), except pure Fear gains ("you gain a Fear"), which are `auto` (Q19). A printed
//   passive with a trigger and no choice is `auto`; one that says "you can" is a `reaction`.
// - "The target" of a reaction is the trigger's creature: `subject` = the PC the trigger happened to (the PC hit, the PC
//   who rolled), `source` = the creature that caused it (the attacker).
// - A PC's reaction roll is a `save` with the adversary's own Difficulty when none is printed (CB p.193); the runner
//   turns it into a `pcSave` prompt and the server applies `onFail` / `onSuccess`.

import type {
  AdversaryChooseOption,
  AdversaryCost,
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryStep,
} from "../../domain/adversary-effects/types";
import type {
  ConditionRef,
  DamageRoll,
  DamageType,
  DiceExpr,
  DieSides,
  Gate,
  NumberSource,
  Range,
  RollSpec,
  SaveDifficulty,
  StandardCondition,
  TargetSpec,
  TriggerTargets,
} from "../../domain/card-effects/types";

// ---------------------------------------------------------------- building blocks

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const one = fixed(1);
const diceExpr = (count: number, sides: DieSides, plus?: number): DiceExpr => ({
  count: fixed(count),
  sides,
  ...(plus !== undefined ? { plus: fixed(plus) } : {}),
});
const rolled = (count: number, sides: DieSides, plus?: number): NumberSource => ({ kind: "dice", dice: diceExpr(count, sides, plus) });
const dmg = (count: number, sides: DieSides, plus?: number): DamageRoll => ({ kind: "dice", dice: diceExpr(count, sides, plus) });
const hordeDice = (count: number, sides: DieSides, plus?: number): Extract<DamageRoll, { kind: "dice" }> => ({ kind: "dice", dice: diceExpr(count, sides, plus) });
const flat = (amount: number): DamageRoll => ({ kind: "flat", amount: fixed(amount) });

const fear = (n = 1): AdversaryCost => ({ kind: "fear", amount: fixed(n) });
const stress = (n = 1): AdversaryCost => ({ kind: "stress", amount: fixed(n) });

/** d20 + ATK against each target's Evasion (AR1); the runner adds the stat block's ATK. */
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };
const ATTACK_ADV: RollSpec = { ...ATTACK, advantage: true };
/** No Difficulty printed: the adversary's own (CB p.193). */
const OWN: SaveDifficulty = { kind: "actorDifficulty" };

const enemy = (range: Range | "unlimited"): TargetSpec => ({ side: "enemy", range, count: { kind: "one" } });
const enemiesAround = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "aroundSelf" });
const SUBJECT: TriggerTargets = { side: "trigger", who: "subject" };
const SOURCE: TriggerTargets = { side: "trigger", who: "source" };

const std = (condition: StandardCondition): ConditionRef => ({ kind: "standard", condition });
const tag = (name: string, implies?: readonly StandardCondition[]): ConditionRef => ({ kind: "tag", tag: name, ...(implies ? { implies } : {}) });

/** The printed standard attack's damage on a hit (Horde X and passive damage changes applied by the runner). */
const standardHit: AdversaryStep = { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" };
const hitDamage = (roll: DamageRoll, type: DamageType, direct = false): AdversaryStep => ({
  kind: "damage",
  to: "targets",
  when: ["hit"],
  roll,
  type,
  ...(direct ? { direct: true } : {}),
});
const gainFear = (amount: NumberSource = one, extra: { when?: readonly Gate[]; note?: string } = {}): AdversaryStep => ({
  kind: "fear",
  to: "self",
  change: "gain",
  amount,
  ...extra,
});

const passive = (modifiers: AdversaryFeatureUse["modifiers"], extra: Partial<AdversaryFeatureUse> = {}): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "passive" },
  needsSpotlight: false,
  modifiers,
  steps: [],
  ...extra,
});

/** Relentless (X): "can be spotlighted up to X times per GM turn. Spend Fear as usual to spotlight them." */
const relentless = (adversaryId: string, times: number): AdversaryFeatureEffect => ({
  adversaryId,
  feature: `Relentless (${times})`,
  uses: [passive([{ kind: "relentless", times }])],
});

/** Minion (X) (CB p.201): defeated by any damage; every X damage defeats an additional Minion. */
const minion = (adversaryId: string, threshold: number): AdversaryFeatureEffect => ({
  adversaryId,
  feature: `Minion (${threshold})`,
  uses: [passive([{ kind: "minion", threshold }])],
});

/**
 * Group Attack (AR9, CB p.201): "Spend a Fear to choose a target and spotlight all <name> within Close range of them.
 * Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal X <type>
 * damage each. Combine this damage."
 */
const groupAttack = (adversaryId: string, x: number, type: DamageType): AdversaryFeatureEffect => ({
  adversaryId,
  feature: "Group Attack",
  uses: [
    {
      id: "main",
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear()],
      roll: ATTACK,
      targets: enemy("unlimited"),
      groupAttack: { within: "close" },
      steps: [hitDamage(flat(x), type)],
    },
  ],
});

/** Momentum (CB p.195): "When the X makes a successful attack against a PC, you gain a Fear." Automatic (Q19). */
const momentum = (adversaryId: string): AdversaryFeatureEffect => ({
  adversaryId,
  feature: "Momentum",
  uses: [{ id: "main", activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } }, needsSpotlight: false, steps: [gainFear()] }],
});

/**
 * Double Strike: "Mark a Stress to make two standard attacks. If both attacks succeed against the same target, combine
 * the damage." Two rolls in one use (`followUp` with its own roll against `context.followUp`); the runner merges both hits
 * on one PC into one incoming hit, which is "combine the damage". The second attack's damage is the printed dice written
 * out: the card runner caches a damage roll by its expression, so a second `standardAttack` would reuse the first roll
 * (bead dcm-vv2). None of these three has a passive that changes its damage.
 */
const doubleStrike = (adversaryId: string, range: Range, printed: DamageRoll): AdversaryFeatureEffect => ({
  adversaryId,
  feature: "Double Strike",
  uses: [
    {
      id: "main",
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [stress()],
      roll: ATTACK,
      targets: enemy(range),
      steps: [standardHit, { kind: "followUp", roll: ATTACK, targets: enemy(range), steps: [hitDamage(printed, "physical")], note: "Second standard attack" }],
    },
  ],
});

const BESTIAL = tag("Bestial Form");

/**
 * Unleash the Beast (Guahalan): "Spend a Fear to have the X adopt a (more) bestial form. While in this form, they gain a
 * bonus to attack and damage rolls equal to the number of Stress they have marked. Additionally, they can move up to Far
 * range instead of Close range before taking an action." The action tags the instance; a passive use reads its marked
 * Stress live while the tag holds.
 */
const unleashTheBeast = (adversaryId: string): AdversaryFeatureEffect => ({
  adversaryId,
  feature: "Unleash the Beast",
  uses: [
    {
      id: "main",
      activation: { kind: "action" },
      needsSpotlight: true,
      costs: [fear()],
      steps: [
        { kind: "condition", to: "self", condition: BESTIAL, duration: "manual", endsWhen: "the form ends" },
        { kind: "manual", to: "self", text: "In bestial form it can move up to Far range instead of Close range before taking an action." },
      ],
    },
    passive(
      [
        { kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "marked", who: "self", track: "stress" } } },
        { kind: "attackDamage", add: { kind: "marked", who: "self", track: "stress" } },
      ],
      { id: "form", requires: [{ kind: "hasCondition", condition: BESTIAL }] },
    ),
  ],
});

const RAGE = tag("Berserker Rage");

/** Berserker Rage: "The first time in a scene the X marks their last Stress, they gain a +N bonus to damage rolls." */
const berserkerRage = (adversaryId: string, bonus: number): AdversaryFeatureEffect => ({
  adversaryId,
  feature: "Berserker Rage",
  uses: [
    {
      id: "main",
      activation: { kind: "reaction", trigger: { kind: "onMarkStress", last: true, first: "scene" } },
      needsSpotlight: false,
      steps: [{ kind: "condition", to: "self", condition: RAGE, duration: "scene" }],
    },
    passive([{ kind: "attackDamage", add: fixed(bonus) }], { id: "rage", requires: [{ kind: "hasCondition", condition: RAGE }] }),
  ],
});

/** Pack Fury: "gains a +1 bonus to their attack rolls for each ally within Very Close range of their attack's target." */
const packFury = (adversaryId: string): AdversaryFeatureEffect => ({
  adversaryId,
  feature: "Pack Fury",
  uses: [
    {
      id: "main",
      activation: { kind: "auto", trigger: { kind: "onAttack", stage: "before", attack: "any" } },
      needsSpotlight: false,
      steps: [{ kind: "manual", to: "self", text: "+1 to this attack roll for each ally within Very Close range of the target." }],
    },
  ],
});

/** Burrowing / Deep Diver: burrow or surface when it moves; while underground resistant (or immune) to all damage, can't attack. */
const UNDERGROUND = tag("Underground");
const burrowing = (adversaryId: string, feature: string, level: "resistant" | "immune"): AdversaryFeatureEffect => ({
  adversaryId,
  feature,
  uses: [
    {
      id: "burrow",
      activation: { kind: "action" },
      needsSpotlight: true,
      steps: [{ kind: "condition", to: "self", condition: UNDERGROUND, duration: "manual", endsWhen: "it surfaces" }],
    },
    { id: "surface", activation: { kind: "action" }, needsSpotlight: true, steps: [{ kind: "clearCondition", to: "self", condition: UNDERGROUND }] },
    passive(
      [
        { kind: "mod", mod: { kind: "resistance", type: "both", level } },
        { kind: "mod", mod: { kind: "flag", flag: "cannotAttack" } },
      ],
      { id: "underground", requires: [{ kind: "hasCondition", condition: UNDERGROUND }] },
    ),
  ],
});

const action = (use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string }): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "action" },
  needsSpotlight: true,
  ...use,
});

const resistance = (type: DamageType) => passive([{ kind: "mod", mod: { kind: "resistance", type, level: "resistant" } }]);

// ---------------------------------------------------------------- the table

export const T2_HF_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ======================================================== Banshee (HF p.70)
  // Specter - Passive: "The Banshee has resistance to physical damage. Mark a Stress to move up to Close range through
  // solid objects."
  {
    adversaryId: "banshee",
    feature: "Specter",
    uses: [
      resistance("physical"),
      action({
        id: "phase",
        costs: [stress()],
        steps: [{ kind: "move", to: "self", mode: "move", range: "close", note: "Move up to Close range through solid objects" }],
      }),
    ],
  },
  // Terrifying - Passive: "When the Banshee makes a successful attack, all PCs within Close range lose a Hope, and you gain
  // a Fear."
  {
    adversaryId: "banshee",
    feature: "Terrifying",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
        needsSpotlight: false,
        steps: [
          { kind: "hope", to: "picked", pick: enemiesAround("close"), change: "lose", amount: one },
          gainFear(),
        ],
      },
    ],
  },
  // Scare Tactic - Action: "Up to three times per scene, spend a Fear to have the Banshee teleport up to Very Far range and
  // scare a PC within Melee range. The PC marks 1d4 Stress. If this causes them to mark HP, they also lose a Hope."
  {
    adversaryId: "banshee",
    feature: "Scare Tactic",
    uses: [
      action({
        limit: { per: "scene", times: 3 },
        costs: [fear()],
        targets: enemy("melee"),
        steps: [
          { kind: "move", to: "self", mode: "teleport", range: "veryFar" },
          { kind: "markStress", to: "targets", amount: rolled(1, 4) },
          { kind: "hope", to: "targets", when: ["targetMarkedHp"], change: "lose", amount: one, note: "The Stress overflowed into HP (CB p.92)" },
        ],
      }),
    ],
  },
  // Wail of Despair - Action: "Mark a Stress to have the Banshee unleash a mournful scream of pain and anguish. Each PC
  // within Close range must make a Presence Reaction Roll. Targets who succeed take 1d12+1 magic damage. Targets who fail
  // take double damage and are knocked back to Close range."
  {
    adversaryId: "banshee",
    feature: "Wail of Despair",
    uses: [
      action({
        costs: [stress()],
        targets: enemiesAround("close"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "presence",
            difficulty: OWN,
            onSuccess: [{ kind: "damage", to: "targets", roll: dmg(1, 12, 1), type: "magic" }],
            onFail: [
              { kind: "damage", to: "targets", roll: dmg(1, 12, 1), type: "magic", scale: "double" },
              { kind: "move", to: "targets", mode: "knockBack", range: "close" },
            ],
          },
        ],
      }),
    ],
  },

  // ======================================================== Basilisk (HF p.70)
  // Petrify - Action: "Spend a Fear to force a PC within Far range to make an Instinct Reaction Roll. On a success, the
  // target marks a Stress. On a failure, the target becomes Stiff. If the target is already Stiff, they become Petrified.
  // While Stiff, the PC must mark a Stress each time they act until they take a rest or the Basilisk is defeated. While
  // Petrified, the PC can't act. The Petrified condition can be cleared only by applying Basilisk saliva to the target."
  {
    adversaryId: "basilisk",
    feature: "Petrify",
    uses: [
      action({
        costs: [fear()],
        targets: enemy("far"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "instinct",
            difficulty: OWN,
            onSuccess: [{ kind: "markStress", to: "targets", amount: one }],
            onFail: [
              {
                kind: "condition",
                to: "targets",
                when: [{ kind: "targetHas", condition: tag("Stiff") }],
                condition: tag("Petrified"),
                duration: "manual",
                endsWhen: "Basilisk saliva is applied to them (they can't act)",
              },
              { kind: "condition", to: "targets", condition: tag("Stiff"), duration: "rest", endsWhen: "they take a rest or the Basilisk is defeated" },
              { kind: "manual", to: "targets", text: "While Stiff, the PC marks a Stress each time they act." },
            ],
          },
        ],
      }),
    ],
  },
  // CRONCH! - Action: "Mark a Stress to have the Basilisk chomp down on a Petrified PC within Melee range. The target must
  // make a death move."
  {
    adversaryId: "basilisk",
    feature: "CRONCH!",
    uses: [
      action({
        costs: [stress()],
        targets: enemy("melee"),
        steps: [{ kind: "manual", to: "targets", when: [{ kind: "targetHas", condition: tag("Petrified") }], text: "The target must make a death move." }],
      }),
    ],
  },

  // ======================================================== Berserker Alpha (HF p.70)
  // Pack Fury - Passive: "The Alpha gains a +1 bonus to their attack rolls for each ally within Very Close range of their
  // attack's target."
  packFury("berserker-alpha"),
  // Bark at the Moon - Action: "Once per scene, spend a Fear to have each ally within Close range of the Alpha clear a HP and
  // a Stress."
  {
    adversaryId: "berserker-alpha",
    feature: "Bark at the Moon",
    uses: [
      action({
        limit: { per: "scene" },
        costs: [fear()],
        steps: [
          { kind: "clear", to: "allies", pick: { side: "ally", range: "close", count: { kind: "all" }, area: "aroundSelf" }, track: "hp", amount: one },
          { kind: "clear", to: "allies", pick: { side: "ally", range: "close", count: { kind: "all" }, area: "aroundSelf" }, track: "stress", amount: one },
        ],
      }),
    ],
  },
  // Berserker Rage - Reaction: "The first time in a scene the Alpha marks their last Stress, they gain a +6 bonus to damage
  // rolls."
  berserkerRage("berserker-alpha", 6),

  // ======================================================== Berserker Initiate (HF p.70)
  // Pack Fury - Passive: "The Initiate gains a +1 bonus to their attack rolls for each ally within Very Close range of
  // their attack's target."
  packFury("berserker-initiate"),
  // Berserker Rage - Reaction: "The first time in a scene the Initiate marks their last Stress, they gain a +4 bonus to
  // damage rolls."
  berserkerRage("berserker-initiate", 4),

  // ======================================================== Centaur Warden (HF p.70)
  // Flanking Maneuver - Passive: "When the Warden makes a standard attack against a target within Melee range of one or
  // more of the Warden's allies, the Warden gains a +2 bonus to the attack roll."
  {
    adversaryId: "centaur-warden",
    feature: "Flanking Maneuver",
    uses: [
      passive([{ kind: "mod", mod: { kind: "stat", stat: "attack", delta: fixed(2) } }], {
        requires: [{ kind: "allyWithin", range: "melee", of: "target" }],
      }),
    ],
  },
  // Eye of the Sage - Action: "Mark a Stress to make a standard attack. The Warden has advantage on the attack roll and
  // critically succeeds on a roll of 19–20."
  {
    adversaryId: "centaur-warden",
    feature: "Eye of the Sage",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK_ADV,
        targets: enemy("far"),
        steps: [standardHit, { kind: "manual", to: "self", text: "A natural 19 is also a critical success: the attack hits and deals maximum damage dice plus the roll." }],
      }),
    ],
  },
  // Trample - Action: "Spend a Fear to have the Warden gallop up to Far range in a straight line. Each target in their path
  // must make an Agility Reaction Roll. Targets who succeed take 1d6+2 physical damage. Targets who fail take double
  // damage and must mark a Stress."
  {
    adversaryId: "centaur-warden",
    feature: "Trample",
    uses: [
      action({
        costs: [fear()],
        targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "path" },
        steps: [
          { kind: "move", to: "self", mode: "move", range: "far", note: "Gallop up to Far range in a straight line" },
          {
            kind: "save",
            to: "targets",
            trait: "agility",
            difficulty: OWN,
            onSuccess: [{ kind: "damage", to: "targets", roll: dmg(1, 6, 2), type: "physical" }],
            onFail: [
              { kind: "damage", to: "targets", roll: dmg(1, 6, 2), type: "physical", scale: "double" },
              { kind: "markStress", to: "targets", amount: one },
            ],
          },
        ],
      }),
    ],
  },
  // Quick Volley - Reaction: "When the Warden makes a standard attack, you can mark any number of Stress to target an equal
  // number of additional creatures within range."
  // One use per number of Stress (its track holds 3): the GM's tap runs that use in place of the standard attack, one roll
  // against every target (AR7).
  {
    adversaryId: "centaur-warden",
    feature: "Quick Volley",
    uses: [1, 2, 3].map(
      (n): AdversaryFeatureUse => ({
        id: `volley-${n}`,
        activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "before", attack: "standard" } },
        needsSpotlight: false,
        costs: [stress(n)],
        roll: ATTACK,
        targets: { side: "enemy", range: "far", count: { kind: "upTo", n: fixed(n + 1) } },
        steps: [standardHit],
      }),
    ),
  },

  // ======================================================== Chicken-Foot Hut (HF p.71)
  // Fast - Passive: "The Hut can move up to Far range when spotlighted."
  {
    adversaryId: "chicken-foot-hut",
    feature: "Fast",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "onSpotlight" } },
        needsSpotlight: false,
        steps: [{ kind: "move", to: "self", mode: "move", range: "far" }],
      },
    ],
  },
  // Double Strike - Action: "Mark a Stress to make two standard attacks. If both attacks succeed against the same target,
  // combine the damage."
  doubleStrike("chicken-foot-hut", "veryClose", dmg(2, 10, 3)),
  // Pin - Reaction: "When the Hut makes a successful standard attack, you can mark a Stress to temporarily Restrain the
  // target. The Hut drags the Restrained target when it moves."
  {
    adversaryId: "chicken-foot-hut",
    feature: "Pin",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
        needsSpotlight: false,
        costs: [stress()],
        targets: SUBJECT,
        steps: [
          { kind: "condition", to: "targets", condition: std("restrained"), duration: "temporary" },
          { kind: "manual", to: "targets", text: "The Hut drags the Restrained target when it moves." },
        ],
      },
    ],
  },

  // ======================================================== Dire Pangolati (HF p.71)
  // Armor Eater - Passive: "When the Pangolati makes a successful attack against a PC, that PC must mark an additional Armor
  // Slot to reduce the severity of the damage."
  {
    adversaryId: "dire-pangolati",
    feature: "Armor Eater",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
        needsSpotlight: false,
        targets: SUBJECT,
        steps: [{ kind: "manual", to: "targets", text: "To reduce the severity with armor, this PC must mark 2 Armor Slots instead of 1." }],
      },
    ],
  },
  // Blade Spin - Action: "Spend a Fear to have the Pangolati quickly spin in a circle. Each target within Very Close range
  // must succeed on an Agility Reaction Roll or take 2d8 physical damage."
  {
    adversaryId: "dire-pangolati",
    feature: "Blade Spin",
    uses: [
      action({
        costs: [fear()],
        targets: enemiesAround("veryClose"),
        steps: [
          { kind: "save", to: "targets", trait: "agility", difficulty: OWN, onSuccess: [], onFail: [{ kind: "damage", to: "targets", roll: dmg(2, 8), type: "physical" }] },
        ],
      }),
    ],
  },
  // Blade Fling - Action: "Mark a Stress to have the Pangolati flick its tail and fling a razor-edged armor plate. Make an
  // attack against a target within Far range. On a success, the attack deals 2d6+10 physical damage."
  {
    adversaryId: "dire-pangolati",
    feature: "Blade Fling",
    uses: [action({ costs: [stress()], roll: ATTACK, targets: enemy("far"), steps: [hitDamage(dmg(2, 6, 10), "physical")] })],
  },
  // Keratin Scales - Reaction: "When the Pangolati would mark HP from an attack, you can mark a Stress to reduce the number
  // of HP it marks by 1."
  // An adversary marks 1/2/3 HP by severity (CB p.193), so one HP fewer is one threshold lower.
  {
    adversaryId: "dire-pangolati",
    feature: "Keratin Scales",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMarkHp", stage: "would", fromAttack: true } },
        needsSpotlight: false,
        costs: [stress()],
        steps: [{ kind: "reduceSeverity", to: "self", steps: 1, note: "Marks 1 HP fewer" }],
      },
    ],
  },

  // ======================================================== Doppelhound (HF p.71)
  // Blink Beast - Passive: "When combat begins, place a duplicate within Close range of the Doppelhound. The Doppelhound
  // occupies both its place and its duplicate's. The duplicate can move when the Doppelhound is spotlighted, and the
  // Doppelhound can target enemies with attacks as if it were in its duplicate's place. When the Doppelhound or duplicate
  // is attacked, the attacker rolls a d6. On an even result, they target the Doppelhound. On an odd result, they target the
  // duplicate, and the attack fails. If an attack succeeds against the Doppelhound, the duplicate is dispelled until you
  // spend a Fear to conjure it again."
  {
    adversaryId: "doppelhound",
    feature: "Blink Beast",
    uses: [
      {
        id: "place",
        activation: { kind: "auto", trigger: { kind: "timing", at: "combatStart" } },
        needsSpotlight: false,
        steps: [
          { kind: "condition", to: "self", condition: tag("Duplicate"), duration: "manual", endsWhen: "an attack succeeds against the Doppelhound" },
          { kind: "manual", to: "self", text: "Place a duplicate within Close range. The duplicate moves when the Doppelhound is spotlighted; it can attack from either place." },
        ],
      },
      {
        id: "attacked",
        activation: { kind: "auto", trigger: { kind: "onAttacked", stage: "targeted" } },
        needsSpotlight: false,
        requires: [{ kind: "hasCondition", condition: tag("Duplicate") }],
        steps: [{ kind: "manual", to: "self", text: "The attacker rolls a d6: even, they target the Doppelhound; odd, they target the duplicate and the attack fails." }],
      },
      {
        id: "dispel",
        activation: { kind: "auto", trigger: { kind: "onAttacked", stage: "succeeded" } },
        needsSpotlight: false,
        requires: [{ kind: "hasCondition", condition: tag("Duplicate") }],
        steps: [{ kind: "clearCondition", to: "self", condition: tag("Duplicate") }],
      },
      {
        id: "conjure",
        activation: { kind: "action" },
        needsSpotlight: false,
        costs: [fear()],
        steps: [
          { kind: "condition", to: "self", condition: tag("Duplicate"), duration: "manual", endsWhen: "an attack succeeds against the Doppelhound" },
          { kind: "manual", to: "self", text: "Place the duplicate within Close range." },
        ],
      },
    ],
  },
  // Double Strike - Action: "Mark a Stress to make two standard attacks. If both attacks succeed against the same target,
  // combine the damage."
  doubleStrike("doppelhound", "veryClose", dmg(2, 8, 2)),

  // ======================================================== Dragon Knight (HF p.71)
  // High Ground - Passive: "The Knight gains advantage on attacks made against targets below them."
  {
    adversaryId: "dragon-knight",
    feature: "High Ground",
    uses: [passive([{ kind: "mod", mod: { kind: "advantage", on: "attack" } }], { requires: [{ kind: "situation", text: "The target is below the Knight" }] })],
  },
  // Leaping Strike - Action: "Mark a Stress to have the Knight leap into Melee range of a target within Far range and make a
  // standard attack against them. On a success, the attack deals an extra 1d12 damage, and the target must mark an Armor
  // Slot without receiving its benefits (they can still use armor to reduce the damage)."
  {
    adversaryId: "dragon-knight",
    feature: "Leaping Strike",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: enemy("far"),
        steps: [
          { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "Leap into Melee range of the target" },
          standardHit,
          { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: rolled(1, 12) } },
          { kind: "markArmor", to: "targets", when: ["hit"], amount: one, noBenefit: true },
        ],
      }),
    ],
  },
  // Comeback - Reaction: "When the Knight fails a standard attack, you can spend a Fear to reroll the attack with
  // advantage."
  {
    adversaryId: "dragon-knight",
    feature: "Comeback",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMiss", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        roll: ATTACK_ADV,
        targets: SUBJECT,
        steps: [standardHit],
      },
    ],
  },

  // ======================================================== Elephant (HF p.72)
  // Trample - Action: "Mark a Stress to have the Elephant charge up to Far range in a straight line. Each target in its path
  // must succeed on an Agility Reaction Roll or take 2d10+3 physical damage."
  {
    adversaryId: "elephant",
    feature: "Trample",
    uses: [
      action({
        costs: [stress()],
        targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "path" },
        steps: [
          { kind: "move", to: "self", mode: "move", range: "far", note: "Charge up to Far range in a straight line" },
          { kind: "save", to: "targets", trait: "agility", difficulty: OWN, onSuccess: [], onFail: [{ kind: "damage", to: "targets", roll: dmg(2, 10, 3), type: "physical" }] },
        ],
      }),
    ],
  },
  // Toss - Reaction: "When the Elephant makes a successful standard attack, you can spend a Fear to have it toss the target
  // to another location within Close range and deal an extra 1d12 damage."
  // The extra die is a fold on the open hit (added before thresholds, R2), not a second hit.
  {
    adversaryId: "elephant",
    feature: "Toss",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SUBJECT,
        steps: [
          { kind: "move", to: "targets", mode: "move", range: "close", note: "Toss the target to another location within Close range" },
          { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: rolled(1, 12) } },
        ],
      },
    ],
  },

  // ======================================================== Entombed Cat Beast (HF p.72)
  // Relentless (3) - Passive: "The Cat Beast can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight them."
  relentless("entombed-cat-beast", 3),
  // Bloody Strike - Passive: "A PC who marks 3 or more HP from an attack made by the Cat Beast must mark an additional HP."
  // 3 HP is Severe damage (CB p.91; massive damage is off).
  {
    adversaryId: "entombed-cat-beast",
    feature: "Bloody Strike",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "pcMarksHp", fromSelf: true, minSeverity: "severe" } },
        needsSpotlight: false,
        targets: SUBJECT,
        steps: [{ kind: "markHp", to: "targets", amount: one }],
      },
    ],
  },
  // Screeching Caterwaul - Action: "Mark a Stress to force each PC within Far range of the Cat Beast to make a Presence
  // Reaction Roll. Targets who fail become Rattled until they roll with Hope. When the Cat Beast makes a successful attack
  // against a Rattled PC, roll damage twice and take the better result, then clear the Rattled condition from the target."
  {
    adversaryId: "entombed-cat-beast",
    feature: "Screeching Caterwaul",
    uses: [
      action({
        costs: [stress()],
        targets: enemiesAround("far"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "presence",
            difficulty: OWN,
            onSuccess: [],
            onFail: [{ kind: "condition", to: "targets", condition: tag("Rattled"), duration: "manual", endsWhen: "they roll with Hope" }],
          },
        ],
      }),
      {
        id: "rattled",
        activation: { kind: "auto", trigger: { kind: "onHit", attack: "any", targetHas: tag("Rattled") } },
        needsSpotlight: false,
        targets: SUBJECT,
        steps: [
          { kind: "manual", to: "targets", text: "Roll this attack's damage twice and take the better result." },
          { kind: "clearCondition", to: "targets", condition: tag("Rattled") },
        ],
      },
    ],
  },
  // I Alone - Reaction: "When the Cat Beast first appears, you can choose to have them absorb the essence of their allies.
  // Immediately defeat any number of allies on the battlefield, and gain a Fear for each ally defeated this way."
  {
    adversaryId: "entombed-cat-beast",
    feature: "I Alone",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "timing", at: "appears" } },
        needsSpotlight: false,
        targets: { side: "ally", range: "unlimited", count: { kind: "any" } },
        steps: [
          { kind: "defeat", to: "targets" },
          gainFear({ kind: "targetCount", which: "picked" }),
        ],
      },
    ],
  },
  // Vicious Reprisal - Reaction: "When the Cat Beast takes damage from an attack made by a PC within Very Close range, you
  // can mark a Stress to make a standard attack against that PC."
  {
    adversaryId: "entombed-cat-beast",
    feature: "Vicious Reprisal",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDamaged", fromAttack: true, attackerWithin: "veryClose" } },
        needsSpotlight: false,
        costs: [stress()],
        roll: ATTACK,
        targets: SOURCE,
        steps: [standardHit],
      },
    ],
  },

  // ======================================================== Entombed Elite Guard (HF p.72)
  // Battle Formation - Passive: "The Guard gains a +1 bonus to their Difficulty for each ally within Very Close range."
  {
    adversaryId: "entombed-elite-guard",
    feature: "Battle Formation",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "onAttacked", stage: "targeted" } },
        needsSpotlight: false,
        steps: [{ kind: "manual", to: "self", text: "+1 to the Guard's Difficulty against this attack for each ally within Very Close range of the Guard." }],
      },
    ],
  },
  // Javelin - Action: "Make an attack against a target within Very Far range. On a success, deal 2d6+2 physical damage."
  {
    adversaryId: "entombed-elite-guard",
    feature: "Javelin",
    uses: [action({ roll: ATTACK, targets: enemy("veryFar"), steps: [hitDamage(dmg(2, 6, 2), "physical")] })],
  },

  // ======================================================== Entombed Empress (HF p.72)
  // Empty Husk - Passive: "The Empress has resistance to physical damage."
  { adversaryId: "entombed-empress", feature: "Empty Husk", uses: [resistance("physical")] },
  // Missing Organs - Passive: "The Empress's internal organs have been removed and placed into six crystal containers
  // hidden throughout her tomb. Each time the PCs find and destroy one, the Empress marks a HP."
  {
    adversaryId: "entombed-empress",
    feature: "Missing Organs",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "situation", text: "The PCs find and destroy one of the six crystal containers" } },
        needsSpotlight: false,
        steps: [{ kind: "markHp", to: "self", amount: one }],
      },
    ],
  },
  // Grasping Chains - Action: "Mark a Stress to have the Empress target a creature within Close range and try to
  // telekinetically bind them with her funeral chains. Make an attack against a target within Close range. On a success,
  // the Empress pulls the target into Melee range, deals 2d8 physical damage, and temporarily Restrains them."
  {
    adversaryId: "entombed-empress",
    feature: "Grasping Chains",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: enemy("close"),
        steps: [
          { kind: "move", to: "targets", when: ["hit"], mode: "pull", range: "melee", relativeTo: "self" },
          hitDamage(dmg(2, 8), "physical"),
          { kind: "condition", to: "targets", when: ["hit"], condition: std("restrained"), duration: "temporary" },
        ],
      }),
    ],
  },
  // Deathless Obedience - Action: "Up to three times per scene, you can spend a Fear to spotlight any number of allies
  // within Close range. If any attacks succeed against the same target, combine the damage."
  {
    adversaryId: "entombed-empress",
    feature: "Deathless Obedience",
    uses: [
      action({
        limit: { per: "scene", times: 3 },
        costs: [fear()],
        steps: [{ kind: "spotlight", who: "allies", within: "close", note: "Any number of allies; attacks that succeed against the same target combine their damage" }],
      }),
    ],
  },
  // Accursed Caress - Reaction: "When the Empress makes a successful standard attack against a PC, you can spend a Fear to
  // activate a Doom Countdown (1d6+1) for that PC. It ticks down when a PC rolls with Fear. When it triggers, the PC marks
  // all HP and makes a death move. If the Empress is defeated or the PCs take a rest, all Doom Countdowns end."
  {
    adversaryId: "entombed-empress",
    feature: "Accursed Caress",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SUBJECT,
        steps: [
          {
            kind: "countdown",
            op: "start",
            label: "Doom Countdown",
            start: rolled(1, 6, 1),
            onTrigger: "The PC marks all HP and makes a death move.",
            note: "Ticks down when a PC rolls with Fear; ends if the Empress is defeated or the PCs take a rest",
          },
        ],
      },
    ],
  },
  // Final Transformation (Phase Change) - Reaction: "When the Empress marks her last HP, replace her with the Entombed Cat
  // Beast and immediately spotlight them."
  {
    adversaryId: "entombed-empress",
    feature: "Final Transformation (Phase Change)",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMarkHp", last: true } },
        needsSpotlight: false,
        steps: [
          { kind: "summon", label: "Entombed Cat Beast (replaces the Empress)", count: one, adversaryId: "entombed-cat-beast" },
          { kind: "spotlight", who: "picked", note: "Spotlight the Entombed Cat Beast" },
        ],
      },
    ],
  },

  // ======================================================== Entombed Necropriest (HF p.73)
  // Invigorate - Action: "Mark a Stress to choose up to three allies within Far range. Each one gains advantage on their
  // next attack roll."
  {
    adversaryId: "entombed-necropriest",
    feature: "Invigorate",
    uses: [
      action({
        costs: [stress()],
        targets: { side: "ally", range: "far", count: { kind: "upTo", n: fixed(3) } },
        steps: [{ kind: "effect", to: "targets", label: "Invigorate", mods: [{ kind: "advantage", on: "attack" }], duration: "nextRoll" }],
      }),
    ],
  },
  // Last Grasp - Action: "Spend a Fear to choose a PC within Far range. Skeletal hands burst out of the ground at the PC's
  // feet and Restrain them until the PC breaks free with a successful Strength Roll. When a target Restrained in this way
  // spends Hope, you gain a Fear."
  {
    adversaryId: "entombed-necropriest",
    feature: "Last Grasp",
    uses: [
      action({
        costs: [fear()],
        targets: enemy("far"),
        steps: [
          { kind: "condition", to: "targets", condition: std("restrained"), duration: "manual", endsWhen: "they break free with a successful Strength Roll" },
          { kind: "condition", to: "targets", condition: tag("Last Grasp"), duration: "manual", endsWhen: "they break free with a successful Strength Roll" },
        ],
      }),
      {
        id: "hope",
        activation: { kind: "auto", trigger: { kind: "pcHope", change: "spend" } },
        needsSpotlight: false,
        targets: SUBJECT,
        steps: [gainFear(one, { when: [{ kind: "targetHas", condition: tag("Last Grasp") }] })],
      },
    ],
  },
  // Chill Touch - Action: "Mark a Stress to make a standard attack against a target within Melee range. On a success, the
  // target takes standard damage and must mark 1d4 Stress. If the target marks their last Stress from this attack, you gain
  // a Fear."
  {
    adversaryId: "entombed-necropriest",
    feature: "Chill Touch",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: enemy("melee"),
        steps: [
          standardHit,
          { kind: "markStress", to: "targets", when: ["hit"], amount: rolled(1, 4) },
          gainFear(one, { when: ["hit", "targetStressFull"], note: "Their Stress track is full after this attack" }),
        ],
      }),
    ],
  },

  // ======================================================== Entombed Skin Beetles (HF p.73)
  // Horde (2d4+1) - Passive: "When the Beetles have marked half or more of their HP, their standard attack deals 2d4+1
  // physical damage instead."
  { adversaryId: "entombed-skin-beetles", feature: "Horde (2d4+1)", uses: [passive([{ kind: "horde", damage: hordeDice(2, 4, 1) }])] },
  // Omophagous - Action: "Mark a HP to have 5 Beetles burrow under the skin of a PC within Melee range, forcing them to mark
  // a Stress and Infecting them. While Infected, the target takes 6 direct physical damage every time they roll with Fear.
  // This condition is cleared when the PC clears a HP or a Stress."
  {
    adversaryId: "entombed-skin-beetles",
    feature: "Omophagous",
    uses: [
      action({
        costs: [{ kind: "hp", amount: one }],
        targets: enemy("melee"),
        steps: [
          { kind: "markStress", to: "targets", amount: one },
          { kind: "condition", to: "targets", condition: tag("Infected"), duration: "manual", endsWhen: "the PC clears a HP or a Stress" },
        ],
      }),
      {
        id: "infected",
        activation: { kind: "auto", trigger: { kind: "pcRolls", result: "withFear" } },
        needsSpotlight: false,
        targets: SUBJECT,
        steps: [{ kind: "damage", to: "targets", when: [{ kind: "targetHas", condition: tag("Infected") }], roll: flat(6), type: "physical", direct: true }],
      },
    ],
  },
  // Momentum - Reaction: "When the Beetles make a successful attack against a PC, you gain a Fear."
  momentum("entombed-skin-beetles"),

  // ======================================================== Entombed Stonemason (HF p.73)
  // Minion (5) - Passive: "The Stonemason is defeated when they take any damage. For every 5 damage a PC deals to the
  // Stonemason, the PC defeats an additional Minion within range their attack would succeed against."
  minion("entombed-stonemason", 5),
  // Group Attack - Action: "... spotlight all Entombed Stonemasons within Close range of them ... they deal 5 physical
  // damage each. Combine this damage."
  groupAttack("entombed-stonemason", 5, "physical"),
  // The Work Never Ends - Reaction: "When the Stonemason is defeated by an attack that deals physical damage, you can spend
  // a Fear to clear the Stonemason's HP and Stress."
  {
    adversaryId: "entombed-stonemason",
    feature: "The Work Never Ends",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDefeated", damageType: "physical" } },
        needsSpotlight: false,
        costs: [fear()],
        steps: [
          { kind: "clear", to: "self", track: "hp", amount: { kind: "marked", who: "self", track: "hp" } },
          { kind: "clear", to: "self", track: "stress", amount: { kind: "marked", who: "self", track: "stress" } },
        ],
      },
    ],
  },

  // ======================================================== Flock of Feather Fiends (HF p.74)
  // Horde (1d6+1) - Passive: "When the Flock has marked half or more of its HP, its standard attack deals 1d6+1 magic damage
  // instead."
  { adversaryId: "flock-of-feather-fiends", feature: "Horde (1d6+1)", uses: [passive([{ kind: "horde", damage: hordeDice(1, 6, 1) }])] },
  // Maddening Cacophony - Action: "Mark a Stress to force each PC within Very Close range to make an Instinct Reaction
  // Roll. Targets who fail must spend a Hope or become Vulnerable until they deal damage to the Flock or the Flock is
  // defeated."
  {
    adversaryId: "flock-of-feather-fiends",
    feature: "Maddening Cacophony",
    uses: [
      action({
        costs: [stress()],
        targets: enemiesAround("veryClose"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "instinct",
            difficulty: OWN,
            onSuccess: [],
            onFail: [
              {
                kind: "choose",
                id: "cacophony",
                label: "Spend a Hope or become Vulnerable",
                options: [
                  { id: "hope", label: "Spend a Hope", steps: [{ kind: "hope", to: "targets", change: "lose", amount: one }] },
                  {
                    id: "vulnerable",
                    label: "Become Vulnerable",
                    steps: [{ kind: "condition", to: "targets", condition: std("vulnerable"), duration: "manual", endsWhen: "they deal damage to the Flock or the Flock is defeated" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ],
  },

  // ======================================================== Fowlbear (HF p.74)
  // Relentless (2) - Passive: "The Fowlbear can be spotlighted up to two times per GM turn. Spend Fear as usual to
  // spotlight it."
  relentless("fowlbear", 2),
  // Double Strike - Action: "Mark a Stress to make two standard attacks. If both attacks succeed against the same target,
  // combine the damage."
  doubleStrike("fowlbear", "veryClose", dmg(2, 12, 2)),
  // Dread Honk - Action: "Spend a Fear to have the Fowlbear unleash a terrifying, ear-splitting goose honk. Each PC within
  // Close range must make a Presence Reaction Roll. Targets who fail must mark a Stress, move away from the Fowlbear to Far
  // range, and become Vulnerable until the Fowlbear deals damage to them. Targets who succeed must mark a Stress or move
  // away from the Fowlbear to Far range."
  {
    adversaryId: "fowlbear",
    feature: "Dread Honk",
    uses: [
      action({
        costs: [fear()],
        targets: enemiesAround("close"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "presence",
            difficulty: OWN,
            onFail: [
              { kind: "markStress", to: "targets", amount: one },
              { kind: "move", to: "targets", mode: "flee", range: "far", relativeTo: "self", note: "Move away from the Fowlbear to Far range" },
              { kind: "condition", to: "targets", condition: std("vulnerable"), duration: "manual", endsWhen: "the Fowlbear deals damage to them" },
            ],
            onSuccess: [
              {
                kind: "choose",
                id: "honk",
                label: "Mark a Stress or move away to Far range",
                options: [
                  { id: "stress", label: "Mark a Stress", steps: [{ kind: "markStress", to: "targets", amount: one }] },
                  { id: "move", label: "Move away to Far range", steps: [{ kind: "move", to: "targets", mode: "flee", range: "far", relativeTo: "self" }] },
                ],
              },
            ],
          },
        ],
      }),
    ],
  },

  // ======================================================== Fungispunj Sporeling (HF p.74)
  // Minion (6) - Passive: "The Sporeling is defeated when it takes any damage. For every 6 damage a PC deals to the
  // Sporeling, the PC defeats an additional Minion within range the attack would succeed against."
  minion("fungispunj-sporeling", 6),
  // Group Attack - Action: "... spotlight all Fungispunj Sporelings within Close range of them ... they deal 4 magic damage
  // each. Combine this damage."
  groupAttack("fungispunj-sporeling", 4, "magic"),
  // Form Up - Action: "Spend a Fear to combine three Sporelings within a Close area and replace them with a Fungispunj
  // Sporophore."
  // Targets are the three Sporelings (this one included): they leave the field and a Sporophore is added.
  {
    adversaryId: "fungispunj-sporeling",
    feature: "Form Up",
    uses: [
      action({
        costs: [fear()],
        targets: { side: "selfOrAlly", range: "close", count: { kind: "upTo", n: fixed(3) } },
        steps: [
          { kind: "defeat", to: "targets", note: "The three Sporelings are replaced" },
          { kind: "summon", label: "Fungispunj Sporophore", count: one, adversaryId: "fungispunj-sporophore" },
        ],
      }),
    ],
  },

  // ======================================================== Fungispunj Sporophore (HF p.74)
  // Neurotoxic Spore Cloud - Action: "Mark a Stress to have the Sporophore spray a cloud of spores on all targets within
  // Close range. Each PC must succeed on a Agility Reaction Roll or become Poisoned until they spend a Hope to clear the
  // condition. While Poisoned, a target must roll a d6 before they make an action roll. On a result of 4 or lower, they must
  // mark a Stress."
  {
    adversaryId: "fungispunj-sporophore",
    feature: "Neurotoxic Spore Cloud",
    uses: [
      action({
        costs: [stress()],
        targets: enemiesAround("close"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "agility",
            difficulty: OWN,
            onSuccess: [],
            onFail: [
              { kind: "condition", to: "targets", condition: tag("Poisoned"), duration: "manual", endsWhen: "they spend a Hope to clear it" },
              { kind: "manual", to: "targets", text: "While Poisoned, roll a d6 before each action roll; on 4 or lower, mark a Stress." },
            ],
          },
        ],
      }),
    ],
  },
  // Reanimator - Action: "Spend a Fear to have the Sporophore spray a corpse within Very Close range with a cloud of psychic
  // spores. The corpse clears all HP and Stress, then reanimates under the psychic control of the Sporophore. When the
  // Sporophore is spotlighted, you can also spotlight all corpses it controls."
  {
    adversaryId: "fungispunj-sporophore",
    feature: "Reanimator",
    uses: [
      action({
        costs: [fear()],
        steps: [{ kind: "summon", label: "Reanimated corpse (all HP and Stress cleared, controlled by the Sporophore)", count: one, range: "veryClose" }],
      }),
      {
        id: "command",
        activation: { kind: "reaction", trigger: { kind: "onSpotlight" } },
        needsSpotlight: false,
        steps: [{ kind: "spotlight", who: "picked", note: "Spotlight every corpse the Sporophore controls" }],
      },
    ],
  },
  // Colony - Action: "Mark any number of Stress to have the Sporophore summon an equal number of Fungispunj Sporelings
  // within Close range."
  // "Any number" is a choice from 1 to its 5 Stress slots; each option pays its Stress, then summons that many.
  {
    adversaryId: "fungispunj-sporophore",
    feature: "Colony",
    uses: [
      action({
        steps: [
          {
            kind: "choose",
            id: "colony",
            label: "Mark how many Stress?",
            options: [1, 2, 3, 4, 5].map((n): AdversaryChooseOption => ({
              id: String(n),
              label: `${n} Stress, ${n} Sporeling${n > 1 ? "s" : ""}`,
              steps: [
                { kind: "pay", costs: [stress(n)] },
                { kind: "summon", label: "Fungispunj Sporelings", count: fixed(n), adversaryId: "fungispunj-sporeling", range: "close" },
              ],
            })),
          },
        ],
      }),
    ],
  },
  // Mind Meld - Reaction: "All Fungispunj can telepathically communicate with one another. When the Sporophore would be
  // forced to mark Stress from an attack, it can cause Fungispunj allies in the scene to mark that Stress in its place,
  // distributed among allies as it chooses."
  {
    adversaryId: "fungispunj-sporophore",
    feature: "Mind Meld",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMarkStress" } },
        needsSpotlight: false,
        steps: [
          { kind: "clear", to: "self", track: "stress", amount: { kind: "triggerAmount" }, note: "The Stress from the attack is not marked on the Sporophore" },
          { kind: "manual", to: "self", text: "Fungispunj allies in the scene mark that Stress instead, distributed as you choose." },
        ],
      },
    ],
  },

  // ======================================================== Gargoyle (HF p.75)
  // Unliving - Passive: "The Gargoyle has resistance to magic damage."
  { adversaryId: "gargoyle", feature: "Unliving", uses: [resistance("magic")] },
  // Swooping Strike - Action: "Choose a point within Far range. The Gargoyle moves to that point and makes a standard attack
  // against one target along its path."
  {
    adversaryId: "gargoyle",
    feature: "Swooping Strike",
    uses: [
      action({
        roll: ATTACK,
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        steps: [{ kind: "move", to: "self", mode: "move", range: "far", relativeTo: "point", note: "Move to a point within Far range; the target is along the path" }, standardHit],
      }),
    ],
  },
  // Petrifying Slash - Reaction: "When the Gargoyle deals damage, the target must succeed on a Strength Reaction Roll or
  // become Vulnerable. If the target is already Vulnerable, they become Restrained. If the target is already Vulnerable and
  // Restrained, they must make a death move. The PC can spend a Hope per condition to clear it."
  {
    adversaryId: "gargoyle",
    feature: "Petrifying Slash",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDealDamage", toPc: true } },
        needsSpotlight: false,
        targets: SUBJECT,
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "strength",
            difficulty: OWN,
            onSuccess: [],
            onFail: [
              {
                kind: "manual",
                to: "targets",
                when: [{ kind: "targetHas", condition: std("vulnerable") }, { kind: "targetHas", condition: std("restrained") }],
                text: "Already Vulnerable and Restrained: the target must make a death move.",
              },
              {
                kind: "condition",
                to: "targets",
                when: [{ kind: "targetHas", condition: std("vulnerable") }],
                condition: std("restrained"),
                duration: "manual",
                endsWhen: "the PC spends a Hope to clear it",
              },
              { kind: "condition", to: "targets", condition: std("vulnerable"), duration: "manual", endsWhen: "the PC spends a Hope to clear it" },
            ],
          },
        ],
      },
    ],
  },

  // ======================================================== Giant Octopus (HF p.75)
  // Relentless (3) - Passive: "The Octopus can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight it."
  relentless("giant-octopus", 3),
  // Armed and Dangerous - Passive: "When the Octopus first appears, place a d8 on this stat block with the 8 value facing
  // up. When the Octopus makes a successful standard attack against a PC, you can add the die's value to the damage dealt.
  // After you add its value to a roll, decrease the die's value by 1."
  // The die is the instance's stat-block tokens (value 8 to 1).
  {
    adversaryId: "giant-octopus",
    feature: "Armed and Dangerous",
    uses: [
      {
        id: "place",
        activation: { kind: "auto", trigger: { kind: "timing", at: "appears" } },
        needsSpotlight: false,
        steps: [{ kind: "tokens", to: "self", op: "set", amount: fixed(8), die: 8 }],
      },
      {
        id: "add",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
        needsSpotlight: false,
        requires: [{ kind: "tokens", atLeast: 1 }],
        targets: SUBJECT,
        steps: [
          { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "cardTokens" } }, note: "Add the d8's value to the damage" },
          { kind: "tokens", to: "self", op: "spend", amount: one, die: 8 },
        ],
      },
    ],
  },
  // Grapple - Action: "When the Octopus succeeds on a standard attack, you can spend a Fear to have the Octopus Grapple the
  // target. While Grappled, the target is Restrained and Vulnerable until they break free with a successful Strength or
  // Finesse Roll."
  // Printed as an action but triggered by the hit: offered right after a successful standard attack (the spotlight was
  // already used for that attack).
  {
    adversaryId: "giant-octopus",
    feature: "Grapple",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SUBJECT,
        steps: [
          {
            kind: "condition",
            to: "targets",
            condition: tag("Grappled", ["restrained", "vulnerable"]),
            duration: "manual",
            endsWhen: "they break free with a successful Strength or Finesse Roll",
          },
        ],
      },
    ],
  },
  // Crush - Action: "Mark a Stress to deal 3d8 direct physical damage to a target Grappled by the Octopus."
  {
    adversaryId: "giant-octopus",
    feature: "Crush",
    uses: [
      action({
        costs: [stress()],
        targets: enemy("unlimited"),
        steps: [{ kind: "damage", to: "targets", when: [{ kind: "targetHas", condition: tag("Grappled") }], roll: dmg(3, 8), type: "physical", direct: true }],
      }),
    ],
  },

  // ======================================================== Gobstalker (HF p.75)
  // Relentless (3) - Passive: "The Gobstalker can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight them."
  relentless("gobstalker", 3),
  // Anti-Mystica-Halitosis - Passive: "The Gobstalker's rancid breath creates an invisible, magic-negating miasma. An
  // attack, an ability, or a spell that deals magic damage or creates a magic effect fails automatically if used within
  // Close range of the Gobstalker."
  // Read as a Silenced aura on every creature within Close range (PCs and its allies): their magic fails.
  {
    adversaryId: "gobstalker",
    feature: "Anti-Mystica-Halitosis",
    uses: [
      passive([
        { kind: "mod", mod: { kind: "flag", flag: "silenced" }, to: "pcs", within: "close" },
        { kind: "mod", mod: { kind: "flag", flag: "silenced" }, to: "allies", within: "close" },
      ]),
    ],
  },
  // Tentacle Rays - Action: "Mark a Stress to attack a target within Far range. On a success, roll a d8 for a random beam
  // attack or spend a Fear to choose instead: 1. Beguile. … 2. Corrode. … 3. Doom. … 4. Hypnosis. … 5. Paralyze. … 6.
  // Sear. … 7. Scare. … 8. Slow. …" (full beam texts in ../adversaries.ts)
  // The GM picks the beam the d8 showed, or pays the optional Fear to pick freely.
  {
    adversaryId: "gobstalker",
    feature: "Tentacle Rays",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: enemy("far"),
        steps: [
          { kind: "optional", id: "choose-beam", label: "Spend a Fear to choose the beam instead of rolling a d8", when: ["hit"], costs: [fear()], steps: [] },
          {
            kind: "choose",
            id: "beam",
            label: "Beam (the d8 result, or the one chosen for a Fear)",
            when: ["hit"],
            options: [
              {
                // "The Gobstalker Beguiles the target. While Beguiled, the target sees the Gobstalker as a friend and can't
                // attack it. Additionally, when a PC rolls with Fear, a Beguiled PC must mark a Stress or attack a target
                // chosen by the Gobstalker. A Beguiled PC must succeed on an Instinct Roll (16) to clear the condition."
                id: "1",
                label: "Beguile",
                steps: [
                  { kind: "condition", to: "targets", when: ["hit"], condition: tag("Beguiled"), duration: "manual", endsWhen: "they succeed on an Instinct Roll (16)" },
                  { kind: "manual", to: "targets", when: ["hit"], text: "Beguiled: can't attack the Gobstalker; when a PC rolls with Fear, mark a Stress or attack a target the Gobstalker chooses." },
                ],
              },
              {
                // "The target takes 2d8 magic damage and must mark an Armor Slot without receiving its benefits (they can
                // still use armor to reduce the damage). If they can't, double the damage."
                id: "2",
                label: "Corrode",
                steps: [
                  hitDamage(dmg(2, 8), "magic"),
                  { kind: "markArmor", to: "targets", when: ["hit"], amount: one, noBenefit: true },
                  { kind: "manual", to: "targets", when: ["hit"], text: "If the target can't mark an Armor Slot, double the damage." },
                ],
              },
              {
                // "The target must mark all HP, but they can spend any number of Hope to reduce the number of HP marked
                // this way by an equal amount."
                id: "3",
                label: "Doom",
                steps: [{ kind: "manual", to: "targets", when: ["hit"], text: "The target marks all their HP, less 1 HP for each Hope they choose to spend." }],
              },
              {
                // "The target falls into a Deep Trance and can't act except to try to wake up. This condition lasts until
                // the target takes damage or wakes up with a successful Presence Roll (16)."
                id: "4",
                label: "Hypnosis",
                steps: [
                  {
                    kind: "condition",
                    to: "targets",
                    when: ["hit"],
                    condition: tag("Deep Trance"),
                    duration: "manual",
                    endsWhen: "they take damage or succeed on a Presence Roll (16); they can't act except to try to wake up",
                  },
                ],
              },
              {
                // "The target freezes in place, becoming Vulnerable and Restrained until they mark 2 Stress."
                id: "5",
                label: "Paralyze",
                steps: [
                  { kind: "condition", to: "targets", when: ["hit"], condition: std("vulnerable"), duration: "manual", endsWhen: "they mark 2 Stress" },
                  { kind: "condition", to: "targets", when: ["hit"], condition: std("restrained"), duration: "manual", endsWhen: "they mark 2 Stress" },
                ],
              },
              // "The target takes 2d8 direct magic damage."
              { id: "6", label: "Sear", steps: [hitDamage(dmg(2, 8), "magic", true)] },
              {
                // "The target is Scared. While Scared, the target can't take actions other than fleeing the battle or
                // trying to shake off their terror. Additionally, the target must mark a Stress whenever you spend a Fear.
                // The target can clear the condition with a successful Presence Roll (16)."
                id: "7",
                label: "Scare",
                steps: [
                  { kind: "condition", to: "targets", when: ["hit"], condition: tag("Scared"), duration: "manual", endsWhen: "they succeed on a Presence Roll (16)" },
                  { kind: "manual", to: "targets", when: ["hit"], text: "Scared: only flee or shake off the terror; mark a Stress whenever the GM spends a Fear." },
                ],
              },
              {
                // "The target becomes Vulnerable and must mark a Stress to move until they spend 2 Hope."
                id: "8",
                label: "Slow",
                steps: [
                  { kind: "condition", to: "targets", when: ["hit"], condition: std("vulnerable"), duration: "manual", endsWhen: "they spend 2 Hope" },
                  { kind: "condition", to: "targets", when: ["hit"], condition: tag("Slowed"), duration: "manual", endsWhen: "they spend 2 Hope" },
                  { kind: "manual", to: "targets", when: ["hit"], text: "Slowed: mark a Stress to move." },
                ],
              },
            ],
          },
        ],
      }),
    ],
  },
  // Leech Lick - Reaction: "On a successful standard attack, you can spend a Fear to clear a number of Stress equal to the
  // number of HP the target marked."
  // Offered once the hit resolved (the trigger carries the HP the target marked).
  {
    adversaryId: "gobstalker",
    feature: "Leech Lick",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onTargetMarksHp", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        steps: [{ kind: "clear", to: "self", track: "stress", amount: { kind: "triggerAmount" } }],
      },
    ],
  },

  // ======================================================== Guahalan Alebrujo (HF p.76)
  // The Beast Unleashed - Passive: "The Alebrujo gains a bonus to damage rolls equal to the number of Fear you have."
  { adversaryId: "guahalan-alebrujo", feature: "The Beast Unleashed", uses: [passive([{ kind: "attackDamage", add: { kind: "gmFear" } }])] },
  // Guahalan Sacrifice - Action: "Spend a Fear to have the Alebrujo devour a Minion within Very Close range, then clear a HP
  // or a Stress."
  {
    adversaryId: "guahalan-alebrujo",
    feature: "Guahalan Sacrifice",
    uses: [
      action({
        costs: [fear()],
        targets: { side: "ally", range: "veryClose", count: { kind: "one" } },
        steps: [
          { kind: "defeat", to: "targets", note: "Devour a Minion" },
          {
            kind: "choose",
            id: "sacrifice",
            label: "Clear a HP or a Stress",
            options: [
              { id: "hp", label: "Clear a HP", steps: [{ kind: "clear", to: "self", track: "hp", amount: one }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] },
            ],
          },
        ],
      }),
    ],
  },
  // Howl of the Guahala - Action: "Mark a Stress to have the Alebrujo emit a howl. Each PC within Far range must succeed on
  // a Presence Reaction Roll or become temporarily Panicked. While Panicked, a PC must mark a Stress when they take the
  // spotlight."
  {
    adversaryId: "guahalan-alebrujo",
    feature: "Howl of the Guahala",
    uses: [
      action({
        costs: [stress()],
        targets: enemiesAround("far"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "presence",
            difficulty: OWN,
            onSuccess: [],
            onFail: [
              { kind: "condition", to: "targets", condition: tag("Panicked"), duration: "temporary" },
              { kind: "manual", to: "targets", text: "While Panicked, mark a Stress when taking the spotlight." },
            ],
          },
        ],
      }),
    ],
  },
  // Rip & Tear - Action: "Spend a Fear to make a standard attack with advantage. On a success, you can mark a Stress to make
  // another standard attack against an additional target within range. You can continue marking Stress to make additional
  // attacks until the Alebrujo fails an attack roll."
  // The first extra attack is automated (an optional Stress with its own roll); the chain after it is the GM's. Its damage
  // is the printed 2d10+4 magic written out plus The Beast Unleashed's Fear bonus (a second `standardAttack` would reuse
  // the first roll, bead dcm-vv2).
  {
    adversaryId: "guahalan-alebrujo",
    feature: "Rip & Tear",
    uses: [
      action({
        costs: [fear()],
        roll: ATTACK_ADV,
        targets: enemy("veryClose"),
        steps: [
          standardHit,
          {
            kind: "optional",
            id: "another",
            label: "Mark a Stress to attack an additional target",
            when: ["success"],
            costs: [stress()],
            steps: [
              {
                kind: "followUp",
                roll: ATTACK,
                targets: enemy("veryClose"),
                steps: [
                  hitDamage(dmg(2, 10, 4), "magic"),
                  { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: { kind: "gmFear" } }, note: "The Beast Unleashed" },
                ],
              },
              { kind: "manual", to: "self", text: "If that attack succeeded, you can keep marking Stress for more attacks against additional targets until one fails." },
            ],
          },
        ],
      }),
    ],
  },
  // Brutal Spectacle - Reaction: "When the Alebrujo deals Severe damage, you can spend a Fear to force all targets within
  // Close range to mark a Stress."
  {
    adversaryId: "guahalan-alebrujo",
    feature: "Brutal Spectacle",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDealDamage", minSeverity: "severe" } },
        needsSpotlight: false,
        costs: [fear()],
        steps: [{ kind: "markStress", to: "picked", pick: enemiesAround("close"), amount: one }],
      },
    ],
  },

  // ======================================================== Guahalan Fang Lord (HF p.76)
  // Pack Alpha - Passive: "Pool. When the Fang Lord makes a successful attack, add a token to the Guahalan Pool. When a
  // Guahalan ally within Close range makes an attack, you can spend a token from the Guahalan Pool to give them advantage
  // on the roll."
  {
    adversaryId: "guahalan-fang-lord",
    feature: "Pack Alpha",
    uses: [
      {
        id: "gain",
        activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
        needsSpotlight: false,
        steps: [{ kind: "tokens", to: "self", op: "add", amount: one, note: "A token to the Guahalan Pool" }],
      },
      {
        id: "spend",
        activation: { kind: "reaction", trigger: { kind: "situation", text: "A Guahalan ally within Close range makes an attack" } },
        needsSpotlight: false,
        requires: [{ kind: "tokens", atLeast: 1 }],
        steps: [
          { kind: "tokens", to: "self", op: "spend", amount: one },
          { kind: "modifyRoll", to: "picked", pick: { side: "ally", range: "close", count: { kind: "one" } }, change: { kind: "advantage" } },
        ],
      },
    ],
  },
  // Unleash the Beast - Action: "Spend a Fear to have the Fang Lord adopt a bestial form. While in this form, they gain a
  // bonus to attack and damage rolls equal to the number of Stress they have marked. Additionally, they can move up to Far
  // range instead of Close range before taking an action."
  unleashTheBeast("guahalan-fang-lord"),
  // Call of the Guahala - Action: "Spend 2 Fear to spotlight all Guahalan Shifters within Close range. Each one makes a
  // standard attack against a target within range. If any attacks succeed against the same target, combine their damage."
  {
    adversaryId: "guahalan-fang-lord",
    feature: "Call of the Guahala",
    uses: [
      action({
        costs: [fear(2)],
        steps: [
          { kind: "spotlight", who: "allies", name: "Guahalan Shifter", within: "close", note: "Each makes a standard attack; attacks that succeed against the same target combine their damage" },
        ],
      }),
    ],
  },
  // Feral Form (Phase Change) - Reaction: "When the Fang Lord marks their last HP, replace them with the Guahalan Alebrujo
  // and immediately spotlight them."
  {
    adversaryId: "guahalan-fang-lord",
    feature: "Feral Form (Phase Change)",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMarkHp", last: true } },
        needsSpotlight: false,
        steps: [
          { kind: "summon", label: "Guahalan Alebrujo (replaces the Fang Lord)", count: one, adversaryId: "guahalan-alebrujo" },
          { kind: "spotlight", who: "picked", note: "Spotlight the Guahalan Alebrujo" },
        ],
      },
    ],
  },

  // ======================================================== Guahalan Shifter (HF p.76)
  // Unleash the Beast - Action: "Spend a Fear to have the Shifter adopt a more bestial form. While in this form, they gain a
  // bonus to attack and damage rolls equal to the number of Stress they have marked. Additionally, they can move up to Far
  // range instead of Close range before taking an action."
  unleashTheBeast("guahalan-shifter"),
  // Pack Attack - Action: "Mark a Stress to make a standard attack. On a success, the attack gains a bonus to damage equal to
  // the number of other Shifters within Very Close range of the target."
  {
    adversaryId: "guahalan-shifter",
    feature: "Pack Attack",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: enemy("melee"),
        steps: [standardHit, { kind: "manual", to: "targets", when: ["hit"], text: "+1 damage for each other Guahalan Shifter within Very Close range of the target." }],
      }),
    ],
  },

  // ======================================================== Guahalan Spirit Beast (HF p.76)
  // Minion (5) - Passive: "The Spirit Beast is defeated when it takes any damage. For every 5 damage a PC deals to the
  // Spirit Beast, the PC defeats an additional Minion within range the attack would succeed against."
  minion("guahalan-spirit-beast", 5),
  // Ethereal Form - Passive: "The Spirit Beast has resistance to physical damage."
  { adversaryId: "guahalan-spirit-beast", feature: "Ethereal Form", uses: [resistance("physical")] },
  // Group Attack - Action: "... spotlight all Guahalan Spirit Beasts within Close range of them ... they deal 5 magic damage
  // each. Combine this damage."
  groupAttack("guahalan-spirit-beast", 5, "magic"),
  // Beast Bomb - Reaction: "When the Spirit Beast is defeated, it explodes in white flame and deals 5 magic damage to
  // creatures within Melee range."
  {
    adversaryId: "guahalan-spirit-beast",
    feature: "Beast Bomb",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDefeated" } },
        needsSpotlight: false,
        targets: { side: "any", range: "melee", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true },
        steps: [{ kind: "damage", to: "targets", roll: flat(5), type: "magic" }],
      },
    ],
  },

  // ======================================================== Guahalan Spirit Singer (HF p.77)
  // Unleash the Beast - Action: "Spend a Fear to have the Spirit Singer adopt a more bestial form. While in this form, they
  // gain a bonus to attack and damage rolls equal to the number of Stress they have marked. Additionally, they can move up
  // to Far range instead of Close range before taking an action."
  unleashTheBeast("guahalan-spirit-singer"),
  // Beast-Caller - Action: "Spend a Fear to have the Spirit Singer summon 2d4 Guahalan Spirit Beasts within Very Close
  // range and immediately spotlight one."
  {
    adversaryId: "guahalan-spirit-singer",
    feature: "Beast-Caller",
    uses: [
      action({
        costs: [fear()],
        steps: [
          { kind: "summon", label: "Guahalan Spirit Beasts", count: rolled(2, 4), adversaryId: "guahalan-spirit-beast", range: "veryClose" },
          { kind: "spotlight", who: "picked", count: one, note: "Spotlight one of the summoned Spirit Beasts" },
        ],
      }),
    ],
  },
  // Rage of Spirits - Action: "Mark a Stress to spotlight any number of Guahalan Spirit Beasts within Very Close range and
  // have each one move into Melee range with the nearest PC and make a standard attack. If any attacks succeed against the
  // same target, combine their damage."
  {
    adversaryId: "guahalan-spirit-singer",
    feature: "Rage of Spirits",
    uses: [
      action({
        costs: [stress()],
        steps: [
          {
            kind: "spotlight",
            who: "allies",
            name: "Guahalan Spirit Beast",
            within: "veryClose",
            note: "Each moves into Melee range of the nearest PC and makes a standard attack; hits on the same target combine their damage",
          },
        ],
      }),
    ],
  },
  // Spiritual Sacrifice - Reaction: "When the Spirit Singer would take damage while within Very Close range of a Guahalan
  // Spirit Beast, you can spend a Fear to sacrifice the Spirit Beast and negate the damage."
  {
    adversaryId: "guahalan-spirit-singer",
    feature: "Spiritual Sacrifice",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDamaged", stage: "would" } },
        needsSpotlight: false,
        requires: [{ kind: "allyWithin", range: "veryClose", of: "self", name: "Guahalan Spirit Beast" }],
        costs: [fear()],
        targets: { side: "ally", range: "veryClose", count: { kind: "one" } },
        steps: [
          { kind: "defeat", to: "targets", note: "Sacrifice the Spirit Beast" },
          { kind: "negate", to: "self", what: "damage" },
        ],
      },
    ],
  },

  // ======================================================== Hill Titan (HF p.77)
  // Relentless (3) - Passive: "The Titan can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // them."
  relentless("hill-titan", 3),
  // Gullible - Passive: "PCs have advantage on action rolls to trick or emotionally manipulate the Titan."
  {
    adversaryId: "hill-titan",
    feature: "Gullible",
    uses: [
      passive([{ kind: "mod", mod: { kind: "advantage", on: "action" }, to: "pcs" }], {
        requires: [{ kind: "situation", text: "A PC tries to trick or emotionally manipulate the Titan" }],
      }),
    ],
  },
  // Bug Swarm - Passive: "PCs are Vulnerable while within Very Close range."
  { adversaryId: "hill-titan", feature: "Bug Swarm", uses: [passive([{ kind: "conditionAura", condition: std("vulnerable"), to: "pcs", within: "veryClose" }])] },
  // Mighty Swing - Action: "Spend a Fear to make a standard attack against all targets within Very Close range."
  {
    adversaryId: "hill-titan",
    feature: "Mighty Swing",
    uses: [action({ costs: [fear()], roll: ATTACK, targets: enemiesAround("veryClose"), steps: [standardHit] })],
  },
  // Momentum - Reaction: "When the Titan makes a successful attack against a PC, you gain a Fear."
  momentum("hill-titan"),

  // ======================================================== Hive Walker (HF p.77)
  // Blood Honey - Action: "The Walker disgorges thick crimson honey at all targets between it and a point within Close range.
  // Each target in that line must succeed on an Agility Reaction Roll or take 2d8 magic damage and become temporarily
  // Restrained as the honey hardens on them."
  {
    adversaryId: "hive-walker",
    feature: "Blood Honey",
    uses: [
      action({
        targets: { side: "enemy", range: "close", count: { kind: "all" }, area: "line" },
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "agility",
            difficulty: OWN,
            onSuccess: [],
            onFail: [
              { kind: "damage", to: "targets", roll: dmg(2, 8), type: "magic" },
              { kind: "condition", to: "targets", condition: std("restrained"), duration: "temporary" },
            ],
          },
        ],
      }),
    ],
  },
  // Bee-Ruption - Reaction: "When the Walker marks HP, vengeful bees erupt from its body to protect it. Each target within
  // Very Close range must succeed on an Instinct Reaction Roll or take 1d8 direct physical damage for each HP the Hive
  // Walker has marked. Restrained targets automatically fail the reaction roll."
  {
    adversaryId: "hive-walker",
    feature: "Bee-Ruption",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMarkHp" } },
        needsSpotlight: false,
        targets: enemiesAround("veryClose"),
        steps: [
          { kind: "manual", to: "targets", when: [{ kind: "targetHas", condition: std("restrained") }], text: "Restrained targets automatically fail this reaction roll." },
          {
            kind: "save",
            to: "targets",
            trait: "instinct",
            difficulty: OWN,
            onSuccess: [],
            onFail: [{ kind: "damage", to: "targets", roll: dmg(1, 8), type: "physical", direct: true, repeat: { kind: "marked", who: "self", track: "hp" } }],
          },
        ],
      },
    ],
  },

  // ======================================================== Jack-o'-Lantern (HF p.77)
  // Minion (4) - Passive: "The Jack-o'-Lantern is defeated when it takes any damage. For every 4 damage a PC deals to the
  // Jack-o'-Lantern, the PC defeats an additional Minion within range the attack would succeed against."
  minion("jack-o-lantern", 4),
  // Group Attack - Action: "... spotlight all Jack-o'-Lanterns within Close range of them ... they deal 6 physical damage
  // each. Combine this damage."
  groupAttack("jack-o-lantern", 6, "physical"),
  // Spine-Chilling Cackle - Reaction: "When a PC within Very Close range rolls with Fear, you can mark a Stress to gain an
  // additional Fear."
  {
    adversaryId: "jack-o-lantern",
    feature: "Spine-Chilling Cackle",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "pcRolls", result: "withFear", within: "veryClose" } },
        needsSpotlight: false,
        costs: [stress()],
        steps: [gainFear()],
      },
    ],
  },

  // ======================================================== Landshark (HF p.78)
  // Burrowing - Passive: "The Landshark can move through the ground as easily as over it. When the Landshark moves, it can
  // choose to burrow or surface. While underground, the Landshark has resistance to all damage but can't attack."
  burrowing("landshark", "Burrowing", "resistant"),
  // Thick-Skinned - Passive: "When the Landshark would be forced to mark any number of HP, you can mark an equal number of
  // Stress instead."
  {
    adversaryId: "landshark",
    feature: "Thick-Skinned",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMarkHp", stage: "would" } },
        needsSpotlight: false,
        steps: [{ kind: "convertMarks", to: "self", from: "hp", into: "stress" }],
      },
    ],
  },
  // Rending Chomp - Reaction: "When the Landshark makes a successful attack against a PC within Melee range, you can spend a
  // Fear to force the target to mark an Armor Slot without receiving its benefits (they can still use armor to reduce the
  // damage)."
  {
    adversaryId: "landshark",
    feature: "Rending Chomp",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "any", within: "melee" } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SUBJECT,
        steps: [{ kind: "markArmor", to: "targets", amount: one, noBenefit: true }],
      },
    ],
  },

  // ======================================================== Landshark Behemoth (HF p.78)
  // Relentless (3) - Passive: "The Behemoth can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight it."
  relentless("landshark-behemoth", 3),
  // Deep Diver - Passive: "The Behemoth can move through the ground as easily as over it. When the Behemoth moves, it can
  // choose to burrow or surface. While underground, the Behemoth is immune to damage but can't attack."
  burrowing("landshark-behemoth", "Deep Diver", "immune"),
  // Steel-Skinned - Passive: "All damage dealt to the Behemoth is reduced by one threshold."
  {
    adversaryId: "landshark-behemoth",
    feature: "Steel-Skinned",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "onDamaged", stage: "would" } },
        needsSpotlight: false,
        steps: [{ kind: "reduceSeverity", to: "self", steps: 1 }],
      },
    ],
  },
  // Forceful Eruption - Action: "The Behemoth erupts from the ground, forcing each PC within Very Close range to succeed on
  // an Agility Reaction Roll or be knocked over, becoming Vulnerable until they make an action roll. For each PC made
  // Vulnerable in this way, you gain a Fear."
  {
    adversaryId: "landshark-behemoth",
    feature: "Forceful Eruption",
    uses: [
      action({
        targets: enemiesAround("veryClose"),
        steps: [
          { kind: "clearCondition", to: "self", condition: UNDERGROUND, note: "It erupts from the ground" },
          {
            kind: "save",
            to: "targets",
            trait: "agility",
            difficulty: OWN,
            onSuccess: [],
            onFail: [{ kind: "condition", to: "targets", condition: std("vulnerable"), duration: "nextRoll", note: "Knocked over" }, gainFear()],
          },
        ],
      }),
    ],
  },

  // ======================================================== Ravenous Mockery (HF p.78)
  // Tongue Attack - Action: "Mark a Stress to attack a creature within Close range. On a success, the target is pulled into
  // Melee range with the Mockery and Restrained until they escape with a successful Strength Roll, and you can spend a Fear
  // to activate the Mockery's Devour feature against the target."
  {
    adversaryId: "ravenous-mockery",
    feature: "Tongue Attack",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: { side: "any", range: "close", count: { kind: "one" }, excludeSelf: true },
        steps: [
          { kind: "move", to: "targets", when: ["hit"], mode: "pull", range: "melee", relativeTo: "self" },
          { kind: "condition", to: "targets", when: ["hit"], condition: std("restrained"), duration: "manual", endsWhen: "they escape with a successful Strength Roll" },
          {
            kind: "optional",
            id: "devour",
            label: "Spend a Fear to use Devour against the target",
            when: ["success"],
            costs: [fear()],
            steps: [
              {
                kind: "followUp",
                roll: ATTACK,
                targets: enemy("melee"),
                steps: [{ kind: "condition", to: "targets", when: ["hit"], condition: tag("Swallowed", ["restrained"]), duration: "manual", endsWhen: "the Mockery takes Major or Severe damage" }],
              },
            ],
          },
        ],
      }),
    ],
  },
  // Devour - Action: "Attack a target within Melee range. On a success, the Mockery Swallows the target. While Swallowed, the
  // target is Restrained and marks a HP when the Mockery is spotlighted. The Mockery disgorges all Swallowed creatures when
  // it takes Major or Severe damage."
  {
    adversaryId: "ravenous-mockery",
    feature: "Devour",
    uses: [
      action({
        roll: ATTACK,
        targets: enemy("melee"),
        steps: [{ kind: "condition", to: "targets", when: ["hit"], condition: tag("Swallowed", ["restrained"]), duration: "manual", endsWhen: "the Mockery takes Major or Severe damage" }],
      }),
      {
        id: "digest",
        activation: { kind: "auto", trigger: { kind: "onSpotlight" } },
        needsSpotlight: false,
        targets: { side: "enemy", range: "unlimited", count: { kind: "any" } },
        steps: [{ kind: "markHp", to: "targets", when: [{ kind: "targetHas", condition: tag("Swallowed") }], amount: one }],
      },
      {
        id: "disgorge",
        activation: { kind: "auto", trigger: { kind: "onDamaged", minSeverity: "major" } },
        needsSpotlight: false,
        targets: { side: "enemy", range: "unlimited", count: { kind: "any" } },
        steps: [
          { kind: "clearCondition", to: "targets", when: [{ kind: "targetHas", condition: tag("Swallowed") }], condition: std("restrained") },
          { kind: "clearCondition", to: "targets", condition: tag("Swallowed") },
        ],
      },
    ],
  },
  // Never Just One - Action: "Spend a Fear to reveal that another object on the battlefield has been a Ravenous Mockery the
  // whole time, then immediately spotlight it."
  {
    adversaryId: "ravenous-mockery",
    feature: "Never Just One",
    uses: [
      action({
        costs: [fear()],
        steps: [
          { kind: "summon", label: "Ravenous Mockery (an object on the battlefield)", count: one, adversaryId: "ravenous-mockery" },
          { kind: "spotlight", who: "picked", note: "Spotlight the new Ravenous Mockery" },
        ],
      }),
    ],
  },

  // ======================================================== Rust Eater (HF p.78)
  // Stifling Pheromones - Passive: "A PC who makes an action roll within Very Close range of the Rust Eater must succeed on
  // an Instinct Reaction Roll or mark a Stress."
  {
    adversaryId: "rust-eater",
    feature: "Stifling Pheromones",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "action", within: "veryClose" } },
        needsSpotlight: false,
        targets: SUBJECT,
        steps: [{ kind: "save", to: "targets", trait: "instinct", difficulty: OWN, onSuccess: [], onFail: [{ kind: "markStress", to: "targets", amount: one }] }],
      },
    ],
  },
  // Rust Touch - Passive: "The Rust Eater's carapace is coated in a corrosive acid that pits and rusts metal. When a PC
  // within Melee range of the Rust Easter succeeds on an attack against it with a metal weapon, reduce the weapon's damage
  // die by one step (for example, d8 to d6 or d6 to d4). If a weapon's damage die is reduced below a d4, the weapon
  // crumbles into rust. The Rust Eater then devours the rust pile and clears a HP."
  {
    adversaryId: "rust-eater",
    feature: "Rust Touch",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "onAttacked", stage: "succeeded", attackerWithin: "melee", weapon: true } },
        needsSpotlight: false,
        targets: SOURCE,
        steps: [
          {
            kind: "manual",
            to: "targets",
            text: "If the weapon is metal, its damage die drops one step (d8 to d6, d6 to d4); below a d4 it crumbles into rust.",
          },
          {
            kind: "optional",
            id: "devour-rust",
            label: "The weapon crumbled: the Rust Eater devours the rust and clears a HP",
            steps: [{ kind: "clear", to: "self", track: "hp", amount: one }],
          },
        ],
      },
    ],
  },

  // ======================================================== Scarecrow (HF p.79)
  // Made of Straw - Passive: "The Scarecrow has resistance to physical damage but takes double damage from fire."
  {
    adversaryId: "scarecrow",
    feature: "Made of Straw",
    uses: [
      resistance("physical"),
      {
        id: "fire",
        activation: { kind: "auto", trigger: { kind: "onDamaged", stage: "would" } },
        needsSpotlight: false,
        steps: [{ kind: "manual", to: "self", text: "If the damage is fire, the Scarecrow takes double damage." }],
      },
    ],
  },
  // Terror Vision - Action: "Spend a Fear to have the Scarecrow lock eyes with a PC within Very Close range, dealing 2d8
  // magic damage and making them Vulnerable until they roll with Hope."
  {
    adversaryId: "scarecrow",
    feature: "Terror Vision",
    uses: [
      action({
        costs: [fear()],
        targets: enemy("veryClose"),
        steps: [
          { kind: "damage", to: "targets", roll: dmg(2, 8), type: "magic" },
          { kind: "condition", to: "targets", condition: std("vulnerable"), duration: "manual", endsWhen: "they roll with Hope" },
        ],
      }),
    ],
  },

  // ======================================================== Sprite (HF p.79)
  // Minion (5) - Passive: "The Sprite is defeated when they take any damage. For every 5 damage a PC deals to the Sprite,
  // the PC defeats an additional Minion within range the attack would succeed against."
  minion("sprite", 5),
  // Art of Invisibility - Action: "Spend a Fear to make the Sprite Hidden until they attack."
  {
    adversaryId: "sprite",
    feature: "Art of Invisibility",
    uses: [action({ costs: [fear()], steps: [{ kind: "condition", to: "self", condition: std("hidden"), duration: "manual", endsWhen: "they attack" }] })],
  },
  // Dream Petal Poison - Action: "When the Sprite succeeds on a standard attack, you can spend a Fear to make the target
  // Sleepy until the target takes damage. While Sleepy, the target must make a Presence Reaction Roll before they make an
  // action roll. On a failure, they must mark 2 Stress or fall asleep until they take damage."
  // Printed as an action but triggered by the hit (like Grapple).
  {
    adversaryId: "sprite",
    feature: "Dream Petal Poison",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SUBJECT,
        steps: [
          { kind: "condition", to: "targets", condition: tag("Sleepy"), duration: "manual", endsWhen: "they take damage" },
          { kind: "manual", to: "targets", text: "While Sleepy, make a Presence Reaction Roll before each action roll; on a failure, mark 2 Stress or fall asleep until taking damage." },
        ],
      },
    ],
  },

  // ======================================================== Stone Titan (HF p.79)
  // Relentless (3) - Passive: "The Titan can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // them."
  relentless("stone-titan", 3),
  // Skillful Strike - Passive: "Before the Titan makes an attack, you can mark a Stress and roll a d6. On a result of 3 or
  // higher, the target's Evasion is halved against this attack."
  {
    adversaryId: "stone-titan",
    feature: "Skillful Strike",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "before", attack: "any" } },
        needsSpotlight: false,
        costs: [stress()],
        steps: [
          {
            kind: "check",
            dice: diceExpr(1, 6),
            test: { kind: "totalAtLeast", value: 3 },
            then: [{ kind: "manual", to: "self", text: "The target's Evasion is halved against this attack." }],
            otherwise: [],
          },
        ],
      },
    ],
  },
  // Sunlight Sickness - Passive: "When the Titan first appears above ground, roll a d4. Mark a number of Stress equal to the
  // result. The Titan gains a bonus to their attack and damage rolls equal to the number of Stress marked."
  // A prompt when it appears, so the GM says whether it is above ground; the bonus is an instance effect for the scene.
  {
    adversaryId: "stone-titan",
    feature: "Sunlight Sickness",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "timing", at: "appears" } },
        needsSpotlight: false,
        steps: [
          { kind: "markStress", to: "self", amount: rolled(1, 4) },
          {
            kind: "effect",
            to: "self",
            label: "Sunlight Sickness",
            mods: [
              { kind: "stat", stat: "attack", delta: { kind: "markedThisMove", who: "self", track: "stress" } },
              { kind: "stat", stat: "damage", delta: { kind: "markedThisMove", who: "self", track: "stress" } },
            ],
            duration: "scene",
          },
        ],
      },
    ],
  },
  // Hammer Smash - Action: "When a PC marks HP from the Titan's standard attack, you can spend a Fear to force the target to
  // mark an Armor Slot without gaining its benefits (they can still use armor to reduce the damage)."
  // Printed as an action but triggered (like Grapple).
  {
    adversaryId: "stone-titan",
    feature: "Hammer Smash",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onTargetMarksHp", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SUBJECT,
        steps: [{ kind: "markArmor", to: "targets", amount: one, noBenefit: true }],
      },
    ],
  },

  // ======================================================== Triceratops (HF p.79)
  // Leathery Hide - Passive: "When the Triceratops would be forced to mark HP, you can mark any number of Stress instead of
  // an equal number of HP."
  {
    adversaryId: "triceratops",
    feature: "Leathery Hide",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onMarkHp", stage: "would" } },
        needsSpotlight: false,
        steps: [{ kind: "convertMarks", to: "self", from: "hp", into: "stress", note: "Any number of the HP, one Stress each" }],
      },
    ],
  },
  // Tail Swipe - Action: "Mark a Stress to choose up to three targets within Very Close range. Each target must make an
  // Agility Reaction Roll. Targets who fail take 5d6 physical damage. Targets who succeed take half damage."
  {
    adversaryId: "triceratops",
    feature: "Tail Swipe",
    uses: [
      action({
        costs: [stress()],
        targets: { side: "enemy", range: "veryClose", count: { kind: "upTo", n: fixed(3) } },
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "agility",
            difficulty: OWN,
            onFail: [{ kind: "damage", to: "targets", roll: dmg(5, 6), type: "physical" }],
            onSuccess: [{ kind: "damage", to: "targets", roll: dmg(5, 6), type: "physical", scale: "half" }],
          },
        ],
      }),
    ],
  },
  // Bull Rush - Action: "Mark a Stress to choose a target within Close range. The Triceratops moves into Melee range with
  // the target and makes an attack. On a success, deal 3d10 direct physical damage."
  {
    adversaryId: "triceratops",
    feature: "Bull Rush",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: enemy("close"),
        steps: [
          { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target" },
          hitDamage(dmg(3, 10), "physical", true),
        ],
      }),
    ],
  },

  // ======================================================== Tyrannosaurus (HF p.80)
  // Earth-Shaking Roar - Action: "Spend a Fear to force each PC within Close range to make a Presence Reaction Roll. On a
  // failure, they must choose to lose a Hope or mark 1d4 Stress."
  {
    adversaryId: "tyrannosaurus",
    feature: "Earth-Shaking Roar",
    uses: [
      action({
        costs: [fear()],
        targets: enemiesAround("close"),
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "presence",
            difficulty: OWN,
            onSuccess: [],
            onFail: [
              {
                kind: "choose",
                id: "roar",
                label: "Lose a Hope or mark 1d4 Stress",
                options: [
                  { id: "hope", label: "Lose a Hope", steps: [{ kind: "hope", to: "targets", change: "lose", amount: one }] },
                  { id: "stress", label: "Mark 1d4 Stress", steps: [{ kind: "markStress", to: "targets", amount: rolled(1, 4) }] },
                ],
              },
            ],
          },
        ],
      }),
    ],
  },
  // Stomp - Action: "Mark a Stress to attack a target within Melee range. On a success, the target takes 3d12 direct
  // physical damage."
  {
    adversaryId: "tyrannosaurus",
    feature: "Stomp",
    uses: [action({ costs: [stress()], roll: ATTACK, targets: enemy("melee"), steps: [hitDamage(dmg(3, 12), "physical", true)] })],
  },
  // Crushing Bite - Reaction: "When the Tyrannosaurus makes a successful standard attack, you can spend a Fear to force the
  // target to mark an additional HP."
  {
    adversaryId: "tyrannosaurus",
    feature: "Crushing Bite",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard" } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SUBJECT,
        steps: [{ kind: "markHp", to: "targets", amount: one }],
      },
    ],
  },

  // ======================================================== Urco (HF p.80)
  // Fearmonger - Passive: "When a PC within Very Close range fails with Hope, you gain a Fear."
  // The trigger vocabulary has no "failure with Hope"; it fires on any failure and the GM confirms it was with Hope.
  {
    adversaryId: "urco",
    feature: "Fearmonger",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "pcRolls", roll: "action", result: "failure", within: "veryClose" } },
        needsSpotlight: false,
        steps: [gainFear(one, { note: "Only when the failure was with Hope" })],
      },
    ],
  },
  // Terror-Fueled - Passive: "The Urco gains a bonus to attack and damage rolls equal to the number of Fear you have."
  {
    adversaryId: "urco",
    feature: "Terror-Fueled",
    uses: [
      passive([
        { kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "gmFear" } } },
        { kind: "attackDamage", add: { kind: "gmFear" } },
      ]),
    ],
  },
  // Fear Eater - Action: "Spend any number of Fear to clear the same number of Stress. If the Urco has no marked Stress, you
  // can spend any number of Fear to clear the same number of HP."
  // "Any number" is a choice up to its 3 Stress / 4 HP; picking the option is the GM's tap (Q19).
  {
    adversaryId: "urco",
    feature: "Fear Eater",
    uses: [
      action({
        steps: [
          {
            kind: "choose",
            id: "eat",
            label: "Spend how many Fear?",
            options: [
              ...[1, 2, 3].map((n): AdversaryChooseOption => ({
                id: `stress-${n}`,
                label: `${n} Fear: clear ${n} Stress`,
                steps: [
                  { kind: "pay", costs: [fear(n)] },
                  { kind: "clear", to: "self", track: "stress", amount: fixed(n) },
                ],
              })),
              ...[1, 2, 3, 4].map((n): AdversaryChooseOption => {
                const noStress: readonly Gate[] = [{ kind: "requires", requirement: { kind: "trackMarked", track: "stress", atMost: 0 } }];
                return {
                  id: `hp-${n}`,
                  label: `${n} Fear: clear ${n} HP (no Stress marked)`,
                  steps: [
                    { kind: "pay", costs: [fear(n)], when: noStress },
                    { kind: "clear", to: "self", track: "hp", amount: fixed(n), when: noStress },
                  ],
                };
              }),
            ],
          },
        ],
      }),
    ],
  },
  // Baleful Gaze - Reaction: "When the Urco takes damage from an attack, you can spend a Fear to cause the attacker's damage
  // thresholds to gain a −1 penalty until the end of the scene. This effect can stack."
  {
    adversaryId: "urco",
    feature: "Baleful Gaze",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDamaged", fromAttack: true } },
        needsSpotlight: false,
        costs: [fear()],
        targets: SOURCE,
        steps: [
          {
            kind: "effect",
            to: "targets",
            label: "Baleful Gaze",
            mods: [
              { kind: "stat", stat: "majorThreshold", delta: fixed(-1) },
              { kind: "stat", stat: "severeThreshold", delta: fixed(-1) },
            ],
            duration: "scene",
            note: "Stacks",
          },
        ],
      },
    ],
  },

  // ======================================================== Valdenhax (HF p.80)
  // To Me, My Pretties - Action: "Once per scene, summon 2d4 Tier 2 Hordes, which appear at Far range. You gain a Fear for
  // each Horde summoned in this way."
  // The 2d4 is rolled once (`check`, always passing) so the Fear and the summon read the same number.
  {
    adversaryId: "valdenhax",
    feature: "To Me, My Pretties",
    uses: [
      action({
        limit: { per: "scene" },
        steps: [
          {
            kind: "check",
            dice: diceExpr(2, 4),
            test: { kind: "totalAtLeast", value: 2 },
            then: [gainFear({ kind: "lastRoll" })],
            otherwise: [],
          },
          { kind: "summon", label: "Tier 2 Hordes", count: { kind: "lastRoll" }, range: "far", note: "As many as the 2d4 rolled above" },
        ],
      }),
    ],
  },
  // Shadow Strangler - Action: "Mark a Stress to attack a target within Far range. On a success, the shadow of the
  // Valdenhax's hand stretches across the ground until it grasps the target's shadow and drains their essence. The target
  // marks 1d4 Stress, and you gain an equal number of Fear."
  {
    adversaryId: "valdenhax",
    feature: "Shadow Strangler",
    uses: [
      action({
        costs: [stress()],
        roll: ATTACK,
        targets: enemy("far"),
        steps: [
          { kind: "markStress", to: "targets", when: ["hit"], amount: rolled(1, 4) },
          gainFear({ kind: "lastRoll" }, { when: ["hit"], note: "As many as the Stress dice rolled" }),
        ],
      }),
    ],
  },
  // Corpse Whisperer - Action: "Spend a Fear to have the Valdenhax call out to the lingering spirit of a fallen ally within
  // Close range. Roll a d6. On an even result, the Valdenhax resurrects the ally with half its HP cleared. On an odd result,
  // the Valdenhax absorbs the dregs of its life force and clears a Stress."
  // The vocabulary has no even / odd test: the GM picks the option the d6 showed.
  {
    adversaryId: "valdenhax",
    feature: "Corpse Whisperer",
    uses: [
      action({
        costs: [fear()],
        targets: { side: "ally", range: "close", count: { kind: "one" } },
        steps: [
          {
            kind: "choose",
            id: "d6",
            label: "Roll a d6: even or odd?",
            options: [
              {
                id: "even",
                label: "Even: resurrect the ally",
                steps: [
                  {
                    kind: "clear",
                    to: "targets",
                    track: "hp",
                    amount: { kind: "calc", of: { kind: "marked", who: "target", track: "hp" }, divide: 2, round: "down" },
                    note: "Half its HP cleared",
                  },
                  { kind: "manual", to: "targets", text: "The ally is resurrected (no longer defeated)." },
                ],
              },
              { id: "odd", label: "Odd: clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] },
            ],
          },
        ],
      }),
    ],
  },
  // Vexing Word - Reaction: "After a PC makes a roll, you can mark a Stress to force them to reroll it. This feature can't
  // be used if the PC critically succeeds."
  {
    adversaryId: "valdenhax",
    feature: "Vexing Word",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "pcRolls" } },
        needsSpotlight: false,
        costs: [stress()],
        targets: SUBJECT,
        steps: [{ kind: "modifyRoll", to: "targets", change: { kind: "reroll", dice: "all" }, note: "Not on a critical success" }],
      },
    ],
  },
];
