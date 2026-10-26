import { describe, expect, it } from "vitest";

import { addGold } from "../../src/lib/domain/characters";

// CB 104: "10 handfuls to 1 bag, and 10 bags to 1 chest", one chest at most.
describe("addGold", () => {
  const g = (handfuls: number, bags: number, chest = false) => ({ handfuls, bags, chest });
  it("rolls a 10th handful into a bag and a 10th bag into the chest", () => {
    expect(addGold(g(9, 0), "handfuls", 1)).toEqual(g(0, 1));
    expect(addGold(g(5, 2), "handfuls", 17)).toEqual(g(2, 4));
    expect(addGold(g(9, 9), "handfuls", 1)).toEqual(g(0, 0, true));
    expect(addGold(g(0, 9), "bags", 1)).toEqual(g(0, 0, true));
  });
  it("refuses a second chest and stops spending at 0", () => {
    expect(addGold(g(0, 9, true), "bags", 1)).toBeNull();
    expect(addGold(g(9, 9, true), "handfuls", 1)).toBeNull();
    expect(addGold(g(2, 3), "handfuls", -5)).toEqual(g(0, 3));
    expect(addGold(g(2, 3), "bags", -5)).toEqual(g(2, 0));
  });
  it("clamps counts stored above 9 before the rule", () => {
    expect(addGold(g(4, 27), "bags", -1)).toEqual(g(4, 8));
  });
});
