// Adversary feature effects of tier 3 Hope & Fear adversaries (plan combat-actions, tracer AE-t3-hf). Pure data: no
// framework imports, relative imports only (bundled into Convex).
//
// Exactly one entry per printed feature of every adversary in this group (`adversaryGroup` in ./index.ts): 32 adversaries,
// 135 features, HF p.81-89. Each entry quotes its feature text in a comment (as in ../adversaries.ts); what the vocabulary
// (src/lib/domain/adversary-effects/types.ts) cannot express is a `manual` step, never a vocabulary change. Readings,
// manual steps and their reasons: docs/tasks/TASK-CA-AE-t3-hf.md.
//
// Conventions used below (the same as the tier 1 and tier 2 tables):
// - Printed actions are `action` uses that need the spotlight (CB p.194). Printed reactions are `reaction` uses (a
//   one-tap prompt, default No, Q19), except pure Fear gains ("you gain a Fear"), which are `auto` (Q19). A printed
//   passive with a trigger and no choice is `auto`; one that says "you can" is a `reaction`.
// - "The target" of a reaction is the trigger's creature: `subject` = the PC the trigger happened to (the PC hit, the PC
//   who rolled), `source` = the creature that caused it (the attacker).
// - A PC's reaction roll is a `save`; with no printed Difficulty it uses the adversary's own (CB p.193). The runner turns
//   it into a `pcSave` prompt and the server applies `onFail` / `onSuccess` per PC. One damage roll serves every PC.
// - "Any number of Stress / Fear" is a `choose` (one option per amount up to the track) or one use per amount when the
//   amount also sets the number of targets (Fireball, like Quick Volley in t2-hf). Picking the option is the GM's tap.
// - Untracked conditions are tags with `duration: "manual"` and `endsWhen` in the book's words.

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
import type { TraitId } from "../types";

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
const range1to = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

const fear = (n = 1): AdversaryCost => ({ kind: "fear", amount: fixed(n) });
const stress = (n = 1): AdversaryCost => ({ kind: "stress", amount: fixed(n) });

/** d20 + ATK against each target's Evasion (AR1); the runner adds the stat block's ATK. */
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };
/** No Difficulty printed: the adversary's own (CB p.193). */
const OWN: SaveDifficulty = { kind: "actorDifficulty" };
const dc = (value: number): SaveDifficulty => ({ kind: "fixed", value });

const enemy = (range: Range | "unlimited"): TargetSpec => ({ side: "enemy", range, count: { kind: "one" } });
const enemies = (range: Range, n: number): TargetSpec => ({ side: "enemy", range, count: { kind: "upTo", n: fixed(n) } });
const enemiesAround = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "aroundSelf" });
const enemiesFront = (range: Range): TargetSpec => ({ side: "enemy", range, count: { kind: "all" }, area: "front" });
/** Every PC carrying a condition this adversary imposed: the server passes the party, the step's gate picks them. */
const anyEnemy: TargetSpec = { side: "enemy", range: "unlimited", count: { kind: "any" } };
const SUBJECT: TriggerTargets = { side: "trigger", who: "subject" };
const SOURCE: TriggerTargets = { side: "trigger", who: "source" };

const std = (condition: StandardCondition): ConditionRef => ({ kind: "standard", condition });
const tag = (name: string, implies?: readonly StandardCondition[]): ConditionRef => ({ kind: "tag", tag: name, ...(implies ? { implies } : {}) });
const has = (condition: ConditionRef): Gate => ({ kind: "targetHas", condition });
const situationGate = (text: string): Gate => ({ kind: "requires", requirement: { kind: "situation", text } });

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
const damage = (roll: DamageRoll, type: DamageType, extra: { direct?: boolean; scale?: "half" | "double" } = {}): AdversaryStep => ({
  kind: "damage",
  to: "targets",
  roll,
  type,
  ...(extra.direct ? { direct: true } : {}),
  ...(extra.scale ? { scale: extra.scale } : {}),
});
const gainFear = (amount: NumberSource = one): AdversaryStep => ({ kind: "fear", to: "self", change: "gain", amount });
const markStress = (amount: NumberSource = one): AdversaryStep => ({ kind: "markStress", to: "targets", amount });
const condition = (c: ConditionRef, duration: "temporary" | "rest" | "scene" | "hit" | "manual", endsWhen?: string, when?: readonly Gate[]): AdversaryStep => ({
  kind: "condition",
  to: "targets",
  condition: c,
  duration,
  ...(endsWhen ? { endsWhen } : {}),
  ...(when ? { when } : {}),
});
const manual = (text: string, to: "self" | "targets" = "targets"): AdversaryStep => ({ kind: "manual", to, text });

/** A PC reaction roll (`save`) for the use's targets. */
const save = (trait: TraitId | readonly TraitId[], difficulty: SaveDifficulty, onFail: readonly AdversaryStep[], onSuccess: readonly AdversaryStep[] = [], when?: readonly Gate[]): AdversaryStep => ({
  kind: "save",
  to: "targets",
  trait,
  difficulty,
  onFail,
  onSuccess,
  ...(when ? { when } : {}),
});

/** "Targets who succeed must mark a Stress or take half damage" (the PC picks; one option each). */
const stressOrHalf = (id: string, roll: DamageRoll, type: DamageType, direct = false): AdversaryStep => ({
  kind: "choose",
  id,
  label: "Mark a Stress or take half damage",
  options: [
    { id: "stress", label: "Mark a Stress", steps: [markStress()] },
    { id: "half", label: "Take half damage", steps: [damage(roll, type, { direct, scale: "half" })] },
  ],
});

const passive = (modifiers: AdversaryFeatureUse["modifiers"], extra: Partial<AdversaryFeatureUse> = {}): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "passive" },
  needsSpotlight: false,
  modifiers,
  steps: [],
  ...extra,
});

/** A passive with no rule to apply: shown to the GM as a reminder (as Climber in t1-core). */
const reminder = (text: string): AdversaryFeatureUse => ({ id: "main", activation: { kind: "passive" }, needsSpotlight: false, steps: [manual(text, "self")] });

const action = (use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string }): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "action" },
  needsSpotlight: true,
  ...use,
});

type Trigger = Extract<AdversaryFeatureUse["activation"], { kind: "auto" }>["trigger"];
const auto = (trigger: Trigger, use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string }): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "auto", trigger },
  needsSpotlight: false,
  ...use,
});
const reaction = (trigger: Trigger, use: Omit<AdversaryFeatureUse, "id" | "activation" | "needsSpotlight"> & { id?: string }): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "reaction", trigger },
  needsSpotlight: false,
  ...use,
});

const entry = (adversaryId: string, feature: string, ...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({ adversaryId, feature, uses });

const resistance = (type: DamageType | "both", level: "resistant" | "immune" = "resistant", extra: Partial<AdversaryFeatureUse> = {}) =>
  passive([{ kind: "mod", mod: { kind: "resistance", type, level } }], extra);

/** Relentless (X): "can be spotlighted up to X times per GM turn. Spend Fear as usual to spotlight them." */
const relentless = (adversaryId: string, times: number): AdversaryFeatureEffect => entry(adversaryId, `Relentless (${times})`, passive([{ kind: "relentless", times }]));

/** Momentum (CB p.195): "When the X makes a successful attack against a PC, you gain a Fear." Automatic (Q19). */
const momentum = (adversaryId: string): AdversaryFeatureEffect => entry(adversaryId, "Momentum", auto({ kind: "onHit", attack: "any" }, { steps: [gainFear()] }));

/** Terrifying: "When the X makes a successful attack, all PCs within Close range lose a Hope, and you gain a Fear." */
const terrifying = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Terrifying",
    auto({ kind: "onHit", attack: "any" }, { steps: [{ kind: "hope", to: "picked", pick: enemiesAround("close"), change: "lose", amount: one }, gainFear()] }),
  );

/**
 * Double Strike / Double Claw: "Mark a Stress to make two standard attacks. If both attacks succeed against the same
 * target, combine the damage." Two rolls in one use (`followUp` with its own roll against `context.followUp`); the runner
 * merges both hits on one PC into one incoming hit ("combine the damage"). The second attack's damage is the printed dice
 * written out: the card runner caches a damage roll by its expression, so a second `standardAttack` would reuse the first
 * roll (bead dcm-vv2, as in t2-hf). The follow-up roll gets the ATK from the runner because the use's own roll is an
 * adversary attack; neither adversary has a passive that changes its attack.
 */
const doubleStrike = (adversaryId: string, feature: string, range: Range, printed: DamageRoll): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    feature,
    action({
      costs: [stress()],
      roll: ATTACK,
      targets: enemy(range),
      steps: [standardHit, { kind: "followUp", roll: ATTACK, targets: enemy(range), steps: [hitDamage(printed, "physical")], note: "Second standard attack" }],
    }),
  );

/** Specter (Dullahan, as the Banshee in t2-hf): physical resistance; "Mark a Stress to move up to Close range through solid objects." */
const specter = (adversaryId: string): AdversaryFeatureEffect =>
  entry(
    adversaryId,
    "Specter",
    resistance("physical"),
    action({ id: "phase", costs: [stress()], steps: [{ kind: "move", to: "self", mode: "move", range: "close", note: "Move up to Close range through solid objects" }] }),
  );

/** "Mark any number of Stress to …": one option per Stress slot; each option pays its Stress, then runs `steps(n)`. */
const anyStress = (id: string, label: string, slots: number, steps: (n: number) => readonly AdversaryStep[]): AdversaryStep => ({
  kind: "choose",
  id,
  label,
  options: range1to(slots).map((n): AdversaryChooseOption => ({ id: String(n), label: `${n} Stress`, steps: [{ kind: "pay", costs: [stress(n)] }, ...steps(n)] })),
});

/**
 * Swallowed (Lamplight Beguiler Gulp, Sandwyrm Devour): the swallow itself is the feature's main use; `digest` hurts every
 * Swallowed PC when the adversary takes the spotlight, `disgorge` frees them when it takes Major or greater damage.
 */
const SWALLOWED = tag("Swallowed", ["restrained"]);
const swallowedUses = (digest: AdversaryStep): AdversaryFeatureUse[] => [
  auto({ kind: "onSpotlight" }, { id: "digest", targets: anyEnemy, steps: [digest] }),
  auto(
    { kind: "onDamaged", minSeverity: "major" },
    {
      id: "disgorge",
      targets: anyEnemy,
      steps: [
        { kind: "clearCondition", to: "targets", when: [has(SWALLOWED)], condition: std("restrained") },
        { kind: "clearCondition", to: "targets", condition: SWALLOWED },
      ],
    },
  ),
];

/** A grip that ends when the adversary takes Major or greater damage (Lamia, Whisper Wraith, Wyvern, Deep Dweller). */
const releaseOnMajor = (c: ConditionRef, minSeverity: "major" | "severe" = "major", restrains = false): AdversaryFeatureUse => {
  const steps: AdversaryStep[] = [];
  if (restrains) steps.push({ kind: "clearCondition", to: "targets", when: [has(c)], condition: std("restrained") });
  steps.push({ kind: "clearCondition", to: "targets", condition: c });
  return auto({ kind: "onDamaged", minSeverity }, { id: "release", targets: anyEnemy, steps });
};

/** The Archmage's Aegis Die: its face is a tag ("Aegis Die 6" … "Aegis Die 1"); the stat-block tokens hold Counterspell's. */
const AEGIS = (n: number) => tag(`Aegis Die ${n}`);
const aegisDown = (from: number, by: number): AdversaryStep[] => {
  const steps: AdversaryStep[] = [{ kind: "clearCondition", to: "self", condition: AEGIS(from) }];
  if (from - by >= 1) steps.push({ kind: "condition", to: "self", condition: AEGIS(from - by), duration: "manual", endsWhen: "the Aegis Die ticks down" });
  return steps;
};

const TOO_CUTE = tag("Too Cute");
const HELLWING = tag("Hellwing");
const NEST_WARDEN = tag("Nest Warden");

// ---------------------------------------------------------------- the table

export const T3_HF_EFFECTS: readonly AdversaryFeatureEffect[] = [
  // ======================================================== Archmage (HF p.81)
  // Relentless (3) - Passive: "The Archmage can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight them."
  relentless("archmage", 3),
  // Orbiting Aegis - Passive: "When the Archmage appears, they conjure six discs of magical energy that orbit around them.
  // Place a d6 Aegis Die on this stat block with the 6 value facing up. When a PC makes a successful attack against the
  // Archmage, roll a d6. If the result is equal to or less than the value of the Aegis Die, tick the Aegis Die down and
  // ignore the damage. A PC can make a Knowledge Roll to tick down the Aegis Die by 1 on a success or by 2 on a success with
  // Hope."
  // The die's face is a tag (Counterspell owns the stat-block tokens). `ward-N` runs when the die shows N: d6 <= N ticks it
  // down and negates the damage. `study-N`: the GM says whether the Knowledge Roll succeeded with Hope.
  entry(
    "archmage",
    "Orbiting Aegis",
    auto({ kind: "timing", at: "appears" }, { id: "place", steps: [{ kind: "condition", to: "self", condition: AEGIS(6), duration: "manual", endsWhen: "the Aegis Die ticks down" }] }),
    ...range1to(6).map((n) =>
      auto(
        { kind: "onAttacked", stage: "succeeded" },
        {
          id: `ward-${n}`,
          requires: [{ kind: "hasCondition", condition: AEGIS(n) }],
          steps: [
            {
              kind: "check",
              dice: diceExpr(1, 6),
              test: { kind: "totalAtMost", value: n },
              then: [...aegisDown(n, 1), { kind: "negate", to: "self", what: "damage", note: "Ignore the damage" }],
              otherwise: [],
            },
          ],
        },
      ),
    ),
    ...range1to(6).map((n) =>
      auto(
        { kind: "pcRolls", roll: "knowledge", result: "success" },
        {
          id: `study-${n}`,
          requires: [{ kind: "hasCondition", condition: AEGIS(n) }, { kind: "situation", text: "The Knowledge Roll was made against the Aegis" }],
          steps: [
            {
              kind: "choose",
              id: "study",
              label: "A success, or a success with Hope?",
              options: [
                { id: "success", label: "Success: tick down 1", steps: aegisDown(n, 1) },
                { id: "hope", label: "Success with Hope: tick down 2", steps: aegisDown(n, 2) },
              ],
            },
          ],
        },
      ),
    ),
  ),
  // Force Salvo - Action: "Spend any number of Fear and roll that many d4s. The Archmage unleashes a number of magical homing
  // force bolts equal to the total result. For each bolt, a creature within Far range marks a HP. The same creature can be
  // targeted by up to three force bolts."
  // One option per Fear (the GM's pool holds 12). The d4s are rolled (`check`, its total is the bolts); placing the bolts
  // is manual: no step spreads forced HP marks over creatures (bead in the task doc).
  entry(
    "archmage",
    "Force Salvo",
    action({
      steps: [
        {
          kind: "choose",
          id: "salvo",
          label: "Spend how many Fear?",
          options: range1to(12).map((n): AdversaryChooseOption => ({
            id: String(n),
            label: `${n} Fear, ${n}d4 bolts`,
            steps: [
              { kind: "pay", costs: [fear(n)] },
              {
                kind: "check",
                dice: diceExpr(n, 4),
                test: { kind: "totalAtLeast", value: 0 },
                then: [manual("The total is the number of bolts. For each bolt, a creature within Far range marks a HP; at most three bolts on the same creature.", "self")],
                otherwise: [],
              },
            ],
          })),
        },
      ],
    }),
  ),
  // Fireball - Action: "Mark any number of Stress to target the same number of PCs within Far range. Each target must succeed
  // on an Agility Reaction Roll or take 4d10 magic damage."
  // One use per number of Stress (its track holds 8): N Stress, up to N PCs.
  entry(
    "archmage",
    "Fireball",
    ...range1to(8).map((n) =>
      action({
        id: `fireball-${n}`,
        costs: [stress(n)],
        targets: enemies("far", n),
        steps: [save("agility", OWN, [damage(dmg(4, 10), "magic")])],
      }),
    ),
  ),
  // Counterspell - Reaction: "When a PC succeeds on a Spellcast Roll, you can spend a Fear to have the Archmage make a
  // reaction roll with a Difficulty equal to the Spellcast Roll's result. On a success, the PC's Spellcast Roll fails
  // instead, and you place a token on this stat block. Using this feature again costs additional Fear equal to the number
  // of tokens on this stat block. You can't Counterspell a critical success."
  // The trigger's amount is the Spellcast Roll's total. The Archmage's reaction roll is a d20 against it (a `save` on
  // itself); the stat-block tokens count the Counterspells and raise the Fear cost.
  entry(
    "archmage",
    "Counterspell",
    reaction(
      { kind: "pcRolls", roll: "spellcast", result: "success" },
      {
        costs: [fear(1), { kind: "fear", amount: { kind: "cardTokens" } }],
        targets: SUBJECT,
        steps: [
          {
            kind: "save",
            to: "self",
            difficulty: { kind: "number", value: { kind: "triggerAmount" } },
            onSuccess: [
              { kind: "modifyRoll", to: "triggerSubject", change: { kind: "fail" }, note: "The Spellcast Roll fails instead (never a critical success)" },
              { kind: "tokens", to: "self", op: "add", amount: one },
            ],
            onFail: [],
          },
        ],
      },
    ),
  ),

  // ======================================================== Catrin (HF p.81)
  // Attracted to Wealth - Passive: "PCs carrying at least a bag of gold gain advantage on Presence Rolls made to influence
  // the Catrin."
  entry(
    "catrin",
    "Attracted to Wealth",
    passive([{ kind: "mod", mod: { kind: "advantage", on: "presence" }, to: "pcs" }], { requires: [{ kind: "situation", text: "The PC carries at least a bag of gold and rolls to influence the Catrin" }] }),
  ),
  // The Weight of Opulence - Action: "Spend a Fear to turn the Catrin's gaze toward the PC carrying the most gold. The target
  // must succeed on an Instinct Reaction Roll or lose a Hope for each bag of gold they're carrying. If the PC loses their last
  // Hope or has no Hope to lose, they mark Stress instead."
  entry(
    "catrin",
    "The Weight of Opulence",
    action({
      costs: [fear()],
      targets: enemy("unlimited"),
      steps: [save("instinct", OWN, [manual("Lose a Hope for each bag of gold carried. If they lose their last Hope or have none to lose, they mark Stress instead.")])],
    }),
  ),
  // Expensive Failure - Reaction: "When a PC within Melee range fails an action roll, you can mark a Stress to have the
  // Catrin brazenly steal a handful of gold from them."
  entry(
    "catrin",
    "Expensive Failure",
    reaction({ kind: "pcRolls", roll: "action", result: "failure", within: "melee" }, { costs: [stress()], targets: SUBJECT, steps: [manual("The Catrin steals a handful of gold from them.")] }),
  ),

  // ======================================================== Chimera (HF p.81)
  // Rending Jaws - Passive: "When the Chimera makes a successful attack against a PC, the target must mark 2 Armor Slots to
  // reduce the severity by one threshold."
  entry(
    "chimera",
    "Rending Jaws",
    auto({ kind: "onHit", attack: "any" }, { targets: SUBJECT, steps: [manual("To reduce the severity with armor, this PC must mark 2 Armor Slots instead of 1.")] }),
  ),
  // Double Claw - Action: "Mark a Stress to make two standard attacks. If both attacks succeed against the same target,
  // combine the damage."
  doubleStrike("chimera", "Double Claw", "melee", dmg(3, 12)),
  // Breath of Fire - Action: "Spend a Fear to target up to three PCs in front of the Chimera within Close range. Each target
  // must make an Agility Reaction Roll (20). Targets who fail take 3d12 magic damage. Targets who succeed must choose to mark
  // either an Armor Slot or a Stress."
  // "In front of" is left to the GM's pick so that the count of three holds.
  entry(
    "chimera",
    "Breath of Fire",
    action({
      costs: [fear()],
      targets: enemies("close", 3),
      steps: [
        save(
          "agility",
          dc(20),
          [damage(dmg(3, 12), "magic")],
          [
            {
              kind: "choose",
              id: "breath",
              label: "Mark an Armor Slot or a Stress",
              options: [
                { id: "armor", label: "Mark an Armor Slot", steps: [{ kind: "markArmor", to: "targets", amount: one, noBenefit: true }] },
                { id: "stress", label: "Mark a Stress", steps: [markStress()] },
              ],
            },
          ],
        ),
      ],
    }),
  ),
  // Serpent Strike - Reaction: "When a PC within Close range targets the Chimera with an attack, you can mark a Stress to
  // attack the PC first. On a success, deal 4d4+10 physical damage and Poison them until their next rest or they succeed on
  // a Knowledge Roll (20). While Poisoned, the target must roll a d6 before they make an action roll. On a result of 3 or
  // lower, they must mark a Stress."
  entry(
    "chimera",
    "Serpent Strike",
    reaction(
      { kind: "onAttacked", stage: "targeted", attackerWithin: "close" },
      {
        costs: [stress()],
        roll: ATTACK,
        targets: SOURCE,
        steps: [
          hitDamage(dmg(4, 4, 10), "physical"),
          condition(tag("Poisoned"), "rest", "their next rest or a successful Knowledge Roll (20)", ["hit"]),
          { kind: "manual", to: "targets", when: ["hit"], text: "While Poisoned, roll a d6 before each action roll: on 3 or lower, mark a Stress." },
        ],
      },
    ),
  ),

  // ======================================================== Crimson Lepus (HF p.82)
  // Relentless (3) - Passive: "The Lepus can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // it."
  relentless("crimson-lepus", 3),
  // "Awww..." - Passive: "When the Lepus first appears, it is Too Cute. To attack a Too Cute creature, a PC must succeed on
  // an Instinct Reaction Roll (20). Clear the Too Cute condition if a PC deals damage to the Lepus or if the Lepus attacks a
  // PC."
  // Too Cute is a tag on the Lepus; `attacked` makes the attacker roll before the attack (failure: the attack is stopped).
  entry(
    "crimson-lepus",
    "“Awww...”",
    auto({ kind: "timing", at: "appears" }, { id: "appear", steps: [{ kind: "condition", to: "self", condition: TOO_CUTE, duration: "manual", endsWhen: "a PC damages the Lepus or the Lepus attacks a PC" }] }),
    auto(
      { kind: "onAttacked", stage: "targeted" },
      {
        id: "attacked",
        requires: [{ kind: "hasCondition", condition: TOO_CUTE }],
        targets: SOURCE,
        steps: [save("instinct", dc(20), [{ kind: "negate", to: "targets", what: "attack", note: "They can't attack the Too Cute Lepus" }])],
      },
    ),
    auto({ kind: "onDamaged" }, { id: "hurt", requires: [{ kind: "hasCondition", condition: TOO_CUTE }], steps: [{ kind: "clearCondition", to: "self", condition: TOO_CUTE }] }),
    auto({ kind: "onAttack", stage: "before", attack: "any" }, { id: "attacks", requires: [{ kind: "hasCondition", condition: TOO_CUTE }], steps: [{ kind: "clearCondition", to: "self", condition: TOO_CUTE }] }),
  ),
  // Terrifying - Passive: "When the Lepus makes a successful attack, all PCs within Close range lose a Hope, and you gain a
  // Fear."
  terrifying("crimson-lepus"),
  // Leaping Jugular Strike - Action: "Spend a Fear to have the Lepus leap into Melee range of a target within Far range and
  // make an attack against them. On a success, deal 3d20 direct physical damage. If the target marks HP from this attack,
  // they become Vulnerable until they clear a HP."
  // The PC marks HP only when the reaction window resolves, so the Vulnerable rider is a manual step.
  entry(
    "crimson-lepus",
    "Leaping Jugular Strike",
    action({
      costs: [fear()],
      roll: ATTACK,
      targets: enemy("far"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "Leap into Melee range of the target" },
        hitDamage(dmg(3, 20), "physical", true),
        { kind: "manual", to: "targets", when: ["hit"], text: "If the target marks HP from this attack, they become Vulnerable until they clear a HP." },
      ],
    }),
  ),
  // Evasive - Reaction: "When the Lepus would take damage, roll a d6. On a 4 or higher, halve the damage. If the damage was
  // already halved, the Lepus takes no damage."
  // The GM says whether the damage was already halved (resistance, a card); then the fold halves or negates it.
  entry(
    "crimson-lepus",
    "Evasive",
    reaction(
      { kind: "onDamaged", stage: "would" },
      {
        steps: [
          {
            kind: "check",
            dice: diceExpr(1, 6),
            test: { kind: "totalAtLeast", value: 4 },
            then: [
              {
                kind: "choose",
                id: "halved",
                label: "Was the damage already halved?",
                options: [
                  { id: "no", label: "No: halve it", steps: [{ kind: "modifyDamage", to: "self", change: { kind: "halve" } }] },
                  { id: "yes", label: "Yes: no damage", steps: [{ kind: "negate", to: "self", what: "damage" }] },
                ],
              },
            ],
            otherwise: [],
          },
        ],
      },
    ),
  ),
  // "Run Away!" - Reaction: "When a PC with no Hope takes the spotlight within Very Far range of the Lepus, the PC must
  // succeed on a Presence Reaction Roll or use their action to flee the battlefield until they spend a Hope to return."
  entry(
    "crimson-lepus",
    "“Run Away!”",
    reaction(
      { kind: "pcHope", change: "none", within: "veryFar" },
      {
        targets: SUBJECT,
        steps: [
          save("presence", OWN, [
            { kind: "move", to: "targets", mode: "flee", note: "They use their action to flee the battlefield" },
            condition(tag("Fled"), "manual", "they spend a Hope to return"),
          ]),
        ],
      },
    ),
  ),

  // ======================================================== Cryptimoth (HF p.82)
  // Terrifying - Passive: "When the Cryptimoth makes a successful attack, all PCs within Close range lose a Hope, and you
  // gain a Fear."
  terrifying("cryptimoth"),
  // Psychic Screech - Action: "Spend 2 Fear to have the Cryptimoth unleash a burst of psychic energy that causes each PC
  // within Far range to suffer visions of their horrifying fate. Each target must make an Insight Reaction Roll (16). Targets
  // who fail take 3d8 direct magic damage and become Vulnerable until their next rest. Targets who succeed must mark a Stress
  // or take half damage."
  // "Insight" is not a trait (CB p.26); read as Instinct (see QUESTIONS in the task doc).
  entry(
    "cryptimoth",
    "Psychic Screech",
    action({
      costs: [fear(2)],
      targets: enemiesAround("far"),
      steps: [
        save(
          "instinct",
          dc(16),
          [damage(dmg(3, 8), "magic", { direct: true }), condition(std("vulnerable"), "rest", "their next rest")],
          [stressOrHalf("screech", dmg(3, 8), "magic", true)],
        ),
      ],
    }),
  ),
  // Shadow Swarm - Action: "Spend a Fear to have the Cryptimoth conjure a swarm of mothlike shadow creatures within Far range.
  // The swarm fills a Close range area and blocks line of sight. Creatures that aren't Cryptimoths are Vulnerable while inside
  // that area and must mark a Stress to move through it. A PC can dispel the swarm with a successful Spellcast Roll (12)."
  entry(
    "cryptimoth",
    "Shadow Swarm",
    action({
      costs: [fear()],
      steps: [
        manual(
          "A shadow swarm fills a Close area within Far range and blocks line of sight. Non-Cryptimoths inside are Vulnerable and mark a Stress to move through it. A successful Spellcast Roll (12) dispels it.",
          "self",
        ),
      ],
    }),
  ),
  // Paranoia Glare - Action: "Spend a Fear to have the Cryptimoth gaze into the eyes of a PC within Close range and make them
  // Paranoid. While Paranoid, the PC is suspicious of other PCs and can't Help an Ally or take part in Tag Team Rolls. To
  // clear this condition, the PC must succeed on an Insight Roll (16) or participate in the Prepare downtime move with one or
  // more members of their party during a rest."
  entry(
    "cryptimoth",
    "Paranoia Glare",
    action({
      costs: [fear()],
      targets: enemy("close"),
      steps: [
        condition(tag("Paranoid"), "manual", "a successful Instinct (printed Insight) Roll (16), or Prepare with party members during a rest"),
        manual("While Paranoid, the PC can't Help an Ally or take part in Tag Team Rolls."),
      ],
    }),
  ),

  // ======================================================== Cursed Merfolk (HF p.82)
  // Fish-Tailed - Passive: "The Merfolk is Vulnerable out of the water."
  // A passive can't give the adversary a condition (dcm-cdz), so the GM taps when it leaves or returns to the water.
  entry(
    "cursed-merfolk",
    "Fish-Tailed",
    auto({ kind: "situation", text: "The Merfolk is out of the water" }, { id: "leave", steps: [{ kind: "condition", to: "self", condition: std("vulnerable"), duration: "manual", endsWhen: "it returns to the water" }] }),
    auto({ kind: "situation", text: "The Merfolk returns to the water" }, { id: "return", steps: [{ kind: "clearCondition", to: "self", condition: std("vulnerable") }] }),
  ),
  // Gang Up - Passive: "The Merfolk gains a +2 bonus to attack rolls against targets within Melee range of one or more
  // allies."
  entry("cursed-merfolk", "Gang Up", passive([{ kind: "mod", mod: { kind: "stat", stat: "attack", delta: fixed(2) } }], { requires: [{ kind: "allyWithin", range: "melee", of: "target" }] })),
  // "Get Over Here!" - Reaction: "When the Merfolk makes a successful standard attack against a target beyond Melee range,
  // you can mark a Stress to pull them into Melee range. If you do, you can spend a Fear to make a standard attack with
  // advantage against the target."
  // The second attack is an optional Fear step (default No, Q19) with its own roll; it carries the ATK +3 (dcm-vv2).
  entry(
    "cursed-merfolk",
    "“Get Over Here!”",
    reaction(
      { kind: "onHit", attack: "standard", beyond: "melee" },
      {
        costs: [stress()],
        targets: SUBJECT,
        steps: [
          { kind: "move", to: "targets", mode: "pull", range: "melee", relativeTo: "self" },
          {
            kind: "optional",
            id: "attack",
            label: "Spend a Fear for a standard attack with advantage",
            costs: [fear()],
            steps: [{ kind: "followUp", roll: { ...ATTACK, advantage: true, modifier: fixed(3) }, targets: enemy("melee"), steps: [standardHit] }],
          },
        ],
      },
    ),
  ),

  // ======================================================== Deep Dweller (HF p.83)
  // Psychic Blast - Action: "Spend a Fear to choose up to three targets within Close range and force them to make an Instinct
  // or Knowledge Reaction Roll. Targets who succeed mark a Stress. Targets who fail take 3d10+4 direct magic damage and are
  // Vulnerable until spotlighted."
  entry(
    "deep-dweller",
    "Psychic Blast",
    action({
      costs: [fear()],
      targets: enemies("close", 3),
      steps: [save(["instinct", "knowledge"], OWN, [damage(dmg(3, 10, 4), "magic", { direct: true }), condition(std("vulnerable"), "manual", "they are spotlighted")], [markStress()])],
    }),
  ),
  // Brain Drain - Action: "Mark a Stress to choose a Vulnerable PC within Very Close range. The target marks 1d4 Stress, and
  // the Deep Dweller clears an equal number of HP."
  // "An equal number" is the d4 rolled (`lastRoll`).
  entry(
    "deep-dweller",
    "Brain Drain",
    action({
      costs: [stress()],
      targets: enemy("veryClose"),
      steps: [
        { kind: "markStress", to: "targets", when: [has(std("vulnerable"))], amount: rolled(1, 4) },
        { kind: "clear", to: "self", when: [has(std("vulnerable"))], track: "hp", amount: { kind: "lastRoll" } },
      ],
    }),
  ),
  // Call of the Deep - Action: "Spend 2 Fear to summon 1d4 Cursed Merfolk, who appear at Far range and immediately take the
  // spotlight."
  entry(
    "deep-dweller",
    "Call of the Deep",
    action({
      costs: [fear(2)],
      steps: [
        { kind: "summon", label: "Cursed Merfolk", count: rolled(1, 4), adversaryId: "cursed-merfolk", range: "far" },
        { kind: "spotlight", who: "picked", name: "Cursed Merfolk", note: "The summoned Merfolk immediately take the spotlight" },
      ],
    }),
  ),
  // Mucosal Contamination - Action: "Make an attack roll against a PC within Very Close range. On a success, the Deep
  // Dweller uses its tentacles to immobilize the target, sliming them with toxic sludge. The target is Restrained until they
  // break free or slip out with a successful Strength or Finesse Roll. Each time the Deep Dweller is spotlighted, all PCs
  // Restrained in this way take 3d8 direct physical damage. The Deep Dweller releases all creatures Restrained by it when
  // it's defeated or takes Severe damage."
  entry(
    "deep-dweller",
    "Mucosal Contamination",
    action({ roll: ATTACK, targets: enemy("veryClose"), steps: [condition(tag("Slimed", ["restrained"]), "manual", "a successful Strength or Finesse Roll, or the Deep Dweller is defeated or takes Severe damage", ["hit"])] }),
    auto({ kind: "onSpotlight" }, { id: "spotlight", targets: anyEnemy, steps: [{ kind: "damage", to: "targets", when: [has(tag("Slimed"))], roll: dmg(3, 8), type: "physical", direct: true }] }),
    releaseOnMajor(tag("Slimed"), "severe", true),
    { ...releaseOnMajor(tag("Slimed"), "severe", true), id: "defeated", activation: { kind: "auto", trigger: { kind: "onDefeated" } } },
  ),

  // ======================================================== Drake (HF p.83)
  // Relentless (2) - Passive: "The Drake can be spotlighted up to two times per GM turn. Spend Fear as usual to spotlight
  // it."
  relentless("drake", 2),
  // Guard Dog - Reaction: "When a PC would deal damage to a creature within Close range, you can mark a Stress to have the
  // Drake move to intercept the attack and take the damage instead. If the attacker is within Melee range of the Drake's new
  // position, you can immediately spotlight the Drake without spending Fear."
  // No trigger for "would deal damage to another creature": a GM button (dcm-2gn).
  entry(
    "drake",
    "Guard Dog",
    reaction(
      { kind: "situation", text: "A PC would deal damage to a creature within Close range of the Drake" },
      {
        costs: [stress()],
        steps: [
          { kind: "move", to: "self", mode: "move", note: "Move to intercept the attack" },
          { kind: "redirectDamage", to: "self", target: "self", note: "The Drake takes the damage instead" },
          {
            kind: "optional",
            id: "spotlight",
            label: "Spotlight the Drake without spending Fear",
            when: [situationGate("The attacker is within Melee range of the Drake's new position")],
            steps: [{ kind: "spotlight", who: "self" }],
          },
        ],
      },
    ),
  ),

  // ======================================================== Dullahan (HF p.83)
  // Specter - Passive: "The Dullahan has resistance to physical damage. Mark a Stress to move up to Close range through solid
  // objects."
  specter("dullahan"),
  // Spectral Mount - Passive: "While atop their steed, the Dullahan can move up to Far range instead of Close range before
  // taking an action. If the Dullahan is unhorsed, their mount disappears until you mark a Stress to summon it again. The
  // Dullahan is Vulnerable while not on their horse."
  // Unhorsed is a tag plus Vulnerable; summoning the mount clears both. Like the Doppelhound's conjure (t2-hf), the summon
  // needs no spotlight.
  entry(
    "dullahan",
    "Spectral Mount",
    auto({ kind: "onSpotlight" }, { id: "ride", steps: [{ kind: "move", to: "self", mode: "move", range: "far", note: "While atop its steed (not Unhorsed), it can move up to Far range before acting" }] }),
    auto(
      { kind: "situation", text: "The Dullahan is unhorsed" },
      {
        id: "unhorsed",
        steps: [
          { kind: "condition", to: "self", condition: tag("Unhorsed"), duration: "manual", endsWhen: "you mark a Stress to summon the mount" },
          { kind: "condition", to: "self", condition: std("vulnerable"), duration: "manual", endsWhen: "it is back on its horse" },
        ],
      },
    ),
    {
      id: "summon",
      activation: { kind: "action" },
      needsSpotlight: false,
      requires: [{ kind: "hasCondition", condition: tag("Unhorsed") }],
      costs: [stress()],
      steps: [
        { kind: "clearCondition", to: "self", condition: tag("Unhorsed") },
        { kind: "clearCondition", to: "self", condition: std("vulnerable") },
      ],
    },
  ),
  // Bone Whip Strike - Action: "Mark a Stress to make an attack against a target within Melee range. On a success, the target
  // takes 4d4+10 direct physical damage and is Vulnerable until they clear a HP."
  entry(
    "dullahan",
    "Bone Whip Strike",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("melee"), steps: [hitDamage(dmg(4, 4, 10), "physical", true), condition(std("vulnerable"), "manual", "they clear a HP", ["hit"])] }),
  ),
  // Death Glare - Action: "Spend a Fear to choose a PC within Far range. The target must make an Presence Reaction Roll (19).
  // On a success, they mark a Stress. On a failure, they mark a HP and activate a Doom Countdown (4). It ticks down when the
  // Dullahan is spotlighted. When it triggers, the target makes a death move. If the Dullahan is defeated or the PCs take a
  // rest, all Doom Countdowns end."
  entry(
    "dullahan",
    "Death Glare",
    action({
      costs: [fear()],
      targets: enemy("far"),
      steps: [
        save(
          "presence",
          dc(19),
          [
            { kind: "markHp", to: "targets", amount: one },
            { kind: "countdown", op: "start", label: "Doom Countdown", start: fixed(4), onTrigger: "The target makes a death move.", note: "Ends if the Dullahan is defeated or the PCs take a rest" },
          ],
          [markStress()],
        ),
      ],
    }),
    auto({ kind: "onSpotlight" }, { id: "tick", steps: [{ kind: "countdown", op: "tick", label: "Doom Countdown", note: "Every Doom Countdown ticks down" }] }),
    auto({ kind: "onDefeated" }, { id: "end", steps: [{ kind: "countdown", op: "prompt", label: "Doom Countdown", note: "All Doom Countdowns end" }] }),
  ),

  // ======================================================== Fellmounted Shadow King (HF p.83)
  // Fellmount - Passive: "While the Shadow King is on his mount, he gains a +2 bonus to his Difficulty. When the Shadow King
  // takes Severe damage, he's knocked from his mount. If the Shadow King is unmounted, his mount disappears until you mark a
  // Stress to summon it again."
  // "On his mount" is a situation the GM confirms (as Knight of the Realm, t2-core); Severe damage asks the GM to unconfirm
  // it; the summon needs no spotlight (as Spectral Mount).
  entry(
    "fellmounted-shadow-king",
    "Fellmount",
    passive([{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(2) } }], { requires: [{ kind: "situation", text: "The Shadow King is on his mount" }] }),
    auto(
      { kind: "onDamaged", minSeverity: "severe" },
      {
        id: "knocked",
        steps: [
          { kind: "condition", to: "self", condition: tag("Unmounted"), duration: "manual", endsWhen: "you mark a Stress to summon the mount" },
          manual("He is knocked from his mount and it disappears: he is no longer on his mount.", "self"),
        ],
      },
    ),
    { id: "summon", activation: { kind: "action" }, needsSpotlight: false, requires: [{ kind: "hasCondition", condition: tag("Unmounted") }], costs: [stress()], steps: [{ kind: "clearCondition", to: "self", condition: tag("Unmounted") }] },
  ),
  // Light and Shadow - Passive: "The Shadow King has advantage on attack rolls while in shadow or darkness and disadvantage on
  // attack rolls while in bright light."
  // No modifier for disadvantage on its own attacks: a reminder before each attack in bright light.
  entry(
    "fellmounted-shadow-king",
    "Light and Shadow",
    passive([{ kind: "mod", mod: { kind: "advantage", on: "attack" } }], { id: "shadow", requires: [{ kind: "situation", text: "The Shadow King is in shadow or darkness" }] }),
    auto({ kind: "onAttack", stage: "before", attack: "any" }, { id: "light", requires: [{ kind: "situation", text: "The Shadow King is in bright light" }], steps: [manual("This attack roll is made with disadvantage (bright light).", "self")] }),
  ),
  // Relic Hunter - Passive: "The Shadow King has advantage on attack rolls against PCs who have magic weapons or armor
  // equipped."
  entry(
    "fellmounted-shadow-king",
    "Relic Hunter",
    passive([{ kind: "mod", mod: { kind: "advantage", on: "attack" } }], { requires: [{ kind: "situation", text: "The target has magic weapons or armor equipped" }] }),
  ),
  // Hellsong - Action: "Spend 2 Fear to have the Shadow King's mount unleash a spine-chilling screech that echoes over the
  // battlefield. Each PC within Far range must make a Presence Reaction Roll (18). Targets who succeed must mark a Stress.
  // Targets who fail must mark a Stress and lose a Hope. If a PC can't lose a Hope, you gain 2 Fear."
  entry(
    "fellmounted-shadow-king",
    "Hellsong",
    action({
      costs: [fear(2)],
      targets: enemiesAround("far"),
      steps: [save("presence", dc(18), [markStress(), { kind: "hope", to: "targets", change: "lose", amount: one }, manual("If this PC can't lose a Hope, you gain 2 Fear.")], [markStress()])],
    }),
  ),
  // Air Support - Reaction: "Three times per scene, you can spend a Fear to have an ally within Far range reroll a failed
  // attack with advantage."
  entry(
    "fellmounted-shadow-king",
    "Air Support",
    reaction(
      { kind: "situation", text: "An ally within Far range fails an attack" },
      {
        limit: { per: "scene", times: 3 },
        costs: [fear()],
        steps: [{ kind: "modifyRoll", to: "picked", pick: { side: "ally", range: "far", count: { kind: "one" } }, change: { kind: "reroll", dice: "all" }, note: "Reroll the failed attack with advantage" }],
      },
    ),
  ),

  // ======================================================== Fire Titan (HF p.84)
  // Relentless (3) - Passive: "The Titan can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // them."
  relentless("fire-titan", 3),
  // Masterwork Armor - Passive (Countdown (3)): "When the Titan first appears, activate the countdown. It ticks down when the
  // Titan takes Major or Severe damage. Until the countdown triggers, reduce incoming damage by 1d12. When it triggers, the
  // Titan gains a +1 bonus to their Difficulty and attack rolls."
  // The armor's state is a tag: "Masterwork Armor" while it holds (1d12 off every hit), "Armor Broken" once it triggers.
  entry(
    "fire-titan",
    "Masterwork Armor",
    auto(
      { kind: "timing", at: "appears" },
      {
        id: "start",
        steps: [
          { kind: "countdown", op: "start", label: "Masterwork Armor", start: fixed(3), onTrigger: "The armor breaks: +1 to the Titan's Difficulty and attack rolls." },
          { kind: "condition", to: "self", condition: tag("Masterwork Armor"), duration: "manual", endsWhen: "the countdown triggers" },
        ],
      },
    ),
    auto({ kind: "onDamaged", minSeverity: "major" }, { id: "tick", requires: [{ kind: "hasCondition", condition: tag("Masterwork Armor") }], steps: [{ kind: "countdown", op: "tick", label: "Masterwork Armor" }] }),
    auto({ kind: "onDamaged", stage: "would" }, { id: "armor", requires: [{ kind: "hasCondition", condition: tag("Masterwork Armor") }], steps: [{ kind: "reduceDamage", to: "self", amount: rolled(1, 12) }] }),
    auto(
      { kind: "situation", text: "The Masterwork Armor countdown triggers" },
      {
        id: "triggered",
        steps: [
          { kind: "clearCondition", to: "self", condition: tag("Masterwork Armor") },
          { kind: "condition", to: "self", condition: tag("Armor Broken"), duration: "scene" },
        ],
      },
    ),
    passive(
      [
        { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: one } },
        { kind: "mod", mod: { kind: "stat", stat: "attack", delta: one } },
      ],
      { id: "broken", requires: [{ kind: "hasCondition", condition: tag("Armor Broken") }] },
    ),
  ),
  // Momentum - Passive: "When the Titan makes a successful attack against a PC, you gain a Fear."
  momentum("fire-titan"),
  // Hurl Rock - Action: "Mark a Stress to choose a point within Far range, then make an attack against all targets between
  // the Titan and that point. Targets the Titan succeeds against take 3d12 physical damage."
  entry(
    "fire-titan",
    "Hurl Rock",
    action({ costs: [stress()], roll: ATTACK, targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "between" }, steps: [hitDamage(dmg(3, 12), "physical")] }),
  ),
  // Skull Splitter - Action: "Mark a Stress to place a token on this stat block. The next time the Titan is spotlighted, you
  // must spend the token from this stat block and make an attack against a PC within Close range. On a success, deal 3d20+5
  // direct physical damage. On a failure, the target marks a Stress."
  entry(
    "fire-titan",
    "Skull Splitter",
    action({ id: "prepare", costs: [stress()], steps: [{ kind: "tokens", to: "self", op: "add", amount: one }] }),
    auto(
      { kind: "onSpotlight" },
      {
        id: "strike",
        requires: [{ kind: "tokens", atLeast: 1 }],
        roll: ATTACK,
        targets: enemy("close"),
        steps: [
          { kind: "tokens", to: "self", op: "spend", amount: one },
          hitDamage(dmg(3, 20, 5), "physical", true),
          { kind: "markStress", to: "targets", when: ["miss"], amount: one },
        ],
      },
    ),
  ),
  // Blazing Heart - Reaction: "When the Titan marks half or more of their HP, you can spend a Fear and mark any number of
  // Stress to clear a number of HP equal to the number of Stress marked."
  entry(
    "fire-titan",
    "Blazing Heart",
    reaction({ kind: "onHpMarkedAtLeast", value: "half" }, { costs: [fear()], steps: [anyStress("heart", "Mark how many Stress?", 5, (n) => [{ kind: "clear", to: "self", track: "hp", amount: fixed(n) }])] }),
  ),

  // ======================================================== Frost Titan (HF p.84)
  // Relentless (2) - Passive: "The Titan can be spotlighted up to two times per GM turn. Spend Fear as usual to spotlight
  // them."
  relentless("frost-titan", 2),
  // War Horn - Action: "Mark a Stress to force each PC within Far range to succeed on a Presence Reaction Roll or mark a
  // Stress and become Vulnerable until after the next attack against them."
  entry(
    "frost-titan",
    "War Horn",
    action({ costs: [stress()], targets: enemiesAround("far"), steps: [save("presence", OWN, [markStress(), condition(std("vulnerable"), "hit", "after the next attack against them")])] }),
  ),
  // Bull Rush - Action: "Mark a Stress to move up to Close range and make an attack roll against a target within Melee range.
  // On a success, deal 4d10+2 physical damage and knock the target back to Close range."
  entry(
    "frost-titan",
    "Bull Rush",
    action({
      costs: [stress()],
      roll: ATTACK,
      targets: enemy("melee"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close", note: "Move up to Close range before the attack" },
        hitDamage(dmg(4, 10, 2), "physical"),
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "close" },
      ],
    }),
  ),
  // Cleaving Strike - Reaction: "When a PC marks HP from the Titan's standard attack, you can mark a Stress to force another
  // PC within Very Close range who the attack would have succeeded against to mark the same number of HP."
  // The trigger's amount is the HP marked; the GM picks a PC whose Evasion the attack roll met.
  entry(
    "frost-titan",
    "Cleaving Strike",
    reaction(
      { kind: "onTargetMarksHp", attack: "standard" },
      {
        costs: [stress()],
        steps: [{ kind: "markHp", to: "picked", pick: { side: "enemy", range: "veryClose", count: { kind: "one" }, excludeSelf: true }, amount: { kind: "triggerAmount" }, note: "Another PC the attack roll would have hit" }],
      },
    ),
  ),
  // Trophy Hunter - Reaction: "When the Titan defeats a PC, the Titan takes the PC's most valuable possession as a trophy."
  entry("frost-titan", "Trophy Hunter", reaction({ kind: "onDefeatPc" }, { targets: SUBJECT, steps: [manual("The Titan takes the PC's most valuable possession as a trophy.")] })),

  // ======================================================== Gargantuan Sea Turtle (HF p.84)
  // Relentless (3) - Passive: "The Turtle can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // it."
  relentless("gargantuan-sea-turtle", 3),
  // Piercing Bite - Passive: "When the Turtle makes a successful standard attack against a PC, the PC must either mark an
  // Armor Slot without receiving its benefit or take double damage."
  // The hit PC's choice; both options are folds on the open hit (the forced slot, or doubled damage).
  entry(
    "gargantuan-sea-turtle",
    "Piercing Bite",
    auto(
      { kind: "onHit", attack: "standard" },
      {
        targets: SUBJECT,
        steps: [
          {
            kind: "choose",
            id: "bite",
            label: "Mark an Armor Slot without its benefit, or take double damage",
            options: [
              { id: "armor", label: "Mark an Armor Slot (no benefit)", steps: [{ kind: "markArmor", to: "targets", amount: one, noBenefit: true }] },
              { id: "double", label: "Take double damage", steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "multiply", factor: 2 } }] },
            ],
          },
        ],
      },
    ),
  ),
  // Tail Bash - Action: "Mark a Stress to make a standard attack against all PCs behind the Turtle within Very Close range. On
  // a success, a target takes an extra 1d12 physical damage and is pushed away from the Turtle to Close range."
  entry(
    "gargantuan-sea-turtle",
    "Tail Bash",
    action({
      costs: [stress()],
      roll: ATTACK,
      targets: { side: "enemy", range: "veryClose", count: { kind: "all" } },
      steps: [
        standardHit,
        { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: rolled(1, 12) } },
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "close", note: "Pushed away from the Turtle to Close range" },
      ],
    }),
  ),
  // Gigaton Splash - Action: "Spend a Fear to have the Turtle use its weight to unleash an unstoppable wall of water that
  // targets all creatures within Far range. Each PC must make a Strength Reaction Roll to navigate the tide. Targets who fail
  // are pushed away from the Turtle to Close range, take 4d8 physical damage, and become temporarily Vulnerable. Targets who
  // succeed must mark a Stress. For each target who failed, you gain a Fear."
  entry(
    "gargantuan-sea-turtle",
    "Gigaton Splash",
    action({
      costs: [fear()],
      targets: enemiesAround("far"),
      steps: [
        save(
          "strength",
          OWN,
          [{ kind: "move", to: "targets", mode: "knockBack", range: "close" }, damage(dmg(4, 8), "physical"), condition(std("vulnerable"), "temporary"), gainFear()],
          [markStress()],
        ),
      ],
    }),
  ),
  // Steam Breath - Action: "Spend 2 Fear to have the Turtle release a blast of superheated steam targeting all PCs in front of
  // it within Close range. Each target must make an Agility Reaction Roll. Targets who fail take 4d8 magic damage and become
  // temporarily Vulnerable. Targets who succeed must choose to either mark a Stress or take half damage."
  entry(
    "gargantuan-sea-turtle",
    "Steam Breath",
    action({
      costs: [fear(2)],
      targets: enemiesFront("close"),
      steps: [save("agility", OWN, [damage(dmg(4, 8), "magic"), condition(std("vulnerable"), "temporary")], [stressOrHalf("steam", dmg(4, 8), "magic")])],
    }),
  ),

  // ======================================================== Lamia (HF p.84)
  // Constriction - Action: "Mark a Stress to have the Lamia wrap their tail around a PC within Melee range and squeeze. The
  // target must succeed on a Finesse Reaction Roll or become Constricted until the Lamia moves or takes Major or greater
  // damage. While Constricted, the target is Restrained and must mark a Stress when the Lamia takes the spotlight."
  entry(
    "lamia",
    "Constriction",
    action({ costs: [stress()], targets: enemy("melee"), steps: [save("finesse", OWN, [condition(tag("Constricted", ["restrained"]), "manual", "the Lamia moves or takes Major or greater damage")])] }),
    auto({ kind: "onSpotlight" }, { id: "squeeze", targets: anyEnemy, steps: [{ kind: "markStress", to: "targets", when: [has(tag("Constricted"))], amount: one }] }),
    releaseOnMajor(tag("Constricted"), "major", true),
  ),
  // Life Leech - Action: "Mark a Stress to force a Vulnerable or Restrained target within Melee range to mark 1d4−1 HP. The
  // Lamia then clears an equal number of HP."
  // Gates can't say "or": the GM picks which condition the target has; "an equal number" is the roll (`lastRoll`).
  entry(
    "lamia",
    "Life Leech",
    action({
      costs: [stress()],
      targets: enemy("melee"),
      steps: [
        {
          kind: "choose",
          id: "leech",
          label: "The target is Vulnerable or Restrained",
          options: (["vulnerable", "restrained"] as const).map(
            (c): AdversaryChooseOption => ({
              id: c,
              label: c === "vulnerable" ? "Vulnerable" : "Restrained",
              steps: [
                { kind: "markHp", to: "targets", when: [has(std(c))], amount: rolled(1, 4, -1) },
                { kind: "clear", to: "self", when: [has(std(c))], track: "hp", amount: { kind: "lastRoll" } },
              ],
            }),
          ),
        },
      ],
    }),
  ),
  // Sleep Toxin - Reaction: "When the Lamia makes a successful standard attack against a PC, you can spend a Fear to make them
  // Vulnerable until they succeed on a Instinct Roll (19)."
  entry(
    "lamia",
    "Sleep Toxin",
    reaction({ kind: "onHit", attack: "standard" }, { costs: [fear()], targets: SUBJECT, steps: [condition(std("vulnerable"), "manual", "they succeed on an Instinct Roll (19)")] }),
  ),

  // ======================================================== Lamplight Beguiler (HF p.85)
  // Doppel-Dangler - Action: "The membranous cluster at the end of the Beguiler's head stalk can shapeshift into any humanoid
  // form. Mark a Stress to choose a PC within Close range. Their player must tell you who their PC would find most
  // trustworthy. The Beguiler's head stalk transforms into that person and gains the ability to speak in their voice."
  entry(
    "lamplight-beguiler",
    "Doppel-Dangler",
    action({
      costs: [stress()],
      targets: enemy("close"),
      steps: [
        { kind: "condition", to: "self", condition: tag("Trusted Form"), duration: "manual", endsWhen: "the head stalk changes form" },
        manual("Their player tells you who their PC would find most trustworthy; the head stalk takes that form and speaks in their voice."),
      ],
    }),
  ),
  // Entice - Action: "Spend a Fear to have the Beguiler make an alluring overture to a PC within Close range. The PC must
  // succeed on a Presence Reaction Roll (18) or move into Melee range with the Beguiler. If the Beguiler's head stalk is
  // transformed into a person the PC would find trustworthy, they have disadvantage on the reaction roll."
  entry(
    "lamplight-beguiler",
    "Entice",
    action({
      costs: [fear()],
      targets: enemy("close"),
      steps: [
        manual("If the head stalk is in the form this PC finds trustworthy (Doppel-Dangler), they roll with disadvantage."),
        save("presence", dc(18), [{ kind: "move", to: "targets", mode: "pull", range: "melee", relativeTo: "self", note: "They move into Melee range with the Beguiler" }]),
      ],
    }),
  ),
  // Gulp - Reaction: "When a PC moves within Melee range, you can spend a Fear to make an attack roll against them. On a
  // successful attack, the target takes 3d6 physical damage and is Swallowed. While Swallowed, the target is Restrained and
  // takes 3d6 physical damage when the Beguiler takes the spotlight. The Beguiler disgorges all Swallowed creatures when it
  // takes Major or Severe damage."
  entry(
    "lamplight-beguiler",
    "Gulp",
    reaction(
      { kind: "pcMoves", into: "melee" },
      {
        costs: [fear()],
        roll: ATTACK,
        targets: SUBJECT,
        steps: [hitDamage(dmg(3, 6), "physical"), condition(SWALLOWED, "manual", "the Beguiler takes Major or Severe damage", ["hit"])],
      },
    ),
    ...swallowedUses({ kind: "damage", to: "targets", when: [has(SWALLOWED)], roll: dmg(3, 6), type: "physical" }),
  ),

  // ======================================================== Manticore (HF p.85)
  // Relentless (3) - Passive: "The Manticore can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight them."
  relentless("manticore", 3),
  // Riddle Me This - Passive: "The Manticore is obsessed with puzzles and can be distracted by brain teasers, word games, or
  // other semi-intellectual diversions."
  entry("manticore", "Riddle Me This", reminder("The Manticore can be distracted by brain teasers, word games, or other semi-intellectual diversions.")),
  // Winged - Passive: "While airborne, the Manticore gains a +2 bonus to their Difficulty and attack rolls."
  entry(
    "manticore",
    "Winged",
    passive(
      [
        { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(2) } },
        { kind: "mod", mod: { kind: "stat", stat: "attack", delta: fixed(2) } },
      ],
      { requires: [{ kind: "situation", text: "The Manticore is airborne" }] },
    ),
  ),
  // Pouncing Attack - Action: "Spend a Fear to have the Manticore pounce into Melee range of a target within Far range and
  // make an attack against them. On a success, deal 3d20+6 physical damage, and the target becomes Shaky until they spend a
  // Hope. While Shaky, the target makes attack rolls with disadvantage."
  entry(
    "manticore",
    "Pouncing Attack",
    action({
      costs: [fear()],
      roll: ATTACK,
      targets: enemy("far"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "Pounce into Melee range of the target" },
        hitDamage(dmg(3, 20, 6), "physical"),
        condition(tag("Shaky"), "manual", "they spend a Hope", ["hit"]),
        { kind: "manual", to: "targets", when: ["hit"], text: "While Shaky, the target makes attack rolls with disadvantage." },
      ],
    }),
  ),
  // Paralyzing Tail Spike - Action: "Mark a Stress to make an attack roll against a target within Close range. On a success,
  // the target takes 3d8 physical damage and becomes Restrained until they overcome the toxin with a successful Strength
  // Roll."
  entry(
    "manticore",
    "Paralyzing Tail Spike",
    action({ costs: [stress()], roll: ATTACK, targets: enemy("close"), steps: [hitDamage(dmg(3, 8), "physical"), condition(std("restrained"), "manual", "a successful Strength Roll", ["hit"])] }),
  ),
  // Locking Jaws - Reaction: "When the Manticore succeeds on a standard attack against a target within Melee range, you can
  // mark a Stress to lock their jaws onto the target, making the target Restrained and Vulnerable until they escape with a
  // successful Strength Roll (19)."
  entry(
    "manticore",
    "Locking Jaws",
    reaction(
      { kind: "onHit", attack: "standard", within: "melee" },
      {
        costs: [stress()],
        targets: SUBJECT,
        steps: [condition(std("restrained"), "manual", "a successful Strength Roll (19)"), condition(std("vulnerable"), "manual", "a successful Strength Roll (19)")],
      },
    ),
  ),

  // ======================================================== Night Children (HF p.85)
  // Horde (2d6+2) - Passive: "When the Night Children have marked half or more of their HP, their standard attack deals 2d6+2
  // physical damage instead."
  entry("night-children", "Horde (2d6+2)", passive([{ kind: "horde", damage: hordeDice(2, 6, 2) }])),
  // Swell Ranks - Action: "Once per scene, mark any number of Stress to have the Night Children open a portal that spews
  // forth reinforcements, refilling the Horde's ranks. Clear a number of HP equal to the number of Stress marked."
  entry(
    "night-children",
    "Swell Ranks",
    action({ limit: { per: "scene" }, steps: [anyStress("ranks", "Mark how many Stress?", 4, (n) => [{ kind: "clear", to: "self", track: "hp", amount: fixed(n) }])] }),
  ),
  // Overwhelm - Reaction: "When the Night Children mark HP from an attack within Melee range, you can mark a Stress to make a
  // standard attack against the attacker."
  entry(
    "night-children",
    "Overwhelm",
    reaction({ kind: "onMarkHp", fromAttack: true, attackerWithin: "melee" }, { costs: [stress()], roll: ATTACK, targets: SOURCE, steps: [standardHit] }),
  ),

  // ======================================================== Pain Priest (HF p.86)
  // Walk Between Worlds - Action: "Mark a Stress to place the Priest anywhere within Very Far range and immediately spotlight
  // them again."
  entry(
    "pain-priest",
    "Walk Between Worlds",
    action({ costs: [stress()], steps: [{ kind: "move", to: "self", mode: "teleport", range: "veryFar" }, { kind: "spotlight", who: "self", note: "Spotlight the Priest again" }] }),
  ),
  // Pleasure and Pain - Reaction: "When a PC within Close range of the Priest gains a Hope or marks HP, roll a d8. On a result
  // of 8, the Priest opens a portal to their original dimension and flees there with the closest party member. You gain 1d6
  // Fear. The portal remains open until the Priest is defeated or spotlighted again."
  // Two triggers, the same roll.
  entry(
    "pain-priest",
    "Pleasure and Pain",
    ...(
      [
        ["hope", { kind: "pcHope", change: "gain", within: "close" }],
        ["hp", { kind: "pcMarksHp", within: "close" }],
      ] as const
    ).map(([id, trigger]) =>
      reaction(trigger, {
        id,
        steps: [
          {
            kind: "check",
            dice: diceExpr(1, 8),
            test: { kind: "totalAtLeast", value: 8 },
            then: [
              manual("The Priest opens a portal to their original dimension and flees there with the closest party member. The portal stays open until the Priest is defeated or spotlighted again.", "self"),
              gainFear(rolled(1, 6)),
            ],
            otherwise: [],
          },
        ],
      }),
    ),
  ),

  // ======================================================== Phoenix (HF p.86)
  // Purifying Aura - Passive: "Any PC who takes an action within the Phoenix's Melee range can spend a Hope to purify themself
  // in its healing warmth, clearing a HP or a Stress and all conditions."
  // The PC's choice, offered when they act within Melee range.
  entry(
    "phoenix",
    "Purifying Aura",
    reaction(
      { kind: "pcRolls", roll: "action", within: "melee" },
      {
        targets: SUBJECT,
        steps: [
          {
            kind: "choose",
            id: "purify",
            label: "Spend a Hope: clear a HP or a Stress, and all conditions",
            options: (["hp", "stress"] as const).map(
              (track): AdversaryChooseOption => ({
                id: track,
                label: track === "hp" ? "Clear a HP" : "Clear a Stress",
                steps: [
                  { kind: "hope", to: "targets", change: "lose", amount: one, note: "The PC spends a Hope" },
                  { kind: "clear", to: "targets", track, amount: one },
                  { kind: "clearCondition", to: "targets", condition: std("vulnerable") },
                  { kind: "clearCondition", to: "targets", condition: std("restrained") },
                  manual("They also clear every other condition they have."),
                ],
              }),
            ),
          },
        ],
      },
    ),
  ),
  // Fireseed - Reaction: "The Phoenix bleeds magic fire. When the Phoenix marks a HP, summon one Minor Fire Elemental within
  // Very Close range."
  entry(
    "phoenix",
    "Fireseed",
    reaction({ kind: "onMarkHp" }, { steps: [{ kind: "summon", label: "Minor Fire Elemental", count: one, adversaryId: "minor-fire-elemental", range: "veryClose" }] }),
  ),
  // Resurrection - Evolution: "When the Phoenix is defeated, it becomes a cloud of ash that blows away to reveal a Smoldering
  // Egg. The Egg is immune to all damage and has a heat aura that deals 3d4 direct magic damage to anyone who touches it. The
  // Egg hatches into a new Phoenix, with all HP and Stress cleared, in 7 days."
  // The Egg is the same instance with a tag (orchestrator note, CA2): immune while tagged, `touch` is the GM's button.
  entry(
    "phoenix",
    "Resurrection",
    auto(
      { kind: "onDefeated" },
      {
        id: "egg",
        steps: [
          { kind: "condition", to: "self", condition: tag("Smoldering Egg"), duration: "manual", endsWhen: "it hatches in 7 days" },
          manual("The Egg hatches into a new Phoenix, with all HP and Stress cleared, in 7 days.", "self"),
        ],
      },
    ),
    resistance("both", "immune", { id: "immune", requires: [{ kind: "hasCondition", condition: tag("Smoldering Egg") }] }),
    reaction(
      { kind: "situation", text: "A creature touches the Smoldering Egg" },
      { id: "touch", requires: [{ kind: "hasCondition", condition: tag("Smoldering Egg") }], targets: { side: "any", range: "melee", count: { kind: "one" } }, steps: [damage(dmg(3, 4), "magic", { direct: true })] },
    ),
  ),

  // ======================================================== Plesiosaurus (HF p.86)
  // Only a Rumor - Passive: "While deep underwater, the Plesiosaurus can't be located or targeted."
  entry(
    "plesiosaurus",
    "Only a Rumor",
    passive([{ kind: "mod", mod: { kind: "flag", flag: "cannotBeTargeted" } }], { requires: [{ kind: "situation", text: "The Plesiosaurus is deep underwater" }] }),
  ),
  // Wall of Water - Action: "Mark a Stress to have the Plesiosaurus breach and crash, sending a wall of water from one side of
  // its body. Each PC within Far range on that side of the Plesiosaurus must succeed on an Agility Reaction Roll (18) or take
  // 3d10 physical damage and be pushed back to Far range."
  entry(
    "plesiosaurus",
    "Wall of Water",
    action({ costs: [stress()], targets: enemiesFront("far"), steps: [save("agility", dc(18), [damage(dmg(3, 10), "physical"), { kind: "move", to: "targets", mode: "knockBack", range: "far" }])] }),
  ),

  // ======================================================== Roc (HF p.86)
  // Relentless (3) - Passive: "The Roc can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight it."
  relentless("roc", 3),
  // Bird of Prey - Passive: "Once per GM turn, the Roc can move up to Very Far range before or after it takes an action."
  entry("roc", "Bird of Prey", auto({ kind: "onSpotlight" }, { steps: [{ kind: "move", to: "self", mode: "move", range: "veryFar", note: "Once per GM turn, before or after its action" }] })),
  // Here Comes the Boom - Action: "Spend a Fear to have the Roc unleash a storm of lightning and thunder. Make an attack roll
  // against 1d4+1 targets within Far range. Targets the Roc succeeds against take 3d12 magic damage. Then each target within
  // Far range of the Roc must make an Agility Reaction Roll (20). Targets who fail take 3d8 physical damage and are pushed
  // back to Close range. Targets who succeed must mark a Stress."
  // The 1d4+1 is rolled first (it bounds the targets); the reaction roll goes to everyone within Far (`picked`).
  entry(
    "roc",
    "Here Comes the Boom",
    action({
      costs: [fear()],
      roll: ATTACK,
      targets: { side: "enemy", range: "far", count: { kind: "upTo", n: rolled(1, 4, 1) } },
      steps: [
        hitDamage(dmg(3, 12), "magic"),
        {
          kind: "save",
          to: "picked",
          pick: enemiesAround("far"),
          trait: "agility",
          difficulty: dc(20),
          onFail: [damage(dmg(3, 8), "physical"), { kind: "move", to: "targets", mode: "knockBack", range: "close" }],
          onSuccess: [markStress()],
        },
      ],
    }),
  ),
  // Crushing Grasp - Reaction: "When the Roc makes a successful standard attack, you can mark a Stress to have the Roc crush
  // the target with its talons, forcing them to mark 1d4 Stress and Restraining them until they succeed on a Strength Roll
  // (20)."
  entry(
    "roc",
    "Crushing Grasp",
    reaction({ kind: "onHit", attack: "standard" }, { costs: [stress()], targets: SUBJECT, steps: [markStress(rolled(1, 4)), condition(std("restrained"), "manual", "they succeed on a Strength Roll (20)")] }),
  ),
  // Nest Warden - Evolution: "When the Roc's eggs are threatened, it gains the following features:" (Wrathful, Electrifying
  // Aura). The GM's button tags the Roc; both features require the tag.
  entry(
    "roc",
    "Nest Warden",
    reaction({ kind: "situation", text: "The Roc's eggs are threatened" }, { steps: [{ kind: "condition", to: "self", condition: NEST_WARDEN, duration: "manual", endsWhen: "its eggs are safe" }] }),
  ),
  // Wrathful - Passive: "The Roc gains a +2 bonus to its Difficulty and a bonus to damage rolls equal to the number of Stress
  // it has marked."
  entry(
    "roc",
    "Wrathful",
    passive(
      [
        { kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: fixed(2) } },
        { kind: "attackDamage", add: { kind: "marked", who: "self", track: "stress" } },
      ],
      { requires: [{ kind: "hasCondition", condition: NEST_WARDEN }] },
    ),
  ),
  // Electrifying Aura - Passive: "The Roc has resistance to magic damage. PCs who fail a roll within Very Close range must
  // spend a Hope or mark 1d4 Stress."
  entry(
    "roc",
    "Electrifying Aura",
    resistance("magic", "resistant", { requires: [{ kind: "hasCondition", condition: NEST_WARDEN }] }),
    auto(
      { kind: "pcRolls", result: "failure", within: "veryClose" },
      {
        id: "shock",
        requires: [{ kind: "hasCondition", condition: NEST_WARDEN }],
        targets: SUBJECT,
        steps: [
          {
            kind: "choose",
            id: "shock",
            label: "Spend a Hope or mark 1d4 Stress",
            options: [
              { id: "hope", label: "Spend a Hope", steps: [{ kind: "hope", to: "targets", change: "lose", amount: one }] },
              { id: "stress", label: "Mark 1d4 Stress", steps: [markStress(rolled(1, 4))] },
            ],
          },
        ],
      },
    ),
  ),

  // ======================================================== Sandwyrm (HF p.87)
  // Venomous Tail Stinger - Action: "Mark a Stress to attack a target within Close range. On a success, the target takes
  // 3d10+2 physical damage and must succeed on a Strength Reaction Roll or become Restrained and Vulnerable until they roll
  // with Hope."
  entry(
    "sandwyrm",
    "Venomous Tail Stinger",
    action({
      costs: [stress()],
      roll: ATTACK,
      targets: enemy("close"),
      steps: [
        hitDamage(dmg(3, 10, 2), "physical"),
        save("strength", OWN, [condition(std("restrained"), "manual", "they roll with Hope"), condition(std("vulnerable"), "manual", "they roll with Hope")], [], ["hit"]),
      ],
    }),
  ),
  // Devour - Action: "Make an attack against a target within Melee range. On a success, the Sandwyrm Swallows the target.
  // While Swallowed, the target is Restrained and marks a HP when the Sandwyrm is spotlighted. The Sandwyrm disgorges all
  // Swallowed creatures when it takes Major or greater damage."
  entry(
    "sandwyrm",
    "Devour",
    action({ roll: ATTACK, targets: enemy("melee"), steps: [condition(SWALLOWED, "manual", "the Sandwyrm takes Major or greater damage", ["hit"])] }),
    ...swallowedUses({ kind: "markHp", to: "targets", when: [has(SWALLOWED)], amount: one }),
  ),
  // Hungry, Not Stupid - Reaction: "When the Sandwyrm marks half its HP or Swallows a creature, roll a d6. On a result of 3
  // or lower, the Sandwyrm retreats to safety."
  entry(
    "sandwyrm",
    "Hungry, Not Stupid",
    ...(
      [
        ["main", { kind: "onHpMarkedAtLeast", value: "half" }],
        ["swallow", { kind: "situation", text: "The Sandwyrm Swallows a creature" }],
      ] as const
    ).map(([id, trigger]) =>
      reaction(trigger, {
        id,
        steps: [{ kind: "check", dice: diceExpr(1, 6), test: { kind: "totalAtMost", value: 3 }, then: [manual("The Sandwyrm retreats to safety.", "self")], otherwise: [] }],
      }),
    ),
  ),

  // ======================================================== Shapeshifting Fiend (HF p.87)
  // Fiendish Nature - Passive: "The Fiend has resistance to magic damage and can't be fooled by magic illusions."
  entry("shapeshifting-fiend", "Fiendish Nature", resistance("magic", "resistant", { steps: [manual("It can't be fooled by magic illusions.", "self")] })),
  // Impersonate - Action: "Spend a Fear to have the Fiend magically transform into a humanoid they have previously interacted
  // with. A PC who targets the Fiend while they're in the form of a person the PC cares for must succeed on an Instinct
  // Reaction Roll or the attack fails and the PC must mark a Stress."
  entry(
    "shapeshifting-fiend",
    "Impersonate",
    action({ costs: [fear()], steps: [{ kind: "condition", to: "self", condition: tag("Impersonating"), duration: "manual", endsWhen: "it takes another form" }] }),
    auto(
      { kind: "onAttacked", stage: "targeted" },
      {
        id: "targeted",
        requires: [{ kind: "hasCondition", condition: tag("Impersonating") }, { kind: "situation", text: "The attacker cares for the person the Fiend impersonates" }],
        targets: SOURCE,
        steps: [save("instinct", OWN, [{ kind: "negate", to: "targets", what: "attack", note: "The attack fails" }, markStress()])],
      },
    ),
  ),
  // Turn Invisible - Action: "Mark a Stress to make the Fiend Hidden until they make an action roll or take damage."
  entry(
    "shapeshifting-fiend",
    "Turn Invisible",
    action({ costs: [stress()], steps: [{ kind: "condition", to: "self", condition: std("hidden"), duration: "manual", endsWhen: "it makes an action roll or takes damage" }] }),
    auto({ kind: "onDamaged" }, { id: "damaged", requires: [{ kind: "hasCondition", condition: std("hidden") }], steps: [{ kind: "clearCondition", to: "self", condition: std("hidden") }] }),
    auto({ kind: "onAttack", stage: "before", attack: "any" }, { id: "rolls", requires: [{ kind: "hasCondition", condition: std("hidden") }], steps: [{ kind: "clearCondition", to: "self", condition: std("hidden") }] }),
  ),
  // Backhanded Guidance - Reaction: "When a PC makes an action roll while the Fiend is in the scene, you can mark a Stress to
  // add 1d6 to the result of their Fear Die."
  // The d6 is rolled; adding it to the Fear Die alone (which can turn the roll to Fear) has no roll change.
  entry(
    "shapeshifting-fiend",
    "Backhanded Guidance",
    reaction(
      { kind: "pcRolls", roll: "action" },
      {
        costs: [stress()],
        targets: SUBJECT,
        steps: [{ kind: "check", dice: diceExpr(1, 6), test: { kind: "totalAtLeast", value: 1 }, then: [manual("Add the d6 to the result of their Fear Die (the total and Hope / Fear change with it).")], otherwise: [] }],
      },
    ),
  ),
  // Exposed! (Phase Change) - Reaction: "When the Fiend is defeated or the PCs discover its true identity, replace the Fiend
  // with Shapeshifting Fiend Revealed and immediately spotlight them."
  entry(
    "shapeshifting-fiend",
    "Exposed! (Phase Change)",
    ...(
      [
        ["main", { kind: "onDefeated" }],
        ["discovered", { kind: "situation", text: "The PCs discover the Fiend's true identity" }],
      ] as const
    ).map(([id, trigger]) =>
      reaction(trigger, {
        id,
        steps: [
          { kind: "summon", label: "Shapeshifting Fiend Revealed (replaces the Fiend)", count: one, adversaryId: "shapeshifting-fiend-revealed" },
          { kind: "spotlight", who: "picked", note: "Spotlight the Fiend Revealed" },
        ],
      }),
    ),
  ),

  // ======================================================== Shapeshifting Fiend Revealed (HF p.87)
  // Relentless (3) - Passive: "The Fiend can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // them."
  relentless("shapeshifting-fiend-revealed", 3),
  // Fiendish Resistance - Passive: "The Fiend has resistance to magic damage and can't be fooled by magic illusions."
  entry("shapeshifting-fiend-revealed", "Fiendish Resistance", resistance("magic", "resistant", { steps: [manual("It can't be fooled by magic illusions.", "self")] })),
  // Demonic Rage - Action: "Spend a Fear to make a standard attack with a bonus to the attack roll equal the amount of Stress
  // the Fiend has marked. On a success, the attack deals direct damage."
  entry(
    "shapeshifting-fiend-revealed",
    "Demonic Rage",
    action({
      costs: [fear()],
      roll: { ...ATTACK, modifier: { kind: "marked", who: "self", track: "stress" } },
      targets: enemy("veryClose"),
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon", direct: true }],
    }),
  ),
  // Hall of Mirrors - Action: "Mark 2 Stress to have the Fiend summon four illusory duplicates and activate a Duplicate
  // Countdown (4). When the Fiend is targeted by an attack, they gain a bonus to their Difficulty equal to the countdown die's
  // current value. The countdown ticks down when a PC fails an attack against the Fiend. When it triggers, the duplicates
  // vanish."
  // The countdown die is the stat-block tokens (4 to 0): a passive adds them to its Difficulty while any remain, a failed
  // attack against it spends one, and at 0 the duplicates are gone.
  entry(
    "shapeshifting-fiend-revealed",
    "Hall of Mirrors",
    action({ costs: [stress(2)], steps: [{ kind: "tokens", to: "self", op: "set", amount: fixed(4), die: 4, note: "Four illusory duplicates; the Duplicate Countdown (4)" }] }),
    passive([{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: { kind: "cardTokens" } } }], { id: "duplicates", requires: [{ kind: "tokens", atLeast: 1 }] }),
    auto({ kind: "onAttacked", stage: "failed" }, { id: "tick", requires: [{ kind: "tokens", atLeast: 1 }], steps: [{ kind: "tokens", to: "self", op: "spend", amount: one, die: 4, note: "At 0 the duplicates vanish" }] }),
  ),
  // Flash Claw - Action: "Spend a Fear to have the Fiend unleash an arc of magical energy. Make an attack roll against all
  // targets within Close range. Targets the attack succeeds against take 3d20 magic damage."
  entry("shapeshifting-fiend-revealed", "Flash Claw", action({ costs: [fear()], roll: ATTACK, targets: enemiesAround("close"), steps: [hitDamage(dmg(3, 20), "magic")] })),
  // Mind Games - Reaction: "When an attack targeting the Fiend from beyond Very Close range succeeds with Fear, you can mark a
  // Stress to have the Fiend instantly switch places with a PC within Very Close range. The PC takes the damage instead."
  // No "with Fear" narrowing on `onAttacked`: the GM declines when the roll was with Hope (dcm-2gn).
  entry(
    "shapeshifting-fiend-revealed",
    "Mind Games",
    reaction(
      { kind: "onAttacked", stage: "succeeded", attackerBeyond: "veryClose" },
      {
        costs: [stress()],
        steps: [
          { kind: "move", to: "self", mode: "teleport", note: "Switch places with a PC within Very Close range (only on a success with Fear)" },
          { kind: "redirectDamage", to: "picked", pick: { side: "enemy", range: "veryClose", count: { kind: "one" } }, target: "picked", note: "The PC takes the damage instead" },
        ],
      },
    ),
  ),

  // ======================================================== Storm Titan (HF p.87)
  // Relentless (3) - Passive: "The Titan can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // them."
  relentless("storm-titan", 3),
  // Momentum - Passive: "When the Titan makes a successful attack against a PC, you gain a Fear."
  momentum("storm-titan"),
  // Ball Lightning - Action: "Spend a Fear to have the Titan conjure 1d4 spheres of electrical energy within Close range. When
  // the Titan is spotlighted, they can move each sphere up to Close range. When a sphere moves within Very Close range of a
  // PC, the PC takes 4d6 magic damage, and the sphere disappears. Each sphere has the same Difficulty as the Titan and
  // disappears if a creature deals magic damage to it."
  // The spheres are summoned as markers (no stat block); `move` reminds the GM on each spotlight; `strike` is the GM's
  // button when a sphere reaches a PC.
  entry(
    "storm-titan",
    "Ball Lightning",
    action({ costs: [fear()], steps: [{ kind: "summon", label: "Ball Lightning sphere (Difficulty 20; magic damage dispels it)", count: rolled(1, 4), range: "close" }] }),
    auto({ kind: "onSpotlight" }, { id: "move", steps: [manual("Move each Ball Lightning sphere up to Close range.", "self")] }),
    reaction(
      { kind: "situation", text: "A Ball Lightning sphere moves within Very Close range of a PC" },
      { id: "strike", targets: enemy("unlimited"), steps: [damage(dmg(4, 6), "magic"), manual("The sphere disappears.", "self")] },
    ),
  ),
  // Storm Bringer - Action: "Mark a Stress to have the Titan conjure a raging storm. Each PC within Close range of the Titan
  // must make a Strength Reaction Roll. Targets who fail take 3d12 magic damage and are Vulnerable until they are spotlighted.
  // Targets who succeed take half damage."
  entry(
    "storm-titan",
    "Storm Bringer",
    action({
      costs: [stress()],
      targets: enemiesAround("close"),
      steps: [save("strength", OWN, [damage(dmg(3, 12), "magic"), condition(std("vulnerable"), "manual", "they are spotlighted")], [damage(dmg(3, 12), "magic", { scale: "half" })])],
    }),
  ),
  // Thunderclap - Action: "Spend a Fear to target up to three PCs in front of the Titan within Close range. Each target marks a
  // Stress and becomes Vulnerable until they roll with Hope."
  entry(
    "storm-titan",
    "Thunderclap",
    action({ costs: [fear()], targets: enemies("close", 3), steps: [markStress(), condition(std("vulnerable"), "manual", "they roll with Hope")] }),
  ),

  // ======================================================== Unicorn (HF p.88)
  // Celestial Lance - Passive: "The Unicorn's standard attack deals double damage to a creature that has dealt damage to it."
  // `mark` tags whoever damages the Unicorn; `lance` doubles a standard hit on a tagged target (a fold on the open hit).
  entry(
    "unicorn",
    "Celestial Lance",
    auto({ kind: "onDamaged" }, { id: "mark", targets: SOURCE, steps: [condition(tag("Struck the Unicorn"), "manual", "the scene ends")] }),
    auto(
      { kind: "onHit", attack: "standard", targetHas: tag("Struck the Unicorn") },
      { id: "lance", targets: SUBJECT, steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "multiply", factor: 2 } }] },
    ),
  ),
  // Healing Touch - Action: "The Unicorn touches its horn to an ally within Melee range and channels healing energy into them.
  // Mark any number of Stress to clear an equal number of the ally's HP."
  entry(
    "unicorn",
    "Healing Touch",
    action({ targets: { side: "ally", range: "melee", count: { kind: "one" } }, steps: [anyStress("touch", "Mark how many Stress?", 5, (n) => [{ kind: "clear", to: "targets", track: "hp", amount: fixed(n) }])] }),
  ),
  // Protective Aura - Action: "Mark a Stress to have the Unicorn conjure a sparkling magical aura. While the aura is in effect,
  // attack rolls made against the Unicorn or an ally within Very Close range are made with disadvantage. This effect lasts
  // until the Unicorn takes damage."
  entry(
    "unicorn",
    "Protective Aura",
    action({ costs: [stress()], steps: [{ kind: "condition", to: "self", condition: tag("Protective Aura"), duration: "manual", endsWhen: "the Unicorn takes damage" }] }),
    passive(
      [
        { kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" } },
        { kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" }, to: "allies", within: "veryClose" },
      ],
      { id: "aura", requires: [{ kind: "hasCondition", condition: tag("Protective Aura") }] },
    ),
    auto({ kind: "onDamaged" }, { id: "end", requires: [{ kind: "hasCondition", condition: tag("Protective Aura") }], steps: [{ kind: "clearCondition", to: "self", condition: tag("Protective Aura") }] }),
  ),
  // Teleport - Action: "Mark a Stress to have the Unicorn teleport up to Very Far range. The Unicorn can bring up to three
  // allies within Very Close range with it."
  entry(
    "unicorn",
    "Teleport",
    action({
      costs: [stress()],
      steps: [
        { kind: "move", to: "self", mode: "teleport", range: "veryFar" },
        { kind: "move", to: "allies", pick: { side: "ally", range: "veryClose", count: { kind: "upTo", n: fixed(3) } }, mode: "teleport", range: "veryFar", note: "Up to three allies within Very Close range come along" },
      ],
    }),
  ),

  // ======================================================== Vampire Bat Swarm (HF p.88)
  // Horde (2d6) - Passive: "When the Swarm has marked half or more of its HP, its standard attack deals 2d6 physical damage
  // instead."
  entry("vampire-bat-swarm", "Horde (2d6)", passive([{ kind: "horde", damage: hordeDice(2, 6) }])),
  // Blinding Multitude - Passive: "The Swarm is so thick it blocks the vision of anyone it interacts with. Creatures within
  // Melee range have disadvantage on attacks made against adversaries other than the Swarm."
  entry("vampire-bat-swarm", "Blinding Multitude", reminder("Creatures within Melee range of the Swarm have disadvantage on attacks against adversaries other than the Swarm.")),
  // Bloodsuckers - Reaction: "When the Swarm deals damage to a target, you can mark a Stress to have the Swarm feed. The
  // target marks an additional HP, and the Swarm clears a HP."
  entry(
    "vampire-bat-swarm",
    "Bloodsuckers",
    reaction(
      { kind: "onDealDamage" },
      { costs: [stress()], targets: SUBJECT, steps: [{ kind: "markHp", to: "targets", amount: one, note: "An additional HP" }, { kind: "clear", to: "self", track: "hp", amount: one }] },
    ),
  ),

  // ======================================================== Vampire Lord (HF p.88)
  // Relentless (3) - Passive: "The Vampire Lord can be spotlighted up to three times per GM turn. Spend Fear as usual to
  // spotlight them."
  relentless("vampire-lord", 3),
  // Midnight Heart - Passive (Long-Term Countdown (6)): "The Vampire Lord keeps their heart hidden in a safe place. If it's
  // destroyed, the Vampire Lord dies. Otherwise, when the Vampire Lord is defeated, activate the countdown. It ticks down each
  // time the PCs finish a long rest. When it triggers, the Vampire Lord revives within Close range of the heart with all HP
  // and Stress cleared."
  entry(
    "vampire-lord",
    "Midnight Heart",
    auto(
      { kind: "onDefeated" },
      {
        id: "defeated",
        steps: [{ kind: "countdown", op: "start", label: "Midnight Heart (long-term)", start: fixed(6), onTrigger: "The Vampire Lord revives within Close range of the heart with all HP and Stress cleared." }],
      },
    ),
    auto({ kind: "situation", text: "The PCs finish a long rest" }, { id: "tick", steps: [{ kind: "countdown", op: "tick", label: "Midnight Heart (long-term)" }] }),
    reaction({ kind: "situation", text: "The Vampire Lord's heart is destroyed" }, { id: "heart", steps: [{ kind: "defeat", to: "self", note: "The Vampire Lord dies" }] }),
  ),
  // Terrifying - Passive: "When the Vampire Lord makes a successful attack roll, all PCs within Close range lose a Hope, and
  // you gain a Fear."
  terrifying("vampire-lord"),
  // Unleash Hellfire - Action: "Mark a Stress to have the Vampire Lord momentarily conjure 1d4 bursts of hellfire within Far
  // range. Each burst deals 3d6 magic damage to each target within Very Close range. If a target takes damage from multiple
  // bursts, combine the damage."
  // The 1d4 is rolled (`check`); every target in a burst takes one burst's 3d6, and the extra bursts on a target are manual:
  // a damage repeat can't differ per target.
  entry(
    "vampire-lord",
    "Unleash Hellfire",
    action({
      costs: [stress()],
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "aroundPoint", areaRange: "veryClose" },
      steps: [
        {
          kind: "check",
          dice: diceExpr(1, 4),
          test: { kind: "totalAtLeast", value: 1 },
          then: [damage(dmg(3, 6), "magic"), manual("The d4 is the number of bursts. A target within Very Close range of more than one burst takes 3d6 more for each extra burst, combined.", "self")],
          otherwise: [],
        },
      ],
    }),
  ),
  // Resurgence - Reaction: "When a PC within Very Close range rolls with Hope, you can spend a Fear to clear a HP or a
  // Stress."
  entry(
    "vampire-lord",
    "Resurgence",
    reaction(
      { kind: "pcRolls", result: "withHope", within: "veryClose" },
      {
        costs: [fear()],
        steps: [
          {
            kind: "choose",
            id: "resurgence",
            label: "Clear a HP or a Stress",
            options: [
              { id: "hp", label: "Clear a HP", steps: [{ kind: "clear", to: "self", track: "hp", amount: one }] },
              { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "self", track: "stress", amount: one }] },
            ],
          },
        ],
      },
    ),
  ),
  // Melt into Shadow - Reaction: "When a PC would deal damage to the Vampire Lord, you can spend a Fear to roll a d6. On a
  // result of 5 or higher, negate the damage, then teleport the Vampire Lord to a point within Far range."
  entry(
    "vampire-lord",
    "Melt into Shadow",
    reaction(
      { kind: "onDamaged", stage: "would" },
      {
        costs: [fear()],
        steps: [
          {
            kind: "check",
            dice: diceExpr(1, 6),
            test: { kind: "totalAtLeast", value: 5 },
            then: [{ kind: "negate", to: "self", what: "damage" }, { kind: "move", to: "self", mode: "teleport", range: "far" }],
            otherwise: [],
          },
        ],
      },
    ),
  ),
  // Hellwing - Evolution: "When the Vampire Lord marks half their HP, they transform into the Hellwing: a towering, demonic
  // bat creature. They gain the "On Crimson Wings" and "Blood Bath" features and replace their standard attack with the
  // following standard attack: Claws: Close | 3d12+6 phy"
  // The transformation tags the instance (both features require the tag); the new standard attack is manual (no evolution
  // step swaps the stat block's attack).
  entry(
    "vampire-lord",
    "Hellwing",
    auto(
      { kind: "onHpMarkedAtLeast", value: "half" },
      {
        steps: [
          { kind: "condition", to: "self", condition: HELLWING, duration: "permanent" },
          manual("Its standard attack becomes Claws: Close | 3d12+6 phy.", "self"),
        ],
      },
    ),
  ),
  // On Crimson Wings - Passive: "While flying, the Hellwing gains a +1 bonus to their Difficulty."
  entry(
    "vampire-lord",
    "On Crimson Wings",
    passive([{ kind: "mod", mod: { kind: "stat", stat: "difficulty", delta: one } }], { requires: [{ kind: "hasCondition", condition: HELLWING }, { kind: "situation", text: "The Hellwing is flying" }] }),
  ),
  // Blood Bath - Reaction: "When the Hellwing takes Major or greater damage, the ground within Very Close range is covered
  // with blood, dealing 3d10 magic damage to all other creatures in the area. When the Hellwing takes the spotlight on
  // subsequent GM turns, all other creatures in that area take 3d6 magic damage."
  entry(
    "vampire-lord",
    "Blood Bath",
    reaction(
      { kind: "onDamaged", minSeverity: "major" },
      {
        requires: [{ kind: "hasCondition", condition: HELLWING }],
        targets: { side: "any", range: "veryClose", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true },
        steps: [damage(dmg(3, 10), "magic"), { kind: "condition", to: "self", condition: tag("Blood Bath"), duration: "scene", note: "The blood stays where it fell" }],
      },
    ),
    auto(
      { kind: "onSpotlight" },
      { id: "pool", requires: [{ kind: "hasCondition", condition: tag("Blood Bath") }], targets: { side: "any", range: "unlimited", count: { kind: "any" }, excludeSelf: true }, steps: [damage(dmg(3, 6), "magic", {})] },
    ),
  ),

  // ======================================================== Viscera Sucker (HF p.89)
  // Join or Die - Passive: "The Viscera Sucker dies if it hasn't reconnected its upper and lower halves by dawn."
  entry("viscera-sucker", "Join or Die", reminder("The Viscera Sucker dies if it hasn't reconnected its upper and lower halves by dawn.")),
  // Entangling Entrails - Action: "Spend a Fear to have the Viscera Sucker latch onto a target within Very Close range,
  // Restraining them until they escape with a successful Strength Roll (16)."
  entry("viscera-sucker", "Entangling Entrails", action({ costs: [fear()], targets: enemy("veryClose"), steps: [condition(std("restrained"), "manual", "they escape with a successful Strength Roll (16)")] })),
  // Lifesuck - Action: "Mark a Stress to have the Viscera Sucker drink blood from a Restrained target within Melee range. The
  // target marks a HP, and the Viscera Sucker clears a HP."
  entry(
    "viscera-sucker",
    "Lifesuck",
    action({
      costs: [stress()],
      targets: enemy("melee"),
      steps: [
        { kind: "markHp", to: "targets", when: [has(std("restrained"))], amount: one },
        { kind: "clear", to: "self", when: [has(std("restrained"))], track: "hp", amount: one },
      ],
    }),
  ),

  // ======================================================== Whisper Wraith (HF p.89)
  // Greater Specter - Passive: "The Wraith has resistance to physical damage and can move through solid objects."
  entry("whisper-wraith", "Greater Specter", resistance("physical", "resistant", { steps: [manual("It can move through solid objects.", "self")] })),
  // Spooky - Passive: "When the Wraith makes a successful attack, all PCs within Close range must mark a Stress, and you gain
  // a Fear."
  entry("whisper-wraith", "Spooky", auto({ kind: "onHit", attack: "any" }, { steps: [{ kind: "markStress", to: "picked", pick: enemiesAround("close"), amount: one }, gainFear()] })),
  // Nightmare Shroud - Action: "Spend a Fear to have the Wraith wrap itself around a PC within Melee range, Shrouding the
  // target until they succeed on a Strength Roll to dislodge the Wraith or the Wraith takes Major or greater damage. While
  // Shrouded, the target has disadvantage on attack rolls and marks a Stress when they roll with Fear. Additionally, damage
  // that would be dealt to the Wraith is split evenly between the Wraith and the Shrouded target."
  // `fear` marks the Shrouded PC's Stress on a roll with Fear; `split` halves the Wraith's damage and deals the other half
  // (the trigger's amount, halved) to the Shrouded PC; `release` ends it on Major damage.
  entry(
    "whisper-wraith",
    "Nightmare Shroud",
    action({
      costs: [fear()],
      targets: enemy("melee"),
      steps: [condition(tag("Shrouded"), "manual", "a successful Strength Roll, or the Wraith takes Major or greater damage"), manual("While Shrouded, the target has disadvantage on attack rolls.")],
    }),
    auto({ kind: "pcRolls", result: "withFear" }, { id: "fear", targets: SUBJECT, steps: [{ kind: "markStress", to: "targets", when: [has(tag("Shrouded"))], amount: one }] }),
    auto(
      { kind: "onDamaged", stage: "would" },
      {
        id: "split",
        targets: anyEnemy,
        steps: [
          { kind: "modifyDamage", to: "self", when: [has(tag("Shrouded"))], change: { kind: "halve" }, note: "The Wraith takes half" },
          { kind: "damage", to: "targets", when: [has(tag("Shrouded"))], roll: { kind: "sameAsTrigger" }, type: "physical", scale: "half", note: "The Shrouded PC takes the other half (the damage's own type)" },
        ],
      },
    ),
    releaseOnMajor(tag("Shrouded")),
  ),

  // ======================================================== Wyvern (HF p.89)
  // Double Strike - Action: "Mark a Stress to have the Wyvern make two standard attacks. If both attacks succeed against the
  // same target, combine the damage."
  doubleStrike("wyvern", "Double Strike", "veryClose", dmg(3, 8, 5)),
  // Terrifying Shriek - Action: "Spend a Fear to have the Wyvern let out a spine-chilling screech. All creatures within Far
  // range are Terrified until they succeed on a Presence Roll (18) to clear the condition or the Wyvern is defeated. While
  // Terrified, a PC doesn't gain a Hope when they roll with Hope."
  entry(
    "wyvern",
    "Terrifying Shriek",
    action({
      costs: [fear()],
      targets: enemiesAround("far"),
      steps: [condition(tag("Terrified"), "manual", "a successful Presence Roll (18), or the Wyvern is defeated"), manual("While Terrified, a PC doesn't gain a Hope when they roll with Hope.")],
    }),
    auto({ kind: "onDefeated" }, { id: "end", targets: anyEnemy, steps: [{ kind: "clearCondition", to: "targets", condition: tag("Terrified") }] }),
  ),
  // Clutch - Reaction: "When the Wyvern makes a successful attack against a PC, you can spend a Fear to have the Wyvern
  // Restrain the target in its claws until the PC succeeds on a Strength Roll (18) or the Wyvern takes Major or greater
  // damage. While Restrained in this way, the PC has disadvantage on attack rolls."
  entry(
    "wyvern",
    "Clutch",
    reaction(
      { kind: "onHit", attack: "any" },
      {
        costs: [fear()],
        targets: SUBJECT,
        steps: [condition(tag("Clutched", ["restrained"]), "manual", "a successful Strength Roll (18), or the Wyvern takes Major or greater damage"), manual("While Restrained in this way, the PC has disadvantage on attack rolls.")],
      },
    ),
    releaseOnMajor(tag("Clutched"), "major", true),
  ),

  // ======================================================== Young Fire Dragon (HF p.89)
  // Relentless (3) - Passive: "The Dragon can be spotlighted up to three times per GM turn. Spend Fear as usual to spotlight
  // it."
  relentless("young-fire-dragon", 3),
  // Intimidating - Passive: "When you spend a Fear to spotlight the Dragon, all PCs within Close range must mark a Stress or
  // lose a Hope."
  // The Fear is the spotlight's own (CB p.153), not a cost of this feature: the use runs on the spotlight when the GM
  // confirms it was paid with Fear (no trigger narrowing for that, dcm-2gn). Each PC picks Stress or Hope.
  entry(
    "young-fire-dragon",
    "Intimidating",
    auto(
      { kind: "onSpotlight" },
      {
        requires: [{ kind: "situation", text: "You spent a Fear to spotlight the Dragon" }],
        targets: enemiesAround("close"),
        steps: [
          {
            kind: "choose",
            id: "intimidating",
            label: "Each PC marks a Stress or loses a Hope",
            options: [
              { id: "stress", label: "Mark a Stress", steps: [markStress()] },
              { id: "hope", label: "Lose a Hope", steps: [{ kind: "hope", to: "targets", change: "lose", amount: one }] },
            ],
          },
        ],
      },
    ),
  ),
  // Flame Breath - Action: "Spend a Fear to have the Dragon unleash a blast of flame against all targets in front of it within
  // Close range. Each target must make an Agility Reaction Roll. Targets who fail take 4d8+3 magic damage. Targets who
  // succeed must mark a Stress or take half damage. A target who marks HP from this attack also becomes Vulnerable until they
  // clear a HP."
  entry(
    "young-fire-dragon",
    "Flame Breath",
    action({
      costs: [fear()],
      targets: enemiesFront("close"),
      steps: [
        save("agility", OWN, [damage(dmg(4, 8, 3), "magic")], [stressOrHalf("flame", dmg(4, 8, 3), "magic")]),
        manual("A target who marks HP from this attack also becomes Vulnerable until they clear a HP."),
      ],
    }),
  ),
  // Eruption - Action: "Spend a Fear to have the Dragon crack the earth open with its tail, unleashing an explosion of lava.
  // Choose a point within Far range. Each PC on the line between the Dragon and the chosen point must succeed on an Agility
  // Reaction Roll or get burned, becoming Vulnerable until their next rest. You gain a Fear for each PC who fails."
  entry(
    "young-fire-dragon",
    "Eruption",
    action({
      costs: [fear()],
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "line" },
      steps: [save("agility", OWN, [condition(std("vulnerable"), "rest", "their next rest"), gainFear()])],
    }),
  ),
  // Blazing Scales - Reaction: "When a creature within Very Close range attacks the Dragon, the attacker must mark a Stress."
  entry("young-fire-dragon", "Blazing Scales", reaction({ kind: "onAttacked", stage: "targeted", attackerWithin: "veryClose" }, { targets: SOURCE, steps: [markStress()] })),
  // Slash and Burn - Reaction: "When the Dragon makes a successful standard attack, you gain a Fear and can mark a Stress to
  // have the attack deal an extra 10 magic damage."
  // The Fear is automatic (Q19); the Stress is the GM's tap: +10 folded into the open hit.
  entry(
    "young-fire-dragon",
    "Slash and Burn",
    auto({ kind: "onHit", attack: "standard" }, { steps: [gainFear()] }),
    reaction(
      { kind: "onHit", attack: "standard" },
      { id: "burn", costs: [stress()], targets: SUBJECT, steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: fixed(10) }, note: "An extra 10 magic damage" }] },
    ),
  ),
];
