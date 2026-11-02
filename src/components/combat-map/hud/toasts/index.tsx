import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H6.1 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** Layer 3 of the blocked-state system: a toast near the hand for a refusal that comes later or elsewhere (CmpBlocked). */
export const HudToasts: (props: HudPartProps) => ReactNode = () => null;
