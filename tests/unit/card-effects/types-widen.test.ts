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
import { ADVERSARY_STEP_KINDS } from "@/lib/domain/adversary-effects/types";
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
    expect(STEP_KINDS.slice(CA0_STEP_KINDS.length)).toEqual([...SD0_STEP_KINDS]);
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
