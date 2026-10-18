import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { derivedDefense } from "@/lib/domain/characters/derived";
import { withEffects } from "@/lib/domain/characters/effects";
import { expire } from "@/lib/domain/characters/expiry";
import * as hooks from "@/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "@/lib/domain/class-features/index";
import type { ClassFeatures } from "@/lib/domain/class-features/types";
import { actionOutcome, dualityOutcome, type RollRecord } from "@/lib/domain/duality";
import type { Effect, FeatureUse, HeldDie } from "@/lib/validation/characters";

const base = readSheet({
  schemaVersion: 2,
  name: "Vex",
  pronouns: "",
  description: "",
  level: 3,
  classId: "rogue",
  subclassId: "nightwalker",
  ancestry: { kind: "single", id: "elf" },
  communityId: "wildborne",
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  traitMarks: {},
  evasion: 12,
  hpMax: 6,
  hp: 0,
  stressMax: 6,
  stress: 0,
  hope: 2,
  scars: 0,
  armorMarked: 0,
  proficiency: 1,
  primaryWeaponId: "dagger",
  inventory: [],
  gold: { handfuls: 1, bags: 0, chest: false },
  experiences: [],
  domainCards: { owned: [], loadout: [] },
  background: [],
  connections: [],
  notes: "",
});

const effect = (until: Effect["until"], mods?: Effect["mods"]): Effect => ({ id: `e-${until}`, source: "Test", text: until, until, ...(mods ? { mods } : {}) });
const die = (until: HeldDie["until"]): HeldDie => ({ id: `d-${until}`, kind: "rally", sides: 6, until });
const use = (until: FeatureUse["until"]): FeatureUse => ({ key: `u-${until}`, until });

describe("expire (CB 105 rests refresh rest features)", () => {
  const sheet = {
    ...base,
    effects: (["rest", "longRest", "session", "hit", "scene", "manual"] as const).map((u) => effect(u)),
    heldDice: (["session", "longRest", "manual"] as const).map(die),
    featureUses: (["rest", "longRest", "session"] as const).map(use),
  };
  const left = (event: Parameters<typeof expire>[1]) => {
    const s = expire(sheet, event);
    return { effects: s.effects.map((e) => e.until), heldDice: s.heldDice.map((d) => d.until), featureUses: s.featureUses.map((u) => u.until) };
  };

  it("a short rest ends `rest` effects and uses", () => {
    expect(left("shortRest")).toEqual({
      effects: ["longRest", "session", "hit", "scene", "manual"],
      heldDice: ["session", "longRest", "manual"],
      featureUses: ["longRest", "session"],
    });
  });

  it("a long rest ends `rest` and `longRest` ones", () => {
    expect(left("longRest")).toEqual({
      effects: ["session", "hit", "scene", "manual"],
      heldDice: ["session", "manual"],
      featureUses: ["session"],
    });
  });

  it("session end ends `session` and `scene` ones", () => {
    expect(left("session")).toEqual({
      effects: ["rest", "longRest", "hit", "manual"],
      heldDice: ["longRest", "manual"],
      featureUses: ["rest", "longRest"],
    });
  });

  it("a hit ends only `hit` effects; other fields are untouched", () => {
    const s = expire(sheet, "hit");
    expect(s.effects.map((e) => e.until)).toEqual(["rest", "longRest", "session", "scene", "manual"]);
    expect(s.heldDice).toEqual(sheet.heldDice);
    expect({ ...s, effects: sheet.effects }).toEqual(sheet);
  });

  it("works on a sheet that has none of the lists", () => {
    expect(expire({ effects: undefined }, "longRest")).toEqual({ effects: [], heldDice: [], featureUses: [] });
  });
});

describe("withEffects", () => {
  it("adds Evasion, trait, attack and damage modifiers without changing the base sheet", () => {
    const sheet = {
      ...base,
      effects: [effect("hit", { evasion: 2 }), effect("rest", { attack: 1, damage: 2 }), effect("manual", { trait: { id: "agility", delta: 1 } })],
    };
    const live = withEffects(sheet);
    expect(live.evasion).toBe(14);
    expect(live.traits.agility).toBe(3);
    expect(live.attackBonus).toBe(1);
    expect(live.damageBonus).toBe(2);
    expect(sheet.evasion).toBe(12);
    expect(sheet.traits.agility).toBe(2);
    expect(derivedDefense(live).evasion - derivedDefense(sheet).evasion).toBe(2);
  });

  it("is the identity without effects", () => {
    expect(withEffects(base)).toEqual({ ...base, attackBonus: 0, damageBonus: 0 });
  });
});

describe("Duality Dice (CB 94-95)", () => {
  it("matching dice are a critical, otherwise the higher die decides", () => {
    expect(dualityOutcome(7, 7)).toBe("critical");
    expect(dualityOutcome(9, 4)).toBe("hope");
    expect(dualityOutcome(2, 11)).toBe("fear");
  });

  it("success or failure against the Difficulty, with Hope or Fear", () => {
    expect(actionOutcome(1, 1, 3, 20)).toBe("critical");
    expect(actionOutcome(9, 4, 15, 12)).toBe("successHope");
    expect(actionOutcome(9, 4, 11, 12)).toBe("failHope");
    expect(actionOutcome(4, 9, 13, 13)).toBe("successFear");
    expect(actionOutcome(4, 9, 12, 13)).toBe("failFear");
    expect(actionOutcome(4, 9, 3, undefined)).toBe("successFear");
  });
});

describe("class-feature hooks", () => {
  const roll: RollRecord = { kind: "action", dice: [], modifier: 0, total: 10, outcome: "successHope", manual: false };

  it("the registry starts empty", () => {
    expect(CLASS_FEATURES).toEqual({});
  });

  it("a class without a registry entry gets the no-op defaults", () => {
    expect(hooks.rollOptions(base, "action")).toEqual([]);
    expect(hooks.weaponOverrides(base)).toEqual([]);
    expect(hooks.afterDualityRoll(base, { hope: 5, fear: 5, roll })).toEqual([]);
    expect(hooks.onRest(base, "long")).toBe(base);
    expect(hooks.onSessionStart(base, () => 1)).toBe(base);
    expect(hooks.onSessionEnd(base)).toBe(base);
    expect(hooks.hopeFeature(base)).toBeUndefined();
    expect(hooks.classActions(base)).toEqual([]);
    expect(hooks.findFeature(base, "anything")).toBeUndefined();
  });

  it("combines the class and the multiclass, but takes the Hope feature from the class only (CB 110-111)", () => {
    const rogue: ClassFeatures = {
      classId: "rogue",
      hopeFeature: { key: "dodge", name: "Rogue's Dodge", automation: "auto", target: "self" },
      classActions: [{ key: "cloak", name: "Cloaked", automation: "auto", target: "self" }],
      rollOptions: () => [{ key: "sneak", label: "Sneak Attack", effect: { kind: "dice", count: 1, sides: 6 } }],
      onRest: (s, kind) => ({ ...s, notes: `${s.notes}rogue-${kind};` }),
    };
    const wizard: ClassFeatures = {
      classId: "wizard",
      hopeFeature: { key: "notThisTime", name: "Not This Time", automation: "assist", target: "none" },
      classActions: [{ key: "patterns", name: "Strange Patterns", automation: "auto", target: "self" }],
      afterDualityRoll: (_s, { hope }) => (hope === 7 ? [{ key: "p", featureKey: "patterns", text: "Hope or Stress?", choices: [] }] : []),
      onRest: (s) => ({ ...s, notes: `${s.notes}wizard;` }),
    };
    const registry = { rogue, wizard };
    const multi = { ...base, multiclass: { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" } };

    expect(hooks.rollOptions(multi, "damage", registry).map((o) => o.key)).toEqual(["sneak"]);
    expect(hooks.afterDualityRoll(multi, { hope: 7, fear: 3, roll }, registry).map((p) => p.featureKey)).toEqual(["patterns"]);
    expect(hooks.onRest(multi, "short", registry).notes).toBe("rogue-short;wizard;");
    expect(hooks.hopeFeature(multi, registry)?.key).toBe("dodge");
    expect(hooks.classActions(multi, registry).map((f) => f.key)).toEqual(["cloak", "patterns"]);
    expect(hooks.findFeature(multi, "notThisTime", registry)).toBeUndefined();
    expect(hooks.findFeature(multi, "patterns", registry)?.name).toBe("Strange Patterns");
  });
});
