import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H2.1 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The 400 px sheet panel on the right for the open PC (own / view only / GM edit; Main, GMDesktop). Reads `useHud().sheet`. */
export const HudSheet: (props: HudPartProps) => ReactNode = () => null;
