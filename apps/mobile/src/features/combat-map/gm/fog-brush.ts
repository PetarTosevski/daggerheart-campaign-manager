import { isEmptyTile, paintTile, squaresByTile } from "../../../../../../src/components/combat-map/editor/edit-model";
import { CELL_UNPAINTED, FOG_HIDE, FOG_REVEAL, type StoredCellTile } from "../../../../../../src/components/combat-map/map-view/cells";

/**
 * The GM's fog brush on the phone (R12, dcm-gdzi.17): the marks drawn on the GM's own view (the website draws
 * reveal squares light and hide squares dark), and the optimistic copy of a `combatVision.paintFog` stroke on
 * `combatMaps.live`'s cells, built on the editor's shared tile helpers.
 */

/** One horizontal run of same-marked squares in a row (one rectangle on the canvas instead of one per square). */
export type FogRun = { x: number; y: number; w: number; mark: "reveal" | "hide" };

/** The marks (`decodeCells(...).fog`, keyed "x,y") as runs, row by row. */
export function fogRuns(fog: Readonly<Record<string, "reveal" | "hide">>): FogRun[] {
  const rows = new Map<number, { x: number; mark: "reveal" | "hide" }[]>();
  for (const [key, mark] of Object.entries(fog)) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const row = rows.get(y) ?? [];
    row.push({ x, mark });
    rows.set(y, row);
  }
  const runs: FogRun[] = [];
  for (const [y, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a.x - b.x);
    let open: FogRun | null = null;
    for (const s of row) {
      if (open !== null && open.mark === s.mark && open.x + open.w === s.x) {
        open.w += 1;
        continue;
      }
      open = { x: s.x, y, w: 1, mark: s.mark };
      runs.push(open);
    }
  }
  return runs;
}

/** What one stroke paints (`paintFog`'s `mark`): erase gives the squares back to automatic vision. */
export type FogStroke = "reveal" | "hide" | "erase";

const CODE: Record<FogStroke, string> = { reveal: FOG_REVEAL, hide: FOG_HIDE, erase: CELL_UNPAINTED };

/** The layout's cells after a fog stroke: the fog tiles it touches rewritten (an emptied one dropped), the rest kept. */
export function withFogStroke<T extends StoredCellTile>(cells: readonly T[], w: number, squares: readonly number[], mark: FogStroke): (T | StoredCellTile)[] {
  const touched = squaresByTile([...new Set(squares)], w);
  const kept: (T | StoredCellTile)[] = cells.filter((t) => t.layer !== "fog" || !touched.has(t.tile));
  for (const [tile, positions] of touched) {
    const before = cells.find((t) => t.layer === "fog" && t.tile === tile)?.cells ?? null;
    const after = paintTile(before, w, positions, CODE[mark]);
    if (!isEmptyTile(after)) kept.push({ layer: "fog", tile, cells: after });
  }
  return kept;
}
