import "./ui.css";

/**
 * The Combat HUD's shared primitives (plan combat-hud H0). Every HUD part builds on these instead of its own copies
 * (CH7); unit tests: tests/unit/hud/h0-ui.test.tsx.
 */
export { ChoiceRow, Stepper, Toggle, TwoTapButton } from "./controls";
export type { ChoiceRowProps, StepperProps, ToggleProps, TwoTapButtonProps } from "./controls";
export { BandLabel, CostPill, Pips, Seal, StatTile, Tag, WaitingDots, costLabel } from "./marks";
export type { BandState, CostResource, PipKind, TagKind } from "./marks";
export { Popup, hudButtonClass, type HudButtonRole } from "./popup";
export type { PopupAction, PopupProps, PopupTone } from "./popup";
export { PART_RETRY_DELAYS_MS, PART_RETRY_STABLE_MS, PartBoundary } from "./boundary";
export { SidePanel } from "./side-panel";
export type { SidePanelProps } from "./side-panel";
