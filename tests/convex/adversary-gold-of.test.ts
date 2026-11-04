/**
 * dcm-sgn7: the adversary run's `goldOf` (convex/lib/adversaryActions.ts) counts each PC's gold in handfuls, a bag being
 * 10 (CB p.104), as the card runner's `handfulsOf` does. It used to read `gold.handfuls` only, so a `gold` number in
 * bags (The Weight of Opulence, HF p.81: "lose a Hope for each bag of gold they're carrying") read 0 for a PC holding bags.
 */
import { describe, expect, it } from "vitest";

import { partyGoldOf } from "../../convex/lib/adversaryActions";
import { handfulsOf } from "../../convex/lib/cardRunner";

const member = (id: string, handfuls: number, bags: number) => ({ character: { _id: id }, sheet: { gold: { handfuls, bags, chest: false } } });

describe("dcm-sgn7: the adversary run's goldOf counts bags", () => {
  it("counts handfuls plus 10 per bag, per PC, like the card runner", () => {
    const party = [member("ash", 4, 3), member("bryn", 7, 0), member("cass", 0, 2)];
    expect(partyGoldOf(party)).toEqual({ ash: 34, bryn: 7, cass: 20 });
    for (const m of party) expect(partyGoldOf([m])[m.character._id]).toBe(handfulsOf(m.sheet));
  });

  it("a PC holding bags reads its bags (the runner's `unit: \"bag\"` is the handfuls / 10, floored)", () => {
    const gold = partyGoldOf([member("ash", 4, 3)]).ash;
    expect(Math.floor(gold / 10)).toBe(3);
  });
});
