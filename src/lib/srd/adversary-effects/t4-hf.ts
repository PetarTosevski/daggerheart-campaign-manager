// Adversary feature effects of tier 4 Hope & Fear adversaries (plan combat-actions, tracer AE-t4-hf). Pure data: no
// framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 29
// adversaries, 135 features (HF p.90-97, Forlorne Lykona HF p.142-143). Each entry quotes its feature text (as in
// ../adversaries.ts); what the vocabulary (src/lib/domain/adversary-effects/types.ts) cannot express is a `manual` step,
// never a vocabulary change. Readings, manual steps and their reasons: docs/tasks/TASK-CA-AE-t4-hf.md.
//
// Conventions (rules AR1-AR11 of the plan; CB = Core Book, HF = Hope & Fear, printed pages), as in the tier 1 and 2
// tables:
// - Actions need the spotlight; passives and reactions don't (CB p.194). "Mark a Stress" is a `stress` cost on the
//   adversary, "Spend a Fear" a `fear` cost asked first (CB p.194, Q19).
// - "Make an attack" is `adversaryAttack` against Evasion; the runner adds the stat block's ATK (AR1) to the use's own
//   roll. A follow-up roll (a bounce, a d4 branch) is not the use's roll, so it carries the ATK itself. One roll for
//   every target (AR7, CB p.161). A reaction roll without a number uses the adversary's Difficulty (CB p.193).
// - Triggered passives and Fear gains are `auto` (Q19: "Fear gains automatic"); other printed reactions are `reaction`
//   (a one-tap prompt defaulting to No), also where the text has no "you can".
// - Countdowns have separate uses: activate (the printed trigger), tick, and the effect when it triggers (a `situation`
//   reaction: a GM button). A countdown whose value is read by another rule (Diamond Hide) also keeps its value as
//   stat-block tokens, so a passive can read it (`cardTokens`).
// - "Mark / spend any number of …" is an `either` cost (one option per amount, read back as `spent`), or a `choose` with
//   a `pay` per option where a prompt number (a summon count) needs the amount.
// - Evolutions (HF p.61: "can't be triggered more than once in a scene") are `auto` uses limited to once per scene.
// - Damage to PCs comes back as incoming hits for the reaction window (Q13); PC reaction rolls are prompts (AR11), so a
//   `choose` inside a save's branch is the failing PC's own choice.

import type {
  AdversaryCost,
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryRequirement,
  AdversaryStep,
  AdversaryTrigger,
} from "../../domain/adversary-effects/types";
import type {
  ConditionRef,
  DamageRoll,
  DamageType,
  DieSides,
  NumberSource,
  Range,
  RollSpec,
  StandardCondition,
  TargetSpec,
} from "../../domain/card-effects/types";

// ---------------------------------------------------------------- building blocks

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const one = fixed(1);
const diceOf = (count: number | NumberSource, sides: DieSides, plus?: number): NumberSource => ({
  kind: "dice",
  dice: { count: typeof count === "number" ? fixed(count) : count, sides, ...(plus ? { plus: fixed(plus) } : {}) },
});
const roll = (count: number, sides: DieSides, plus?: number): DamageRoll => ({
  kind: "dice",
  dice: { count: fixed(count), sides, ...(plus ? { plus: fixed(plus) } : {}) },
});
const flat = (amount: number | NumberSource): DamageRoll => ({ kind: "flat", amount: typeof amount === "number" ? fixed(amount) : amount });
const STANDARD: DamageRoll = { kind: "standardAttack" };
const TOKENS: NumberSource = { kind: "cardTokens" };
const spent = (resource: "stress" | "fear"): NumberSource => ({ kind: "spent", resource });
const markedSelf = (track: "hp" | "stress"): NumberSource => ({ kind: "marked", who: "self", track });

/** d20 + ATK against each target's Evasion (AR1); the runner adds the stat block's Attack Modifier. */
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };
const ATTACK_WITH_ADVANTAGE: RollSpec = { ...ATTACK, advantage: true };
/** A follow-up attack (not the use's own roll) adds the printed ATK itself. */
const attackWithAtk = (atk: number): RollSpec => ({ ...ATTACK, modifier: fixed(atk) });
/** A reaction roll with no printed number uses the adversary's Difficulty (CB p.193). */
const OWN_DIFFICULTY = { kind: "actorDifficulty" } as const;
const dc = (value: number) => ({ kind: "fixed", value }) as const;

const STRESS = [{ kind: "stress", amount: one }] as const;
const FEAR = [{ kind: "fear", amount: one }] as const;
const TWO_FEAR = [{ kind: "fear", amount: fixed(2) }] as const;
/** "Mark / spend any number of …": one option per amount, 1 to `max` (the track's size or the Fear pool). */
const anyNumberOf = (kind: "stress" | "fear", max: number): AdversaryCost => ({
  kind: "either",
  options: Array.from({ length: max }, (_, i) => [{ kind, amount: fixed(i + 1) }]),
});

const oneEnemy = (range: Range | "unlimited"): TargetSpec => ({ side: "enemy", range, count: { kind: "one" } });
const upToEnemies = (n: number, range: Range | "unlimited"): TargetSpec => ({ side: "enemy", range, count: { kind: "upTo", n: fixed(n) } });
const allAround = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "aroundSelf" });
/** "All creatures within …": every creature around this adversary but itself. */
const everyoneAround = (range: Range): TargetSpec => ({ side: "any", range, count: { kind: "all" }, area: "aroundSelf", excludeSelf: true });
const allAroundPoint = (range: Range | "unlimited", areaRange: Range): TargetSpec => ({
  side: "enemy",
  range,
  count: { kind: "all" },
  area: "aroundPoint",
  areaRange,
});
/** "A group within X range" (CB p.104: a group is the creatures within Very Close of a point). */
const group = (range: Range) => allAroundPoint(range, "veryClose");
const inFront = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "front" });
const inLine = (range: Range, side: TargetSpec["side"] = "enemy"): TargetSpec => ({ side, range, count: { kind: "all" }, area: "line" });
const TRIGGER_SUBJECT = { side: "trigger", who: "subject" } as const;
const TRIGGER_SOURCE = { side: "trigger", who: "source" } as const;
/** Every PC, for steps on "each PC" outside the use's targets (the server passes the party; no map: Q18). */
const ANY_PC: TargetSpec = { side: "enemy", range: "unlimited", count: { kind: "any" } };

const VULNERABLE: ConditionRef = { kind: "standard", condition: "vulnerable" };
const RESTRAINED: ConditionRef = { kind: "standard", condition: "restrained" };
const HIDDEN: ConditionRef = { kind: "standard", condition: "hidden" };
const tag = (name: string, implies?: readonly StandardCondition[]): ConditionRef => ({ kind: "tag", tag: name, ...(implies ? { implies } : {}) });
const GRAPPLED = tag("Grappled", ["vulnerable", "restrained"]);
const COMATIZED = tag("Comatized");
const CONTAGIOUS = tag("Contagious");

const hit = ["hit"] as const;
const miss = ["miss"] as const;
const has = (condition: ConditionRef) => [{ kind: "targetHas", condition }] as const;

const situation = (text: string): AdversaryRequirement => ({ kind: "situation", text });

/** One use with the given parts (id "main" unless named). */
const featureUse = (u: Omit<AdversaryFeatureUse, "id"> & { id?: string }): AdversaryFeatureUse => ({ id: "main", ...u });
const entry = (adversaryId: string, feature: string, ...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({
  adversaryId,
  feature,
  uses,
});
type UseParts = Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string };
const passive = (u: Omit<UseParts, "steps"> & { steps?: readonly AdversaryStep[] }) =>
  featureUse({ activation: { kind: "passive" }, needsSpotlight: false, steps: [], ...u });
const action = (u: UseParts) => featureUse({ activation: { kind: "action" }, needsSpotlight: true, ...u });
const auto = (trigger: AdversaryTrigger, u: UseParts) => featureUse({ activation: { kind: "auto", trigger }, needsSpotlight: false, ...u });
const reaction = (trigger: AdversaryTrigger, u: UseParts) => featureUse({ activation: { kind: "reaction", trigger }, needsSpotlight: false, ...u });

const manual = (text: string, to: "self" | "targets" | "picked" = "self", extra: Partial<Extract<AdversaryStep, { kind: "manual" }>> = {}): AdversaryStep => ({
  kind: "manual",
  to,
  text,
  ...extra,
});
const gainFear = (amount = 1): AdversaryStep => ({ kind: "fear", to: "self", change: "gain", amount: fixed(amount) });
const save = (
  trait: Extract<AdversaryStep, { kind: "save" }>["trait"],
  difficulty: Extract<AdversaryStep, { kind: "save" }>["difficulty"],
  onFail: readonly AdversaryStep[],
  onSuccess: readonly AdversaryStep[] = [],
  extra: Partial<Extract<AdversaryStep, { kind: "save" }>> = {},
): AdversaryStep => ({ kind: "save", to: "targets", ...(trait ? { trait } : {}), difficulty, onFail, onSuccess, ...extra });
const damage = (r: DamageRoll, type: DamageType | "weapon", extra: Partial<Extract<AdversaryStep, { kind: "damage" }>> = {}): AdversaryStep => ({
  kind: "damage",
  to: "targets",
  roll: r,
  type,
  ...extra,
});

/**
 * One die read as ranges ("roll a d6 and use the corresponding result"): a chain of checks, each later one reading the
 * same result (0 dice + the last roll), as the tier 2 Battle Box does. `branches[i].upTo` is the highest result of that
 * branch; the last branch takes the rest.
 */
const dieBranches = (sides: DieSides, branches: readonly { upTo: number; steps: readonly AdversaryStep[]; note?: string }[], rest: readonly AdversaryStep[], note?: string): AdversaryStep => {
  const build = (i: number): AdversaryStep[] => {
    if (i >= branches.length) return [...rest];
    const b = branches[i]!;
    return [
      {
        kind: "check",
        ...(i === 0 && note ? { note } : b.note ? { note: b.note } : {}),
        dice: i === 0 ? { count: one, sides } : { count: fixed(0), sides, plus: { kind: "lastRoll" } },
        test: { kind: "totalAtMost", value: b.upTo },
        then: b.steps,
        otherwise: build(i + 1),
      },
    ];
  };
  return build(0)[0]!;
};

// ---------------------------------------------------------------- shared features

/** "Minion (X): The X is defeated when they take any damage. For every X damage a PC deals …" (CB p.201). */
const minion = (adversaryId: string, x: number) =>
  entry(adversaryId, `Minion (${x})`, passive({ modifiers: [{ kind: "minion", threshold: x }] }));

/**
 * "Group Attack: Spend a Fear to choose a target and spotlight all <name>s within Close range of them. Those Minions move
 * into Melee range of the target and make one shared attack roll. On a success, they deal X <type> damage each. Combine
 * this damage." (AR9, CB p.201): one shared roll, X per Minion combined by the runner (`groupAttack`).
 */
const groupAttack = (adversaryId: string, x: number, type: DamageType) =>
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
        damage(flat(x), type, { when: hit }),
      ],
    }),
  );

/** "Relentless (X): The X can be spotlighted up to X times per GM turn. Spend Fear as usual to spotlight them." */
const relentless = (adversaryId: string, x: number) =>
  entry(adversaryId, `Relentless (${x})`, passive({ modifiers: [{ kind: "relentless", times: x }] }));

/**
 * "Relentless (X): … up to X times per GM turn, where X equals the number of PCs in the scene." The vocabulary's
 * `relentless` takes a fixed number only (dcm-gx1), so the count is a manual note.
 */
const relentlessPerPc = (adversaryId: string, name: string) =>
  entry(
    adversaryId,
    "Relentless (X)",
    passive({ steps: [manual(`${name} can be spotlighted up to X times per GM turn, where X is the number of PCs in the scene. Spend Fear as usual to spotlight them.`)] }),
  );

/** "Horde (X): When the Horde has marked half or more of their HP, their standard attack deals X damage instead." (CB p.199). */
const horde = (adversaryId: string, count: number, sides: DieSides, plus?: number) =>
  entry(
    adversaryId,
    `Horde (${count}d${sides}${plus ? `+${plus}` : ""})`,
    passive({ modifiers: [{ kind: "horde", damage: { kind: "dice", dice: { count: fixed(count), sides, ...(plus ? { plus: fixed(plus) } : {}) } } }] }),
  );

/**
 * "Terrifying: When the X makes a successful attack, all PCs within <range> lose a Hope, and you gain a Fear."
 * Automatic on a hit; the PCs in range are the step's `picked` creatures (with no map: the party, Q18).
 */
const terrifying = (adversaryId: string, range: Range) =>
  entry(
    adversaryId,
    "Terrifying",
    auto(
      { kind: "onHit", attack: "any" },
      {
        steps: [{ kind: "hope", to: "picked", pick: allAround(range), change: "lose", amount: one }, gainFear()],
      },
    ),
  );

const ON_MOUNT = situation("While the Harbinger is on their mount");

/**
 * The Harbingers' "Mount: While the Harbinger is on their mount, they gain a +2 bonus to their Difficulty. When the
 * Harbinger takes Severe damage, they're knocked from their mount. If the Harbinger is unhorsed, their mount disappears
 * until you mark a Stress to summon it again." Three uses: the Difficulty while mounted, the fall on Severe damage, and
 * the Stress to call the mount back (on the Harbinger's spotlight, like the tier 2 Ghost's move).
 */
const mount = (adversaryId: string) =>
  entry(
    adversaryId,
    "Mount",
    passive({ id: "mounted", requires: [ON_MOUNT], modifiers: [{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(2) } }] }),
    auto(
      { kind: "onDamaged", minSeverity: "severe" },
      { id: "unhorsed", requires: [ON_MOUNT], steps: [manual("The Harbinger is knocked from their mount (no more +2 Difficulty); the mount disappears.")] },
    ),
    action({ id: "resummon", costs: STRESS, steps: [manual("The mount returns: the Harbinger is on their mount again (+2 Difficulty).")] }),
  );

/** "Feed on Fear: When a PC within Close range fails with Fear, Forlorne can clear a HP or a Stress." (both forms) */
const feedOnFear = (adversaryId: string) =>
  entry(
    adversaryId,
    "Feed on Fear",
    reaction(
      { kind: "pcRolls", result: "failureWithFear", within: "close" },
      {
        steps: [
          {
            kind: "choose",
            id: "clear",
            label: "Clear a HP or a Stress",
            options: [
              { id: "hp", label: "Clear a HP", steps: [{ kind: "clear", to: "self", track: "hp", amount: one }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] },
            ],
          },
        ],
      },
    ),
  );

/**
 * "Transform: Mark a Stress to have Forlorne shift between her Dragon Form and Faun Form. While she embodies a form, she
 * uses its statistics and features." (both forms). Swapping the stat block is an evolution-like change the vocabulary
 * has no step for (dcm-gx3).
 */
const transform = (adversaryId: string) =>
  entry(
    adversaryId,
    "Transform",
    action({ costs: STRESS, steps: [manual("Forlorne shifts between her Dragon Form and Faun Form: swap her stat block (HP and Stress marked carry over).")] }),
  );

/** The countdown's three uses: activate, tick and the effect when it triggers (a GM button). */
const countdownUses = (
  label: string,
  start: NumberSource,
  activate: AdversaryTrigger,
  tick: AdversaryTrigger,
  onTrigger: string,
  triggered: Omit<UseParts, "id">,
  opts: { loop?: boolean; activateKind?: "auto" | "reaction"; activateExtra?: readonly AdversaryStep[] } = {},
): AdversaryFeatureUse[] => [
  (opts.activateKind === "reaction" ? reaction : auto)(activate, {
    id: "activate",
    steps: [{ kind: "countdown", op: "start", label, start, ...(opts.loop ? { loop: true } : {}), onTrigger }, ...(opts.activateExtra ?? [])],
  }),
  auto(tick, { id: "tick", steps: [{ kind: "countdown", op: "tick", label }] }),
  reaction({ kind: "situation", text: `The ${label} countdown triggers` }, { id: "trigger", ...triggered }),
];

// Diamond Hide's countdown value is also the stat block's tokens (Difficulty + tokens).
const DIAMOND_TICK: readonly AdversaryStep[] = [
  { kind: "tokens", to: "self", op: "spend", amount: one, note: "Diamond Hide's Difficulty bonus drops by 1" },
  { kind: "countdown", op: "tick", label: "Diamond Hide" },
];

const OMEGA = situation("Adonix is in Omega form");
const FULL_FORM = situation("The Titan is in its full form");
const MISTY_FORM = situation("While the Titan is a misty cloud");
const FLYING = situation("While flying");

// ---------------------------------------------------------------- the table

export const T4_HF_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ---- Cephilith Abomination (Bruiser, HF p.90)
  // "Toxic Skin: A PC who comes into physical contact with the Abomination must roll a d6. On a result of 3 or lower,
  // the PC must mark an Armor Slot or 2 HP."
  // The contact is a story trigger (a GM button); the PC picks Armor Slot or HP.
  entry(
    "cephilith-abomination",
    "Toxic Skin",
    reaction(
      { kind: "situation", text: "A PC comes into physical contact with the Abomination" },
      {
        targets: oneEnemy("melee"),
        steps: [
          {
            kind: "check",
            note: "The PC rolls a d6",
            dice: { count: one, sides: 6 },
            test: { kind: "totalAtMost", value: 3 },
            then: [
              {
                kind: "choose",
                id: "toxic",
                label: "The PC marks an Armor Slot or 2 HP",
                options: [
                  { id: "armor", label: "Mark an Armor Slot", steps: [{ kind: "markArmor", to: "targets", amount: one }] },
                  { id: "hp", label: "Mark 2 HP", steps: [{ kind: "markHp", to: "targets", amount: fixed(2) }] },
                ],
              },
            ],
            otherwise: [],
          },
        ],
      },
    ),
  ),
  // "Bear Hug: Mark a Stress to make a standard attack against a target within Melee range. On a success, the target
  // takes standard damage and is Grappled until they escape with a successful Strength Roll. While Grappled, the target
  // is Vulnerable and Restrained."
  entry(
    "cephilith-abomination",
    "Bear Hug",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        damage(STANDARD, "weapon", { when: hit }),
        { kind: "condition", to: "targets", when: hit, condition: GRAPPLED, duration: "manual", endsWhen: "they escape with a successful Strength Roll" },
      ],
    }),
  ),
  // "Crunch!: Spend a Fear to deal 4d12 direct physical damage to a creature Grappled by the Abomination."
  entry(
    "cephilith-abomination",
    "Crunch!",
    action({
      costs: FEAR,
      targets: oneEnemy("melee"),
      steps: [damage(roll(4, 12), "physical", { direct: true, when: has(GRAPPLED) })],
    }),
  ),
  // "Tongue Attack: Spend a Fear to have the Abomination pull a target within Far range into Melee range, then
  // immediately spotlight the Abomination again."
  entry(
    "cephilith-abomination",
    "Tongue Attack",
    action({
      costs: FEAR,
      targets: oneEnemy("far"),
      steps: [
        { kind: "move", to: "targets", mode: "pull", range: "melee", relativeTo: "self" },
        { kind: "spotlight", who: "self", note: "Immediately spotlight the Abomination again" },
      ],
    }),
  ),
  // "Burrowing Leechpoles: When the Abomination takes Major or greater damage, their skin erupts in an explosion of
  // subcutaneous wrigglers. Each PC within Close range must make an Agility Reaction Roll. Targets who fail are covered in
  // 2d4 leechpoles, which burrow under their skin. Until the leechpoles are dug out with a successful Finesse Roll (21),
  // any damage the target takes gains a +1 bonus for each leechpole under their skin."
  // Manual: the leechpoles are tokens on a PC that raise the damage they take (dcm-xp0).
  entry(
    "cephilith-abomination",
    "Burrowing Leechpoles",
    reaction(
      { kind: "onDamaged", minSeverity: "major" },
      {
        targets: allAround("close"),
        steps: [
          save("agility", OWN_DIFFICULTY, [
            { kind: "condition", to: "targets", condition: tag("Leechpoles"), duration: "manual", endsWhen: "they are dug out with a successful Finesse Roll (21)" },
            manual("Roll 2d4: that many leechpoles burrow under the target's skin. Any damage the target takes gains +1 per leechpole until they're dug out.", "targets"),
          ]),
        ],
      },
    ),
  ),

  // ---- Cephilith Hatchling (Minion, HF p.90)
  // "Minion (12): The Hatchling is defeated when they take any damage. For every 12 damage a PC deals to the Hatchling,
  // the PC defeats an additional Minion within range the attack would succeed against."
  minion("cephilith-hatchling", 12),
  // "Comatize: Spend a Fear to have the Hatchling latch onto the head of a PC within Melee range. The PC must mark a
  // Stress as the Hatchling injects the PC's brain with psycho-chemicals, and they must mark an additional Stress each
  // time any PC fails a roll with Fear. The PC can remove the Hatchling by spending a number of Hope equal to the number
  // of Stress they have marked. If a PC marks their last Stress while the Hatchling is latched on, the PC must make a
  // death move. If the PC dies, you can spend a Fear to resurrect them as a Cephilith Novitiate."
  // Three uses: the latch; the extra Stress on every failure with Fear (automatic, on the PCs carrying the tag); the
  // resurrection (a GM button). The death move on the last Stress is manual (dcm-702).
  entry(
    "cephilith-hatchling",
    "Comatize",
    action({
      costs: FEAR,
      targets: oneEnemy("melee"),
      steps: [
        { kind: "markStress", to: "targets", amount: one },
        { kind: "condition", to: "targets", condition: COMATIZED, duration: "manual", endsWhen: "the PC spends Hope equal to the Stress they have marked" },
        manual("If the PC marks their last Stress while the Hatchling is latched on, they must make a death move.", "targets"),
      ],
    }),
    auto(
      { kind: "pcRolls", result: "failureWithFear" },
      {
        id: "latched",
        targets: ANY_PC,
        steps: [{ kind: "markStress", to: "targets", when: has(COMATIZED), amount: one, note: "Every PC with a Hatchling latched on marks a Stress" }],
      },
    ),
    reaction(
      { kind: "situation", text: "A PC with a Hatchling latched on dies" },
      {
        id: "resurrect",
        costs: FEAR,
        steps: [{ kind: "summon", label: "The PC rises as a Cephilith Novitiate", count: one, adversaryId: "cephilith-novitiate" }],
      },
    ),
  ),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Cephilith Hatchlings within Close range of them. …
  // On a success, they deal 9 physical damage each. Combine this damage."
  groupAttack("cephilith-hatchling", 9, "physical"),

  // ---- Cephilith Novitiate (Minion, HF p.90)
  // "Minion (12): The Novitiate is defeated when they take any damage. For every 12 damage …"
  minion("cephilith-novitiate", 12),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Cephilith Novitiates within Close range of them. …
  // On a success, they deal 12 physical damage each. Combine this damage."
  groupAttack("cephilith-novitiate", 12, "physical"),
  // "Sacrifice Self: Spend a Fear to have the Novitiate charge at a target within Far range and melt into them. Deal 12
  // direct magic damage to the target and defeat the Novitiate."
  entry(
    "cephilith-novitiate",
    "Sacrifice Self",
    action({
      costs: FEAR,
      targets: oneEnemy("far"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "The Novitiate charges the target" },
        damage(flat(12), "magic", { direct: true }),
        { kind: "defeat", to: "self", note: "The Novitiate melts into the target" },
      ],
    }),
  ),

  // ---- Cephilith Priest (Leader, HF p.90)
  // "Psychic Blast: Spend a Fear to choose up to three PCs within Close range and force them to make a Knowledge
  // Reaction Roll. Targets who succeed take 2d10+5 direct magic damage. Targets who fail take 4d10+10 direct magic damage
  // and are Vulnerable until spotlighted."
  entry(
    "cephilith-priest",
    "Psychic Blast",
    action({
      costs: FEAR,
      targets: upToEnemies(3, "close"),
      steps: [
        save(
          "knowledge",
          OWN_DIFFICULTY,
          [
            damage(roll(4, 10, 10), "magic", { direct: true }),
            { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "they are spotlighted" },
          ],
          [damage(roll(2, 10, 5), "magic", { direct: true })],
        ),
      ],
    }),
  ),
  // "Cerebral Incursion: Spend a Fear to choose a Vulnerable target within Melee range. The Priest grabs the target …
  // The target must succeed on a Strength Reaction Roll or mark 1d6 Stress, and the Priest clears an equal number of
  // Stress."
  // Reading: "an equal number" is the 1d6 rolled (as Siphon Magic in tier 2).
  entry(
    "cephilith-priest",
    "Cerebral Incursion",
    action({
      costs: FEAR,
      targets: oneEnemy("melee"),
      steps: [
        save(
          "strength",
          OWN_DIFFICULTY,
          [
            { kind: "markStress", to: "targets", amount: diceOf(1, 6) },
            { kind: "clear", to: "self", track: "stress", amount: { kind: "lastRoll" }, note: "The Priest clears as many Stress" },
          ],
          [],
          { when: has(VULNERABLE), note: "Only against a Vulnerable target" },
        ),
      ],
    }),
  ),
  // "Telekinetic Grasp: When the Priest makes a successful standard attack against a PC, you can mark a Stress to
  // Restrain the target until they spend a Hope."
  entry(
    "cephilith-priest",
    "Telekinetic Grasp",
    reaction(
      { kind: "onHit", attack: "standard" },
      {
        costs: STRESS,
        targets: TRIGGER_SUBJECT,
        steps: [{ kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "they spend a Hope" }],
      },
    ),
  ),

  // ---- Cephilith Titan (Solo, HF p.91)
  // "Relentless (X): The Titan can be spotlighted up to X times per GM turn, where X equals the number of PCs in the
  // scene. Spend Fear as usual to spotlight them."
  relentlessPerPc("cephilith-titan", "The Titan"),
  // "Terrifying: When the Titan makes a successful attack, all PCs within Close range lose a Hope, and you gain a Fear."
  terrifying("cephilith-titan", "close"),
  // "Merely a Projection: … They have immunity to physical damage and resistance to magic damage."
  // Losing it on "It's Here…" is manual (dcm-gx3).
  entry(
    "cephilith-titan",
    "Merely a Projection",
    passive({
      modifiers: [
        { kind: "mod", mod: { kind: "resistance", type: "physical", level: "immune" } },
        { kind: "mod", mod: { kind: "resistance", type: "magic", level: "resistant" } },
      ],
    }),
  ),
  // "Psychic Scream: Spend a Fear to have the Titan unleash a mind-shattering onslaught of nightmarish visions from the
  // Outer Realms. Each PC within Far range must make an Instinct Reaction Roll (22). Targets who fail take 4d12 direct
  // magic damage. Targets who succeed must mark a Stress."
  entry(
    "cephilith-titan",
    "Psychic Scream",
    action({
      costs: FEAR,
      targets: allAround("far"),
      steps: [save("instinct", dc(22), [damage(roll(4, 12), "magic", { direct: true })], [{ kind: "markStress", to: "targets", amount: one }])],
    }),
  ),
  // "Summon Worshippers: Spend a Fear to summon 1d4 Outer Realms Abominations, which appear within Far range, then choose
  // one to immediately spotlight."
  entry(
    "cephilith-titan",
    "Summon Worshippers",
    action({
      costs: FEAR,
      steps: [
        { kind: "summon", label: "Outer Realms Abominations", count: diceOf(1, 4), adversaryId: "outer-realms-abomination", range: "far" },
        { kind: "spotlight", who: "picked", count: one, name: "Outer Realms Abomination", note: "Choose one to immediately spotlight" },
      ],
    }),
  ),
  // "“It's Here…”: When the Titan has marked half its HP, they manifests in their full form, clearing all HP and losing
  // the “Merely a Projection” feature. While the Titan is in this form, a creature who marks HP from the Titan's standard
  // attack must mark an additional HP."
  // Two uses: the evolution (automatic, once per scene, HF p.61), and the full form's extra HP (automatic after the
  // window, while the GM has confirmed the form). Dropping "Merely a Projection" is manual (dcm-gx3).
  entry(
    "cephilith-titan",
    "“It’s Here…”",
    auto(
      { kind: "onHpMarkedAtLeast", value: "half" },
      {
        limit: { per: "scene" },
        steps: [
          { kind: "clear", to: "self", track: "hp", amount: markedSelf("hp"), note: "The Titan clears all HP" },
          manual("The Titan manifests in its full form and loses “Merely a Projection” (no more physical immunity or magic resistance)."),
        ],
      },
    ),
    auto(
      { kind: "onTargetMarksHp", attack: "standard" },
      { id: "full-form", requires: [FULL_FORM], targets: TRIGGER_SUBJECT, steps: [{ kind: "markHp", to: "targets", amount: one }] },
    ),
  ),

  // ---- Cipactli (Solo, HF p.91)
  // "Relentless (3): The Cipactli can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight it."
  relentless("cipactli", 3),
  // "Many Mouths: Mark a Stress to make a standard attack against all targets within Very Close range. Targets the
  // Cipactli succeeds against must also mark a Stress."
  entry(
    "cipactli",
    "Many Mouths",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: allAround("veryClose"),
      steps: [damage(STANDARD, "weapon", { when: hit }), { kind: "markStress", to: "targets", when: hit, amount: one }],
    }),
  ),
  // "Frenzied Feeding: Spend a Fear to force all PCs within Close range to succeed on an Instinct Reaction Roll or take
  // 4d6 direct physical damage. The Cipactli clears a HP for each creature who took Severe damage from this attack."
  // Manual: the severity is known only when the window resolves (dcm-sos).
  entry(
    "cipactli",
    "Frenzied Feeding",
    action({
      costs: FEAR,
      targets: allAround("close"),
      steps: [
        save("instinct", OWN_DIFFICULTY, [damage(roll(4, 6), "physical", { direct: true })]),
        manual("The Cipactli clears a HP for each creature who took Severe damage from this attack."),
      ],
    }),
  ),
  // "Quaking Footfalls: Mark a Stress to force each PC within Far range to make an Agility Reaction Roll. Targets who fail
  // must mark 2 Stress and are Vulnerable until they take damage. Targets who succeed must mark a Stress."
  entry(
    "cipactli",
    "Quaking Footfalls",
    action({
      costs: STRESS,
      targets: allAround("far"),
      steps: [
        save(
          "agility",
          OWN_DIFFICULTY,
          [
            { kind: "markStress", to: "targets", amount: fixed(2) },
            { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "they take damage" },
          ],
          [{ kind: "markStress", to: "targets", amount: one }],
        ),
      ],
    }),
  ),
  // "Lifeblooded: When the Cipactli takes Severe damage, its blood splashes to the ground and instantly erupts into a
  // jungle. All creatures within Close range are temporarily Restrained."
  entry(
    "cipactli",
    "Lifeblooded",
    reaction(
      { kind: "onDamaged", minSeverity: "severe" },
      {
        targets: everyoneAround("close"),
        steps: [{ kind: "condition", to: "targets", condition: RESTRAINED, duration: "temporary" }],
      },
    ),
  ),
  // "Verdant Explosion: When the Cipactli marks its last HP, its body erupts into dense vegetation that overtakes the
  // landscape." (No rule to apply: the scene changes.)
  entry(
    "cipactli",
    "Verdant Explosion",
    reaction({ kind: "onMarkHp", last: true }, { steps: [manual("The Cipactli's body erupts into dense vegetation that overtakes the landscape.")] }),
  ),

  // ---- Cloud Titan (Social, HF p.91)
  // "Lightning Strike: Mark a Stress to make an attack against a target within Far range. On a success, deal 4d10+14
  // magic damage and roll a d6. On a result of 4 or higher, the lightning bounces, and the Titan makes this attack
  // against a different target within Very Close range of the previous target. Each time the lightning bounces, decrease
  // the damage it deals by 1d10."
  // The first bounce is a follow-up attack (ATK +3) for 4d10+14 − 1d10; later bounces repeat by hand (dcm-7az).
  entry(
    "cloud-titan",
    "Lightning Strike",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("far"),
      steps: [
        damage(roll(4, 10, 14), "magic", { when: hit }),
        {
          kind: "check",
          when: hit,
          note: "Roll a d6: on 4 or higher the lightning bounces",
          dice: { count: one, sides: 6 },
          test: { kind: "anyAtLeast", value: 4 },
          then: [
            {
              kind: "followUp",
              note: "The lightning bounces to a different target within Very Close range of the previous one",
              roll: attackWithAtk(3),
              targets: oneEnemy("veryClose"),
              steps: [
                damage(flat({ kind: "sum", of: [diceOf(4, 10, 14), { kind: "calc", of: diceOf(1, 10), times: -1 }] }), "magic", {
                  when: hit,
                  note: "4d10+14 decreased by 1d10",
                }),
                manual("On a success, roll a d6 again: on 4 or higher the lightning bounces again to a different target within Very Close range, its damage decreased by another 1d10."),
              ],
            },
          ],
          otherwise: [],
        },
      ],
    }),
  ),
  // "Mist Weaver: Spend a Fear and choose a point within Far range. The Titan conjures a thick fog over the area within
  // Close range of that point. The Titan is Hidden to enemies within and on the other side of the fog and has advantage
  // on attacks against creatures inside it. The fog lasts until the Titan marks HP."
  // Manual: the advantage against creatures inside the fog (dcm-xyw).
  entry(
    "cloud-titan",
    "Mist Weaver",
    action({
      costs: FEAR,
      targets: { side: "point", range: "far", count: { kind: "one" } },
      steps: [
        { kind: "condition", to: "self", condition: HIDDEN, duration: "manual", endsWhen: "the Titan marks HP (the fog lifts)" },
        manual("The fog fills the area within Close range of the point: the Titan has advantage on attacks against creatures inside it until it marks HP."),
      ],
    }),
  ),
  // "Nebulous Transformation: Mark a Stress to have the Titan transform into a misty cloud that fills a Very Close area.
  // While in this form, the Titan takes double magic damage and has immunity to physical damage. This form lasts until
  // the Titan chooses to drop out of it or takes Severe damage."
  // Two uses: the transformation (immunity as an effect on itself) and the double magic damage while in the form.
  entry(
    "cloud-titan",
    "Nebulous Transformation",
    action({
      costs: STRESS,
      steps: [
        {
          kind: "effect",
          to: "self",
          label: "Misty cloud",
          mods: [{ kind: "resistance", type: "physical", level: "immune" }],
          duration: "manual",
          endsWhen: "the Titan drops out of it or takes Severe damage",
        },
      ],
    }),
    auto(
      { kind: "onDamaged", stage: "would", damageType: "magic" },
      { id: "double-magic", requires: [MISTY_FORM], steps: [{ kind: "modifyDamage", to: "self", change: { kind: "multiply", factor: 2 }, note: "Double magic damage" }] },
    ),
  ),
  // "Unleash the Menagerie: Once per scene, mark any number of Stress to summon an equal number of Griffins, which appear
  // at Close range."
  // One option per amount (the Titan has 5 Stress), each paying its Stress and summoning as many Griffins.
  entry(
    "cloud-titan",
    "Unleash the Menagerie",
    action({
      limit: { per: "scene" },
      steps: [
        {
          kind: "choose",
          id: "stress",
          label: "Mark any number of Stress",
          options: Array.from({ length: 5 }, (_, i) => ({
            id: String(i + 1),
            label: `${i + 1} Stress`,
            steps: [
              { kind: "pay", costs: [{ kind: "stress", amount: fixed(i + 1) }] },
              { kind: "summon", label: "Griffins", count: fixed(i + 1), adversaryId: "griffin", range: "close" },
            ] satisfies AdversaryStep[],
          })),
        },
      ],
    }),
  ),
  // "Wind Worker: Spend a Fear to have the Titan blast wind at a target within Close range. The target takes 4d6+8
  // physical damage and is pushed back to Far range from their current position."
  entry(
    "cloud-titan",
    "Wind Worker",
    action({
      costs: FEAR,
      targets: oneEnemy("close"),
      steps: [damage(roll(4, 6, 8), "physical"), { kind: "move", to: "targets", mode: "knockBack", range: "far", relativeTo: "target", note: "Pushed back to Far range from their position" }],
    }),
  ),
  // "Double or Nothing: When you would gain a Fear from an attack against the Titan, you can roll a d6. On an odd
  // result, you don't gain the Fear. On an even result, you gain 2 Fear instead of 1."
  // The Fear from a PC's attack rolled with Fear stays; odd takes it back (−1), even adds one (+1). Parity is a chain of
  // checks.
  entry(
    "cloud-titan",
    "Double or Nothing",
    reaction(
      { kind: "pcRolls", roll: "attack", result: "withFear", againstSelf: true },
      {
        steps: [
          dieBranches(
            6,
            [1, 2, 3, 4, 5].map((n) => ({
              upTo: n,
              steps: [n % 2 === 1 ? { kind: "fear", to: "self", change: "lose", amount: one, note: "Odd: you don't gain the Fear" } : { ...gainFear(), note: "Even: 2 Fear instead of 1" }] as AdversaryStep[],
            })),
            [{ ...gainFear(), note: "Even: 2 Fear instead of 1" }],
            "Roll a d6",
          ),
        ],
      },
    ),
  ),

  // ---- Demon Lord Berzug (Solo, HF p.92)
  // "Relentless (3): Berzug can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight them."
  relentless("demon-lord-berzug", 3),
  // "Chaos Lash: Mark a Stress to have Berzug lash at up to three PCs within Close range and force each target to make an
  // Agility Reaction Roll. Targets who fail take 4d20 physical damage. Targets who succeed take half damage."
  entry(
    "demon-lord-berzug",
    "Chaos Lash",
    action({
      costs: STRESS,
      targets: upToEnemies(3, "close"),
      steps: [save("agility", OWN_DIFFICULTY, [damage(roll(4, 20), "physical")], [damage(roll(4, 20), "physical", { scale: "half" })])],
    }),
  ),
  // "Gaze into the Abyss: Spend a Fear to have Berzug lock eyes with a PC within Far range. The target must succeed on a
  // Presence Reaction Roll or gain one of the following conditions (roll a d6 and use the corresponding result):
  // 1–2: Mesmerized. The target immediately moves into Melee range of Berzug and is Vulnerable and Restrained until they
  // clear the condition with a successful Instinct Roll.
  // 3–4: Confused. The target must mark a Stress each time they make an action roll until they clear the condition with a
  // successful Knowledge Roll.
  // 5–6: Enthralled. Until the PC makes a successful Presence Roll to clear the condition, you can spotlight them during a
  // GM turn as if they were an adversary. When you do so, choose a target within Close range of the Enthralled PC. The
  // Enthralled PC moves into Melee range of the target and makes a weapon attack against them using a d20 instead of
  // Duality Dice."
  // Manual: Confused's Stress on each action roll (dcm-kti); the Enthralled PC under the GM's control (dcm-idz).
  entry(
    "demon-lord-berzug",
    "Gaze into the Abyss",
    action({
      costs: FEAR,
      targets: oneEnemy("far"),
      steps: [
        save("presence", OWN_DIFFICULTY, [
          dieBranches(
            6,
            [
              {
                upTo: 2,
                note: "1–2: Mesmerized",
                steps: [
                  { kind: "move", to: "targets", mode: "move", range: "melee", relativeTo: "self", note: "The target moves into Melee range of Berzug" },
                  { kind: "condition", to: "targets", condition: tag("Mesmerized", ["vulnerable", "restrained"]), duration: "manual", endsWhen: "a successful Instinct Roll" },
                ],
              },
              {
                upTo: 4,
                note: "3–4: Confused",
                steps: [
                  { kind: "condition", to: "targets", condition: tag("Confused"), duration: "manual", endsWhen: "a successful Knowledge Roll" },
                  manual("Confused: the target marks a Stress each time they make an action roll.", "targets"),
                ],
              },
            ],
            [
              { kind: "condition", to: "targets", condition: tag("Enthralled"), duration: "manual", endsWhen: "a successful Presence Roll" },
              manual(
                "Enthralled: during a GM turn you can spotlight the PC as an adversary: pick a target within Close range of them; they move into Melee range of it and make a weapon attack with a d20 instead of Duality Dice.",
                "targets",
              ),
            ],
            "Roll a d6 for the condition",
          ),
        ]),
      ],
    }),
  ),
  // "Crushing Strike: When a PC marks HP from Berzug's standard attack, you can mark a Stress to force them to mark a
  // number of Stress equal to the number of HP they marked. You gain a Fear."
  entry(
    "demon-lord-berzug",
    "Crushing Strike",
    reaction(
      { kind: "onTargetMarksHp", attack: "standard" },
      {
        costs: STRESS,
        targets: TRIGGER_SUBJECT,
        steps: [{ kind: "markStress", to: "targets", amount: { kind: "triggerAmount" }, note: "As many Stress as HP marked" }, gainFear()],
      },
    ),
  ),
  // "Horrifying: When a PC fails an attack against Berzug, you gain a Fear." (A Fear gain: automatic, Q19.)
  entry("demon-lord-berzug", "Horrifying", auto({ kind: "onAttacked", stage: "failed" }, { steps: [gainFear()] })),

  // ---- Dragon Mother Mitera (Solo, HF p.92)
  // "Relentless (3): Mitera can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight her."
  relentless("dragon-mother-mitera", 3),
  // "Diamond Hide: Countdown (7). When Mitera first appears, activate the countdown. Mitera gains a bonus to her
  // Difficulty equal to the countdown die's current value. It ticks down from Mitera's “Seven-Headed” feature. When the
  // countdown triggers, Mitera becomes Vulnerable and gains a +2 bonus to attack rolls."
  // The countdown's value is kept as tokens on her stat block (set to 7, spent on each tick), so the Difficulty bonus is
  // a passive reading the tokens. Seven-Headed ticks it.
  entry(
    "dragon-mother-mitera",
    "Diamond Hide",
    auto(
      { kind: "timing", at: "appears" },
      {
        id: "activate",
        steps: [
          { kind: "countdown", op: "start", label: "Diamond Hide", start: fixed(7), onTrigger: "Mitera becomes Vulnerable and gains a +2 bonus to attack rolls." },
          { kind: "tokens", to: "self", op: "set", amount: fixed(7), note: "The countdown's value: +7 Difficulty" },
        ],
      },
    ),
    passive({ id: "difficulty", modifiers: [{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: TOKENS } }] }),
    reaction(
      { kind: "situation", text: "The Diamond Hide countdown triggers" },
      {
        id: "trigger",
        steps: [
          { kind: "condition", to: "self", condition: VULNERABLE, duration: "permanent" },
          { kind: "effect", to: "self", label: "Diamond Hide broken", mods: [{ kind: "stat", stat: "attack", delta: fixed(2) }], duration: "permanent" },
        ],
      },
    ),
  ),
  // "Elemental Breath: Mark a Stress to have Mitera unleash elemental energy from one head of your choice: …" (the seven
  // options on each branch below). The GM picks the head; heads removed by Seven-Headed are tracked by hand (dcm-gx3).
  // Each head's creatures are the follow-up targets the GM picks (no map: Q18); "1d4+1 targets", "1d6 targets" are the
  // follow-up's count.
  entry(
    "dragon-mother-mitera",
    "Elemental Breath",
    action({
      costs: STRESS,
      steps: [
        {
          kind: "choose",
          id: "head",
          label: "One head of your choice",
          options: [
            // "1. Fire. Deal 4d12 magic damage to 1d4+1 targets within Close range. Targets who take damage must mark an
            // Armor Slot or 2 additional HP." Manual: each target's own choice (dcm-bz8).
            {
              id: "fire",
              label: "1. Fire",
              steps: [
                {
                  kind: "followUp",
                  targets: { side: "enemy", range: "close", count: { kind: "upTo", n: diceOf(1, 4, 1) } },
                  steps: [damage(roll(4, 12), "magic"), manual("Each target who takes damage marks an Armor Slot or 2 additional HP (their choice).", "targets")],
                },
              ],
            },
            // "2. Lightning. Deal 4d12 magic damage to 1d6 targets within Far range, so long as each target beyond the
            // first is within Close range of the previous target."
            {
              id: "lightning",
              label: "2. Lightning",
              steps: [
                {
                  kind: "followUp",
                  note: "Each target beyond the first is within Close range of the previous one",
                  targets: { side: "enemy", range: "far", count: { kind: "upTo", n: diceOf(1, 6) } },
                  steps: [damage(roll(4, 12), "magic")],
                },
              ],
            },
            // "3. Acid. Each PC in front of Mitera within Close range must make an Agility Reaction Roll. Targets who fail
            // must mark 2 Armor Slots and 2 HP. Targets who succeed must mark an Armor Slot and a HP."
            {
              id: "acid",
              label: "3. Acid",
              steps: [
                {
                  kind: "followUp",
                  targets: inFront("close"),
                  steps: [
                    save(
                      "agility",
                      OWN_DIFFICULTY,
                      [
                        { kind: "markArmor", to: "targets", amount: fixed(2) },
                        { kind: "markHp", to: "targets", amount: fixed(2) },
                      ],
                      [
                        { kind: "markArmor", to: "targets", amount: one },
                        { kind: "markHp", to: "targets", amount: one },
                      ],
                    ),
                  ],
                },
              ],
            },
            // "4. Poison. A miasma of toxic swamp gas Sickens all targets within Close range of Mitera. While Sickened, a
            // target has disadvantage on action rolls until they mark 1d4 Stress to clear the condition."
            // Manual: the disadvantage on the bearer's rolls (dcm-kti).
            {
              id: "poison",
              label: "4. Poison",
              steps: [
                {
                  kind: "followUp",
                  targets: allAround("close"),
                  steps: [
                    { kind: "condition", to: "targets", condition: tag("Sickened"), duration: "manual", endsWhen: "they mark 1d4 Stress to clear it" },
                    manual("Sickened: disadvantage on action rolls until they mark 1d4 Stress to clear the condition.", "targets"),
                  ],
                },
              ],
            },
            // "5. Ice. Each target in front of Mitera within Close range takes 4d8+8 magic damage and is Restrained by ice
            // until they break free with a successful Strength Roll. Additionally, this area freezes over and a PC must
            // succeed on an Agility Reaction Roll to move through it." Manual: the frozen area (dcm-wuu).
            {
              id: "ice",
              label: "5. Ice",
              steps: [
                {
                  kind: "followUp",
                  targets: inFront("close"),
                  steps: [
                    damage(roll(4, 8, 8), "magic"),
                    { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "they break free with a successful Strength Roll" },
                    manual("The area freezes over: a PC must succeed on an Agility Reaction Roll to move through it."),
                  ],
                },
              ],
            },
            // "6. Darkness. A cloud of magical shadow fills an area within Close range. Creatures inside the cloud except
            // for Mitera are Vulnerable and have disadvantage on action rolls that rely on sight. The cloud dissipates when
            // this Elemental Breath option is removed by Mitera's “Seven-Headed” feature." Manual: the lasting cloud and
            // the sight disadvantage (dcm-wuu).
            {
              id: "darkness",
              label: "6. Darkness",
              steps: [
                {
                  kind: "followUp",
                  targets: { side: "any", range: "close", count: { kind: "all" }, area: "aroundPoint", areaRange: "close", excludeSelf: true },
                  steps: [
                    { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "they leave the cloud or it dissipates" },
                    manual("Creatures inside the cloud (except Mitera) are Vulnerable and have disadvantage on action rolls that rely on sight; it dissipates when Seven-Headed removes this option."),
                  ],
                },
              ],
            },
            // "7. Light. A beam of pure light energy deals 28 direct magic damage to each creature in a line within Very
            // Far range."
            {
              id: "light",
              label: "7. Light",
              steps: [{ kind: "followUp", targets: inLine("veryFar", "any"), steps: [damage(flat(28), "magic", { direct: true })] }],
            },
          ],
        },
      ],
    }),
  ),
  // "Tail Swipe: Spend a Fear to attack all targets within Close range. Targets this attack succeeds against take
  // 2d20+10 physical damage and are knocked back to Far range. Targets who mark HP from this attack become Vulnerable
  // until they clear a HP. Targets this attack failed against must mark a Stress."
  // Manual: Vulnerable once the target marked HP (after the window, dcm-sos).
  entry(
    "dragon-mother-mitera",
    "Tail Swipe",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: allAround("close"),
      steps: [
        damage(roll(2, 20, 10), "physical", { when: hit }),
        { kind: "move", to: "targets", when: hit, mode: "knockBack", range: "far", relativeTo: "self" },
        manual("Targets who mark HP from this attack become Vulnerable until they clear a HP.", "targets", { when: hit }),
        { kind: "markStress", to: "targets", when: miss, amount: one },
      ],
    }),
  ),
  // "Fearsome: When Mitera makes a successful attack roll against a PC or a PC fails a roll within Far range, you gain a
  // Fear." Two automatic uses, one per trigger (a Fear gain, Q19).
  entry(
    "dragon-mother-mitera",
    "Fearsome",
    auto({ kind: "onHit", attack: "any" }, { id: "hit", steps: [gainFear()] }),
    auto({ kind: "pcRolls", result: "failure", within: "far" }, { id: "pc-fails", steps: [gainFear()] }),
  ),
  // "Seven-Headed: When Mitera takes damage, roll a d8. Permanently remove the “Elemental Breath” option that corresponds
  // to the result. On a result of 8, or if the corresponding option has already been removed, tick down the Diamond Hide
  // countdown (see “Diamond Hide”)."
  // Removing an option is manual (dcm-gx3); the GM says whether it was already gone.
  entry(
    "dragon-mother-mitera",
    "Seven-Headed",
    reaction(
      { kind: "onDamaged" },
      {
        steps: [
          {
            kind: "check",
            note: "Roll a d8",
            dice: { count: one, sides: 8 },
            test: { kind: "totalAtLeast", value: 8 },
            then: DIAMOND_TICK,
            otherwise: [
              {
                kind: "choose",
                id: "head",
                label: "Is that Elemental Breath option still there?",
                options: [
                  { id: "remove", label: "Remove it", steps: [manual("Permanently remove the Elemental Breath option matching the d8 result (Darkness: its cloud dissipates).")] },
                  { id: "removed", label: "Already removed: tick Diamond Hide", steps: DIAMOND_TICK },
                ],
              },
            ],
          },
        ],
      },
    ),
  ),

  // ---- Fire Titan Warlord (Leader, HF p.93)
  // "Relentless (2): The Warlord can be spotlighted up to two times per GM turn. Spend Fear as usual to spotlight them."
  relentless("fire-titan-warlord", 2),
  // "Colossus Crafter: Countdown (6). When the Warlord enters the scene, activate the countdown. It ticks down when the
  // Warlord is spotlighted. When it triggers, summon the Gargantuan War Machine, which appears at the edge of the
  // battlefield and immediately takes the spotlight."
  entry(
    "fire-titan-warlord",
    "Colossus Crafter",
    ...countdownUses(
      "Colossus Crafter",
      fixed(6),
      { kind: "timing", at: "appears" },
      { kind: "onSpotlight" },
      "Summon the Gargantuan War Machine; it immediately takes the spotlight.",
      {
        steps: [
          { kind: "summon", label: "Gargantuan War Machine", count: one, adversaryId: "gargantuan-war-machine", note: "At the edge of the battlefield" },
          { kind: "spotlight", who: "picked", count: one, name: "Gargantuan War Machine", note: "It immediately takes the spotlight" },
        ],
      },
    ),
  ),
  // "Release the Hounds: Spend a Fear to have the Warlord summon two Demonic Hound Packs, which appear at Close range and
  // immediately take the spotlight."
  entry(
    "fire-titan-warlord",
    "Release the Hounds",
    action({
      costs: FEAR,
      steps: [
        { kind: "summon", label: "Demonic Hound Packs", count: fixed(2), adversaryId: "demonic-hound-pack", range: "close" },
        { kind: "spotlight", who: "picked", count: fixed(2), name: "Demonic Hound Pack", note: "They immediately take the spotlight" },
      ],
    }),
  ),
  // "Spinning Strike: Mark a Stress to make a standard attack against all targets within Very Close range and gain a
  // Fear."
  entry(
    "fire-titan-warlord",
    "Spinning Strike",
    action({ costs: STRESS, roll: ATTACK, targets: allAround("veryClose"), steps: [damage(STANDARD, "weapon", { when: hit }), gainFear()] }),
  ),
  // "Ground-Breaking: Spend a Fear to have the Warlord crack the earth with a downward swing of their maul and make an
  // attack against a group within Close range. Targets the attack succeeds against take 4d10+10 direct damage. The area
  // becomes rough terrain, and a PC must succeed on an Agility Reaction Roll (16) to move through it."
  // "Direct damage" with no type: the maul's physical. Manual: the rough terrain (dcm-wuu).
  entry(
    "fire-titan-warlord",
    "Ground-Breaking",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: group("close"),
      steps: [
        damage(roll(4, 10, 10), "physical", { direct: true, when: hit }),
        manual("The area becomes rough terrain: a PC must succeed on an Agility Reaction Roll (16) to move through it."),
      ],
    }),
  ),

  // ---- Forlorne Lykona (Dragon Form) (Solo, Reign of the Weredragon, HF p.143)
  // "Relentless (4): Forlorne can be spotlighted up to four times per GM turn. Spend Fear as usual to spotlight her."
  relentless("forlorne-lykona-dragon-form", 4),
  // "Transform: Mark a Stress to have Forlorne shift between her Dragon Form and Faun Form. …"
  transform("forlorne-lykona-dragon-form"),
  // "Feed on Fear: When a PC within Close range fails with Fear, Forlorne can clear a HP or a Stress."
  feedOnFear("forlorne-lykona-dragon-form"),
  // "Flying: While flying, Forlorne gains a +3 bonus to her Difficulty."
  entry(
    "forlorne-lykona-dragon-form",
    "Flying",
    passive({ requires: [FLYING], modifiers: [{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(3) } }, { kind: "mod", mod: { kind: "flag", flag: "flying" } }] }),
  ),
  // "Terrifying: When Forlorne makes a successful attack, all PCs within Far range lose a Hope and you gain a Fear."
  terrifying("forlorne-lykona-dragon-form", "far"),
  // "Breath Weapon: Spend 2 Fear to have Forlorne exhale a cloud of magical energy, filling an area within Close range.
  // Each target in that area must make a Presence Reaction Roll. On a failure, they must mark 3 Stress or gain the
  // Weredrake Curse. While under the Weredrake Curse, the target drops their equipment and loot and transforms into a
  // Weredrake adversary under the GM's control. After this condition is cleared, the target retains no memory of their
  // time as a weredrake."
  // The failing PC picks. Manual: the PC under the GM's control as a Weredrake (dcm-idz).
  entry(
    "forlorne-lykona-dragon-form",
    "Breath Weapon",
    action({
      costs: TWO_FEAR,
      targets: allAround("close"),
      steps: [
        save("presence", OWN_DIFFICULTY, [
          {
            kind: "choose",
            id: "curse",
            label: "Mark 3 Stress or gain the Weredrake Curse (the PC's choice)",
            options: [
              { id: "stress", label: "Mark 3 Stress", steps: [{ kind: "markStress", to: "targets", amount: fixed(3) }] },
              {
                id: "curse",
                label: "Weredrake Curse",
                steps: [
                  { kind: "condition", to: "targets", condition: tag("Weredrake Curse"), duration: "manual", endsWhen: "the condition is cleared" },
                  manual("The target drops their equipment and loot and becomes a Weredrake adversary under the GM's control; afterwards they remember nothing of it.", "targets"),
                ],
              },
            ],
          },
        ]),
      ],
    }),
  ),
  // "Tail Swipe: When Forlorne marks 1 or more HP from an attack within Very Close range, you can mark a Stress to deal
  // 2d10+10 physical damage to all creatures within that range."
  entry(
    "forlorne-lykona-dragon-form",
    "Tail Swipe",
    reaction(
      { kind: "onMarkHp", atLeast: 1, fromAttack: true, attackerWithin: "veryClose" },
      { costs: STRESS, targets: everyoneAround("veryClose"), steps: [damage(roll(2, 10, 10), "physical")] },
    ),
  ),

  // ---- Forlorne Lykona (Faun Form) (Solo, Reign of the Weredragon, HF p.142)
  // "Relentless (4): Forlorne can be spotlighted up to four times per GM turn. Spend Fear as usual to spotlight her."
  relentless("forlorne-lykona-faun-form", 4),
  // "Transform: Mark a Stress to have Forlorne shift between her Dragon Form and Faun Form. …"
  transform("forlorne-lykona-faun-form"),
  // "Feed on Fear: When a PC within Close range fails with Fear, Forlorne can clear a HP or a Stress."
  feedOnFear("forlorne-lykona-faun-form"),
  // "Battle Teleport: Before or after making a standard attack, you can mark a Stress to have Forlorne teleport to a
  // location within Far range." Printed as a passive with a choice: two reactions, before and after the attack.
  entry(
    "forlorne-lykona-faun-form",
    "Battle Teleport",
    reaction(
      { kind: "onAttack", stage: "before", attack: "standard" },
      { id: "before", costs: STRESS, steps: [{ kind: "move", to: "self", mode: "teleport", range: "far" }] },
    ),
    reaction(
      { kind: "onAttack", stage: "after", attack: "standard" },
      { id: "after", costs: STRESS, steps: [{ kind: "move", to: "self", mode: "teleport", range: "far" }] },
    ),
  ),
  // "Grasping Vines: Spend a Fear to target a group within Far range. Each target must succeed on an Agility Reaction
  // Roll or take 2d8+7 magic damage and become Restrained until they break free with a successful Strength Roll. The vines
  // last until Forlorne takes Severe damage, uses this feature again, or ends the effect."
  entry(
    "forlorne-lykona-faun-form",
    "Grasping Vines",
    action({
      costs: FEAR,
      targets: group("far"),
      steps: [
        save("agility", OWN_DIFFICULTY, [
          damage(roll(2, 8, 7), "magic"),
          {
            kind: "condition",
            to: "targets",
            condition: RESTRAINED,
            duration: "manual",
            endsWhen: "they break free with a successful Strength Roll, or the vines end (Forlorne takes Severe damage, uses this again or ends it)",
          },
        ]),
      ],
    }),
  ),
  // "Stone-Cold Gaze: When Forlorne takes damage from an attack within Close range, you can spend 2 Fear to force the
  // attacker to make an Instinct Reaction Roll. On a failure, the target must spend 3 Hope or gain the Petrified Curse.
  // Until this condition is cleared, the target and the equipment they're wearing or carrying turn to stone. While under
  // the Petrified Curse, the target is Restrained and Vulnerable, can't act, and gains a +10 bonus to their damage
  // thresholds."
  // The failing PC picks; the curse is a tag (Restrained, Vulnerable) plus an effect (can't act, +10 thresholds).
  entry(
    "forlorne-lykona-faun-form",
    "Stone-Cold Gaze",
    reaction(
      { kind: "onDamaged", fromAttack: true, attackerWithin: "close" },
      {
        costs: TWO_FEAR,
        targets: TRIGGER_SOURCE,
        steps: [
          save("instinct", OWN_DIFFICULTY, [
            {
              kind: "choose",
              id: "curse",
              label: "Spend 3 Hope or gain the Petrified Curse (the PC's choice)",
              options: [
                { id: "hope", label: "Spend 3 Hope", steps: [{ kind: "hope", to: "targets", change: "lose", amount: fixed(3) }] },
                {
                  id: "petrified",
                  label: "Petrified Curse",
                  steps: [
                    { kind: "condition", to: "targets", condition: tag("Petrified Curse", ["restrained", "vulnerable"]), duration: "manual", endsWhen: "the condition is cleared" },
                    {
                      kind: "effect",
                      to: "targets",
                      label: "Petrified Curse",
                      mods: [
                        { kind: "flag", flag: "cannotAct" },
                        { kind: "stat", stat: "majorThreshold", delta: fixed(10) },
                        { kind: "stat", stat: "severeThreshold", delta: fixed(10) },
                      ],
                      duration: "manual",
                      endsWhen: "the condition is cleared",
                    },
                  ],
                },
              ],
            },
          ]),
        ],
      },
    ),
  ),

  // ---- Gargantuan War Machine (Solo, HF p.93)
  // "Relentless (3): The Machine can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight it."
  relentless("gargantuan-war-machine", 3),
  // "Awesome Size: When the Machine enters the battlefield, each PC must either lose a Hope or mark 1d4 Stress."
  // Manual: each PC's own choice (dcm-bz8).
  entry(
    "gargantuan-war-machine",
    "Awesome Size",
    auto({ kind: "timing", at: "appears" }, { steps: [manual("Each PC either loses a Hope or marks 1d4 Stress (their choice).", "picked", { pick: ANY_PC })] }),
  ),
  // "Rocket Punch: Mark a Stress to make an attack against a PC within Close range. On a success, the target takes
  // 4d12+10 direct physical damage and marks 2 Armor Slots without gaining their benefits."
  entry(
    "gargantuan-war-machine",
    "Rocket Punch",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("close"),
      steps: [damage(roll(4, 12, 10), "physical", { direct: true, when: hit }), { kind: "markArmor", to: "targets", when: hit, amount: fixed(2), noBenefit: true }],
    }),
  ),
  // "Ground-Breaking Stomp: Spend a Fear to choose a point within Close range and make an attack roll against all enemies
  // within Close range of that point. Targets the attack succeeds against take 4d12 direct physical damage and are
  // Vulnerable until they are spotlighted. Additionally, the entire area becomes rubble, and a PC must succeed on an
  // Agility Reaction Roll (16) to move through it." Manual: the rubble (dcm-wuu).
  entry(
    "gargantuan-war-machine",
    "Ground-Breaking Stomp",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: allAroundPoint("close", "close"),
      steps: [
        damage(roll(4, 12), "physical", { direct: true, when: hit }),
        { kind: "condition", to: "targets", when: hit, condition: VULNERABLE, duration: "manual", endsWhen: "they are spotlighted" },
        manual("The area becomes rubble: a PC must succeed on an Agility Reaction Roll (16) to move through it."),
      ],
    }),
  ),
  // "Supercharged: Countdown (Loop 2d6). When the Machine is spotlighted for the first time, activate the countdown. It
  // ticks down each time the Machine is spotlighted. When it triggers, place a token on this stat block as the Machine's
  // chest crucible flares with magical flame. For each token on this stat block, the Machine gains a +1 bonus to
  // Difficulty and attack rolls, and its standard attack deals an extra 1d12 damage. Remove a token when the Machine takes
  // Severe damage."
  // Five uses: the countdown's three, the passive bonuses per token, and the token lost on Severe damage.
  entry(
    "gargantuan-war-machine",
    "Supercharged",
    ...countdownUses(
      "Supercharged",
      diceOf(2, 6),
      { kind: "onSpotlight", first: "scene" },
      { kind: "onSpotlight" },
      "Place a token on the Machine's stat block.",
      { steps: [{ kind: "tokens", to: "self", op: "add", amount: one, note: "The chest crucible flares" }] },
      { loop: true, activateKind: "reaction" },
    ),
    passive({
      id: "tokens",
      requires: [{ kind: "tokens", atLeast: 1 }],
      modifiers: [
        { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: TOKENS } },
        { kind: "mod", mod: { kind: "stat", stat: "attack", delta: TOKENS } },
        { kind: "attackDamage", add: diceOf(TOKENS, 12) },
      ],
    }),
    auto(
      { kind: "onDamaged", minSeverity: "severe" },
      { id: "lose-token", requires: [{ kind: "tokens", atLeast: 1 }], steps: [{ kind: "tokens", to: "self", op: "spend", amount: one }] },
    ),
  ),

  // ---- Ghastly Legion (Horde, HF p.93)
  // "Horde (2d6+5): When the Legion has marked half or more of its HP, its standard attack deals 2d6+5 magic damage
  // instead."
  horde("ghastly-legion", 2, 6, 5),
  // "Necroplasmic: The Legion is immune to physical damage and takes double magic damage."
  // Two uses: the immunity, and doubling magic damage before it is marked (a fold on the incoming damage).
  entry(
    "ghastly-legion",
    "Necroplasmic",
    passive({ id: "immunity", modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "physical", level: "immune" } }] }),
    auto(
      { kind: "onDamaged", stage: "would", damageType: "magic" },
      { id: "double-magic", steps: [{ kind: "modifyDamage", to: "self", change: { kind: "multiply", factor: 2 }, note: "Double magic damage" }] },
    ),
  ),
  // "Final Act: When the Legion is defeated, it makes a standard attack against all targets within Close range before
  // being dispelled."
  entry(
    "ghastly-legion",
    "Final Act",
    reaction({ kind: "onDefeated" }, { roll: ATTACK, targets: allAround("close"), steps: [damage(STANDARD, "weapon", { when: hit })] }),
  ),

  // ---- Griffin (Standard, HF p.93)
  // "Treasure Hoarder: When a PC would mark any number of HP from the Griffin's attack, the PC can choose instead to give
  // the Griffin an equal number of bags of gold."
  // Manual: the PC's option of gold instead of HP (dcm-6ju); offered on each hit.
  entry(
    "griffin",
    "Treasure Hoarder",
    auto(
      { kind: "onHit", attack: "any" },
      { targets: TRIGGER_SUBJECT, steps: [manual("Instead of marking HP from this attack, the PC can give the Griffin as many bags of gold.", "targets")] },
    ),
  ),
  // "Swooping Slash: Move up to Far range and make a standard attack against a target along the way."
  entry(
    "griffin",
    "Swooping Slash",
    action({
      roll: ATTACK,
      targets: oneEnemy("far"),
      steps: [{ kind: "move", to: "self", mode: "move", range: "far", note: "Move up to Far range, attacking a target along the way" }, damage(STANDARD, "weapon", { when: hit })],
    }),
  ),

  // ---- Hallowed Choir (Horde, HF p.93)
  // "Horde (2d10): When the Choir has marked half or more of its HP, its standard attack deals 2d10 magic damage instead."
  horde("hallowed-choir", 2, 10),
  // "Celestial Coda: Countdown (Loop 3). The Choir's divine song builds on itself with each refrain. When the Choir first
  // appears, activate the countdown. It ticks down when a PC gains a Hope. When it triggers, place a token on this stat
  // block. The Choir gains a bonus to its damage rolls equal to the number of tokens on this stat block."
  // Four uses: the countdown's three and the damage bonus (on its standard attack, the Choir's damage roll).
  entry(
    "hallowed-choir",
    "Celestial Coda",
    ...countdownUses(
      "Celestial Coda",
      fixed(3),
      { kind: "timing", at: "appears" },
      { kind: "pcHope", change: "gain" },
      "Place a token on the Choir's stat block.",
      { steps: [{ kind: "tokens", to: "self", op: "add", amount: one }] },
      { loop: true },
    ),
    passive({ id: "damage", modifiers: [{ kind: "attackDamage", add: TOKENS }] }),
  ),
  // "Aural Assault: The Choir unleashes its built-up divine energy in a single burst, clearing all tokens from this stat
  // block. Deal 1d12 direct magic damage to each enemy within Close range for each token cleared."
  entry(
    "hallowed-choir",
    "Aural Assault",
    action({
      targets: allAround("close"),
      steps: [
        damage({ kind: "dice", dice: { count: TOKENS, sides: 12 } }, "magic", { direct: true, note: "1d12 per token cleared" }),
        { kind: "tokens", to: "self", op: "clear" },
      ],
    }),
  ),

  // ---- Harbinger of Death (Skulk, HF p.94)
  // "Relentless (3): The Harbinger can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // them."
  relentless("harbinger-of-death", 3),
  // "Mount: While the Harbinger is on their mount, they gain a +2 bonus to their Difficulty. …"
  mount("harbinger-of-death"),
  // "Fear the Reaper: When a creature is defeated within Far range of the Harbinger, you gain a Fear."
  // Two automatic uses: an adversary defeated in range, and a PC (a GM button: no trigger sees any PC's defeat).
  entry(
    "harbinger-of-death",
    "Fear the Reaper",
    auto({ kind: "allyDefeated", range: "far" }, { id: "adversary", steps: [gainFear()] }),
    reaction({ kind: "situation", text: "A PC is defeated within Far range of the Harbinger" }, { id: "pc", steps: [gainFear()] }),
  ),
  // "Decapitate: Spend 2 Fear to have the Harbinger make an attack roll against a PC within Melee range. On a success,
  // roll a d6. On a result of 6, the target marks all HP and must make a death move."
  // Manual: marking all HP and the death move (dcm-702).
  entry(
    "harbinger-of-death",
    "Decapitate",
    action({
      costs: TWO_FEAR,
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        {
          kind: "check",
          when: hit,
          note: "Roll a d6",
          dice: { count: one, sides: 6 },
          test: { kind: "anyAtLeast", value: 6 },
          then: [manual("The target marks all their HP and must make a death move.", "targets")],
          otherwise: [],
        },
      ],
    }),
  ),
  // "Wake the Fallen: Spend a Fear and mark any number of Stress to have the Harbinger resurrect a defeated ally within
  // Far range. The resurrected ally clears a number of HP equal to the number of Stress marked. Immediately spotlight the
  // ally."
  // Manual: bringing the defeated ally back (dcm-145).
  entry(
    "harbinger-of-death",
    "Wake the Fallen",
    action({
      costs: [{ kind: "fear", amount: one }, anyNumberOf("stress", 6)],
      targets: { side: "ally", range: "far", count: { kind: "one" } },
      steps: [
        manual("The defeated ally rises again (no longer defeated).", "targets"),
        { kind: "clear", to: "targets", track: "hp", amount: spent("stress"), note: "As many HP as Stress marked" },
        { kind: "spotlight", who: "picked", count: one, note: "Immediately spotlight the ally" },
      ],
    }),
  ),
  // "Ashes to Ashes, Dust to Dust: When the Harbinger would mark HP, you can mark a Stress to have an ally within Far
  // range mark the HP instead."
  entry(
    "harbinger-of-death",
    "Ashes to Ashes, Dust to Dust",
    reaction(
      { kind: "onMarkHp", stage: "would" },
      {
        costs: STRESS,
        steps: [{ kind: "redirectDamage", to: "picked", pick: { side: "ally", range: "far", count: { kind: "one" } }, target: "picked", note: "An ally within Far range marks the HP instead" }],
      },
    ),
  ),

  // ---- Harbinger of Famine (Support, HF p.94)
  // "Relentless (2): The Harbinger can be spotlighted up to two times per GM turn. …"
  relentless("harbinger-of-famine", 2),
  // "Mount: While the Harbinger is on their mount, they gain a +2 bonus to their Difficulty. …"
  mount("harbinger-of-famine"),
  // "Hunger Pangs: Countdown (Decreasing 6). When the Harbinger appears, activate the countdown. It ticks down when the
  // Harbinger is spotlighted. When it triggers, all PCs within Far range mark a Stress and become Ravenous. While
  // Ravenous, a PC can't spend Hope until they clear the condition with a successful Instinct Roll."
  // Manual: a decreasing countdown restarts one lower (dcm-m5s); Ravenous's "can't spend Hope" (dcm-kti).
  entry(
    "harbinger-of-famine",
    "Hunger Pangs",
    ...countdownUses(
      "Hunger Pangs",
      fixed(6),
      { kind: "timing", at: "appears" },
      { kind: "onSpotlight" },
      "All PCs within Far range mark a Stress and become Ravenous. Decreasing: it restarts one lower each time (6, 5, 4 …).",
      {
        targets: allAround("far"),
        steps: [
          { kind: "markStress", to: "targets", amount: one },
          { kind: "condition", to: "targets", condition: tag("Ravenous"), duration: "manual", endsWhen: "a successful Instinct Roll" },
          manual("Ravenous: the PC can't spend Hope until they clear the condition.", "targets"),
          manual("Decreasing countdown: restart Hunger Pangs one lower than its last start."),
        ],
      },
      { loop: true },
    ),
  ),
  // "Drain Essence: Spend a Fear to choose up to three PCs. Each target takes 4d6 magic damage."
  entry(
    "harbinger-of-famine",
    "Drain Essence",
    action({ costs: FEAR, targets: upToEnemies(3, "unlimited"), steps: [damage(roll(4, 6), "magic")] }),
  ),
  // "Too Many Mouths: Mark a Stress to attack a PC within Melee range. On a success, the Harbinger grabs the target and
  // bites them, dealing 4d6 physical damage and Restraining the target until they break free with a successful Strength
  // Roll."
  entry(
    "harbinger-of-famine",
    "Too Many Mouths",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        damage(roll(4, 6), "physical", { when: hit }),
        { kind: "condition", to: "targets", when: hit, condition: RESTRAINED, duration: "manual", endsWhen: "they break free with a successful Strength Roll" },
      ],
    }),
  ),
  // "Withering Touch: Spend a Fear to have the Harbinger caress the face of a Restrained PC within Melee range. The
  // target marks 2 Stress and either loses a Hope or marks 1d4 HP." The PC picks Hope or HP.
  entry(
    "harbinger-of-famine",
    "Withering Touch",
    action({
      costs: FEAR,
      targets: oneEnemy("melee"),
      steps: [
        { kind: "markStress", to: "targets", amount: fixed(2), when: has(RESTRAINED) },
        {
          kind: "choose",
          id: "wither",
          label: "Lose a Hope or mark 1d4 HP (the PC's choice)",
          when: has(RESTRAINED),
          options: [
            { id: "hope", label: "Lose a Hope", steps: [{ kind: "hope", to: "targets", change: "lose", amount: one }] },
            { id: "hp", label: "Mark 1d4 HP", steps: [{ kind: "markHp", to: "targets", amount: diceOf(1, 4) }] },
          ],
        },
      ],
    }),
  ),

  // ---- Harbinger of Pestilence (Leader, HF p.94)
  // "Halo of Contagion: The Harbinger is Contagious. When a PC within Very Close range of a Contagious creature takes an
  // action, the PC rolls a d6. On a result of 1, the PC becomes Contagious. While Contagious, a PC has disadvantage on
  // action rolls until they spend 3 Hope to clear the condition. Contagious adversaries are unaffected by the condition."
  // Automatic for a PC near the Harbinger; near another Contagious creature, and the disadvantage, are manual (dcm-kti);
  // the Harbinger's own Contagious is a passive condition on itself (dcm-cdz).
  entry(
    "harbinger-of-pestilence",
    "Halo of Contagion",
    auto(
      { kind: "pcRolls", roll: "action", within: "veryClose" },
      {
        targets: TRIGGER_SUBJECT,
        steps: [
          {
            kind: "check",
            note: "The PC rolls a d6",
            dice: { count: one, sides: 6 },
            test: { kind: "totalAtMost", value: 1 },
            then: [
              { kind: "condition", to: "targets", condition: CONTAGIOUS, duration: "manual", endsWhen: "they spend 3 Hope to clear it" },
              manual("Contagious: disadvantage on action rolls until they spend 3 Hope; PCs within Very Close range of them roll the d6 too.", "targets"),
            ],
            otherwise: [],
          },
        ],
      },
    ),
  ),
  // "Mount: While the Harbinger is on their mount, they gain a +2 bonus to their Difficulty. …"
  mount("harbinger-of-pestilence"),
  // "Locust Swarm: Spend 2 Fear to have the Harbinger conjure a swarm of locusts at a point within Very Far range. Each PC
  // within Close range of that point must either mark an Armor Slot or take 4d10 direct physical damage and roll a d6. On
  // a result of 1–2, the PC becomes Contagious."
  // Manual: each PC's own choice (dcm-bz8).
  entry(
    "harbinger-of-pestilence",
    "Locust Swarm",
    action({
      costs: TWO_FEAR,
      targets: allAroundPoint("veryFar", "close"),
      steps: [
        manual("Each PC either marks an Armor Slot, or takes 4d10 direct physical damage and rolls a d6: on 1–2 they become Contagious (their choice).", "targets"),
      ],
    }),
  ),
  // "Frog Spawn: Spend a Fear to have the Harbinger conjure a clutch of diseased frogs inside the mouths of up to three
  // PCs within Close range. Each PC must succeed on a Presence Reaction Roll or take 4d12 magic damage and roll a d6. On a
  // result of 1–3, the PC becomes Contagious."
  entry(
    "harbinger-of-pestilence",
    "Frog Spawn",
    action({
      costs: FEAR,
      targets: upToEnemies(3, "close"),
      steps: [
        save("presence", OWN_DIFFICULTY, [
          damage(roll(4, 12), "magic"),
          {
            kind: "check",
            note: "The PC rolls a d6",
            dice: { count: one, sides: 6 },
            test: { kind: "totalAtMost", value: 3 },
            then: [{ kind: "condition", to: "targets", condition: CONTAGIOUS, duration: "manual", endsWhen: "they spend 3 Hope to clear it" }],
            otherwise: [],
          },
        ]),
      ],
    }),
  ),
  // "Plague Bringer: Mark any number of Stress up to the number of PCs in the scene. For each Stress you mark, the
  // Harbinger summons 1d4 Contagious Zombie Legions within Far range and immediately spotlights one of them."
  // One option per amount (up to the Harbinger's 8 Stress); the cap at the number of PCs is the GM's (dcm-ttz).
  // Reading: "immediately spotlights one of them" is one Legion in all.
  entry(
    "harbinger-of-pestilence",
    "Plague Bringer",
    action({
      steps: [
        {
          kind: "choose",
          id: "stress",
          label: "Mark any number of Stress (up to the number of PCs)",
          options: Array.from({ length: 8 }, (_, i) => ({
            id: String(i + 1),
            label: `${i + 1} Stress`,
            steps: [
              { kind: "pay", costs: [{ kind: "stress", amount: fixed(i + 1) }] },
              { kind: "summon", label: "Contagious Zombie Legions", count: diceOf(i + 1, 4), adversaryId: "zombie-legion", range: "far", note: "1d4 per Stress marked; they are Contagious" },
            ] satisfies AdversaryStep[],
          })),
        },
        { kind: "spotlight", who: "picked", count: one, name: "Zombie Legion", note: "Immediately spotlight one of them" },
      ],
    }),
  ),

  // ---- Harbinger of War (Bruiser, HF p.95)
  // "Relentless (2): The Harbinger can be spotlighted up to two times per GM turn. …"
  relentless("harbinger-of-war", 2),
  // "Mount: While the Harbinger is on their mount, they gain a +2 bonus to their Difficulty. …"
  mount("harbinger-of-war"),
  // "Iron Dice: Mark a Stress to have the Harbinger attempt a risky all-out attack. Make a standard attack with
  // advantage. On a success, the target marks an additional HP. On a failure, the Harbinger becomes Vulnerable until they
  // take or deal damage."
  entry(
    "harbinger-of-war",
    "Iron Dice",
    action({
      costs: STRESS,
      roll: ATTACK_WITH_ADVANTAGE,
      targets: oneEnemy("veryClose"),
      steps: [
        damage(STANDARD, "weapon", { when: hit }),
        { kind: "markHp", to: "targets", when: hit, amount: one, note: "An additional HP" },
        { kind: "condition", to: "self", when: ["failure"], condition: VULNERABLE, duration: "manual", endsWhen: "the Harbinger takes or deals damage" },
      ],
    }),
  ),
  // "Supreme Commander: Once per scene, spend a Fear to summon 1d6 Hallowed Soldiers within Close range and immediately
  // spotlight one of them."
  entry(
    "harbinger-of-war",
    "Supreme Commander",
    action({
      limit: { per: "scene" },
      costs: FEAR,
      steps: [
        { kind: "summon", label: "Hallowed Soldiers", count: diceOf(1, 6), adversaryId: "hallowed-soldier", range: "close" },
        { kind: "spotlight", who: "picked", count: one, name: "Hallowed Soldier", note: "Immediately spotlight one of them" },
      ],
    }),
  ),
  // "Battering Ram: When a PC fails an action roll within Close range, you can spend a Fear to move into Melee range with
  // the PC and make a standard attack with advantage against them. On a success, the PC takes standard damage and is
  // Vulnerable until they are spotlighted."
  entry(
    "harbinger-of-war",
    "Battering Ram",
    reaction(
      { kind: "pcRolls", roll: "action", result: "failure", within: "close" },
      {
        costs: FEAR,
        roll: ATTACK_WITH_ADVANTAGE,
        targets: TRIGGER_SUBJECT,
        steps: [
          { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target" },
          damage(STANDARD, "weapon", { when: hit }),
          { kind: "condition", to: "targets", when: hit, condition: VULNERABLE, duration: "manual", endsWhen: "they are spotlighted" },
        ],
      },
    ),
  ),

  // ---- Owl Witch (Support, HF p.95)
  // "Ill Omen: When a PC within Close range makes an action roll, their Fear Die gains a bonus equal to the amount of
  // Fear you have."
  // Manual: a bonus on a PC's Fear Die (dcm-3ou); shown on each action roll near the Witch.
  entry(
    "owl-witch",
    "Ill Omen",
    auto(
      { kind: "pcRolls", roll: "action", within: "close" },
      { targets: TRIGGER_SUBJECT, steps: [manual("Their Fear Die gains a bonus equal to the GM's Fear.", "targets")] },
    ),
  ),
  // "Witch Barrier: The Owl Witch has resistance to magic damage."
  entry("owl-witch", "Witch Barrier", passive({ modifiers: [{ kind: "mod", mod: { kind: "resistance", type: "magic", level: "resistant" } }] })),
  // "Voice Mimicry: Spend a Fear to have the Owl Witch beckon with the voice of a beloved figure to a creature within
  // earshot. The target must succeed on an Instinct Reaction Roll or move up to Far range toward the Owl Witch."
  entry(
    "owl-witch",
    "Voice Mimicry",
    action({
      costs: FEAR,
      targets: { side: "any", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
      steps: [save("instinct", OWN_DIFFICULTY, [{ kind: "move", to: "targets", mode: "move", range: "far", relativeTo: "self", note: "Up to Far range toward the Owl Witch" }])],
    }),
  ),
  // "Nightmare Stare: Spend a Fear to have the Owl Witch Afflict a PC within Far range with waking nightmares unless the
  // target succeeds on a Knowledge Reaction Roll. While Afflicted, the target can't clear HP or Stress. The condition is
  // cleared when another PC uses a downtime move to comfort the Afflicted creature."
  // Manual: "can't clear HP or Stress" (dcm-kti).
  entry(
    "owl-witch",
    "Nightmare Stare",
    action({
      costs: FEAR,
      targets: oneEnemy("far"),
      steps: [
        save("knowledge", OWN_DIFFICULTY, [
          { kind: "condition", to: "targets", condition: tag("Afflicted"), duration: "manual", endsWhen: "another PC uses a downtime move to comfort them" },
          manual("Afflicted: the target can't clear HP or Stress.", "targets"),
        ]),
      ],
    }),
  ),
  // "Visions of a Violent End: When the Owl Witch is targeted by an attack, you can spend a Fear to force the attacker to
  // make a Presence Reaction Roll. On a failure, they must mark 1d4 Stress as their mind is flooded with harrowing
  // imagery."
  entry(
    "owl-witch",
    "Visions of a Violent End",
    reaction(
      { kind: "onAttacked", stage: "targeted" },
      { costs: FEAR, targets: TRIGGER_SOURCE, steps: [save("presence", OWN_DIFFICULTY, [{ kind: "markStress", to: "targets", amount: diceOf(1, 4) }])] },
    ),
  ),

  // ---- Ruby Dragon (Standard, HF p.95)
  // "Relentless (3): The Dragon can be spotlighted up to three times per GM turn. …"
  relentless("ruby-dragon", 3),
  // "Fearsome: When the Dragon succeeds on an attack against a PC or a PC within Far range fails an action roll, you gain
  // a Fear." Two automatic uses, one per trigger.
  entry(
    "ruby-dragon",
    "Fearsome",
    auto({ kind: "onHit", attack: "any" }, { id: "hit", steps: [gainFear()] }),
    auto({ kind: "pcRolls", roll: "action", result: "failure", within: "far" }, { id: "pc-fails", steps: [gainFear()] }),
  ),
  // "Melting Breath: Mark a Stress to have the Dragon unleash a blast of fire on all PCs in front of it within Close
  // range. Each target must succeed on an Agility Reaction Roll or take 4d12+10 magic damage and mark an Armor Slot
  // without gaining its benefits (they can still use armor to reduce the damage)."
  entry(
    "ruby-dragon",
    "Melting Breath",
    action({
      costs: STRESS,
      targets: inFront("close"),
      steps: [save("agility", OWN_DIFFICULTY, [damage(roll(4, 12, 10), "magic"), { kind: "markArmor", to: "targets", amount: one, noBenefit: true }])],
    }),
  ),
  // "Volcanic Fissure: Spend a Fear to have the Dragon snap its tail against the ground, opening a lava rift that flows
  // over the area within Close range. Each PC within that area must make an Agility Reaction Roll. Targets who succeed
  // immediately move out of the area. Targets who fail take 4d8+5 magic damage. Until the Dragon is defeated, a creature
  // who enters the area takes 4d8+5 magic damage." Manual: the lasting lava (dcm-wuu).
  entry(
    "ruby-dragon",
    "Volcanic Fissure",
    action({
      costs: FEAR,
      targets: allAround("close"),
      steps: [
        save("agility", OWN_DIFFICULTY, [damage(roll(4, 8, 5), "magic")], [{ kind: "move", to: "targets", mode: "move", note: "They immediately move out of the area" }]),
        manual("Until the Dragon is defeated, a creature who enters the area takes 4d8+5 magic damage."),
      ],
    }),
  ),
  // "Hot-Blooded: When a creature makes a successful attack against the Dragon within Very Close range, the Dragon's
  // blood erupts from the wound and burns the attacker, forcing them to mark an Armor Slot. If they can't mark an Armor
  // Slot, they mark 1d4 HP." Manual: the fallback for a full Armor track (dcm-18i).
  entry(
    "ruby-dragon",
    "Hot-Blooded",
    reaction(
      { kind: "onAttacked", stage: "succeeded", attackerWithin: "veryClose" },
      {
        targets: TRIGGER_SOURCE,
        steps: [{ kind: "markArmor", to: "targets", amount: one }, manual("If they can't mark an Armor Slot, they mark 1d4 HP instead.", "targets")],
      },
    ),
  ),

  // ---- Severed Shadow (Minion, HF p.95)
  // "Minion (12): The Shadow is defeated when it takes any damage. For every 12 damage …"
  minion("severed-shadow", 12),
  // "Shadow Grapple: Mark a Stress to make an attack against a target within Close range. On a success, the target
  // becomes Vulnerable and must mark a Stress when they take an action until the Shadow is defeated."
  // Manual: the Stress on each action (dcm-kti).
  entry(
    "severed-shadow",
    "Shadow Grapple",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: oneEnemy("close"),
      steps: [
        { kind: "condition", to: "targets", when: hit, condition: VULNERABLE, duration: "manual", endsWhen: "the Shadow is defeated" },
        { kind: "condition", to: "targets", when: hit, condition: tag("Shadow Grappled"), duration: "manual", endsWhen: "the Shadow is defeated" },
        manual("Until the Shadow is defeated, the target marks a Stress each time they take an action.", "targets", { when: hit }),
      ],
    }),
  ),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Severed Shadows within Close range of them. … On a
  // success, they deal 10 magic damage each. Combine this damage."
  groupAttack("severed-shadow", 10, "magic"),

  // ---- Supreme Demiurge Adonix (Solo, HF p.96)
  // "Relentless (4): Adonix can be spotlighted up to four times per GM turn. …"
  relentless("supreme-demiurge-adonix", 4),
  // "Elemental Archon: Mark a Stress to roll a d4. Adonix activates the corresponding effect: …" (the four effects on each
  // branch below). The effect's creatures are the follow-up targets the GM picks (Q18).
  entry(
    "supreme-demiurge-adonix",
    "Elemental Archon",
    action({
      costs: STRESS,
      steps: [
        dieBranches(
          4,
          [
            // "1. Fire Beam. Adonix manifests a beam of elemental fire with a Very Close width from themself to the edge
            // of the battlefield. Each target in the beam's path must make an Agility Reaction Roll. Targets who fail take
            // Severe damage. Targets who succeed take Minor damage." Manual: damage of a set severity (dcm-a7o).
            {
              upTo: 1,
              note: "1. Fire Beam",
              steps: [
                {
                  kind: "followUp",
                  targets: inLine("veryFar"),
                  steps: [save("agility", OWN_DIFFICULTY, [manual("The target takes Severe damage.", "targets")], [manual("The target takes Minor damage.", "targets")])],
                },
              ],
            },
            // "2. Thunderclap. All creatures within Far range must mark a Stress and become Vulnerable until they succeed
            // on an attack roll or the Demiurge is defeated."
            {
              upTo: 2,
              note: "2. Thunderclap",
              steps: [
                {
                  kind: "followUp",
                  targets: everyoneAround("far"),
                  steps: [
                    { kind: "markStress", to: "targets", amount: one },
                    { kind: "condition", to: "targets", condition: VULNERABLE, duration: "manual", endsWhen: "they succeed on an attack roll or Adonix is defeated" },
                  ],
                },
              ],
            },
            // "3. Lightning Bolt. Make an attack against a target within Very Far range, dealing 4d8 magic damage on a
            // success. If all results are even, make the same attack against a different target, repeating the cycle until
            // you roll an odd result or run out of targets." Manual: the repeating chain (dcm-7az).
            {
              upTo: 3,
              note: "3. Lightning Bolt",
              steps: [
                {
                  kind: "followUp",
                  roll: attackWithAtk(8),
                  targets: oneEnemy("veryFar"),
                  steps: [
                    damage(roll(4, 8), "magic", { when: hit }),
                    manual("If all the damage dice are even, make the same attack against a different target; repeat until a result is odd or no targets are left."),
                  ],
                },
              ],
            },
          ],
          // "4. Ice Storm. Each PC within Close range must succeed on a Strength Reaction Roll or mark 1d4 Stress and
          // become Restrained until they spend a Hope to escape."
          [
            {
              kind: "followUp",
              note: "4. Ice Storm",
              targets: allAround("close"),
              steps: [
                save("strength", OWN_DIFFICULTY, [
                  { kind: "markStress", to: "targets", amount: diceOf(1, 4) },
                  { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "they spend a Hope to escape" },
                ]),
              ],
            },
          ],
          "Roll a d4",
        ),
      ],
    }),
  ),
  // "Alpha to Omega: When Adonix is defeated, they resurrect in Omega form with all HP and Stress cleared. Each PC within
  // Very Far range must succeed on a Presence Reaction Roll or lose a Hope. You gain a Fear for each Hope lost in this
  // way. Adonix gains the following features in this form:" (Forsaken and Armageddon, gated on the Omega form).
  // An evolution: automatic, once per scene (HF p.61). Manual: rising again after defeat (dcm-145).
  entry(
    "supreme-demiurge-adonix",
    "Alpha to Omega",
    auto(
      { kind: "onDefeated" },
      {
        limit: { per: "scene" },
        targets: allAround("veryFar"),
        steps: [
          manual("Adonix resurrects in Omega form (no longer defeated) and gains Forsaken and Armageddon."),
          { kind: "clear", to: "self", track: "hp", amount: markedSelf("hp"), note: "All HP cleared" },
          { kind: "clear", to: "self", track: "stress", amount: markedSelf("stress"), note: "All Stress cleared" },
          save("presence", OWN_DIFFICULTY, [{ kind: "hope", to: "targets", change: "lose", amount: one }, { ...gainFear(), note: "A Fear for the Hope lost" }]),
        ],
      },
    ),
  ),
  // "Forsaken: Spend a Fear to choose a PC and activate a Forsaken Countdown (1d8) for them. It ticks down when Adonix is
  // spotlighted. When it triggers, the PC must mark all their HP. The countdown ends if Adonix takes Severe damage. You
  // can have only one Forsaken Countdown active at a time." (Omega form.)
  // Three uses: activate, tick, end. Marking all HP when it triggers is manual (dcm-702).
  entry(
    "supreme-demiurge-adonix",
    "Forsaken",
    action({
      requires: [OMEGA],
      costs: FEAR,
      targets: oneEnemy("unlimited"),
      steps: [
        { kind: "countdown", op: "start", label: "Forsaken", start: diceOf(1, 8), onTrigger: "The PC must mark all their HP.", note: "Only one Forsaken Countdown at a time (dcm-vkp)" },
        { kind: "condition", to: "targets", condition: tag("Forsaken"), duration: "manual", endsWhen: "the Forsaken Countdown triggers or ends" },
      ],
    }),
    auto({ kind: "onSpotlight" }, { id: "tick", requires: [OMEGA], steps: [{ kind: "countdown", op: "tick", label: "Forsaken" }] }),
    auto(
      { kind: "onDamaged", minSeverity: "severe" },
      { id: "end", requires: [OMEGA], steps: [{ kind: "countdown", op: "prompt", label: "Forsaken", note: "The Forsaken Countdown ends" }] },
    ),
  ),
  // "Armageddon: When Adonix is defeated again, they unleash a reality storm that shakes the realms to their foundations.
  // Roll a d6. On a result of 5–6, each PC must make a death move." (Omega form.) Manual: the death moves (dcm-702).
  entry(
    "supreme-demiurge-adonix",
    "Armageddon",
    reaction(
      { kind: "onDefeated" },
      {
        requires: [OMEGA],
        steps: [
          {
            kind: "check",
            note: "Roll a d6",
            dice: { count: one, sides: 6 },
            test: { kind: "anyAtLeast", value: 5 },
            then: [manual("Each PC must make a death move.", "picked", { pick: ANY_PC })],
            otherwise: [],
          },
        ],
      },
    ),
  ),

  // ---- Temporal Enforcer (Bruiser, HF p.96)
  // "Relentless (2): The Enforcer can be spotlighted up to two times per GM turn. …"
  relentless("temporal-enforcer", 2),
  // "Time Looper: Countdown (Loop 2d6). When the Enforcer first appears, activate the countdown. It ticks down when the
  // Enforcer is spotlighted. When it triggers, the Enforcer clears all HP, Stress, and conditions. Reroll the countdown
  // when the Enforcer takes Severe damage."
  // Four uses: the countdown's three and the reroll (a fresh 2d6 start). "All conditions" is every standard condition
  // cleared, plus a manual note for tags.
  entry(
    "temporal-enforcer",
    "Time Looper",
    ...countdownUses(
      "Time Looper",
      diceOf(2, 6),
      { kind: "timing", at: "appears" },
      { kind: "onSpotlight" },
      "The Enforcer clears all HP, Stress and conditions.",
      {
        steps: [
          { kind: "clear", to: "self", track: "hp", amount: markedSelf("hp") },
          { kind: "clear", to: "self", track: "stress", amount: markedSelf("stress") },
          ...(["vulnerable", "restrained", "hidden", "distracted", "cloaked"] as const).map(
            (condition): AdversaryStep => ({ kind: "clearCondition", to: "self", condition: { kind: "standard", condition } }),
          ),
          manual("The Enforcer also clears any other condition it carries (tags)."),
        ],
      },
      { loop: true },
    ),
    auto(
      { kind: "onDamaged", minSeverity: "severe" },
      { id: "reroll", steps: [{ kind: "countdown", op: "start", label: "Time Looper", start: diceOf(2, 6), loop: true, note: "Reroll the countdown" }] },
    ),
  ),
  // "Move Between Moments: Mark a Stress to have the Enforcer teleport to a point within Very Far range, then spotlight
  // them again."
  entry(
    "temporal-enforcer",
    "Move Between Moments",
    action({
      costs: STRESS,
      steps: [{ kind: "move", to: "self", mode: "teleport", range: "veryFar" }, { kind: "spotlight", who: "self", note: "Spotlight the Enforcer again" }],
    }),
  ),
  // "Instant Rewind: When the Enforcer fails an attack, you can spend a Fear to reroll the die."
  entry(
    "temporal-enforcer",
    "Instant Rewind",
    reaction({ kind: "onMiss", attack: "any" }, { costs: FEAR, steps: [{ kind: "modifyRoll", to: "self", change: { kind: "reroll", dice: "all" }, note: "Reroll the attack die" }] }),
  ),
  // "Invert Polarity: Up to three times per scene, you can spend a Fear to flip any die rolled onto its obverse result.
  // This effect can't be used to alter a critical success."
  // Any die: a GM button on any roll; the new result is the opposite face (sides + 1 − result).
  entry(
    "temporal-enforcer",
    "Invert Polarity",
    reaction(
      { kind: "situation", text: "Any die is rolled (not a critical success)" },
      {
        limit: { per: "scene", times: 3 },
        costs: FEAR,
        steps: [{ kind: "modifyRoll", to: "self", change: { kind: "setResult" }, note: "Flip the die to its obverse result (sides + 1 − result)" }],
      },
    ),
  ),

  // ---- Water Mother (Solo, HF p.96)
  // "Segmented: The Water Mother's body is divided into three segments: Head, Center, and Tail. … A creature can target
  // the Water Mother with an attack as long as at least one of her segments is within range, but the Water Mother can make
  // a standard attack only against a target within range of her Head. If an attack deals damage to the Water Mother and
  // her Head is within range, the attack deals an extra 1d10 damage."
  // The segments are positions on the map (no map: the GM's call, Q18); the extra 1d10 is a reaction the GM confirms
  // when the Head was within range.
  entry(
    "water-mother",
    "Segmented",
    reaction(
      { kind: "onDamaged", stage: "would", fromAttack: true },
      {
        requires: [situation("The Water Mother's Head is within range of the attack")],
        steps: [{ kind: "modifyDamage", to: "self", change: { kind: "add", amount: diceOf(1, 10) }, note: "An extra 1d10 damage" }],
      },
    ),
  ),
  // "Eat the World: Spend a Fear to have the Water Mother inhale sharply. Each PC within Close range of her Head must
  // succeed on a Strength Reaction Roll or mark a Stress and be pulled within Melee range of the Head. The Water Mother
  // then makes a standard attack against all targets within Melee range of her Head."
  // Two uses: the inhale (with the PCs' rolls) and, once they rolled, the attack (same spotlight, no extra cost).
  entry(
    "water-mother",
    "Eat the World",
    action({
      costs: FEAR,
      targets: allAround("close"),
      steps: [
        save("strength", OWN_DIFFICULTY, [
          { kind: "markStress", to: "targets", amount: one },
          { kind: "move", to: "targets", mode: "pull", range: "melee", relativeTo: "self", note: "Pulled within Melee range of the Head" },
        ]),
      ],
    }),
    action({ id: "attack", roll: ATTACK, targets: allAround("melee"), steps: [damage(STANDARD, "weapon", { when: hit })] }),
  ),
  // "Constrict: Mark a Stress to make an attack against all targets within Melee range of the Center segment. Targets the
  // attack succeeds against take 4d8+8 physical damage and are temporarily Restrained. At the beginning of each GM turn,
  // you can mark a Stress to force all targets Restrained by the Water Mother to mark a HP."
  // Two uses: the attack, and the squeeze at the start of each GM turn (on the PCs she Restrained: the GM passes them).
  entry(
    "water-mother",
    "Constrict",
    action({
      costs: STRESS,
      roll: ATTACK,
      targets: allAround("melee"),
      steps: [
        damage(roll(4, 8, 8), "physical", { when: hit }),
        { kind: "condition", to: "targets", when: hit, condition: RESTRAINED, duration: "temporary" },
      ],
    }),
    reaction(
      { kind: "timing", at: "gmTurnStart" },
      {
        id: "squeeze",
        costs: STRESS,
        targets: ANY_PC,
        steps: [{ kind: "markHp", to: "targets", when: has(RESTRAINED), amount: one, note: "Every target Restrained by the Water Mother marks a HP" }],
      },
    ),
  ),
  // "Venom Surge: When the Water Mother makes a successful standard attack, you can spend a Fear to make the target
  // Vulnerable until the end of the scene."
  entry(
    "water-mother",
    "Venom Surge",
    reaction(
      { kind: "onHit", attack: "standard" },
      { costs: FEAR, targets: TRIGGER_SUBJECT, steps: [{ kind: "condition", to: "targets", condition: VULNERABLE, duration: "scene" }] },
    ),
  ),

  // ---- Wyrmfiend (Minion, HF p.97)
  // "Minion (13): The Wyrmfiend is defeated when it takes any damage. For every 13 damage …"
  minion("wyrmfiend", 13),
  // "Venomous Bite: Spend a Fear to make an attack against a PC within Melee range. On a success, deal 4d4+4 physical
  // damage and Poison the target until they succeed on a Strength Roll (20). While Poisoned, the target must roll a d6
  // before they make an action roll. On a result of 4 or lower, the target must mark a Stress."
  // Manual: the d6 before each action roll (dcm-kti).
  entry(
    "wyrmfiend",
    "Venomous Bite",
    action({
      costs: FEAR,
      roll: ATTACK,
      targets: oneEnemy("melee"),
      steps: [
        damage(roll(4, 4, 4), "physical", { when: hit }),
        { kind: "condition", to: "targets", when: hit, condition: tag("Poisoned"), duration: "manual", endsWhen: "they succeed on a Strength Roll (20)" },
        manual("Poisoned: before each action roll the target rolls a d6; on 4 or lower they mark a Stress.", "targets", { when: hit }),
      ],
    }),
  ),
  // "Group Attack: Spend a Fear to choose a target and spotlight all Wyrmfiends within Close range of them. … On a
  // success, they deal 11 physical damage each. Combine this damage."
  groupAttack("wyrmfiend", 11, "physical"),

  // ---- Wyrmlings (Horde, HF p.97)
  // "Horde (2d6+5): When the Wyrmlings have marked half or more of their HP, their standard attack deals 2d6+5 physical
  // damage instead."
  horde("wyrmlings", 2, 6, 5),
  // "Ravenous: Once per GM turn when a PC marks a HP from an attack made by the Wyrmlings, you can spend a Fear to
  // spotlight the Wyrmlings again."
  // Manual: the once-per-GM-turn limit (no GM-turn period, dcm-c5h).
  entry(
    "wyrmlings",
    "Ravenous",
    reaction(
      { kind: "onTargetMarksHp", attack: "any" },
      { costs: FEAR, steps: [{ kind: "spotlight", who: "self", note: "Spotlight the Wyrmlings again (once per GM turn)" }] },
    ),
  ),
  // "Overwhelm: When the Wyrmlings take Minor damage from an attack within Melee range, you can mark a Stress to make a
  // standard attack with advantage against the attacker."
  // Minor damage is marking 1 HP (CB p.91).
  entry(
    "wyrmlings",
    "Overwhelm",
    reaction(
      { kind: "onMarkHp", atMost: 1, fromAttack: true, attackerWithin: "melee" },
      { costs: STRESS, roll: ATTACK_WITH_ADVANTAGE, targets: TRIGGER_SOURCE, steps: [damage(STANDARD, "weapon", { when: hit })] },
    ),
  ),

  // ---- Xero the Castle Killer (Solo, HF p.97)
  // "Relentless (X): Xero can be spotlighted up to X times per GM turn, where X is the number of PCs in the scene. Spend
  // Fear as usual to spotlight it."
  relentlessPerPc("xero-the-castle-killer", "Xero"),
  // "Collateral Damage: Xero's movement can't be hindered, impeded, or affected by anything other than natural terrain.
  // All destructible terrain or obstacles in Xero's path are destroyed when Xero moves through them."
  // Read as "can't be Restrained" (the movement condition); the destroyed terrain is the fiction.
  entry("xero-the-castle-killer", "Collateral Damage", passive({ modifiers: [{ kind: "mod", mod: { kind: "flag", flag: "cannotBeRestrained" } }] })),
  // "Gigaton Stomp: Spend a Fear to have Xero bring its foot down hard, creating a localized earthquake. Each PC within
  // Melee range takes 4d12 physical damage and is Restrained until they wriggle out with a successful Finesse Roll. Each
  // creature beyond Melee range but within Close range must succeed on an Instinct Reaction Roll or be knocked back to
  // Far range. If a target is knocked back, they must either mark an Armor Slot or take 4d12 physical damage as they
  // land."
  // The Melee PCs are the targets; the creatures beyond Melee within Close are the follow-up's. The knocked-back target
  // picks Armor Slot or damage.
  entry(
    "xero-the-castle-killer",
    "Gigaton Stomp",
    action({
      costs: FEAR,
      targets: allAround("melee"),
      steps: [
        damage(roll(4, 12), "physical"),
        { kind: "condition", to: "targets", condition: RESTRAINED, duration: "manual", endsWhen: "they wriggle out with a successful Finesse Roll" },
        {
          kind: "followUp",
          note: "Each creature beyond Melee range but within Close range",
          targets: everyoneAround("close"),
          steps: [
            save("instinct", OWN_DIFFICULTY, [
              { kind: "move", to: "targets", mode: "knockBack", range: "far", relativeTo: "self" },
              {
                kind: "choose",
                id: "landing",
                label: "Mark an Armor Slot or take 4d12 physical damage (the target's choice)",
                options: [
                  { id: "armor", label: "Mark an Armor Slot", steps: [{ kind: "markArmor", to: "targets", amount: one }] },
                  { id: "damage", label: "Take 4d12 physical damage", steps: [damage(roll(4, 12), "physical")] },
                ],
              },
            ]),
          ],
        },
      ],
    }),
  ),
  // "Power Slide: Mark a Stress to move up to Close range. Each PC Xero moves through must succeed on a Strength Reaction
  // Roll or choose to either mark 2 Armor Slots or take Severe damage."
  // Manual: damage of a set severity (dcm-a7o).
  entry(
    "xero-the-castle-killer",
    "Power Slide",
    action({
      costs: STRESS,
      targets: { side: "enemy", range: "close", count: { kind: "any" }, area: "path" },
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close" },
        save("strength", OWN_DIFFICULTY, [
          {
            kind: "choose",
            id: "slide",
            label: "Mark 2 Armor Slots or take Severe damage (the PC's choice)",
            options: [
              { id: "armor", label: "Mark 2 Armor Slots", steps: [{ kind: "markArmor", to: "targets", amount: fixed(2) }] },
              { id: "severe", label: "Take Severe damage", steps: [manual("The PC takes Severe damage.", "targets")] },
            ],
          },
        ]),
      ],
    }),
  ),
  // "Radioactive Breath: Spend a Fear to have Xero charge up a nuclear beam. Place a token on this stat block. The next
  // time Xero is spotlighted, you can spend this token and unleash a beam to Very Far range. The beam has a width of
  // Close range. Each PC in this area must make an Agility Reaction Roll. Targets who fail take 4d12+12 direct magic
  // damage. Targets who succeed take half damage. Xero can't use this feature again until it takes Severe damage."
  // Three uses: charge (once, a per-scene limit), the beam (spends the token), and the recharge on Severe damage (drops
  // the charge's limit, as the tier 2 Refresh Warding Sphere does).
  entry(
    "xero-the-castle-killer",
    "Radioactive Breath",
    action({
      id: "charge",
      limit: { per: "scene" },
      costs: FEAR,
      steps: [{ kind: "tokens", to: "self", op: "add", amount: one, note: "The nuclear beam is charged" }],
    }),
    action({
      id: "beam",
      requires: [{ kind: "tokens", atLeast: 1 }],
      targets: inLine("veryFar"),
      steps: [
        { kind: "tokens", to: "self", op: "spend", amount: one },
        save("agility", OWN_DIFFICULTY, [damage(roll(4, 12, 12), "magic", { direct: true })], [damage(roll(4, 12, 12), "magic", { direct: true, scale: "half" })]),
      ],
    }),
    auto({ kind: "onDamaged", minSeverity: "severe" }, { id: "recharge", steps: [{ kind: "refreshFeature", to: "self", note: "Radioactive Breath can be charged again" }] }),
  ),
  // "Regeneration: Up to three times per scene, spend any number of Fear to clear an equal number of HP."
  entry(
    "xero-the-castle-killer",
    "Regeneration",
    action({
      limit: { per: "scene", times: 3 },
      costs: [anyNumberOf("fear", 12)],
      steps: [{ kind: "clear", to: "self", track: "hp", amount: spent("fear"), note: "As many HP as Fear spent" }],
    }),
  ),
];
