// Feature effects of Ranger and Rogue (FE-ranger-rogue) (plan sheet-drawer).
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page and uses only the vocabulary of src/lib/domain/card-effects/types.ts (a gap is a `manual` step or a note,
// plus a bead labelled feature-effects vocabulary-gap; every one is listed in docs/tasks/TASK-SD-FE-ranger-rogue.md).
//
// One entry per Ranger and Rogue feature classified combat or passive in ./classification.ts (20 of 22; Path Forward and
// Well-Connected are narrative). Book pages are printed pages: Ranger and Beastbound CB p.38, Wayfinder CB p.39, the
// Ranger Companion sheet CB p.40-41, Rogue and Nightwalker CB p.42, Syndicate CB p.43.
//
// Readings used throughout:
// - "temporarily" is duration `temporary` (CB p.102); "until your next rest" is `rest`.
// - Ranger's Focus is a condition tag on the target (`FOCUS_TAG`); the Focus benefits and Elusive Predator / Apex
//   Predator read it (`tagged` / `hasCondition` with that tag). D5's own record (`classState.focus`) is not written
//   from the map: the D5 `rangersFocus` needs the attack's roll, which a `delegate` step is not given (bead dcm-d1d).
// - "On a successful attack" inside a rider reads the host attack's roll (the rider rides on it, SD5).
// - Q4 (a): the companion acts from its own token (`actor: "companion"`); its damage die, range and damage type are on its
//   companion sheet (src/lib/frames/extras/companion.ts), which the vocabulary can't read, so the entry carries the
//   level-1 values (d6, Melee, physical) and SD-C substitutes the sheet's (bead dcm-2z2).
// - Q9 (a): Sneak Attack is automatic ("add", not optional) when Cloaked or an ally is within Melee range of the target;
//   Cloaked replaces Hidden and ends after an attack or a move ending in an adversary's line of sight (map engine).
// - Q14 (a): Dark Cloud is a live map area that blocks sight in and out.

import type { ConditionRef, NumberSource, Requirement, Step, TargetSpec } from "../../domain/card-effects/types";
import { featureId } from "../../domain/feature-effects/ids";
import type { FeatureEffect } from "../../domain/feature-effects/types";

const n = (value: number): NumberSource => ({ kind: "fixed", value });
const prof: NumberSource = { kind: "proficiency" };
/** "a number of d6s equal to your tier" (CB p.42): Level 1 → Tier 1, 2-4 → 2, 5-7 → 3, 8-10 → 4. */
const tierCount: NumberSource = { kind: "byTier", values: [1, 2, 3, 4] };

/** The Focus of Ranger's Focus (CB p.38), a condition tag on the creature (the instance's GM `tags`). */
export const FOCUS_TAG = "Ranger's Focus";
const focus: ConditionRef = { kind: "tag", tag: FOCUS_TAG };
const cloaked: ConditionRef = { kind: "standard", condition: "cloaked" };
const restrained: ConditionRef = { kind: "standard", condition: "restrained" };

/** The ids of this group's features (featureId, src/lib/domain/feature-effects/ids.ts). */
export const RANGER_ROGUE_IDS = {
  holdThemOff: featureId("hope", "ranger"),
  rangersFocus: featureId("class", "ranger", "Ranger’s Focus"),
  companion: featureId("subclass", "beastbound", "Companion"),
  expertTraining: featureId("subclass", "beastbound", "Expert Training"),
  battleBonded: featureId("subclass", "beastbound", "Battle-Bonded"),
  advancedTraining: featureId("subclass", "beastbound", "Advanced Training"),
  loyalFriend: featureId("subclass", "beastbound", "Loyal Friend"),
  ruthlessPredator: featureId("subclass", "wayfinder", "Ruthless Predator"),
  elusivePredator: featureId("subclass", "wayfinder", "Elusive Predator"),
  apexPredator: featureId("subclass", "wayfinder", "Apex Predator"),
  roguesDodge: featureId("hope", "rogue"),
  cloaked: featureId("class", "rogue", "Cloaked"),
  sneakAttack: featureId("class", "rogue", "Sneak Attack"),
  shadowStepper: featureId("subclass", "nightwalker", "Shadow Stepper"),
  darkCloud: featureId("subclass", "nightwalker", "Dark Cloud"),
  adrenaline: featureId("subclass", "nightwalker", "Adrenaline"),
  fleetingShadow: featureId("subclass", "nightwalker", "Fleeting Shadow"),
  vanishingAct: featureId("subclass", "nightwalker", "Vanishing Act"),
  contactsEverywhere: featureId("subclass", "syndicate", "Contacts Everywhere"),
  reliableBackup: featureId("subclass", "syndicate", "Reliable Backup"),
} as const;
const ID = RANGER_ROGUE_IDS;

/** Situations the player confirms (Q13 check boxes) where the engine can't see the fact yet. */
export const RANGER_ROGUE_SITUATIONS = {
  focusTarget: "The failed attack was against your Focus",
  apexTarget: "You're attacking your Focus",
  loyalFriend: "The damage from an attack would mark your companion's last Stress or your last Hit Point, and you're within Close range of each other",
  sneakAttack: "You're Cloaked, or an ally is within Melee range of your target",
  shadowStepper: "You're moving into an area of darkness or a shadow cast by another creature or object",
  vulnerable: "You're Vulnerable",
  conversation: "This Presence Roll is made in conversation",
} as const;
const S = RANGER_ROGUE_SITUATIONS;

const situation = (text: string, check?: Extract<Requirement, { kind: "situation" }>["check"]): Requirement => ({ kind: "situation", text, ...(check ? { check } : {}) });
/** "your companion" (Q4: the companion's own ally token). */
const companionPick = (range: TargetSpec["range"]): TargetSpec => ({ side: "ally", range, count: { kind: "one" }, companion: true });
/** A Contacts Everywhere benefit waiting on the sheet (the `option` its effect step names). */
const contactWaiting = (option: string): Requirement => situation(`Your shady contact's "${option}" help is waiting`, { kind: "featureEffect", featureId: ID.contactsEverywhere, option });

/** Contacts Everywhere's three benefits (CB p.43); Reliable Backup adds two (`RELIABLE_BACKUP_OPTIONS`). */
const CONTACT_CHOOSE = "benefit";
const contactEffect = (option: string, label: string, extra: Partial<Extract<Step, { kind: "effect" }>> = {}): Step => ({
  kind: "effect",
  to: "self",
  label,
  mods: [],
  duration: "manual",
  option,
  ...extra,
});

export const RANGER_ROGUE_EFFECTS: readonly FeatureEffect[] = [
  // ---------------------------------------------------------------- Ranger (CB p.38)

  // Hold Them Off (Ranger's Hope feature, CB p.38): "Spend 3 Hope when you succeed on an attack with a weapon to use that
  // same roll against two additional adversaries within range of the attack." NV18: a target-adding rider on the
  // successful weapon attack; the two extra targets take the attack's damage (the same roll, R9).
  {
    featureId: ID.holdThemOff,
    source: "hope",
    owner: "ranger",
    uses: [
      {
        id: "main",
        name: "Hold Them Off",
        activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
        costs: [{ kind: "hope", amount: n(3) }],
        steps: [
          {
            kind: "addTargets",
            to: "self",
            count: n(2),
            targets: { side: "enemy", range: "weapon", count: { kind: "upTo", n: n(2) }, excludeSelf: true },
            damage: "same",
            note: "Use that same roll against two additional adversaries within range of the attack.",
          },
        ],
      },
    ],
  },

  // Ranger's Focus (class feature, CB p.38): "Spend a Hope and make an attack against a target. On a success, deal your
  // attack's normal damage and temporarily make the attack's target your Focus. Until this feature ends or you make a
  // different creature your Focus, you gain the following benefits against your Focus:
  // • You know precisely what direction they are in.
  // • When you deal damage to them, they must mark a Stress.
  // • When you fail an attack against them, you can end your Ranger's Focus feature to reroll your Duality Dice."
  // The Focus is a temporary tag; a new Focus ends the old one (`exclusive`). The direction is narrative. The Stress and
  // the reroll are their own uses (auto, after-roll rider, Q1). Q4: a commanded companion gains these benefits too (SD-C).
  {
    featureId: ID.rangersFocus,
    source: "class",
    owner: "ranger",
    uses: [
      {
        id: "main",
        name: "Ranger’s Focus",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(1) }],
        roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" } },
        targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
        exclusive: true,
        steps: [
          { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "either" }, type: "weapon" },
          {
            kind: "condition",
            to: "targets",
            when: ["hit"],
            condition: focus,
            duration: "temporary",
            endsWhen: "Ranger's Focus ends or you make a different creature your Focus",
            note: "Temporarily make the attack's target your Focus.",
          },
        ],
      },
      {
        id: "stress",
        name: "Ranger’s Focus: they mark a Stress",
        activation: { kind: "auto", trigger: { kind: "whenYouDealDamage", toEnemy: true } },
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "markStress", to: "targets", when: [{ kind: "targetHas", condition: focus }], amount: n(1), note: "When you deal damage to your Focus, they must mark a Stress." }],
      },
      {
        id: "reroll",
        name: "Ranger’s Focus: end it to reroll",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "attack", result: "failure" } },
        requires: [situation(S.focusTarget, { kind: "hasCondition", condition: focus, who: "target" })],
        targets: { side: "enemy", range: "unlimited", count: { kind: "one" } },
        steps: [
          { kind: "modifyRoll", to: "self", change: { kind: "reroll", dice: "all" }, note: "Reroll your Duality Dice; the new result stands (CB p.107)." },
          { kind: "clearCondition", to: "targets", condition: focus, note: "End your Ranger's Focus." },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Beastbound (CB p.38; companion sheet CB p.40-41)

  // Companion (foundation, CB p.38): "You have an animal companion of your choice (at the GM's discretion). They stay by
  // your side unless you tell them otherwise. Take the Ranger Companion sheet. When you level up your character, choose
  // a level-up option for your companion from this sheet as well."
  // CB p.40: "Make a Spellcast Roll to connect with your companion and command them to take action. Spend a Hope to add an
  // applicable Companion Experience to the roll. On a success with Hope, if your next action builds on their success, you
  // gain advantage on the roll." "When you command your companion to attack, they gain any benefits that would normally
  // only apply to you (such as the effects of 'Ranger's Focus'). On a success, their damage roll uses your Proficiency and
  // their damage die." "At level 1, your companion's damage die is a d6 and their range is Melee. Choose whether they deal
  // physical or magic damage." "When your companion would take any amount of damage, they mark a Stress." (SD-C.)
  // Q4 (a): Command from the drawer, the companion's token acts. The Experience is a number the player enters (the
  // companion sheet's value, +2 at the start, CB p.40); entering one costs the Hope.
  {
    featureId: ID.companion,
    source: "subclass",
    owner: "beastbound",
    card: "foundation",
    uses: [
      {
        id: "attack",
        name: "Companion: command an attack",
        activation: { kind: "action" },
        actor: "companion",
        choices: [{ id: "experience", label: "Companion Experience to add (spend a Hope)", min: 0, max: n(5) }],
        costs: [{ kind: "hope", amount: { kind: "calc", of: { kind: "chosen", choice: "experience" }, max: n(1) } }],
        roll: { kind: "spellcast", difficulty: { kind: "target" }, modifier: { kind: "chosen", choice: "experience" } },
        targets: { side: "enemy", range: "melee", count: { kind: "one" } },
        steps: [
          {
            kind: "damage",
            to: "targets",
            when: ["hit"],
            roll: { kind: "dice", dice: { count: prof, sides: 6 } },
            type: "physical",
            note: "Your Proficiency and their damage die (d6 at level 1; the companion sheet's die and damage type, SD-C).",
          },
          { kind: "manual", to: "self", when: ["success", "withHope"], text: "On a success with Hope, if your next action builds on their success, you gain advantage on the roll." },
        ],
      },
      {
        id: "command",
        name: "Companion: command an action",
        activation: { kind: "action" },
        actor: "companion",
        choices: [{ id: "experience", label: "Companion Experience to add (spend a Hope)", min: 0, max: n(5) }],
        costs: [{ kind: "hope", amount: { kind: "calc", of: { kind: "chosen", choice: "experience" }, max: n(1) } }],
        roll: { kind: "spellcast", difficulty: { kind: "gm" }, modifier: { kind: "chosen", choice: "experience" } },
        steps: [
          { kind: "manual", to: "self", when: ["success"], text: "Your companion takes the action you commanded." },
          { kind: "manual", to: "self", when: ["success", "withHope"], text: "On a success with Hope, if your next action builds on their success, you gain advantage on the roll." },
        ],
      },
    ],
  },

  // Expert Training (specialization, CB p.38): "Choose an additional level-up option for your companion." A build-time
  // rule of the companion sheet (`bonusTraining`, src/lib/frames/extras/companion.ts); no combat modifier.
  {
    featureId: ID.expertTraining,
    source: "subclass",
    owner: "beastbound",
    card: "specialization",
    uses: [{ id: "main", name: "Expert Training", activation: { kind: "passive" }, mods: [], steps: [] }],
  },

  // Battle-Bonded (specialization, CB p.38): "When an adversary attacks you while they're within your companion's Melee
  // range, you gain a +2 bonus to your Evasion against the attack." NV9: keyed to the attacker in the companion's reach.
  {
    featureId: ID.battleBonded,
    source: "subclass",
    owner: "beastbound",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Battle-Bonded",
        activation: { kind: "passive" },
        mods: [{ kind: "stat", stat: "evasion", delta: n(2), versus: { creature: { kind: "inCompanionReach" }, on: "attacksByThem" } }],
        steps: [],
      },
    ],
  },

  // Advanced Training (mastery, CB p.38): "Choose two additional level-up options for your companion." As Expert Training.
  {
    featureId: ID.advancedTraining,
    source: "subclass",
    owner: "beastbound",
    card: "mastery",
    uses: [{ id: "main", name: "Advanced Training", activation: { kind: "passive" }, mods: [], steps: [] }],
  },

  // Loyal Friend (mastery, CB p.38): "Once per long rest, when the damage from an attack would mark your companion's last
  // Stress or your last Hit Point and you're within Close range of each other, you or your companion can rush to the
  // other's side and take that damage instead." In the reaction window of a hit on you or your companion; one limit for
  // both directions. "Last Stress" / "last Hit Point" and the hit's own severity are the player's check box (Q13).
  {
    featureId: ID.loyalFriend,
    source: "subclass",
    owner: "beastbound",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Loyal Friend",
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "close", includeSelf: true } },
        requires: [situation(S.loyalFriend)],
        limit: { per: "longRest" },
        targets: { side: "trigger", who: "subject" },
        steps: [
          {
            kind: "choose",
            id: "who",
            label: "Who rushes to the other's side?",
            options: [
              { id: "you", label: "You take the damage meant for your companion", steps: [{ kind: "redirectDamage", to: "triggerSubject", target: "self", note: "You rush to your companion's side and take that damage instead." }] },
              {
                id: "companion",
                label: "Your companion takes the damage meant for you",
                steps: [{ kind: "redirectDamage", to: "triggerSubject", target: "picked", pick: companionPick("close"), note: "Your companion rushes to your side and takes that damage instead." }],
              },
            ],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Wayfinder (CB p.39)

  // Ruthless Predator (foundation, CB p.39): "When you make a damage roll, you can mark a Stress to gain a +1 bonus to your
  // Proficiency. Additionally, when you deal Severe damage to an adversary, they must mark a Stress."
  {
    featureId: ID.ruthlessPredator,
    source: "subclass",
    owner: "wayfinder",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Ruthless Predator: +1 Proficiency",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "damage" } },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "proficiency", delta: 1 } }],
      },
      {
        id: "severe",
        name: "Ruthless Predator: Severe damage",
        activation: { kind: "auto", trigger: { kind: "whenEnemyTakesDamage", severity: "severe", byYou: true } },
        targets: { side: "trigger", who: "subject" },
        steps: [{ kind: "markStress", to: "targets", amount: n(1), note: "When you deal Severe damage to an adversary, they must mark a Stress." }],
      },
    ],
  },

  // Elusive Predator (specialization, CB p.39): "When your Focus makes an attack against you, you gain a +2 bonus to your
  // Evasion against the attack." NV9: keyed to the creature carrying the Focus tag.
  {
    featureId: ID.elusivePredator,
    source: "subclass",
    owner: "wayfinder",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Elusive Predator",
        activation: { kind: "passive" },
        mods: [{ kind: "stat", stat: "evasion", delta: n(2), versus: { creature: { kind: "tagged", tag: FOCUS_TAG }, on: "attacksByThem" } }],
        steps: [],
      },
    ],
  },

  // Apex Predator (mastery, CB p.39): "Before you make an attack roll against your Focus, you can spend a Hope. On a
  // successful attack, you remove a Fear from the GM's Fear pool." A rider before the attack; the Fear goes on the host
  // attack's success.
  {
    featureId: ID.apexPredator,
    source: "subclass",
    owner: "wayfinder",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Apex Predator",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
        requires: [situation(S.apexTarget, { kind: "hasCondition", condition: focus, who: "target" })],
        costs: [{ kind: "hope", amount: n(1) }],
        steps: [{ kind: "fear", to: "self", when: ["success"], change: "lose", amount: n(1), note: "On a successful attack, remove a Fear from the GM's Fear pool." }],
      },
    ],
  },

  // ---------------------------------------------------------------- Rogue (CB p.42)

  // Rogue's Dodge (Rogue's Hope feature, CB p.42): "Spend 3 Hope to gain a +2 bonus to your Evasion until the next time an
  // attack succeeds against you. Otherwise, this bonus lasts until your next rest." NV2: D5 `roguesDodge` writes the
  // sheet effect (until hit) and its rest hook ends it, so the Party sheet and the drawer share one record; the entry pays.
  {
    featureId: ID.roguesDodge,
    source: "hope",
    owner: "rogue",
    uses: [
      {
        id: "main",
        name: "Rogue’s Dodge",
        activation: { kind: "action" },
        costs: [{ kind: "hope", amount: n(3) }],
        steps: [{ kind: "delegate", to: "self", feature: "roguesDodge", note: "+2 Evasion until an attack succeeds against you, or until your next rest." }],
      },
    ],
  },

  // Cloaked (class feature, CB p.42): "Any time you would be Hidden, you are instead Cloaked. In addition to the benefits
  // of the Hidden condition, while Cloaked you remain unseen if you are stationary when an adversary moves to where they
  // would normally see you. After you make an attack or end a move within line of sight of an adversary, you are no longer
  // Cloaked." Always on; Q9 (a): the map turns Hidden into Cloaked and ends it after an attack or a move ending in an
  // adversary's line of sight (vision engine). No modifier of the vocabulary says it (bead dcm-bhp).
  {
    featureId: ID.cloaked,
    source: "class",
    owner: "rogue",
    uses: [{ id: "main", name: "Cloaked", activation: { kind: "passive" }, mods: [], steps: [] }],
  },

  // Sneak Attack (class feature, CB p.42): "When you succeed on an attack while Cloaked or while an ally is within Melee
  // range of your target, add a number of d6s equal to your tier to your damage roll." Q9 (a): automatic ("add"). The
  // engine decides Cloaked; "an ally within Melee range of your target" has no state check yet, so the situation falls
  // back to the player's check box (bead dcm-85u).
  {
    featureId: ID.sneakAttack,
    source: "class",
    owner: "rogue",
    uses: [
      {
        id: "main",
        name: "Sneak Attack",
        activation: { kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } },
        requires: [situation(S.sneakAttack)],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: { count: tierCount, sides: 6 } } }, note: "Add tier-many d6s to your damage roll." }],
      },
    ],
  },

  // ---------------------------------------------------------------- Nightwalker (CB p.42)

  // Shadow Stepper (foundation, CB p.42): "You can move from shadow to shadow. When you move into an area of darkness or a
  // shadow cast by another creature or object, you can mark a Stress to disappear from where you are and reappear inside
  // another shadow within Far range. When you reappear, you are Cloaked." The shadow is a picked point (Q9: the move is a
  // prompt). Fleeting Shadow (mastery, CB p.42): "You can use your 'Shadow Stepper' feature to move within Very Far
  // range." (NV3 range upgrade.)
  {
    featureId: ID.shadowStepper,
    source: "subclass",
    owner: "nightwalker",
    card: "foundation",
    uses: [
      {
        id: "main",
        name: "Shadow Stepper",
        activation: { kind: "action" },
        requires: [situation(S.shadowStepper)],
        costs: [{ kind: "stress", amount: n(1) }],
        targets: { side: "point", range: "far", count: { kind: "one" } },
        steps: [
          { kind: "move", to: "self", mode: "teleport", relativeTo: "point", note: "Disappear from where you are and reappear inside another shadow (the picked point)." },
          { kind: "condition", to: "self", condition: cloaked, duration: "manual", endsWhen: "you make an attack or end a move within line of sight of an adversary", note: "When you reappear, you are Cloaked." },
        ],
      },
    ],
    upgrades: [{ when: { kind: "feature", featureId: ID.fleetingShadow }, useId: "main", patch: { range: "veryFar" }, note: "Fleeting Shadow" }],
  },

  // Dark Cloud (specialization, CB p.42): "Make a Spellcast Roll (15). On a success, create a temporary dark cloud that
  // covers any area within Close range. Anyone in this cloud can't see outside of it, and anyone outside of it can't see
  // in. You're considered Cloaked from any adversary for whom the cloud blocks line of sight." Q14 (a): a live area that
  // blocks sight. The area is the Close range around you (open question 2 in the task doc). Being Cloaked from the
  // adversaries it blocks is the vision engine's (bead dcm-bhp).
  {
    featureId: ID.darkCloud,
    source: "subclass",
    owner: "nightwalker",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Dark Cloud",
        activation: { kind: "action" },
        roll: { kind: "spellcast", difficulty: { kind: "fixed", value: 15 } },
        steps: [
          {
            kind: "area",
            to: "self",
            when: ["success"],
            area: { label: "Dark Cloud", centre: "self", radius: "close", side: "all", blocksSight: true, duration: "temporary" },
            note: "Anyone in this cloud can't see outside of it, and anyone outside of it can't see in.",
          },
        ],
      },
    ],
  },

  // Adrenaline (specialization, CB p.42): "While you're Vulnerable, add your level to your damage rolls." NV7.
  {
    featureId: ID.adrenaline,
    source: "subclass",
    owner: "nightwalker",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Adrenaline",
        activation: { kind: "passive" },
        requires: [situation(S.vulnerable, { kind: "hasCondition", condition: { kind: "standard", condition: "vulnerable" } })],
        mods: [{ kind: "stat", stat: "damage", delta: { kind: "level" } }],
        steps: [],
      },
    ],
  },

  // Fleeting Shadow (mastery, CB p.42): "Gain a permanent +1 bonus to your Evasion. You can use your 'Shadow Stepper'
  // feature to move within Very Far range." The range is Shadow Stepper's upgrade (above).
  {
    featureId: ID.fleetingShadow,
    source: "subclass",
    owner: "nightwalker",
    card: "mastery",
    uses: [{ id: "main", name: "Fleeting Shadow", activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "evasion", delta: n(1) }], steps: [] }],
  },

  // Vanishing Act (mastery, CB p.42): "Mark a Stress to become Cloaked at any time. When Cloaked from this feature, you
  // automatically clear the Restrained condition if you have it. You remain Cloaked in this way until you roll with Fear
  // or until your next rest." NV5: until the next rest or a roll with Fear (open question 5 in the task doc).
  {
    featureId: ID.vanishingAct,
    source: "subclass",
    owner: "nightwalker",
    card: "mastery",
    uses: [
      {
        id: "main",
        name: "Vanishing Act",
        activation: { kind: "action" },
        costs: [{ kind: "stress", amount: n(1) }],
        steps: [
          { kind: "condition", to: "self", condition: cloaked, duration: "rest", endsOn: ["rollWithFear"], note: "You remain Cloaked in this way until you roll with Fear or until your next rest." },
          { kind: "clearCondition", to: "self", condition: restrained, note: "You automatically clear the Restrained condition if you have it." },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Syndicate (CB p.43)

  // Contacts Everywhere (specialization, CB p.43): "Once per session, you can briefly call on a shady contact. Choose one of
  // the following benefits and describe what brought them here to help you in this moment:
  // • They provide 1 handful of gold, a unique tool, or a mundane object that the situation requires.
  // • On your next action roll, their help provides a +3 bonus to the result of your Hope or Fear Die.
  // • The next time you deal damage, they snipe from the shadows, adding 2d8 to your damage roll."
  // The roll and damage benefits wait on the sheet as an effect (its `option`) and are spent by the riders "die" and
  // "snipe". Reliable Backup (mastery, CB p.43): "You can use your 'Contacts Everywhere' feature three times per session.
  // The following options are added to the list of benefits you can choose from when you use that feature:
  // • When you mark 1 or more Hit Points, they can rush out to shield you, reducing the Hit Points marked by 1.
  // • When you make a Presence Roll in conversation, they back you up. You can roll a d20 as your Hope Die."
  // NV3: three times per session and the two options; their riders "shield" and "backup". The backup benefit has no end
  // event for "your next Presence Roll in conversation" (manual, bead dcm-3ea).
  {
    featureId: ID.contactsEverywhere,
    source: "subclass",
    owner: "syndicate",
    card: "specialization",
    uses: [
      {
        id: "main",
        name: "Contacts Everywhere",
        activation: { kind: "action" },
        limit: { per: "session" },
        steps: [
          {
            kind: "choose",
            id: CONTACT_CHOOSE,
            label: "Choose the contact's help",
            options: [
              { id: "supply", label: "1 handful of gold, a unique tool, or a mundane object", steps: [{ kind: "manual", to: "self", text: "They provide 1 handful of gold, a unique tool, or a mundane object that the situation requires." }] },
              { id: "die", label: "+3 to your Hope or Fear Die on your next action roll", steps: [contactEffect("die", "Contacts Everywhere: +3 to your Hope or Fear Die", { duration: "nextRoll" })] },
              { id: "snipe", label: "+2d8 the next time you deal damage", steps: [contactEffect("snipe", "Contacts Everywhere: +2d8 to your next damage", { endsOn: ["dealDamage"] })] },
            ],
          },
        ],
      },
      {
        id: "die",
        name: "Contacts Everywhere: +3 to a die",
        activation: { kind: "rider", trigger: { kind: "afterYouRoll", roll: "action" } },
        requires: [contactWaiting("die")],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "dieBonus", die: "hopeOrFear", amount: n(3) }, note: "Their help provides a +3 bonus to the result of your Hope or Fear Die." }],
      },
      {
        id: "snipe",
        name: "Contacts Everywhere: snipe",
        activation: { kind: "auto", trigger: { kind: "whenYouDealDamage" } },
        requires: [contactWaiting("snipe")],
        steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: { count: n(2), sides: 8 } } }, note: "They snipe from the shadows, adding 2d8 to your damage roll." }],
      },
      {
        id: "shield",
        name: "Contacts Everywhere: shield",
        activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
        requires: [contactWaiting("shield")],
        steps: [{ kind: "adjustHpMarked", to: "self", change: "fewer", amount: n(1), note: "They rush out to shield you, reducing the Hit Points marked by 1." }],
      },
      {
        id: "backup",
        name: "Contacts Everywhere: backup",
        activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "presence" } },
        requires: [contactWaiting("backup"), situation(S.conversation)],
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "hopeDie", sides: 20 }, note: "They back you up: roll a d20 as your Hope Die." }],
      },
    ],
    upgrades: [
      { when: { kind: "feature", featureId: ID.reliableBackup }, useId: "main", patch: { limitTimes: 3 }, note: "Reliable Backup" },
      {
        when: { kind: "feature", featureId: ID.reliableBackup },
        useId: "main",
        patch: {
          chooseId: CONTACT_CHOOSE,
          extraOptions: [
            { id: "shield", label: "Shield you: 1 fewer Hit Point the next time you mark Hit Points", steps: [contactEffect("shield", "Contacts Everywhere: shield you", { endsOn: ["markHp"] })] },
            {
              id: "backup",
              label: "Back you up: a d20 Hope Die on a Presence Roll in conversation",
              steps: [contactEffect("backup", "Contacts Everywhere: d20 Hope Die in conversation", { endsWhen: "you make a Presence Roll in conversation" })],
            },
          ],
        },
        note: "Reliable Backup",
      },
    ],
  },

  // Reliable Backup (mastery, CB p.43): quoted with Contacts Everywhere, whose entry carries it as upgrades (NV3).
  {
    featureId: ID.reliableBackup,
    source: "subclass",
    owner: "syndicate",
    card: "mastery",
    uses: [{ id: "main", name: "Reliable Backup", activation: { kind: "passive" }, mods: [], steps: [] }],
  },
];
