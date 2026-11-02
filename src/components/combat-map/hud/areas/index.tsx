import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H5.3 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The GM's Areas panel (GMDesktop 'Areas'). */
export const HudAreas: (props: HudPartProps) => ReactNode = () => null;
