// SD-R: the rest-time heritage features (src/lib/domain/rest/feature-moves.ts) and the rest picker's slots for them.
// Book texts: Hardy (HF p.29), Efficient (CB p.53), Celestial Trance (CB p.56), Oasis (HF p.27); interrupted rests CB p.105.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { applyMoves, validateChoice, type RestChoice } from "@/lib/domain/rest";
import {
  applyDieDelta,
  applyHardy,
  applyMovesWithDice,
  efficientMoves,
  NO_REST_FEATURES,
  oasisPool,
  oasisReroll,
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

  it("applyMovesWithDice records each downtime die in roll order with its move, target and tier; the moves are applyMoves'", () => {
    const choices: RestChoice[] = [
      { characterId: "d", moves: [{ move: "prepare" }, { move: "tendToWounds", targetId: "a" }] },
      { characterId: "a", moves: [{ move: "clearStress" }, { move: "repairArmor" }] },
    ];
    const input = { d: duneborne(), a: sheet("Ally", { armorMarked: 2 }) };
    const r = applyMovesWithDice("short", input, choices, scripted(2, 3, 4));
    expect(r.dice).toEqual([
      { characterId: "d", move: "tendToWounds", targetId: "a", sides: 4, bonus: 1, rolled: 2, value: 2, rerolls: [] },
      { characterId: "a", move: "clearStress", sides: 4, bonus: 1, rolled: 3, value: 3, rerolls: [] },
      { characterId: "a", move: "repairArmor", sides: 4, bonus: 1, rolled: 4, value: 4, rerolls: [] },
    ]);
    expect(r.sheets).toEqual(applyMoves("short", input, choices, scripted(2, 3, 4)).sheets);
    // No automatic reroll: the holder's lines are the moves' only.
    expect(r.lines.d.some((l) => l.includes("Oasis"))).toBe(false);
  });

  it("a long rest and Prepare roll no die", () => {
    const none = () => {
      throw new Error("no die");
    };
    expect(applyMovesWithDice("long", { d: duneborne() }, [{ characterId: "d", moves: [{ move: "tendToAllWounds" }] }], none).dice).toEqual([]);
    expect(applyMovesWithDice("short", { d: duneborne() }, [{ characterId: "d", moves: [{ move: "prepare" }, { move: "prepare" }] }], none).dice).toEqual([]);
  });

  const solo = { holders: ["d"], closed: [] };

  it("oasisReroll rerolls the picked die, keeps the higher result and gives the difference", () => {
    const { dice } = applyMovesWithDice("short", { d: duneborne(), a: sheet("Ally") }, [clear("a")], scripted(1, 2));
    const up = oasisReroll(dice, 0, "d", scripted(4), solo);
    expect(up).toMatchObject({ rolled: 4, before: 1, delta: 3, spentFrom: "d" });
    expect(up.dice[0]).toMatchObject({ rolled: 1, value: 4, rerolls: [{ holderId: "d", rolled: 4, kept: 4, spentFrom: "d" }] });
    expect(up.dice[1]).toEqual(dice[1]);
    const down = oasisReroll(dice, 1, "d", scripted(1), solo);
    expect(down).toMatchObject({ rolled: 1, before: 2, delta: 0 });
    expect(down.die.value).toBe(2);
  });

  it("the pool (DA15): one reroll per holder, any holder on any die, the same die again; own reroll first; empty pool refused", () => {
    const pool = { holders: ["d", "e"], closed: [] };
    const { dice } = applyMovesWithDice("short", { d: duneborne(), a: sheet("Ally") }, [clear("a")], scripted(1, 2));
    expect(oasisPool(dice, pool)).toEqual({ left: 2, unused: ["d", "e"], open: ["d", "e"] });
    // e spends their own first, then d's, on the same die, keeping the higher each time.
    const first = oasisReroll(dice, 0, "e", scripted(2), pool);
    expect(first.spentFrom).toBe("e");
    const second = oasisReroll(first.dice, 0, "e", scripted(3), pool);
    expect(second).toMatchObject({ spentFrom: "d", delta: 1 });
    expect(second.die).toMatchObject({ value: 3, rerolls: [{ holderId: "e", kept: 2, spentFrom: "e" }, { holderId: "e", kept: 3, spentFrom: "d" }] });
    expect(oasisPool(second.dice, pool).left).toBe(0);
    expect(() => oasisReroll(second.dice, 1, "d", scripted(4), pool)).toThrow(RuleError);
    // A DA5 row (no `spentFrom`) spent the pressing holder's own.
    const old = dice.map((d, i) => (i === 0 ? { ...d, rerolls: [{ holderId: "d", rolled: 2, kept: 2 }] } : d));
    expect(oasisPool(old, pool).unused).toEqual(["e"]);
    // A non-holder and a missing die are refused.
    expect(() => oasisReroll(dice, 0, "a", scripted(4), pool)).toThrow(RuleError);
    for (const bad of [-1, 2, 0.5]) expect(() => oasisReroll(dice, bad, "d", scripted(4), pool)).toThrow(RuleError);
  });

  it("closing (DA15) withdraws the holder's unused reroll and stops them rerolling; a reroll already spent stays spent", () => {
    const { dice } = applyMovesWithDice("short", { d: duneborne(), a: sheet("Ally") }, [clear("a")], scripted(1, 2));
    const closed = { holders: ["d", "e"], closed: ["d"] };
    expect(oasisPool(dice, closed)).toEqual({ left: 1, unused: ["e"], open: ["e"] });
    expect(() => oasisReroll(dice, 0, "d", scripted(4), closed)).toThrow(RuleError);
    // d spends both, then e closes: nothing more to withdraw.
    const pool = { holders: ["d", "e"], closed: [] };
    const both = oasisReroll(oasisReroll(dice, 0, "d", scripted(2), pool).dice, 1, "d", scripted(3), pool).dice;
    expect(oasisPool(both, { holders: ["d", "e"], closed: ["e"] })).toEqual({ left: 0, unused: [], open: ["d"] });
    expect(oasisPool(both, { holders: ["d", "e"], closed: ["d", "e"] }).open).toEqual([]);
  });

  it("applyDieDelta clears the difference on the move's resource, never below zero", () => {
    const s = sheet("Ally", { hp: 4, stress: 1, armorMarked: 2 });
    expect(applyDieDelta(s, "tendToWounds", 3)).toMatchObject({ cleared: 3, sheet: { hp: 1 } });
    expect(applyDieDelta(s, "clearStress", 3)).toMatchObject({ cleared: 1, sheet: { stress: 0 } });
    expect(applyDieDelta(s, "repairArmor", 3)).toMatchObject({ cleared: 2, sheet: { armorMarked: 0 } });
    expect(applyDieDelta(s, "clearStress", 0)).toEqual({ sheet: s, cleared: 0 });
  });
});

// ---------------------------------------------------------------- the picker

type Mine = { moves: string[]; efficient: string[]; slots: number; oasis: boolean };
const LONG_ONLY = ["tendToAllWounds", "clearAllStress", "repairAllArmor", "workOnProject"];
let mine: Mine = { moves: [...REST_MOVES.short], efficient: [], slots: 2, oasis: false };
const fired: unknown[] = [];
/** The latest ended rest `restsReads.current` answers (the Oasis dice); null while the picker tests run. */
let lastRest: unknown = null;
const RULES = { fearFromRests: "book", shortRestLimit: "book", interruptedRest: "book", twoDowntimeMoves: "book", downtimeMoveEffects: "book", unconscious: "book" };

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "restsReads:current") {
        if (lastRest !== null) return { open: null, shortRestsSinceLong: 1, rules: RULES, last: lastRest };
        return { open: { _id: "r1", kind: "short", startedAt: 0, gmOverride: false, choices: [], moves: [{ characterId: "c1", ...mine }] }, shortRestsSinceLong: 0, rules: RULES, last: null };
      }
      if (name === "charactersReads:listByCampaign") return [{ _id: "c1", sheet: { name: "Ael" } }, { _id: "c2", sheet: { name: "Bryn" } }];
      return undefined;
    },
    useMutation: () => async (args: unknown) => {
      fired.push(args);
      return null;
    },
  };
});

const { Picker, OasisDice } = await import("@/components/party/rest/picker");

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

describe("the Oasis dice after a short rest (DA5, DA15, HF p.27)", () => {
  const die = (characterId: string, value: number, rerolls: { holderId: string; rolled: number; kept: number; spentFrom?: string }[] = [], targetId?: string) => ({
    characterId,
    move: "clearStress",
    ...(targetId ? { targetId } : {}),
    sides: 4,
    bonus: 1,
    rolled: rerolls.length > 0 ? 1 : value,
    value,
    rerolls,
  });
  const renderDice = (canEdit = true) => {
    const character = { _id: "c1", status: "active", sheet: { name: "Ael", conditions: [], domainCards: { owned: [], loadout: [] } } };
    return render(createElement(OasisDice as never, { campaignId: "camp", character, canEdit }));
  };
  const base = {
    _id: "r1",
    kind: "short",
    status: "finished",
    finishedAt: 1,
    fearRoll: 1,
    fearGained: 1,
    undoable: true,
    oasisHolders: ["c1", "c2"],
    oasisClosed: [],
    oasisLeft: 2,
    resultsOpen: true,
  };

  it("lists every party member's die with a 44 px, keyboard-reachable 'Reroll (keep higher)' button that sends the die's index", async () => {
    lastRest = { ...base, dice: [die("c2", 1), die("c2", 2, [], "c1")] };
    fired.length = 0;
    renderDice();
    const list = screen.getByRole("list", { name: "Downtime dice" });
    expect(list).toHaveTextContent("Bryn: Clear Stress, d4 1 + tier 1");
    expect(list).toHaveTextContent("Bryn: Clear Stress on Ael, d4 2 + tier 1");
    const buttons = screen.getAllByRole("button", { name: "Reroll (keep higher)" });
    expect(buttons).toHaveLength(2);
    // A real <button> (keyboard reachable) sized by `.rp-dice .sh-pill { min-height: 44px }` (rest.css).
    expect(buttons[1]!.tagName).toBe("BUTTON");
    expect(buttons[1]!.closest(".rp-dice")).not.toBeNull();
    expect(buttons[1]).toHaveAccessibleDescription("Bryn: Clear Stress on Ael, d4 2 + tier 1");
    fireEvent.click(buttons[1]!);
    await vi.waitFor(() => expect(fired.at(-1)).toMatchObject({ restId: "r1", characterId: "c1", die: 1 }));
    cleanup();
    lastRest = null;
  });

  it("shows the pool left; the same die keeps its button while rerolls remain; none once the pool is empty", () => {
    lastRest = { ...base, oasisLeft: 1, dice: [die("c2", 4, [{ holderId: "c1", rolled: 4, kept: 4, spentFrom: "c1" }]), die("c2", 2)] };
    renderDice();
    expect(screen.getByRole("list", { name: "Downtime dice" })).toHaveTextContent("d4 4 + tier 1 (first 1; Ael rerolled 4, kept 4)");
    expect(screen.getByTestId("oasis-left")).toHaveTextContent("1 reroll left for the party.");
    expect(screen.getAllByRole("button", { name: "Reroll (keep higher)" })).toHaveLength(2);
    cleanup();
    lastRest = { ...base, oasisLeft: 0, dice: [die("c2", 4, [{ holderId: "c1", rolled: 4, kept: 4 }, { holderId: "c1", rolled: 2, kept: 4 }]), die("c2", 2)] };
    renderDice();
    expect(screen.queryByRole("button", { name: "Reroll (keep higher)" })).toBeNull();
    expect(screen.getByTestId("oasis-left")).toHaveTextContent("No rerolls left for the party.");
    // The panel stays until the holder closes it.
    expect(screen.getByRole("button", { name: "Close Oasis" })).toBeTruthy();
    cleanup();
    lastRest = { ...base, dice: [die("c2", 1)] };
    renderDice(false);
    expect(screen.queryByRole("button", { name: "Reroll (keep higher)" })).toBeNull();
    cleanup();
    // The holder closed their own panel (DA15): gone for them, even while another holder's is open.
    lastRest = { ...base, oasisClosed: ["c1"], oasisLeft: 1, dice: [die("c2", 1)] };
    renderDice();
    expect(screen.queryByRole("region", { name: "Oasis" })).toBeNull();
    cleanup();
    // Every holder closed: the window is over.
    lastRest = { ...base, oasisClosed: ["c1", "c2"], oasisLeft: 0, resultsOpen: false, dice: [die("c2", 1)] };
    renderDice();
    expect(screen.queryByRole("region", { name: "Oasis" })).toBeNull();
    cleanup();
    lastRest = null;
  });

  it("'Close Oasis' is a 44 px button that sends the holder's own close; no close for a viewer who can't edit", async () => {
    lastRest = { ...base, dice: [die("c2", 1)] };
    fired.length = 0;
    renderDice();
    const close = screen.getByRole("button", { name: "Close Oasis" });
    expect(close.tagName).toBe("BUTTON");
    expect(close).toHaveAccessibleDescription("Closing gives up Ael's unused reroll, if any.");
    fireEvent.click(close);
    await vi.waitFor(() => expect(fired.at(-1)).toEqual(expect.objectContaining({ restId: "r1", characterId: "c1" })));
    expect(fired.at(-1)).not.toHaveProperty("die");
    cleanup();
    renderDice(false);
    expect(screen.queryByRole("button", { name: "Close Oasis" })).toBeNull();
    cleanup();
    lastRest = null;
  });
});
