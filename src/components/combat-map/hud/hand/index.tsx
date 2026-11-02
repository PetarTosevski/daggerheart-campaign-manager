import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H2.3 fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** The hand: the fan bottom-centre around x = 1050 with the vault, Roll options and Hide cards (CmpCards). The card face stays the app's own (hard rule 1). */
export const HudHand: (props: HudPartProps) => ReactNode = () => null;
