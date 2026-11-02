import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H5.2 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The GM's adversary stat block on parchment in the sheet panel, with the attack picker (GMDesktop 'Adversary acting'). Reads `useHud().sheet`. */
export const HudStatBlock: (props: HudPartProps) => ReactNode = () => null;
