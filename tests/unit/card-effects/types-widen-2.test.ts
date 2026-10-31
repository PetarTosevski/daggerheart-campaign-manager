import { describe, expect, it } from "vitest";

import { stateCheckMet, type RequirementState } from "@/lib/domain/card-effects/availability";
import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type {
  AreaSpec,
  CardEffect,
  CardUse,
  CheckTest,
  EndEvent,
  Escape,
  FollowUpRepeat,
  Mod,
  NumberSource,
  RollChange,
  StateCheck,
  Step,
  TargetSpec,
  Trigger,
} from "@/lib/domain/card-effects/types";
import { STEP_KINDS } from "@/lib/domain/card-effects/types";
import { ADVERSARY_STEP_KINDS } from "@/lib/domain/adversary-effects/types";
import type { AdversaryFeatureUse, AdversaryTrigger } from "@/lib/domain/adversary-effects/types";
import { resolveNumber, type NumberEnv } from "@/lib/domain/combat-actions/numbers";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan lanes-2, tracer V2 (docs/tasks/TASK-LN-V2.md): the vocabulary widened a second time for the open vocabulary-gap
// beads, widen only. The fixtures below write each bead's mechanic with the new pieces (the types are the test: a
// narrowing breaks the build); the runtime checks prove the fallbacks keep today's behaviour until a wave-8 lane runs them.

const fixed = (value: number) => ({ kind: "fixed" as const, value });
const d = (sides: 4 | 6 | 8 | 10 | 12 | 20, count = 1) => ({ count: fixed(count), sides });

const V2_STEP_KINDS = ["forcedAttack", "changeForm"] as const;

// ---------------------------------------------------------------- the beads' mechanics

/** dcm-xobk (3) Encumber, CB p.218; dcm-zi3k Scare / Slow, HF p.75; dcm-wuu Bramble Patch, Shadow Swarm. */
const escapes: Escape[] = [
  { trait: "finesse", difficulty: { kind: "sum", of: [fixed(12), { kind: "creatureTokens", who: "self", name: "bramble" }] } },
  { trait: ["finesse", "strength"], attack: true },
  { trait: "presence", difficulty: fixed(16) },
  { costs: [{ kind: "hope", amount: fixed(2) }] },
  { trait: "spellcast", difficulty: fixed(12) },
];

const v2Numbers: NumberSource[] = [
  { kind: "targetCount", which: "markedHp" }, // dcm-nsqo Suppressing Blast
  { kind: "targetCount", which: "markedHp", severity: "severe" }, // dcm-k4x5 Frenzied Feeding
  { kind: "recorded" }, // dcm-b77 Banish's return
  { kind: "creatureCount", side: "allies", name: "Bladed Guard", of: "self", chain: "melee" }, // dcm-346 Shield Wall
];

const v2Mods: Mod[] = [
  { kind: "cannotAttackTarget", target: "caster" }, // dcm-zi3k Beguiled
  { kind: "moveRange", range: "far" }, // dcm-z5a6 Unleash the Beast
  { kind: "damageTaken", change: { kind: "add", amount: { kind: "creatureTokens", who: "self", name: "leechpole" } } }, // dcm-kvx4
  { kind: "marksMultiplier", factor: 2, of: ["hope", "armor", "hp", "stress"] }, // dcm-fbsr Unstuck
  { kind: "features", removeOptions: [{ feature: "Elemental Breath", choose: "head", option: "fire" }] }, // dcm-qw4f
  { kind: "flag", flag: "onlyFlee" }, // dcm-zi3k Scared
  { kind: "flag", flag: "cannotSpendHope" }, // dcm-5kxg Ravenous
  { kind: "flag", flag: "cannotClearHp" }, // dcm-5kxg Afflicted
  { kind: "flag", flag: "cannotClearStress" },
  { kind: "flag", flag: "attacksHalveEvasion" }, // dcm-4c9m Never Misses
  // dcm-zi3k Scared: a Stress whenever the GM spends a Fear
  { kind: "bearerRider", rider: { on: "gmSpendsFear", steps: [{ kind: "markStress", to: "self", amount: fixed(1) }] } },
  // dcm-z5a6 Pin; dcm-lvgm Wings of Light
  { kind: "bearerRider", rider: { on: "casterMoves", steps: [{ kind: "move", to: "self", mode: "withCaster" }] } },
  // dcm-xobk (4) Thorny Cage
  { kind: "bearerRider", rider: { on: "rolledAgainst", roll: "action", steps: [{ kind: "markStress", to: "triggerSubject", amount: fixed(1) }] } },
  // dcm-wqgs Comatize
  { kind: "bearerRider", rider: { on: "marksLastStress", steps: [{ kind: "deathMove", to: "self" }] } },
];

const v2Checks: StateCheck[] = [{ kind: "optionRemoved", option: { feature: "Elemental Breath", choose: "head", option: "fire" } }]; // dcm-qw4f
const v2Tests: CheckTest[] = [{ kind: "allEven" }, { kind: "allOdd" }]; // dcm-4yg4 Lightning Bolt
const v2Ends: EndEvent[] = ["castsSpell", "benefitGranted"]; // dcm-o44e, dcm-5yew
const v2Triggers: Trigger[] = [{ kind: "whenYouChooseThisCard" }]; // dcm-40mj Vitality
const v2RollChanges: RollChange[] = [{ kind: "halveEvasion" }]; // dcm-5jyp Peerless Accuracy

/** dcm-4yg4: Lightning Strike's bounce (a fresh d6, 1d10 less each time) and Lightning Bolt (the damage dice all even). */
const bounces: FollowUpRepeat[] = [
  { until: "checkFails", check: { dice: d(6), test: { kind: "anyAtLeast", value: 4 } }, perLink: { kind: "add", amount: { kind: "calc", of: { kind: "dice", dice: d(10) }, times: -1 } } },
  { until: "checkFails", check: { test: { kind: "allEven" } } },
];

/** dcm-va0f Unleash Hellfire: 1d4 points within Far, Very Close of each; damage per burst a target is in. */
const hellfire: TargetSpec = { side: "enemy", range: "far", count: { kind: "all" }, area: "aroundPoint", areaRange: "veryClose", points: { kind: "dice", dice: d(4) } };

const v2Areas: AreaSpec[] = [
  // dcm-rx1k Hush
  { label: "Hush", centre: "target", radius: "veryClose", side: "all", duration: "manual", follows: true, endsOn: ["gmSpendsFear"], endsOnCaster: ["majorDamage"] },
  // dcm-o44e Veil of Night (a wall only the owner sees through; Hidden beyond it; ends on another spell)
  { label: "Veil of Night", centre: "point", radius: "far", side: "all", duration: "manual", shape: "wall", blocksSight: true, seeThrough: "owner", ownerPerObserver: "hidden", endsOnCaster: ["castsSpell"] },
  // dcm-o44e Eclipse
  { label: "Eclipse", centre: "self", radius: "far", side: "all", duration: "manual", blocksSight: true, seeThrough: "ownerAndAllies" },
  // dcm-wuu Shadow Swarm, Bramble Patch
  { label: "Shadow Swarm", centre: "point", radius: "close", side: "all", duration: "manual", blocksSight: true, memberCondition: { kind: "standard", condition: "vulnerable" }, dispel: { trait: "spellcast", difficulty: fixed(12) } },
  { label: "Bramble Patch", centre: "point", radius: "close", side: "all", duration: "manual", leave: { trait: "finesse" } },
  // dcm-5yew Forest Sprites; Phantom Retreat's spot
  { label: "Forest Sprite", centre: "point", radius: "melee", side: "all", duration: "rest", count: { kind: "spent", resource: "hope" }, endsOn: ["takeDamage", "benefitGranted"] },
  { label: "Phantom Retreat", centre: "self", radius: "melee", side: "all", duration: "rest", anchored: true },
];

const v2Steps: Step[] = [
  // dcm-c8h3 Words of Discord; dcm-zi3k Beguiled
  { kind: "forcedAttack", to: "targets", against: { side: "enemy", range: "weapon", count: { kind: "one" }, origin: "target" } },
  // dcm-3ag5 Transform
  { kind: "changeForm", to: "self", adversaryId: "forlorne-lykona-dragon" },
  // dcm-zi3k Doom
  { kind: "markHp", to: "targets", amount: { kind: "free", who: "target", track: "hp" }, reduceWith: "hope" },
  // dcm-nh44 Stone of Omens
  { kind: "hope", to: "selfAndAllies", change: "gain", amount: fixed(3), distribution: "split" },
  // dcm-b77 Banish: the cast's highest d20 is kept with the condition, the return save starts there
  {
    kind: "condition",
    to: "targets",
    condition: { kind: "tag", tag: "Banished" },
    duration: "manual",
    record: { kind: "lastRoll" },
    mods: [
      {
        kind: "bearerRider",
        rider: {
          on: "pcRollsWithFear",
          steps: [{ kind: "save", to: "self", difficulty: { kind: "falling", start: { kind: "recorded" }, step: 1 }, onFail: [], onSuccess: [{ kind: "clearCondition", to: "self", condition: { kind: "tag", tag: "Banished" } }] }],
        },
      },
    ],
  },
  // dcm-zi3k Scare
  { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Scared" }, duration: "manual", escape: { trait: "presence", difficulty: fixed(16) } },
  // dcm-8bv Marked for Death: the GM spends Fear equal to the tier to clear it; Slumber: one Fear
  { kind: "effect", to: "targets", label: "Marked for Death", mods: [], duration: "rest", endsOn: ["targetDefeated", "gmSpendsFear"], endFear: { kind: "byTier", values: [1, 2, 3, 4] } },
  { kind: "condition", to: "targets", condition: { kind: "tag", tag: "Asleep" }, duration: "manual", endsOn: ["takeDamage", "gmSpendsFear"], endFear: fixed(1) },
  // dcm-xobk (3) Encumber
  { kind: "tokens", to: "targets", op: "add", amount: fixed(1), holder: "recipient", name: "bramble", escape: escapes[0]! },
  // dcm-xobk (1) Shield Wall: the move stops; (2) Drain and Multiply: the combined Minions leave
  { kind: "negate", to: "triggerSubject", what: "move" },
  { kind: "move", to: "picked", mode: "leaveScene", leaveAs: "combined" },
  // dcm-5yew Phantom Retreat's return
  { kind: "move", to: "self", mode: "teleport", relativeTo: "area", area: "Phantom Retreat" },
  // dcm-vf7i Contacts Everywhere's supply
  { kind: "inventory", to: "self", op: "giveGold", amount: fixed(1) },
  { kind: "inventory", to: "self", op: "giveItem", text: "a unique tool or a mundane object the situation requires" },
  // dcm-rao5 Bird's-Eye View: one shared advantage
  { kind: "effect", to: "selfAndAllies", label: "Bird's-Eye View", mods: [{ kind: "advantage", on: "action" }], duration: "nextRoll", sharedGrant: true },
  // dcm-va0f
  { kind: "damage", to: "targets", roll: { kind: "dice", dice: d(6, 3) }, type: "magic", perArea: true },
  { kind: "followUp", roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } }, targets: { side: "enemy", range: "veryClose", count: { kind: "one" }, origin: "chain" }, steps: [], repeat: bounces[0]! },
];

/** dcm-40mj Vitality: two distinct permanent picks when the card is chosen, then the vault. */
const vitality: CardUse = {
  id: "main",
  name: "Vitality",
  activation: { kind: "auto", trigger: { kind: "whenYouChooseThisCard" } },
  steps: [
    {
      kind: "choose",
      id: "benefit",
      label: "Two of the following",
      count: fixed(2),
      distinct: true,
      options: [
        { id: "stress", label: "One Stress slot", steps: [{ kind: "effect", to: "self", label: "Vitality", mods: [{ kind: "stat", stat: "stressMax", delta: fixed(1) }], duration: "permanent" }] },
        { id: "hp", label: "One Hit Point slot", steps: [{ kind: "effect", to: "self", label: "Vitality", mods: [{ kind: "stat", stat: "hpMax", delta: fixed(1) }], duration: "permanent" }] },
      ],
    },
    { kind: "toVault", to: "self", permanent: true },
  ],
};

/** dcm-xobk (1) Shield Wall: before the move, an Agility Roll against 12 + the guards in the line. */
const shieldWall: AdversaryFeatureUse = {
  id: "main",
  activation: { kind: "auto", trigger: { kind: "pcMoves", into: "veryClose", stage: "would" } satisfies AdversaryTrigger },
  needsSpotlight: false,
  steps: [
    {
      kind: "save",
      to: "triggerSubject",
      trait: "agility",
      difficulty: { kind: "number", value: { kind: "sum", of: [{ kind: "fixed", value: 12 }, v2Numbers[3]!] } },
      onFail: [{ kind: "negate", to: "triggerSubject", what: "move" }],
      onSuccess: [],
    },
  ],
};

// ---------------------------------------------------------------- runtime fallbacks

const actor = (over: Partial<ActorState> = {}): ActorState => ({
  id: "pc",
  side: "pc",
  evasion: 10,
  thresholds: { major: 7, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  hope: 2,
  hopeMax: 6,
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 1, knowledge: 3 },
  spellcast: 3,
  proficiency: 2,
  level: 3,
  tier: 2,
  loadoutDomains: ["arcana"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "melee" } },
  ...over,
});

const adv = (id: string): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 5,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
});

const card = (steps: readonly Step[], over: Partial<CardUse> = {}): CardEffect => ({
  cardId: "v2-card",
  uses: [{ id: "main", name: "Test", activation: { kind: "action" }, steps, ...over }],
});
const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, rng: queueRng(dice), ...over });
function ok(result: ReturnType<typeof run>): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}
const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const oneEnemy = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };

const env = (over: Partial<NumberEnv> = {}): NumberEnv => ({
  traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
  spellcast: 0,
  proficiency: 1,
  level: 1,
  tier: 1,
  spent: {},
  choices: {},
  cardTokens: 0,
  gmFear: 0,
  self: { hp: 0, stress: 0, armor: 0 },
  markedThisMove: { self: {}, byTarget: {} },
  targetCount: { picked: 2, hit: 1, failedSave: 1 },
  loadoutDomains: [],
  vaultDomains: [],
  ...over,
});

const state: RequirementState = {
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  hope: 2,
  armorWorn: true,
  loadoutDomains: [],
  activeCardEffects: [],
  situations: [],
  facts: {},
};

describe("the V2 widening (plan lanes-2)", () => {
  it("appends its step kinds after V's, in the card and the adversary lists", () => {
    expect(STEP_KINDS.slice(-V2_STEP_KINDS.length)).toEqual([...V2_STEP_KINDS]);
    for (const kind of V2_STEP_KINDS) expect(ADVERSARY_STEP_KINDS).toContain(kind);
    expect(new Set(STEP_KINDS).size).toBe(STEP_KINDS.length);
  });

  it("expresses each needs-term bead's mechanic", () => {
    expect([escapes.length, v2Numbers.length, v2Mods.length, v2Checks.length, v2Tests.length, v2Ends.length]).toEqual([5, 4, 14, 1, 2, 2]);
    expect([v2Triggers.length, v2RollChanges.length, bounces.length, v2Areas.length, v2Steps.length]).toEqual([1, 1, 2, 7, 17]);
    for (const kind of V2_STEP_KINDS) expect(v2Steps.map((s) => s.kind)).toContain(kind);
    expect([hellfire.points?.kind, vitality.activation.kind, shieldWall.activation.kind]).toEqual(["dice", "auto", "auto"]);
  });

  it("number fallbacks: markedHp and recorded read 0, the old counts still read", () => {
    const rng = queueRng([]);
    expect(resolveNumber({ kind: "targetCount", which: "markedHp", severity: "severe" }, env(), rng)).toBe(0);
    expect(resolveNumber({ kind: "recorded" }, env(), rng)).toBe(0);
    expect(resolveNumber({ kind: "targetCount", which: "picked" }, env(), rng)).toBe(2);
  });

  it("a removed option is not known: the table confirms (undefined)", () => {
    expect(stateCheckMet(v2Checks[0]!, state)).toBeUndefined();
  });

  it("the new steps and the inventory gifts become manual prompts", () => {
    const plan = ok(
      run(
        card([
          { kind: "forcedAttack", to: "targets", against: { side: "enemy", range: "weapon", count: { kind: "one" } }, note: "Attack another adversary" },
          { kind: "changeForm", to: "self", adversaryId: "faun-form" },
          { kind: "inventory", to: "self", op: "giveGold", amount: fixed(1) },
          { kind: "inventory", to: "self", op: "giveItem", text: "a mundane object" },
        ], { targets: oneEnemy }),
        ctx([], { targets: [adv("a")] }),
      ),
    );
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.text])).toEqual([
      ["manual", "Attack another adversary"],
      ["manual", "changeForm"],
      ["manual", "giveGold"],
      ["manual", "a mundane object"],
    ]);
    expect(ofKind(plan, "inventory")).toEqual([]);
  });

  it("a move along with the caster is a labelled move prompt", () => {
    const plan = ok(run(card([{ kind: "move", to: "targets", mode: "withCaster" }], { targets: oneEnemy }), ctx([], { targets: [adv("a")] })));
    expect(ofKind(plan, "prompt").map((p) => p.text)).toEqual(["Move along with the caster"]);
  });

  it("an all-even / all-odd check reads every die", () => {
    const parity = (kind: "allEven" | "allOdd", dice: number[]) =>
      ofKind(
        ok(run(card([{ kind: "check", dice: d(8, 2), test: { kind }, then: [{ kind: "manual", to: "self", text: "yes" }], otherwise: [{ kind: "manual", to: "self", text: "no" }] }]), ctx(dice))),
        "prompt",
      ).map((p) => p.text);
    expect(parity("allEven", [4, 6])).toEqual(["yes"]);
    expect(parity("allEven", [4, 5])).toEqual(["no"]);
    expect(parity("allOdd", [3, 7])).toEqual(["yes"]);
    expect(parity("allOdd", [2, 7])).toEqual(["no"]);
  });

  it("the new mods travel on an effect as written", () => {
    const plan = ok(run(card([{ kind: "effect", to: "targets", label: "Unstuck", mods: [v2Mods[3]!, v2Mods[0]!], duration: "manual" }], { targets: oneEnemy }), ctx([], { targets: [adv("a")] })));
    expect(ofKind(plan, "effect")[0]!.mods).toEqual([v2Mods[3], v2Mods[0]]);
  });
});
