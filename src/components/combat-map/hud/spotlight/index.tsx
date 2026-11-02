import type { ReactNode } from "react";

import type { HudPartProps } from "../state";

// Plan combat-hud H0: a stub region that renders nothing yet; H1.S fills it. The shell
// (hud/shell.tsx) mounts it in its own PartBoundary; keep the export's name and props.

/** Who holds the spotlight: the banner tag, the Fear banner's SPOTLIGHT, "The GM has the spotlight" and the GM's hand-back (answer 1c). */
export const HudSpotlight: (props: HudPartProps) => ReactNode = () => null;
