import type { ReactNode } from "react";

import type { HudLayerProps, HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H3.0 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The one picking panel, 42 px right of the primary target (CmpPicking); the session slot is `useHud().pick`. */
export const HudPick: (props: HudPartProps) => ReactNode = () => null;

/** The target rings on the map (picked / in / out / los, band labels; CmpTokens 'Target rings'). */
export const HudPickLayer: (props: HudLayerProps) => ReactNode = () => null;
