/**
 * Playing a card through the picking panel (plan combat-hud H3.1; docs/tasks/TASK-HUD-H3.1.md). The HUD hand
 * (hud/hand/body.tsx) opens `cardSession(env)` through H3.0's `usePick().open`; `useCardPlay` sends the use; an area
 * asks the map for its square through the `PointPicker` seam (H3.3's HUD picker); a chain link is its own session.
 */
import "./pick-card.css";

export { cardPatch, cardSession, type CardPickEnv } from "./session";
export { CardRows, hasCardRows } from "./rows";
export { useCardPlay, type CardPlay } from "./use-play";
export { cardAreaAsk, cardAreaLine, classicPointPicker, hudPointPicker, type PointPicker, type PointRequest } from "./points";
export { cardChainSession, cardChainSessionId, chainAskOf, type CardChainData, type CardChainEnv } from "./chain";
export {
  blockedOf,
  cardSessionId,
  payLine,
  primaryLabel,
  requestOf,
  riderOptions,
  ridersOf,
  ruleOf,
  selfRows,
  startData,
  verbOf,
  type CardPickData,
  type Rider,
} from "./model";
