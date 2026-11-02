import type { ReactNode } from "react";

import type { HudLayerProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H3.4 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The action ring around your own token: Attack, Cast, Sheet and every feature with a Use button (answer 3b). */
export const HudActionRing: (props: HudLayerProps) => ReactNode = () => null;
