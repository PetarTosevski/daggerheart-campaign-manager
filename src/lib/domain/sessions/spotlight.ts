// Session spotlight (D10 S1, board rule B4; CB p.176 'Sharing the Spotlight'). Pure module.
//
// B4: "Spotlight (tap a character for each moment; the least-spotlit are ringed as due; 'Reset spotlight')".
// CB p.176: "It's rare that every PC will organically have the same amount of spotlight time during a given session ...
// you can help ensure that the story's focus rotates between the PCs".
// Board: `due = cnt === min` over the listed characters, so when every count is equal, every character is due.
//
// ```ts
// spotlight(["a", "b", "c"], [{ characterId: "a", count: 2 }, { characterId: "b", count: 1 }]);
// // [{ characterId: "a", count: 2, due: false }, { characterId: "b", count: 1, due: false }, { characterId: "c", count: 0, due: true }]
// ```

/** One `sessionSpotlights` row (S0) as this module reads it. */
export type SpotlightRow<Id extends string = string> = { characterId: Id; count: number };

export type SpotlightEntry<Id extends string = string> = { characterId: Id; count: number; due: boolean };

/**
 * Every listed character (the active PCs, Q12, in the caller's order) with its count (0 without a row) and whether it
 * is due: it has the lowest count of the listed characters. Rows for characters not listed are ignored.
 */
export function spotlight<Id extends string>(
  characterIds: readonly Id[],
  rows: readonly SpotlightRow<Id>[],
): SpotlightEntry<Id>[] {
  const counts = new Map<Id, number>();
  for (const r of rows) counts.set(r.characterId, (counts.get(r.characterId) ?? 0) + r.count);
  const listed = characterIds.map((characterId) => ({ characterId, count: counts.get(characterId) ?? 0 }));
  const min = Math.min(...listed.map((e) => e.count));
  return listed.map((e) => ({ ...e, due: e.count === min }));
}

/** The ids of the due characters (see `spotlight`). */
export function dueCharacters<Id extends string>(characterIds: readonly Id[], rows: readonly SpotlightRow<Id>[]): Id[] {
  return spotlight(characterIds, rows)
    .filter((e) => e.due)
    .map((e) => e.characterId);
}
