import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import {
  applyLevelUp,
  availableOptions,
  cardsWithin,
  isMarked,
  LevelUpRuleError,
  revertLevelUp,
  validateLevelUp,
  type LevelUpChoice,
  type PickChoice,
} from "@/lib/domain/level-up";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import type { CharacterSheet } from "@/lib/validation/characters";

/** A level-1 Warrior (Blade & Bone) holding two level-1 cards, flagged to level up. */
const BASE: CharacterSheet = readSheet({
  schemaVersion: 2,
  name: "Tabby",
  pronouns: "",
  description: "",
  level: 1,
  classId: "warrior",
  subclassId: "call-of-the-brave",
  ancestry: { kind: "single", id: "dwarf" },
  communityId: "ridgeborne",
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  traitMarks: {},
  evasion: 11,
  hpMax: 6,
  hp: 2,
  stressMax: 6,
  stress: 1,
  hope: 2,
  scars: 0,
  armorMarked: 0,
  proficiency: 1,
  primaryWeaponId: "broadsword",
  inventory: [],
  gold: { handfuls: 1, bags: 0, chest: false },
  experiences: [
    { id: "exp-a", name: "Sellsword", value: 2 },
    { id: "exp-b", name: "Lockpick", value: 2 },
  ],
  domainCards: { owned: ["blade-1", "bone-1"].map(cardOf), loadout: ["blade-1", "bone-1"].map(cardOf) },
  background: [],
  connections: [],
  notes: "",
  levelUpPending: true,
});

/** Shorthand "domain-level[-n]" → a real card id of that domain and level (the n-th, 1-based). */
function cardOf(spec: string): string {
  const [domain, level, n = "1"] = spec.split("-");
  const cards = DOMAIN_CARDS.filter((c) => c.domain === domain && c.level === Number(level)).sort((a, b) => a.id.localeCompare(b.id));
  const card = cards[Number(n) - 1];
  if (!card) throw new Error(`no card ${spec}`);
  return card.id;
}

const CTX = { allowExpansion: false };
let ids = 0;
const apply = (sheet: CharacterSheet, choice: LevelUpChoice) => applyLevelUp(sheet, choice, { ...CTX, newId: () => `new-${++ids}` });

/** A valid card of `level` or lower the sheet doesn't own (Blade first). */
function freshCard(sheet: CharacterSheet, level: number, not: string[] = []): string {
  const card = cardsWithin(sheet, level, level, ["core"]).find((c) => !not.includes(c.id));
  if (!card) throw new Error("no fresh card");
  return card.id;
}

const hp: PickChoice = { option: "hp", tier: 2 };
const stress: PickChoice = { option: "stress", tier: 2 };
const evasion: PickChoice = { option: "evasion", tier: 2 };

/** Levels up with the given picks plus a fresh level card (and an Experience name when due). */
function up(sheet: CharacterSheet, picks: PickChoice[], extra: Partial<LevelUpChoice> = {}): CharacterSheet {
  const cardId = extra.cardId ?? freshCard(sheet, sheet.level + 1, picks.flatMap((p) => p.targets ?? []));
  return apply(sheet, { picks, cardId, experienceName: `Exp ${sheet.level + 1}`, ...extra });
}

/** Levels up to `level` taking simple picks from the lowest tier with free slots; flagged for the next level. */
function climb(sheet: CharacterSheet, level: number): CharacterSheet {
  let s = sheet;
  while (s.level < level) {
    const free = availableOptions(s).filter((o) => o.blocked === null && o.cost === 1 && ["hp", "stress", "evasion", "experiences"].includes(o.option));
    const picks: PickChoice[] = [];
    for (const o of free) {
      for (let k = 0; k < o.slots - o.used && picks.length < 2; k++) {
        picks.push(o.option === "experiences" ? { option: o.option, tier: o.tier, targets: ["exp-a", "exp-b"] } : { option: o.option, tier: o.tier });
      }
    }
    s = up(s, picks);
  }
  return { ...s, levelUpPending: true }; // the GM called for the next level
}

describe("achievements (CB 109)", () => {
  it("level 2 adds an Experience at +2 and +1 Proficiency, and clears the flag", () => {
    const s = up(BASE, [hp, stress]);
    expect(s.level).toBe(2);
    expect(s.proficiency).toBe(2);
    expect(s.experiences.at(-1)).toMatchObject({ name: "Exp 2", value: 2 });
    expect(s.advancements.at(-1)?.experienceId).toBe(s.experiences.at(-1)?.id);
    expect(s.levelUpPending).toBe(false);
  });

  it("levels 3 and 4 have no achievement", () => {
    const s = climb(BASE, 3);
    expect(s.proficiency).toBe(2);
    expect(s.experiences).toHaveLength(3);
    expect(s.advancements.at(-1)?.experienceId).toBeUndefined();
  });

  it("an achievement level needs the Experience's name", () => {
    expect(validateLevelUp(BASE, { picks: [hp, stress], cardId: freshCard(BASE, 2) }, CTX)).toContain("Name the new Experience (up to 80 characters).");
  });

  it("level 10 is the last", () => {
    expect(validateLevelUp({ ...BASE, level: 10 }, { picks: [hp, stress], cardId: "x" }, CTX)).toEqual(["Level 10 is the highest level."]);
  });
});

describe("every option applies and reverts exactly", () => {
  const cases: [string, (s: CharacterSheet) => PickChoice, (before: CharacterSheet, after: CharacterSheet) => void][] = [
    ["traits", () => ({ option: "traits", tier: 2, targets: ["agility", "instinct"] }), (b, a) => {
      expect(a.traits.agility).toBe(b.traits.agility + 1);
      expect(a.traits.instinct).toBe(b.traits.instinct + 1);
      expect(isMarked(a, "agility") && isMarked(a, "instinct")).toBe(true);
    }],
    ["hp", () => hp, (b, a) => expect(a.hpMax).toBe(b.hpMax + 1)],
    ["stress", () => stress, (b, a) => expect(a.stressMax).toBe(b.stressMax + 1)],
    ["experiences", () => ({ option: "experiences", tier: 2, targets: ["exp-a", "exp-b"] }), (b, a) => {
      expect(a.experiences.slice(0, 2).map((e) => e.value)).toEqual([3, 3]);
    }],
    ["domainCard", (s) => ({ option: "domainCard", tier: 2, targets: [freshCard(s, 2, [])] }), (b, a) => expect(a.domainCards.owned).toHaveLength(b.domainCards.owned.length + 2)],
    ["evasion", () => evasion, (b, a) => expect(a.evasion).toBe(b.evasion + 1)],
  ];

  for (const [name, pick, check] of cases) {
    it(name, () => {
      const p = pick(BASE);
      const other = p.option === "hp" ? stress : hp;
      const cardId = freshCard(BASE, 2, p.targets ?? []);
      const after = up(BASE, [p, other], { cardId });
      check(BASE, after);
      expect(revertLevelUp(after)).toEqual(BASE);
    });
  }

  it("subclass, proficiency and multiclass (tier 3)", () => {
    const at4 = climb(BASE, 4);
    const sub = up(at4, [{ option: "subclass", tier: 3 }, { ...hp, tier: 3 }]);
    expect(sub.subclassRank).toBe("specialization");
    expect(revertLevelUp(sub)).toEqual(at4);

    const prof = up(at4, [{ option: "proficiency", tier: 3 }]);
    expect(prof.proficiency).toBe(at4.proficiency + 2); // achievement + pick
    expect(revertLevelUp(prof)).toEqual(at4);

    const multiclass = { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" };
    const multi = up(at4, [{ option: "multiclass", tier: 3 }], { multiclass });
    expect(multi.multiclass).toEqual(multiclass);
    expect(revertLevelUp(multi)).toEqual(at4);
  });

  it("the card trade swaps in place and back", () => {
    const out = BASE.domainCards.owned[0]!;
    const into = DOMAIN_CARDS.find((c) => c.domain === "bone" && c.level === 1 && !BASE.domainCards.owned.includes(c.id))!.id;
    const after = up(BASE, [hp, stress], { cardId: cardOf("blade-2"), trade: { out, in: into } });
    expect(after.domainCards.owned[0]).toBe(into);
    expect(after.domainCards.loadout[0]).toBe(into);
    expect(after.advancements.at(-1)).toMatchObject({ tradeOut: out, tradeIn: into });
    expect(revertLevelUp(after)).toEqual(BASE);
  });

  it("undo is repeatable down to the first level", () => {
    const at4 = climb(BASE, 4);
    const at3 = revertLevelUp(at4);
    const at2 = revertLevelUp(at3);
    const at1 = revertLevelUp(at2);
    expect([at3.level, at2.level, at1.level]).toEqual([3, 2, 1]);
    expect(at1).toEqual(BASE);
    expect(() => revertLevelUp(at1)).toThrow(LevelUpRuleError);
  });

  it("refuses to undo a level set by hand", () => {
    const at2 = up(BASE, [hp, stress]);
    expect(() => revertLevelUp({ ...at2, level: 3 })).toThrow(LevelUpRuleError);
  });
});

describe("picks (CB 110)", () => {
  it("needs exactly two picks; Proficiency and multiclass take both", () => {
    const card = freshCard(BASE, 2);
    const at4 = climb(BASE, 4);
    expect(validateLevelUp(BASE, { picks: [hp], cardId: card, experienceName: "x" }, CTX)).toContain("Choose two advancements (Proficiency and multiclass take both).");
    expect(validateLevelUp(at4, { picks: [{ option: "proficiency", tier: 3 }, hp], cardId: freshCard(at4, 5), experienceName: "x" }, CTX)).toContain(
      "Choose two advancements (Proficiency and multiclass take both).",
    );
  });

  it("tier 3 options are locked before level 5; lower tiers stay open", () => {
    const options = availableOptions(BASE);
    expect(options.find((o) => o.tier === 3 && o.option === "hp")?.blocked).toMatch(/Reach level 5/);
    expect(options.some((o) => o.option === "subclass" && o.tier === 2)).toBe(false);
    const at4 = climb(BASE, 4);
    const open = availableOptions(at4).filter((o) => o.blocked === null);
    expect(open.some((o) => o.tier === 2)).toBe(true);
    expect(open.some((o) => o.tier === 3 && o.option === "multiclass")).toBe(true);
  });

  it("a slot can't be marked twice beyond its count", () => {
    const at2 = up(BASE, [hp, hp]);
    expect(availableOptions(at2).find((o) => o.tier === 2 && o.option === "hp")).toMatchObject({ used: 2, blocked: "All its slots are marked." });
    expect(validateLevelUp(at2, { picks: [hp, stress], cardId: freshCard(at2, 3) }, CTX).join()).toMatch(/every slot in tier 2 is marked/);
  });
});

describe("dcm-mf7: trait marks", () => {
  const traits = (a: string, b: string, tier = 2): PickChoice => ({ option: "traits", tier, targets: [a, b] });

  it("takes exactly two distinct traits", () => {
    const card = freshCard(BASE, 2);
    expect(validateLevelUp(BASE, { picks: [traits("agility", "agility"), hp], cardId: card, experienceName: "x" }, CTX)).toContain("Choose two different character traits.");
    expect(validateLevelUp(BASE, { picks: [{ option: "traits", tier: 2, targets: ["agility"] }, hp], cardId: card, experienceName: "x" }, CTX)).toContain(
      "Choose two different character traits.",
    );
  });

  it("marked traits are refused in later picks, in the same level too", () => {
    const at2 = up(BASE, [traits("agility", "instinct"), hp]);
    expect(validateLevelUp(at2, { picks: [traits("agility", "strength"), stress], cardId: freshCard(at2, 3) }, CTX)).toContain("agility is marked this tier.");
    expect(validateLevelUp(BASE, { picks: [traits("agility", "strength"), traits("strength", "finesse")], cardId: freshCard(BASE, 2), experienceName: "x" }, CTX)).toContain(
      "strength is marked this tier.",
    );
  });

  it("marks clear on reaching level 5 and 8, and undo brings them back", () => {
    const at2 = up(BASE, [traits("agility", "instinct"), hp]);
    const at4 = climb(at2, 4);
    expect(isMarked(at4, "agility")).toBe(true);
    const at5 = up(at4, [traits("agility", "instinct", 3), { ...hp, tier: 3 }]);
    expect(at5.traits.agility).toBe(BASE.traits.agility + 2);
    expect(at5.traitMarks).toEqual({ agility: 2, instinct: 2 });
    expect(revertLevelUp(at5)).toEqual(at4);

    const plain5 = up(at4, [{ ...hp, tier: 3 }, { ...stress, tier: 3 }]);
    expect(plain5.traitMarks).toEqual({});
    expect(revertLevelUp(plain5).traitMarks).toEqual({ agility: 1, instinct: 1 });

    const at7 = climb(at5, 7);
    const at8 = up(at7, [{ ...hp, tier: 4 }, { ...stress, tier: 4 }]);
    expect(at8.traitMarks).toEqual({});
    expect(revertLevelUp(at8)).toEqual(at7);
  });
});

describe("subclass and multiclass crossing out (CB 110-111)", () => {
  const multiclass = { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" };

  it("an upgraded subclass crosses out that tier's multiclass", () => {
    const at5 = up(climb(BASE, 4), [{ option: "subclass", tier: 3 }, { ...hp, tier: 3 }]);
    const options = availableOptions(at5);
    expect(options.find((o) => o.tier === 3 && o.option === "multiclass")?.blocked).toMatch(/upgraded subclass/);
  });

  it("multiclass crosses out its tier's subclass, mastery and the other multiclass", () => {
    const at5 = up(climb(BASE, 4), [{ option: "multiclass", tier: 3 }], { multiclass });
    const at7 = climb(at5, 7);
    const options = availableOptions(at7);
    expect(options.find((o) => o.tier === 3 && o.option === "subclass")?.blocked).toMatch(/Multiclassing in this tier/);
    expect(options.find((o) => o.tier === 4 && o.option === "multiclass")?.blocked).toBe("You can multiclass only once.");
    // Specialization is still open in tier 4, mastery never.
    const at8 = up(at7, [{ option: "subclass", tier: 4 }, { ...hp, tier: 4 }]);
    expect(at8.subclassRank).toBe("specialization");
    expect(availableOptions(at8).find((o) => o.tier === 4 && o.option === "subclass")?.blocked).not.toBeNull();
  });

  it("multiclass needs a different class and a new domain from it", () => {
    const at4 = climb(BASE, 4);
    const v = (m: typeof multiclass) => validateLevelUp(at4, { picks: [{ option: "multiclass", tier: 3 }], cardId: freshCard(at4, 5), experienceName: "x", multiclass: m }, CTX);
    expect(v(multiclass)).toEqual([]);
    expect(v({ ...multiclass, classId: "warrior", domainId: "blade" })).toContain("Multiclass into a different class.");
    expect(v({ classId: "guardian", domainId: "blade", subclassId: "stalwart" })).toContain("Choose a domain you don't already have.");
    expect(v({ ...multiclass, subclassId: "stalwart" })).toContain("Choose a foundation card from that class's subclasses.");
  });
});

describe("domain card caps (CB 110-111)", () => {
  it("the level card is the level or lower from the class domains", () => {
    const at2 = up(BASE, [hp, stress]);
    expect(validateLevelUp(at2, { picks: [hp, stress], cardId: cardOf("blade-4") }, CTX).join()).toMatch(/out of reach/);
    expect(validateLevelUp(at2, { picks: [hp, stress], cardId: cardOf("codex-1") }, CTX).join()).toMatch(/out of reach/);
    expect(validateLevelUp(at2, { picks: [{ ...hp, tier: 2 }, stress], cardId: cardOf("blade-3") }, CTX).join()).not.toMatch(/out of reach/);
  });

  it("the tier 2 option stops at level 4, even at level 7", () => {
    const at6 = climb(BASE, 6);
    const pick = (id: string): PickChoice => ({ option: "domainCard", tier: 2, targets: [id] });
    expect(validateLevelUp(at6, { picks: [pick(cardOf("blade-5")), { ...evasion, tier: 3 }], cardId: cardOf("bone-7") }, CTX).join()).toMatch(/out of reach/);
    expect(validateLevelUp(at6, { picks: [{ ...pick(cardOf("blade-5")), tier: 3 }, { ...evasion, tier: 3 }], cardId: cardOf("bone-7") }, CTX)).toEqual([]);
  });

  it("the multiclass domain stops at half the level rounded up", () => {
    const multiclass = { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" };
    const at5 = up(climb(BASE, 4), [{ option: "multiclass", tier: 3 }], { multiclass });
    expect(validateLevelUp(at5, { picks: [{ ...hp, tier: 3 }, { ...stress, tier: 3 }], cardId: cardOf("codex-3") }, CTX)).toEqual([]);
    expect(validateLevelUp(at5, { picks: [{ ...hp, tier: 3 }, { ...stress, tier: 3 }], cardId: cardOf("codex-4") }, CTX).join()).toMatch(/out of reach/);
  });

  it("a trade takes a card of equal or lower level", () => {
    const at2 = up(BASE, [hp, stress], { cardId: cardOf("blade-2") });
    const trade = { out: BASE.domainCards.owned[0]!, in: cardOf("bone-2") };
    expect(validateLevelUp(at2, { picks: [hp, stress], cardId: cardOf("blade-3"), trade }, CTX)).toContain(
      `Trade ${DOMAIN_CARDS.find((c) => c.id === trade.out)!.name} for a card of level 1 or lower.`,
    );
  });
});

describe("polish 27: Brawler Combo Die (HF 10)", () => {
  const BRAWLER: CharacterSheet = { ...BASE, classId: "brawler", subclassId: "juggernaut" };
  const combo = (tier = 2): PickChoice => ({ option: "comboDie", tier });

  it("is offered only to a Brawler (or a Brawler multiclass), one slot per tier", () => {
    expect(availableOptions(BASE).some((o) => o.option === "comboDie")).toBe(false);
    expect(availableOptions(BRAWLER).filter((o) => o.option === "comboDie").map((o) => [o.tier, o.slots])).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    const multi = { ...BASE, multiclass: { classId: "brawler", domainId: "valor", subclassId: "juggernaut" } };
    expect(availableOptions(multi).some((o) => o.option === "comboDie")).toBe(true);
    expect(validateLevelUp(BASE, { picks: [combo(), hp], cardId: freshCard(BASE, 2), experienceName: "x" }, CTX)).toContain("Only a Brawler has a Combo Die.");
  });

  it("raises the die one step, d4 → d6 → d8, and refuses a second pick in the same tier", () => {
    const at2 = up(BRAWLER, [combo(), hp]);
    expect(at2.classState.comboDie).toBe(6);
    expect(availableOptions(at2).find((o) => o.tier === 2 && o.option === "comboDie")?.blocked).toBe("All its slots are marked.");
    expect(validateLevelUp(at2, { picks: [combo(), stress], cardId: freshCard(at2, 3) }, CTX).join()).toMatch(/every slot in tier 2 is marked/);
    const at5 = up(climb(at2, 4), [combo(3), { option: "hp", tier: 3 }]);
    expect(at5.classState.comboDie).toBe(8);
  });

  it("revert lowers it one step; back at d4 the field goes", () => {
    const at2 = up(BRAWLER, [combo(), hp]);
    const back = revertLevelUp(at2);
    expect(back.classState.comboDie).toBeUndefined();
    expect(back.classState).toEqual(BRAWLER.classState);
    const at5 = up(climb(at2, 4), [combo(3), { option: "hp", tier: 3 }]);
    expect(revertLevelUp(at5).classState.comboDie).toBe(6);
  });
});
