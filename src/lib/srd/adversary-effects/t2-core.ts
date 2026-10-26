// Adversary feature effects of tier 2 Core Book adversaries (plan combat-actions, tracer AE-t2-core). Pure data: no
// framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 36
// adversaries, 108 features (CB p.220-227). Each entry quotes its feature text (as in ../adversaries.ts); what the
// vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express is a `manual` step, never a vocabulary change.
// Readings, manual steps and their reasons: docs/tasks/TASK-CA-AE-t2-core.md.
//
// Conventions (rules AR1-AR11 of the plan, CB = Core Book printed pages):
// - Actions need the spotlight; passives and reactions don't (CB p.194). A passive's "Mark a Stress to move …" happens
//   when the adversary is spotlighted (CB p.153: a spotlighted adversary moves, then acts), so that use needs it.
// - "Mark a Stress" is a `stress` cost on the adversary, "Spend a Fear" a `fear` cost asked first (CB p.194, Q19).
// - "Make an attack" is `adversaryAttack` against Evasion; the runner adds the stat block's ATK (AR1). One roll for
//   every target (AR7, CB p.161). A reaction roll without a number uses the adversary's Difficulty (CB p.193).
// - "Momentum" and the riders of passives ("Targets who mark HP from …") are `auto`; printed reactions with a choice
//   ("you can") are `reaction` (a one-tap prompt defaulting to No, Q19).
// - Damage to PCs comes back as incoming hits for the reaction window (Q13); PC reaction rolls are prompts (AR11).

import type {
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryRequirement,
  AdversaryStep,
} from "../../domain/adversary-effects/types";
import type {
  ConditionRef,
  DamageRoll,
  DieSides,
  NumberSource,
  Range,
  RollSpec,
  TargetSpec,
} from "../../domain/card-effects/types";

// ---------------------------------------------------------------- building blocks

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const one = fixed(1);
const diceOf = (count: number, sides: DieSides, plus?: number): NumberSource => ({
  kind: "dice",
  dice: { count: fixed(count), sides, ...(plus ? { plus: fixed(plus) } : {}) },
});
const roll = (count: number, sides: DieSides, plus?: number): DamageRoll => ({
  kind: "dice",
  dice: { count: fixed(count), sides, ...(plus ? { plus: fixed(plus) } : {}) },
});
const flat = (amount: number): DamageRoll => ({ kind: "flat", amount: fixed(amount) });

/** d20 + ATK against each target's Evasion (AR1); the runner adds the stat block's Attack Modifier. */
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };
const ATTACK_WITH_ADVANTAGE: RollSpec = { ...ATTACK, advantage: true };
/** A reaction roll with no printed number uses the adversary's Difficulty (CB p.193). */
const OWN_DIFFICULTY = { kind: "actorDifficulty" } as const;

const STRESS = [{ kind: "stress", amount: one }] as const;
const FEAR = [{ kind: "fear", amount: one }] as const;
const TWO_FEAR = [{ kind: "fear", amount: fixed(2) }] as const;

const oneEnemy = (range: Range | "unlimited"): TargetSpec => ({ side: "enemy", range, count: { kind: "one" } });
const allAround = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "aroundSelf" });
const allAroundPoint = (range: Range | "unlimited", areaRange: Range): TargetSpec => ({
  side: "enemy",
  range,
  count: { kind: "all" },
  area: "aroundPoint",
  areaRange,
});
const TRIGGER_SUBJECT = { side: "trigger", who: "subject" } as const;
const TRIGGER_SOURCE = { side: "trigger", who: "source" } as const;

const VULNERABLE: ConditionRef = { kind: "standard", condition: "vulnerable" };
const RESTRAINED: ConditionRef = { kind: "standard", condition: "restrained" };
const HIDDEN: ConditionRef = { kind: "standard", condition: "hidden" };

const hit = ["hit"] as const;

/** One use with the given parts (id "main" unless named). */
const featureUse = (u: Omit<AdversaryFeatureUse, "id"> & { id?: string }): AdversaryFeatureUse => ({ id: "main", ...u });
const entry = (adversaryId: string, feature: string, ...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({
  adversaryId,
  feature,
  uses,
});
const passive = (u: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight" | "steps"> & { id?: string; steps?: readonly AdversaryStep[] }) =>
  featureUse({ activation: { kind: "passive" }, needsSpotlight: false, steps: [], ...u });
const action = (u: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string; needsSpotlight?: boolean }) =>
  featureUse({ activation: { kind: "action" }, needsSpotlight: true, ...u });

// ---------------------------------------------------------------- shared features

/** "Minion (X): The X is defeated when they take any damage. For every X damage a PC deals …" (CB p.201). */
const minion = (adversaryId: string, x: number) =>
  entry(adversaryId, `Minion (${x})`, passive({ modifiers: [{ kind: "minion", threshold: x }] }));

/**
 * "Group Attack: Spend a Fear to choose a target and spotlight all <name>s within Close range of them. Those Minions move
 * into Melee range of the target and make one shared attack roll. On a success, they deal X physical damage each.
 * Combine this damage." (AR9, CB p.201): one shared roll, X per Minion combined by the runner (`groupAttack`).
 */
const groupAttack = (adversaryId: string, x: number) =>
  entry(
    adversaryId,
    "Group Attack",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: oneEnemy("unlimited"),
      groupAttack: { within: "close" },
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "The Minions move into Melee range of the target" },
        { kind: "damage", to: "targets", when: hit, roll: flat(x), type: "physical" },
      ],
    }),
  );

/** "Momentum: When the X makes a successful attack against a PC, you gain a Fear." (CB p.195): automatic (Q19). */
const momentum = (adversaryId: string) =>
  entry(
    adversaryId,
    "Momentum",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      steps: [{ kind: "fear", to: "self", change: "gain", amount: one }],
    }),
  );

/** "Relentless (X): The X can be spotlighted up to X times per GM turn. Spend Fear as usual to spotlight them." */
const relentless = (adversaryId: string, x: number) =>
  entry(adversaryId, `Relentless (${x})`, passive({ modifiers: [{ kind: "relentless", times: x }] }));

/** "Horde (X): When the Horde has marked half or more of their HP, their standard attack deals X physical damage instead." (CB p.199). */
const horde = (adversaryId: string, count: number, sides: DieSides, plus: number) =>
  entry(
    adversaryId,
    `Horde (${count}d${sides}+${plus})`,
    passive({ modifiers: [{ kind: "horde", damage: { kind: "dice", dice: { count: fixed(count), sides, plus: fixed(plus) } } }] }),
  );

/**
 * "Ghost: The X has resistance to physical damage. Mark a Stress to move up to Close range through solid objects."
 * Two uses: the resistance (passive) and the move (on its spotlight, a movement prompt).
 */
const ghost = (adversaryId: string) =>
  entry(
    adversaryId,
    "Ghost",
    passive({ id: "resistance", modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }] }),
    action({
      id: "phase",
      costs: STRESS,
      steps: [{ kind: "move", to: "self", mode: "move", range: "close", note: "Move up to Close range through solid objects" }],
    }),
  );

/**
 * "Terrifying: When the X makes a successful attack, all PCs within Far range lose a Hope and you gain a Fear."
 * Automatic on a hit; the PCs within Far range are the step's `picked` creatures (with no map: the party, Q18).
 */
const terrifying = (adversaryId: string) =>
  entry(
    adversaryId,
    "Terrifying",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      steps: [
        { kind: "hope", to: "picked", pick: allAround("far"), change: "lose", amount: one },
        { kind: "fear", to: "self", change: "gain", amount: one },
      ],
    }),
  );

/**
 * "Mark a Stress (or spend Fear) to spotlight N allies. Attacks they make while spotlighted in this way deal half damage."
 * The spotlit allies (the GM picks them, `allies`) carry a half-damage effect while spotlit this way (Blighting Strike's flag).
 */
const spotlightAlliesAtHalfDamage = (count: NumberSource): AdversaryStep[] => [
  { kind: "spotlight", who: "allies", count },
  {
    kind: "effect",
    to: "allies",
    label: "Half damage while spotlighted this way",
    mods: [{ kind: "flag", flag: "halfDamage" }],
    duration: "manual",
    endsWhen: "the spotlight moves on",
  },
];

const FLYING: AdversaryRequirement = { kind: "situation", text: "While flying" };
const MOUNTED: AdversaryRequirement = { kind: "situation", text: "While the Knight is on a mount" };

// ---------------------------------------------------------------- the table

export const T2_CORE_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ---- Apprentice Assassin (Minion, CB p.220)
  // "Minion (6): The Assassin is defeated when they take any damage. For every 6 damage a PC deals to the Assassin,
  // defeat an additional Minion within range the attack would succeed against."
  minion("apprentice-assassin", 6),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Apprentice Assassins within Close range of them. …
  // On a success, they deal 4 physical damage each. Combine this damage."
  groupAttack("apprentice-assassin", 4),

  // ---- Archer Squadron (Horde, CB p.220)
  // "Horde (1d6+3): When the Squadron has marked half or more of their HP, their standard attack deals 1d6+3 physical
  // damage instead."
  horde("archer-squadron", 1, 6, 3),
  // "Focused Volley: Spend a Fear to target a point within Far range. Make an attack with advantage against all targets
  // within Close range of that point. Targets the Squadron succeeds against take 1d10+4 physical damage."
  entry(
    "archer-squadron",
    "Focused Volley",
    action({
      costs: FEAR,
      roll: ATTACK_WITH_ADVANTAGE,
      targets: allAroundPoint("far", "close"),
      steps: [{ kind: "damage", to: "targets", when: hit, roll: roll(1, 10, 4), type: "physical" }],
    }),
  ),
  // "Suppressing Fire: Mark a Stress to target a point within Far range. Until the next roll with Fear, a creature who
  // moves within Close range of that point must make an Agility Reaction Roll. On a failure, they take 2d6+3 physical
  // damage. On a success, they take half damage."
  // Manual: a lasting zone that triggers on movement (vocabulary gap).
  entry(
    "archer-squadron",
    "Suppressing Fire",
    action({
      costs: STRESS,
      targets: { side: "point", range: "far", count: { kind: "one" } },
      steps: [
        {
          kind: "manual",
          to: "self",
          text: "Until the next roll with Fear, a creature who moves within Close range of that point makes an Agility Reaction Roll: on a failure 2d6+3 physical damage, on a success half damage.",
        },
      ],
    }),
  ),

  // ---- Assassin Poisoner (Skulk, CB p.220)
  // "Grindletooth Venom: Targets who mark HP from the Assassin's attacks are Vulnerable until they clear a HP."
  entry(
    "assassin-poisoner",
    "Grindletooth Venom",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onTargetMarksHp", attack: "any" } },
      needsSpotlight: false,
      targets: TRIGGER_SUBJECT,
      steps: [{ kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "they clear a HP" }],
    }),
  ),
  // "Out of Nowhere: The Assassin has advantage on attacks if they are Hidden."
  entry(
    "assassin-poisoner",
    "Out of Nowhere",
    passive({ requires: [{ kind: "hasCondition", condition: HIDDEN }], modifiers: [{ kind: "mod", mod: { kind: "advantage", on: "attack" } }] }),
  ),
  // "Fumigation: Drop a smoke bomb that fills the air within Close range with smoke, Dizzying all targets in this area.
  // Dizzied targets have disadvantage on their next action roll, then clear the condition."
  // Manual: the disadvantage on the bearer's own roll (vocabulary gap); the Dizzied tag ends with that roll.
  entry(
    "assassin-poisoner",
    "Fumigation",
    action({
      targets: allAround("close"),
      steps: [
        { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Dizzied" }, duration: "nextRoll" },
        { kind: "manual", to: "targets", text: "Dizzied: disadvantage on their next action roll, then the condition clears." },
      ],
    }),
  ),

  // ---- Battle Box (Solo, CB p.221)
  // "Relentless (2): The Box can be spotlighted up to two times per GM turn. Spend Fear as usual to spotlight them."
  relentless("battle-box", 2),
  // "Randomized Tactics: Mark a Stress and roll a d6. The Box uses the corresponding move: 1. Mana Beam … 2. Fire Jets …
  // 3. Trample … 4. Shocking Gas … 5. Stunning Clap … 6. Psionic Whine …" (full texts on each branch below).
  // The d6 is a `check`; each later branch reads the same result (0 dice + the last roll). The move's creatures are the
  // `followUp` targets the GM picks (Q18). A branch's own attack roll is not the use's main roll, so it carries the
  // Box's ATK (+2) itself.
  entry(
    "battle-box",
    "Randomized Tactics",
    action({
      costs: STRESS,
      steps: [
        {
          kind: "check",
          note: "Roll a d6",
          dice: { count: one, sides: 6 },
          test: { kind: "totalAtMost", value: 1 },
          // "1. Mana Beam. The Box fires a searing beam. Make an attack against a target within Far range. On a success,
          // deal 2d10+2 magic damage."
          then: [
            {
              kind: "followUp",
              note: "1. Mana Beam",
              roll: { ...ATTACK, modifier: fixed(2) },
              targets: oneEnemy("far"),
              steps: [{ kind: "damage", to: "targets", when: hit, roll: roll(2, 10, 2), type: "magic" }],
            },
          ],
          otherwise: [
            {
              kind: "check",
              dice: { count: fixed(0), sides: 6, plus: { kind: "lastRoll" } },
              test: { kind: "totalAtMost", value: 2 },
              // "2. Fire Jets. … Make an attack against all targets within Close range. Targets the Box succeeds against
              // take 2d8 physical damage."
              then: [
                {
                  kind: "followUp",
                  note: "2. Fire Jets",
                  roll: { ...ATTACK, modifier: fixed(2) },
                  targets: allAround("close"),
                  steps: [{ kind: "damage", to: "targets", when: hit, roll: roll(2, 8), type: "physical" }],
                },
              ],
              otherwise: [
                {
                  kind: "check",
                  dice: { count: fixed(0), sides: 6, plus: { kind: "lastRoll" } },
                  test: { kind: "totalAtMost", value: 3 },
                  // "3. Trample. … Make an attack against all PCs within Close range. Targets the Box succeeds against
                  // take 1d6+5 physical damage and are Vulnerable until their next roll with Hope."
                  then: [
                    {
                      kind: "followUp",
                      note: "3. Trample",
                      roll: { ...ATTACK, modifier: fixed(2) },
                      targets: allAround("close"),
                      steps: [
                        { kind: "damage", to: "targets", when: hit, roll: roll(1, 6, 5), type: "physical" },
                        { kind: "condition", to: "targets", when: hit, condition: VULNERABLE, duration: "manual", endsWhen: "their next roll with Hope" },
                      ],
                    },
                  ],
                  otherwise: [
                    {
                      kind: "check",
                      dice: { count: fixed(0), sides: 6, plus: { kind: "lastRoll" } },
                      test: { kind: "totalAtMost", value: 4 },
                      // "4. Shocking Gas. … All targets within Close range must succeed on a Finesse Reaction Roll or
                      // mark 3 Stress."
                      then: [
                        {
                          kind: "followUp",
                          note: "4. Shocking Gas",
                          targets: allAround("close"),
                          steps: [{ kind: "save", to: "targets", trait: "finesse", difficulty: OWN_DIFFICULTY, onFail: [{ kind: "markStress", to: "targets", amount: fixed(3) }], onSuccess: [] }],
                        },
                      ],
                      otherwise: [
                        {
                          kind: "check",
                          dice: { count: fixed(0), sides: 6, plus: { kind: "lastRoll" } },
                          test: { kind: "totalAtMost", value: 5 },
                          // "5. Stunning Clap. … All targets within Very Close range must succeed on a Strength Reaction
                          // Roll or become Vulnerable until the cube is defeated."
                          then: [
                            {
                              kind: "followUp",
                              note: "5. Stunning Clap",
                              targets: allAround("veryClose"),
                              steps: [
                                {
                                  kind: "save",
                                  to: "targets",
                                  trait: "strength",
                                  difficulty: OWN_DIFFICULTY,
                                  onFail: [{ kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "the Battle Box is defeated" }],
                                  onSuccess: [],
                                },
                              ],
                            },
                          ],
                          // "6. Psionic Whine. … All targets within Close range must succeed on a Presence Reaction Roll
                          // or take 2d4+9 direct magic damage."
                          otherwise: [
                            {
                              kind: "followUp",
                              note: "6. Psionic Whine",
                              targets: allAround("close"),
                              steps: [
                                {
                                  kind: "save",
                                  to: "targets",
                                  trait: "presence",
                                  difficulty: OWN_DIFFICULTY,
                                  onFail: [{ kind: "damage", to: "targets", roll: roll(2, 4, 9), type: "magic", direct: true }],
                                  onSuccess: [],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  ),
  // "Overcharge: Before rolling damage for the Box's attack, you can mark a Stress to add a d6 to the damage roll.
  // Additionally, you gain a Fear."
  entry(
    "battle-box",
    "Overcharge",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "beforeDamage", attack: "any" } },
      needsSpotlight: false,
      costs: STRESS,
      steps: [
        { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: diceOf(1, 6) } },
        { kind: "fear", to: "self", change: "gain", amount: one },
      ],
    }),
  ),
  // "Death Quake: When the Box marks their last HP, the magic powering them ruptures in an explosion of force. All
  // targets within Close range must succeed on an Instinct Reaction Roll or take 2d8+1 magic damage."
  entry(
    "battle-box",
    "Death Quake",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", last: true } },
      needsSpotlight: false,
      targets: allAround("close"),
      steps: [{ kind: "save", to: "targets", trait: "instinct", difficulty: OWN_DIFFICULTY, onFail: [{ kind: "damage", to: "targets", roll: roll(2, 8, 1), type: "magic" }], onSuccess: [] }],
    }),
  ),

  // ---- Chaos Skull (Ranged, CB p.221)
  // "Levitation: The Skull levitates several feet off the ground and can't be Restrained."
  entry(
    "chaos-skull",
    "Levitation",
    passive({ modifiers: [{ kind: "mod", mod: { kind: "flag", flag: "flying" } }, { kind: "mod", mod: { kind: "flag", flag: "cannotBeRestrained" } }] }),
  ),
  // "Wards: The Skull is resistant to magic damage."
  entry("chaos-skull", "Wards", passive({ modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "magic", level: "resistant" } }] })),
  // "Magic Burst: Mark a Stress to make an attack against all targets within Close range. Targets the Skull succeeds
  // against take 2d6+4 magic damage."
  entry(
    "chaos-skull",
    "Magic Burst",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: allAround("close"),
      steps: [{ kind: "damage", to: "targets", when: hit, roll: roll(2, 6, 4), type: "magic" }],
    }),
  ),
  // "Siphon Magic: Spend a Fear to make an attack against a PC with a Spellcast trait within Very Close range. On a
  // success, the target marks 1d4 Stress and the Skull clears that many Stress. Additionally, on a success, the Skull
  // can immediately be spotlighted again."
  // Reading: "that many" is the 1d4 rolled; the GM picks a PC with a Spellcast trait.
  entry(
    "chaos-skull",
    "Siphon Magic",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "markStress", to: "targets", when: hit, amount: diceOf(1, 4) },
        { kind: "clear", to: "self", when: hit, track: "stress", amount: { kind: "lastRoll" } },
        { kind: "spotlight", who: "self", when: hit, note: "The Skull can immediately be spotlighted again" },
      ],
    }),
  ),

  // ---- Conscript (Minion, CB p.221)
  // "Minion (6): The Conscript is defeated when they take any damage. For every 6 damage …"
  minion("conscript", 6),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Conscripts within Close range of them. … they deal
  // 6 physical damage each. Combine this damage."
  groupAttack("conscript", 6),

  // ---- Courtesan (Social, CB p.221)
  // "Searing Glance: When a PC within Close range makes a Presence Roll, you can mark a Stress to cast a gaze toward the
  // aftermath. On the target's failure, they must mark 2 Stress and are Vulnerable until the scene ends or they succeed
  // on a social action against the Courtesan. On the target's success, they must mark a Stress."
  // Two uses, one per result of the PC's roll, so the trigger picks the right one.
  entry(
    "courtesan",
    "Searing Glance",
    featureUse({
      id: "on-failure",
      activation: { kind: "reaction", trigger: { kind: "pcRolls", roll: "presence", result: "failure", within: "close" } },
      needsSpotlight: false,
      costs: STRESS,
      targets: TRIGGER_SUBJECT,
      steps: [
        { kind: "markStress", to: "targets", amount: fixed(2) },
        { kind: "condition", to: "targets", condition: VULNERABLE, duration: "scene", endsWhen: "or they succeed on a social action against the Courtesan" },
      ],
    }),
    featureUse({
      id: "on-success",
      activation: { kind: "reaction", trigger: { kind: "pcRolls", roll: "presence", result: "success", within: "close" } },
      needsSpotlight: false,
      costs: STRESS,
      targets: TRIGGER_SUBJECT,
      steps: [{ kind: "markStress", to: "targets", amount: one }],
    }),
  ),

  // ---- Cult Adept (Support, CB p.222)
  // "Enervating Blast: Spend a Fear to make a standard attack against a target within range. On a success, the target
  // must mark a Stress."
  entry(
    "cult-adept",
    "Enervating Blast",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: oneEnemy("far"),
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: { kind: "standardAttack" }, type: "weapon" },
        { kind: "markStress", to: "targets", when: hit, amount: one },
      ],
    }),
  ),
  // "Shroud of the Fallen: Mark a Stress to wrap an ally within Close range in a shroud of Protection until the Adept
  // marks their last HP. While Protected, the target has resistance to all damage."
  entry(
    "cult-adept",
    "Shroud of the Fallen",
    action({
      costs: STRESS,
      targets: { side: "ally", range: "close", count: { kind: "one" }, excludeSelf: true },
      steps: [
        {
          kind: "effect",
          to: "targets",
          label: "Protected",
          mods: [{ kind: "resistance", type: "both", level: "resistant" }],
          duration: "manual",
          endsWhen: "the Cult Adept marks their last HP",
        },
      ],
    }),
  ),
  // "Shadow Shackles: Spend a Fear and choose a point within Far range. All targets within Close range of that point are
  // Restrained in smoky chains until they break free with a successful Strength or Instinct Roll. A target Restrained by
  // this feature must spend a Hope to make an action roll."
  // Manual: the Hope to make an action roll (vocabulary gap).
  entry(
    "cult-adept",
    "Shadow Shackles",
    action({
      costs: FEAR,
      targets: allAroundPoint("far", "close"),
      steps: [
        { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "they break free with a successful Strength or Instinct Roll" },
        { kind: "manual", to: "targets", text: "While Restrained by Shadow Shackles, the target must spend a Hope to make an action roll." },
      ],
    }),
  ),
  // "Fear Is Fuel: Twice per scene, when a PC rolls a failure with Fear, clear a Stress."
  entry(
    "cult-adept",
    "Fear Is Fuel",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "pcRolls", result: "failureWithFear" } },
      needsSpotlight: false,
      limit: { per: "scene", times: 2 },
      steps: [{ kind: "clear", to: "self", track: "stress", amount: one }],
    }),
  ),

  // ---- Cult Fang (Skulk, CB p.222)
  // "Shadow's Embrace: The Fang can climb and walk on vertical surfaces. Mark a Stress to move from one shadow to another
  // within Far range."
  // Climbing has no rule effect; the shadow step is a movement prompt on its spotlight.
  entry(
    "cult-fang",
    "Shadow's Embrace",
    passive({ id: "climb", modifiers: [] }),
    action({
      id: "shadow-step",
      costs: STRESS,
      steps: [{ kind: "move", to: "self", mode: "teleport", range: "far", note: "Move from one shadow to another within Far range" }],
    }),
  ),
  // "Pick Off the Straggler: Mark a Stress to cause a target within Melee range to make an Instinct Reaction Roll. On a
  // failure, the target must mark 2 Stress and is teleported with the Fang to a shadow within Far range, making them
  // temporarily Vulnerable. On a success, the target must mark a Stress."
  entry(
    "cult-fang",
    "Pick Off the Straggler",
    action({
      costs: STRESS,
      targets: oneEnemy("melee"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "markStress", to: "targets", amount: fixed(2) },
            { kind: "move", to: "targets", mode: "teleport", range: "far", relativeTo: "self", note: "Teleported with the Fang to a shadow within Far range" },
            { kind: "condition", to: "targets", condition: VULNERABLE, duration: "temporary" },
          ],
          onSuccess: [{ kind: "markStress", to: "targets", amount: one }],
        },
      ],
    }),
  ),

  // ---- Cult Initiate (Minion, CB p.222)
  // "Minion (6): The Initiate is defeated when they take any damage. For every 6 damage …"
  minion("cult-initiate", 6),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Cult Initiates within Close range of them. … they
  // deal 5 physical damage each. Combine this damage."
  groupAttack("cult-initiate", 5),

  // ---- Demonic Hound Pack (Horde, CB p.222)
  // "Horde (2d4+1): When the Pack has marked half or more of their HP, their standard attack deals 2d4+1 physical damage
  // instead."
  horde("demonic-hound-pack", 2, 4, 1),
  // "Dreadhowl: Mark a Stress to make all targets within Very Close range lose a Hope. If a target is not able to lose a
  // Hope, they must instead mark 2 Stress."
  // Manual: the fallback for a PC with no Hope (vocabulary gap: no gate on a PC target's Hope).
  entry(
    "demonic-hound-pack",
    "Dreadhowl",
    action({
      costs: STRESS,
      targets: allAround("veryClose"),
      steps: [
        { kind: "hope", to: "targets", change: "lose", amount: one },
        { kind: "manual", to: "targets", text: "A target with no Hope to lose marks 2 Stress instead." },
      ],
    }),
  ),
  // "Momentum: When the Pack makes a successful attack against a PC, you gain a Fear."
  momentum("demonic-hound-pack"),

  // ---- Electric Eels (Horde, CB p.222)
  // "Horde (2d4+1): When the Eels have marked half or more of their HP, their standard attack deals 2d4+1 physical damage
  // instead."
  horde("electric-eels", 2, 4, 1),
  // "Paralyzing Shock: Mark a Stress to make a standard attack against all targets within Very Close range. You gain a
  // Fear for each target that marks HP."
  // Manual: the Fear per target who marks HP; HP is marked when each reaction window resolves (vocabulary gap).
  entry(
    "electric-eels",
    "Paralyzing Shock",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: { kind: "standardAttack" }, type: "weapon" },
        { kind: "manual", to: "self", when: hit, text: "Gain a Fear for each target that marks HP from this attack." },
      ],
    }),
  ),

  // ---- Elite Soldier (Standard, CB p.222)
  // "Reinforce: Mark a Stress to move into Melee range of an ally and make a standard attack against a target within Very
  // Close range. On a success, deal 2d10+2 physical damage and the ally can clear a Stress."
  entry(
    "elite-soldier",
    "Reinforce",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", note: "Move into Melee range of an ally" },
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 10, 2), type: "physical" },
        { kind: "clear", to: "picked", pick: { side: "ally", range: "melee", count: { kind: "one" }, excludeSelf: true }, when: hit, track: "stress", amount: one },
      ],
    }),
  ),
  // "Vassal's Loyalty: When the Soldier is within Very Close range of a knight or other noble who would take damage, you
  // can mark a Stress to move into Melee range of them and take the damage instead."
  entry(
    "elite-soldier",
    "Vassal's Loyalty",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "situation", text: "A knight or other noble within Very Close range would take damage" } },
      needsSpotlight: false,
      costs: STRESS,
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", note: "Move into Melee range of the noble" },
        { kind: "redirectDamage", to: "self", target: "self" },
      ],
    }),
  ),

  // ---- Failed Experiment (Standard, CB p.223)
  // "Warped Fortitude: The Experiment is resistant to physical damage."
  entry("failed-experiment", "Warped Fortitude", passive({ modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }] })),
  // "Overwhelm: When a target the Experiment attacks has other adversaries within Very Close range, the Experiment deals
  // double damage."
  // Automatic before its damage roll while another adversary is within Very Close range of the target.
  entry(
    "failed-experiment",
    "Overwhelm",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onAttack", stage: "beforeDamage", attack: "any" } },
      needsSpotlight: false,
      requires: [{ kind: "allyWithin", range: "veryClose", of: "target" }],
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "multiply", factor: 2 } }],
    }),
  ),
  // "Lurching Lunge: Mark a Stress to spotlight the Experiment as an additional GM move instead of spending Fear."
  // It is what spotlights the Experiment, so it doesn't need the spotlight.
  entry(
    "failed-experiment",
    "Lurching Lunge",
    action({ needsSpotlight: false, costs: STRESS, steps: [{ kind: "spotlight", who: "self", note: "An additional GM move instead of spending Fear" }] }),
  ),

  // ---- Giant Beastmaster (Leader, CB p.223)
  // "Two as One: When the Beastmaster is spotlighted, you can also spotlight a Tier 1 animal adversary currently under
  // their control."
  entry(
    "giant-beastmaster",
    "Two as One",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "onSpotlight" } },
      needsSpotlight: false,
      steps: [{ kind: "spotlight", who: "picked", count: one, note: "A Tier 1 animal adversary under the Beastmaster's control" }],
    }),
  ),
  // "Pinning Strike: Make a standard attack against a target. On a success, you can mark a Stress to pin them to a nearby
  // surface. The pinned target is Restrained until they break free with a successful Finesse or Strength Roll."
  entry(
    "giant-beastmaster",
    "Pinning Strike",
    action({
      roll: ATTACK,
      targets: oneEnemy("far"),
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: { kind: "standardAttack" }, type: "weapon" },
        {
          kind: "optional",
          id: "pin",
          label: "Mark a Stress to pin them",
          when: hit,
          costs: STRESS,
          steps: [{ kind: "condition", to: "targets", when: hit, condition: RESTRAINED, duration: "manual", endsWhen: "they break free with a successful Finesse or Strength Roll" }],
        },
      ],
    }),
  ),
  // "Deadly Companion: Twice per scene, summon a Bear, Dire Wolf, or similar Tier 1 animal adversary under the
  // Beastmaster's control. The adversary appears at Close range and is immediately spotlighted."
  entry(
    "giant-beastmaster",
    "Deadly Companion",
    action({
      limit: { per: "scene", times: 2 },
      steps: [
        { kind: "summon", label: "A Bear, Dire Wolf, or similar Tier 1 animal", count: one, range: "close" },
        { kind: "spotlight", who: "picked", count: one, note: "The summoned animal is immediately spotlighted" },
      ],
    }),
  ),

  // ---- Giant Brawler (Bruiser, CB p.223)
  // "Battering Ram: Mark a Stress to have the Brawler charge at an inanimate object within Close range they could
  // feasibly smash (such as a wall, cart, or market stand) and destroy it. All targets within Very Close range of the
  // object must succeed on an Agility Reaction Roll or take 2d4+3 physical damage from the shrapnel."
  entry(
    "giant-brawler",
    "Battering Ram",
    action({
      costs: STRESS,
      targets: allAroundPoint("close", "veryClose"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close", relativeTo: "point", note: "Charge the object and destroy it" },
        { kind: "save", to: "targets", trait: "agility", difficulty: OWN_DIFFICULTY, onFail: [{ kind: "damage", to: "targets", roll: roll(2, 4, 3), type: "physical" }], onSuccess: [] },
      ],
    }),
  ),
  // "Bloody Reprisal: When the Brawler marks 2 or more HP from an attack within Very Close range, you can make a
  // standard attack against the attacker. On a success, the Brawler deals 2d6+15 physical damage instead of their
  // standard damage."
  entry(
    "giant-brawler",
    "Bloody Reprisal",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", atLeast: 2, fromAttack: true, attackerWithin: "veryClose" } },
      needsSpotlight: false,
      roll: ATTACK,
      targets: TRIGGER_SOURCE,
      steps: [{ kind: "damage", to: "targets", when: hit, roll: roll(2, 6, 15), type: "physical" }],
    }),
  ),
  // "Momentum: When the Brawler makes a successful attack against a PC, you gain a Fear."
  momentum("giant-brawler"),

  // ---- Giant Eagle (Skulk, CB p.223)
  // "Flight: While flying, the Eagle gains a +3 bonus to their Difficulty."
  entry(
    "giant-eagle",
    "Flight",
    passive({
      requires: [FLYING],
      modifiers: [
        { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(3) } },
        { kind: "mod", mod: { kind: "flag", flag: "flying" } },
      ],
    }),
  ),
  // "Deadly Dive: Mark a Stress to attack a target within Far range. On a success, deal 2d10+2 physical damage and knock
  // the target over, making them Vulnerable until they next act."
  entry(
    "giant-eagle",
    "Deadly Dive",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("far"),
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 10, 2), type: "physical" },
        { kind: "condition", to: "targets", when: hit, condition: VULNERABLE, duration: "manual", endsWhen: "they next act" },
      ],
    }),
  ),
  // "Take Off: Make an attack against a target within Very Close range. On a success, deal 2d4+3 physical damage and the
  // target must succeed on an Agility Reaction Roll or become temporarily Restrained within the Eagle's massive talons.
  // If the target is Restrained, the Eagle immediately lifts into the air to Very Far range above the battlefield while
  // holding them."
  entry(
    "giant-eagle",
    "Take Off",
    action({
      roll: ATTACK,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 4, 3), type: "physical" },
        {
          kind: "save",
          to: "targets",
          when: hit,
          trait: "agility",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "condition", to: "targets", condition: RESTRAINED, duration: "temporary" },
            { kind: "move", to: "self", mode: "move", range: "veryFar", note: "The Eagle lifts into the air to Very Far range, holding the target" },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // "Deadly Drop: While flying, the Eagle can drop a Restrained target they are holding. When dropped, the target is no
  // longer Restrained but starts falling. If their fall isn't prevented during the PCs' next action, the target takes
  // 2d20 physical damage when they land."
  // Manual: the damage waits on the PCs' next action (vocabulary gap).
  entry(
    "giant-eagle",
    "Deadly Drop",
    action({
      requires: [FLYING],
      targets: oneEnemy("melee"),
      steps: [
        { kind: "clearCondition", to: "targets", condition: RESTRAINED },
        { kind: "manual", to: "targets", text: "The target falls: unless the PCs prevent the fall during their next action, they take 2d20 physical damage when they land." },
      ],
    }),
  ),

  // ---- Giant Recruit (Minion, CB p.223)
  // "Minion (7): The Recruit is defeated when they take any damage. For every 7 damage …"
  minion("giant-recruit", 7),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Giant Recruits within Close range of them. … they
  // deal 5 physical damage each. Combine this damage."
  groupAttack("giant-recruit", 5),

  // ---- Gorgon (Solo, CB p.224)
  // "Relentless (2): The Gorgon can be spotlighted up to two times per GM turn. …"
  relentless("gorgon", 2),
  // "Sunsear Arrows: When the Gorgon makes a successful standard attack, the target Glows until the end of the scene and
  // can't become Hidden. Attack rolls made against a Glowing target have advantage."
  // Manual: advantage against the Glowing target and its "can't become Hidden" (vocabulary gap: modifiers keyed to a
  // target's tag).
  entry(
    "gorgon",
    "Sunsear Arrows",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "standard" } },
      needsSpotlight: false,
      targets: TRIGGER_SUBJECT,
      steps: [
        { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Glowing" }, duration: "scene" },
        { kind: "manual", to: "targets", text: "Glowing: can't become Hidden; attack rolls against them have advantage." },
      ],
    }),
  ),
  // "Crown of Serpents: Make an attack roll against a target within Melee range using the Gorgon's protective snakes. On
  // a success, mark a Stress to deal 2d10+4 physical damage and the target must mark a Stress."
  entry(
    "gorgon",
    "Crown of Serpents",
    action({
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        { kind: "pay", when: hit, costs: STRESS },
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 10, 4), type: "physical" },
        { kind: "markStress", to: "targets", when: hit, amount: one },
      ],
    }),
  ),
  // "Petrifying Gaze: When the Gorgon takes damage from an attack within Close range, you can spend a Fear to force the
  // attacker to make an Instinct Reaction Roll. On a failure, they begin to turn to stone, marking a HP and starting a
  // Petrification Countdown (4). This countdown ticks down when the Gorgon is attacked. When it triggers, the target must
  // make a death move. If the Gorgon is defeated, all petrification countdowns end."
  // Three uses: the gaze, the tick when the Gorgon is attacked, the end when it is defeated.
  entry(
    "gorgon",
    "Petrifying Gaze",
    featureUse({
      id: "gaze",
      activation: { kind: "reaction", trigger: { kind: "onDamaged", fromAttack: true, attackerWithin: "close" } },
      needsSpotlight: false,
      costs: FEAR,
      targets: TRIGGER_SOURCE,
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "markHp", to: "targets", amount: one },
            { kind: "countdown", op: "start", label: "Petrification", start: fixed(4), onTrigger: "The target must make a death move." },
          ],
          onSuccess: [],
        },
      ],
    }),
    featureUse({
      id: "tick",
      activation: { kind: "auto", trigger: { kind: "onAttacked", stage: "targeted" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "tick", label: "Petrification", note: "Every petrification countdown ticks down" }],
    }),
    featureUse({
      id: "end",
      activation: { kind: "auto", trigger: { kind: "onDefeated" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "prompt", label: "Petrification", note: "All petrification countdowns end" }],
    }),
  ),
  // "Momentum: When the Gorgon makes a successful attack against a PC, you gain a Fear."
  momentum("gorgon"),

  // ---- Juvenile Flickerfly (Solo, CB p.224)
  // "Relentless (3): The Flickerfly can be spotlighted up to three times per GM turn. …"
  relentless("juvenile-flickerfly", 3),
  // "Peerless Accuracy: Before the Flickerfly makes an attack, roll a d6. On a result of 4 or higher, the target's
  // Evasion is halved against this attack."
  // Manual: halving the target's Evasion for one attack (vocabulary gap); the d6 is rolled here.
  entry(
    "juvenile-flickerfly",
    "Peerless Accuracy",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onAttack", stage: "before", attack: "any" } },
      needsSpotlight: false,
      steps: [
        {
          kind: "check",
          dice: { count: one, sides: 6 },
          test: { kind: "totalAtLeast", value: 4 },
          then: [{ kind: "manual", to: "self", text: "The target's Evasion is halved against this attack." }],
          otherwise: [],
        },
      ],
    }),
  ),
  // "Mind Dance: Mark a Stress to create a magically dazzling display that grapples the minds of nearby foes. All targets
  // within Close range must make an Instinct Reaction Roll. For each target who failed, you gain a Fear and the
  // Flickerfly learns one of the target's fears."
  entry(
    "juvenile-flickerfly",
    "Mind Dance",
    action({
      costs: STRESS,
      targets: allAround("close"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "fear", to: "self", change: "gain", amount: one },
            { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Fear known to the Flickerfly" }, duration: "manual", endsWhen: "the GM clears it" },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // "Hallucinatory Breath: Countdown (Loop 1d6). When the Flickerfly takes damage for the first time, activate the
  // countdown. When it triggers, the Flickerfly breathes hallucinatory gas on all targets in front of them up to Far
  // range. Targets must succeed on an Instinct Reaction Roll or be tormented by fearful hallucinations. Targets whose
  // fears are known to the Flickerfly have disadvantage on this roll. Targets who fail must mark a Stress and lose a Hope."
  // Two uses: the countdown, and the breath when it triggers (a GM button). The disadvantage for known fears is the
  // PC's roll (shown with the prompt).
  entry(
    "juvenile-flickerfly",
    "Hallucinatory Breath",
    featureUse({
      id: "activate",
      activation: { kind: "reaction", trigger: { kind: "onDamaged", first: "ever" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "start", label: "Hallucinatory Breath", start: diceOf(1, 6), loop: true, onTrigger: "The Flickerfly breathes hallucinatory gas." }],
    }),
    featureUse({
      id: "breath",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Hallucinatory Breath countdown triggers" } },
      needsSpotlight: false,
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "front" },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          note: "Targets whose fears are known to the Flickerfly roll with disadvantage",
          onFail: [
            { kind: "markStress", to: "targets", amount: one },
            { kind: "hope", to: "targets", change: "lose", amount: one },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),

  // ---- Knight of the Realm (Leader, CB p.224)
  // "Chevalier: While the Knight is on a mount, they gain a +2 bonus to their Difficulty. When they take Severe damage,
  // they're knocked from their mount and lose this benefit until they're next spotlighted."
  entry(
    "knight-of-the-realm",
    "Chevalier",
    passive({ id: "mounted", requires: [MOUNTED], modifiers: [{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(2) } }] }),
    featureUse({
      id: "unhorsed",
      activation: { kind: "auto", trigger: { kind: "onDamaged", minSeverity: "severe" } },
      needsSpotlight: false,
      requires: [MOUNTED],
      steps: [{ kind: "manual", to: "self", text: "The Knight is knocked from their mount and loses the +2 Difficulty until they're next spotlighted." }],
    }),
  ),
  // "Heavily Armored: When the Knight takes physical damage, reduce it by 3."
  entry(
    "knight-of-the-realm",
    "Heavily Armored",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onDamaged", stage: "would", damageType: "physical" } },
      needsSpotlight: false,
      steps: [{ kind: "reduceDamage", to: "self", amount: fixed(3) }],
    }),
  ),
  // "Cavalry Charge: If the Knight is mounted, move up to Far range and make a standard attack against a target. On a
  // success, deal 2d8+4 physical damage and the target must mark a Stress."
  entry(
    "knight-of-the-realm",
    "Cavalry Charge",
    action({
      requires: [MOUNTED],
      roll: ATTACK,
      targets: oneEnemy("far"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "far", note: "Move up to Far range" },
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 8, 4), type: "physical" },
        { kind: "markStress", to: "targets", when: hit, amount: one },
      ],
    }),
  ),
  // "For the Realm!: Mark a Stress to spotlight 1d4+1 allies. Attacks they make while spotlighted in this way deal half
  // damage."
  entry("knight-of-the-realm", "For the Realm!", action({ costs: STRESS, steps: spotlightAlliesAtHalfDamage(diceOf(1, 4, 1)) })),

  // ---- Masked Thief (Skulk, CB p.225)
  // "Quick Hands: Make an attack against a target within Melee range. On a success, deal 1d8+2 physical damage and the
  // Thief steals one item or consumable from the target's inventory."
  // Manual: the theft (vocabulary gap: inventory).
  entry(
    "masked-thief",
    "Quick Hands",
    action({
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: roll(1, 8, 2), type: "physical" },
        { kind: "manual", to: "targets", when: hit, text: "The Thief steals one item or consumable from the target's inventory." },
      ],
    }),
  ),
  // "Escape Plan: Mark a Stress to reveal a snare trap set anywhere on the battlefield by the Thief. All targets within
  // Very Close range of the trap must succeed on an Agility Reaction Roll (13) or be pulled off their feet and suspended
  // upside down. A target is Restrained and Vulnerable until they break free, ending both conditions, with a successful
  // Finesse or Strength Roll (13)."
  entry(
    "masked-thief",
    "Escape Plan",
    action({
      costs: STRESS,
      targets: allAroundPoint("unlimited", "veryClose"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "fixed", value: 13 },
          onFail: [
            { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "they break free with a successful Finesse or Strength Roll (13)" },
            { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "they break free with a successful Finesse or Strength Roll (13)" },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),

  // ---- Master Assassin (Leader, CB p.220)
  // "Won't See It Coming: The Assassin deals direct damage while they're Hidden."
  entry("master-assassin", "Won't See It Coming", passive({ requires: [{ kind: "hasCondition", condition: HIDDEN }], modifiers: [{ kind: "directAttacks" }] })),
  // "Strike as One: Mark a Stress to spotlight a number of other Assassins equal to the Assassin's unmarked Stress."
  // Reading: unmarked Stress after paying this Stress (Stress 5 on the stat block).
  entry(
    "master-assassin",
    "Strike as One",
    action({
      costs: STRESS,
      steps: [
        {
          kind: "spotlight",
          who: "allies",
          name: "Assassin",
          count: { kind: "calc", of: { kind: "marked", who: "self", track: "stress" }, times: -1, plus: 5, min: 0 },
          note: "Other Assassins, as many as the Assassin's unmarked Stress",
        },
      ],
    }),
  ),
  // "The Subtle Blade: When the Assassin successfully makes a standard attack against a Vulnerable target, you can spend a
  // Fear to deal Severe damage instead of their standard damage."
  entry(
    "master-assassin",
    "The Subtle Blade",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "onHit", attack: "standard", targetHas: VULNERABLE } },
      needsSpotlight: false,
      costs: FEAR,
      targets: TRIGGER_SUBJECT,
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "minimumSeverity", severity: "severe" }, note: "Severe damage instead of the standard damage" }],
    }),
  ),
  // "Momentum: When the Assassin makes a successful attack against a PC, you gain a Fear."
  momentum("master-assassin"),

  // ---- Merchant Baron (Social, CB p.225)
  // "Everyone Has a Price: Spend a Fear to offer a target a dangerous bargain for something they want or need. If used on
  // a PC, they must make a Presence Reaction Roll (17). On a failure, they must mark 2 Stress or take the deal."
  entry(
    "merchant-baron",
    "Everyone Has a Price",
    action({
      costs: FEAR,
      targets: { side: "any", range: "unlimited", count: { kind: "one" } },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "presence",
          difficulty: { kind: "fixed", value: 17 },
          note: "A dangerous bargain for something they want or need",
          onFail: [
            {
              kind: "choose",
              id: "price",
              label: "Mark 2 Stress or take the deal",
              options: [
                { id: "stress", label: "Mark 2 Stress", steps: [{ kind: "markStress", to: "targets", amount: fixed(2) }] },
                { id: "deal", label: "Take the deal", steps: [{ kind: "manual", to: "targets", text: "They take the deal." }] },
              ],
            },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // "The Best Muscle Money Can Buy: Once per scene, mark a Stress to summon 1d4+1 Tier 1 adversaries, who appear at Far
  // range, to enforce the Baron's will."
  entry(
    "merchant-baron",
    "The Best Muscle Money Can Buy",
    action({
      limit: { per: "scene" },
      costs: STRESS,
      steps: [{ kind: "summon", label: "Tier 1 adversaries to enforce the Baron's will", count: diceOf(1, 4, 1), range: "far" }],
    }),
  ),

  // ---- Minotaur Wrecker (Bruiser, CB p.225)
  // "Ramp Up: You must spend a Fear to spotlight the Minotaur. While spotlighted, they can make their standard attack
  // against all targets within range."
  // Two uses: the spotlight cost (passive) and the sweeping standard attack while spotlighted.
  entry(
    "minotaur-wrecker",
    "Ramp Up",
    passive({ id: "spotlight-cost", modifiers: [{ kind: "spotlightCostsFear" }] }),
    action({
      id: "sweep",
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [{ kind: "damage", to: "targets", when: hit, roll: { kind: "standardAttack" }, type: "weapon" }],
    }),
  ),
  // "Charging Bull: Mark a Stress to charge through a group within Close range and make an attack against all targets in
  // the Minotaur's path. Targets the Minotaur succeeds against take 2d6+8 physical damage and are knocked back to Very Far
  // range. If a target is knocked into a solid object or another creature, they take an extra 1d6 damage (combine the
  // damage)."
  // The extra 1d6 is an optional step on the creatures the GM picks (knocked into something); it is added to their total.
  entry(
    "minotaur-wrecker",
    "Charging Bull",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: { side: "enemy", range: "close", count: { kind: "all" }, area: "path" },
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 6, 8), type: "physical" },
        {
          kind: "optional",
          id: "collision",
          label: "Knocked into a solid object or another creature",
          when: hit,
          steps: [{ kind: "damage", to: "picked", roll: roll(1, 6), type: "physical" }],
        },
        { kind: "move", to: "targets", when: hit, mode: "knockBack", range: "veryFar" },
      ],
    }),
  ),
  // "Gore: Make an attack against a target within Very Close range, moving the Minotaur into Melee range of them. On a
  // success, deal 2d8 direct physical damage."
  entry(
    "minotaur-wrecker",
    "Gore",
    action({
      roll: ATTACK,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target" },
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 8), type: "physical", direct: true },
      ],
    }),
  ),

  // ---- Mortal Hunter (Leader, CB p.225)
  // "Terrifying: When the Hunter makes a successful attack, all PCs within Far range lose a Hope and you gain a Fear."
  terrifying("mortal-hunter"),
  // "Deathlock: Spend a Fear to curse a target within Very Close range with a necrotic Deathlock until the end of the
  // scene. Attacks made by the Hunter against a Deathlocked target deal direct damage. The Hunter can only maintain one
  // Deathlock at a time."
  // Manual: direct damage against the Deathlocked target and the one-at-a-time rule (vocabulary gap).
  entry(
    "mortal-hunter",
    "Deathlock",
    action({
      costs: FEAR,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Deathlocked" }, duration: "scene" },
        { kind: "manual", to: "targets", text: "The Hunter's attacks against the Deathlocked target deal direct damage. Only one Deathlock at a time: end the previous one." },
      ],
    }),
  ),
  // "Inevitable Death: Mark a Stress to spotlight 1d4 allies. Attacks they make while spotlighted in this way deal half
  // damage."
  entry("mortal-hunter", "Inevitable Death", action({ costs: STRESS, steps: spotlightAlliesAtHalfDamage(diceOf(1, 4)) })),
  // "Rampage: Countdown (Loop 1d6). When the Hunter is in the spotlight for the first time, activate the countdown. When
  // it triggers, move the Hunter in a straight line to a point within Far range and make an attack against all targets
  // in their path. Targets the Hunter succeeds against take 2d8+2 physical damage."
  // Two uses: the countdown, and the charge when it triggers (a GM button).
  entry(
    "mortal-hunter",
    "Rampage",
    featureUse({
      id: "activate",
      activation: { kind: "reaction", trigger: { kind: "onSpotlight", first: "scene" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "start", label: "Rampage", start: diceOf(1, 6), loop: true, onTrigger: "The Hunter rampages in a straight line." }],
    }),
    featureUse({
      id: "rampage",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Rampage countdown triggers" } },
      needsSpotlight: false,
      roll: ATTACK,
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "path" },
      steps: [
        { kind: "move", to: "self", mode: "move", range: "far", relativeTo: "point", note: "Move in a straight line to a point within Far range" },
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 8, 2), type: "physical" },
      ],
    }),
  ),

  // ---- Royal Advisor (Social, CB p.225)
  // "Devastating Retort: A PC who rolls less than 17 on an action roll targeting the Advisor must mark a Stress."
  entry(
    "royal-advisor",
    "Devastating Retort",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "action", againstSelf: true, totalAtMost: 16 } },
      needsSpotlight: false,
      targets: TRIGGER_SUBJECT,
      steps: [{ kind: "markStress", to: "targets", amount: one }],
    }),
  ),
  // "Bend Ears: Mark a Stress to influence an NPC within Melee range with whispered words. That target's opinion on one
  // matter shifts toward the Advisor's preference unless it is in direct opposition to the target's motives."
  entry(
    "royal-advisor",
    "Bend Ears",
    action({
      costs: STRESS,
      steps: [{ kind: "manual", to: "self", text: "An NPC within Melee range shifts their opinion on one matter toward the Advisor's preference, unless it opposes their motives." }],
    }),
  ),
  // "Scapegoat: Spend a Fear to convince a crowd or notable individual that one person or group is responsible for some
  // problem facing the target. The target becomes hostile to the scapegoat until convinced of their innocence with a
  // successful Presence Roll (17)."
  entry(
    "royal-advisor",
    "Scapegoat",
    action({
      costs: FEAR,
      steps: [{ kind: "manual", to: "self", text: "A crowd or notable individual becomes hostile to the scapegoat until convinced of their innocence with a successful Presence Roll (17)." }],
    }),
  ),

  // ---- Secret-Keeper (Leader, CB p.226)
  // "Seize Your Moment: Spend 2 Fear to spotlight 1d4 allies. Attacks they make while spotlighted in this way deal half
  // damage."
  entry("secret-keeper", "Seize Your Moment", action({ costs: TWO_FEAR, steps: spotlightAlliesAtHalfDamage(diceOf(1, 4)) })),
  // "Our Master's Will: When you spotlight an ally within Far range, mark a Stress to gain a Fear."
  entry(
    "secret-keeper",
    "Our Master's Will",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "allySpotlit", range: "far" } },
      needsSpotlight: false,
      costs: STRESS,
      steps: [{ kind: "fear", to: "self", change: "gain", amount: one }],
    }),
  ),
  // "Summoning Ritual: Countdown (6). When the Secret-Keeper is in the spotlight for the first time, activate the
  // countdown. When they mark HP, tick down this countdown by the number of HP marked. When it triggers, summon a Minor
  // Demon who appears at Close range."
  // Three uses: activate, tick by the HP marked (automatic), summon when it triggers (a GM button).
  entry(
    "secret-keeper",
    "Summoning Ritual",
    featureUse({
      id: "activate",
      activation: { kind: "reaction", trigger: { kind: "onSpotlight", first: "scene" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "start", label: "Summoning Ritual", start: fixed(6), onTrigger: "Summon a Minor Demon at Close range." }],
    }),
    featureUse({
      id: "tick",
      activation: { kind: "auto", trigger: { kind: "onMarkHp" } },
      needsSpotlight: false,
      steps: [{ kind: "countdown", op: "tick", label: "Summoning Ritual", amount: { kind: "triggerAmount" } }],
    }),
    featureUse({
      id: "summon",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Summoning Ritual countdown triggers" } },
      needsSpotlight: false,
      steps: [{ kind: "summon", label: "Minor Demon", count: one, adversaryId: "minor-demon", range: "close" }],
    }),
  ),
  // "Fallen Hounds: Once per scene, when the Secret-Keeper marks 2 or more HP, you can mark a Stress to summon a Demonic
  // Hound Pack, which appears at Close range and is immediately spotlighted."
  entry(
    "secret-keeper",
    "Fallen Hounds",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "onMarkHp", atLeast: 2 } },
      needsSpotlight: false,
      limit: { per: "scene" },
      costs: STRESS,
      steps: [
        { kind: "summon", label: "Demonic Hound Pack", count: one, adversaryId: "demonic-hound-pack", range: "close" },
        { kind: "spotlight", who: "picked", count: one, note: "The Demonic Hound Pack is immediately spotlighted" },
      ],
    }),
  ),

  // ---- Shark (Bruiser, CB p.226)
  // "Terrifying: When the Shark makes a successful attack, all PCs within Far range lose a Hope and you gain a Fear."
  terrifying("shark"),
  // "Rending Bite: When the Shark makes a successful attack, the target must mark an Armor Slot without receiving its
  // benefits (they can still use armor to reduce the damage). If they can't mark an Armor Slot, they must mark an
  // additional HP."
  // Manual: the extra HP when no Armor Slot is free (vocabulary gap: no gate on a PC target's free slots).
  entry(
    "shark",
    "Rending Bite",
    featureUse({
      activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
      needsSpotlight: false,
      targets: TRIGGER_SUBJECT,
      steps: [
        { kind: "markArmor", to: "targets", amount: one, noBenefit: true },
        { kind: "manual", to: "targets", text: "If they can't mark an Armor Slot, they mark an additional HP." },
      ],
    }),
  ),
  // "Blood in the Water: When a creature within Close range of the Shark marks HP from another creature's attack, you
  // can mark a Stress to immediately spotlight the Shark, moving them into Melee range of the target and making a
  // standard attack."
  entry(
    "shark",
    "Blood in the Water",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "pcMarksHp", within: "close" } },
      needsSpotlight: false,
      costs: STRESS,
      roll: ATTACK,
      targets: TRIGGER_SUBJECT,
      steps: [
        { kind: "spotlight", who: "self", note: "The Shark is immediately spotlighted" },
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target" },
        { kind: "damage", to: "targets", when: hit, roll: { kind: "standardAttack" }, type: "weapon" },
      ],
    }),
  ),

  // ---- Siren (Skulk, CB p.226)
  // "Captive Audience: If the Siren makes a standard attack against a target Entranced by their song, the attack deals
  // 2d10+1 damage instead of their standard damage."
  // The standard attack against an Entranced target, offered as its own button; it deals nothing to anyone else.
  entry(
    "siren",
    "Captive Audience",
    action({
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [{ kind: "damage", to: "targets", when: ["hit", { kind: "targetHas", condition: { kind: "tag", tag: "Entranced" } }], roll: roll(2, 10, 1), type: "physical" }],
    }),
  ),
  // "Enchanting Song: Spend a Fear to sing a song that affects all targets within Close range. Targets must succeed on an
  // Instinct Reaction Roll or become Entranced until they mark 2 Stress. Other Sirens within Close range of the target
  // can mark a Stress to each add a +1 bonus to the Difficulty of the reaction roll. While Entranced, a target can't act
  // and is Vulnerable."
  // Manual: the other Sirens' Stress for +1 Difficulty each (vocabulary gap).
  entry(
    "siren",
    "Enchanting Song",
    action({
      costs: FEAR,
      targets: allAround("close"),
      steps: [
        { kind: "manual", to: "self", text: "Other Sirens within Close range of a target can each mark a Stress to add +1 to the Difficulty of that reaction roll." },
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Entranced", implies: ["vulnerable"] }, duration: "manual", endsWhen: "they mark 2 Stress" },
            { kind: "effect", to: "targets", label: "Entranced: can't act", mods: [{ kind: "flag", flag: "cannotAct" }], duration: "manual", endsWhen: "they mark 2 Stress" },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),

  // ---- Spectral Archer (Ranged, CB p.226)
  // "Ghost: The Archer has resistance to physical damage. Mark a Stress to move up to Close range through solid objects."
  ghost("spectral-archer"),
  // "Pick Your Target: Spend a Fear to make an attack within Far range against a PC who is within Very Close range of at
  // least two other PCs. On a success, the target takes 2d8+12 physical damage."
  entry(
    "spectral-archer",
    "Pick Your Target",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: oneEnemy("far"),
      steps: [{ kind: "damage", to: "targets", when: hit, roll: roll(2, 8, 12), type: "physical" }],
    }),
  ),

  // ---- Spectral Captain (Leader, CB p.226)
  // "Ghost: The Captain has resistance to physical damage. Mark a Stress to move up to Close range through solid objects."
  ghost("spectral-captain"),
  // "Unending Battle: Spend 2 Fear to return up to 1d4+1 defeated Spectral allies to the battle at the points where they
  // first appeared (with no marked HP or Stress)."
  entry(
    "spectral-captain",
    "Unending Battle",
    action({
      costs: TWO_FEAR,
      steps: [{ kind: "summon", label: "Defeated Spectral allies return where they first appeared, with no marked HP or Stress", count: diceOf(1, 4, 1) }],
    }),
  ),
  // "Hold Fast: When the Captain's Spectral allies are forced to make a reaction roll, you can mark a Stress to give
  // those allies a +2 bonus to the roll."
  entry(
    "spectral-captain",
    "Hold Fast",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Captain's Spectral allies are forced to make a reaction roll" } },
      needsSpotlight: false,
      costs: STRESS,
      steps: [{ kind: "modifyRoll", to: "allies", change: { kind: "add", amount: fixed(2) } }],
    }),
  ),
  // "Momentum: When the Captain makes a successful attack against a PC, you gain a Fear."
  momentum("spectral-captain"),

  // ---- Spectral Guardian (Standard, CB p.226)
  // "Ghost: The Guardian has resistance to physical damage. Mark a Stress to move up to Close range through solid objects."
  ghost("spectral-guardian"),
  // "Grave Blade: Spend a Fear to make an attack against a target within Very Close range. On a success, deal 2d10+6
  // physical damage and the target must mark a Stress."
  entry(
    "spectral-guardian",
    "Grave Blade",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "damage", to: "targets", when: hit, roll: roll(2, 10, 6), type: "physical" },
        { kind: "markStress", to: "targets", when: hit, amount: one },
      ],
    }),
  ),

  // ---- Spy (Social, CB p.227)
  // "Gathering Secrets: Spend a Fear to describe how the Spy knows a secret about a PC in the scene."
  entry(
    "spy",
    "Gathering Secrets",
    action({ costs: FEAR, steps: [{ kind: "manual", to: "self", text: "Describe how the Spy knows a secret about a PC in the scene." }] }),
  ),
  // "Fly on the Wall: When a PC or group is discussing something sensitive, you can mark a Stress to reveal that the Spy
  // is present in the scene, observing them. If the Spy escapes the scene to report their findings, you gain 1d4 Fear."
  // Two uses: the reveal, and the Fear when the Spy escapes to report (GM buttons).
  entry(
    "spy",
    "Fly on the Wall",
    featureUse({
      id: "reveal",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "A PC or group is discussing something sensitive" } },
      needsSpotlight: false,
      costs: STRESS,
      steps: [{ kind: "manual", to: "self", text: "Reveal that the Spy is present in the scene, observing them." }],
    }),
    featureUse({
      id: "report",
      activation: { kind: "reaction", trigger: { kind: "situation", text: "The Spy escapes the scene to report their findings" } },
      needsSpotlight: false,
      steps: [{ kind: "fear", to: "self", change: "gain", amount: diceOf(1, 4) }],
    }),
  ),

  // ---- Stonewraith (Skulk, CB p.227)
  // "Stonestrider: The Stonewraith can move through stone and earth as easily as air. While within stone or earth, they
  // are Hidden and immune to all damage."
  // Two uses: the immunity while the GM confirms it is within stone or earth, and the move into stone (on its spotlight)
  // that makes it Hidden.
  entry(
    "stonewraith",
    "Stonestrider",
    passive({
      id: "immune",
      requires: [{ kind: "situation", text: "While within stone or earth" }],
      modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "both", level: "immune" } }],
    }),
    action({
      id: "enter-stone",
      steps: [
        { kind: "move", to: "self", mode: "move", note: "Move through stone and earth as easily as air" },
        { kind: "condition", to: "self", condition: HIDDEN, duration: "manual", endsWhen: "it leaves the stone or earth" },
      ],
    }),
  ),
  // "Rocky Ambush: While Hidden, mark a Stress to leap into Melee range with a target within Very Close range. The target
  // must succeed on an Agility or Instinct Reaction Roll (15) or take 2d8 physical damage and become temporarily
  // Restrained."
  entry(
    "stonewraith",
    "Rocky Ambush",
    action({
      requires: [{ kind: "hasCondition", condition: HIDDEN }],
      costs: STRESS,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "Leap into Melee range" },
        {
          kind: "save",
          to: "targets",
          trait: ["agility", "instinct"],
          difficulty: { kind: "fixed", value: 15 },
          onFail: [
            { kind: "damage", to: "targets", roll: roll(2, 8), type: "physical" },
            { kind: "condition", to: "targets", condition: RESTRAINED, duration: "temporary" },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // "Avalanche Roar: Spend a Fear to roar while within a cave and cause a cave-in. All targets within Close range must
  // succeed on an Agility Reaction Roll (14) or take 2d10 physical damage. The rubble can be cleared with a Progress
  // Countdown (8)."
  entry(
    "stonewraith",
    "Avalanche Roar",
    action({
      requires: [{ kind: "situation", text: "While within a cave" }],
      costs: FEAR,
      targets: allAround("close"),
      steps: [
        { kind: "save", to: "targets", trait: "agility", difficulty: { kind: "fixed", value: 14 }, onFail: [{ kind: "damage", to: "targets", roll: roll(2, 10), type: "physical" }], onSuccess: [] },
        { kind: "countdown", op: "start", label: "Clear the rubble (Progress)", start: fixed(8), onTrigger: "The rubble is cleared." },
      ],
    }),
  ),
  // "Momentum: When the Stonewraith makes a successful attack against a PC, you gain a Fear."
  momentum("stonewraith"),

  // ---- War Wizard (Ranged, CB p.227)
  // "Battle Teleport: Before or after making a standard attack, you can mark a Stress to teleport to a location within
  // Far range."
  // Two uses: before and after the standard attack.
  entry(
    "war-wizard",
    "Battle Teleport",
    featureUse({
      id: "before",
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "before", attack: "standard" } },
      needsSpotlight: false,
      costs: STRESS,
      steps: [{ kind: "move", to: "self", mode: "teleport", range: "far" }],
    }),
    featureUse({
      id: "after",
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "after", attack: "standard" } },
      needsSpotlight: false,
      costs: STRESS,
      steps: [{ kind: "move", to: "self", mode: "teleport", range: "far" }],
    }),
  ),
  // "Refresh Warding Sphere: Mark a Stress to refresh the Wizard's "Warding Sphere" reaction."
  entry(
    "war-wizard",
    "Refresh Warding Sphere",
    action({ costs: STRESS, steps: [{ kind: "refreshFeature", to: "self", note: "Warding Sphere can be used again" }] }),
  ),
  // "Eruption: Spend a Fear and choose a point within Far range. A Very Close area around that point erupts into
  // impassable terrain. All targets within that area must make an Agility Reaction Roll (14). Targets who fail take 2d10
  // physical damage and are thrown out of the area. Targets who succeed take half damage and aren't moved."
  entry(
    "war-wizard",
    "Eruption",
    action({
      costs: FEAR,
      targets: allAroundPoint("far", "veryClose"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "fixed", value: 14 },
          note: "The area becomes impassable terrain",
          onFail: [
            { kind: "damage", to: "targets", roll: roll(2, 10), type: "physical" },
            { kind: "move", to: "targets", mode: "knockBack", relativeTo: "point", note: "Thrown out of the area" },
          ],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(2, 10), type: "physical", scale: "half" }],
        },
      ],
    }),
  ),
  // "Arcane Artillery: Spend a Fear to unleash a precise hail of magical blasts. All targets in the scene must make an
  // Agility Reaction Roll. Targets who fail take 2d12 magic damage. Targets who succeed take half damage."
  entry(
    "war-wizard",
    "Arcane Artillery",
    action({
      costs: FEAR,
      targets: { side: "enemy", range: "unlimited", count: { kind: "all" } },
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: OWN_DIFFICULTY,
          onFail: [{ kind: "damage", to: "targets", roll: roll(2, 12), type: "magic" }],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(2, 12), type: "magic", scale: "half" }],
        },
      ],
    }),
  ),
  // "Warding Sphere: When the Wizard takes damage from an attack within Close range, deal 2d6 magic damage to the
  // attacker. This reaction can't be used again until the Wizard refreshes it with their "Refresh Warding Sphere" action."
  // The "until refreshed" is a per-instance limit that Refresh Warding Sphere drops.
  entry(
    "war-wizard",
    "Warding Sphere",
    featureUse({
      activation: { kind: "reaction", trigger: { kind: "onDamaged", fromAttack: true, attackerWithin: "close" } },
      needsSpotlight: false,
      limit: { per: "scene" },
      targets: TRIGGER_SOURCE,
      steps: [{ kind: "damage", to: "targets", roll: roll(2, 6), type: "magic" }],
    }),
  ),
];
