/** Rule switches RX (CB p.106, Q8 a): the death-move domain helpers take X1 / X2's mode, Book by default. */
import { describe, expect, it } from "vitest";

import { deathResultText } from "@/components/party/death/waiting";
import { deathMovePrompted, dropUnconscious, lastHpNote, manualMoveNote, manualMoveSummary, resolvesItself } from "@/lib/domain/death/index";
import { resolveRuleModes } from "@/lib/rules/resolve";

const DOWN = { status: "active", hp: 6, hpMax: 6, conditions: [] as string[] };

describe("X1 death move prompt", () => {
  it("Book (the default) asks when a move is due; Manual never asks", () => {
    expect(deathMovePrompted(DOWN)).toBe(true);
    expect(deathMovePrompted(DOWN, "book")).toBe(true);
    expect(deathMovePrompted(DOWN, "manual")).toBe(false);
    expect(deathMovePrompted({ ...DOWN, hp: 5 })).toBe(false);
    expect(deathMovePrompted({ ...DOWN, conditions: ["unconscious"] })).toBe(false);
  });

  it("the GM's note names the PC", () => {
    expect(lastHpNote("Kael")).toMatch(/^Kael marked their last HP/);
  });

  it("X2 resolves to Manual while X1 is Manual", () => {
    expect(resolveRuleModes("witherwild", { deathMovePrompt: "manual", deathMoveResolve: "book" }).deathMoveResolve).toBe("manual");
    expect(resolveRuleModes("witherwild", {}).deathMoveResolve).toBe("book");
  });
});

describe("X2 death moves resolve themselves", () => {
  it("Book rolls Avoid Death and Risk It All; Manual rolls neither; Blaze of Glory never rolls", () => {
    expect(resolvesItself("avoidDeath")).toBe(true);
    expect(resolvesItself("riskItAll", "book")).toBe(true);
    expect(resolvesItself("avoidDeath", "manual")).toBe(false);
    expect(resolvesItself("riskItAll", "manual")).toBe(false);
    expect(resolvesItself("blazeOfGlory", "manual")).toBe(true);
  });

  it("the notes say what to roll and what follows, with less lethal when on", () => {
    expect(manualMoveNote("Kael", "avoidDeath", 3, false)).toBe("Avoid Death (Kael): roll the Hope Die; scar at or under level 3.");
    expect(manualMoveNote("Kael", "riskItAll", 3, false)).toContain("Fear higher: Kael dies");
    expect(manualMoveNote("Kael", "riskItAll", 3, true)).toContain("goes to the infirmary or home instead of dying (less lethal)");
    expect(manualMoveSummary("Kael", "avoidDeath")).toContain("drops unconscious");
    expect(manualMoveSummary("Kael", "riskItAll")).toContain("Roll the Duality Dice in the dice box");
  });

  it("dropUnconscious adds the condition once", () => {
    expect(dropUnconscious({ conditions: [] }).conditions).toEqual(["unconscious"]);
    expect(dropUnconscious({ conditions: ["unconscious"] }).conditions).toEqual(["unconscious"]);
  });

  it("the sheet's result line reads a Manual move (no dice) and a Book one", () => {
    const manual = { status: "active", pending: null, hopeDie: null, fearDie: null, scarred: false, journeyEnds: false };
    expect(deathResultText("avoidDeath", manual, 2, false)).toBe("Unconscious. Roll your Hope Die in the dice box: at or under level 2, the GM marks a scar.");
    expect(deathResultText("riskItAll", manual, 2, false)).toBe("Roll your Duality Dice in the dice box; the GM applies the outcome.");
    expect(deathResultText("avoidDeath", { ...manual, hopeDie: 1, scarred: true }, 2, false)).toBe("Hope Die 1 against level 2: a scar.");
  });
});
