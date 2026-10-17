// Beast Feast: carried ingredients per PC and the party cookbook (Core Book pp.277–279).

import { z } from "zod";

import { FLAVORS, type Flavor } from "../../domain/frames/beast-feast";

export const MAX_STRENGTH = 3;
const entryId = z.string().min(1).max(100);

/** "determined by the 1–3 flavors that comprise it and the strength of those flavors" (strength 1–3). */
export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, "Name the ingredient.").max(80),
  flavors: z
    .array(z.object({ flavor: z.enum(FLAVORS), strength: z.number().int().min(1).max(MAX_STRENGTH) }))
    .min(1, "An ingredient has at least one flavor.")
    .max(3, "An ingredient has at most three flavors.")
    .refine((fs) => new Set(fs.map((f) => f.flavor)).size === fs.length, "List each flavor once."),
  /** Rare ingredients with features (p.279), e.g. "Last Drop: …". */
  feature: z.string().trim().max(300).optional(),
});
export type IngredientInput = z.infer<typeof ingredientInputSchema>;

export const ingredientSchema = ingredientInputSchema.extend({ id: entryId });
export type Ingredient = z.infer<typeof ingredientSchema>;

export const beastFeastStateSchema = z.object({ ingredients: z.array(ingredientSchema).max(20) });
export type BeastFeastState = z.infer<typeof beastFeastStateSchema>;
export const INITIAL_BEAST_FEAST: BeastFeastState = { ingredients: [] };

/** "A PC can hold a number of ingredients equal to the value of their highest character trait." */
export function ingredientCapacity(traits: Record<string, number>): number {
  return Math.max(0, ...Object.values(traits));
}

export function addIngredient(state: BeastFeastState, ingredient: Ingredient, capacity: number): BeastFeastState {
  if (state.ingredients.length >= capacity) throw new Error(`You can carry ${capacity} ingredient(s) (your highest trait).`);
  return { ingredients: [...state.ingredients, ingredient] };
}

export function removeIngredient(state: BeastFeastState, id: string): BeastFeastState {
  if (!state.ingredients.some((i) => i.id === id)) throw new Error("That ingredient is gone.");
  return { ingredients: state.ingredients.filter((i) => i.id !== id) };
}

/** A flavor profile: total strength (dice) per flavor. */
export type FlavorProfile = Partial<Record<Flavor, number>>;
export const flavorProfileSchema = z.partialRecord(z.enum(FLAVORS), z.number().int().min(1).max(60));

/** The dish's flavor profile from its ingredients (strengths summed per flavor). */
export function profileOf(ingredients: Pick<Ingredient, "flavors">[]): FlavorProfile {
  const profile: FlavorProfile = {};
  for (const i of ingredients) for (const f of i.flavors) profile[f.flavor] = (profile[f.flavor] ?? 0) + f.strength;
  return profile;
}

/** "the same flavor profile as another recipe": the same dice of each flavor. */
export function sameProfile(a: FlavorProfile, b: FlavorProfile): boolean {
  return FLAVORS.every((f) => (a[f] ?? 0) === (b[f] ?? 0));
}

export function formatProfile(p: FlavorProfile): string {
  const DIE: Record<Flavor, number> = { sweet: 4, salty: 6, bitter: 8, sour: 10, savory: 12, weird: 20 };
  return FLAVORS.filter((f) => p[f]).map((f) => `${p[f]}d${DIE[f]}`).join(" + ") || "—";
}

export const cookbookEntryInputSchema = z.object({
  name: z.string().trim().min(1, "Name the dish.").max(80),
  description: z.string().max(500),
  ingredients: z.array(z.string().trim().min(1).max(80)).max(30),
  profile: flavorProfileSchema,
  mealRating: z.number().int().min(0).max(999).nullable(),
});
export type CookbookEntryInput = z.infer<typeof cookbookEntryInputSchema>;

export const cookbookEntrySchema = cookbookEntryInputSchema.extend({ id: entryId, addedBy: z.string(), at: z.number() });
export type CookbookEntry = z.infer<typeof cookbookEntrySchema>;

// Bounded so the cookbook row stays far below Convex's 1 MiB document limit.
export const cookbookStateSchema = z.object({ entries: z.array(cookbookEntrySchema).max(100) });
export type CookbookState = z.infer<typeof cookbookStateSchema>;
export const INITIAL_COOKBOOK: CookbookState = { entries: [] };

/** Cookbook tokens for a dish: the party's tier when its profile is already recorded, else 0 (p.278). */
export function cookbookTokens(cookbook: CookbookState, profile: FlavorProfile, tier: number): number {
  return cookbook.entries.some((e) => sameProfile(e.profile, profile)) ? tier : 0;
}
