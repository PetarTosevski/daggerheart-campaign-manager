import { describe, expect, it } from "vitest";

import { STEP_KINDS } from "@/lib/domain/card-effects/types";
import {
  ADVERSARY_EFFECT_GROUPS,
  ADVERSARY_STEP_KINDS,
  ADVERSARY_TRIGGER_KINDS,
  type AdversaryFeatureEffect,
  type AdversaryStep,
} from "@/lib/domain/adversary-effects/types";
import { adversaryActionMessages } from "@/lib/errors/adversaryActions";
import { errorMessage } from "@/lib/convex-errors";
import { ConvexError } from "convex/values";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import {
  ADVERSARY_EFFECTS,
  ADVERSARY_EFFECT_TABLES,
  adversaryEffects,
  adversaryFeatureEffect,
  adversaryGroup,
  mergeAdversaryEffectTables,
} from "@/lib/srd/adversary-effects/index";

// Plan combat-actions, tracer AA0: the adversary vocabulary, the empty registry of eight groups and the error codes.

/**
 * Book examples written in the vocabulary (CB p.195, p.201, p.199, p.196). If a type change breaks one of these, the
 * vocabulary lost a shape the AE-* tracers rely on.
 */
const EXAMPLES: readonly AdversaryFeatureEffect[] = [
  {
    // "Momentum - Reaction: When this adversary makes a successful attack against a PC, you gain a Fear." (CB p.195)
    adversaryId: "example",
    feature: "Momentum",
    uses: [
      {
        id: "main",
        activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } },
        needsSpotlight: false,
        steps: [{ kind: "fear", change: "gain", amount: { kind: "fixed", value: 1 }, to: "self" }],
      },
    ],
  },
  {
    // "Heavy Hitter - Reaction: When this adversary deals damage with a standard attack, you can spend a Fear to gain a
    // +X bonus to the damage roll." (CB p.195; X = 2 here)
    adversaryId: "example",
    feature: "Heavy Hitter",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "beforeDamage", attack: "standard" } },
        needsSpotlight: false,
        steps: [
          {
            kind: "optional",
            id: "heavy",
            label: "Spend a Fear for +2 damage",
            costs: [{ kind: "fear", amount: { kind: "fixed", value: 1 } }],
            steps: [{ kind: "modifyDamage", change: { kind: "add", amount: { kind: "fixed", value: 2 } }, to: "targets" }],
          },
        ],
      },
    ],
  },
  {
    // "Group Attack - Action: Spend a Fear to choose a target and spotlight all adversaries with this name within Close
    // range of them. … On a success, they deal 2 damage each. Combine this damage." (CB p.201)
    adversaryId: "example",
    feature: "Group Attack",
    uses: [
      {
        id: "main",
        activation: { kind: "action" },
        needsSpotlight: true,
        costs: [{ kind: "fear", amount: { kind: "fixed", value: 1 } }],
        roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } },
        targets: { side: "enemy", range: "far", count: { kind: "one" } },
        groupAttack: { within: "close" },
        steps: [
          { kind: "damage", roll: { kind: "flat", amount: { kind: "fixed", value: 2 } }, type: "physical", to: "targets", when: ["hit"] },
        ],
      },
    ],
  },
  {
    // "Minion (3)", "Horde (1d4+1)", "Relentless (3)" as passive modifiers (CB p.201, p.199).
    adversaryId: "example",
    feature: "Passives",
    uses: [
      {
        id: "main",
        activation: { kind: "passive" },
        needsSpotlight: false,
        modifiers: [
          { kind: "minion", threshold: 3 },
          { kind: "horde", damage: { kind: "dice", dice: { count: { kind: "fixed", value: 1 }, sides: 4, plus: { kind: "fixed", value: 1 } } } },
          { kind: "relentless", times: 3 },
          { kind: "mod", mod: { kind: "resistance", type: "magic", level: "resistant" } },
          { kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "fixed", value: 2 } } },
        ],
        steps: [],
      },
    ],
  },
  {
    // "Explosion - Action: Spend a Fear to erupt in a fiery explosion. Make an attack against all targets within Close
    // range. Targets the adversary succeeds against take 1d8 magic damage and are knocked back to Far range." (CB p.196)
    adversaryId: "example",
    feature: "Explosion",
    uses: [
      {
        id: "main",
        activation: { kind: "action" },
        needsSpotlight: true,
        costs: [{ kind: "fear", amount: { kind: "fixed", value: 1 } }],
        roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } },
        targets: { side: "enemy", range: "close", count: { kind: "all" }, area: "aroundSelf" },
        steps: [
          { kind: "damage", roll: { kind: "dice", dice: { count: { kind: "fixed", value: 1 }, sides: 8 } }, type: "magic", to: "targets", when: ["hit"] },
          { kind: "move", mode: "knockBack", range: "far", to: "targets", when: ["hit"] },
        ],
      },
    ],
  },
  {
    // A summon, a countdown and a spotlight: "Mark a Stress to spotlight 1d4 allies", "summon three Lackeys",
    // "Countdown (5)".
    adversaryId: "example",
    feature: "Call for Help",
    uses: [
      {
        id: "main",
        activation: { kind: "action" },
        needsSpotlight: true,
        limit: { per: "scene" },
        costs: [{ kind: "stress", amount: { kind: "fixed", value: 1 } }],
        steps: [
          { kind: "summon", label: "Jagged Knife Lackey", adversaryId: "jagged-knife-lackey", count: { kind: "fixed", value: 3 } },
          { kind: "countdown", op: "start", label: "Reinforcements", start: { kind: "fixed", value: 5 } },
          { kind: "spotlight", who: "allies", count: { kind: "dice", dice: { count: { kind: "fixed", value: 1 }, sides: 4 } } },
          {
            kind: "save",
            to: "targets",
            trait: "agility",
            difficulty: { kind: "fixed", value: 14 },
            onFail: [{ kind: "summon", label: "Ambusher", count: { kind: "fixed", value: 1 } }],
            onSuccess: [],
          },
        ],
      },
    ],
  },
];

function stepKinds(steps: readonly AdversaryStep[]): string[] {
  return steps.flatMap((s) => {
    const nested =
      s.kind === "save"
        ? [...s.onFail, ...s.onSuccess]
        : s.kind === "optional" || s.kind === "followUp"
          ? s.steps
          : s.kind === "check"
            ? [...s.then, ...s.otherwise]
            : s.kind === "choose"
              ? s.options.flatMap((o) => o.steps)
              : [];
    return [s.kind, ...stepKinds(nested)];
  });
}

describe("adversary-effect vocabulary", () => {
  it("reuses every card step kind and adds summon, countdown and spotlight", () => {
    expect(ADVERSARY_STEP_KINDS.slice(0, STEP_KINDS.length)).toEqual([...STEP_KINDS]);
    expect(ADVERSARY_STEP_KINDS.slice(STEP_KINDS.length)).toEqual(["summon", "countdown", "spotlight"]);
    expect(new Set(ADVERSARY_STEP_KINDS).size).toBe(ADVERSARY_STEP_KINDS.length);
  });

  it("has the reaction triggers the plan names (onDamaged, onHit, onMarkHp, allyDealtDamage, onDefeated)", () => {
    for (const kind of ["onDamaged", "onHit", "onMarkHp", "allyDealtDamage", "onDefeated"]) {
      expect(ADVERSARY_TRIGGER_KINDS).toContain(kind);
    }
    expect(new Set(ADVERSARY_TRIGGER_KINDS).size).toBe(ADVERSARY_TRIGGER_KINDS.length);
  });

  it("expresses the book's examples, including steps nested in a reaction roll", () => {
    const kinds = EXAMPLES.flatMap((e) => e.uses.flatMap((u) => stepKinds(u.steps)));
    for (const kind of kinds) expect(ADVERSARY_STEP_KINDS).toContain(kind);
    expect(kinds).toEqual(expect.arrayContaining(["fear", "optional", "modifyDamage", "damage", "move", "summon", "countdown", "spotlight", "save"]));
  });
});

describe("adversary-effect registry", () => {
  it("has eight groups whose adversary and feature counts match the analysis (B1)", () => {
    expect(Object.keys(ADVERSARY_EFFECT_TABLES)).toEqual([...ADVERSARY_EFFECT_GROUPS]);
    const counts: Record<string, [number, number]> = {};
    for (const a of ADVERSARIES) {
      const c = (counts[adversaryGroup(a)] ??= [0, 0]);
      c[0]++;
      c[1] += a.features.length;
    }
    expect(counts).toEqual({
      "t1-core": [52, 140],
      "t1-hf": [35, 103],
      "t2-core": [36, 108],
      "t2-hf": [42, 138],
      "t3-core": [23, 87],
      "t3-hf": [32, 135],
      "t4-core": [18, 82],
      "t4-hf": [29, 135],
    });
  });

  it("feature names are unique within every stat block, so (adversary id, feature) keys an entry", () => {
    for (const a of ADVERSARIES) expect([a.id, new Set(a.features.map((f) => f.name)).size]).toEqual([a.id, a.features.length]);
  });

  it("ships the eight tables empty and the merged map built from them", () => {
    for (const table of Object.values(ADVERSARY_EFFECT_TABLES)) expect(table).toEqual([]);
    expect(ADVERSARY_EFFECTS.size).toBe(0);
    expect(adversaryEffects("acid-burrower")).toEqual([]);
    expect(adversaryFeatureEffect("acid-burrower", "Relentless (3)")).toBeUndefined();
  });

  it("merges entries by adversary id in table order and throws on a feature listed twice", () => {
    const [momentum, heavy] = EXAMPLES;
    const merged = mergeAdversaryEffectTables([[momentum!], [heavy!]]);
    expect(merged.get("example")?.map((e) => e.feature)).toEqual(["Momentum", "Heavy Hitter"]);
    expect(() => mergeAdversaryEffectTables([[momentum!], [momentum!]])).toThrow("example/Momentum");
  });
});

describe("adversary-action error codes", () => {
  it("defines the five codes and the client message map knows them", () => {
    expect(Object.keys(adversaryActionMessages).sort()).toEqual(
      ["ADVERSARY_FEATURE_UNAVAILABLE", "ADVERSARY_NOT_SPOTLIT", "NOT_A_RESPONDER", "NOT_ENOUGH_FEAR", "REQUEST_NOT_OPEN"].sort(),
    );
    for (const [code, message] of Object.entries(adversaryActionMessages)) {
      expect(errorMessage(new ConvexError({ code }))).toBe(message);
    }
  });
});
