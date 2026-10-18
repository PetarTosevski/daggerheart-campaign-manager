// Spotlight per GM turn (D8 A4). Pure.
//
// Core Book p.153: "You can spend a Fear to make an additional GM move, shifting the spotlight to another adversary …
//   you can't typically spotlight the same adversary more than once during your turn."
// Core Book p.195: "Relentless (X) - Passive: This adversary can be spotlighted up to X times per GM turn. Spend Fear as
//   usual to spotlight them." Some blocks print a variable X (Hydra: its heads; Xero: the number of PCs).
// Open question 5 (default taken): the tracker counts spotlights and warns past the limit, never blocks; Fear is spent
//   only through "Spend Fear".
//
// ```ts
// spotlightLimit(null);                       // 1
// spotlightLimit(3);                          // 3 (Relentless (3))
// spotlightStatus(2, spotlightLimit(null));   // { count: 2, limit: 1, over: true, label: "Spotlight 2/1" }
// ```

/** Spotlights per GM turn: 1, X for Relentless (X), or "X" when the block makes X variable. */
export function spotlightLimit(relentless: number | "X" | null): number | "X" {
  return relentless ?? 1;
}

/** This GM turn's spotlights: a count stored for an older turn is 0 (End GM turn resets without touching every row). */
export function spotlightsThisTurn(instance: { spotlights: number; spotlightTurn: number }, gmTurn: number): number {
  return instance.spotlightTurn === gmTurn ? instance.spotlights : 0;
}

/** The counter shown on an instance card; `over` is a warning only (Q5). A variable X never warns. */
export function spotlightStatus(count: number, limit: number | "X"): { count: number; limit: number | "X"; over: boolean; label: string } {
  return { count, limit, over: limit !== "X" && count > limit, label: `Spotlight ${count}/${limit}` };
}

/** One spotlight in GM turn `gmTurn`, as the server stores it; the tracker's optimistic update uses the same. */
export function applySpotlight<T extends { spotlights: number; spotlightTurn: number }>(instance: T, gmTurn: number): T {
  return { ...instance, spotlights: spotlightsThisTurn(instance, gmTurn) + 1, spotlightTurn: gmTurn };
}
