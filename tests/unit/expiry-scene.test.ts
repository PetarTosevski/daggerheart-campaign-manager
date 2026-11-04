import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { expire } from "@/lib/domain/characters/expiry";
import { hasDevout, rollPrayerDice } from "@/lib/domain/class-features/classes/seraph";
import type { Effect, FeatureUse } from "@/lib/validation/characters";

// Plan sheet-drawer SD8 (Q7): a scene ends with the encounter, the GM's End scene or the session. CB p.107, End of the
// Scene: "Sometimes certain effects, bonuses, or conditions state that they last until the end of the scene."

const base = readSheet({
  schemaVersion: 2,
  name: "Vex",
  pronouns: "",
  description: "",
  level: 3,
  classId: "guardian",
  subclassId: "stalwart",
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

const effect = (until: Effect["until"]): Effect => ({ id: `e-${until}`, source: "Test", text: until, until });
const use = (key: string, until: FeatureUse["until"]): FeatureUse => ({ key, until });

describe("expire a scene", () => {
  const sheet = {
    ...base,
    effects: (["rest", "longRest", "session", "hit", "scene", "manual"] as const).map(effect),
    featureUses: [use("feat:a", "scene"), use("feat:b", "rest"), use("feat:c", "longRest"), use("feat:d", "session"), use("feat:e", "scene")],
  };

  it("ends the effects and the feature uses that last until the scene", () => {
    const after = expire(sheet, "scene");
    expect(after.effects.map((e) => e.until)).toEqual(["rest", "longRest", "session", "hit", "manual"]);
    expect(after.featureUses.map((u) => u.key)).toEqual(["feat:b", "feat:c", "feat:d"]);
  });

  it("the session end also ends the scene: its effects and its feature uses", () => {
    const after = expire(sheet, "session");
    expect(after.effects.map((e) => e.until)).toEqual(["rest", "longRest", "hit", "manual"]);
    expect(after.featureUses.map((u) => u.key)).toEqual(["feat:b", "feat:c"]);
  });

  it("rests behave as before (Q3): a scene limit is not reset by a rest", () => {
    expect(expire(sheet, "shortRest").featureUses.map((u) => u.key)).toEqual(["feat:a", "feat:c", "feat:d", "feat:e"]);
    expect(expire(sheet, "longRest").featureUses.map((u) => u.key)).toEqual(["feat:a", "feat:d", "feat:e"]);
    expect(expire(sheet, "shortRest").effects.map((e) => e.until)).toContain("scene");
    expect(expire(sheet, "hit").featureUses).toHaveLength(5);
  });

  it("drops the Unstoppable Die at the scene end (CB p.36) and keeps it on a rest or a hit", () => {
    const unstoppable = { ...base, classState: { unstoppable: { value: 3, max: 4 }, focus: "kept" } };
    expect(expire(unstoppable, "scene").classState).toEqual({ focus: "kept" });
    expect(expire(unstoppable, "session").classState).toEqual({ focus: "kept" });
    expect(expire(unstoppable, "longRest").classState.unstoppable).toEqual({ value: 3, max: 4 });
    expect(expire(unstoppable, "hit").classState.unstoppable).toEqual({ value: 3, max: 4 });
  });

  it("drops the active stance at the scene end (HF p.12) and keeps the Focus and the known stances", () => {
    const martial = { ...base, classState: { martial: { known: ["quick", "reliable"], active: "quick", focus: 3 } } };
    expect(expire(martial, "scene").classState.martial).toEqual({ known: ["quick", "reliable"], focus: 3 });
    expect(expire(martial, "session").classState.martial).toEqual({ known: ["quick", "reliable"], focus: 3 });
    expect(expire(martial, "longRest").classState.martial?.active).toBe("quick");
  });

  it("clears Walk Between Worlds' tokens at the scene end (HF p.16: \"When the last token is removed or at the end of the scene, you return\") and keeps other tokens", () => {
    const walk = "feat:subclass:hedge:walk-between-worlds";
    const tokens = { ...base, cardTokens: [{ cardId: walk, count: 2 }, { cardId: "card:dark-army", count: 5 }] };
    expect(expire(tokens, "scene").cardTokens).toEqual([{ cardId: "card:dark-army", count: 5 }]);
    expect(expire(tokens, "session").cardTokens).toEqual([{ cardId: "card:dark-army", count: 5 }]);
    expect(expire(tokens, "shortRest").cardTokens).toEqual(tokens.cardTokens);
  });

  it("leaves a sheet with nothing lasting until the scene as it was (same class state)", () => {
    const plain = { ...base, classState: { martial: { known: ["quick"], focus: 1 } } };
    expect(expire(plain, "scene").classState).toBe(plain.classState);
    expect(expire(base, "scene").classState).toBe(base.classState);
  });
});

describe("Devout (CB p.44): roll an additional Prayer Die and discard the lowest", () => {
  const seraph = (subclassRank: "foundation" | "specialization" | "mastery", subclassId = "divine-wielder") =>
    ({ ...base, classId: "seraph", subclassId, subclassRank, traits: { ...base.traits, strength: 2 } }) as typeof base;
  const rolls = (values: number[]) => {
    let i = 0;
    return () => values[i++]!;
  };
  const dice = (s: typeof base) => s.heldDice.filter((d) => d.kind === "prayer").map((d) => d.value);

  it("holds Devout with the specialization or the mastery of the Divine Wielder only", () => {
    expect(hasDevout(seraph("foundation"))).toBe(false);
    expect(hasDevout(seraph("specialization"))).toBe(true);
    expect(hasDevout(seraph("mastery"))).toBe(true);
    expect(hasDevout(seraph("specialization", "winged-sentinel"))).toBe(false);
  });

  it("rolls the Spellcast trait's dice and no more without Devout", () => {
    const sheet = seraph("foundation");
    expect(sheet.traits.strength).toBe(2);
    // The Divine Wielder casts with Strength (CB p.44): two d4s.
    expect(dice(rollPrayerDice(sheet, rolls([3, 1, 4])))).toEqual([3, 1]);
  });

  it("with Devout rolls one more die and discards the lowest (3, 1, 4 -> 3 and 4)", () => {
    const after = rollPrayerDice(seraph("specialization"), rolls([3, 1, 4]));
    expect(dice(after)).toEqual([3, 4]);
    expect(after.heldDice.map((d) => d.until)).toEqual(["session", "session"]);
  });

  it("with Devout and a lowest die first (1, 2, 4 -> 2 and 4); a tie drops one of them", () => {
    expect(dice(rollPrayerDice(seraph("mastery"), rolls([1, 2, 4])))).toEqual([2, 4]);
    expect(dice(rollPrayerDice(seraph("mastery"), rolls([2, 2, 3])))).toEqual([2, 3]);
  });

  it("with Devout and a Spellcast trait of 0 keeps no die (the extra die is the one discarded)", () => {
    const sheet = { ...seraph("specialization"), traits: { ...base.traits, strength: 0 } } as typeof base;
    expect(dice(rollPrayerDice(sheet, rolls([4])))).toEqual([]);
  });
});
