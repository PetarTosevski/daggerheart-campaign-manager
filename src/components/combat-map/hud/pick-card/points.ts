import type { AreaSpec, CardUse } from "@/lib/domain/card-effects/types";
import type { Footprint } from "@/lib/domain/combat-actions/distance";

import { startAreaPick as startClassicPick } from "../../map-view/area-pick";
import { RANGE_LABEL, type AreaPick, type UseOutcome } from "../../actions/hand/model";
import { areaStepsOf } from "../../drawer/use/model";
import { startAreaPick, type AreaAsk, type Square } from "../pick-area";
import { areaAskOf } from "../pick-feature/model";

/**
 * The seam where a card's area asks the map for its square (or a wall's two ends) before the use is sent (plan combat-hud
 * H3.1). The HUD hand uses H3.3's HUD picker (`hudPointPicker`: crosshair, radius preview, banner and bar, wall
 * handles, arrows + Enter). `classicPointPicker` (the classic map banner, `map-view/area-pick.tsx`) is kept only for a
 * host without the HUD's `HudAreaPickLayer` / `HudAreaPick` mounted (the HUD shell mounts both, so nothing in the app
 * passes it today); docs/tasks/TASK-HUD-H3.1.md "Wiring after H3.3".
 */

export type PointRequest = {
  /** Stable per card and use (the HUD picker's mode id). */
  id: string;
  mapId: string;
  /** The card's name ("Mysterious Mist"), for the banner and the result line. */
  cardName: string;
  area: AreaPick;
  /** The HUD ask (`cardAreaAsk`): shape, count, radius, within, blocks sight, the caster's square. */
  ask: AreaAsk;
  /** Sends the use with the picked squares (one, or a wall's two ends); its line goes to the banner. Throws a refusal. */
  send: (squares: readonly Square[]) => Promise<string | null>;
};

export type PointPicker = (request: PointRequest) => void;

/**
 * The HUD ask of a card's area: H3.3's `areaAskOf` over the use's own `AreaSpec` (blocks sight, radius, within), else
 * (no spec found) the hand model's `AreaPick` alone. One square, or a wall's two ends, as the server takes them.
 */
export function cardAreaAsk(cardName: string, area: AreaPick, use: Pick<CardUse, "steps"> | undefined, origin: Footprint | null): AreaAsk {
  const spec: AreaSpec | undefined = use ? areaStepsOf(use.steps).find((a) => a.label === area.label && (a.centre === "point" || a.shape === "wall")) : undefined;
  if (spec) return areaAskOf(cardName, spec, area.squares === 2 ? { kind: "wall" } : { kind: "one" }, origin);
  return {
    name: cardName,
    label: area.label,
    shape: area.squares === 2 ? "wall" : "circle",
    count: area.squares,
    ...(area.squares === 1 ? { radius: area.radius } : {}),
    ...(area.placeWithin ? { within: area.placeWithin } : {}),
    origin,
  };
}

/** The bar's line after a card's square pick (the drawer's `areaUseLine` wording); null when a choice asks next. */
export function cardAreaLine(name: string, label: string, out: UseOutcome | null | undefined): string | null {
  if (!out || out.status === "needsChoice") return null;
  if (out.status === "pending") return `${name}: waiting for the GM to approve.`;
  const rolled = out.roll ? `Rolled ${out.roll.total}: ` : "";
  return out.success ? `${rolled}${label} is on the map.` : `${rolled}${name} failed.`;
}

/** H3.3's HUD square picking: the use goes with the squares at the confirm; a refusal stays under the confirm. */
export const hudPointPicker: PointPicker = ({ id, mapId, ask, send }) => {
  startAreaPick({ ...ask, id, mapId, send: async (squares) => ({ kind: "done", line: await send(squares) }) });
};

/** The classic banner: "Pick the centre of Mysterious Mist within Far range", then "the other end" for a wall. */
export const classicPointPicker: PointPicker = ({ mapId, area, send }) => {
  const within = area.placeWithin ? ` within ${RANGE_LABEL[area.placeWithin] ?? area.placeWithin} range` : "";
  const ask = (got: readonly Square[]) => {
    const what = area.squares === 2 ? (got.length === 0 ? "one end" : "the other end") : "the centre";
    startClassicPick({
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
