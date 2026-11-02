import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H4.3 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The death move at your last Hit Point (Main 'Last Hit Point'), waiting for the GM's confirm (answer 15b). */
export const HudDeath: (props: HudPartProps) => ReactNode = () => null;
