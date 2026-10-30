// SD-R: the rest-time heritage features (src/lib/domain/rest/feature-moves.ts) and the rest picker's slots for them.
// Book texts: Hardy (HF p.29), Efficient (CB p.53), Celestial Trance (CB p.56), Oasis (HF p.27); interrupted rests CB p.105.
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { applyMoves, validateChoice, type RestChoice } from "@/lib/domain/rest";
import {
  applyHardy,
  applyMovesWithOasis,
  efficientMoves,
  NO_REST_FEATURES,
  restFeaturesOf,
  restMoveSlots,
  validateFeatureChoice,
} from "@/lib/domain/rest/feature-moves";
import { REST_MOVES } from "@/lib/domain/rest/moves";
import { RuleError } from "@/lib/errors/app-error";
import type { CharacterSheet } from "@/lib/validation/characters";

function sheet(name: string, extra: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    ...readSheet({
      schemaVersion: 2,
      name,
      pronouns: "",
      description: "",
      level: 1,
      classId: "warrior",
      subclassId: "call-of-the-brave",
      ancestry: { kind: "single", id: "human" },
      communityId: "highborne",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      traitMarks: {},
      evasion: 11,
      hpMax: 6,
      hp: 4,
      stressMax: 6,
      stress: 5,
      hope: 2,
      scars: 0,
      armorMarked: 0,
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

const clank = (name = "Cog") => sheet(name, { ancestry: { kind: "single", id: "clank" } });
const elf = (name = "Ael") => sheet(name, { ancestry: { kind: "single", id: "elf" } });
const frostborne = (name = "Fen") => sheet(name, { communityId: "frostborne" });
const duneborne = (name = "Dune") => sheet(name, { communityId: "duneborne" });
const HF = { hopeAndFear: true };

/** A rng that answers from a script, then 1. */
const scripted = (...values: number[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 1;
};

describe("who holds the features (owned(), mixed ancestries included)", () => {
  it("each feature comes from its ancestry or community", () => {
    expect(restFeaturesOf(frostborne(), HF)).toEqual({ ...NO_REST_FEATURES, hardy: true });
    expect(restFeaturesOf(clank(), HF)).toEqual({ ...NO_REST_FEATURES, efficient: true });
    expect(restFeaturesOf(elf(), HF)).toEqual({ ...NO_REST_FEATURES, trance: true });
    expect(restFeaturesOf(duneborne(), HF)).toEqual({ ...NO_REST_FEATURES, oasis: true });
    expect(restFeaturesOf(sheet("Plain"), HF)).toEqual(NO_REST_FEATURES);
  });

  it("a mixed ancestry holds the feature only when it is the first feature of one or the second of the other (CB p.71)", () => {
    // Elf's features: Quick Reactions, Celestial Trance. Clank's: Purposeful Design, Efficient.
    expect(restFeaturesOf(sheet("A", { ancestry: { kind: "mixed", first: "clank", second: "elf", name: "Clank-Elf" } }), HF)).toEqual({ ...NO_REST_FEATURES, trance: true });
    expect(restFeaturesOf(sheet("B", { ancestry: { kind: "mixed", first: "elf", second: "clank", name: "Elf-Clank" } }), HF)).toEqual({ ...NO_REST_FEATURES, efficient: true });
    expect(restFeaturesOf(sheet("C", { ancestry: { kind: "mixed", first: "elf", second: "human", name: "Elf-Human" } }), HF).trance).toBe(false);
  });

  it("Hope & Fear communities need the Hope & Fear option (HF p.29, p.27)", () => {
    expect(restFeaturesOf(frostborne(), { hopeAndFear: false }).hardy).toBe(false);
    expect(restFeaturesOf(duneborne(), { hopeAndFear: false }).oasis).toBe(false);
    expect(restFeaturesOf(clank(), { hopeAndFear: false }).efficient).toBe(true);
  });
});

describe("Hardy: 'When you take a rest, you clear a Hit Point.' (HF p.29)", () => {
  it("clears one marked Hit Point, not below zero, and only for the holder", () => {
    const f = restFeaturesOf(frostborne(), HF);
    const out = applyHardy(sheet("Fen", { hp: 3 }), f);
    expect(out.sheet.hp).toBe(2);
    expect(out.line).toBe("Hardy: clears 1 HP");
    expect(applyHardy(sheet("Fen", { hp: 0 }), f).sheet.hp).toBe(0);
    expect(applyHardy(sheet("Other", { hp: 3 }), NO_REST_FEATURES).line).toBeNull();
  });
});

describe("Efficient: 'When you take a short rest, you can choose a long rest move instead of a short rest move.' (CB p.53)", () => {
  const f = restFeaturesOf(clank(), HF);

  it("a short rest also lists the long rest moves it lacks; a long rest and a holder without it get nothing", () => {
    expect(efficientMoves("short", f, REST_MOVES.short)).toEqual(["tendToAllWounds", "clearAllStress", "repairAllArmor", "workOnProject"]);
    expect(efficientMoves("long", f, REST_MOVES.long)).toEqual([]);
    expect(efficientMoves("short", NO_REST_FEATURES, REST_MOVES.short)).toEqual([]);
  });

  it("the frame's forbidden moves stay forbidden", () => {
    expect(efficientMoves("short", f, REST_MOVES.short, ["tendToAllWounds"])).not.toContain("tendToAllWounds");
  });

  it("one long rest move picked on a short rest is accepted and applied", () => {
    const efficient = efficientMoves("short", f, REST_MOVES.short);
    const allowed = [...REST_MOVES.short, ...efficient];
    expect(() => validateFeatureChoice("a", [{ move: "tendToAllWounds" }, { move: "clearStress" }], allowed, f, efficient)).not.toThrow();
    // Level 1 is tier 1: Clear Stress clears the d4 (3) plus 1.
    const choices: RestChoice[] = [{ characterId: "a", moves: [{ move: "tendToAllWounds" }, { move: "clearStress" }] }];
    const { sheets } = applyMoves("short", { a: sheet("Cog", { hp: 5, stress: 6 }) }, choices, scripted(3));
    expect(sheets.a.hp).toBe(0);
    expect(sheets.a.stress).toBe(2);
  });

  it("'a long rest move instead of a short rest move': a second long rest move is refused", () => {
    const efficient = efficientMoves("short", f, REST_MOVES.short);
    const allowed = [...REST_MOVES.short, ...efficient];
    expect(() => validateFeatureChoice("a", [{ move: "tendToAllWounds" }, { move: "clearAllStress" }], allowed, f, efficient)).toThrow(RuleError);
    expect(() => validateFeatureChoice("a", [{ move: "workOnProject" }, { move: "workOnProject" }], allowed, f, efficient)).toThrow(RuleError);
    // Prepare is on both lists, so it is a short rest move, not Efficient's.
    expect(() => validateFeatureChoice("a", [{ move: "clearAllStress" }, { move: "prepare" }], allowed, f, efficient)).not.toThrow();
  });
});

describe("Celestial Trance: 'During a rest, you can drop into a trance to choose an additional downtime move.' (CB p.56)", () => {
  const f = restFeaturesOf(elf(), HF);
  const allowed = REST_MOVES.short;

  it("allows two or three moves; everyone else exactly two", () => {
    expect(restMoveSlots(f)).toEqual({ min: 2, max: 3 });
    expect(restMoveSlots(NO_REST_FEATURES)).toEqual({ min: 2, max: 2 });
    const three = [{ move: "clearStress" as const }, { move: "clearStress" as const }, { move: "prepare" as const }];
    expect(() => validateFeatureChoice("a", three, allowed, f)).not.toThrow();
    expect(() => validateFeatureChoice("a", three.slice(0, 2), allowed, f)).not.toThrow();
    expect(() => validateFeatureChoice("a", three, allowed, NO_REST_FEATURES)).toThrow(RuleError);
    expect(() => validateFeatureChoice("a", three.slice(0, 1), allowed, f)).toThrow(RuleError);
    expect(() => validateFeatureChoice("a", [...three, { move: "prepare" }], allowed, f)).toThrow(RuleError);
  });

  it("keeps validateChoice's other checks: allowed moves, ally targets, countdowns", () => {
    const fail = (moves: Parameters<typeof validateFeatureChoice>[1]) => () => validateFeatureChoice("a", moves, allowed, f);
    expect(fail([{ move: "workOnProject" }, { move: "prepare" }])).toThrow(RuleError);
    expect(fail([{ move: "clearStress", targetId: "b" }, { move: "prepare" }])).toThrow(RuleError);
    expect(fail([{ move: "tendToWounds", targetId: "a" }, { move: "prepare" }])).toThrow(RuleError);
    expect(fail([{ move: "prepare", countdownId: "x" }, { move: "prepare" }])).toThrow(RuleError);
    // the same rules as validateChoice for two moves
    expect(() => validateChoice("short", "a", [{ move: "prepare" }, { move: "prepare" }])).not.toThrow();
  });

  it("the third move is applied with the other two", () => {
    const choices: RestChoice[] = [{ characterId: "a", moves: [{ move: "prepare" }, { move: "prepare" }, { move: "prepare" }] }];
    expect(applyMoves("short", { a: sheet("Ael", { hope: 0 }) }, choices, scripted()).sheets.a.hope).toBe(3);
  });
});

describe("Oasis: 'During a short rest, you or an ally can reroll a die used for a downtime move and take the higher result.' (HF p.27)", () => {
  // Level 1 is tier 1: each 1d4 move clears the die plus 1.
  const clear = (id: string): RestChoice => ({ characterId: id, moves: [{ move: "clearStress" }, { move: "clearStress" }] });

  it("rerolls the party's lowest downtime die and keeps the higher result", () => {
    // d rolls 2, 4; the ally rolls 1, 3. The lowest is the ally's 1, rerolled to 4 (kept).
    const r = applyMovesWithOasis("short", { d: duneborne(), a: sheet("Ally") }, [clear("d"), clear("a")], scripted(2, 4, 1, 3, 4), ["d"]);
    expect(r.sheets.a.stress).toBe(0);
    expect(r.sheets.a.hp).toBe(4);
    expect(r.lines.d.at(-1)).toBe("Oasis: rerolled a d4 (1, then 4), kept 4");
    // the replay used the kept 4 for the ally's first die: clears 5 then 4 of 5 Stress
    expect(r.lines.a[0]).toContain("clears 5 Stress");
  });

  it("keeps the first result when the reroll is lower", () => {
    const r = applyMovesWithOasis("short", { d: duneborne() }, [clear("d")], scripted(3, 4, 1), ["d"]);
    expect(r.lines.d[0]).toContain("clears 4 Stress");
    expect(r.lines.d[1]).toContain("clears 5 Stress");
    expect(r.lines.d.at(-1)).toBe("Oasis: rerolled a d4 (3, then 1), kept 3");
  });

  it("each holder rerolls a different die", () => {
    const two = applyMovesWithOasis("short", { d: duneborne(), e: duneborne("Dune2") }, [clear("d"), clear("e")], scripted(1, 1, 1, 1, 4, 4), ["d", "e"]);
    expect(two.lines.d.at(-1)).toContain("kept 4");
    expect(two.lines.e.at(-1)).toContain("kept 4");
  });

  it("a party without a holder and a long rest roll nothing extra", () => {
    expect(applyMovesWithOasis("short", { d: duneborne() }, [clear("d")], scripted(2, 2), []).lines.d).toHaveLength(2);
    const long = applyMovesWithOasis(
      "long",
      { d: duneborne() },
      [{ characterId: "d", moves: [{ move: "tendToAllWounds" }] }],
      () => {
        throw new Error("a long rest rolls no die");
      },
      ["d"],
    );
    expect(long.sheets.d.hp).toBe(0);
  });

  it("with no downtime die rolled (Prepare) there is nothing to reroll", () => {
    const r = applyMovesWithOasis(
      "short",
      { d: duneborne() },
      [{ characterId: "d", moves: [{ move: "prepare" }, { move: "prepare" }] }],
      () => {
        throw new Error("no die");
      },
      ["d"],
    );
    expect(r.sheets.d.hope).toBe(4);
  });
});

// ---------------------------------------------------------------- the picker

type Mine = { moves: string[]; efficient: string[]; slots: number; oasis: boolean };
const LONG_ONLY = ["tendToAllWounds", "clearAllStress", "repairAllArmor", "workOnProject"];
let mine: Mine = { moves: [...REST_MOVES.short], efficient: [], slots: 2, oasis: false };
const fired: unknown[] = [];

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "rests:current") {
        return { open: { _id: "r1", kind: "short", startedAt: 0, gmOverride: false, choices: [], moves: [{ characterId: "c1", ...mine }] }, shortRestsSinceLong: 0, last: null };
      }
      if (name === "characters:listByCampaign") return [];
      return undefined;
    },
    useMutation: () => async (args: unknown) => {
      fired.push(args);
      return null;
    },
  };
});

const { Picker } = await import("@/components/party/rest/picker");

function renderPicker() {
  const character = { _id: "c1", status: "active", sheet: { name: "Ael", conditions: [], domainCards: { owned: [], loadout: [] } } };
  return render(createElement(Picker as never, { campaignId: "camp", character, canEdit: true }));
}

describe("the rest picker", () => {
  it("shows two move slots and no feature controls for a PC without features", () => {
    mine = { moves: [...REST_MOVES.short], efficient: [], slots: 2, oasis: false };
    renderPicker();
    expect(screen.getAllByText(/^Move \d$/)).toHaveLength(2);
    expect(screen.queryByText(/Celestial Trance/)).toBeNull();
    expect(screen.queryByText(/Oasis/)).toBeNull();
    expect(screen.queryByText(/Efficient/)).toBeNull();
  });

  it("Celestial Trance adds a third slot on a click (CB 56); the Oasis note shows (HF 27); 44 px toggles", () => {
    mine = { moves: [...REST_MOVES.short], efficient: [], slots: 3, oasis: true };
    renderPicker();
    expect(screen.getAllByText(/^Move \d$/)).toHaveLength(2);
    expect(screen.getByText(/Oasis \(HF 27\)/)).toBeTruthy();
    const trance = screen.getByRole("button", { name: "Drop into a trance" });
    expect(trance.closest(".rp-actions")).not.toBeNull();
    fireEvent.click(trance);
    expect(screen.getByText("Trance move")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear Stress" })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Leave the trance" }));
    expect(screen.queryByText("Trance move")).toBeNull();
  });

  it("Efficient: Use Efficient shows the long rest moves, one slot at a time, and sends efficient (CB 53)", async () => {
    mine = { moves: [...REST_MOVES.short], efficient: LONG_ONLY, slots: 2, oasis: false };
    fired.length = 0;
    renderPicker();
    expect(screen.queryByRole("button", { name: "Clear All Stress" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use Efficient" }));
    const [first, second] = screen.getAllByRole("button", { name: "Clear All Stress" });
    expect(second).not.toBeDisabled();
    fireEvent.click(first!);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(first).not.toBeDisabled();
    for (const name of ["Tend to All Wounds", "Clear All Stress", "Repair All Armor", "Work on a Project"]) {
      expect(screen.getAllByRole("button", { name })[1]).toBeDisabled();
    }
    expect(screen.getAllByRole("button", { name: "Clear Stress" })[1]).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save moves" }));
    await screen.findByText(/^Saved/);
    expect(fired.at(-1)).toMatchObject({ characterId: "c1", efficient: true, moves: [{ move: "clearAllStress" }, { move: "tendToWounds" }] });

    // Stopping it puts a long rest pick back to a short rest move.
    fireEvent.click(screen.getByRole("button", { name: "Stop using Efficient" }));
    expect(screen.queryByRole("button", { name: "Clear All Stress" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Tend to Wounds" })[0]).toHaveAttribute("aria-pressed", "true");
  });
});
