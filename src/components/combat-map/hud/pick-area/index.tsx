"use client";

import "./area-pick.css";

/**
 * Square picking for the HUD (plan combat-hud H3.3; HANDOFF "The picking pattern", other modes; CmpPicking 'Area · pick
 * a square', 'Wall · two points', 'Chain links'). The shell mounts `HudAreaPickLayer` on the map (crosshair, radius,
 * wall handles, chain links) and `HudAreaPick` in the pop region (banner, bar, result line).
 *
 * Entry point for every picker that needs squares (H3.3's features, H3.1's cards, H3.4's ring), from a click handler:
 *
 *   startAreaPick({
 *     id: `card:${cardId}:${useId}`, mapId, name: "Veil of Night", label: "Veil of Night",
 *     shape: "wall", count: 2, within: "far", blocksSight: true, origin: actorFootprint,
 *     pay: "Spends 1 Hope",
 *     send: async (squares) => {               // in pick order: point = squares[0], points = the rest
 *       const out = await useCard({ ..., point: squares[0], points: squares.slice(1) });
 *       if (out.status === "pending") return { kind: "pending" };
 *       return { kind: "done", line: "Veil of Night is on the map." };
 *     },
 *     onCancel: () => lowerCard(cardId),
 *   });
 *
 * or `await pickArea({...})` → `Square[] | null` when the asker sends the use itself. `areaAskOf(area, picks)` (from
 * hud/pick-feature) builds the ask from a use's `AreaSpec`. End any open pick session (`usePick().finish()`) first:
 * the two are different map modes. Chains: open a pick session whose `data` carries `{ chain: { links } }` (chain.ts).
 */

export { HudAreaPickLayer } from "./layer";
export { HudAreaPick } from "./bar";
export {
  cancelAreaPick,
  confirmAreaPick,
  dismissPickLine,
  pickArea,
  resetAreaPickForTests,
  showPickLine,
  startAreaPick,
  useAreaPickState,
  type AreaPickLive,
  type AreaPickOutcome,
  type AreaPickSpec,
  type PickLine,
} from "./store";
export {
  bannerText,
  confirmLabel,
  confirmProblem,
  placeAt,
  progressText,
  stepCursor,
  summaryText,
  wallLength,
  type AreaAsk,
  type Square,
} from "./model";
export { chainAnswer, chainOf, chainRows, type ChainCreature, type ChainLinks } from "./chain";
