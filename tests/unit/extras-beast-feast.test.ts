import { describe, expect, it } from "vitest";

import {
  addIngredient,
  cookbookTokens,
  formatProfile,
  ingredientCapacity,
  ingredientInputSchema,
  INITIAL_BEAST_FEAST,
  profileOf,
  removeIngredient,
  sameProfile,
} from "../../src/lib/frames/extras/beast-feast";

const mushroom = { id: "a", name: "Mushroom caps", flavors: [{ flavor: "bitter" as const, strength: 1 }, { flavor: "savory" as const, strength: 2 }] };
const direbear = { id: "b", name: "Direbear meat", flavors: [{ flavor: "savory" as const, strength: 3 }] };

describe("Beast Feast extras (Core pp.277-279)", () => {
  it("capacity = highest trait", () => {
    expect(ingredientCapacity({ agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 })).toBe(2);
  });

  it("validates 1-3 flavors with strength 1-3", () => {
    expect(ingredientInputSchema.safeParse({ name: "x", flavors: [] }).success).toBe(false);
    expect(ingredientInputSchema.safeParse({ name: "x", flavors: [{ flavor: "sweet", strength: 4 }] }).success).toBe(false);
    expect(ingredientInputSchema.safeParse({ name: "x", flavors: [{ flavor: "sweet", strength: 1 }, { flavor: "sweet", strength: 2 }] }).success).toBe(false);
    expect(ingredientInputSchema.safeParse({ name: "Holy cow's milk", flavors: [{ flavor: "weird", strength: 1 }], feature: "Last Drop" }).success).toBe(true);
  });

  it("refuses ingredients past capacity and removes by id", () => {
    let s = addIngredient(INITIAL_BEAST_FEAST, mushroom, 2);
    s = addIngredient(s, direbear, 2);
    expect(() => addIngredient(s, { ...direbear, id: "c" }, 2)).toThrow(/carry 2/);
    expect(removeIngredient(s, "a").ingredients.map((i) => i.id)).toEqual(["b"]);
  });

  it("flavor profiles sum strengths; a recorded profile gives tier tokens", () => {
    const p = profileOf([mushroom, direbear]);
    expect(p).toEqual({ bitter: 1, savory: 5 });
    expect(formatProfile(p)).toBe("1d8 + 5d12");
    expect(sameProfile(p, { savory: 5, bitter: 1 })).toBe(true);
    const book = { entries: [{ id: "1", name: "Steak", description: "", ingredients: [], profile: p, mealRating: 11, addedBy: "u", at: 0 }] };
    expect(cookbookTokens(book, { savory: 5, bitter: 1 }, 2)).toBe(2);
    expect(cookbookTokens(book, { savory: 3 }, 2)).toBe(0);
  });
});
