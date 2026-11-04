// Session log merge (Journal J0; JD2 builds the log from it). Pure module.
//
// The Journal's session log merges several sources (feed rows, Fear history, encounters, the session's own lines,
// user answer 'Session log = automatic from the action feed … plus GM add / edit / hide'). Each source arrives in its
// own order; the log reads oldest first.
//
// ```ts
// mergeLog([[{ at: 2, id: "feed" }], [{ at: 1, id: "gm" }, { at: 2, id: "gm2" }]]);
// // [{ at: 1, id: "gm" }, { at: 2, id: "feed" }, { at: 2, id: "gm2" }]
// ```

/**
 * The lines of every source in one list, sorted by `at` (oldest first). Stable: lines with the same `at` keep the order
 * of their sources, then their order inside the source.
 */
export function mergeLog<T extends { at: number }>(sources: readonly (readonly T[])[]): T[] {
  return sources
    .flatMap((lines, s) => lines.map((line, i) => ({ line, s, i })))
    .sort((a, b) => a.line.at - b.line.at || a.s - b.s || a.i - b.i)
    .map(({ line }) => line);
}
