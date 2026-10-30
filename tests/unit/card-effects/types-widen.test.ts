import { describe, expect, it } from "vitest";

import type {
  AreaSpec,
  CardEffect,
  CardUse,
  Cost,
  DamageChange,
  EndEvent,
  Mod,
  NumberSource,
  OutcomeStep,
  Requirement,
  RollChange,
  StateCheck,
  Step,
  Trigger,
  Upgrade,
} from "@/lib/domain/card-effects/types";
import { STEP_KINDS } from "@/lib/domain/card-effects/types";
import type { Gate, Limit, NumberChoice, RollSpec, SaveDifficulty, TargetSpec } from "@/lib/domain/card-effects/types";
import { ADVERSARY_STEP_KINDS, ADVERSARY_TRIGGER_KINDS } from "@/lib/domain/adversary-effects/types";
import type { AdversaryFeatureUse, AdversaryModifier, AdversaryRequirement, AdversaryStep, AdversaryTrigger } from "@/lib/domain/adversary-effects/types";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { ADVERSARY_EFFECT_TABLES, ADVERSARY_EFFECTS, mergeAdversaryEffectTables } from "@/lib/srd/adversary-effects/index";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { CARD_EFFECTS, DOMAIN_EFFECT_TABLES, mergeEffectTables } from "@/lib/srd/card-effects/index";

// Plan sheet-drawer, tracer SD0: the card vocabulary widened with NV1-NV19 (analysis section 3), widen only. Every CE-*
// and AE-* table still compiles against it (this file imports all of them through their registries) and still merges;
// each new piece expresses the feature the analysis names for it (the types are the test: a narrowing breaks the build).

const SD0_STEP_KINDS = ["delegate", "adjustHpMarked", "resource", "area", "replaceHopeGain", "addTargets", "help"] as const;

/** The step kinds of CA0 before the widening (types.ts at combat-actions CA0); none may be renamed or dropped. */
const CA0_STEP_KINDS = [
  "pay",
  "optional",
  "choose",
  "save",
  "check",
  "followUp",
  "damage",
  "modifyDamage",
  "markHp",
  "markStress",
  "markArmor",
  "clear",
  "hope",
  "fear",
  "condition",
  "clearCondition",
  "move",
  "effect",
  "tokens",
  "toVault",
  "modifyRoll",
  "redirectDamage",
  "extraArmorSlots",
  "reduceSeverity",
  "reduceDamage",
  "negate",
  "convertMarks",
  "defeat",
  "refreshFeature",
  "manual",
];

describe("the widened vocabulary keeps every table (SD0)", () => {
  it("keeps every CE-* table: each entry merges once and is a classified card", () => {
    const entries = Object.values(DOMAIN_EFFECT_TABLES).flat();
    expect(entries.length).toBeGreaterThan(0);
    expect(mergeEffectTables(Object.values(DOMAIN_EFFECT_TABLES)).size).toBe(entries.length);
    expect(CARD_EFFECTS.size).toBe(entries.length);
    const classified = new Set(Object.values(CARD_CLASSIFICATION).flatMap((cards) => Object.keys(cards)));
    expect(entries.filter((e) => !classified.has(e.cardId)).map((e) => e.cardId)).toEqual([]);
  });

  it("keeps every AE-* table: the eight groups merge into the registry", () => {
    const groups = Object.values(ADVERSARY_EFFECT_TABLES);
    expect(groups).toHaveLength(8);
    expect(mergeAdversaryEffectTables(groups).size).toBe(ADVERSARY_EFFECTS.size);
    expect(ADVERSARY_EFFECTS.size).toBeGreaterThan(0);
  });

  it("only adds step kinds: CA0's are all kept, the SD0 ones are new, and the list stays unique", () => {
    expect(STEP_KINDS.slice(0, CA0_STEP_KINDS.length)).toEqual(CA0_STEP_KINDS);
    // Plan lanes, tracer V appends its kinds after SD0's (checked in the V block below).
    expect(STEP_KINDS.slice(CA0_STEP_KINDS.length, CA0_STEP_KINDS.length + SD0_STEP_KINDS.length)).toEqual([...SD0_STEP_KINDS]);
    expect(new Set(STEP_KINDS).size).toBe(STEP_KINDS.length);
    // The adversary vocabulary reuses the outcome steps (AA0), so it carries the new kinds too.
    for (const kind of SD0_STEP_KINDS) expect(ADVERSARY_STEP_KINDS).toContain(kind);
  });

  it("uses only step kinds of STEP_KINDS in the card tables", () => {
    const kinds = new Set<string>();
    const walk = (steps: readonly Step[]) => {
      for (const s of steps) {
        kinds.add(s.kind);
        if (s.kind === "optional" || s.kind === "followUp") walk(s.steps);
        if (s.kind === "choose") for (const o of s.options) walk(o.steps);
        if (s.kind === "save") walk([...s.onFail, ...s.onSuccess]);
        if (s.kind === "check") walk([...s.then, ...s.otherwise]);
      }
    };
    for (const effect of CARD_EFFECTS.values()) for (const use of effect.uses) walk(use.steps);
    expect([...kinds].filter((k) => !(STEP_KINDS as readonly string[]).includes(k))).toEqual([]);
  });
});

// ---------------------------------------------------------------- one feature per new piece (analysis section 3)

const hope3: Cost = { kind: "hope", amount: { kind: "fixed", value: 3 } };
const one: NumberSource = { kind: "fixed", value: 1 };

/** NV1 resources: Patron's Pact "spend a Favor" (HF p.14), Focus Cannon "Spend a Focus" (HF p.11), a Prayer Die (CB p.44). */
const nv1: Cost[] = [
  { kind: "tokens", amount: one, pool: "favor" },
  { kind: "tokens", amount: one, pool: "focus" },
  { kind: "tokens", amount: one, pool: "prayer" },
];
/** NV1: the spent Prayer Die's value reduces incoming damage. */
const prayerValue: OutcomeStep = { kind: "reduceDamage", to: "triggerSubject", amount: { kind: "spent", resource: "heldDie" } };
/** NV1: Patron Dice are the warlock's own die size. */
const patronDice: NumberSource = {
  kind: "dice",
  dice: { count: { kind: "spent", resource: "favor" }, sides: 6, sidesOf: "patron" },
  keep: "countAtLeast",
  atLeast: 4,
};
/** NV2: Rally runs D5's `rally` (CB p.28). */
const rally: OutcomeStep = { kind: "delegate", to: "self", feature: "rally" };
/** NV2: Beastform with the form the player picked. */
const beastform: OutcomeStep = { kind: "delegate", to: "self", feature: "beastform", params: { choiceFrom: "form" } };
/** NV3: Virtuoso (CB p.28) and Epic Poetry's d10 (CB p.29). */
const upgrades: Upgrade[] = [
  { when: { kind: "rank", rank: "mastery" }, patch: { limitTimes: 2 }, note: "Virtuoso" },
  { when: { kind: "feature", featureId: "subclass:wordsmith:epic-poetry" }, patch: { dieSides: 10 } },
  { when: { kind: "level", atLeast: 5 }, patch: { dieSides: 8 } },
];
/** NV4: Scales (CB p.54) "mark a Stress to mark 1 fewer Hit Points". */
const scales: OutcomeStep = { kind: "adjustHpMarked", to: "self", change: "fewer", amount: one };
/** NV5: Elemental Incarnation "until you take Severe damage or your next rest" (CB p.30). */
const channel: OutcomeStep = { kind: "effect", to: "self", label: "Channeling Fire", mods: [], duration: "rest", endsOn: ["takeSevere"], option: "fire" };
const endEvents: EndEvent[] = ["takeSevere", "dealSevere", "rollWithFear", "bearerFails", "usedAgain", "majorDamage", "lastHp"];
/** NV6 triggers. */
const triggers: Trigger[] = [
  { kind: "wouldMarkStress", forced: true },
  { kind: "whenYouAttack", result: "successWithFear" },
  { kind: "whenYouAttack", result: "success", firstInScene: true },
  { kind: "whenEnemyFailsAttack", range: "veryFar", source: { kind: "hexed" } },
  { kind: "whenEnemyLeavesRange", range: "melee" },
  { kind: "whenCreatureAttacked", subject: "selfOrAlly", subjectWithin: "veryClose", stage: "targeted" },
  { kind: "whenCreatureAttacked", subject: "ally", attackerWithin: "far", stage: "succeeded" },
  { kind: "whenTargetMarksHp", severity: "severe" },
  { kind: "whenEnemyTakesDamage", severity: "severe", byYou: true },
  { kind: "whenYouMarkHp", fromAttack: true, sourceWithin: "melee" },
  { kind: "whenYouMarkStress", last: true },
  { kind: "whenYouUseExperience" },
  { kind: "whenYouGainHope" },
  { kind: "whenYouGiveDie", die: "rally" },
  { kind: "whenHelping", roll: "spellcast" },
];
/** NV7: engine-readable situations (the player confirms `text` until the runner reads `check`). */
const checks: StateCheck[] = [
  { kind: "hasCondition", condition: { kind: "standard", condition: "vulnerable" } },
  { kind: "flying" },
  { kind: "featureEffect", featureId: "subclass:warden-of-the-elements:elemental-incarnation", option: "fire" },
  { kind: "inBeastform" },
  { kind: "hopeAtLeast", value: 2 },
  { kind: "hpUnmarkedAtMost", value: 2, who: "subject" },
  { kind: "rollUsedExperience" },
  { kind: "activeStance", stance: "quick" },
  { kind: "inArea", featureId: "subclass:hedge:circle-of-power" },
  { kind: "isolated", range: "veryClose", who: "selfOrTarget" },
];
const conjureShield: Requirement = { kind: "situation", text: "While you have at least 2 Hope", check: { kind: "hopeAtLeast", value: 2 } };
/** NV8 roll and damage changes. */
const rollChanges: RollChange[] = [
  { kind: "setOutcome", outcome: "success" },
  { kind: "setOutcome", outcome: "successWithFear" },
  { kind: "dieBonus", die: "hopeOrFear", amount: { kind: "fixed", value: 3 } },
  { kind: "reroll", dice: "hope", ifAtMost: 1 },
  { kind: "reroll", dice: "all", advantage: true },
  { kind: "fearDie", sides: 20 },
  { kind: "experience", change: "payWithStress", double: true },
  { kind: "experience", change: "freeOnCheck", check: { sides: 6, atLeast: 5 } },
  { kind: "experience", change: "borrowAlly" },
];
const damageChanges: DamageChange[] = [
  { kind: "rerollChosen" },
  { kind: "rerollChosen", below: { kind: "proficiency" } },
  { kind: "doubleDice", which: "matching" },
  { kind: "doubleDice", which: "chosen", count: 1 },
  { kind: "addWeaponDie", weapon: "secondary" },
  { kind: "extraDie", drop: "lowest" },
  { kind: "ones", asMax: true },
  { kind: "ones", add: { count: one, sides: 10 } },
  { kind: "dieSize", steps: 1 },
  { kind: "add", amount: { kind: "dice", dice: { count: one, sides: 10 } }, type: "magic" },
];
/** NV9 keyed defences, NV10 ranges, NV14 adversary-side mods, NV15 chosen traits, NV19 table moves. */
const mods: Mod[] = [
  { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 2 }, versus: { creature: { kind: "tagged", tag: "Focus" }, on: "attacksByThem" } },
  { kind: "advantage", on: "attack", versus: { creature: { kind: "hexed" }, on: "attacksAgainstThem" } },
  { kind: "stat", stat: "proficiency", delta: one, versus: { creature: { kind: "damagedAlly", range: "melee" }, on: "attacksAgainstThem" } },
  { kind: "stat", stat: "primaryRange", delta: one },
  { kind: "set", stat: "meleeRange", to: one },
  { kind: "set", stat: "meleeWeaponRange", to: { kind: "fixed", value: 2 } },
  { kind: "set", stat: "attackDie", to: { kind: "fixed", value: 12 } },
  { kind: "stat", stat: "reactionDifficulty", delta: { kind: "fixed", value: 3 } },
  { kind: "flag", flag: "attackersMarkStress" },
  { kind: "flag", flag: "reactionDisadvantage" },
  { kind: "trait", trait: "agility", delta: one, choice: "trait" },
  { kind: "set", stat: "helpDie", to: { kind: "fixed", value: 10 } },
  { kind: "stat", stat: "tagTeamUses", delta: one },
  { kind: "stat", stat: "consumableClear", delta: one },
];
/** NV11: Dark Cloud (CB p.42). */
const darkCloud: AreaSpec = { label: "Dark Cloud", centre: "point", radius: "close", side: "all", blocksSight: true, duration: "temporary" };
/** NV13: the companion attacks (Q4); NV15: Hex holds up to Spellcast creatures; NV18: Hold Them Off; NV17: Favor; NV19: Eloquent. */
const holdThemOff: CardUse = {
  id: "main",
  name: "Hold Them Off",
  activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
  costs: [hope3],
  steps: [{ kind: "addTargets", to: "targets", count: { kind: "fixed", value: 2 }, targets: { side: "enemy", range: "weapon", count: { kind: "upTo", n: { kind: "fixed", value: 2 } } } }],
};
const command: CardUse = {
  id: "command",
  name: "Command",
  activation: { kind: "action" },
  actor: "companion",
  roll: { kind: "spellcast", difficulty: { kind: "target" } },
  targets: { side: "enemy", range: "melee", count: { kind: "one" } },
  steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 6 } }, type: "physical" }],
};
const hex: CardUse = {
  id: "main",
  name: "Hex",
  activation: { kind: "action" },
  holdLimit: { kind: "spellcast" },
  targets: { side: "enemy", range: "far", count: { kind: "one" }, rangeSteps: 0 },
  steps: [
    { kind: "area", to: "self", area: darkCloud },
    { kind: "replaceHopeGain", to: "self", with: "favor" },
    { kind: "resource", to: "self", resource: "focus", change: "gain", amount: one },
    { kind: "help", to: "picked", pick: { side: "ally", range: "far", count: { kind: "one" } }, die: 6, free: true },
    { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Drained" }, duration: "manual", endsOn: ["bearerFails"] },
  ],
};
const loyalFriend: Step = { kind: "manual", to: "picked", pick: { side: "ally", range: "unlimited", count: { kind: "one" }, companion: true }, text: "Take the damage instead" };

describe("each new piece expresses the feature that needs it (SD0, analysis section 3)", () => {
  it("builds a feature effect from the widened vocabulary", () => {
    const effect: FeatureEffect = {
      featureId: "subclass:troubadour:gifted-performer",
      source: "subclass",
      owner: "troubadour",
      card: "foundation",
      uses: [holdThemOff, command, hex],
      upgrades,
    };
    // A FeatureEffect's uses are CardUses: a card table could hold them unchanged.
    const asCard: CardEffect = { cardId: "test", uses: effect.uses };
    expect(asCard.uses.map((u) => u.id)).toEqual(["main", "command", "main"]);
    expect(JSON.parse(JSON.stringify(effect))).toEqual(effect);
  });

  it("names every widened piece once (NV1-NV19)", () => {
    const pieces = {
      nv1: [nv1.length, prayerValue.kind, patronDice.kind],
      nv2: [rally.kind, beastform.kind],
      nv3: upgrades.length,
      nv4: scales.kind,
      nv5: [channel.kind, endEvents.length],
      nv6: triggers.length,
      nv7: [checks.length, conjureShield.kind],
      nv8: [rollChanges.length, damageChanges.length],
      nv9to19: [mods.length, darkCloud.radius, loyalFriend.kind],
    };
    expect(pieces).toEqual({
      nv1: [3, "reduceDamage", "dice"],
      nv2: ["delegate", "delegate"],
      nv3: 3,
      nv4: "adjustHpMarked",
      nv5: ["effect", 7],
      nv6: 15,
      nv7: [10, "situation"],
      nv8: [9, 10],
      nv9to19: [14, "close", "manual"],
    });
  });
});

// Plan drawer-answers, tracer DA0: widened again for the user's answers of 2026-10-29 / 30, widen only (no step kind
// added: STEP_KINDS above is still CA0 + SD0, and every table above still compiles and merges).
const stanceDrop: EndEvent = "stanceDrops";
const grappleRestrain: OutcomeStep = { kind: "condition", to: "targets", condition: { kind: "standard", condition: "restrained" }, duration: "temporary", endsOn: [stanceDrop] };
const stable: OutcomeStep = { kind: "reduceSeverity", to: "self", steps: 1, insteadOfArmorSlot: true };
const wings: OutcomeStep = { kind: "convertMarks", to: "self", from: "armor", into: "hope", insteadOfArmorSlot: true };
const darkAegis: OutcomeStep = { kind: "negate", to: "self", what: "damage", ignoreOnHitHp: true };
const unshakable: OutcomeStep = { kind: "negate", to: "self", what: "stress" };
const drainingBane: Step = { kind: "optional", id: "clear-stress", label: "Clear a Stress", defaultOn: true, steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] };
const wardensProtection: CardUse = {
  id: "main",
  name: "Warden's Protection",
  activation: { kind: "action" },
  targets: { side: "ally", range: "close", count: { kind: "upTo", n: { kind: "dice", dice: { count: one, sides: 4 } }, rolledFirst: true } },
  steps: [{ kind: "clear", to: "targets", track: "hp", amount: { kind: "fixed", value: 2 } }],
};
const charge: Step = { kind: "move", to: "self", mode: "intoMelee", relativeTo: "target", when: ["success"] };
const cannonball: CardUse = {
  id: "main",
  name: "Cannonball",
  activation: { kind: "action" },
  roll: { kind: "trait", trait: ["agility", "strength"], difficulty: { kind: "target" }, attack: true },
  rolledBy: { who: "ally", proficiency: "actor", targets: { side: "enemy", range: "close", count: { kind: "one" } } },
  steps: [],
};

describe("the DA0 widening (drawer-answers)", () => {
  it("expresses each answer with the widened pieces, and the step kinds are unchanged", () => {
    expect([grappleRestrain, stable, wings, darkAegis, unshakable, drainingBane, charge].map((s) => s.kind)).toEqual([
      "condition",
      "reduceSeverity",
      "convertMarks",
      "negate",
      "negate",
      "optional",
      "move",
    ]);
    expect([wardensProtection.targets, cannonball.rolledBy?.who, cannonball.roll?.kind]).toEqual([wardensProtection.targets, "ally", "trait"]);
    // DA0 added no step kind; plan lanes, tracer V appended its own after SD0's.
    expect(STEP_KINDS).toHaveLength(CA0_STEP_KINDS.length + SD0_STEP_KINDS.length + V_STEP_KINDS.length);
  });
});

// ---------------------------------------------------------------- plan lanes, tracer V (docs/tasks/TASK-LN-V.md)
// The vocabulary widened once for every wave-4 engine lane (labels lane:w1-*), widen only. Each value below is a bead's
// mechanic written with the new pieces: the types are the test (a narrowing or a missing member breaks the build).

const V_STEP_KINDS = ["loadout", "inventory", "endEffect", "setStance", "exhaust", "revive", "deathMove", "downtime", "armorCost"] as const;
const V_TRIGGER_KINDS = ["pcSpotlit", "allyAttacks", "pcDealsDamage", "pcsRest"] as const;
const d = (count: number, sides: 4 | 6 | 8 | 10 | 12 | 20) => ({ count: { kind: "fixed", value: count } as NumberSource, sides });

// E1: triggers, roll filters, rolls
const vTriggers: Trigger[] = [
  { kind: "afterAllyRolls", includeSelf: true, result: "successWithHope", against: { enemy: true, within: "far" } }, // dcm-0gi Eclipse
  { kind: "afterYouRoll", roll: "action", result: "successWithFear" }, // dcm-1o3 Dread-Touched
  { kind: "gmWouldGainFear", byYou: true, result: "successWithFear" }, // dcm-1o3
  { kind: "afterAllyRolls", includeSelf: true, roll: "any" }, // dcm-3ft Adjust Reality
  { kind: "afterYouRoll", roll: "any", result: "failure", duality: "fear" }, // dcm-5z3 Courage
  { kind: "afterYouRoll", roll: "action", result: "successWithHope" }, // dcm-a9n Favor, dcm-nhr Ethereal Visage
  { kind: "afterYouRoll", roll: "action", result: "success", against: { creature: { kind: "tagged", tag: "Twilight Toll" } }, noDamageRoll: true }, // dcm-94h
  { kind: "afterYouRoll", roll: "spellcast", result: "critical", cardDomain: "sage" }, // dcm-z1a Fane of the Wilds
  { kind: "afterAllyRolls", roll: "attack", against: { enemy: true, inArea: "sage-forest-sprites" } }, // dcm-g6t
  { kind: "whenYouAttack", result: "success", weapon: true, weaponSlot: "primary" }, // dcm-ab5 Ignition
  { kind: "whenTargetMarksHp", fromUse: "transformation:vampire:fangs" }, // dcm-bn1 Feed
  { kind: "whenTargetMarksHp", stage: "would", source: "any" }, // dcm-raa Grace-Touched
  { kind: "whenHelping", helper: "self" }, // dcm-iu4 Tactician
  { kind: "whenYouRecall" }, // dcm-bxp.99.19.1 Perfect Recall
  { kind: "whenYouDealDamage", toEnemy: true, within: "melee" }, // dcm-ssf, dcm-ofy
  { kind: "whenEnemyEntersRange", range: "veryClose" }, // dcm-bpr Hold the Line
  { kind: "beforeYouRoll", roll: "attack", weaponRange: "melee" }, // dcm-wut Surrounded
  { kind: "whenArmorSlotMarked", who: "self", stage: "would" }, // dcm-98d Unyielding Armor
  { kind: "whenAllyWouldTakeDamage", range: "veryFar", unlimited: true }, // dcm-3i4, dcm-uj0
  { kind: "whenYouWouldTakeDamage", keyword: "fire" }, // dcm-dv6 Fireproof
  { kind: "timing", at: "afterRest", restType: "short", during: true }, // dcm-2a1 Efficient
];
const breath: RollSpec = { kind: "trait", trait: "instinct", difficulty: { kind: "target" }, asWeapon: true }; // dcm-gvr
const eyeOfTheSage: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" }, critRange: 19, halveEvasion: true }; // dcm-mhn, dcm-xyw
const opportunity: RollSpec = { kind: "reaction", trait: "agility", difficulty: { kind: "target" }, anyTrait: true }; // dcm-fjh

// E2 / E7: mods on creatures, the reaction window
const vMods: Mod[] = [
  { kind: "attackedRider", rider: { by: "anyone", onSuccess: true, damage: { kind: "add", amount: { kind: "dice", dice: d(2, 12) } } } }, // dcm-9gw
  { kind: "attackedRider", rider: { by: "pcs", attackerSteps: [{ kind: "manual", to: "self", text: "Clear a Stress or gain a Hope" }] } }, // dcm-7zb
  { kind: "attackedRider", rider: { by: "caster", direct: true, advantage: true, halveEvasion: true } }, // dcm-xyw, dcm-51s
  {
    kind: "bearerRider",
    rider: { on: "acts", steps: [{ kind: "damage", to: "self", roll: { kind: "dice", dice: d(1, 10) }, type: "physical", direct: true }] },
  }, // dcm-bxp.99.19.3 Poisoned, dcm-f0m, dcm-kti
  { kind: "bearerRider", rider: { on: "actionRoll", timing: "before", costs: [{ kind: "hope", amount: one }], steps: [] } }, // dcm-kti Shadow Shackles
  { kind: "disadvantage", on: "attack", beyond: "melee" }, // dcm-4dc Sandstorm
  { kind: "disadvantage", on: "attack", unlessTarget: "caster" }, // dcm-346 In Your Face, Taunted
  { kind: "mustAttack", target: "caster" }, // dcm-e75 Goad Them On
  { kind: "disadvantageAgainst", on: "attack", from: "melee", buyOff: [{ kind: "stress", amount: one }] }, // dcm-eut
  { kind: "advantage", on: "presence", situation: "To intimidate a target" }, // dcm-733
  { kind: "resistance", type: "physical", level: "resistant", from: "outsideArea" }, // dcm-nt4
  { kind: "resistance", type: "both", level: "immune", keyword: "fire" }, // dcm-dv6 Fireproof
  { kind: "weakness", keyword: "fire" }, // dcm-dv6 Made of Straw
  { kind: "weaponTrait", weapon: "either", trait: "finesse", choice: "trait" }, // dcm-5dg
  { kind: "extraTargets", on: "attack", count: one }, // dcm-y3e Parallela
  { kind: "forcedMoveReduce", steps: 2 }, // dcm-1yo
  { kind: "moveLimit", maxRange: "veryClose" }, // dcm-wuu Creeping Fire
  { kind: "moveLimit", direction: { choice: "wind" } }, // dcm-3oe Hurricane
  { kind: "replaceCondition", from: "hidden", to: "cloaked" }, // dcm-bhp
  { kind: "dualityDie", die: "fear", sides: 20 }, // dcm-kti Battle Lust
  { kind: "gmControl", asAdversary: "weredrake", d20: true }, // dcm-idz
  { kind: "standardAttack", name: "Claw Swipe", range: "veryClose", damage: { ...d(1, 10), plus: { kind: "fixed", value: 3 } }, type: "physical" }, // dcm-gx3
  { kind: "features", remove: ["Stolen Armor", "Flail Swipe"], add: ["Double Swipe"] }, // dcm-gx3
  { kind: "stat", stat: "stressMax", delta: one }, // dcm-u6z, dcm-fjh
  { kind: "flag", flag: "cannotBeVulnerable" }, // dcm-v17
  { kind: "flag", flag: "noHopeFeaturesAgainst" }, // dcm-zos
  { kind: "flag", flag: "noCritDamage" }, // dcm-yea
];

// E3 / E6: steps, saves, numbers, choices, endings
const vSteps: Step[] = [
  { kind: "markArmor", to: "targets", amount: one, noBenefit: true, ifUnable: [{ kind: "markHp", to: "targets", amount: one }] }, // dcm-18i
  { kind: "hope", to: "targets", change: "lose", amount: one, ifUnable: [{ kind: "markStress", to: "targets", amount: { kind: "fixed", value: 2 } }] }, // dcm-5xi
  { kind: "markStress", to: "targets", amount: one, when: [{ kind: "targetCheck", check: { kind: "usedArmor", used: false } }] }, // dcm-sos
  { kind: "optional", id: "gold", label: "Spend gold instead", by: { to: "targets" }, steps: [{ kind: "convertMarks", to: "chooser", from: "hp", into: "gold" }] }, // dcm-6ju
  {
    kind: "choose",
    id: "inspire",
    label: "Clear a Stress or gain a Hope",
    by: { to: "allies", pick: { side: "ally", range: "veryClose", count: { kind: "all" } } },
    options: [
      { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "chooser", track: "stress", amount: one }] },
      { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "chooser", change: "gain", amount: one }] },
    ],
  }, // dcm-bz8
  { kind: "choose", id: "second-poison", label: "Second poison", distinctFrom: "poison", options: [] }, // dcm-40m
  { kind: "check", dice: d(1, 6), test: { kind: "even" }, then: [], otherwise: [] }, // dcm-27j
  {
    kind: "check",
    dice: d(1, 6),
    test: { kind: "totalAtLeast", value: 1 },
    then: [],
    otherwise: [],
    table: [
      { atLeast: 1, atMost: 2, steps: [] },
      { atLeast: 3, atMost: 6, steps: [] },
    ],
  }, // dcm-27j Broken Magic
  {
    kind: "save",
    to: "targets",
    trait: "instinct",
    difficulty: { kind: "fixed", value: 14 },
    disadvantage: true,
    autoFail: [{ kind: "standard", condition: "restrained" }],
    onFail: [],
    onSuccess: [],
  }, // dcm-rb0, dcm-fev
  { kind: "followUp", targets: { side: "enemy", range: "close", count: { kind: "one" }, origin: "chain" }, steps: [], repeat: { until: "noTargets" } }, // dcm-rou, dcm-dgu
  {
    kind: "followUp",
    roll: eyeOfTheSage,
    targets: { side: "enemy", range: "melee", count: { kind: "one" } },
    steps: [],
    repeat: { until: "miss", costEach: [{ kind: "stress", amount: one }] },
  }, // dcm-7az
  { kind: "markHp", to: "picked", amount: { kind: "dice", dice: d(1, 4) }, distribution: "split", maxPer: 3 }, // dcm-zhc
  { kind: "markStress", to: "allies", amount: { kind: "triggerAmount" }, distribution: "split" }, // dcm-63j
  { kind: "clearCondition", to: "selfAndAllies", condition: { kind: "standard", condition: "vulnerable" }, all: true }, // dcm-730
  { kind: "move", to: "targets", mode: "ground" }, // dcm-yzr
  { kind: "move", to: "self", mode: "leaveScene" }, // dcm-icd
  { kind: "tokens", to: "targets", op: "add", amount: one, holder: "recipient", name: "bramble" }, // dcm-xp0
  { kind: "effect", to: "targets", label: "Blight Seed", mods: [], duration: "scene", stacking: "refuse" }, // dcm-kkx
  { kind: "endEffect", to: "self" }, // dcm-8x8
  { kind: "endEffect", to: "self", of: "transformation:werewolf:wolf-form" }, // dcm-5fc
  { kind: "loadout", to: "self", op: "swapWithVault" }, // dcm-p1r
  { kind: "loadout", to: "self", op: "reduceRecallCost", amount: one }, // dcm-bxp.99.19.1
  { kind: "inventory", to: "targets", op: "take", item: "consumable" }, // dcm-0gh
  { kind: "setStance", to: "self", choice: "stance" }, // dcm-awh
  { kind: "exhaust", to: "self", per: "rest" }, // dcm-war
  { kind: "revive", to: "self", clearHp: "all", clearStress: true }, // dcm-145
  { kind: "deathMove", to: "targets" }, // dcm-702
  { kind: "downtime", to: "picked", op: "extraMove", at: "nextRest" }, // dcm-bxp.99.19.2, dcm-2a1
  { kind: "armorCost", to: "targets", slotsPerStep: 2 }, // dcm-s77
  { kind: "pay", costs: [{ kind: "hope", amount: one }], paidBy: "triggerSubject" }, // dcm-8yr
  { kind: "modifyRoll", to: "self", change: { kind: "reach", steps: 1 } }, // dcm-x7p
  { kind: "modifyRoll", to: "self", change: { kind: "rerollHeld", die: "slayer", atMost: 1 } }, // dcm-sa2
  { kind: "modifyDamage", to: "targets", change: { kind: "best", of: 2 } }, // dcm-51s
  { kind: "damage", to: "targets", roll: { kind: "companion" }, type: "weapon", keyword: "fire" }, // dcm-2z2, dcm-dv6
  {
    kind: "condition",
    to: "targets",
    condition: { kind: "standard", condition: "restrained" },
    duration: "manual",
    endsOn: ["gmSpendsFear"],
    endsOnCaster: ["moves", "failWithFear"],
  }, // dcm-bpr
  {
    kind: "effect",
    to: "picked",
    label: "Eye of the Storm",
    mods: [{ kind: "stat", stat: "evasion", delta: one }],
    duration: "manual",
    endsOn: ["usedAgain"],
    endsOnCaster: ["takeSevere"],
  }, // dcm-wjv
  { kind: "effect", to: "self", label: "Backup", mods: [], duration: "session", endsOnRoll: { roll: "presence" } }, // dcm-3ea
  { kind: "effect", to: "targets", label: "Timejammer", mods: [], duration: "manual", endsOnRoll: { roll: "action", by: "caster", targetsCreature: true } }, // dcm-cwh
  { kind: "effect", to: "self", label: "Menacing Reach", mods: [], duration: "scene", endsOnRoll: { roll: "attack", result: "success", weapon: "primary" } }, // dcm-ffk
  {
    kind: "effect",
    to: "self",
    label: "Glamour",
    mods: [],
    duration: "manual",
    endsOn: ["markHp", "dealDamage"],
    maintain: { costs: [{ kind: "stress", amount: one }] },
  }, // dcm-4qv
  { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Asleep" }, duration: "manual", endsOn: ["takeDamage", "gmSpendsFear"] }, // dcm-utu
  { kind: "effect", to: "self", label: "Spectral", mods: [], duration: "scene", endsOn: ["actionRoll"] }, // dcm-0ey
  { kind: "effect", to: "self", label: "Marked for Death", mods: [], duration: "rest", endsOn: ["targetDefeated", "gmSpendsFear"] }, // dcm-8bv
  { kind: "effect", to: "self", label: "Shield Aura", mods: [], duration: "manual", endsOn: ["reducedToNoHp"] }, // dcm-sim
  { kind: "effect", to: "self", label: "Invisible", mods: [], duration: "manual", endsOn: ["tokensGone"] }, // dcm-7n7
  { kind: "effect", to: "self", label: "Cloaked", mods: [], duration: "manual", endsOn: ["bearerAttacks", "endsMoveInSight"] }, // dcm-bhp
  {
    kind: "area",
    to: "self",
    area: {
      label: "Wall of Flame",
      centre: "point",
      radius: "close",
      side: "all",
      duration: "scene",
      shape: "wall",
      onCross: [{ kind: "damage", to: "triggerSubject", roll: { kind: "dice", dice: d(4, 10) }, type: "magic" }],
      endsOn: ["ownerLeavesArea"],
    },
  }, // dcm-cma, dcm-ii4
  {
    kind: "area",
    to: "self",
    area: {
      label: "Wild Fortress",
      centre: "self",
      radius: "veryClose",
      side: "selfAndAllies",
      duration: "manual",
      damageable: { major: 15, severe: 30, hp: 3, attacksAutoSucceed: true },
    },
  }, // dcm-cj8
  {
    kind: "area",
    to: "self",
    area: {
      label: "Dark Cloud",
      centre: "point",
      radius: "veryClose",
      side: "all",
      duration: "temporary",
      blocksSight: true,
      placeWithin: "close",
      perObserver: "cloaked",
    },
  }, // dcm-bxp.99.19.39, dcm-bhp
];
const vNumbers: NumberSource[] = [
  { kind: "free", who: "self", track: "stress" }, // dcm-8x8
  { kind: "dualityDie", die: "fear" }, // dcm-d1b
  { kind: "stat", stat: "armorScore", who: "self" }, // dcm-bxp.99.19.4
  { kind: "stat", stat: "majorThreshold", who: "target" }, // dcm-a7o
  { kind: "creatureCount", side: "allies", within: "close", name: "Mechanorb", excludeSelf: true }, // dcm-ttz
  { kind: "gold", who: "target", unit: "bag" }, // dcm-0gh
  { kind: "creatureTokens", who: "target", name: "bramble" }, // dcm-xp0
  { kind: "classDie", die: "unstoppable" }, // dcm-v17
  { kind: "tideTokens" }, // dcm-78x
  { kind: "dice", dice: { ...d(1, 6), sidesOf: "companion" } }, // dcm-2z2
];
const vChoices: NumberChoice[] = [
  { id: "teleport", label: "Bonus", min: -2, values: [3, 1, 0, -2] }, // dcm-uyc
  { id: "stress", label: "Stress", min: 0, max: { kind: "marked", who: "target", track: "stress" }, afterTargets: true }, // dcm-fnq
];
const vSaves: SaveDifficulty[] = [
  {
    kind: "raised",
    base: { kind: "actorDifficulty" },
    allies: { within: "close", of: "target", name: "Siren" },
    cost: { kind: "stress", amount: one },
    each: 1,
  }, // dcm-q0a
  { kind: "falling", start: { kind: "lastRoll" }, step: 1 }, // dcm-b77
];
const vTargets: TargetSpec[] = [
  { side: "enemy", range: "close", count: { kind: "any", max: { kind: "chosen", choice: "hope" } }, among: "hit" }, // dcm-y45
  { side: "enemy", range: "veryClose", count: { kind: "all" }, excludeSubject: true }, // dcm-ssf
  { side: "any", range: "close", count: { kind: "upTo", n: one, min: 2 }, willing: true }, // dcm-d7h
  { side: "enemy", range: "melee", count: { kind: "one" }, hostRange: true }, // dcm-x7p
  { side: "enemy", range: "melee", count: { kind: "one" }, companionRange: true, origin: "actor" }, // dcm-2z2, dcm-dgu
];

// E5: checks and limits
const vGates: Gate[] = [
  { kind: "targetCheck", check: { kind: "track", who: "target", track: "armor", measure: "free", atMost: 0 } }, // dcm-18i
  { kind: "targetCheck", check: { kind: "track", who: "target", track: "hope", measure: "marked", atMost: 0 } }, // dcm-5xi
  { kind: "targetCheck", check: { kind: "tokens", who: "target", name: "bramble", atLeast: 3 } }, // dcm-xp0
];
const vChecks: StateCheck[] = [
  { kind: "tokens", atMost: 0 }, // dcm-2g9, dcm-7n7
  { kind: "within", range: "melee", who: "target" }, // dcm-9l4
  {
    kind: "anyOf",
    checks: [
      { kind: "hasCondition", condition: { kind: "standard", condition: "cloaked" } },
      { kind: "allyNear", range: "melee", of: "target" },
    ],
  }, // dcm-85u
  { kind: "weaponRange", weapon: "either", atMost: "veryClose" }, // dcm-13s
  { kind: "holdsItem", item: "Enchanted Talisman", who: "subject" }, // dcm-3i4
  { kind: "usedOnBefore" }, // dcm-c75
  { kind: "moonPhase", phase: 1 }, // dcm-lk8
  { kind: "inArea", featureId: "subclass:moon:circle-of-power", who: "subject" }, // dcm-ii4
  { kind: "not", check: { kind: "hasCondition", condition: { kind: "tag", tag: "Dazed" } } }, // dcm-2f3
];
const vLimits: Limit[] = [
  { per: "session", period: "week", consumedOn: "failure" }, // dcm-aym
  { per: "scene", period: "gmTurn" }, // dcm-c5h
];
const runeWard: CardUse = {
  id: "main",
  name: "Rune Ward",
  activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryFar", includeSelf: true, unlimited: true } },
  paidBy: "triggerSubject",
  costs: [{ kind: "hope", amount: one }],
  steps: [],
}; // dcm-uj0

// E7: the adversary engine
const vAdversaryTriggers: AdversaryTrigger[] = [
  { kind: "pcSpotlit", within: "veryClose" },
  { kind: "allyAttacks", range: "close", stage: "failed" },
  { kind: "pcDealsDamage", within: "close", stage: "would" },
  { kind: "pcsRest", rest: "long" },
  { kind: "onDamaged", weaponAttack: true, attackerBeyond: "veryClose", keyword: "fire" },
  { kind: "allyDefeated", allyType: "leader" },
  { kind: "pcRolls", result: "failureWithHope", notCritical: true },
  { kind: "onMarkStress", stage: "would" },
  { kind: "onMarkHp", atMost: 1, fromAttack: true, includeZero: true },
  { kind: "onSpotlight", byFear: true },
]; // dcm-2gn
const vAdversaryReqs: AdversaryRequirement[] = [
  { kind: "hasCondition", condition: { kind: "tag", tag: "Dazed" }, lacks: true }, // dcm-2f3
  { kind: "situation", text: "1 or more tokens", check: { kind: "tokens", atLeast: 1 } }, // dcm-cdz
];
const vAdversaryModifiers: AdversaryModifier[] = [
  { kind: "relentless", times: 5, timesFrom: { kind: "cardTokens" } }, // dcm-gx1
  { kind: "selfCondition", condition: { kind: "standard", condition: "hidden" } }, // dcm-cdz
];
const vAdversarySteps: AdversaryStep[] = [
  { kind: "summon", label: "Horde", count: one, hp: { kind: "targetCount", which: "picked" } }, // dcm-145
  { kind: "summon", label: "Duplicate", count: one, duplicate: true, range: "close" }, // dcm-v27
  {
    kind: "countdown",
    op: "start",
    label: "All-Consuming Rage",
    start: { kind: "fixed", value: 8 },
    loop: true,
    direction: "decreasing",
    onZero: "Rage",
    tickOn: "actionRoll",
  }, // dcm-m5s, dcm-bxp.78
];
const onMySignal: AdversaryFeatureUse = {
  id: "main",
  activation: { kind: "action" },
  needsSpotlight: true,
  groupAttack: { within: "far", name: "Archer Guard", eachRolls: true, advantage: true },
  exclusive: true,
  steps: [],
}; // dcm-1ch, dcm-vkp

describe("the V widening (plan lanes)", () => {
  it("appends its step kinds after SD0's and its adversary trigger kinds after AA0's", () => {
    const base = CA0_STEP_KINDS.length + SD0_STEP_KINDS.length;
    expect(STEP_KINDS.slice(base)).toEqual([...V_STEP_KINDS]);
    expect(ADVERSARY_STEP_KINDS.slice(base, base + V_STEP_KINDS.length)).toEqual([...V_STEP_KINDS]);
    expect(ADVERSARY_TRIGGER_KINDS.slice(-V_TRIGGER_KINDS.length)).toEqual([...V_TRIGGER_KINDS]);
  });

  it("expresses each wave-4 bead's mechanic with the widened pieces", () => {
    expect(vTriggers).toHaveLength(21);
    expect([breath.kind, eyeOfTheSage.critRange, opportunity.kind]).toEqual(["trait", 19, "reaction"]);
    expect(vMods).toHaveLength(27);
    for (const kind of V_STEP_KINDS) expect(vSteps.map((s) => s.kind)).toContain(kind);
    expect([vNumbers.length, vChoices.length, vSaves.length, vTargets.length, vGates.length, vChecks.length, vLimits.length]).toEqual([10, 2, 2, 5, 3, 9, 2]);
    expect([runeWard.paidBy, onMySignal.groupAttack?.eachRolls]).toEqual(["triggerSubject", true]);
    expect([vAdversaryTriggers.length, vAdversaryReqs.length, vAdversaryModifiers.length, vAdversarySteps.length]).toEqual([10, 2, 2, 3]);
  });
});
