import { startAreaPick, type Square } from "../../map-view/area-pick";
import { RANGE_LABEL, type AreaPick } from "../../actions/hand/model";

/**
 * The seam where a card's area asks the map for its square (or a wall's two ends) before the use is sent (plan combat-hud
 * H3.1). Until H3.3's HUD area picker (`hud/pick-area`: crosshair, radius preview, banner, wall handles) is merged, the
 * HUD hand uses the classic map pick banner (`map-view/area-pick.tsx`), exactly as the classic hand did (lanes-2
 * E1.4a). At merge the orchestrator swaps `classicPointPicker` for H3.3's picker behind the same `PointPicker` type
 * (docs/tasks/TASK-HUD-H3.1.md "Merge-time actions").
 */

export type PointRequest = {
  mapId: string;
  /** The card's name ("Mysterious Mist"), for the banner and the result line. */
  cardName: string;
  area: AreaPick;
  /** Sends the use with the picked squares (one, or a wall's two ends); its line goes to the banner. */
  send: (squares: readonly Square[]) => Promise<string | null>;
};

export type PointPicker = (request: PointRequest) => void;

/** The classic banner: "Pick the centre of Mysterious Mist within Far range", then "the other end" for a wall. */
export const classicPointPicker: PointPicker = ({ mapId, area, send }) => {
  const within = area.placeWithin ? ` within ${RANGE_LABEL[area.placeWithin] ?? area.placeWithin} range` : "";
  const ask = (got: readonly Square[]) => {
    const what = area.squares === 2 ? (got.length === 0 ? "one end" : "the other end") : "the centre";
    startAreaPick({
      prompt: `Pick ${what} of ${area.label}${within}`,
      mapId,
      ...(area.squares === 1 && area.radius !== "veryFar" ? { radius: area.radius } : {}),
      onPick: async (square) => {
        const all = [...got, square];
        if (all.length < area.squares) {
          ask(all);
          return null;
        }
        return send(all);
      },
    });
  };
  ask([]);
};
