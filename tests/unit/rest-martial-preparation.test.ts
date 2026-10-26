// Martial Preparation (Call of the Slayer mastery, CB 48; dcm-bxp.63): the pure rules.
import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { frameRestMoves, MARTIAL_PREPARATION_MOVE } from "@/lib/domain/rest/frame-hooks";
import { allowedMoves, applyMoves, interruptedMoves, validateChoice, type RestChoice } from "@/lib/domain/rest";
import {
  canStore,
  gainMartialPreparationDie,
  holdsMartialPreparation,
  holdsSlayer,
  holdsSlayerFeature,
  sessionEndFeatures,
  slayerDice,
  spendSlayerDice,
  storeSlayerDie,
} from "@/lib/domain/session-features";
import { RuleError } from "@/lib/errors/app-error";
import type { CharacterSheet } from "@/lib/validation/characters";

function sheet(name: string, extra: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    ...readSheet({
      schemaVersion: 2,
      name,
      pronouns: "",
      description: "",
      level: 5,
      classId: "warrior",
      subclassId: "call-of-the-brave",
      ancestry: { kind: "single", id: "human" },
      communityId: "highborne",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      traitMarks: {},
      evasion: 11,
      hpMax: 6,
      hp: 0,
      stressMax: 6,
      stress: 0,
      hope: 2,
      scars: 0,
      armorMarked: 0,
      proficiency: 2,
      primaryWeaponId: "broadsword",
      inventory: [],
      gold: { handfuls: 1, bags: 0, chest: false },
      experiences: [],
      domainCards: { owned: [], loadout: [] },
      background: [],
      connections: [],
      notes: "",
    }),
    ...extra,
  };
}

const slayer = (rank: CharacterSheet["subclassRank"]) => sheet("Kael", { subclassId: "call-of-the-slayer", subclassRank: rank });
const never = () => {
  throw new Error("Martial Preparation rolls no die");
};

describe("who gives the party the move", () => {
  it("a Call of the Slayer PC at mastery rank only, never through a multiclass (CB 111)", () => {
    expect(holdsMartialPreparation(slayer("mastery"))).toBe(true);
    expect(holdsMartialPreparation(slayer("specialization"))).toBe(false);
    expect(holdsMartialPreparation(slayer("foundation"))).toBe(false);
    expect(
      holdsMartialPreparation(sheet("Mix", { subclassRank: "mastery", multiclass: { classId: "warrior", domainId: "blade", subclassId: "call-of-the-slayer" } })),
    ).toBe(false);
  });

  it("frameRestMoves adds it for every PC on either rest when the party has one, in any frame", () => {
    expect(frameRestMoves({ frameId: "witherwild", transformations: false, warlock: false }).extra).toEqual([]);
    expect(frameRestMoves({ frameId: "witherwild", transformations: false, warlock: false, martialPreparation: true }).extra).toEqual([MARTIAL_PREPARATION_MOVE]);
    // Beast Feast forbids moves that clear Stress, HP or Hope (CB 278); Martial Preparation is none of them.
    const feast = frameRestMoves({ frameId: "beast-feast", transformations: false, warlock: false, martialPreparation: true });
    for (const kind of ["short", "long"] as const) {
      expect(allowedMoves(kind, feast.extra, feast.forbidden)).toContain("martialPreparation");
      expect(() => validateChoice(kind, "a", [{ move: "martialPreparation" }, { move: "martialPreparation" }], feast.extra, feast.forbidden)).not.toThrow();
    }
    expect(() => validateChoice("short", "a", [{ move: "martialPreparation" }, { move: "prepare" }])).toThrow(RuleError);
    expect(() => validateChoice("short", "a", [{ move: "martialPreparation", targetId: "b" }, { move: "prepare" }], ["martialPreparation"])).toThrow(RuleError);
  });
});

describe("the move: a d6 Slayer Die for each taker", () => {
  it("the Slayer's die joins their pool, capped at Proficiency; an ally holds up to their own Proficiency", () => {
    const choices: RestChoice[] = [
      { characterId: "s", moves: [{ move: "martialPreparation" }, { move: "prepare" }] },
      { characterId: "a", moves: [{ move: "martialPreparation" }, { move: "martialPreparation" }] },
      { characterId: "n", moves: [{ move: "prepare" }, { move: "prepare" }] },
    ];
    const input = {
      s: { ...slayer("mastery"), sessionFeatures: { slayerDice: 2 } },
      a: sheet("Ally", { proficiency: 1 }),
      n: sheet("None"),
    };
    const { sheets, lines } = applyMoves("short", input, choices, never);
    expect(slayerDice(sheets.s)).toBe(2);
    expect(slayerDice(sheets.a)).toBe(1);
    expect(slayerDice(sheets.n)).toBe(0);
    expect(lines.s).toContain("Martial Preparation: Slayer Dice full (2/2)");
    expect(lines.a).toEqual(["Martial Preparation: +1 Slayer Die (1/1)", "Martial Preparation: Slayer Dice full (1/1)"]);
  });

  it("gainMartialPreparationDie gains one die below the cap and nothing at it", () => {
    const first = gainMartialPreparationDie(sheet("Ally"));
    expect(first).toMatchObject({ gained: true, held: 1, capacity: 2 });
    const second = gainMartialPreparationDie(first.sheet);
    expect(second).toMatchObject({ gained: true, held: 2, capacity: 2 });
    const third = gainMartialPreparationDie(second.sheet);
    expect(third).toMatchObject({ gained: false, held: 2, capacity: 2 });
    expect(third.sheet).toBe(second.sheet);
  });

  it("an interrupted long rest keeps it (a move of either rest, CB 105)", () => {
    expect(interruptedMoves("long", [{ move: "martialPreparation" }, { move: "clearAllStress" }])).toEqual([{ move: "martialPreparation" }, { move: "clearStress" }]);
  });
});

describe("an ally's Slayer Die", () => {
  const ally = sheet("Ally", { sessionFeatures: { slayerDice: 1 } });

  it("can be spent like the Slayer's (the dice box shows it: holdsSlayer), but the ally never stores dice", () => {
    expect(holdsSlayer(ally)).toBe(true);
    expect(holdsSlayer(sheet("Ally"))).toBe(false);
    expect(holdsSlayerFeature(ally)).toBe(false);
    expect(slayerDice(spendSlayerDice(ally, 1))).toBe(0);
    expect(canStore(ally, "successHope", "action")).toBe(false);
    expect(() => storeSlayerDie(ally, { hopeGained: true, entryId: "r1" })).toThrow(RuleError);
  });

  it("clears at session end for a Hope", () => {
    const { sheet: next, notes } = sessionEndFeatures(ally);
    expect(slayerDice(next)).toBe(0);
    expect(next.hope).toBe(ally.hope + 1);
    expect(notes).toEqual(["Ally cleared 1 Slayer Die: +1 Hope"]);
  });
});
