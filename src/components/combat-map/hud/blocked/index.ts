import "./blocked.css";

/**
 * The HUD's one blocked-state system (plan combat-hud H6.1; board CmpBlocked; API: docs/tasks/TASK-HUD-H6.1.md):
 * layer 1 before the click (`blockedReason`, `useBlocked`, `BlockedReason`, `BlockedTag`), layer 2 at the click
 * (`useRefusal`, `RefusalMessage`), layer 3 later (`hudToasts` → `HudToasts` near the hand). Words come from
 * src/lib/errors/refusals.ts; numbers from src/lib/domain/combat-actions/shortfall.ts.
 */
export { BlockedReason, BlockedTag, blockedReason, useBlocked } from "./reason";
export type { Blocked, BlockedInput } from "./reason";
export { RefusalMessage, useRefusal } from "./use-refusal";
export type { RefusalState, UseRefusalOptions } from "./use-refusal";
export { hudToasts } from "../toasts/store";
