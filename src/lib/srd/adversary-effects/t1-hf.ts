// Adversary feature effects of tier 1 Hope & Fear adversaries (plan combat-actions, tracer AE-t1-hf; AA0 shipped it
// empty). Pure data: no framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 35
// adversaries, 103 features (HF p.62-69, printed pages; the Weredrake is Reign of the Weredragon, HF p.143). Each entry
// quotes its feature text in a comment; what the vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express
// is a `manual` step, never a vocabulary change. Readings, manual steps and open rulings: docs/tasks/TASK-CA-AE-t1-hf.md.
//
// Conventions used throughout (see the task doc):
// - Actions need the spotlight; passives and reactions don't (CB p.194). A printed reaction is a one-tap prompt
//   (`reaction`, Q19); a mandatory rider or a Fear gain is `auto` (Q19: "Fear gains automatic").
// - A trigger the engine can't see is a `situation` trigger (a GM button); its targets are picked, not the trigger's.
// - `trigger.source` is the creature who acted (the PC who moved, rolled or attacked); `trigger.subject` is the one the
//   event happened to (the PC this adversary hit, the creature who marked HP).
// - A Reaction Roll with no number uses the adversary's Difficulty (CB p.193: "If an adversary's feature doesn't specify
//   a Difficulty …, it always uses the adversary's Difficulty").
// - A condition that ends on a roll or an event ("until they succeed on a Strength Roll (10)") lasts `manual` with
//   `endsWhen`; the GM clears it in the tracker.
// - Stat-block tokens are the instance's `tokens` (the card `tokens` step and `tokens` requirement); a Pool's bonus is a
//   `stat attack` mod reading `cardTokens` (TASK-CA-AA1).

import type {
  AdversaryCost,
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryModifier,
  AdversaryRequirement,
  AdversaryStep,
} from "../../domain/adversary-effects/types";
import type {
  ConditionRef,
  DamageRoll,
  DieSides,
  BearerRider,
  Gate,
  Mod,
  NumberSource,
  OutcomeStep,
  Range,
  Recipient,
  RollSpec,
  StandardCondition,
  Step,
  TargetCount,
  TargetSpec,
  TriggerTargets,
} from "../../domain/card-effects/types";

// ---------------------------------------------------------------- helpers

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const roll = (count: number | NumberSource, sides: DieSides, plus?: number): DamageRoll => ({
  kind: "dice",
  dice: { count: typeof count === "number" ? fixed(count) : count, sides, ...(plus !== undefined ? { plus: fixed(plus) } : {}) },
});
const die = (sides: DieSides) => ({ count: fixed(1), sides });
const fear = (n = 1): AdversaryCost => ({ kind: "fear", amount: fixed(n) });
const stress = (n = 1): AdversaryCost => ({ kind: "stress", amount: fixed(n) });

/** "Make an attack against …": d20 + ATK against Evasion (AR1; the runner adds the stat block's ATK). */
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };
const ONE: TargetCount = { kind: "one" };
const ALL: TargetCount = { kind: "all" };
const enemy = (range: Range | "unlimited", count: TargetCount = ONE, extra: Partial<TargetSpec> = {}): TargetSpec => ({ side: "enemy", range, count, ...extra });
const SUBJECT: TriggerTargets = { side: "trigger", who: "subject" };
const SOURCE: TriggerTargets = { side: "trigger", who: "source" };
const HIT: readonly Gate[] = ["hit"];
/** Half the latest roll, rounded up (CB p.107 "round up unless otherwise specified"). */
const HALF_ROLL: NumberSource = { kind: "calc", of: { kind: "lastRoll" }, divide: 2, round: "up" };
/** The recipient holds at least one Hope. */
const HAS_HOPE = { kind: "track", who: "target", track: "hope", measure: "marked", atLeast: 1 } as const;
/**
 * Covered in Spiders (HF p.63): "roll a d6 when they make an action roll. On a result of 4 or higher, they must mark a
 * Stress or you gain a Fear." User answer (dcm-72qk (a), 2026-10-31): the PLAYER picks, in a two-half popup "Mark a
 * Stress" | "GM gains Fear". The rider runs on the bearer's own roll (`self` is the bearer), so its `choose` is the PC's.
 */
const SPIDERS: Step = {
  kind: "check",
  dice: { count: fixed(1), sides: 6 },
  test: { kind: "totalAtLeast", value: 4 },
  then: [
    {
      kind: "choose",
      id: "spiders",
      label: "The player picks: mark a Stress, or the GM gains a Fear",
      options: [
        { id: "stress", label: "Mark a Stress", steps: [{ kind: "markStress", to: "self", amount: fixed(1) }] },
        { id: "fear", label: "GM gains Fear", steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }] },
      ],
    },
  ],
  otherwise: [],
};
/**
 * Silent reminders (dcm-s9md): a PC's own action rolls don't run bearer riders yet (dcm-mm0f, PC-roll half), so the d6 and
 * the player's pick stay a manual step until that lands.
 */
const SPIDERS_TEXT =
  "While Covered in Spiders, the target rolls a d6 each time they make an action roll; on 4 or higher the player picks: mark a Stress, or the GM gains a Fear.";

const std = (condition: StandardCondition): ConditionRef => ({ kind: "standard", condition });
const tag = (name: string, implies?: readonly StandardCondition[]): ConditionRef => ({ kind: "tag", tag: name, ...(implies ? { implies } : {}) });
const situation = (text: string): AdversaryRequirement => ({ kind: "situation", text });
const manual = (text: string, to: Recipient = "self", when?: readonly Gate[]): AdversaryStep => ({ kind: "manual", to, text, ...(when ? { when } : {}) });
const physical = (r: DamageRoll, when: readonly Gate[] | undefined = HIT, extra: { direct?: boolean } = {}): AdversaryStep => ({
  kind: "damage",
  to: "targets",
  roll: r,
  type: "physical",
  ...(when ? { when } : {}),
  ...extra,
});
const magic = (r: DamageRoll, when: readonly Gate[] | undefined = HIT, extra: { direct?: boolean; scale?: "half"; keyword?: "fire" } = {}): AdversaryStep => ({
  kind: "damage",
  to: "targets",
  roll: r,
  type: "magic",
  ...(when ? { when } : {}),
  ...extra,
});
/** Plan lanes, SRD-A1: what a condition does to its bearer and the events that end it (dcm-kti, dcm-51s). */
type ConditionMore = Partial<Pick<Extract<OutcomeStep, { kind: "condition" }>, "mods" | "endsOn" | "endsOnCaster" | "endsOnRoll">>;
/** A condition on the targets that lasts until an event the engine doesn't track (cleared by hand). */
const until = (condition: ConditionRef, endsWhen: string, when: readonly Gate[] | undefined = HIT, to: Recipient = "targets", more: ConditionMore = {}): AdversaryStep => ({
  kind: "condition",
  to,
  condition,
  duration: "manual",
  endsWhen,
  ...(when ? { when } : {}),
  ...more,
});
const temporarily = (condition: ConditionRef, when: readonly Gate[] | undefined = HIT, to: Recipient = "targets", more: ConditionMore = {}): AdversaryStep => ({
  kind: "condition",
  to,
  condition,
  duration: "temporary",
  ...(when ? { when } : {}),
  ...more,
});
/** A rider on the condition's bearer (dcm-kti): in `steps` `self` is the bearer, `triggerSource` this adversary. */
const rider = (on: BearerRider["on"], steps: readonly Step[], extra: Omit<BearerRider, "on" | "steps"> = {}): Mod => ({ kind: "bearerRider", rider: { on, steps, ...extra } });
const STRESS_ON = (on: BearerRider["on"]): Mod => rider(on, [{ kind: "markStress", to: "self", amount: fixed(1) }]);
/** "until they roll with Hope" (an action roll with Hope, CB p.90). */
const UNTIL_HOPE: ConditionMore = { endsOnRoll: { roll: "action", result: "withHope" } };
/** "flees the scene" (dcm-icd): the adversary leaves the scene without being defeated. */
const flee = (who: string): AdversaryStep => ({ kind: "move", to: "self", mode: "leaveScene", note: `The ${who} flees the scene.` });

const action = (use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string }): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "action" },
  needsSpotlight: true,
  ...use,
});
const reaction = (
  trigger: Extract<AdversaryFeatureUse["activation"], { kind: "reaction" }>["trigger"],
  use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string },
): AdversaryFeatureUse => ({ id: "main", activation: { kind: "reaction", trigger }, needsSpotlight: false, ...use });
const auto = (
  trigger: Extract<AdversaryFeatureUse["activation"], { kind: "auto" }>["trigger"],
  use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string },
): AdversaryFeatureUse => ({ id: "main", activation: { kind: "auto", trigger }, needsSpotlight: false, ...use });
const passive = (modifiers: readonly AdversaryModifier[], extra: Partial<Omit<AdversaryFeatureUse, "activation" | "needsSpotlight" | "modifiers">> = {}): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "passive" },
  needsSpotlight: false,
  modifiers,
  steps: [],
  ...extra,
});
/** A passive the engine can only show: its words as a manual step (no modifier). */
const shown = (text: string, extra: Partial<Omit<AdversaryFeatureUse, "activation" | "needsSpotlight" | "steps">> = {}): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "passive" },
  needsSpotlight: false,
  ...extra,
  steps: [manual(text)],
});

const f = (adversaryId: string, feature: string, ...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({ adversaryId, feature, uses });

const relentless = (adversaryId: string, times: number) => f(adversaryId, `Relentless (${times})`, passive([{ kind: "relentless", times }]));
const minion = (adversaryId: string, threshold: number) => f(adversaryId, `Minion (${threshold})`, passive([{ kind: "minion", threshold }]));
const horde = (adversaryId: string, label: string, sides: DieSides, plus?: number) =>
  f(adversaryId, `Horde (${label})`, passive([{ kind: "horde", damage: roll(1, sides, plus) as Extract<DamageRoll, { kind: "dice" }> }]));
/** Minion Group Attack (AR9, CB p.201): X damage per Minion in the group, combined, one shared roll. */
const groupAttack = (adversaryId: string, x: DamageRoll): AdversaryFeatureEffect =>
  f(
    adversaryId,
    "Group Attack",
    action({
      costs: [fear()],
      roll: ATTACK,
      targets: enemy("unlimited"),
      groupAttack: { within: "close" },
      steps: [physical(x)],
    }),
  );
/** "A PC must mark a Stress to move out of the X's Melee range." */
const stickyMelee = (adversaryId: string, feature: string) =>
  f(adversaryId, feature, auto({ kind: "pcMoves", outOf: "melee" }, { targets: SOURCE, steps: [{ kind: "markStress", to: "targets", amount: fixed(1) }] }));

// ---------------------------------------------------------------- the table

export const T1_HF_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ======== Ahuizotl (Skulk, HF p.62)

  // Aquatic Attacker - Passive: "When the Ahuizotl attacks from the water, it has advantage on the attack and deals an
  // extra 1d6 damage." While the GM confirms the situation: advantage on its attacks and +1d6 to its standard attack.
  f("ahuizotl", "Aquatic Attacker", passive([{ kind: "mod", mod: { kind: "advantage", on: "attack" } }, { kind: "attackDamage", add: { kind: "dice", dice: die(6) } }], { requires: [situation("The Ahuizotl attacks from the water")] })),
  // Tail Swat - Action: "Mark a Stress to make an attack against a target within Very Close range. On a success, deal
  // 1d8+2 physical damage."
  f("ahuizotl", "Tail Swat", action({ costs: [stress()], roll: ATTACK, targets: enemy("veryClose"), steps: [physical(roll(1, 8, 2))] })),
  // Drag and Bag - Action: "Spend a Fear to have the Ahuizotl grab a target within Close range with its tail, pull the
  // target into Melee range, and temporarily Restrain them. The Ahuizotl has advantage on attacks against targets
  // Restrained in this way." No roll. The "Bagged" tag marks who was Restrained this way; its rider gives the Ahuizotl advantage (an attackedRider by the caster).
  f(
    "ahuizotl",
    "Drag and Bag",
    action({
      costs: [fear()],
      targets: enemy("close"),
      steps: [
        { kind: "move", to: "targets", mode: "pull", range: "melee", relativeTo: "self" },
        temporarily(tag("Bagged", ["restrained"]), undefined, "targets", { mods: [{ kind: "attackedRider", rider: { by: "caster", advantage: true } }] }),
      ],
    }),
  ),

  // ======== Atototl (Standard, HF p.62)

  // Wind Lord - Passive: "While the Atototl is flying, attacks against it is made with disadvantage."
  f("atototl", "Wind Lord", passive([{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" } }], { requires: [situation("The Atototl is flying")] })),
  // Stone of Omens - Passive: "Inside the Atototl is a stone that foretells good or ill fortune, depending on its color.
  // A PC who searches the Atototl's remains finds the stone and makes a fate roll. On an even result, the PC gains Hope
  // equal to half the result, which they can distribute among the PCs however they wish. On an odd result, you gain Fear
  // equal to half the result." A fate roll is one Duality Die, a d12 (CB p.168); even / odd is the check's parity
  // (dcm-27j). Half of an odd result rounds up (CB p.107 "round up unless otherwise specified"; user answer dcm-72qk (d)
  // 2026-10-31 keeps it). Plan lanes-2 S3.4 (dcm-nh44, after E7.4's dcm-mvgc): the targets are every PC and the Hope is
  // split among them; the GM's ask lists the split ("Divide the Hope gained") and takes the searching PC's shares.
  f(
    "atototl",
    "Stone of Omens",
    reaction(
      { kind: "situation", text: "A PC searches the Atototl's remains" },
      {
        targets: enemy("unlimited", ALL),
        steps: [
          {
            kind: "check",
            dice: die(12),
            test: { kind: "even" },
            note: "Fate roll (d12)",
            then: [{ kind: "hope", to: "targets", change: "gain", amount: HALF_ROLL, distribution: "split", note: "Distributed among the PCs however the searching PC wishes" }],
            otherwise: [{ kind: "fear", to: "self", change: "gain", amount: HALF_ROLL }],
          },
        ],
      },
    ),
  ),
  // Archer's Bane - Reaction: "When a creature beyond Very Close range would deal damage to the Atototl with a weapon
  // attack, you can spend a Fear to make an attack roll against them. On a success, whirling winds reflect the attack and
  // deal the attacker's damage back to them." Only weapon attacks (the trigger can't narrow that; the GM declines).
  f(
    "atototl",
    "Archer’s Bane",
    reaction(
      { kind: "onDamaged", stage: "would", fromAttack: true, attackerBeyond: "veryClose" },
      {
        costs: [fear()],
        roll: ATTACK,
        targets: SOURCE,
        steps: [
          { kind: "negate", to: "self", what: "damage", when: HIT, note: "The attack is reflected" },
          { kind: "damage", to: "targets", when: HIT, roll: { kind: "sameAsTrigger" }, type: "weapon", note: "The attacker's damage back to them" },
        ],
      },
    ),
  ),

  // ======== Bugboar (Bruiser, HF p.62)

  // Surprise! - Passive: "If the Bugboar makes its first attack in a scene before it's marked HP or Stress, it has
  // advantage on the attack and deals an extra 1d8 damage."
  f(
    "bugboar",
    "Surprise!",
    passive([{ kind: "mod", mod: { kind: "advantage", on: "attack" } }, { kind: "attackDamage", add: { kind: "dice", dice: die(8) } }], {
      requires: [{ kind: "hpMarkedAtMost", value: 0 }, { kind: "stressMarkedAtMost", value: 0 }, situation("The Bugboar's first attack in this scene")],
    }),
  ),
  // Brutal - Reaction: "When the Bugboar makes a successful standard attack, you can mark a Stress to deal an extra 1d6
  // damage." Folded into the hit's damage before the reaction window.
  f(
    "bugboar",
    "Brutal",
    reaction({ kind: "onHit", attack: "standard" }, { costs: [stress()], targets: SUBJECT, steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: die(6) } } }] }),
  ),
  // Warheart - Reaction: "When a condition would be imposed on the Bugboar, you can spend a Fear to negate it."
  f("bugboar", "Warheart", reaction({ kind: "wouldGainCondition" }, { costs: [fear()], steps: [{ kind: "negate", to: "self", what: "condition" }] })),

  // ======== Common Ruffian (Standard, HF p.62)

  // Group Attack - Action: "Spend a Fear to choose a target and spotlight all Ruffians within Close range of them. The
  // Ruffians move into Melee range of the target and make one shared attack roll. On a success, they deal 1d8 physical
  // damage each. Combine this damage." 1d8 is rolled once per Ruffian.
  groupAttack("common-ruffian", roll(1, 8)),
  // Survival Instinct - Reaction: "When the Ruffian marks half their HP, roll a d6. On a result of 4 or higher, the
  // Ruffian flees the scene. Otherwise, you gain a Fear."
  f(
    "common-ruffian",
    "Survival Instinct",
    reaction(
      { kind: "onHpMarkedAtLeast", value: "half" },
      { steps: [{ kind: "check", dice: die(6), test: { kind: "totalAtLeast", value: 4 }, then: [flee("Ruffian")], otherwise: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }] }] },
    ),
  ),

  // ======== Darkweave Crawler (Minion, HF p.63)

  // Minion (3) - Passive: "The Crawler is defeated when it takes any damage. For every 3 damage a PC deals to the
  // Crawler, the PC defeats an additional Minion within range the attack would succeed against."
  minion("darkweave-crawler", 3),
  // Skin-Crawling - Action: "Spend a Fear to force all PCs within Melee range of the Crawler to mark a Stress."
  f("darkweave-crawler", "Skin-Crawling", action({ costs: [fear()], targets: enemy("melee", ALL), steps: [{ kind: "markStress", to: "targets", amount: fixed(1) }] })),
  // Group Attack - Action: "… spotlight all Darkweave Crawlers within Close range of them. … On a success, they deal 2
  // physical damage each. Combine this damage."
  groupAttack("darkweave-crawler", { kind: "flat", amount: fixed(2) }),
  // Darkweave Venom - Reaction: "When the Crawler makes a successful attack, you can mark a Stress to Exhaust the target
  // until they succeed on a Strength Roll (9). While Exhausted, the target must mark a Stress each time they make an
  // action roll." The Stress per action roll is a rider on the tag (dcm-kti).
  f(
    "darkweave-crawler",
    "Darkweave Venom",
    reaction(
      { kind: "onHit", attack: "any" },
      {
        costs: [stress()],
        targets: SUBJECT,
        steps: [until(tag("Exhausted"), "they succeed on a Strength Roll (9)", undefined, "targets", { mods: [STRESS_ON("actionRoll")] })],
      },
    ),
  ),

  // ======== Darkweave Queen (Solo, HF p.63)

  // Relentless (3) - Passive: "The Queen can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight her."
  relentless("darkweave-queen", 3),
  // Den Mother - Action: "Once per scene, spend 2 Fear to summon up to two Darkweave adversaries (other than Darkweave
  // Queens), who appear within Close range and immediately take the spotlight."
  f(
    "darkweave-queen",
    "Den Mother",
    action({
      limit: { per: "scene" },
      costs: [fear(2)],
      steps: [
        { kind: "summon", label: "Up to two Darkweave adversaries (not Darkweave Queens)", count: fixed(2), range: "close" },
        { kind: "spotlight", who: "picked", note: "The summoned adversaries take the spotlight" },
      ],
    }),
  ),
  // Quicker Than She Looks - Action: "Spend a Fear to move up to Far range and make a standard attack with advantage."
  f(
    "darkweave-queen",
    "Quicker Than She Looks",
    action({
      costs: [fear()],
      roll: { ...ATTACK, advantage: true },
      targets: enemy("veryClose"),
      steps: [{ kind: "move", to: "self", mode: "move", range: "far" }, { kind: "damage", to: "targets", when: HIT, roll: { kind: "standardAttack" }, type: "weapon" }],
    }),
  ),
  // Darkfang Envenomation - Reaction: "When the Queen succeeds on a standard attack, you can spend a Fear to make the
  // target Vulnerable and Restrained until they succeed on a Strength Roll (12) or take a rest."
  f(
    "darkweave-queen",
    "Darkfang Envenomation",
    reaction(
      { kind: "onHit", attack: "standard" },
      {
        costs: [fear()],
        targets: SUBJECT,
        steps: [until(std("vulnerable"), "they succeed on a Strength Roll (12) or take a rest", undefined), until(std("restrained"), "they succeed on a Strength Roll (12) or take a rest", undefined)],
      },
    ),
  ),
  // Terrifying - Reaction: "When a PC fails an attack roll against the Queen, you gain a Fear." A Fear gain: automatic (Q19).
  f("darkweave-queen", "Terrifying", auto({ kind: "onAttacked", stage: "failed" }, { steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }] })),

  // ======== Darkweave Spinner (Standard, HF p.63)

  // Wrap in Shadow-Silk - Action: "Mark a Stress to make an attack against a target within Melee range. On a success,
  // the target is Vulnerable and Restrained until they succeed on a Strength Roll (10)."
  f(
    "darkweave-spinner",
    "Wrap in Shadow-Silk",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("melee"), steps: [until(std("vulnerable"), "they succeed on a Strength Roll (10)"), until(std("restrained"), "they succeed on a Strength Roll (10)")] }),
  ),
  // Shadow Fang - Reaction: "When the Spinner makes a successful attack against a target within Melee range, you can
  // spend a Fear to make the target Shaky until they succeed on an Instinct Roll (10). While Shaky, the target has
  // disadvantage on attack rolls." The disadvantage rides on the tag.
  f(
    "darkweave-spinner",
    "Shadow Fang",
    reaction(
      { kind: "onHit", attack: "any", within: "melee" },
      { costs: [fear()], targets: SUBJECT, steps: [until(tag("Shaky"), "they succeed on an Instinct Roll (10)", undefined, "targets", { mods: [{ kind: "disadvantage", on: "attack" }] })] },
    ),
  ),

  // ======== Darkweave Swarmlings (Horde, HF p.63)

  // Horde (1d4) - Passive: "When the Swarmlings have marked half or more of their HP, their standard attack deals 1d4
  // physical damage instead."
  horde("darkweave-swarmlings", "1d4", 4),
  // "Get 'em Off, Get 'em Off!" - Reaction: "When an attack from the Swarmlings causes a target to mark HP, you can mark
  // a Stress to make the target temporarily Covered in Spiders. While Covered in Spiders, the target must roll a d6 when
  // they make an action roll. On a result of 4 or higher, they must mark a Stress or you gain a Fear."
  f(
    "darkweave-swarmlings",
    "“Get ’em Off, Get ’em Off!”",
    reaction(
      { kind: "onTargetMarksHp", attack: "any" },
      {
        costs: [stress()],
        targets: SUBJECT,
        steps: [temporarily(tag("Covered in Spiders"), undefined, "targets", { mods: [rider("actionRoll", [SPIDERS])] }), manual(SPIDERS_TEXT, "targets")],
      },
    ),
  ),

  // ======== Elk (Skulk, HF p.64)

  // Headbutt - Passive: "When the Elk moves from Close range or farther before making a standard attack, it deals 1d12+2
  // physical damage instead of its standard damage." Offered as its standard attack with the replaced damage.
  f(
    "elk",
    "Headbutt",
    action({ id: "headbutt", requires: [situation("The Elk moved from Close range or farther before this attack")], roll: ATTACK, targets: enemy("melee"), steps: [physical(roll(1, 12, 2))] }),
  ),
  // Bolt - Reaction: "When the Elk marks a HP or Stress, it must succeed on a Reaction Roll (10) or flee the scene."
  // Mandatory: an automatic reaction roll (d20, CB p.161) after either mark.
  f(
    "elk",
    "Bolt",
    auto({ kind: "onMarkHp" }, { id: "hp", steps: [{ kind: "save", to: "self", difficulty: { kind: "fixed", value: 10 }, onFail: [flee("Elk")], onSuccess: [] }] }),
    auto({ kind: "onMarkStress" }, { id: "stress", steps: [{ kind: "save", to: "self", difficulty: { kind: "fixed", value: 10 }, onFail: [flee("Elk")], onSuccess: [] }] }),
  ),

  // ======== Falcon (Skulk, HF p.64)

  // Nimble Flyer - Passive: "While flying, the Falcon gains a +3 bonus to its Difficulty."
  f("falcon", "Nimble Flyer", passive([{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(3) } }], { requires: [situation("The Falcon is flying")] })),
  // Dive Bomb - Action: "Mark a Stress to make a standard attack against a target from above. The Falcon gains a +2
  // bonus to the attack and damage rolls."
  f(
    "falcon",
    "Dive Bomb",
    action({
      costs: [stress()],
      roll: { ...ATTACK, modifier: fixed(2) },
      targets: enemy("melee"),
      steps: [
        { kind: "damage", to: "targets", when: HIT, roll: { kind: "standardAttack" }, type: "weapon" },
        { kind: "modifyDamage", to: "targets", when: HIT, change: { kind: "add", amount: fixed(2) } },
      ],
    }),
  ),

  // ======== Grimmling Warband (Horde, HF p.64)

  // Horde (1d4+1) - Passive: "When the Warband has marked half or more of its HP, its standard attack deals 1d4+1
  // physical damage instead."
  horde("grimmling-warband", "1d4+1", 4, 1),
  // Cowardly - Reaction: "When the Warband marks its last Stress or an allied Leader is defeated, roll a d6. On a result
  // of 2 or lower, the Warband flees the scene." Two triggers; only a Leader ally counts (the GM declines for others).
  f(
    "grimmling-warband",
    "Cowardly",
    reaction({ kind: "onMarkStress", last: true }, { id: "last-stress", steps: [{ kind: "check", dice: die(6), test: { kind: "totalAtMost", value: 2 }, then: [flee("Warband")], otherwise: [] }] }),
    reaction({ kind: "allyDefeated" }, { id: "leader-defeated", steps: [{ kind: "check", dice: die(6), test: { kind: "totalAtMost", value: 2 }, then: [flee("Warband")], otherwise: [], note: "Only when the defeated ally is a Leader" }] }),
  ),

  // ======== Harpy (Skulk, HF p.64)

  // Toxic Aura - Passive: "The Harpy emits a foul stench that renders all non-Harpies Vulnerable while within Very Close
  // range." Every creature within Very Close range but other Harpies.
  f("harpy", "Toxic Aura", passive([{ kind: "conditionAura", condition: std("vulnerable"), to: "all", within: "veryClose" }])),
  // Swooping Attack - Action: "Mark a Stress to have the Harpy move in a straight line to a point within Far range and
  // make an attack against a target in the Harpy's path. On a success, the Harpy deals 3d6 physical damage."
  f(
    "harpy",
    "Swooping Attack",
    action({
      costs: [stress()],
      roll: ATTACK,
      targets: enemy("far", ONE, { area: "path" }),
      steps: [{ kind: "move", to: "self", mode: "move", range: "far", note: "Move in a straight line to a point within Far range" }, physical(roll(3, 6))],
    }),
  ),

  // ======== Kelpie (Skulk, HF p.64)

  // Captivating - Passive: "A PC must mark a Stress to move out of the Kelpie's Melee range."
  stickyMelee("kelpie", "Captivating"),
  // Heart's Desire - Passive: "After the Kelpie interacts with or watches a creature for at least a hundred heartbeats,
  // the Kelpie knows the physical form that creature would find most pleasing or alluring." Story only.
  f("kelpie", "Heart’s Desire", shown("After watching a creature for a hundred heartbeats, the Kelpie knows the form it finds most pleasing.")),
  // Shapeshifter - Action: "Mark a Stress to change the Kelpie's physical form into any creature or object smaller than a
  // wagon. A creature has disadvantage on rolls against the Kelpie while the Kelpie is in a form the creature finds
  // pleasing or alluring." The per-viewer disadvantage rides on its tag, confirmed by the GM (situation).
  f(
    "kelpie",
    "Shapeshifter",
    action({
      costs: [stress()],
      steps: [
        until(tag("Shapeshifted"), "it changes form again", undefined, "self", {
          mods: [{ kind: "disadvantageAgainst", on: "any", situation: "The roller finds the Kelpie's form pleasing or alluring" }],
        }),
      ],
    }),
  ),
  // Enchant - Action: "Spend a Fear to have the Kelpie beguile a PC within Close range. The PC must succeed on an Instinct
  // Reaction Roll or become Enchanted until they take damage. While Enchanted, the PC perceives the Kelpie as a trusted
  // friend or ally and will do what the Kelpie says unless it contradicts the PC's most deeply held morals."
  f(
    "kelpie",
    "Enchant",
    action({
      costs: [fear()],
      targets: enemy("close"),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: { kind: "actorDifficulty" },
          onFail: [until(tag("Enchanted"), "they take damage", undefined), manual("While Enchanted, the PC treats the Kelpie as a trusted friend and does what it says unless it contradicts their deepest morals.", "targets")],
          onSuccess: [],
        },
      ],
    }),
  ),

  // ======== Masque Muerte (Solo, HF p.65)

  // Libre - Passive: "The Masque Muerte can't be Restrained."
  f("masque-muerte", "Libre", passive([{ kind: "mod", mod: { kind: "flag", flag: "cannotBeRestrained" } }])),
  // Heel Turn - Action: "Mark a Stress to make an attack against a PC within Close range. On a success, the target must
  // mark a Stress and is temporarily Vulnerable as the Masque Muerte assaults them with a string of insulting taunts."
  f(
    "masque-muerte",
    "Heel Turn",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("close"), steps: [{ kind: "markStress", to: "targets", when: HIT, amount: fixed(1) }, temporarily(std("vulnerable"))] }),
  ),
  // Spectral Suplex - Action: "Spend a Fear to have the Masque Muerte suplex a Restrained PC, dealing 1d10+6 magic damage
  // to them." No roll and no range in the text; only a Restrained target takes the damage.
  f(
    "masque-muerte",
    "Spectral Suplex",
    action({ costs: [fear()], targets: enemy("unlimited"), steps: [magic(roll(1, 10, 6), [{ kind: "targetHas", condition: std("restrained") }])] }),
  ),
  // Unmasking Death - Action: "Spend a Fear to have the Masque Muerte momentarily remove their mask, revealing their
  // horrifying face underneath. Each PC within Close range must succeed on a Presence Reaction Roll or mark a Stress."
  f(
    "masque-muerte",
    "Unmasking Death",
    action({
      costs: [fear()],
      targets: enemy("close", ALL),
      steps: [{ kind: "save", to: "targets", trait: "presence", difficulty: { kind: "actorDifficulty" }, onFail: [{ kind: "markStress", to: "targets", amount: fixed(1) }], onSuccess: [] }],
    }),
  ),
  // Tag Team - Reaction: "When the Masque Muerte deals damage to a PC, you can spend a Fear to have a spectral wrestler
  // appear and Pin the target until they escape with a successful Strength Roll. While Pinned, the target is Restrained
  // and takes an extra 1d12 magic damage from the Masque Muerte's attacks." The extra 1d12 is an attackedRider by the caster (dcm-51s).
  f(
    "masque-muerte",
    "Tag Team",
    reaction(
      { kind: "onDealDamage", toPc: true },
      {
        costs: [fear()],
        targets: SUBJECT,
        steps: [
          until(tag("Pinned", ["restrained"]), "they escape with a successful Strength Roll", undefined, "targets", {
            mods: [{ kind: "attackedRider", rider: { by: "caster", damage: { kind: "add", amount: { kind: "dice", dice: die(12) }, type: "magic" } } }],
          }),
        ],
      },
    ),
  ),

  // ======== Mechanorb (Standard, HF p.65)

  // Hive Mind - Passive: "The Mechanorb gains a +1 bonus to their Difficulty for each other Mechanorb within Close range."
  // Plan lanes, SRD-A1 (dcm-ttz): the other Mechanorbs within Close range are counted.
  f(
    "mechanorb",
    "Hive Mind",
    passive([
      { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: { kind: "creatureCount", side: "allies", within: "close", name: "Mechanorb", excludeSelf: true } } },
    ]),
  ),
  // Adaptive Tactics - Passive: "Pool. When the Mechanorb fails an attack roll, add a token to the Mechanorb Pool. All
  // Mechanorbs in the scene gain a bonus to attack rolls equal to the number of tokens in the Mechanorb Pool. Clear all
  // tokens when any Mechanorb takes Severe damage or is defeated." The Pool is the instance's tokens (shared Pool: AA2,
  // TASK-CA-AA1 Q5); a Pool is empty when the scene begins and cleared when it ends (HF p.61).
  f(
    "mechanorb",
    "Adaptive Tactics",
    auto({ kind: "onMiss", attack: "any" }, { id: "add", steps: [{ kind: "tokens", to: "self", op: "add", amount: fixed(1) }] }),
    passive([{ kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "cardTokens" } } }], { id: "bonus" }),
    auto({ kind: "onDamaged", minSeverity: "severe" }, { id: "clear-severe", steps: [{ kind: "tokens", to: "self", op: "clear" }] }),
    auto({ kind: "onDefeated" }, { id: "clear-defeated", steps: [{ kind: "tokens", to: "self", op: "clear" }] }),
    auto({ kind: "allyDefeated", allyName: "Mechanorb" }, { id: "clear-ally-defeated", steps: [{ kind: "tokens", to: "self", op: "clear" }] }),
  ),

  // ======== Mountain Troll (Solo, HF p.65)

  // Relentless (3) - Passive: "The Troll can be spotlighted up to three times per GM turn. …"
  relentless("mountain-troll", 3),
  // Stolen Armor - Passive, Countdown: "When combat begins, activate a countdown with a value equal to the number of PCs.
  // When the Troll takes damage, reduce the severity by one threshold, then tick down the countdown. When it triggers,
  // the Troll evolves (see "Enraged Mountain Troll")." No number source counts the PCs: the GM enters the start value.
  f(
    "mountain-troll",
    "Stolen Armor",
    auto(
      { kind: "timing", at: "combatStart" },
      {
        id: "start",
        steps: [{ kind: "countdown", op: "start", label: "Stolen Armor", onTrigger: "The Troll evolves (Enraged Mountain Troll).", note: "Start value: the number of PCs" }],
      },
    ),
    auto(
      { kind: "onDamaged", stage: "would" },
      { id: "reduce", steps: [{ kind: "reduceSeverity", to: "self", steps: 1 }, { kind: "countdown", op: "tick", label: "Stolen Armor" }] },
    ),
  ),
  // Flail Swipe - Action: "Mark a Stress to make an attack against all targets in front of the Troll within Very Close
  // range. Targets the Troll succeeds against take 2d8+2 physical damage."
  f("mountain-troll", "Flail Swipe", action({ costs: [stress()], roll: ATTACK, targets: enemy("veryClose", ALL, { area: "front" }), steps: [physical(roll(2, 8, 2))] })),
  // Enraged Mountain Troll - Evolution: "The Troll loses their "Stolen Armor" and "Flail Swipe" features, then gains a +1
  // bonus to their Difficulty. Additionally, they gain the "Double Swipe" feature and replace "Skull Flail" with the
  // following standard attack: Claw Swipe: Very Close | 1d10+3 phy" When the Stolen Armor countdown triggers; once a
  // scene (HF p.61: "An adversary's evolution can't be triggered more than once in a scene"). The swap is a permanent
  // effect on itself (dcm-gx3): a new standard attack and the feature list changed.
  f(
    "mountain-troll",
    "Enraged Mountain Troll",
    reaction(
      { kind: "situation", text: "The Stolen Armor countdown triggers" },
      {
        limit: { per: "scene" },
        steps: [
          {
            kind: "effect",
            to: "self",
            label: "Enraged",
            mods: [
              { kind: "stat", stat: "difficulty", delta: fixed(1) },
              { kind: "features", remove: ["Stolen Armor", "Flail Swipe"], add: ["Double Swipe"] },
              { kind: "standardAttack", name: "Claw Swipe", range: "veryClose", damage: { count: fixed(1), sides: 10, plus: fixed(3) }, type: "physical" },
            ],
            duration: "permanent",
          },
        ],
      },
    ),
  ),
  // Double Swipe - Action: "Spend a Fear to move up to Close range and make two standard attacks against a target within
  // Melee range. If both attacks succeed, combine the damage, and the target loses a Hope." Only the Enraged Troll has it,
  // so its standard attack is Claw Swipe (1d10+3 phy). The second attack is a follow-up roll against the same target
  // (`followUp` = that target): after a hit it also costs a Hope; after a miss it deals its damage alone. Damage of two
  // hits lands as one incoming hit (combined).
  f(
    "mountain-troll",
    "Double Swipe",
    action({
      costs: [fear()],
      roll: ATTACK,
      targets: enemy("melee"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close" },
        physical(roll(1, 10, 3)),
        {
          kind: "followUp",
          when: ["hit"],
          roll: ATTACK,
          targets: enemy("melee"),
          steps: [physical(roll(1, 10)), { kind: "modifyDamage", to: "targets", when: HIT, change: { kind: "add", amount: fixed(3) } }, { kind: "hope", to: "targets", when: HIT, change: "lose", amount: fixed(1) }],
        },
        {
          kind: "followUp",
          when: ["miss"],
          roll: ATTACK,
          targets: enemy("melee"),
          steps: [physical(roll(1, 10)), { kind: "modifyDamage", to: "targets", when: HIT, change: { kind: "add", amount: fixed(3) } }],
        },
      ],
    }),
  ),

  // ======== Octopus (Skulk, HF p.66)

  // Grapple - Action: "Make an attack roll against a target within Close range. On a success, the target becomes
  // Restrained and Vulnerable until they escape with a successful Strength Roll."
  f(
    "octopus",
    "Grapple",
    action({ roll: ATTACK, targets: enemy("close"), steps: [until(std("restrained"), "they escape with a successful Strength Roll"), until(std("vulnerable"), "they escape with a successful Strength Roll")] }),
  ),
  // Squirt Ink - Action: "Mark a Stress to have the Octopus squirt ink. On land, the ink covers the ground within Very
  // Close range. Each creature who moves through that area must succeed on an Agility Reaction Roll or slip and fall,
  // becoming Vulnerable until they exit the area. If this feature is used while the Octopus is underwater, it instead
  // creates a cloud of darkness that fills an area within Very Close range and blocks line of sight." Each is an area
  // placed where the Octopus stands (dcm-cma, dcm-wuu): the ink's reaction roll on entering; the cloud blocks sight.
  f(
    "octopus",
    "Squirt Ink",
    action({
      costs: [stress()],
      steps: [
        {
          kind: "choose",
          id: "where",
          label: "On land or underwater?",
          options: [
            {
              id: "land",
              label: "On land",
              steps: [
                {
                  kind: "area",
                  to: "self",
                  area: {
                    label: "Ink",
                    centre: "point",
                    placeWithin: "melee",
                    radius: "veryClose",
                    side: "all",
                    duration: "scene",
                    onEnter: [
                      {
                        kind: "save",
                        to: "triggerSubject",
                        trait: "agility",
                        difficulty: { kind: "actorDifficulty" },
                        onFail: [{ kind: "condition", to: "triggerSubject", condition: std("vulnerable"), duration: "manual", endsWhen: "until they exit the area" }],
                        onSuccess: [],
                      },
                    ],
                  },
                },
              ],
            },
            {
              id: "underwater",
              label: "Underwater",
              steps: [{ kind: "area", to: "self", area: { label: "Cloud of darkness", centre: "point", placeWithin: "melee", radius: "veryClose", side: "all", blocksSight: true, duration: "scene" } }],
            },
          ],
        },
      ],
    }),
  ),

  // ======== Panther (Skulk, HF p.66)

  // Shadow Stalker - Passive: "While Hidden, the Panther gains a +2 bonus to its attack rolls."
  f("panther", "Shadow Stalker", passive([{ kind: "mod", mod: { kind: "stat", stat: "attack", delta: fixed(2) } }], { requires: [{ kind: "hasCondition", condition: std("hidden") }] })),
  // Pouncing Strike - Action: "Mark a Stress to have the Panther leap into Melee range of a target within Far range and
  // make an attack against them. On a success, deal 1d12+2 physical damage."
  f(
    "panther",
    "Pouncing Strike",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("far"), steps: [{ kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target" }, physical(roll(1, 12, 2))] }),
  ),

  // ======== Phantom (Standard, HF p.66)

  // Incorporeal - Passive: "The Phantom has resistance to physical damage and can move through solid objects."
  f("phantom", "Incorporeal", passive([{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }], { steps: [manual("The Phantom can move through solid objects.")] })),
  // Fear Aura - Passive: "A PC who takes the spotlight within Very Close range of the Phantom must succeed on a Presence
  // Reaction Roll (10) or mark a Stress." No trigger for a PC taking the spotlight: a GM button against the picked PC.
  f(
    "phantom",
    "Fear Aura",
    reaction(
      { kind: "situation", text: "A PC takes the spotlight within Very Close range of the Phantom" },
      {
        targets: enemy("veryClose"),
        steps: [{ kind: "save", to: "targets", trait: "presence", difficulty: { kind: "fixed", value: 10 }, onFail: [{ kind: "markStress", to: "targets", amount: fixed(1) }], onSuccess: [] }],
      },
    ),
  ),
  // Lingering Haunt - Reaction, Countdown (1d6): "When the Phantom is defeated, you can spend a Fear to activate the
  // countdown. It ticks down when a PC rolls with Fear. When it triggers, clear the Phantom's HP and immediately
  // spotlight them." The "Lingering Haunt" tag on the instance tells the tick and the return that the countdown runs.
  f(
    "phantom",
    "Lingering Haunt",
    reaction(
      { kind: "onDefeated" },
      {
        id: "activate",
        costs: [fear()],
        steps: [
          { kind: "countdown", op: "start", label: "Lingering Haunt", start: { kind: "dice", dice: die(6) }, onTrigger: "Clear the Phantom's HP and immediately spotlight them." },
          until(tag("Lingering Haunt"), "the countdown triggers", undefined, "self"),
        ],
      },
    ),
    auto(
      { kind: "pcRolls", result: "withFear" },
      { id: "tick", requires: [{ kind: "hasCondition", condition: tag("Lingering Haunt") }], steps: [{ kind: "countdown", op: "tick", label: "Lingering Haunt" }] },
    ),
    reaction(
      { kind: "situation", text: "The Lingering Haunt countdown triggers" },
      {
        id: "return",
        requires: [{ kind: "hasCondition", condition: tag("Lingering Haunt") }],
        steps: [
          { kind: "clear", to: "self", track: "hp", amount: { kind: "marked", who: "self", track: "hp" } },
          { kind: "clearCondition", to: "self", condition: tag("Lingering Haunt") },
          { kind: "spotlight", who: "self" },
        ],
      },
    ),
  ),

  // ======== Poltergeist (Ranged, HF p.66)

  // Specter - Passive: "The Poltergeist has resistance to physical damage. Mark a Stress to move up to Close range
  // through solid objects."
  f(
    "poltergeist",
    "Specter",
    passive([{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } }]),
    action({ id: "move", costs: [stress()], steps: [{ kind: "move", to: "self", mode: "move", range: "close", note: "Move up to Close range through solid objects" }] }),
  ),
  // Possessor - Action: "Mark a Stress to have the Poltergeist inhabit a nonmagical object that is entirely within Close
  // range, infusing the object with a ghostly glow. The next time the Poltergeist would take damage, the object is
  // destroyed instead, and the Poltergeist is expelled from it."
  f(
    "poltergeist",
    "Possessor",
    action({ costs: [stress()], steps: [until(tag("Possessing"), "the next time it would take damage", undefined, "self")] }),
    auto(
      { kind: "onDamaged", stage: "would" },
      {
        id: "expelled",
        requires: [{ kind: "hasCondition", condition: tag("Possessing") }],
        steps: [{ kind: "negate", to: "self", what: "damage", note: "The object is destroyed instead" }, { kind: "clearCondition", to: "self", condition: tag("Possessing") }],
      },
    ),
  ),
  // Ghost Storm - Action: "Spend a Fear to have the Poltergeist pull all unequipped nonmagical objects within Very Close
  // range into a violent vortex. Each target in that area must make an Agility Reaction Roll. Targets who fail take
  // 1d12+2 physical damage. Targets who succeed take half damage."
  f(
    "poltergeist",
    "Ghost Storm",
    action({
      costs: [fear()],
      targets: enemy("veryClose", ALL),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "actorDifficulty" },
          onFail: [physical(roll(1, 12, 2), undefined)],
          onSuccess: [{ kind: "damage", to: "targets", roll: roll(1, 12, 2), type: "physical", scale: "half" }],
        },
      ],
    }),
  ),

  // ======== Rabble Mawb (Horde, HF p.66)

  // Horde (1d4+1) - Passive: "When the Rabble Mawb has marked half or more of its HP, its standard attack deals 1d4+1
  // physical damage instead."
  horde("rabble-mawb", "1d4+1", 4, 1),
  // Come Back Worse - Reaction: "When the Rabble Mawb is defeated, you can spend a Fear to bring it back to life, clearing
  // all HP and Stress. The Rabble Mawb gains a bonus to all rolls equal to the number of times this feature has been
  // used by this Rabble Mawb." Each use adds a lasting +1 (attack rolls; its reaction rolls by hand).
  f(
    "rabble-mawb",
    "Come Back Worse",
    reaction(
      { kind: "onDefeated" },
      {
        costs: [fear()],
        steps: [
          { kind: "clear", to: "self", track: "hp", amount: { kind: "marked", who: "self", track: "hp" } },
          { kind: "clear", to: "self", track: "stress", amount: { kind: "marked", who: "self", track: "stress" } },
          { kind: "effect", to: "self", label: "Come Back Worse (+1 to all rolls)", mods: [{ kind: "stat", stat: "attack", delta: fixed(1) }], duration: "permanent" },
        ],
      },
    ),
  ),

  // ======== Redcap Biters (Horde, HF p.67)

  // Horde (1d4+2) - Passive: "When the Biters have marked half or more of their HP, their standard attack deals 1d4+2
  // physical damage instead."
  horde("redcap-biters", "1d4+2", 4, 2),
  // Ankle Weights - Passive: "A PC must mark a Stress to move out of the Biters' Melee range."
  stickyMelee("redcap-biters", "Ankle Weights"),

  // ======== Redcap Breaker (Bruiser, HF p.67)

  // Backbreaker - Action: "Mark a Stress to make an attack against a target within Melee range. On a success, deal
  // 3d4+10 physical damage. A target who marks HP from this attack is Restrained until they clear a HP." A PC marks HP
  // only when the reaction window resolves, so the Restrain is a second use on that event (the GM confirms it was this
  // attack).
  f(
    "redcap-breaker",
    "Backbreaker",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("melee"), steps: [physical(roll(3, 4, 10))] }),
    reaction({ kind: "onTargetMarksHp", attack: "any" }, { id: "restrain", targets: SUBJECT, steps: [until(std("restrained"), "they clear a HP", undefined)] }),
  ),
  // Kneecapper - Reaction: "When the Breaker makes a successful standard attack, you can spend a Fear to make the target
  // temporarily Vulnerable."
  f("redcap-breaker", "Kneecapper", reaction({ kind: "onHit", attack: "standard" }, { costs: [fear()], targets: SUBJECT, steps: [temporarily(std("vulnerable"), undefined)] })),

  // ======== Redcap Butcher (Standard, HF p.67)

  // Chop Happy - Action: "Mark a Stress to make a standard attack against up to three targets. For each target who marks
  // HP, you gain a Fear." One roll against all three (AR7); the Fear per target who marks HP is a second use on that
  // event (the GM confirms it was this attack).
  f(
    "redcap-butcher",
    "Chop Happy",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("melee", { kind: "upTo", n: fixed(3) }), steps: [{ kind: "damage", to: "targets", when: HIT, roll: { kind: "standardAttack" }, type: "weapon" }] }),
    reaction({ kind: "onTargetMarksHp", attack: "standard" }, { id: "fear", steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }] }),
  ),
  // Knife Thrower - Action: "Mark a Stress to make a standard attack against a target within Far range. If the Butcher
  // is Hidden, they make the attack with advantage."
  f(
    "redcap-butcher",
    "Knife Thrower",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("far"), steps: [{ kind: "damage", to: "targets", when: HIT, roll: { kind: "standardAttack" }, type: "weapon" }] }),
    action({
      id: "hidden",
      requires: [{ kind: "hasCondition", condition: std("hidden") }],
      costs: [stress()],
      roll: { ...ATTACK, advantage: true },
      targets: enemy("far"),
      steps: [{ kind: "damage", to: "targets", when: HIT, roll: { kind: "standardAttack" }, type: "weapon" }],
    }),
  ),

  // ======== Redcap Candlemaker (Leader, HF p.67)

  // Hand of Glory - Passive: "When the Candlemaker appears, place 5 tokens on this stat block. Remove a token whenever the
  // Candlemaker marks a HP. While this stat block has 1 or more tokens on it, the Candlemaker is Hidden." One token per
  // HP marked; Hidden while a token is left is a passive condition on itself (dcm-cdz).
  f(
    "redcap-candlemaker",
    "Hand of Glory",
    auto({ kind: "timing", at: "appears" }, { id: "appear", steps: [{ kind: "tokens", to: "self", op: "set", amount: fixed(5) }] }),
    auto({ kind: "onMarkHp" }, { id: "burn", requires: [{ kind: "tokens", atLeast: 1 }], steps: [{ kind: "tokens", to: "self", op: "spend", amount: { kind: "triggerAmount" } }] }),
    passive([{ kind: "selfCondition", condition: std("hidden") }], { id: "hidden", requires: [{ kind: "tokens", atLeast: 1 }] }),
  ),
  // Torchbearer - Passive: "The light of the Candlemaker's Hand of Glory inspires bloodlust in their allies. While this
  // stat block has 1 or more tokens on it, each Redcap adversary within Close range gains a +1 bonus to their damage
  // rolls." Redcap allies only.
  f("redcap-candlemaker", "Torchbearer", passive([{ kind: "mod", mod: { kind: "stat", stat: "damage", delta: fixed(1) }, to: "allies", within: "close" }], { requires: [{ kind: "tokens", atLeast: 1 }] })),
  // Dance in the Flames - Action: "Spend a token from this stat block. The Candlemaker conjures a ball of fire on a group
  // of PCs within Far range. Each target must make an Agility Reaction Roll. Targets who fail take 2d10 magic damage.
  // Targets who succeed take half damage." `AdversaryCost` has no token cost: a token requirement and a spend step. A ball
  // of fire: the damage carries the fire keyword (Fireproof, HF p.22; dcm-dv6).
  f(
    "redcap-candlemaker",
    "Dance in the Flames",
    action({
      requires: [{ kind: "tokens", atLeast: 1 }],
      targets: enemy("far", ALL, { area: "aroundPoint", areaRange: "veryClose" }),
      steps: [
        { kind: "tokens", to: "self", op: "spend", amount: fixed(1) },
        {
          kind: "save",
          to: "targets",
          trait: "agility",
          difficulty: { kind: "actorDifficulty" },
          onFail: [magic(roll(2, 10), undefined, { keyword: "fire" })],
          onSuccess: [magic(roll(2, 10), undefined, { scale: "half", keyword: "fire" })],
        },
      ],
    }),
  ),

  // ======== Redcap Skinner (Minion, HF p.67)

  // Minion (4) - Passive: "The Skinner is defeated when they take any damage. For every 4 damage a PC deals to the
  // Skinner, the PC defeats an additional Minion within range the attack would succeed against."
  minion("redcap-skinner", 4),
  // Shallow Cuts - Passive: "When a PC fails a roll, they take 1 physical damage for each Skinner within Melee range of
  // them. Combine this damage." The Skinners within Melee range of the PC are counted (dcm-ttz): one hit.
  f(
    "redcap-skinner",
    "Shallow Cuts",
    reaction(
      { kind: "pcRolls", result: "failure" },
      { targets: SOURCE, steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount: { kind: "creatureCount", side: "allies", name: "Redcap Skinner", within: "melee", of: "target" } }, type: "physical" }] },
    ),
  ),
  // Group Attack - Action: "… spotlight all Redcap Skinners within Close range of them. … On a success, they deal 2
  // physical damage each. Combine this damage."
  groupAttack("redcap-skinner", { kind: "flat", amount: fixed(2) }),

  // ======== Rugaru (Solo, HF p.68)

  // Relentless (3) - Passive: "The Rugaru can be spotlighted up to three times per GM turn. …"
  relentless("rugaru", 3),
  // Child of Night - Passive: "While in moonlight, the Rugaru gains a +2 bonus to their Difficulty."
  f("rugaru", "Child of Night", passive([{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(2) } }], { requires: [situation("The Rugaru is in moonlight")] })),
  // Bloodthirsty - Passive: "When a PC marks HP from the Rugaru's standard attack, add a token to this stat block. The
  // Rugaru gains a bonus to attack rolls equal to the number of tokens on this stat block. Clear all tokens when the
  // Rugaru takes Severe damage."
  f(
    "rugaru",
    "Bloodthirsty",
    auto({ kind: "onTargetMarksHp", attack: "standard" }, { id: "add", steps: [{ kind: "tokens", to: "self", op: "add", amount: fixed(1) }] }),
    passive([{ kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "cardTokens" } } }], { id: "bonus" }),
    auto({ kind: "onDamaged", minSeverity: "severe" }, { id: "clear", steps: [{ kind: "tokens", to: "self", op: "clear" }] }),
  ),
  // Howl at the Moon - Action: "Mark a Stress to force each PC within Far range to make a Presence Reaction Roll (15).
  // Targets who fail lose a Hope. Gain a Fear for each Hope lost. If a PC has no Hope, they must mark a Stress and become
  // Vulnerable until they roll with Hope." Read as: a PC who fails with no Hope to lose marks a Stress and becomes
  // Vulnerable instead (`hope.ifUnable`, dcm-5xi); the Fear comes only for a Hope lost (gated on the Hope held).
  f(
    "rugaru",
    "Howl at the Moon",
    action({
      costs: [stress()],
      targets: enemy("far", ALL),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "presence",
          difficulty: { kind: "fixed", value: 15 },
          onFail: [
            { kind: "fear", to: "self", change: "gain", amount: fixed(1), when: [{ kind: "targetCheck", check: HAS_HOPE }], note: "A Fear for each Hope lost" },
            {
              kind: "hope",
              to: "targets",
              change: "lose",
              amount: fixed(1),
              ifUnable: [
                { kind: "markStress", to: "targets", amount: fixed(1) },
                { kind: "condition", to: "targets", condition: std("vulnerable"), duration: "manual", endsWhen: "until they roll with Hope", endsOnRoll: { roll: "action", result: "withHope" } },
              ],
            },
          ],
          onSuccess: [],
        },
      ],
    }),
  ),
  // Flesh Ripper - Action: "Mark a Stress to make an attack against a target within Melee range. On a success, deal
  // 1d12+2 direct physical damage."
  f("rugaru", "Flesh Ripper", action({ costs: [stress()], roll: ATTACK, targets: enemy("melee"), steps: [physical(roll(1, 12, 2), HIT, { direct: true })] })),

  // ======== Sawtoothed Gillbeast (Standard, HF p.68)

  // Ka-Chomp - Action: "Mark a Stress to attack a target within Melee range. On a success, the target takes 1d12 physical
  // damage and must mark an Armor Slot without gaining its benefit (they can still use armor to reduce the damage)."
  f(
    "sawtoothed-gillbeast",
    "Ka-Chomp",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("melee"), steps: [physical(roll(1, 12)), { kind: "markArmor", to: "targets", when: HIT, amount: fixed(1), noBenefit: true }] }),
  ),
  // Feeding Frenzy - Reaction: "When a creature marks HP, you can spend a Fear to spotlight all Sawtoothed Gillbeasts
  // within Very Close range of them. Those Gillbeasts move into Melee range of the creature and each make a standard
  // attack against them. If any attacks succeed, combine their damage." "A creature": a PC or an adversary. Each
  // Gillbeast's own roll, combined, is manual (eachRolls isn't run yet, dcm-1ch).
  f(
    "sawtoothed-gillbeast",
    "Feeding Frenzy",
    ...(["pc", "ally"] as const).map((who) =>
      reaction(who === "pc" ? { kind: "pcMarksHp" } : { kind: "allyMarksHp" }, {
        id: who,
        costs: [fear()],
        targets: SUBJECT,
        steps: [
          { kind: "spotlight", who: "sameName", name: "Sawtoothed Gillbeast", within: "veryClose" },
          manual("Those Gillbeasts move into Melee range of the creature and each make a standard attack against them; combine the damage of the attacks that succeed.", "targets"),
        ],
      }),
    ),
  ),
  // Scaly - Reaction: "When the Gillbeast would mark any number of HP, roll a d6. On a result of 6, you can mark a Stress
  // instead."
  f(
    "sawtoothed-gillbeast",
    "Scaly",
    reaction(
      { kind: "onMarkHp", stage: "would" },
      { steps: [{ kind: "check", dice: die(6), test: { kind: "anyAtLeast", value: 6 }, then: [{ kind: "convertMarks", to: "self", from: "hp", into: "stress", note: "Mark a Stress instead of the HP" }], otherwise: [] }] },
    ),
  ),

  // ======== Soul-Shattered Mage (Solo, HF p.68)

  // Relentless (3) - Passive: "The Mage can be spotlighted up to three times per GM turn. …"
  relentless("soul-shattered-mage", 3),
  // Broken Magic - Action: "Mark a Stress to roll a d6. The Mage uses the corresponding move: 1–2: Dimension Rift. Choose
  // a target within Far range. The target teleports to a point you choose within Close range of their original position
  // and takes 2d6 direct magic damage as their body and mind reassemble. 3–4: Time Dilation. Choose a group of PCs within
  // Far range. Each target is Slowed until they roll with Hope. While Slowed, a target is Vulnerable and must mark a
  // Stress when they move. 5–6: Discordant Visions. Make an attack against up to three targets within Close range.
  // Targets the Mage succeeds against take 2d8 direct magic damage." The d6 is a check table (dcm-27j): its row runs that
  // move; each move has its own targets (`followUp`).
  f(
    "soul-shattered-mage",
    "Broken Magic",
    action({
      costs: [stress()],
      steps: [
        {
          kind: "check",
          dice: die(6),
          test: { kind: "totalAtLeast", value: 1 },
          note: "Roll a d6: 1–2 Dimension Rift, 3–4 Time Dilation, 5–6 Discordant Visions",
          table: [
            {
              atLeast: 1,
              atMost: 2,
              label: "Dimension Rift",
              steps: [
                {
                  kind: "followUp",
                  targets: enemy("far"),
                  steps: [
                    { kind: "move", to: "targets", mode: "teleport", range: "close", relativeTo: "target" },
                    { kind: "damage", to: "targets", roll: roll(2, 6), type: "magic", direct: true },
                  ],
                },
              ],
            },
            {
              atLeast: 3,
              atMost: 4,
              label: "Time Dilation",
              steps: [
                {
                  kind: "followUp",
                  targets: enemy("far", ALL, { area: "aroundPoint", areaRange: "veryClose" }),
                  steps: [
                    {
                      kind: "condition",
                      to: "targets",
                      condition: tag("Slowed", ["vulnerable"]),
                      duration: "manual",
                      endsWhen: "they roll with Hope",
                      ...UNTIL_HOPE,
                      mods: [STRESS_ON("moves")],
                    },
                  ],
                },
              ],
            },
            {
              atLeast: 5,
              atMost: 6,
              label: "Discordant Visions",
              // The runner adds the stat block's ATK (+2) to a follow-up attack inside a check table row (dcm-b3bb, dcm-6n0p).
              steps: [
                {
                  kind: "followUp",
                  roll: ATTACK,
                  targets: enemy("close", { kind: "upTo", n: fixed(3) }),
                  steps: [{ kind: "damage", to: "targets", when: HIT, roll: roll(2, 8), type: "magic", direct: true }],
                },
              ],
            },
          ],
          then: [],
          otherwise: [],
        },
      ],
    }),
  ),
  // Feel My Pain - Reaction: "When the Mage marks HP, roll a number of d6s equal to the number of Stress the Mage has
  // marked. The Mage deals direct magic damage equal to the total result to all PCs within Very Close range."
  f(
    "soul-shattered-mage",
    "Feel My Pain",
    reaction({ kind: "onMarkHp" }, { targets: enemy("veryClose", ALL), steps: [magic(roll({ kind: "marked", who: "self", track: "stress" }, 6), undefined, { direct: true })] }),
  ),

  // ======== Spellbound Armor (Bruiser, HF p.68)

  // Tireless - Passive: "The Armor can't be forced to mark Stress. When an effect would cause it to mark Stress, the
  // Armor ignores that part of the effect." A flag (dcm-yea); it has no Stress track either.
  f("spellbound-armor", "Tireless", passive([{ kind: "mod", mod: { kind: "flag", flag: "noForcedStress" } }])),
  // Clatter & Recombobulate - Reaction: "Once per scene when the Armor is defeated, you can spend a Fear to reactivate
  // it. Clear 2 HP and immediately spotlight it."
  f(
    "spellbound-armor",
    "Clatter & Recombobulate",
    reaction({ kind: "onDefeated" }, { limit: { per: "scene" }, costs: [fear()], steps: [{ kind: "clear", to: "self", track: "hp", amount: fixed(2) }, { kind: "spotlight", who: "self" }] }),
  ),

  // ======== Viper (Minion, HF p.69)

  // Minion (4) - Passive: "The Viper is defeated when it takes any damage. For every 4 damage a PC deals to the Viper, the
  // PC defeats an additional Minion within range the attack would succeed against."
  minion("viper", 4),
  // Venomous - Passive: "When the Viper makes a successful standard attack, the target becomes temporarily Envenomated.
  // While Envenomated, the target must mark a Stress whenever they make an action roll." A rider: automatic.
  f(
    "viper",
    "Venomous",
    auto({ kind: "onHit", attack: "standard" }, { targets: SUBJECT, steps: [temporarily(tag("Envenomated"), undefined, "targets", { mods: [STRESS_ON("actionRoll")] })] }),
  ),
  // Group Attack - Action: "… spotlight all Vipers within Close range of them. … On a success, they deal 1 physical
  // damage each. Combine this damage."
  groupAttack("viper", { kind: "flat", amount: fixed(1) }),

  // ======== Waxwork Creation (Solo, HF p.69)

  // Relentless (2) - Passive: "The Creation can be spotlighted up to two times per GM turn. …"
  relentless("waxwork-creation", 2),
  // No Vital Organs - Passive: "The Creation doesn't take extra damage from attacks that critically succeed against it."
  // A flag (dcm-yea).
  f("waxwork-creation", "No Vital Organs", passive([{ kind: "mod", mod: { kind: "flag", flag: "noCritDamage" } }])),
  // Wax Ball - Action: "Mark a Stress to have the Creation throw a ball of wax at a target within Far range. Make an
  // attack against the target. On a success, the target takes 1d12+2 physical damage and becomes Restrained until they
  // succeed on a Strength Roll (15)."
  f("waxwork-creation", "Wax Ball", action({ costs: [stress()], roll: ATTACK, targets: enemy("far"), steps: [physical(roll(1, 12, 2)), until(std("restrained"), "they succeed on a Strength Roll (15)")] })),
  // Splutch! - Reaction: "When a PC within Melee range of the Creation makes a weapon attack against it, roll a d6. On a 5
  // or higher, the attacker's weapon gets stuck in the Creation and can be removed only with a successful Strength Roll
  // (15)."
  f(
    "waxwork-creation",
    "Splutch!",
    reaction(
      { kind: "onAttacked", stage: "targeted", attackerWithin: "melee", weapon: true },
      { targets: SOURCE, steps: [{ kind: "check", dice: die(6), test: { kind: "anyAtLeast", value: 5 }, then: [until(tag("Weapon stuck"), "a successful Strength Roll (15)", undefined)], otherwise: [] }] },
    ),
  ),
  // Smothering Grapple - Reaction: "When the Creation makes a successful standard attack against a target within Melee
  // range, you can spend a Fear to Trap the target inside the Creation's wax body. While Trapped, the target is
  // Restrained and must mark a Stress and move with the Creation each time it's spotlighted. A Trapped creature is freed
  // when the Creation takes Major or greater damage." A rider on its spotlight (`casterSpotlit`, dcm-51s) and an end on
  // its Major damage (`endsOnCaster`).
  f(
    "waxwork-creation",
    "Smothering Grapple",
    reaction(
      { kind: "onHit", attack: "standard", within: "melee" },
      {
        costs: [fear()],
        targets: SUBJECT,
        steps: [
          until(tag("Trapped", ["restrained"]), "the Creation takes Major or greater damage", undefined, "targets", {
            endsOnCaster: ["majorDamage"],
            mods: [
              rider("casterSpotlit", [
                { kind: "markStress", to: "self", amount: fixed(1) },
                { kind: "move", to: "self", mode: "move", relativeTo: "triggerSource", note: "The Trapped target moves with the Creation" },
              ]),
            ],
          }),
        ],
      },
    ),
  ),

  // ======== Weredrake (Standard, Reign of the Weredragon, HF p.143)

  // Climber - Passive: "The Weredrake climbs as easily as it runs." Story only.
  f("weredrake", "Climber", shown("The Weredrake climbs as easily as it runs.")),
  // Pack Tactics - Passive: "If the Weredrake makes a successful standard attack and another Weredrake is within Melee
  // range of the target, deal 1d8+6 physical damage instead of its standard damage and gain a Fear." Offered as its
  // standard attack with the replaced damage and the Fear.
  f(
    "weredrake",
    "Pack Tactics",
    action({
      id: "pack-attack",
      requires: [{ kind: "allyWithin", range: "melee", of: "target", name: "Weredrake" }],
      roll: ATTACK,
      targets: enemy("melee"),
      steps: [physical(roll(1, 8, 6)), { kind: "fear", to: "self", when: HIT, change: "gain", amount: fixed(1) }],
    }),
  ),
  // Innocent Guise - Action: "The Weredrake magically assumes the form of the person it was before its transformation but
  // retains its claws and teeth. This form lasts until it dies or uses this feature again to revert to its draconic
  // form."
  f("weredrake", "Innocent Guise", action({ steps: [until(tag("Innocent Guise"), "it dies or uses this feature again", undefined, "self")] })),

  // ======== Will-o'-the-Wisps (Horde, HF p.69)

  // Horde (1d4−1) - Passive: "When the Will-o'-the-Wisps have marked half or more of their HP, their standard attack
  // deals 1d4−1 magic damage instead."
  horde("will-o-the-wisps", "1d4−1", 4, -1),
  // Kaleidoscopic - Passive: "The Will-o'-the-Wisps pulse and dance in hypnotic, color-changing patterns that entrance any
  // creature who looks upon them. All targets within Very Close range of the Will-o'-the-Wisps are Vulnerable."
  f("will-o-the-wisps", "Kaleidoscopic", passive([{ kind: "conditionAura", condition: std("vulnerable"), to: "all", within: "veryClose" }])),
  // Fascinating - Action: "Spend a Fear to have the Will-o'-the-Wisps trace looping light trails through the air, leaving
  // afterimages that beg to be deciphered. Each PC within Far range must succeed on an Instinct Reaction Roll (13) or
  // mark a Stress and move up to Close range toward the Will-o'-the-Wisps."
  f(
    "will-o-the-wisps",
    "Fascinating",
    action({
      costs: [fear()],
      targets: enemy("far", ALL),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: { kind: "fixed", value: 13 },
          onFail: [{ kind: "markStress", to: "targets", amount: fixed(1) }, { kind: "move", to: "targets", mode: "move", range: "close", relativeTo: "self", note: "Move up to Close range toward the Wisps" }],
          onSuccess: [],
        },
      ],
    }),
  ),

  // ======== Yufo (Social, HF p.69)

  // Telepathic - Passive: "The Yufo can mentally communicate with creatures within Very Far range." Story only.
  f("yufo", "Telepathic", shown("The Yufo can mentally communicate with creatures within Very Far range.")),
  // Psychic Strongbox - Passive: "The Yufo is immune to abilities and features that would affect or alter its thoughts or
  // emotions." Not damage immunity (CA2 excludes it): a flag (dcm-yea); the GM still rules which effects it ignores.
  f("yufo", "Psychic Strongbox", passive([{ kind: "mod", mod: { kind: "flag", flag: "mindImmune" } }])),
  // Glitch Wave - Action: "Spend a Fear and choose up to three targets within Close range. Each target must succeed on a
  // Instinct Reaction Roll or become desynced from reality and have disadvantage on Instinct Rolls until they use a
  // downtime move to ground their psyches in the now." The disadvantage rides on the tag.
  f(
    "yufo",
    "Glitch Wave",
    action({
      costs: [fear()],
      targets: enemy("close", { kind: "upTo", n: fixed(3) }),
      steps: [
        {
          kind: "save",
          to: "targets",
          trait: "instinct",
          difficulty: { kind: "actorDifficulty" },
          onFail: [until(tag("Desynced"), "they use a downtime move to ground their psyche", undefined, "targets", { mods: [{ kind: "disadvantage", on: "instinct" }] })],
          onSuccess: [],
        },
      ],
    }),
  ),
  // Temporal Corrosion - Reaction: "When the Yufo succeeds on a standard attack, you can mark a Stress to have the Yufo
  // excrete an entropic acid through its skin, giving the target a −2 penalty to their damage thresholds until they use a
  // downtime move to repair their armor."
  f(
    "yufo",
    "Temporal Corrosion",
    reaction(
      { kind: "onHit", attack: "standard" },
      {
        costs: [stress()],
        targets: SUBJECT,
        steps: [
          {
            kind: "effect",
            to: "targets",
            label: "Temporal Corrosion",
            mods: [
              { kind: "stat", stat: "majorThreshold", delta: fixed(-2) },
              { kind: "stat", stat: "severeThreshold", delta: fixed(-2) },
            ],
            duration: "manual",
            endsWhen: "they use a downtime move to repair their armor",
          },
        ],
      },
    ),
  ),
];
