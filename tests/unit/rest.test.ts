import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import type { ClassFeatures } from "@/lib/domain/class-features/types";
import { FEAST_FORBIDDEN, frameRestMoves } from "@/lib/domain/rest/frame-hooks";
import {
  allowedMoves,
  applyMoves,
  interruptedMoves,
  mustLongRest,
  restedSheet,
  restFear,
  shortRestsSinceLong,
  validateChoice,
  type RestChoice,
} from "@/lib/domain/rest";
import { RuleError } from "@/lib/errors/app-error";
import type { CharacterSheet } from "@/lib/validation/characters";

function sheet(name: string, level: number, extra: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    ...readSheet({
      schemaVersion: 2,
      name,
      pronouns: "",
      description: "",
      level,
      classId: "warrior",
      subclassId: "call-of-the-brave",
      ancestry: { kind: "single", id: "human" },
      communityId: "highborne",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      traitMarks: {},
      evasion: 11,
      hpMax: 12,
      hp: 12,
      stressMax: 12,
      stress: 12,
      hope: 0,
      scars: 0,
      armorMarked: 12,
      proficiency: 1,
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

/** Every d4 rolls this value. */
const fixed = (value: number) => () => value;

describe("short rest moves: 1d4 + tier (CB 105)", () => {
  // Tier 1 = level 1, 2 = levels 2-4, 3 = 5-7, 4 = 8-10.
  it.each([
    [1, 1],
    [3, 2],
    [6, 3],
    [9, 4],
  ])("level %i clears 1d4 + tier %i", (level, tier) => {
    const choices: RestChoice[] = [{ characterId: "a", moves: [{ move: "tendToWounds" }, { move: "clearStress" }] }];
    const { sheets } = applyMoves("short", { a: sheet("Ash", level) }, choices, fixed(3));
    expect(sheets.a.hp).toBe(12 - (3 + tier));
    expect(sheets.a.stress).toBe(12 - (3 + tier));
  });

  it("the same move twice applies twice, with a die each", () => {
    const rolls = [1, 4];
    const rng = () => rolls.shift()!;
    const { sheets, lines } = applyMoves("short", { a: sheet("Ash", 1) }, [{ characterId: "a", moves: [{ move: "repairArmor" }, { move: "repairArmor" }] }], rng);
    expect(sheets.a.armorMarked).toBe(12 - (1 + 1) - (4 + 1));
    expect(lines.a).toHaveLength(2);
  });

  it("clearing never goes below zero", () => {
    const { sheets } = applyMoves("short", { a: sheet("Ash", 9, { stress: 2 }) }, [{ characterId: "a", moves: [{ move: "clearStress" }, { move: "prepare" }] }], fixed(4));
    expect(sheets.a.stress).toBe(0);
  });

  it("Tend to Wounds and Repair Armor may target an ally, at the mover's tier", () => {
    const party = { a: sheet("Ash", 5), b: sheet("Bryn", 1) };
    const { sheets, lines } = applyMoves(
      "short",
      party,
      [{ characterId: "a", moves: [{ move: "tendToWounds", targetId: "b" }, { move: "repairArmor", targetId: "b" }] }],
      fixed(2),
    );
    expect(sheets.b.hp).toBe(12 - 5); // 2 + tier 3
    expect(sheets.b.armorMarked).toBe(12 - 5);
    expect(sheets.a.hp).toBe(12);
    expect(lines.b).toEqual(["Ash used Tend to Wounds on them", "Ash used Repair Armor on them"]);
  });

  it("tending an unconscious ally wakes them (CB 106)", () => {
    const party = { a: sheet("Ash", 1), b: sheet("Bryn", 1, { conditions: ["unconscious"] }) };
    const { sheets } = applyMoves("short", party, [{ characterId: "a", moves: [{ move: "tendToWounds", targetId: "b" }, { move: "prepare" }] }], fixed(1));
    expect(sheets.b.conditions).not.toContain("unconscious");
  });

  it("a move on someone who is not resting is skipped", () => {
    const { sheets } = applyMoves("short", { a: sheet("Ash", 1) }, [{ characterId: "a", moves: [{ move: "tendToWounds", targetId: "gone" }, { move: "prepare" }] }], fixed(1));
    expect(sheets.a.hp).toBe(12);
    expect(sheets.a.hope).toBe(1);
  });
});

describe("Prepare (CB 105)", () => {
  it("Prepare alone gains 1 Hope, capped at the Hope slots", () => {
    const { sheets } = applyMoves("short", { a: sheet("Ash", 1, { hope: 4, scars: 1 }) }, [{ characterId: "a", moves: [{ move: "prepare" }, { move: "prepare" }] }], fixed(1));
    expect(sheets.a.hope).toBe(5);
  });

  it("Preparing together gives everyone who chose it 2 Hope", () => {
    const party = { a: sheet("Ash", 1), b: sheet("Bryn", 1), c: sheet("Cato", 1) };
    const choices: RestChoice[] = [
      { characterId: "a", moves: [{ move: "prepareTogether" }, { move: "clearStress" }] },
      { characterId: "b", moves: [{ move: "prepareTogether" }, { move: "clearStress" }] },
      { characterId: "c", moves: [{ move: "prepare" }, { move: "clearStress" }] },
    ];
    const { sheets, lines } = applyMoves("short", party, choices, fixed(1));
    expect([sheets.a.hope, sheets.b.hope, sheets.c.hope]).toEqual([2, 2, 1]);
    expect(lines.a[0]).toBe("Prepare with Bryn: +2 Hope");
  });

  it("Preparing together with nobody else is a plain Prepare", () => {
    const { sheets } = applyMoves("long", { a: sheet("Ash", 1) }, [{ characterId: "a", moves: [{ move: "prepareTogether" }, { move: "clearAllStress" }] }], fixed(1));
    expect(sheets.a.hope).toBe(1);
  });
});

describe("long rest moves (CB 105)", () => {
  it("the All moves clear everything, on yourself or an ally", () => {
    const party = { a: sheet("Ash", 1), b: sheet("Bryn", 1) };
    const { sheets } = applyMoves(
      "long",
      party,
      [
        { characterId: "a", moves: [{ move: "tendToAllWounds", targetId: "b" }, { move: "repairAllArmor" }] },
        { characterId: "b", moves: [{ move: "clearAllStress" }, { move: "workOnProject", countdownId: "cd1" }] },
      ],
      fixed(1),
    );
    expect(sheets.b.hp).toBe(0);
    expect(sheets.a.armorMarked).toBe(0);
    expect(sheets.b.stress).toBe(0);
  });

  it("Work on a Project ticks a countdown, or the GM asks for a roll", () => {
    const { projects, lines } = applyMoves(
      "long",
      { a: sheet("Ash", 1) },
      [{ characterId: "a", moves: [{ move: "workOnProject", countdownId: "cd1" }, { move: "workOnProject" }] }],
      fixed(1),
    );
    expect(projects).toEqual([{ characterId: "a", countdownId: "cd1" }, { characterId: "a" }]);
    expect(lines.a[1]).toMatch(/GM asks/);
  });
});

describe("validateChoice", () => {
  const code = (run: () => void) => {
    try {
      run();
    } catch (e) {
      return e instanceof RuleError ? e.code : "other";
    }
    return null;
  };

  it("takes exactly two moves of the rest's kind", () => {
    expect(code(() => validateChoice("short", "a", [{ move: "clearStress" }, { move: "clearStress" }]))).toBeNull();
    expect(code(() => validateChoice("short", "a", [{ move: "clearStress" }]))).toBe("REST_RULE");
    expect(code(() => validateChoice("short", "a", [{ move: "clearAllStress" }, { move: "prepare" }]))).toBe("REST_RULE");
    expect(code(() => validateChoice("long", "a", [{ move: "clearStress" }, { move: "prepare" }]))).toBe("REST_RULE");
    expect(code(() => validateChoice("short", "a", [{ move: "makeAFeast" }, { move: "prepare" }]))).toBe("REST_RULE");
    expect(code(() => validateChoice("short", "a", [{ move: "makeAFeast" }, { move: "prepare" }], ["makeAFeast"]))).toBeNull();
  });

  it("allows targets only on ally moves, never yourself; countdowns only on projects", () => {
    expect(code(() => validateChoice("short", "a", [{ move: "tendToWounds", targetId: "b" }, { move: "prepare" }]))).toBeNull();
    expect(code(() => validateChoice("short", "a", [{ move: "clearStress", targetId: "b" }, { move: "prepare" }]))).toBe("REST_RULE");
    expect(code(() => validateChoice("short", "a", [{ move: "tendToWounds", targetId: "a" }, { move: "prepare" }]))).toBe("REST_RULE");
    expect(code(() => validateChoice("long", "a", [{ move: "prepare", countdownId: "c" }, { move: "prepare" }]))).toBe("REST_RULE");
  });
});

describe("frame and class moves", () => {
  const code = (run: () => void) => {
    try {
      run();
    } catch (e) {
      return e instanceof RuleError ? e.code : "other";
    }
    return null;
  };
  const rules = (frameId: string, over: Partial<{ transformations: boolean; warlock: boolean }> = {}) =>
    frameRestMoves({ frameId, transformations: false, warlock: false, ...over });

  it("each frame's own move, on either rest: Make a Feast, Keep Watch, halt lycanthropy (transformations on), Tribute", () => {
    expect(rules("beast-feast").extra).toEqual(["makeAFeast"]);
    expect(rules("age-of-umbra").extra).toEqual(["keepWatch"]);
    expect(rules("dark-heart-of-andaluria").extra).toEqual([]);
    expect(rules("dark-heart-of-andaluria", { transformations: true }).extra).toEqual(["haltLycanthropy"]);
    expect(rules("witherwild", { warlock: true }).extra).toEqual(["tribute"]);
    expect(rules("witherwild")).toEqual({ extra: [], forbidden: [] });
  });

  it("Beast Feast forbids the moves that clear Stress, clear Hit Points or gain Hope (CB 278)", () => {
    const feast = rules("beast-feast");
    expect(feast.forbidden).toBe(FEAST_FORBIDDEN);
    expect(allowedMoves("short", feast.extra, feast.forbidden)).toEqual(["repairArmor", "makeAFeast"]);
    expect(allowedMoves("long", feast.extra, feast.forbidden)).toEqual(["repairAllArmor", "workOnProject", "makeAFeast"]);
    expect(code(() => validateChoice("short", "a", [{ move: "clearStress" }, { move: "makeAFeast" }], feast.extra, feast.forbidden))).toBe("REST_RULE");
    expect(code(() => validateChoice("short", "a", [{ move: "repairArmor" }, { move: "makeAFeast" }], feast.extra, feast.forbidden))).toBeNull();
  });

  it("Tribute gains Favor equal to the Warlock's Spellcast trait (HF 14), never less than 0", () => {
    const warlock = (presence: number) =>
      sheet("Vela", 1, { classId: "warlock", subclassId: "pact-of-the-endless", traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence, knowledge: 0 } });
    const choice = (moves: RestChoice["moves"]): RestChoice[] => [{ characterId: "w", moves }];
    const done = applyMoves("short", { w: warlock(2) }, choice([{ move: "tribute" }, { move: "tribute" }]), fixed(1));
    expect(done.sheets.w.classState.favor).toBe(7);
    expect(done.lines.w).toEqual(["Tribute: +2 Favor (3 to 5)", "Tribute: +2 Favor (5 to 7)"]);
    expect(applyMoves("short", { w: warlock(-1) }, choice([{ move: "tribute" }, { move: "clearStress" }]), fixed(1)).sheets.w.classState.favor).toBe(3);
  });

  it("an interrupted long rest keeps Tribute (a short-rest move too) and drops the frame moves", () => {
    expect(interruptedMoves("long", [{ move: "tribute" }, { move: "keepWatch" }])).toEqual([{ move: "tribute" }]);
  });
});

describe("interruption (CB 105)", () => {
  it("an interrupted short rest gives nothing", () => {
    expect(interruptedMoves("short", [{ move: "clearStress" }, { move: "tendToWounds" }])).toEqual([]);
  });

  it("an interrupted long rest gives short-rest moves; Work on a Project is lost", () => {
    expect(
      interruptedMoves("long", [{ move: "tendToAllWounds", targetId: "b" }, { move: "workOnProject", countdownId: "c" }]),
    ).toEqual([{ move: "tendToWounds", targetId: "b" }]);
    expect(interruptedMoves("long", [{ move: "clearAllStress" }, { move: "repairAllArmor" }])).toEqual([{ move: "clearStress" }, { move: "repairArmor" }]);
  });
});

describe("rest counting and Fear (CB 105)", () => {
  it("counts finished short rests since the last finished long rest", () => {
    expect(shortRestsSinceLong([])).toBe(0);
    expect(
      shortRestsSinceLong([
        { kind: "short", status: "finished" },
        { kind: "short", status: "interrupted" },
        { kind: "long", status: "interrupted" },
        { kind: "short", status: "finished" },
        { kind: "long", status: "finished" },
        { kind: "short", status: "finished" },
      ]),
    ).toBe(2);
  });

  it("a fourth short rest in a row is refused; a long rest never is (CB 105, HF 176)", () => {
    expect(mustLongRest("short", 2)).toBe(false);
    expect(mustLongRest("short", 3)).toBe(true);
    expect(mustLongRest("short", 4)).toBe(true);
    expect(mustLongRest("long", 3)).toBe(false);
  });

  it("GM Fear: 1d4 on a short rest, 1d4 + PCs on a long rest", () => {
    expect(restFear("short", 3, 4)).toBe(3);
    expect(restFear("long", 3, 4)).toBe(7);
  });
});

describe("restedSheet", () => {
  const withTemp = sheet("Ash", 1, {
    conditions: ["unconscious"],
    effects: [
      { id: "e1", source: "T", text: "", until: "rest" },
      { id: "e2", source: "T", text: "", until: "longRest" },
    ],
  });

  it("a short rest ends rest effects and leaves an unconscious PC down", () => {
    const rested = restedSheet(withTemp, "short", {});
    expect(rested.effects.map((e) => e.id)).toEqual(["e2"]);
    expect(rested.conditions).toContain("unconscious");
  });

  it("a long rest ends long-rest effects and wakes the unconscious (CB 106)", () => {
    const rested = restedSheet(withTemp, "long", {});
    expect(rested.effects).toEqual([]);
    expect(rested.conditions).not.toContain("unconscious");
  });

  it("runs the class's onRest hook", () => {
    const warrior: ClassFeatures = { classId: "warrior", onRest: (s, kind) => ({ ...s, notes: `rested ${kind}` }) };
    expect(restedSheet(withTemp, "short", { warrior }).notes).toBe("rested short");
  });
});
