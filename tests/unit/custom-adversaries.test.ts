import { describe, expect, it } from "vitest";

import { blank, changedFields, fromSrd, IMPROVISED, validateCustom, withImprovisedStats } from "@/lib/adversaries/custom";
import { RuleError } from "@/lib/errors/app-error";
import { ADVERSARIES } from "@/lib/srd/adversaries";

// D8 A5: custom adversaries, pure helpers. CB p.208 "Improvised Statistics by Tier".

const byId = (id: string) => ADVERSARIES.find((a) => a.id === id)!;

function ruleCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (e) {
    if (e instanceof RuleError) return e.code;
    throw e;
  }
}

describe("improvised statistics (CB p.208)", () => {
  it("prints the table's attack modifier, Difficulty and thresholds per tier", () => {
    expect([1, 2, 3, 4].map((t) => IMPROVISED[t as 1 | 2 | 3 | 4])).toMatchObject([
      { modifier: 1, difficulty: 11, major: 7, severe: 12, damageRange: "1d6+2 to 1d12+4" },
      { modifier: 2, difficulty: 14, major: 10, severe: 20, damageRange: "2d6+3 to 2d12+4" },
      { modifier: 3, difficulty: 17, major: 20, severe: 32, damageRange: "3d8+3 to 3d12+5" },
      { modifier: 4, difficulty: 20, major: 25, severe: 45, damageRange: "4d8+10 to 4d12+15" },
    ]);
  });

  it("prefills a blank block of the tier and type", () => {
    const solo = blank(4, "Solo");
    expect(solo).toMatchObject({ name: "New adversary", tier: 4, type: "Solo", difficulty: 20, thresholds: { major: 25, severe: 45 } });
    expect(solo.attack).toEqual({ modifier: 4, name: "Attack", range: "Melee", damage: "4d8+10 phy" });
    expect(solo.features).toEqual([]);
    expect(solo.hp).toBeGreaterThanOrEqual(1);
    expect(validateCustom(solo)).toEqual(solo);
  });

  it("gives a blank Minion 1 HP, no thresholds and a flat damage value; a Horde a creatures-per-HP value", () => {
    const minion = blank(1, "Minion");
    expect(minion).toMatchObject({ hp: 1, thresholds: { major: null, severe: null }, attack: { damage: "1 phy" } });
    expect(blank(2, "Horde").hordePerHp).toBe(2);
    expect(blank(2, "Standard").hordePerHp).toBeUndefined();
  });

  it("re-tiers a duplicate: modifier, Difficulty and thresholds replaced, everything else kept", () => {
    const bear = fromSrd(byId("bear"));
    const t3 = withImprovisedStats(bear, 3);
    expect(t3).toMatchObject({ tier: 3, difficulty: 17, thresholds: { major: 20, severe: 32 }, attack: { modifier: 3, damage: bear.attack.damage } });
    expect(t3.hp).toBe(bear.hp);
    expect(t3.features).toEqual(bear.features);
  });
});

describe("fromSrd", () => {
  it("copies a stat block with its origin", () => {
    const bear = fromSrd(byId("bear"));
    expect(bear).toMatchObject({ name: "Bear", tier: 1, type: "Bruiser", difficulty: 14, thresholds: { major: 9, severe: 17 }, hp: 7, stress: 2, basedOn: "bear" });
    expect(bear.features.map((f) => f.name)).toEqual(byId("bear").features.map((f) => f.name));
  });

  it("keeps what the custom row cannot store as such: Stress None, a dice attack bonus, special countdowns", () => {
    const abomination = fromSrd(byId("outer-realms-abomination"));
    expect(abomination.attack).toMatchObject({ modifier: 0, name: "Massive Pseudopod (+2d4)" });
    const withCountdown = ADVERSARIES.flatMap((a) => a.features.map((f) => ({ a, f }))).filter(({ f }) => f.countdown !== undefined);
    const plain = withCountdown.find(({ f }) => /^Countdown \(\d+\)$/.test(f.countdown!))!;
    const loop = withCountdown.find(({ f }) => f.countdown!.includes("Loop"))!;
    const plainCopy = fromSrd(plain.a).features.find((f) => f.name === plain.f.name)!;
    expect(plainCopy.countdown).toBe(Number(/\d+/.exec(plain.f.countdown!)![0]));
    expect(plainCopy.text).toBe(plain.f.text);
    const loopCopy = fromSrd(loop.a).features.find((f) => f.name === loop.f.name)!;
    expect(loopCopy.countdown).toBeUndefined();
    expect(loopCopy.text.startsWith(`${loop.f.countdown}: `)).toBe(true);
    const noStress = ADVERSARIES.find((a) => a.stress === null);
    if (noStress) expect(fromSrd(noStress).stress).toBe(0);
  });

  it("produces a valid block for every SRD adversary", () => {
    for (const def of ADVERSARIES) expect([def.id, ruleCode(() => validateCustom(fromSrd(def)))]).toEqual([def.id, null]);
  });
});

describe("validateCustom", () => {
  const bear = validateCustom(fromSrd(byId("bear")));

  it("trims texts and drops basedOn and a hordePerHp off a non-Horde", () => {
    const out = validateCustom({ ...bear, name: "  Cave Bear ", motives: " Maul ", hordePerHp: 3 });
    expect(out.name).toBe("Cave Bear");
    expect(out.motives).toBe("Maul");
    expect(out).not.toHaveProperty("hordePerHp");
    expect(out).not.toHaveProperty("basedOn");
  });

  it.each([
    ["empty name", { name: "  " }],
    ["long name", { name: "x".repeat(81) }],
    ["HP 0", { hp: 0 }],
    ["HP 31", { hp: 31 }],
    ["Stress 21", { stress: 21 }],
    ["Tier 0", { tier: 0 }],
    ["fractional Difficulty", { difficulty: 12.5 }],
    ["Severe not above Major", { thresholds: { major: 10, severe: 10 } }],
    ["long description", { description: "x".repeat(2001) }],
    ["unknown range", { attack: { modifier: 1, name: "Claws", range: "Adjacent", damage: "1d8 phy" } }],
    ["unnamed attack", { attack: { modifier: 1, name: " ", range: "Melee", damage: "1d8 phy" } }],
    ["21 features", { features: Array.from({ length: 21 }, (_, i) => ({ name: `F${i}`, kind: "passive" as const, text: "" })) }],
    ["unnamed feature", { features: [{ name: "", kind: "passive" as const, text: "x" }] }],
    ["long feature text", { features: [{ name: "F", kind: "passive" as const, text: "x".repeat(2001) }] }],
    ["Fear cost 0", { features: [{ name: "F", kind: "action" as const, text: "x", fearCost: 0 }] }],
    ["7 Experiences", { experiences: Array.from({ length: 7 }, (_, i) => ({ name: `E${i}`, value: 2 })) }],
  ])("refuses %s with ENCOUNTER_RULE", (_label, patch) => {
    expect(ruleCode(() => validateCustom({ ...bear, ...patch }))).toBe("ENCOUNTER_RULE");
  });

  it("accepts thresholds of None and Stress 0", () => {
    expect(validateCustom({ ...bear, thresholds: { major: null, severe: null }, stress: 0 }).thresholds).toEqual({ major: null, severe: null });
  });
});

describe("changedFields", () => {
  it("lists only the edited fields, features as a whole", () => {
    const bear = validateCustom(fromSrd(byId("bear")));
    const edited = { ...bear, name: "Cave Bear", hp: 9, features: [...bear.features, { name: "Roar", kind: "action" as const, text: "Loud." }] };
    expect(changedFields(bear, edited)).toEqual(["name", "hp", "features"]);
    expect(changedFields(bear, { ...bear })).toEqual([]);
    expect(changedFields({ ...bear, type: "Horde", hordePerHp: 2 }, { ...bear, type: "Horde" })).toEqual(["hordePerHp"]);
  });
});
