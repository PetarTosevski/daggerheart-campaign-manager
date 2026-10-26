// Adversary feature effects of tier 3 Core Book adversaries (plan combat-actions, tracer AE-t3-core). Pure data: no
// framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 23
// adversaries, 87 features (CB p.228-233). Each entry quotes its feature text (as in ../adversaries.ts); what the
// vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express is a `manual` step, never a vocabulary change.
// Readings, manual steps and their reasons: docs/tasks/TASK-CA-AE-t3-core.md.
//
// Conventions (rules AR1-AR11 of the plan, CB = Core Book printed pages), shared with the tier 1 and 2 tables:
// - Actions need the spotlight; passives and reactions don't (CB p.194).
// - "Mark a Stress" is a `stress` cost on the adversary, "Spend a Fear" a `fear` cost asked first (CB p.194, Q19).
// - "Make an attack" is `adversaryAttack` against Evasion; the runner adds the stat block's ATK (AR1). One roll for
//   every target (AR7, CB p.161). A reaction roll without a number uses the adversary's Difficulty (CB p.193).
// - "Momentum" and the triggered riders of passives are `auto`; printed reactions are `reaction` (a one-tap prompt
//   defaulting to No, Q19), also where the text has no "you can". A story trigger is a `situation` (a GM button).
// - Damage to PCs comes back as incoming hits for the reaction window (Q13); PC reaction rolls are prompts (AR11).
// - Tokens on the stat block (`tokens` requirements and steps on `self`) count Slow's token, the Hydra's heads and the
//   Demon of Avarice's handfuls of gold.

import type {
  AdversaryCost,
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryRequirement,
  AdversaryStep,
  AdversaryTrigger,
} from "../../domain/adversary-effects/types";
import type { ConditionRef, DamageRoll, DieSides, NumberSource, Range, RollSpec, TargetSpec } from "../../domain/card-effects/types";

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
const difficulty = (value: number) => ({ kind: "fixed", value }) as const;

const STRESS = [{ kind: "stress", amount: one }] as const;
const FEAR = [{ kind: "fear", amount: one }] as const;
const TWO_FEAR = [{ kind: "fear", amount: fixed(2) }] as const;

const oneEnemy = (range: Range | "unlimited"): TargetSpec => ({ side: "enemy", range, count: { kind: "one" } });
const allAround = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "aroundSelf" });
const allInFront = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "front" });
const allAroundPoint = (range: Range, areaRange: Range): TargetSpec => ({
  side: "enemy",
  range,
  count: { kind: "all" },
  area: "aroundPoint",
  areaRange,
});
const EVERY_PC: TargetSpec = { side: "enemy", range: "unlimited", count: { kind: "all" } };
const TRIGGER_SUBJECT = { side: "trigger", who: "subject" } as const;
const TRIGGER_SOURCE = { side: "trigger", who: "source" } as const;

const VULNERABLE: ConditionRef = { kind: "standard", condition: "vulnerable" };
const RESTRAINED: ConditionRef = { kind: "standard", condition: "restrained" };
const HIDDEN: ConditionRef = { kind: "standard", condition: "hidden" };
const tag = (name: string): ConditionRef => ({ kind: "tag", tag: name });

const hit = ["hit"] as const;

/** Damage to the targets the roll hit. */
const damageOnHit = (r: DamageRoll, type: "physical" | "magic" | "weapon", direct?: boolean): AdversaryStep => ({
  kind: "damage",
  to: "targets",
  when: hit,
  roll: r,
  type,
  ...(direct ? { direct: true } : {}),
});
/** "Targets who fail take X. Targets who succeed take half damage." (a PC reaction roll, AR11). */
const saveForHalf = (
  trait: "agility" | "instinct",
  diff: { kind: "actorDifficulty" } | { kind: "fixed"; value: number },
  r: DamageRoll,
  type: "physical" | "magic",
  alsoOnFail: AdversaryStep[] = [],
): AdversaryStep => ({
  kind: "save",
  to: "targets",
  trait,
  difficulty: diff,
  onFail: [{ kind: "damage", to: "targets", roll: r, type }, ...alsoOnFail],
  onSuccess: [{ kind: "damage", to: "targets", roll: r, type, scale: "half" }],
});
const manual = (text: string, to: "self" | "targets" = "self"): AdversaryStep => ({ kind: "manual", to, text });

/** One use with the given parts (id "main" unless named). */
const featureUse = (u: Omit<AdversaryFeatureUse, "id"> & { id?: string }): AdversaryFeatureUse => ({ id: "main", ...u });
const entry = (adversaryId: string, feature: string, ...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({
  adversaryId,
  feature,
  uses,
});
const passive = (
  u: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight" | "steps"> & { id?: string; steps?: readonly AdversaryStep[] },
) => featureUse({ activation: { kind: "passive" }, needsSpotlight: false, steps: [], ...u });
const action = (u: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string; needsSpotlight?: boolean }) =>
  featureUse({ activation: { kind: "action" }, needsSpotlight: true, ...u });
const reaction = (trigger: AdversaryTrigger, u: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string }) =>
  featureUse({ activation: { kind: "reaction", trigger }, needsSpotlight: false, ...u });
const auto = (trigger: AdversaryTrigger, u: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string }) =>
  featureUse({ activation: { kind: "auto", trigger }, needsSpotlight: false, ...u });
const situation = (text: string): AdversaryTrigger => ({ kind: "situation", text });

// ---------------------------------------------------------------- shared features

/** "Minion (X): The X is defeated when they take any damage. For every X damage a PC deals …" (CB p.201). */
const minion = (adversaryId: string, x: number) =>
  entry(adversaryId, `Minion (${x})`, passive({ modifiers: [{ kind: "minion", threshold: x }] }));

/**
 * "Group Attack: Spend a Fear to choose a target and spotlight all <name>s within Close range of them. Those Minions move
 * into Melee range of the target and make one shared attack roll. On a success, they deal X physical damage each.
 * Combine this damage." (AR9, CB p.201): one shared roll, X per Minion combined by the runner (`groupAttack`). An action
 * needing the spotlight, as in the tier 2 table.
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
  entry(adversaryId, "Momentum", auto({ kind: "onHit", attack: "any" }, { steps: [{ kind: "fear", to: "self", change: "gain", amount: one }] }));

/** "Relentless (X): The X can be spotlighted up to X times per GM turn. Spend Fear as usual to spotlight them." */
const relentless = (adversaryId: string, x: number) =>
  entry(adversaryId, `Relentless (${x})`, passive({ modifiers: [{ kind: "relentless", times: x }] }));

/**
 * "Terrifying: When the X makes a successful attack, all PCs within Far range (must) lose a Hope and you gain a Fear."
 * Automatic on a hit; the PCs within Far range are the step's `picked` creatures (with no map: the party, Q18).
 */
const terrifying = (adversaryId: string) =>
  entry(
    adversaryId,
    "Terrifying",
    auto(
      { kind: "onHit", attack: "any" },
      {
        steps: [
          { kind: "hope", to: "picked", pick: allAround("far"), change: "lose", amount: one },
          { kind: "fear", to: "self", change: "gain", amount: one },
        ],
      },
    ),
  );

/**
 * "Slow: When you spotlight the X and they don't have a token on their stat block, they can't act yet (Slow Firing: can't
 * make a standard attack). Place a token on their stat block and describe what they're preparing to do. When you
 * spotlight the X and they have a token on their stat block, clear the token and they can act." Two automatic uses on
 * being spotlighted, split by the token (as in the tier 1 table).
 */
const slow = (adversaryId: string, feature: "Slow" | "Slow Firing", cannot: string, can: string) =>
  entry(
    adversaryId,
    feature,
    auto(
      { kind: "onSpotlight", noTokens: true },
      {
        id: "prepare",
        requires: [{ kind: "tokens", atMost: 0 }],
        steps: [{ kind: "tokens", to: "self", op: "add", amount: one }, manual(`${cannot}: describe what they're preparing to do.`)],
      },
    ),
    auto(
      { kind: "onSpotlight" },
      { id: "act", requires: [{ kind: "tokens", atLeast: 1 }], steps: [{ kind: "tokens", to: "self", op: "clear", note: `Clear the token: ${can}` }] },
    ),
  );

/**
 * "Crushing Blows / Acidic Form: When the X makes a successful attack, the target must mark an Armor Slot without
 * receiving its benefits (they can still use armor to reduce the damage). If they can't mark an Armor Slot, they must mark
 * an additional HP." Automatic on a hit; the fallback for a full armor track is manual (as in the tier 1 table).
 */
const forcedArmor = (adversaryId: string, feature: string) =>
  entry(
    adversaryId,
    feature,
    auto(
      { kind: "onHit", attack: "any" },
      {
        targets: TRIGGER_SUBJECT,
        steps: [
          { kind: "markArmor", to: "targets", amount: one, noBenefit: true },
          manual("If they can't mark an Armor Slot, they must mark an additional HP.", "targets"),
        ],
      },
    ),
  );

/** "Flying: While flying, the X gains a +3 bonus to their Difficulty." */
const FLYING: AdversaryRequirement = { kind: "situation", text: "While flying" };

/** "When the X takes damage … you can (mark a Stress / spend a Fear to) take half damage": a fold on the incoming damage. */
const HALF_DAMAGE_TO_SELF: AdversaryStep = { kind: "modifyDamage", to: "self", change: { kind: "halve" } };

/** The number of PCs in the party, for "Spend a Fear per PC in the party": the GM picks the party size (1-12). */
const FEAR_PER_PC: AdversaryCost = {
  kind: "either",
  options: Array.from({ length: 12 }, (_, i) => [{ kind: "fear", amount: fixed(i + 1) }] as const),
};

// ---------------------------------------------------------------- the table

export const T3_CORE_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ---- Adult Flickerfly (Solo, CB p.228)
  // "Relentless (4): The Flickerfly can be spotlighted up to four times per GM turn. Spend Fear as usual to spotlight them."
  relentless("adult-flickerfly", 4),
  // "Never Misses: When the Flickerfly makes an attack, the target's Evasion is halved against the attack."
  // Manual: halving the target's Evasion for one attack (vocabulary gap), offered before every attack.
  entry(
    "adult-flickerfly",
    "Never Misses",
    auto({ kind: "onAttack", stage: "before", attack: "any" }, { steps: [manual("The target's Evasion is halved against this attack.")] }),
  ),
  // "Deadly Flight: While flying, the Flickerfly can move up to Far range instead of Close range before taking an action."
  // Movement on the map is the GM's (Q18); while flying the Flickerfly carries the `flying` flag.
  entry("adult-flickerfly", "Deadly Flight", passive({ requires: [FLYING], modifiers: [{ kind: "mod", mod: { kind: "flag", flag: "flying" } }] })),
  // "Whirlwind: Spend a Fear to whirl, making an attack against all targets within Very Close range. Targets the
  // Flickerfly succeeds against take 3d8 direct physical damage."
  entry(
    "adult-flickerfly",
    "Whirlwind",
    action({ costs: FEAR, roll: ATTACK, targets: allAround("veryClose"), steps: [damageOnHit(roll(3, 8), "physical", true)] }),
  ),
  // "Mind Dance: Mark a Stress to create a magically dazzling display that grapples the minds of nearby foes. All targets
  // within Close range must make an Instinct Reaction Roll. For each target who failed, you gain a Fear and the
  // Flickerfly learns one of the target's fears."
  entry(
    "adult-flickerfly",
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
            { kind: "condition", to: "targets", condition: tag("Fear known to the Flickerfly"), duration: "manual", endsWhen: "the GM clears it" },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // "Hallucinatory Breath: Countdown (Loop 1d6). When the Flickerfly takes damage for the first time, activate the
  // countdown. When it triggers, the Flickerfly breathes hallucinatory gas on all targets in front of them up to Far
  // range. Targets must make an Instinct Reaction Roll or be tormented by fearful hallucinations. Targets whose fears are
  // known to the Flickerfly have disadvantage on this roll. Targets who fail lose 2 Hope and take 3d8+3 direct magic
  // damage."
  // Two uses: the countdown, and the breath when it triggers (a GM button). The disadvantage for known fears is the PC's
  // roll (shown with the prompt).
  entry(
    "adult-flickerfly",
    "Hallucinatory Breath",
    reaction(
      { kind: "onDamaged", first: "ever" },
      {
        id: "activate",
        steps: [{ kind: "countdown", op: "start", label: "Hallucinatory Breath", start: diceOf(1, 6), loop: true, onTrigger: "The Flickerfly breathes hallucinatory gas." }],
      },
    ),
    reaction(situation("The Hallucinatory Breath countdown triggers"), {
      id: "breath",
      targets: allInFront("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          note: "Targets whose fears are known to the Flickerfly roll with disadvantage",
          onFail: [
            { kind: "hope", to: "targets", change: "lose", amount: fixed(2) },
            { kind: "damage", to: "targets", roll: roll(3, 8, 3), type: "magic", direct: true },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // "Uncanny Reflexes: When the Flickerfly takes damage from an attack within Close range, you can mark a Stress to take
  // half damage."
  entry(
    "adult-flickerfly",
    "Uncanny Reflexes",
    reaction({ kind: "onDamaged", stage: "would", fromAttack: true, attackerWithin: "close" }, { costs: STRESS, steps: [HALF_DAMAGE_TO_SELF] }),
  ),

  // ---- Demon of Avarice (Support, CB p.228). Handfuls of gold are tokens on its stat block.
  // "Money Talks: Attacks against the Demon are made with disadvantage unless the attacker spends a handful of gold. This
  // Demon starts with a number of handfuls equal to the number of PCs. When a target marks HP from the Demon's standard
  // attack, they can spend a handful of gold instead of marking HP (1 handful per HP). Add a handful of gold to the Demon
  // for each handful of gold spent by PCs on this feature."
  // Four uses: the disadvantage (unless the attacker pays: a situation the GM confirms), the starting hoard (the GM's
  // party), the GM button that adds the handfuls PCs spent, and the PC's option to pay gold instead of HP (manual).
  entry(
    "demon-of-avarice",
    "Money Talks",
    passive({
      id: "disadvantage",
      requires: [{ kind: "situation", text: "The attacker hasn't spent a handful of gold" }],
      modifiers: [{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" } }],
    }),
    auto(
      { kind: "timing", at: "appears" },
      {
        id: "hoard",
        targets: EVERY_PC,
        steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "targetCount", which: "picked" }, note: "One handful of gold per PC" }],
      },
    ),
    reaction(situation("PCs spend handfuls of gold on Money Talks"), {
      id: "collect",
      steps: [{ kind: "tokens", to: "self", op: "add", amount: { kind: "triggerAmount" }, note: "A handful for each handful the PCs spent" }],
    }),
    auto(
      { kind: "onTargetMarksHp", attack: "standard" },
      {
        id: "pay-instead",
        targets: TRIGGER_SUBJECT,
        steps: [manual("The target can spend a handful of gold instead of marking each HP (1 handful per HP); add those handfuls to the Demon.", "targets")],
      },
    ),
  ),
  // "Numbers Must Go Up: Add a bonus to the Demon's attack rolls equal to the number of handfuls of gold they have."
  entry(
    "demon-of-avarice",
    "Numbers Must Go Up",
    passive({ modifiers: [{ kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "cardTokens" } } }] }),
  ),
  // "Money Is Time: Spend 3 handfuls of gold (or a Fear) to spotlight 1d4+1 allies."
  // Two uses, one per payment (`AdversaryCost` has no token cost: a token requirement and a spend step).
  entry(
    "demon-of-avarice",
    "Money Is Time",
    action({
      id: "gold",
      requires: [{ kind: "tokens", atLeast: 3 }],
      steps: [
        { kind: "tokens", to: "self", op: "spend", amount: fixed(3) },
        { kind: "spotlight", who: "allies", count: diceOf(1, 4, 1) },
      ],
    }),
    action({ id: "fear", costs: FEAR, steps: [{ kind: "spotlight", who: "allies", count: diceOf(1, 4, 1) }] }),
  ),

  // ---- Demon of Despair (Skulk, CB p.228)
  // "Depths of Despair: The Demon deals double damage to PCs with 0 Hope."
  // Automatic before its damage roll when the GM confirms the target has no Hope (no gate on a PC target's Hope).
  entry(
    "demon-of-despair",
    "Depths of Despair",
    auto(
      { kind: "onAttack", stage: "beforeDamage", attack: "any" },
      { requires: [{ kind: "situation", text: "The target has 0 Hope" }], steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "multiply", factor: 2 } }] },
    ),
  ),
  // "Your Struggle Is Pointless: Spend a Fear to weigh down the spirits of all PCs within Far range. All targets affected
  // replace their Hope Die with a d8 until they roll a success with Hope or their next rest."
  // Manual: the d8 Hope Die on the bearer's own rolls (vocabulary gap).
  entry(
    "demon-of-despair",
    "Your Struggle Is Pointless",
    action({
      costs: FEAR,
      targets: allAround("far"),
      steps: [
        { kind: "condition", to: "targets", condition: tag("Despairing"), duration: "manual", endsWhen: "they roll a success with Hope or take their next rest" },
        manual("Despairing: their Hope Die is a d8.", "targets"),
      ],
    }),
  ),
  // "Your Friends Will Fail You: When a PC fails with Fear, you can mark a Stress to cause all other PCs within Close
  // range to lose a Hope."
  // The other PCs within Close range (of the PC who failed) are the step's `picked` creatures.
  entry(
    "demon-of-despair",
    "Your Friends Will Fail You",
    reaction(
      { kind: "pcRolls", result: "failureWithFear" },
      { costs: STRESS, steps: [{ kind: "hope", to: "picked", pick: { side: "enemy", range: "close", count: { kind: "all" }, area: "aroundTarget" }, change: "lose", amount: one }] },
    ),
  ),
  // "Momentum: When the Demon makes a successful attack against a PC, you gain a Fear."
  momentum("demon-of-despair"),

  // ---- Demon of Hubris (Leader, CB p.229)
  // "Terrifying: When the Demon makes a successful attack, all PCs within Far range must lose a Hope and you gain a Fear."
  terrifying("demon-of-hubris"),
  // "Double or Nothing: When a PC within Far range fails a roll, they can choose to reroll their Fear Die and take the new
  // result. If they still fail, they mark 2 Stress and the Demon clears a Stress."
  // Two uses: the PC's offer on a failure (their choice: manual), and the GM button when they rerolled and still failed.
  entry(
    "demon-of-hubris",
    "Double or Nothing",
    auto(
      { kind: "pcRolls", result: "failure", within: "far" },
      { id: "offer", targets: TRIGGER_SUBJECT, steps: [manual("Double or Nothing: they can choose to reroll their Fear Die and take the new result.", "targets")] },
    ),
    reaction(situation("The PC rerolled their Fear Die with Double or Nothing and still failed"), {
      id: "still-failed",
      targets: TRIGGER_SUBJECT,
      steps: [
        { kind: "markStress", to: "targets", amount: fixed(2) },
        { kind: "clear", to: "self", track: "stress", amount: one },
      ],
    }),
  ),
  // "Unparalleled Skill: Mark a Stress to deal the Demon's standard attack damage to a target within Close range."
  // No attack roll: the damage lands.
  entry(
    "demon-of-hubris",
    "Unparalleled Skill",
    action({ costs: STRESS, targets: oneEnemy("close"), steps: [{ kind: "damage", to: "targets", roll: { kind: "standardAttack" }, type: "weapon" }] }),
  ),
  // "The Root of Villainy: Spend a Fear to spotlight two other Demons within Far range."
  entry(
    "demon-of-hubris",
    "The Root of Villainy",
    action({ costs: FEAR, steps: [{ kind: "spotlight", who: "allies", count: fixed(2), within: "far", note: "Two other Demons" }] }),
  ),
  // "You Pale in Comparison: When a PC fails a roll within Close range of the Demon, they must mark a Stress."
  entry(
    "demon-of-hubris",
    "You Pale in Comparison",
    reaction({ kind: "pcRolls", result: "failure", within: "close" }, { targets: TRIGGER_SUBJECT, steps: [{ kind: "markStress", to: "targets", amount: one }] }),
  ),

  // ---- Demon of Jealousy (Ranged, CB p.229)
  // "Unprotected Mind: The Demon's standard attack deals direct damage."
  // Its standard attack is its only attack, so the passive `directAttacks` says the same.
  entry("demon-of-jealousy", "Unprotected Mind", passive({ modifiers: [{ kind: "directAttacks" }] })),
  // "My Turn: When the Demon marks HP from an attack, spend a number of Fear equal to the HP marked by the Demon to cause
  // the attacker to mark the same number of HP."
  // The HP marked is the trigger's amount; the Fear is asked first like every Fear cost.
  entry(
    "demon-of-jealousy",
    "My Turn",
    reaction(
      { kind: "onMarkHp", fromAttack: true },
      {
        costs: [{ kind: "fear", amount: { kind: "triggerAmount" } }],
        targets: TRIGGER_SOURCE,
        steps: [{ kind: "markHp", to: "targets", amount: { kind: "triggerAmount" } }],
      },
    ),
  ),
  // "Rivalry: When a creature within Close range takes damage from a different adversary, you can mark a Stress to add a
  // d4 to the damage roll."
  // A fold on the other adversary's damage against the creature (the trigger's subject).
  entry(
    "demon-of-jealousy",
    "Rivalry",
    reaction(
      { kind: "allyMarksHp", range: "close" },
      { costs: STRESS, steps: [{ kind: "modifyDamage", to: "triggerSubject", change: { kind: "add", amount: diceOf(1, 4) } }] },
    ),
  ),
  // "What's Yours Is Mine: When a PC takes Severe damage within Very Close range of the Demon, you can spend a Fear to
  // cause the target to make a Finesse Reaction Roll. On a failure, the Demon seizes one item or consumable of their
  // choice from the target's inventory."
  // Manual: taking the item (no inventory step).
  entry(
    "demon-of-jealousy",
    "What's Yours Is Mine",
    reaction(
      { kind: "pcMarksHp", within: "veryClose", minSeverity: "severe" },
      {
        costs: FEAR,
        targets: TRIGGER_SUBJECT,
        steps: [
          {
            kind: "save",
            to: "targets",
            trait: "finesse",
            difficulty: OWN_DIFFICULTY,
            onFail: [manual("The Demon seizes one item or consumable of their choice from the target's inventory.", "targets")],
            onSuccess: [],
          },
        ],
      },
    ),
  ),

  // ---- Demon of Wrath (Bruiser, CB p.229)
  // "Anger Unrelenting: The Demon's attacks deal direct damage."
  entry("demon-of-wrath", "Anger Unrelenting", passive({ modifiers: [{ kind: "directAttacks" }] })),
  // "Battle Lust: Spend a Fear to boil the blood of all PCs within Far range. They use a d20 as their Fear Die until the
  // end of the scene."
  // Manual: the d20 Fear Die on the bearer's own rolls (vocabulary gap).
  entry(
    "demon-of-wrath",
    "Battle Lust",
    action({
      costs: FEAR,
      targets: allAround("far"),
      steps: [
        { kind: "condition", to: "targets", condition: tag("Battle Lust"), duration: "scene" },
        manual("Battle Lust: they use a d20 as their Fear Die until the end of the scene.", "targets"),
      ],
    }),
  ),
  // "Retaliation: When the Demon takes damage from an attack within Close range, you can mark a Stress to make a standard
  // attack against the attacker."
  entry(
    "demon-of-wrath",
    "Retaliation",
    reaction(
      { kind: "onDamaged", fromAttack: true, attackerWithin: "close" },
      { costs: STRESS, roll: ATTACK, targets: TRIGGER_SOURCE, steps: [damageOnHit({ kind: "standardAttack" }, "weapon")] },
    ),
  ),
  // "Blood and Souls: Countdown (Loop 6). Activate the first time an attack is made within sight of the Demon. It ticks
  // down when a PC takes a violent action. When it triggers, summon 1d4 Minor Demons, who appear at Close range."
  // Three GM buttons: activate, tick, and the summon when it triggers.
  entry(
    "demon-of-wrath",
    "Blood and Souls",
    reaction(situation("The first attack within sight of the Demon of Wrath"), {
      id: "activate",
      steps: [{ kind: "countdown", op: "start", label: "Blood and Souls", start: fixed(6), loop: true, onTrigger: "Summon 1d4 Minor Demons at Close range." }],
    }),
    reaction(situation("A PC takes a violent action"), { id: "tick", steps: [{ kind: "countdown", op: "tick", label: "Blood and Souls" }] }),
    reaction(situation("The Blood and Souls countdown triggers"), {
      id: "summon",
      steps: [{ kind: "summon", label: "Minor Demons", count: diceOf(1, 4), adversaryId: "minor-demon", range: "close" }],
    }),
  ),

  // ---- Dire Bat (Skulk, CB p.230)
  // "Flying: While flying, the Bat gains a +3 bonus to their Difficulty."
  entry(
    "dire-bat",
    "Flying",
    passive({
      requires: [FLYING],
      modifiers: [
        { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(3) } },
        { kind: "mod", mod: { kind: "flag", flag: "flying" } },
      ],
    }),
  ),
  // "Screech: Mark a Stress to send a high-pitch screech out toward all targets in front of the Bat within Far range.
  // Those targets must mark 1d4 Stress."
  entry("dire-bat", "Screech", action({ costs: STRESS, targets: allInFront("far"), steps: [{ kind: "markStress", to: "targets", amount: diceOf(1, 4) }] })),
  // "Guardian: When an allied Vampire marks HP, you can mark a Stress to fly into Melee range of the attacker and make an
  // attack with advantage against them. On a success, deal 2d6+2 physical damage."
  entry(
    "dire-bat",
    "Guardian",
    reaction(
      { kind: "allyMarksHp", allyName: "Vampire" },
      {
        costs: STRESS,
        roll: ATTACK_WITH_ADVANTAGE,
        targets: TRIGGER_SOURCE,
        steps: [
          { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "triggerSource", note: "Fly into Melee range of the attacker" },
          damageOnHit(roll(2, 6, 2), "physical"),
        ],
      },
    ),
  ),

  // ---- Dryad (Leader, CB p.230)
  // "Bramble Patch: Mark a Stress to target a point within Far range. Create a patch of thorns that covers an area within
  // Close range of that point. All targets within that area take 2d6+2 physical damage when they act. A target must
  // succeed on a Finesse Roll or deal more than 20 damage to the Dryad with an attack to leave the area."
  // Manual: a lasting area hazard (vocabulary gap).
  entry(
    "dryad",
    "Bramble Patch",
    action({
      costs: STRESS,
      targets: { side: "point", range: "far", count: { kind: "one" } },
      steps: [
        manual(
          "A patch of thorns covers Close range around the point: targets in it take 2d6+2 physical damage when they act, and leave it only with a successful Finesse Roll or by dealing more than 20 damage to the Dryad with an attack.",
        ),
      ],
    }),
  ),
  // "Grow Saplings: Spend a Fear to grow three Treant Sapling Minions, who appear at Close range and immediately take the
  // spotlight."
  entry(
    "dryad",
    "Grow Saplings",
    action({
      costs: FEAR,
      steps: [
        { kind: "summon", label: "Treant Saplings", count: fixed(3), adversaryId: "treant-sapling", range: "close" },
        { kind: "spotlight", who: "sameName", count: fixed(3), name: "Treant Sapling", note: "The Saplings immediately take the spotlight" },
      ],
    }),
  ),
  // "We Are All One: When an ally dies within Close range, you can spend a Fear to clear 2 HP and 2 Stress as the fallen
  // ally's life force is returned to the forest."
  entry(
    "dryad",
    "We Are All One",
    reaction(
      { kind: "allyDefeated", range: "close" },
      {
        costs: FEAR,
        steps: [
          { kind: "clear", to: "self", track: "hp", amount: fixed(2) },
          { kind: "clear", to: "self", track: "stress", amount: fixed(2) },
        ],
      },
    ),
  ),

  // ---- Elemental Spark (Minion, CB p.230)
  // "Minion (9): The Elemental is defeated when they take any damage. For every 9 damage …"
  minion("elemental-spark", 9),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Elemental Sparks within Close range of them. … they
  // deal 5 physical damage each. Combine this damage."
  groupAttack("elemental-spark", 5),

  // ---- Greater Earth Elemental (Bruiser, CB p.230)
  // "Slow: When you spotlight the Elemental and they don't have a token on their stat block, they can't act yet. …"
  slow("greater-earth-elemental", "Slow", "They can't act yet", "they can act"),
  // "Crushing Blows: When the Elemental makes a successful attack, the target must mark an Armor Slot without receiving
  // its benefits (they can still use armor to reduce the damage). If they can't mark an Armor Slot, they must mark an
  // additional HP."
  forcedArmor("greater-earth-elemental", "Crushing Blows"),
  // "Immovable Object: An attack that would move the Elemental moves them two fewer ranges (for example, Far becomes Very
  // Close). When the Elemental takes physical damage, reduce it by 7."
  // Two uses: the damage reduction (automatic) and the shortened push (a GM button; manual: no forced-movement modifier).
  entry(
    "greater-earth-elemental",
    "Immovable Object",
    auto({ kind: "onDamaged", stage: "would", damageType: "physical" }, { id: "reduce", steps: [{ kind: "reduceDamage", to: "self", amount: fixed(7) }] }),
    reaction(situation("An attack would move the Elemental"), {
      id: "immovable",
      steps: [manual("The attack moves the Elemental two fewer ranges (Far becomes Very Close).")],
    }),
  ),
  // "Rockslide: Mark a Stress to create a rockslide that buries the land in front of Elemental within Close range with
  // rockfall. All targets in this area must make an Agility Reaction Roll (19). Targets who fail take 2d12+5 physical
  // damage and become Vulnerable until their next roll with Hope. Targets who succeed take half damage."
  entry(
    "greater-earth-elemental",
    "Rockslide",
    action({
      costs: STRESS,
      targets: allInFront("close"),
      steps: [
        saveForHalf("agility", difficulty(19), roll(2, 12, 5), "physical", [
          { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "their next roll with Hope" },
        ]),
      ],
    }),
  ),
  // "Momentum: When the Elemental makes a successful attack against a PC, you gain a Fear."
  momentum("greater-earth-elemental"),

  // ---- Greater Water Elemental (Support, CB p.230)
  // "Water Jet: Mark a Stress to attack a target within Very Close range. On a success, deal 2d4+7 physical damage and the
  // target's next action has disadvantage. On a failure, the target must mark a Stress."
  // Manual: the disadvantage on the bearer's next action (vocabulary gap); the tag ends with that roll.
  entry(
    "greater-water-elemental",
    "Water Jet",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("veryClose"),
      steps: [
        damageOnHit(roll(2, 4, 7), "physical"),
        { kind: "condition", to: "targets", when: hit, condition: tag("Drenched"), duration: "nextRoll" },
        { kind: "manual", to: "targets", when: hit, text: "Drenched: their next action has disadvantage." },
        { kind: "markStress", to: "targets", when: ["miss"], amount: one },
      ],
    }),
  ),
  // "Drowning Embrace: Spend a Fear to make an attack against all targets within Very Close range. Targets the Elemental
  // succeeds against become Restrained and Vulnerable as they begin drowning. A target can break free, ending both
  // conditions, with a successful Strength or Instinct Roll."
  entry(
    "greater-water-elemental",
    "Drowning Embrace",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [
        { kind: "condition", to: "targets", when: hit, condition: RESTRAINED, duration: "manual", endsWhen: "they break free with a successful Strength or Instinct Roll (ending both)" },
        { kind: "condition", to: "targets", when: hit, condition: VULNERABLE, duration: "manual", endsWhen: "they break free with a successful Strength or Instinct Roll (ending both)" },
      ],
    }),
  ),
  // "High Tide: When the Elemental makes a successful standard attack, you can mark a Stress to knock the target back to
  // Close range."
  entry(
    "greater-water-elemental",
    "High Tide",
    reaction(
      { kind: "onHit", attack: "standard" },
      { costs: STRESS, targets: TRIGGER_SUBJECT, steps: [{ kind: "move", to: "targets", mode: "knockBack", range: "close", relativeTo: "self" }] },
    ),
  ),

  // ---- Head Vampire (Leader, CB p.232)
  // "Terrifying: When the Vampire makes a successful attack, all PCs within Far range lose a Hope and you gain a Fear."
  terrifying("head-vampire"),
  // "Look into My Eyes: A creature who moves into Melee range of the Vampire must make an Instinct Reaction Roll. On a
  // failure, you gain 1d4 Fear."
  entry(
    "head-vampire",
    "Look into My Eyes",
    auto(
      { kind: "pcMoves", into: "melee" },
      {
        targets: TRIGGER_SUBJECT,
        steps: [{ kind: "save", to: "targets", trait: "instinct", difficulty: OWN_DIFFICULTY, onFail: [{ kind: "fear", to: "self", change: "gain", amount: diceOf(1, 4) }], onSuccess: [] }],
      },
    ),
  ),
  // "Feed on Followers: When the Vampire is within Melee range of an ally, they can cause the ally to mark a HP. The
  // Vampire then clears a HP."
  entry(
    "head-vampire",
    "Feed on Followers",
    action({
      requires: [{ kind: "allyWithin", range: "melee", of: "self" }],
      targets: { side: "ally", range: "melee", count: { kind: "one" }, excludeSelf: true },
      steps: [
        { kind: "markHp", to: "targets", amount: one },
        { kind: "clear", to: "self", track: "hp", amount: one },
      ],
    }),
  ),
  // "The Hunt Is On: Spend 2 Fear to summon 1d4 Vampires, who appear at Far range and immediately take the spotlight."
  entry(
    "head-vampire",
    "The Hunt Is On",
    action({
      costs: TWO_FEAR,
      steps: [
        { kind: "summon", label: "Vampires", count: diceOf(1, 4), adversaryId: "vampire", range: "far" },
        { kind: "spotlight", who: "sameName", name: "Vampire", note: "The summoned Vampires immediately take the spotlight" },
      ],
    }),
  ),
  // "Lifesuck: When the Vampire is spotlighted, roll a d8. On a result of 6 or higher, all targets within Very Close range
  // must mark a HP."
  entry(
    "head-vampire",
    "Lifesuck",
    reaction(
      { kind: "onSpotlight" },
      {
        targets: allAround("veryClose"),
        steps: [{ kind: "check", dice: { count: one, sides: 8 }, test: { kind: "totalAtLeast", value: 6 }, then: [{ kind: "markHp", to: "targets", amount: one }], otherwise: [] }],
      },
    ),
  ),

  // ---- Huge Green Ooze (Skulk, CB p.231)
  // "Slow: When you spotlight the Ooze and they don't have a token on their stat block, they can't act yet. …"
  slow("huge-green-ooze", "Slow", "They can't act yet", "they can act"),
  // "Acidic Form: When the Ooze makes a successful attack, the target must mark an Armor Slot without receiving its
  // benefits (they can still use armor to reduce the damage). If they can't mark an Armor Slot, they must mark an
  // additional HP."
  forcedArmor("huge-green-ooze", "Acidic Form"),
  // "Envelop: Make an attack against a target within Melee range. On a success, the Ooze Envelops them and the target must
  // mark 2 Stress. While Enveloped, the target must mark an additional Stress every time they make an action roll. When
  // the Ooze takes Severe damage, all Enveloped targets are freed and the condition is cleared."
  // Two uses: the attack, and the release on Severe damage. Manual: the Stress on each of the bearer's action rolls.
  entry(
    "huge-green-ooze",
    "Envelop",
    action({
      id: "envelop",
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        { kind: "condition", to: "targets", when: hit, condition: tag("Enveloped"), duration: "manual", endsWhen: "the Ooze takes Severe damage" },
        { kind: "markStress", to: "targets", when: hit, amount: fixed(2) },
        { kind: "manual", to: "targets", when: hit, text: "Enveloped: they mark an additional Stress every time they make an action roll." },
      ],
    }),
    auto(
      { kind: "onDamaged", minSeverity: "severe" },
      { id: "release", steps: [{ kind: "clearCondition", to: "picked", pick: EVERY_PC, condition: tag("Enveloped"), note: "All Enveloped targets are freed" }] },
    ),
  ),
  // "Split: When the Ooze has 4 or more HP marked, you can spend a Fear to split them into two Green Oozes (with no marked
  // HP or Stress). Immediately spotlight both of them."
  // The original leaves the encounter (as the tier 1 Oozes' Split).
  entry(
    "huge-green-ooze",
    "Split",
    reaction(
      { kind: "onHpMarkedAtLeast", value: 4 },
      {
        requires: [{ kind: "hpMarkedAtLeast", value: 4 }],
        costs: FEAR,
        steps: [
          { kind: "defeat", to: "self", note: "The Ooze splits in two" },
          { kind: "summon", label: "Green Oozes", count: fixed(2), adversaryId: "green-ooze", range: "melee" },
          { kind: "spotlight", who: "sameName", count: fixed(2), name: "Green Ooze", note: "Immediately spotlight both of them" },
        ],
      },
    ),
  ),

  // ---- Hydra (Solo, CB p.231). Its heads are tokens on its stat block.
  // "Many-Headed Menace: The Hydra begins with three heads and can have up to five. When the Hydra takes Major or greater
  // damage, they lose a head."
  entry(
    "hydra",
    "Many-Headed Menace",
    auto({ kind: "timing", at: "appears" }, { id: "heads", steps: [{ kind: "tokens", to: "self", op: "set", amount: fixed(3), note: "Three heads" }] }),
    auto({ kind: "onDamaged", minSeverity: "major" }, { id: "lose-head", steps: [{ kind: "tokens", to: "self", op: "spend", amount: one, note: "The Hydra loses a head" }] }),
  ),
  // "Relentless (X): The Hydra can be spotlighted X times per GM turn, where X is the Hydra's number of heads. Spend Fear
  // as usual to spotlight them."
  // `relentless` takes a fixed number: it is 5 (the most heads), and each spotlight reminds the GM of the heads
  // (manual: the number of heads is the limit).
  entry(
    "hydra",
    "Relentless (X)",
    passive({ id: "relentless", modifiers: [{ kind: "relentless", times: 5 }] }),
    auto({ kind: "onSpotlight" }, { id: "heads", steps: [manual("Relentless (X): the Hydra can be spotlighted as many times per GM turn as it has heads (tokens on its stat block).")] }),
  ),
  // "Regeneration: If the Hydra has any marked HP, spend a Fear to clear a HP and grow two heads."
  // The heads stop at five. It can't be used while Dazed (Magical Weakness says so; the GM holds it back).
  entry(
    "hydra",
    "Regeneration",
    action({
      requires: [{ kind: "hpMarkedAtLeast", value: 1 }],
      costs: FEAR,
      steps: [
        { kind: "clear", to: "self", track: "hp", amount: one },
        { kind: "tokens", to: "self", op: "add", amount: fixed(2), max: fixed(5), note: "Grow two heads (up to five)" },
      ],
    }),
  ),
  // "Terrifying Chorus: All PCs within Far range lose 2 Hope."
  entry("hydra", "Terrifying Chorus", action({ targets: allAround("far"), steps: [{ kind: "hope", to: "targets", change: "lose", amount: fixed(2) }] })),
  // "Magical Weakness: When the Hydra takes magic damage, they become Dazed until the next roll with Fear. While Dazed,
  // they can't use their Regeneration action but are immune to magic damage."
  // Manual: Regeneration is blocked while Dazed (no requirement that the adversary lacks a condition).
  entry(
    "hydra",
    "Magical Weakness",
    reaction(
      { kind: "onDamaged", damageType: "magic" },
      {
        steps: [
          { kind: "condition", to: "self", condition: tag("Dazed"), duration: "manual", endsWhen: "the next roll with Fear" },
          { kind: "effect", to: "self", label: "Dazed", mods: [{ kind: "resistance", type: "magic", level: "immune" }], duration: "manual", endsWhen: "the next roll with Fear" },
          manual("While Dazed, the Hydra can't use Regeneration."),
        ],
      },
    ),
  ),

  // ---- Monarch (Social, CB p.231)
  // "Execute Them!: Spend a Fear per PC in the party to have the group condemned for crimes real or imagined. A PC who
  // succeeds on a Presence Roll can demand trial by combat or another special form of trial."
  // The GM picks the party size (an `either` cost of 1-12 Fear); the trial is the fiction's (manual).
  entry(
    "monarch",
    "Execute Them!",
    action({
      costs: [FEAR_PER_PC],
      targets: EVERY_PC,
      steps: [
        { kind: "condition", to: "targets", condition: tag("Condemned"), duration: "manual", endsWhen: "the GM clears it" },
        manual("A PC who succeeds on a Presence Roll can demand trial by combat or another special form of trial."),
      ],
    }),
  ),
  // "Crownsguard: Once per scene, mark a Stress to summon six Tier 3 Minions, who appear at Close range to enforce the
  // Monarch's will."
  entry(
    "monarch",
    "Crownsguard",
    action({ limit: { per: "scene", times: 1 }, costs: STRESS, steps: [{ kind: "summon", label: "Tier 3 Minions", count: fixed(6), range: "close" }] }),
  ),
  // "Casus Belli: Long-Term Countdown (8). Spend a Fear to activate after the Monarch's desire for war is first revealed.
  // When it triggers, the Monarch has a reason to rally the nation to war and the support to act on that reason. You gain
  // 1d4 Fear."
  // Two GM buttons: activate (the Fear) and the war when it triggers.
  entry(
    "monarch",
    "Casus Belli",
    reaction(situation("The Monarch's desire for war is first revealed"), {
      id: "activate",
      costs: FEAR,
      steps: [{ kind: "countdown", op: "start", label: "Casus Belli (long-term)", start: fixed(8), onTrigger: "The Monarch rallies the nation to war; you gain 1d4 Fear." }],
    }),
    reaction(situation("The Casus Belli countdown triggers"), {
      id: "war",
      steps: [manual("The Monarch has a reason to rally the nation to war and the support to act on that reason."), { kind: "fear", to: "self", change: "gain", amount: diceOf(1, 4) }],
    }),
  ),

  // ---- Oak Treant (Bruiser, CB p.232)
  // "Just a Tree: Before they make their first attack in a fight or after they become Hidden, the Treant is
  // indistinguishable from other trees until they next act or a PC succeeds on an Instinct Roll to identify them."
  // Two automatic uses that tag the Treant: when it appears, and when it would become Hidden.
  entry(
    "oak-treant",
    "Just a Tree",
    auto(
      { kind: "timing", at: "appears" },
      { id: "appears", steps: [{ kind: "condition", to: "self", condition: tag("Just a Tree"), duration: "manual", endsWhen: "they next act or a PC succeeds on an Instinct Roll to identify them" }] },
    ),
    auto(
      { kind: "wouldGainCondition", condition: HIDDEN },
      { id: "hidden", steps: [{ kind: "condition", to: "self", condition: tag("Just a Tree"), duration: "manual", endsWhen: "they next act or a PC succeeds on an Instinct Roll to identify them" }] },
    ),
  ),
  // "Seed Barrage: Mark a Stress and make an attack against up to three targets within Close range, pummeling them with
  // giant acorns. Targets the Treant succeeds against take 2d10+5 physical damage."
  entry(
    "oak-treant",
    "Seed Barrage",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: { side: "enemy", range: "close", count: { kind: "upTo", n: fixed(3) } },
      steps: [damageOnHit(roll(2, 10, 5), "physical")],
    }),
  ),
  // "Take Root: Mark a Stress to Root the Treant in place. The Treant is Restrained while Rooted, and can end this effect
  // instead of moving while they are spotlighted. While Rooted, the Treant has resistance to physical damage."
  // Three uses: root (the Stress), the resistance while Rooted, and ending it on its spotlight.
  entry(
    "oak-treant",
    "Take Root",
    action({
      id: "root",
      costs: STRESS,
      steps: [
        { kind: "condition", to: "self", condition: tag("Rooted"), duration: "manual", endsWhen: "the Treant ends it instead of moving while spotlighted" },
        { kind: "condition", to: "self", condition: RESTRAINED, duration: "manual", endsWhen: "the Treant is no longer Rooted" },
      ],
    }),
    passive({
      id: "rooted",
      requires: [{ kind: "hasCondition", condition: tag("Rooted") }],
      modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }],
    }),
    action({
      id: "uproot",
      requires: [{ kind: "hasCondition", condition: tag("Rooted") }],
      steps: [
        { kind: "clearCondition", to: "self", condition: tag("Rooted"), note: "Instead of moving" },
        { kind: "clearCondition", to: "self", condition: RESTRAINED },
      ],
    }),
  ),

  // ---- Stag Knight (Standard, CB p.231)
  // "From Above: When the Knight succeeds on a standard attack from above a target, they deal 3d12+3 physical damage
  // instead of their standard damage."
  // The standard attack from above as its own button (as the tier 1 variant attacks).
  entry(
    "stag-knight",
    "From Above",
    action({
      id: "attack",
      requires: [{ kind: "situation", text: "The Knight attacks from above the target" }],
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [damageOnHit(roll(3, 12, 3), "physical")],
    }),
  ),
  // "Blade of the Forest: Spend a Fear to make an attack against all targets within Very Close range. Targets the Knight
  // succeeds against take physical damage equal to 3d4 + the target's Major threshold."
  // Manual: the target's Major threshold (no number source for a target's threshold); the 3d4 is rolled.
  entry(
    "stag-knight",
    "Blade of the Forest",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [damageOnHit(roll(3, 4), "physical"), { kind: "manual", to: "targets", when: hit, text: "Add the target's Major threshold to the damage." }],
    }),
  ),
  // "Thorny Armor: When the Knight takes damage from an attack within Melee range, you can mark a Stress to deal 1d10+5
  // physical damage to the attacker."
  entry(
    "stag-knight",
    "Thorny Armor",
    reaction(
      { kind: "onDamaged", fromAttack: true, attackerWithin: "melee" },
      { costs: STRESS, targets: TRIGGER_SOURCE, steps: [{ kind: "damage", to: "targets", roll: roll(1, 10, 5), type: "physical" }] },
    ),
  ),

  // ---- Treant Sapling (Minion, CB p.232)
  // "Minion (6): The Sapling is defeated when they take any damage. For every 6 damage …"
  minion("treant-sapling", 6),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Treant Saplings within Close range of them. … they
  // deal 8 physical damage each. Combine this damage."
  groupAttack("treant-sapling", 8),

  // ---- Vampire (Standard, CB p.232)
  // "Draining Bite: Make an attack against a target within Melee range. On a success, deal 5d4 physical damage. A target
  // who marks HP from this attack loses a Hope and must mark a Stress. The Vampire then clears a HP."
  // Manual: what follows the target marking HP (HP is marked when the reaction window resolves; vocabulary gap).
  entry(
    "vampire",
    "Draining Bite",
    action({
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        damageOnHit(roll(5, 4), "physical"),
        { kind: "manual", to: "targets", when: hit, text: "If the target marks HP from this attack, they lose a Hope and mark a Stress, and the Vampire clears a HP." },
      ],
    }),
  ),
  // "Mistform: When the Vampire takes physical damage, you can spend a Fear to take half damage."
  entry("vampire", "Mistform", reaction({ kind: "onDamaged", stage: "would", damageType: "physical" }, { costs: FEAR, steps: [HALF_DAMAGE_TO_SELF] })),

  // ---- Vault Guardian Gaoler (Support, CB p.232)
  // "Blocking Shield: Creatures within Melee range of the Gaoler have disadvantage on attack rolls against them. Creatures
  // trapped inside the Gaoler are immune to this feature."
  // A passive while the GM confirms the attacker is within Melee range (and not trapped inside).
  entry(
    "vault-guardian-gaoler",
    "Blocking Shield",
    passive({
      requires: [{ kind: "situation", text: "The attacker is within Melee range of the Gaoler and not trapped inside it" }],
      modifiers: [{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" } }],
    }),
  ),
  // "Lock Up: Mark a Stress to make an attack against a target within Very Close range. On a success, the target is
  // Restrained within the Gaoler until freed with a successful Strength Roll (18). While Restrained, the target can only
  // attack the Gaoler."
  // Manual: "can only attack the Gaoler" (a rider on the bearer's actions).
  entry(
    "vault-guardian-gaoler",
    "Lock Up",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "condition", to: "targets", when: hit, condition: RESTRAINED, duration: "manual", endsWhen: "freed with a successful Strength Roll (18)" },
        { kind: "manual", to: "targets", when: hit, text: "While Restrained within the Gaoler, the target can only attack the Gaoler." },
      ],
    }),
  ),

  // ---- Vault Guardian Sentinel (Bruiser, CB p.232)
  // "Kinetic Slam: Targets who take damage from the Sentinel's standard attack are knocked back to Very Close range."
  entry(
    "vault-guardian-sentinel",
    "Kinetic Slam",
    auto(
      { kind: "onHit", attack: "standard" },
      { targets: TRIGGER_SUBJECT, steps: [{ kind: "move", to: "targets", mode: "knockBack", range: "veryClose", relativeTo: "self" }] },
    ),
  ),
  // "Box In: Mark a Stress to choose a target within Very Close range to focus on. That target has disadvantage on attack
  // rolls when they're within Very Close range of the Sentinel. The Sentinel can only focus on one target at a time."
  // Manual: the disadvantage on the bearer's attacks (vocabulary gap); a new focus ends the old one (the GM clears it).
  entry(
    "vault-guardian-sentinel",
    "Box In",
    action({
      costs: STRESS,
      targets: oneEnemy("veryClose"),
      steps: [
        { kind: "condition", to: "targets", condition: tag("Boxed In"), duration: "manual", endsWhen: "the Sentinel focuses on another target" },
        manual("Boxed In: disadvantage on attack rolls while within Very Close range of the Sentinel. The Sentinel focuses on one target at a time.", "targets"),
      ],
    }),
  ),
  // "Mana Bolt: Spend a Fear to lob explosive magic at a point within Far range. All targets within Very Close range of
  // that point must make an Agility Reaction Roll. Targets who fail take 2d8+20 magic damage and are knocked back to
  // Close range. Targets who succeed take half damage and aren't knocked back."
  entry(
    "vault-guardian-sentinel",
    "Mana Bolt",
    action({
      costs: FEAR,
      targets: allAroundPoint("far", "veryClose"),
      steps: [
        saveForHalf("agility", OWN_DIFFICULTY, roll(2, 8, 20), "magic", [
          { kind: "move", to: "targets", mode: "knockBack", range: "close", relativeTo: "point" },
        ]),
      ],
    }),
  ),
  // "Momentum: When the Sentinel makes a successful attack against a PC, you gain a Fear."
  momentum("vault-guardian-sentinel"),

  // ---- Vault Guardian Turret (Ranged, CB p.233)
  // "Slow Firing: When you spotlight the Turret and they don't have a token on their stat block, they can't make a
  // standard attack. Place a token on their stat block and describe what they're preparing to do. When you spotlight the
  // Turret and they have a token on their stat block, clear the token and they can attack."
  slow("vault-guardian-turret", "Slow Firing", "They can't make a standard attack", "they can attack"),
  // "Mark Target: Spend a Fear to Mark a target within Far range until the Turret is destroyed or the Marked target
  // becomes Hidden. While the target is Marked, their Evasion is halved."
  // Manual: the halved Evasion (vocabulary gap).
  entry(
    "vault-guardian-turret",
    "Mark Target",
    action({
      costs: FEAR,
      targets: oneEnemy("far"),
      steps: [
        { kind: "condition", to: "targets", condition: tag("Marked"), duration: "manual", endsWhen: "the Turret is destroyed or the target becomes Hidden" },
        manual("Marked: their Evasion is halved.", "targets"),
      ],
    }),
  ),
  // "Concentrate Fire: When another adversary deals damage to a target within Far range of the Turret, you can mark a
  // Stress to add the Turret's standard attack damage to the damage roll."
  // A fold on the other adversary's damage: the Turret's printed damage (3d10+3).
  entry(
    "vault-guardian-turret",
    "Concentrate Fire",
    reaction(
      { kind: "allyDealtDamage", range: "far" },
      { costs: STRESS, steps: [{ kind: "modifyDamage", to: "triggerSubject", change: { kind: "add", amount: diceOf(3, 10, 3) } }] },
    ),
  ),
  // "Detonation: When the Turret is destroyed, they explode. All targets within Close range must make an Agility Reaction
  // Roll. Targets who fail take 3d20 physical damage. Targets who succeed take half damage."
  entry(
    "vault-guardian-turret",
    "Detonation",
    reaction({ kind: "onDefeated" }, { targets: allAround("close"), steps: [saveForHalf("agility", OWN_DIFFICULTY, roll(3, 20), "physical")] }),
  ),

  // ---- Young Ice Dragon (Solo, CB p.233)
  // "Relentless (3): The Dragon can be spotlighted up to three times per GM turn. …"
  relentless("young-ice-dragon", 3),
  // "Rend and Crush: If a target damaged by the Dragon doesn't mark an Armor Slot to reduce the damage, they must mark a
  // Stress."
  // Manual: it depends on the target's armor answer in the reaction window (vocabulary gap).
  entry(
    "young-ice-dragon",
    "Rend and Crush",
    auto(
      { kind: "onDealDamage", toPc: true },
      { targets: TRIGGER_SUBJECT, steps: [manual("If the target didn't mark an Armor Slot to reduce the damage, they mark a Stress.", "targets")] },
    ),
  ),
  // "No Hope: When a PC rolls with Fear while within Far range of the Dragon, they lose a Hope."
  entry(
    "young-ice-dragon",
    "No Hope",
    auto({ kind: "pcRolls", result: "withFear", within: "far" }, { targets: TRIGGER_SUBJECT, steps: [{ kind: "hope", to: "targets", change: "lose", amount: one }] }),
  ),
  // "Blizzard Breath: Spend 2 Fear to release an icy whorl in front of the Dragon within Close range. All targets in this
  // area must make an Agility Reaction Roll. Targets who fail take 4d6+5 magic damage and are Restrained by ice until they
  // break free with a successful Strength Roll. Targets who succeed must mark 2 Stress or take half damage."
  // On a success the target picks (a `choose` the server asks the PC).
  entry(
    "young-ice-dragon",
    "Blizzard Breath",
    action({
      costs: TWO_FEAR,
      targets: allInFront("close"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "damage", to: "targets", roll: roll(4, 6, 5), type: "magic" },
            { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "they break free with a successful Strength Roll" },
          ],
          onSuccess: [
            {
              kind: "choose",
              id: "blizzard",
              label: "Mark 2 Stress or take half damage",
              options: [
                { id: "stress", label: "Mark 2 Stress", steps: [{ kind: "markStress", to: "targets", amount: fixed(2) }] },
                { id: "half", label: "Take half damage", steps: [{ kind: "damage", to: "targets", roll: roll(4, 6, 5), type: "magic", scale: "half" }] },
              ],
            },
          ],
        },
      ],
    }),
  ),
  // "Avalanche: Spend a Fear to have the Dragon unleash a huge downfall of snow and ice, covering all other creatures
  // within Far range. All targets within this area must succeed on an Instinct Reaction Roll or be buried in snow and
  // rocks, becoming Vulnerable until they dig themselves out from the debris. For each PC that fails the reaction roll,
  // you gain a Fear."
  entry(
    "young-ice-dragon",
    "Avalanche",
    action({
      costs: FEAR,
      targets: allAround("far"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: OWN_DIFFICULTY,
          onFail: [
            { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "they dig themselves out from the debris" },
            { kind: "fear", to: "self", change: "gain", amount: one },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // "Frozen Scales: When a creature makes a successful attack against the Dragon from within Very Close range, they must
  // mark a Stress and become Chilled until their next rest or they clear a Stress. While they are Chilled, they have
  // disadvantage on attack rolls."
  // Manual: the disadvantage on the bearer's attacks (vocabulary gap).
  entry(
    "young-ice-dragon",
    "Frozen Scales",
    reaction(
      { kind: "onAttacked", stage: "succeeded", attackerWithin: "veryClose" },
      {
        targets: TRIGGER_SOURCE,
        steps: [
          { kind: "markStress", to: "targets", amount: one },
          { kind: "condition", to: "targets", condition: tag("Chilled"), duration: "manual", endsWhen: "their next rest or they clear a Stress" },
          manual("Chilled: disadvantage on attack rolls.", "targets"),
        ],
      },
    ),
  ),
  // "Momentum: When the Dragon makes a successful attack against a PC, you gain a Fear."
  momentum("young-ice-dragon"),
];
