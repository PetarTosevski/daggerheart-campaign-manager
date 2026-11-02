import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H4.2 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The incoming-hit window (Main 'You're hit', CmpPromptsPlayer 'Pay something else?'). */
export const HudHit: (props: HudPartProps) => ReactNode = () => null;
